// Wspólne dla testów polityki: rejestr kontraktów z repozytorium i gotowe fragmenty YAML.
// Schematy wklejane w definicje MUSZĄ być literalnie tymi z katalogu kontrakty/ - o to
// właśnie chodzi w wymaganiu "kontrakty wersjonowane poza definicją agenta".

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { wczytajRejestr } from '../../polityka/index.mjs'

const tutaj = dirname(fileURLToPath(import.meta.url))
export const KORZEN = join(tutaj, '..', '..', '..')
export const KATALOG_KONTRAKTOW = join(KORZEN, 'kontrakty')

export const rejestr = await wczytajRejestr(KATALOG_KONTRAKTOW)

/** Schemat kontraktu jako YAML wcięty do wklejenia pod `output_schema:`. */
export function schematYaml(kontrakt, wersja, wciecie = '      ') {
  const plik = join(KATALOG_KONTRAKTOW, kontrakt, `v${wersja}.json`)
  const { schemat } = JSON.parse(readFileSync(plik, 'utf8'))
  return JSON.stringify(schemat, null, 2)
    .split('\n').map((l, i) => (i === 0 ? l : wciecie + l)).join('\n')
}

export function kody(wynik) {
  return (wynik.naruszenia ?? []).map((n) => n.kod)
}

export function komunikaty(wynik) {
  return (wynik.naruszenia ?? []).map((n) => `[${n.kod}] ${n.pole}: ${n.komunikat}`).join('\n')
}

/** Poprawny proces odniesienia: jeden krok publikujący wynik, jeden odbierający. */
export const DAG_POPRAWNY = `name: wartosc-zamowienia
description: Wartość zamówienia
steps:
  - name: policz
    run: |
      echo 'licze pozycje' >&2
      echo '{"produkt":"Kabel HDMI 2.1","ilosc":3,"netto":149.97,"brutto":184.46}'
    output: WYNIK
    output_schema: ${schematYaml('wartosc-zamowienia', 1)}
  - name: pokaz
    depends: [policz]
    run: printf '%s' "$WYNIK" | jq -r .produkt
`

/** Rozgałęzienie warunkowe + continue_on: skipped na obu gałęziach + fan-in. */
export const DAG_ROZGALEZIENIE = `name: srednia-z-galezi
description: Średnia temperatura z gałęzi, które doszły
steps:
  - name: pomiar-a
    run: |
      echo '{"miasto":"Warszawa","temperatura":18.5}'
    output: POMIAR_A
    output_schema: ${schematYaml('pomiar-temperatury', 1)}
    continue_on:
      skipped: true
  - name: pomiar-b
    preconditions:
      - condition: "echo pomin"
        expected: "uruchom"
    run: |
      echo '{"miasto":"Kraków","temperatura":21.25}'
    output: POMIAR_B
    output_schema: ${schematYaml('pomiar-temperatury', 1)}
    continue_on:
      skipped: true
  - name: srednia
    depends: [pomiar-a, pomiar-b]
    run: |
      {
        if [ -n "\${POMIAR_A:-}" ]; then printf '%s\\n' "$POMIAR_A"; fi
        if [ -n "\${POMIAR_B:-}" ]; then printf '%s\\n' "$POMIAR_B"; fi
      } | jq -s -c '{liczbaPomiarow: length, srednia: (if length > 0 then ((map(.temperatura) | add) / length) else 0 end), galezie: map(.miasto)}'
    output: SREDNIA
    output_schema: ${schematYaml('srednia-temperatur', 1)}
`
