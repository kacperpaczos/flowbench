// Kanoniczna postać i odcisk. Używane w dwóch miejscach:
//  - tożsamość kontraktu (czy ten schemat JEST zatwierdzonym schematem),
//  - suma kontrolna definicji (czy wykonywana wersja to wersja zwalidowana).
//
// Kanonizujemy STRUKTURĘ, nie bajty. Silnik przy zapisie potrafi przeformatować YAML
// (kolejność kluczy, cytowanie, wcięcia) - gdyby suma szła z bajtów, każdy zapis dawałby
// fałszywą odmowę. Zmiana treści zmienia odcisk zawsze.

import { createHash } from 'node:crypto'

/** Rekurencyjne sortowanie kluczy. Tablice zachowują kolejność - w YAML-u jest znacząca. */
export function kanoniczny(wartosc) {
  if (Array.isArray(wartosc)) return wartosc.map(kanoniczny)
  if (wartosc && typeof wartosc === 'object') {
    const wynik = {}
    for (const klucz of Object.keys(wartosc).sort()) {
      const v = wartosc[klucz]
      if (v === undefined) continue
      wynik[klucz] = kanoniczny(v)
    }
    return wynik
  }
  return wartosc
}

export function odcisk(wartosc) {
  return `sha256:${createHash('sha256').update(JSON.stringify(kanoniczny(wartosc))).digest('hex')}`
}
