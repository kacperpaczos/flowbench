// Rejestr zatwierdzonych kontraktów - decyzja architektoniczna v3 par. 4.1a
// "Gdzie mieszkają kontrakty".
//
// Schematy żyją w katalogu kontrakty/ w repozytorium, każdy z wersją. Definicja DAG-a
// odwołuje się do nich, a nie niesie ich treści. Samo istnienie output_schema: w DAG-u
// NIE spełnia wymagania - polityka sprawdza, że użyty schemat JEST zatwierdzonym
// schematem w zatwierdzonej wersji. Zmiana kontraktu to zmiana pliku w kontrakty/,
// widoczna w Gicie, a nie efekt uboczny edycji DAG-a przez model.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { BladRejestru } from './bledy.mjs'
import { kanoniczny, odcisk } from './kanonizacja.mjs'

const WZORZEC_ID_KONTRAKTU = /^[a-z0-9][a-z0-9-]{0,38}$/
const WZORZEC_PLIKU = /^v([1-9][0-9]{0,3})\.json$/

/** Ajv służy do KOMPILACJI schematu - sprawdzenia, że to w ogóle poprawny JSON Schema.
 *  Nie piszemy własnej implementacji JSON Schema (zakaz z zakresu zadania). */
function utworzAjv() {
  const ajv = new Ajv({ strict: false, allErrors: true, validateSchema: true })
  addFormats(ajv)
  return ajv
}

export function nazwaAkcjiDlaKontraktu(kontrakt, wersja) {
  return `${kontrakt}-v${wersja}`
}

/** Zbiór nazw właściwości - służy wyłącznie do DIAGNOSTYKI (który kontrakt miał na myśli). */
function kluczWlasciwosci(schemat) {
  const wlasciwosci = schemat && typeof schemat === 'object' ? schemat.properties : null
  if (!wlasciwosci || typeof wlasciwosci !== 'object') return ''
  return Object.keys(wlasciwosci).sort().join(',')
}

export async function wczytajRejestr(katalog) {
  const ajv = utworzAjv()
  const wpisy = []

  let podkatalogi
  try {
    podkatalogi = await readdir(katalog, { withFileTypes: true })
  } catch (e) {
    throw new BladRejestru(`Nie da się odczytać katalogu kontraktów: ${e.message}`, katalog)
  }

  for (const wpis of podkatalogi.filter((d) => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const idKontraktu = wpis.name
    if (!WZORZEC_ID_KONTRAKTU.test(idKontraktu)) {
      throw new BladRejestru(
        `Katalog kontraktu "${idKontraktu}" ma nazwę spoza ${WZORZEC_ID_KONTRAKTU.source}.`,
        join(katalog, idKontraktu))
    }
    const pliki = (await readdir(join(katalog, idKontraktu))).filter((p) => p.endsWith('.json')).sort()
    for (const plik of pliki) {
      const sciezka = join(katalog, idKontraktu, plik)
      const dopasowanie = WZORZEC_PLIKU.exec(plik)
      if (!dopasowanie) {
        throw new BladRejestru(
          `Plik kontraktu "${plik}" ma nazwę spoza wzorca v<N>.json.`, sciezka)
      }
      const wersjaZNazwy = Number(dopasowanie[1])
      let tresc
      try {
        tresc = JSON.parse(await readFile(sciezka, 'utf8'))
      } catch (e) {
        throw new BladRejestru(`Plik kontraktu nie jest poprawnym JSON-em: ${e.message}`, sciezka)
      }
      if (tresc.kontrakt !== idKontraktu) {
        throw new BladRejestru(
          `Pole "kontrakt" ("${tresc.kontrakt}") nie zgadza się z katalogiem ("${idKontraktu}").`, sciezka)
      }
      if (tresc.wersja !== wersjaZNazwy) {
        throw new BladRejestru(
          `Pole "wersja" (${tresc.wersja}) nie zgadza się z nazwą pliku (v${wersjaZNazwy}).`, sciezka)
      }
      if (!tresc.schemat || typeof tresc.schemat !== 'object') {
        throw new BladRejestru('Brak pola "schemat" albo nie jest obiektem.', sciezka)
      }
      try {
        ajv.compile(tresc.schemat)
      } catch (e) {
        throw new BladRejestru(`Schemat nie kompiluje się jako JSON Schema: ${e.message}`, sciezka)
      }
      wpisy.push({
        kontrakt: idKontraktu,
        wersja: wersjaZNazwy,
        opis: String(tresc.opis ?? ''),
        zatwierdzony: String(tresc.zatwierdzony ?? ''),
        schemat: tresc.schemat,
        odciskSchematu: odcisk(tresc.schemat),
        kluczWlasciwosci: kluczWlasciwosci(tresc.schemat),
        nazwaAkcji: nazwaAkcjiDlaKontraktu(idKontraktu, wersjaZNazwy),
        plik: sciezka,
      })
    }
  }

  const poOdcisku = new Map()
  const poNazwieAkcji = new Map()
  for (const w of wpisy) {
    if (poOdcisku.has(w.odciskSchematu)) {
      const inny = poOdcisku.get(w.odciskSchematu)
      // Dwa identyczne schematy pod różnymi wersjami dają niejednoznaczne dopasowanie
      // formy B (inline) - polityka nie umiałaby powiedzieć, która wersja jest w użyciu.
      throw new BladRejestru(
        `Kontrakt ${w.kontrakt} v${w.wersja} ma schemat identyczny z ` +
        `${inny.kontrakt} v${inny.wersja}; wersje muszą się różnić treścią schematu.`, w.plik)
    }
    poOdcisku.set(w.odciskSchematu, w)
    poNazwieAkcji.set(w.nazwaAkcji, w)
  }

  const odciskRejestru = odcisk(wpisy.map((w) => ({
    kontrakt: w.kontrakt, wersja: w.wersja, schemat: kanoniczny(w.schemat),
  })))

  return {
    katalog,
    odcisk: odciskRejestru,
    lista: () => wpisy.map(({ schemat, plik, kluczWlasciwosci: _k, ...reszta }) => reszta),
    znajdz: (kontrakt, wersja) =>
      wpisy.find((w) => w.kontrakt === kontrakt && w.wersja === Number(wersja)) ?? null,
    znajdzPoAkcji: (nazwaAkcji) => poNazwieAkcji.get(nazwaAkcji) ?? null,
    dopasujSchemat: (schemat) => poOdcisku.get(odcisk(schemat)) ?? null,
    /** Diagnostyka: kontrakty o tym samym zbiorze nazw właściwości - "chodziło ci o ten?" */
    kandydaciPoKsztalcie: (schemat) => {
      const klucz = kluczWlasciwosci(schemat)
      if (klucz === '') return []
      return wpisy.filter((w) => w.kluczWlasciwosci === klucz)
    },
    /** Blok actions: do base.yaml silnika - natywna dźwignia z audyt-dagu-walidacja.md par. 3.5. */
    akcjeBazowe: () => Object.fromEntries(wpisy.map((w) => [w.nazwaAkcji, {
      description: w.opis || `Kontrakt ${w.kontrakt} v${w.wersja}`,
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['script'],
        properties: { script: { type: 'string' } },
      },
      output_schema: w.schemat,
      template: { run: '{{ .input.script }}' },
    }])),
  }
}
