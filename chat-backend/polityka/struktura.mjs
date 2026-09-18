// Normalizacja sparsowanej definicji. Wszystko, co niżej, pracuje na OBIEKCIE,
// nie na tekście pliku - wymóg z decyzji architektonicznej v3 par. 4.1a.
//
// Dagu dopuszcza kilka zapisów tej samej rzeczy (lista kroków, mapa kroków, skrót
// stringiem, zagnieżdżona lista = kroki równoległe, cialo `foreach`). Polityka, która
// zna tylko jeden z nich, ma dziurę wielkości pozostałych.

import { parse as parseYaml } from 'yaml'
import { naruszenie } from './bledy.mjs'

export function parsujDefinicje(yamlLubObiekt, pole = 'definicja') {
  if (yamlLubObiekt && typeof yamlLubObiekt === 'object') return { ok: true, definicja: yamlLubObiekt }
  if (typeof yamlLubObiekt !== 'string') {
    return { ok: false, naruszenie: naruszenie('YAML_NIEPOPRAWNY', pole,
      'Definicja musi być tekstem YAML albo obiektem.') }
  }
  let definicja
  try {
    definicja = parseYaml(yamlLubObiekt)
  } catch (e) {
    return { ok: false, naruszenie: naruszenie('YAML_NIEPOPRAWNY', pole,
      `Definicja nie jest poprawnym YAML-em: ${e.message}`) }
  }
  if (definicja === null || typeof definicja !== 'object' || Array.isArray(definicja)) {
    return { ok: false, naruszenie: naruszenie('YAML_NIEPOPRAWNY', pole,
      'Definicja musi być dokumentem YAML z polami na najwyższym poziomie (mapą), nie listą ani wartością prostą.') }
  }
  return { ok: true, definicja }
}

/**
 * Spłaszcza `steps:` do listy {krok, sciezka, nazwa, wGrafie}.
 * `wGrafie: false` dostają kroki z ciała `foreach` - nie są wierzchołkami grafu DAG-a,
 * ale kontrakt i zakaz drugiego kanału obowiązują je tak samo.
 */
export function zbierzKroki(steps, sciezka = 'steps') {
  const wynik = []
  const dodaj = (krok, sciezkaKroku, wGrafie) => {
    if (typeof krok === 'string') {
      wynik.push({ krok: { run: krok }, sciezka: sciezkaKroku, nazwa: null, wGrafie, skrot: true })
      return
    }
    if (!krok || typeof krok !== 'object' || Array.isArray(krok)) return
    const nazwa = typeof krok.name === 'string' ? krok.name
      : typeof krok.id === 'string' ? krok.id : null
    wynik.push({ krok, sciezka: sciezkaKroku, nazwa, wGrafie, skrot: false })
    const cialo = krok.foreach && typeof krok.foreach === 'object' ? krok.foreach.steps : null
    if (Array.isArray(cialo)) {
      cialo.forEach((podkrok, j) => dodaj(podkrok, `${sciezkaKroku}.foreach.steps[${j}]`, false))
    }
  }

  if (Array.isArray(steps)) {
    steps.forEach((pozycja, i) => {
      if (Array.isArray(pozycja)) {
        // zagnieżdżona lista = kroki równoległe
        pozycja.forEach((podkrok, j) => dodaj(podkrok, `${sciezka}[${i}][${j}]`, true))
        return
      }
      dodaj(pozycja, `${sciezka}[${i}]`, true)
    })
  } else if (steps && typeof steps === 'object') {
    // mapa: klucz jest nazwą kroku
    for (const klucz of Object.keys(steps)) {
      const krok = steps[klucz]
      const sciezkaKroku = `${sciezka}.${klucz}`
      if (krok && typeof krok === 'object' && !Array.isArray(krok)) {
        wynik.push({ krok, sciezka: sciezkaKroku, nazwa: krok.name ?? krok.id ?? klucz, wGrafie: true, skrot: false })
        const cialo = krok.foreach && typeof krok.foreach === 'object' ? krok.foreach.steps : null
        if (Array.isArray(cialo)) {
          cialo.forEach((podkrok, j) => dodaj(podkrok, `${sciezkaKroku}.foreach.steps[${j}]`, false))
        }
      }
    }
  }

  // Kroki bez nazwy własnej dostają nazwę zastępczą - potrzebną wyłącznie do komunikatów.
  return wynik.map((w, i) => ({ ...w, nazwa: w.nazwa ?? `#${i + 1}` }))
}

/** Wszystkie łańcuchy znaków w strukturze, ze ścieżką - podstawa kontroli K5. */
export function* lancuchy(wartosc, sciezka = '') {
  if (typeof wartosc === 'string') { yield { tekst: wartosc, sciezka }; return }
  if (Array.isArray(wartosc)) {
    for (let i = 0; i < wartosc.length; i += 1) yield* lancuchy(wartosc[i], `${sciezka}[${i}]`)
    return
  }
  if (wartosc && typeof wartosc === 'object') {
    for (const klucz of Object.keys(wartosc)) {
      yield* lancuchy(wartosc[klucz], sciezka ? `${sciezka}.${klucz}` : klucz)
    }
  }
}

/** `depends` bywa stringiem albo listą; `dependencies` to starszy alias. */
export function zaleznosciKroku(krok) {
  const zebrane = []
  for (const pole of ['depends', 'dependencies']) {
    const wartosc = krok?.[pole]
    if (typeof wartosc === 'string') zebrane.push(wartosc)
    else if (Array.isArray(wartosc)) zebrane.push(...wartosc.filter((d) => typeof d === 'string'))
  }
  return zebrane
}

/** `continue_on` bywa skrótem-stringiem ('skipped'/'failed') albo obiektem. */
export function normalizujContinueOn(wartosc) {
  if (wartosc === undefined || wartosc === null) return null
  if (typeof wartosc === 'string') {
    if (wartosc === 'skipped') return { skipped: true }
    if (wartosc === 'failed') return { failure: true }
    return { nieznane: wartosc }
  }
  if (typeof wartosc === 'object' && !Array.isArray(wartosc)) return wartosc
  return { nieznane: wartosc }
}
