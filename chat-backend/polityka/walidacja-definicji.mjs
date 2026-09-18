// Bramka kontraktu na DEFINICJI - decyzja architektoniczna v3 par. 4.1 (K1-K6) i par. 4.1a.
//
// Zamyka dokładnie te luki, których silnik nie egzekwuje (tabela "Nie egzekwuje silnik"
// w par. 4.1a). Nie dubluje tego, co silnik już łapie przy zapisie (nieznane pole kroku,
// krok bez polecenia, duplikat id, zły typ pola, niepoprawny YAML) - to byłoby budowanie
// drugiego silnika.
//
// Wszystko pracuje na sparsowanej strukturze. Wyrażenia regularne dotykają wyłącznie
// zawartości pojedynczego łańcucha znaków (polecenie powłoki), bo to jest tekst także
// dla silnika - nigdy tekstu całego pliku.

import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { naruszenie, odmowa, zgoda } from './bledy.mjs'
import { odcisk, kanoniczny } from './kanonizacja.mjs'
import { sprawdzIdentyfikator } from './identyfikatory.mjs'
import {
  parsujDefinicje, zbierzKroki, lancuchy, zaleznosciKroku, normalizujContinueOn,
} from './struktura.mjs'

const AKCJE_PODDAGA = new Set(['dag.run', 'dag.enqueue'])

// K5: drugi kanał. Wzorce działają na treści pojedynczego łańcucha ze struktury.
const WZ_OUTPUT_FILE = /\$\{?DAGU_OUTPUT_FILE\b/
const WZ_ODWOLANIE_OUTPUTS = /\$\{\s*steps\.[^}]*\.outputs\.[^}]*\}/

function utworzAjv() {
  const ajv = new Ajv({ strict: false, allErrors: true, validateSchema: true })
  addFormats(ajv)
  return ajv
}

/** Polecenia kroku jako lista łańcuchów - `run`, `script`, przestarzałe `command`. */
function poleceniaKroku(krok) {
  const zebrane = []
  for (const pole of ['run', 'command', 'script']) {
    const wartosc = krok?.[pole]
    if (typeof wartosc === 'string') zebrane.push({ tekst: wartosc, pole })
    else if (Array.isArray(wartosc)) {
      wartosc.forEach((w, i) => { if (typeof w === 'string') zebrane.push({ tekst: w, pole: `${pole}[${i}]` }) })
    }
  }
  return zebrane
}

/**
 * Rozwinięcie kroku: akcja własna (z DAG-a albo z pliku bazowego) wnosi szablon
 * i schemat wyjścia. Bez tego polityka widziałaby `action: cos` i nie wiedziała,
 * co ten krok naprawdę robi.
 */
function rozwinKrok(krok, akcje) {
  const nazwaAkcji = typeof krok.action === 'string' ? krok.action : null
  const definicjaAkcji = nazwaAkcji && Object.prototype.hasOwnProperty.call(akcje, nazwaAkcji)
    ? akcje[nazwaAkcji] : null
  if (!definicjaAkcji) return { krok, definicjaAkcji: null, nazwaAkcji, schemat: krok.output_schema ?? null,
    zrodloSchematu: krok.output_schema ? 'inline' : null }

  const szablon = definicjaAkcji.template && typeof definicjaAkcji.template === 'object'
    ? definicjaAkcji.template : {}
  const rozwiniety = { ...szablon, ...krok }
  const schemat = krok.output_schema ?? definicjaAkcji.output_schema ?? null
  const zrodloSchematu = krok.output_schema ? 'inline'
    : definicjaAkcji.output_schema ? `akcja:${nazwaAkcji}` : null
  return { krok: rozwiniety, definicjaAkcji, nazwaAkcji, schemat, zrodloSchematu }
}

