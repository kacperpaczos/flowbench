// Sprawdzenie krzyżowe: czy procesy, które naprawdę leżą w repozytorium (katalog dags/,
// własność T4), przechodzą politykę kontraktu.
//
// Ten test pilnuje spójności dwóch katalogów, które celowo są rozdzielone: definicji
// procesów i zatwierdzonych kontraktów. Jeśli padnie po zmianie schematu w dags/, to NIE
// jest awaria testu - to jest właśnie mechanizm, o który chodzi: zmiana kontraktu ma być
// świadomą zmianą pliku w kontrakty/, widoczną w Gicie. Komunikat mówi, co zrobić.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { sprawdzDefinicje, opiszNaruszenia } from '../../polityka/index.mjs'
import { rejestr, KORZEN } from './_wspolne.mjs'

const KATALOG_DAGOW = join(KORZEN, 'dags')
const brakKatalogu = !existsSync(KATALOG_DAGOW)

describe('procesy z katalogu dags/', { skip: brakKatalogu && 'brak katalogu dags/' }, () => {
  const pliki = brakKatalogu ? [] : readdirSync(KATALOG_DAGOW).filter((p) => p.endsWith('.yaml'))
  const zrodla = Object.fromEntries(pliki.map((p) => [
    p.replace(/\.yaml$/, ''), readFileSync(join(KATALOG_DAGOW, p), 'utf8'),
  ]))

  test('katalog nie jest pusty', () => {
    assert.ok(pliki.length > 0, 'w dags/ nie ma ani jednej definicji')
  })

  for (const nazwa of Object.keys(zrodla)) {
    test(`"${nazwa}" przechodzi politykę kontraktu`, () => {
      const poddagi = { ...zrodla }
      delete poddagi[nazwa]
      const wynik = sprawdzDefinicje({ nazwa, yaml: zrodla[nazwa], rejestr, poddagi })
      assert.equal(wynik.ok, true,
        `Proces "${nazwa}" nie przechodzi polityki:\n${opiszNaruszenia(wynik.naruszenia)}\n\n` +
        'Jeśli schemat wyniku zmienił się świadomie, zatwierdź go jako nową wersję kontraktu:\n' +
        `  node chat-backend/polityka/narzedzia/zatwierdz-kontrakt.mjs --zapisz dags/${nazwa}.yaml\n` +
        'i zacommituj powstałe pliki w kontrakty/ - zmiana kontraktu ma być widoczna w Gicie.')
    })
  }
})