/** Właściwości bez `type` - schemat, który ich nie typuje, nie opisuje wyniku "dokładnie" (K3). */
function wlasciwosciBezTypu(schemat, prefiks = '') {
  const braki = []
  const wlasciwosci = schemat?.properties
  if (!wlasciwosci || typeof wlasciwosci !== 'object') return braki
  for (const nazwa of Object.keys(wlasciwosci)) {
    const w = wlasciwosci[nazwa]
    const sciezka = prefiks ? `${prefiks}.${nazwa}` : nazwa
    if (!w || typeof w !== 'object') { braki.push(sciezka); continue }
    const maTyp = typeof w.type === 'string' || Array.isArray(w.type)
      || w.enum !== undefined || w.const !== undefined
      || w.$ref !== undefined || w.oneOf !== undefined || w.anyOf !== undefined || w.allOf !== undefined
    if (!maTyp) { braki.push(sciezka); continue }
    if (w.type === 'object') braki.push(...wlasciwosciBezTypu(w, sciezka))
    if (w.type === 'array' && w.items && typeof w.items === 'object') {
      braki.push(...wlasciwosciBezTypu(w.items, `${sciezka}[]`))
    }
  }
  return braki
}

function opiszTyp(wlasciwosc) {
  if (!wlasciwosc || typeof wlasciwosc !== 'object') return 'bez typu'
  if (typeof wlasciwosc.type === 'string') return wlasciwosc.type
  if (Array.isArray(wlasciwosc.type)) return wlasciwosc.type.join('|')
  if (wlasciwosc.enum) return 'enum'
  return 'bez typu'
}

/** Sprawdzenie kształtu schematu (K3) - zanim zapytamy o jego tożsamość w rejestrze. */
function sprawdzKsztaltSchematu(schemat, poleSchematu, nazwaKroku, ajv) {
  if (schemat === null || typeof schemat !== 'object' || Array.isArray(schemat)) {
    return [naruszenie('K3_SCHEMAT_NIEOBIEKTOWY', poleSchematu,
      `Krok "${nazwaKroku}": output_schema musi być obiektowym schematem JSON Schema. ` +
      'Silnik odrzuca przy ładowaniu wszystko inne (output_schema must resolve to an object schema).')]
  }
  if (Object.keys(schemat).length === 0) {
    return [naruszenie('K3_SCHEMAT_PUSTY', poleSchematu,
      `Krok "${nazwaKroku}": output_schema jest pusty ({}). Taki schemat przepuszcza dowolny JSON, ` +
      'czyli nie jest kontraktem. Opisz wynik dokładnie: type, required, properties z typami, ' +
      'additionalProperties: false.')]
  }
  if (schemat.type !== undefined && schemat.type !== 'object') {
    return [naruszenie('K3_SCHEMAT_NIEOBIEKTOWY', `${poleSchematu}.type`,
      `Krok "${nazwaKroku}": output_schema ma type: ${JSON.stringify(schemat.type)}, ` +
      'a kontrakt wymaga schematu obiektowego. Wynik najwyższego poziomu będący tablicą opakuj w obiekt.')]
  }

  const braki = []
  if (!Array.isArray(schemat.required) || schemat.required.length === 0) {
    braki.push(naruszenie('K3_BRAK_REQUIRED', `${poleSchematu}.required`,
      `Krok "${nazwaKroku}": output_schema nie ma niepustej listy required. Bez niej wynik z brakującym ` +
      'polem przechodzi walidację silnika i odbiorca dostaje undefined.'))
  }
  if (schemat.additionalProperties !== false) {
    braki.push(naruszenie('K3_BRAK_ADDITIONAL_PROPERTIES', `${poleSchematu}.additionalProperties`,
      `Krok "${nazwaKroku}": output_schema nie ma additionalProperties: false. Bez tego krok może ` +
      'dołożyć do wyniku dowolne pola, a walidacja tego nie zauważy.'))
  }
  const bezTypu = wlasciwosciBezTypu(schemat)
  if (bezTypu.length > 0) {
    braki.push(naruszenie('K3_WLASCIWOSC_BEZ_TYPU', `${poleSchematu}.properties`,
      `Krok "${nazwaKroku}": właściwości bez zadeklarowanego typu: ${bezTypu.join(', ')}. ` +
      'Kontrakt opisuje wynik dokładnie, więc każda właściwość ma mieć type.'))
  }
  if (!schemat.properties || Object.keys(schemat.properties).length === 0) {
    braki.push(naruszenie('K3_BRAK_REQUIRED', `${poleSchematu}.properties`,
      `Krok "${nazwaKroku}": output_schema nie wymienia ani jednej właściwości.`))
  }
  try {
    ajv.compile(schemat)
  } catch (e) {
    braki.push(naruszenie('K3_SCHEMAT_NIEPOPRAWNY', poleSchematu,
      `Krok "${nazwaKroku}": output_schema nie kompiluje się jako JSON Schema: ${e.message}`))
  }
  return braki
}

/** Tożsamość kontraktu: czy ten schemat JEST zatwierdzoną wersją z katalogu kontrakty/. */
function sprawdzTozsamoscKontraktu(schemat, poleSchematu, nazwaKroku, rejestr) {
  const trafienie = rejestr.dopasujSchemat(schemat)
  if (trafienie) return { naruszenia: [], wpis: trafienie }

  const kandydaci = rejestr.kandydaciPoKsztalcie(schemat)
  if (kandydaci.length > 0) {
    const roznice = []
    for (const kandydat of kandydaci) {
      for (const nazwa of Object.keys(kandydat.schemat.properties ?? {})) {
        const oczekiwany = opiszTyp(kandydat.schemat.properties[nazwa])
        const znaleziony = opiszTyp(schemat.properties?.[nazwa])
        if (oczekiwany !== znaleziony) {
          roznice.push(`${kandydat.kontrakt} v${kandydat.wersja}: właściwość "${nazwa}" ma być ` +
            `typu ${oczekiwany}, a w definicji jest ${znaleziony}`)
        }
      }
    }
    if (roznice.length > 0) {
      return { naruszenia: [naruszenie('K3_KONTRAKT_ROZNICA_TYPU', poleSchematu,
        `Krok "${nazwaKroku}": schemat nie jest zatwierdzonym kontraktem. Różnice wobec ` +
        `zatwierdzonej wersji - ${roznice.join('; ')}. Zmiana kontraktu to zmiana pliku ` +
        'w katalogu kontrakty/, a nie edycja definicji procesu.')], wpis: null }
    }
    return { naruszenia: [naruszenie('K3_KONTRAKT_NIEZATWIERDZONY', poleSchematu,
      `Krok "${nazwaKroku}": schemat ma te same nazwy właściwości co ` +
      `${kandydaci.map((k) => `${k.kontrakt} v${k.wersja}`).join(', ')}, ale różni się treścią ` +
      '(required, additionalProperties albo zagnieżdżenie). Użyj zatwierdzonej wersji z katalogu kontrakty/.')],
    wpis: null }
  }

  const dostepne = rejestr.lista().map((w) => `${w.kontrakt} v${w.wersja}`)
  return { naruszenia: [naruszenie('K3_KONTRAKT_NIEZATWIERDZONY', poleSchematu,
    `Krok "${nazwaKroku}": użyty output_schema nie jest żadnym z zatwierdzonych kontraktów. ` +
    `Zatwierdzone: ${dostepne.length ? dostepne.join(', ') : '(rejestr jest pusty)'}. ` +
    'Kontrakty żyją w katalogu kontrakty/ i są wersjonowane w Gicie; definicja procesu ma się ' +
    'do nich odwoływać, a nie nieść własną treść schematu.')], wpis: null }
}

/**
 * Główne wejście warstwy.
 *
 * @param {object} opcje
 * @param {string} opcje.nazwa        identyfikator DAG-a (par. 4.2)
 * @param {string|object} opcje.yaml  definicja - tekst YAML albo gotowy obiekt
 * @param {object} opcje.rejestr      z wczytajRejestr()
 * @param {string|object|null} [opcje.plikBazowy]  base.yaml silnika (akcje własne, defaults)
 * @param {object} [opcje.poddagi]    { nazwa: yaml } definicje wołane przez action: dag.run
 */
export function sprawdzDefinicje({ nazwa, yaml, rejestr, plikBazowy = null, poddagi = {} }) {
  const ajv = utworzAjv()
  const odwiedzone = new Set()
  const naruszenia = []
  const uzyteKontrakty = []
  const kroki = []
  const kanoniczneDefinicje = {}

  const wynikBazy = plikBazowy === null || plikBazowy === undefined
    ? { ok: true, definicja: {} }
    : parsujDefinicje(plikBazowy, 'base.yaml')
  if (!wynikBazy.ok) return odmowa(wynikBazy.naruszenie)
  const akcjeBazowe = (wynikBazy.definicja.actions && typeof wynikBazy.definicja.actions === 'object')
    ? wynikBazy.definicja.actions : {}

  const wynikId = sprawdzIdentyfikator(nazwa)
  if (!wynikId.ok) naruszenia.push(...wynikId.naruszenia)

  sprawdzJedna({ nazwa, zrodlo: yaml, prefiks: '' })

  if (naruszenia.length > 0) return odmowa(naruszenia)

  const sumaKontrolna = odcisk({ nazwa, definicje: kanoniczneDefinicje })
  return zgoda({ raport: {
    nazwa,
    sumaKontrolna,
    odciskBazy: plikBazowy ? odcisk(kanoniczny(wynikBazy.definicja)) : null,
    odciskRejestru: rejestr.odcisk,
    poddagi: Object.keys(kanoniczneDefinicje).filter((k) => k !== nazwa),
    kroki,
    uzyteKontrakty,
  } })

  // ---------------------------------------------------------------------------

  function sprawdzJedna({ nazwa: nazwaDaga, zrodlo, prefiks }) {
    if (odwiedzone.has(nazwaDaga)) return
    odwiedzone.add(nazwaDaga)

    const wynik = parsujDefinicje(zrodlo, `${prefiks}definicja`)
    if (!wynik.ok) { naruszenia.push(wynik.naruszenie); return }
    const definicja = wynik.definicja
    kanoniczneDefinicje[nazwaDaga] = kanoniczny(definicja)

    const akcjeDaga = (definicja.actions && typeof definicja.actions === 'object') ? definicja.actions : {}
    // Silnik odrzuca przesłonięcie akcji bazowej lokalną (walidacja par. 3.5), ale robi to
    // dopiero przy starcie - zgłaszamy przy zapisie, bo inaczej DAG wygląda na poprawny.
    for (const nazwaAkcji of Object.keys(akcjeDaga)) {
      if (Object.prototype.hasOwnProperty.call(akcjeBazowe, nazwaAkcji)) {
        naruszenia.push(naruszenie('K3_KONTRAKT_NIEZATWIERDZONY', `${prefiks}actions.${nazwaAkcji}`,
          `Akcja "${nazwaAkcji}" jest już zdefiniowana w pliku bazowym i nie wolno jej przesłonić ` +
          'lokalnie. Silnik odrzuci taki DAG przy starcie, a przesłonięcie akcji niosącej kontrakt ' +
          'byłoby obejściem polityki.'))
      }
    }
    const akcje = { ...akcjeBazowe, ...akcjeDaga }

    // --- K5: odwołanie ${steps.*.outputs.*} w dowolnym miejscu definicji -------------
    for (const { tekst, sciezka } of lancuchy(definicja)) {
      if (WZ_ODWOLANIE_OUTPUTS.test(tekst)) {
        naruszenia.push(naruszenie('K5_ODWOLANIE_OUTPUTS', `${prefiks}${sciezka}`,
          'Odwołanie ${steps.*.outputs.*} jest zakazane (K5). Silnik go NIE rozwija i NIE zgłasza ' +
          'błędu - krok się udaje, a odbiorca dostaje tekst placeholdera zamiast danych. ' +
          'Wynik przenosimy przez output: NAZWA i czytamy jako "$NAZWA".'))
      }
    }

    // --- defaults: continue_on rozdawane wszystkim krokom naraz ---------------------
    const domyslneContinue = normalizujContinueOn(definicja.defaults?.continue_on)
    if (domyslneContinue && (domyslneContinue.failure === true || domyslneContinue.mark_success === true)) {
      naruszenia.push(naruszenie('CONTINUE_ON_DEFAULTS', `${prefiks}defaults.continue_on`,
        'defaults.continue_on z failure: true albo mark_success: true dotyczy KAŻDEGO kroku, ' +
        'także kroków objętych kontraktem - zamienia czerwony przebieg w zielony i maskuje ' +
        'naruszenie schematu. Ustaw continue_on na konkretnym kroku, który ma prawo zawieść.'))
    }

    const zebrane = zbierzKroki(definicja.steps, `${prefiks}steps`)
    if (zebrane.length === 0) {
      naruszenia.push(naruszenie('DAG_BEZ_KROKOW', `${prefiks}steps`,
        `Proces "${nazwaDaga}" nie ma ani jednego kroku. Silnik przepuszcza taki DAG przez lint ` +
        'i kończy go jako succeeded - zielony przebieg, który niczego nie zrobił.'))
    }

    const producenci = new Map()   // nazwa zmiennej -> nazwa kroku
    for (const { krok, nazwa: nazwaKroku } of zebrane) {
      if (typeof krok.output === 'string') producenci.set(krok.output, nazwaKroku)
    }

    for (const pozycja of zebrane) {
      sprawdzKrok({ ...pozycja, akcje, prefiks, nazwaDaga, producenci, zebrane, domyslneContinue })
    }

    sprawdzGraf(zebrane, prefiks, nazwaDaga)
  }

  function sprawdzKrok({ krok, sciezka, nazwa: nazwaKroku, akcje, prefiks, nazwaDaga, producenci, zebrane }) {
    const rozwiniety = rozwinKrok(krok, akcje)
    const efektywny = rozwiniety.krok
    const schemat = rozwiniety.schemat

    // --- K5: drugi kanał ------------------------------------------------------------
    if (krok.outputs !== undefined) {
      naruszenia.push(naruszenie('K5_OUTPUTS', `${sciezka}.outputs`,
        `Krok "${nazwaKroku}": deklaracja outputs: jest zakazana (K5). Publikuje przez ` +
        'DAGU_OUTPUT_FILE, czyli kanał, którego natywna walidacja output_schema NIE widzi - ' +
        'krok może wtedy wypisać zgodny JSON na stdout i jednocześnie opublikować śmieci.'))
    }
    if (efektywny.action === 'outputs.write') {
      naruszenia.push(naruszenie('K5_OUTPUTS', `${sciezka}.action`,
        `Krok "${nazwaKroku}": action: outputs.write publikuje poza zasięgiem output_schema (K5).`))
    }
    for (const { tekst, pole } of poleceniaKroku(efektywny)) {
      if (WZ_OUTPUT_FILE.test(tekst)) {
        naruszenia.push(naruszenie('K5_OUTPUT_FILE', `${sciezka}.${pole}`,
          `Krok "${nazwaKroku}": zapis do $DAGU_OUTPUT_FILE jest zakazany (K5). Natywna walidacja ` +
          'output_schema tego kanału nie widzi - DAG kończy się na zielono, a odbiorca dostaje ' +
          'dokument, którego nikt nie sprawdził. Wynik wypisz na stdout i przechwyć przez output:.'))
      }
    }

    // --- K2: płaskie przechwycenie stdout -------------------------------------------
    const publikujePlasko = typeof krok.output === 'string'
    if (krok.output !== undefined && !publikujePlasko) {
      naruszenia.push(naruszenie('K2_OUTPUT_NIEPLASKI', `${sciezka}.output`,
        `Krok "${nazwaKroku}": output: musi być nazwą zmiennej (płaskie przechwycenie stdout). ` +
        'Postać obiektowa publikuje przez osobny kanał ${step.output.*}, w którym walidowana ' +
        'wartość i wartość opublikowana to dwie różne rzeczy.'))
    }

    // --- K3: kontrakt na kroku publikującym wynik -----------------------------------
    const poleSchematu = rozwiniety.zrodloSchematu?.startsWith('akcja:')
      ? `${prefiks}actions.${rozwiniety.nazwaAkcji}.output_schema`
      : `${sciezka}.output_schema`

    if (publikujePlasko && schemat === null) {
      naruszenia.push(naruszenie('K3_BRAK_SCHEMATU', `${sciezka}.output_schema`,
        `Krok "${nazwaKroku}" publikuje wynik przez output: ${krok.output}, ale nie ma output_schema. ` +
        'Pole jest w silniku opcjonalne i nie da się go narzucić globalnie przez defaults:, ' +
        'więc bez niego wynik nie jest objęty żadnym kontraktem.'))
    }
    if (!publikujePlasko && schemat !== null && rozwiniety.zrodloSchematu === 'inline') {
      naruszenia.push(naruszenie('K2_BRAK_OUTPUT', `${sciezka}.output`,
        `Krok "${nazwaKroku}" ma output_schema, ale nie ma output: NAZWA. Płaskie przechwycenie ` +
        'stdout jest jedyną kombinacją, w której wartość walidowana i wartość opublikowana to ' +
        'ta sama rzecz.'))
    }

    let wpisKontraktu = null
    if (schemat !== null) {
      const ksztalt = sprawdzKsztaltSchematu(schemat, poleSchematu, nazwaKroku, ajv)
      if (ksztalt.length > 0) {
        naruszenia.push(...ksztalt)
      } else {
        const tozsamosc = sprawdzTozsamoscKontraktu(schemat, poleSchematu, nazwaKroku, rejestr)
        naruszenia.push(...tozsamosc.naruszenia)
        wpisKontraktu = tozsamosc.wpis
        if (wpisKontraktu) {
          uzyteKontrakty.push({ kontrakt: wpisKontraktu.kontrakt, wersja: wpisKontraktu.wersja })
        }
      }
    }

    // --- continue_on: maskowanie kontra poprawnie pominięta gałąź --------------------
    // `skipped` jest WYMAGANY przy fan-inie po rozgałęzieniu [D13] i musi przechodzić.
    const continueOn = normalizujContinueOn(krok.continue_on)
    const objetyKontraktem = schemat !== null
    if (continueOn && objetyKontraktem && (continueOn.failure === true || continueOn.mark_success === true)) {
      naruszenia.push(naruszenie('CONTINUE_ON_MASKUJE', `${sciezka}.continue_on`,
        `Krok "${nazwaKroku}" jest objęty kontraktem, a ma continue_on z ` +
        `${continueOn.mark_success === true ? 'mark_success: true' : 'failure: true'}. ` +
        'Sprawdzone wykonaniem: wynik łamiący schemat daje wtedy DAG "succeeded", zmienna wyniku ' +
        'jest pusta, a odbiorca leci dalej. Przebieg kłamie o sukcesie. ' +
        'continue_on: skipped na gałęzi warunkowej jest dozwolony i tego zakazu nie dotyczy.'))
    }

    // --- K4: krawędź zależności jest krawędzią danych -------------------------------
    if (producenci.size > 0) {
      const osiagalne = zaleznosciPrzechodnie(nazwaKroku, zebrane)
      for (const { tekst, pole } of poleceniaKroku(efektywny)) {
        for (const [zmienna, producent] of producenci) {
          if (producent === nazwaKroku) continue
          const wzorzec = new RegExp(`\\$\\{?${zmienna}\\b`)
          if (!wzorzec.test(tekst)) continue
          if (!osiagalne.has(producent)) {
            naruszenia.push(naruszenie('K4_BRAK_DEPENDS', `${sciezka}.${pole}`,
              `Krok "${nazwaKroku}" czyta "$${zmienna}", którą publikuje krok "${producent}", ` +
              `ale nie zależy od niego (depends). Sprawdzone wykonaniem: $${zmienna} jest widoczne ` +
              'wyłącznie w krokach zależnych - bez depends krok dostaje wartość pustą i leci dalej. ' +
              'Krawędź zależności jest krawędzią danych.'))
          }
        }
      }
    }

    kroki.push({
      dag: nazwaDaga,
      id: nazwaKroku,
      sciezka,
      publikuje: publikujePlasko,
      kontrakt: wpisKontraktu?.kontrakt ?? null,
      wersja: wpisKontraktu?.wersja ?? null,
      forma: rozwiniety.zrodloSchematu?.startsWith('akcja:') ? 'A' : (schemat ? 'B' : null),
    })

    // --- sub-DAG-i ------------------------------------------------------------------
    const nazwaPoddaga = typeof krok.call === 'string' ? krok.call
      : (AKCJE_PODDAGA.has(efektywny.action) && typeof efektywny.with?.dag === 'string')
        ? efektywny.with.dag : null
    if (nazwaPoddaga) {
      if (!Object.prototype.hasOwnProperty.call(poddagi, nazwaPoddaga)) {
        naruszenia.push(naruszenie('SUBDAG_NIEZNANY', `${sciezka}`,
          `Krok "${nazwaKroku}" woła proces "${nazwaPoddaga}", którego polityka nie dostała do wglądu. ` +
          'Naruszenie kontraktu ukryte w sub-DAG-u propaguje do rodzica, więc definicja wołana ' +
          'musi przejść politykę razem z wołającą.'))
      } else {
        sprawdzJedna({ nazwa: nazwaPoddaga, zrodlo: poddagi[nazwaPoddaga], prefiks: `poddag[${nazwaPoddaga}].` })
      }
    }
  }

  function sprawdzGraf(zebrane, prefiks, nazwaDaga) {
    const wGrafie = zebrane.filter((z) => z.wGrafie)
    const nazwy = new Set(wGrafie.map((z) => z.nazwa))
    const krawedzie = new Map()
    for (const { krok, nazwa, sciezka } of wGrafie) {
      const zal = zaleznosciKroku(krok)
      krawedzie.set(nazwa, zal)
      for (const cel of zal) {
        if (!nazwy.has(cel)) {
          naruszenia.push(naruszenie('GRAF_ZALEZNOSC_NIEISTNIEJACA', `${sciezka}.depends`,
            `Krok "${nazwa}" zależy od kroku "${cel}", którego w procesie "${nazwaDaga}" nie ma.`))
        }
      }
    }

    // Cykl przechodzi lint silnika (walidacja par. 3.1) i wybucha dopiero przy starcie:
    // "failed to setup execution plan: cyclic plan detected". Łapiemy przy zapisie.
    const stan = new Map()
    const sciezkaDfs = []
    const zglosone = new Set()
    const odwiedz = (wierzcholek) => {
      stan.set(wierzcholek, 'w-trakcie')
      sciezkaDfs.push(wierzcholek)
      for (const sasiad of krawedzie.get(wierzcholek) ?? []) {
        if (!nazwy.has(sasiad)) continue
        if (stan.get(sasiad) === 'w-trakcie') {
          const od = sciezkaDfs.indexOf(sasiad)
          const cykl = [...sciezkaDfs.slice(od), sasiad].join(' -> ')
          if (!zglosone.has(cykl)) {
            zglosone.add(cykl)
            naruszenia.push(naruszenie('GRAF_CYKL', `${prefiks}steps`,
              `Cykl zależności w procesie "${nazwaDaga}": ${cykl}. Silnik przepuszcza cykl przez ` +
              'lint przy zapisie i przewraca się dopiero przy uruchomieniu ' +
              '("cyclic plan detected") - dlatego odrzucamy go tutaj.'))
          }
          continue
        }
        if (stan.get(sasiad) !== 'gotowy') odwiedz(sasiad)
      }
      sciezkaDfs.pop()
      stan.set(wierzcholek, 'gotowy')
    }
    for (const nazwa of nazwy) if (!stan.has(nazwa)) odwiedz(nazwa)
  }
}

/** Domknięcie przechodnie `depends` - K4 pyta o osiągalność, nie o bezpośrednią krawędź. */
function zaleznosciPrzechodnie(nazwaKroku, zebrane) {
  const poNazwie = new Map(zebrane.map((z) => [z.nazwa, z.krok]))
  const osiagalne = new Set()
  const stos = [...zaleznosciKroku(poNazwie.get(nazwaKroku))]
  while (stos.length > 0) {
    const biezacy = stos.pop()
    if (osiagalne.has(biezacy)) continue
    osiagalne.add(biezacy)
    const krok = poNazwie.get(biezacy)
    if (krok) stos.push(...zaleznosciKroku(krok))
  }
  return osiagalne
}

/**
 * Nazwy procesów wołanych jako sub-DAG-i. Potrzebne, żeby bramka pobrała ich definicje
 * z silnika PRZED walidacją - naruszenie ukryte w sub-DAG-u propaguje do rodzica.
 */
export function wykryjPoddagi(yamlLubObiekt) {
  const wynik = parsujDefinicje(yamlLubObiekt, 'definicja')
  if (!wynik.ok) return []
  const definicja = wynik.definicja
  const akcje = (definicja.actions && typeof definicja.actions === 'object') ? definicja.actions : {}
  const nazwy = new Set()
  for (const { krok } of zbierzKroki(definicja.steps)) {
    if (typeof krok.call === 'string') nazwy.add(krok.call)
    const efektywny = rozwinKrok(krok, akcje).krok
    if (AKCJE_PODDAGA.has(efektywny.action) && typeof efektywny.with?.dag === 'string') {
      nazwy.add(efektywny.with.dag)
    }
  }
  return [...nazwy]
}
