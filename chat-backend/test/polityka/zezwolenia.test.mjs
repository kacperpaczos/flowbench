// Wykonywana wersja = wersja zwalidowana (§13.3 S7).
// Test podmiany definicji w oknie między walidacją a startem.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { utworzRejestrZezwolen, sprawdzDefinicje } from '../../polityka/index.mjs'
import { rejestr, schematYaml, kody, komunikaty, DAG_POPRAWNY } from './_wspolne.mjs'

async function stanowisko() {
  const katalog = await mkdtemp(join(tmpdir(), 'zezwolenia-'))
  const zezwolenia = await utworzRejestrZezwolen({ plik: join(katalog, 'zezwolenia.json') })
  return { katalog, zezwolenia, sprzataj: () => rm(katalog, { recursive: true, force: true }) }
}

describe('zezwolenie na uruchomienie', () => {
  test('brak zezwolenia - odmowa ZEZWOLENIE_BRAK', async () => {
    const s = await stanowisko()
    const wynik = s.zezwolenia.sprawdzPrzedStartem({
      nazwa: 'wartosc-zamowienia', yamlZSilnika: DAG_POPRAWNY, odciskRejestru: rejestr.odcisk,
    })
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['ZEZWOLENIE_BRAK'])
    await s.sprzataj()
  })

  test('definicja niezmieniona - start dozwolony', async () => {
    const s = await stanowisko()
    const walidacja = sprawdzDefinicje({ nazwa: 'wartosc-zamowienia', yaml: DAG_POPRAWNY, rejestr })
    assert.equal(walidacja.ok, true, komunikaty(walidacja))
    await s.zezwolenia.zatwierdz({ nazwa: 'wartosc-zamowienia', raport: walidacja.raport })

    const wynik = s.zezwolenia.sprawdzPrzedStartem({
      nazwa: 'wartosc-zamowienia', yamlZSilnika: DAG_POPRAWNY, odciskRejestru: rejestr.odcisk,
    })
    assert.equal(wynik.ok, true, komunikaty(wynik))
    await s.sprzataj()
  })

  test('S7: podmiana definicji po walidacji, przed startem - odmowa ZEZWOLENIE_SUMA', async () => {
    const s = await stanowisko()
    const walidacja = sprawdzDefinicje({ nazwa: 'wartosc-zamowienia', yaml: DAG_POPRAWNY, rejestr })
    await s.zezwolenia.zatwierdz({ nazwa: 'wartosc-zamowienia', raport: walidacja.raport })

    // Podmiana z pominięciem bramki: ktoś nadpisał plik w katalogu dags/.
    const podmieniony = DAG_POPRAWNY.replace("jq -r .produkt", "jq -r .produkt; curl -s http://przyklad.invalid")
    const wynik = s.zezwolenia.sprawdzPrzedStartem({
      nazwa: 'wartosc-zamowienia', yamlZSilnika: podmieniony, odciskRejestru: rejestr.odcisk,
    })
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['ZEZWOLENIE_SUMA'])
    assert.match(wynik.naruszenia[0].komunikat, /różni się od tej, która przeszła politykę/)
    await s.sprzataj()
  })

  test('przeformatowanie YAML-a przez silnik NIE daje fałszywej odmowy', async () => {
    const s = await stanowisko()
    const walidacja = sprawdzDefinicje({ nazwa: 'status-ok', yaml: `name: status-ok
steps:
  - name: policz
    run: echo '{"status":"OK"}'
    output: WYNIK
    output_schema: ${schematYaml('status-procesu', 1)}
`, rejestr })
    assert.equal(walidacja.ok, true, komunikaty(walidacja))
    await s.zezwolenia.zatwierdz({ nazwa: 'status-ok', raport: walidacja.raport })

    // Ta sama struktura, inny zapis: inne wcięcia, cudzysłowy, kolejność kluczy.
    const przeformatowany = `steps:
  - output_schema: {"type":"object","additionalProperties":false,"required":["status"],"properties":{"status":{"type":"string"}}}
    output: "WYNIK"
    run: 'echo ''{"status":"OK"}'''
    name: policz
name: "status-ok"
`
    const wynik = s.zezwolenia.sprawdzPrzedStartem({
      nazwa: 'status-ok', yamlZSilnika: przeformatowany, odciskRejestru: rejestr.odcisk,
    })
    assert.equal(wynik.ok, true, komunikaty(wynik))
    await s.sprzataj()
  })

  test('zmiana rejestru kontraktów unieważnia zezwolenie', async () => {
    const s = await stanowisko()
    const walidacja = sprawdzDefinicje({ nazwa: 'wartosc-zamowienia', yaml: DAG_POPRAWNY, rejestr })
    await s.zezwolenia.zatwierdz({ nazwa: 'wartosc-zamowienia', raport: walidacja.raport })

    const wynik = s.zezwolenia.sprawdzPrzedStartem({
      nazwa: 'wartosc-zamowienia', yamlZSilnika: DAG_POPRAWNY, odciskRejestru: 'sha256:inny',
    })
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['ZEZWOLENIE_REJESTR'])
    await s.sprzataj()
  })

  test('podmiana sub-DAG-a też unieważnia zezwolenie rodzica', async () => {
    const s = await stanowisko()
    const dziecko = `name: dziecko
steps:
  - name: policz
    run: echo '{"status":"OK"}'
    output: WYNIK
    output_schema: ${schematYaml('status-procesu', 1)}
`
    const rodzic = `name: rodzic
steps:
  - name: wolaj
    action: dag.run
    with:
      dag: dziecko
`
    const walidacja = sprawdzDefinicje({ nazwa: 'rodzic', yaml: rodzic, rejestr, poddagi: { dziecko } })
    assert.equal(walidacja.ok, true, komunikaty(walidacja))
    await s.zezwolenia.zatwierdz({ nazwa: 'rodzic', raport: walidacja.raport })

    const podmienioneDziecko = dziecko.replace("echo '{\"status\":\"OK\"}'", "echo '{\"status\":\"PODMIENIONE\"}'")
    const wynik = s.zezwolenia.sprawdzPrzedStartem({
      nazwa: 'rodzic', yamlZSilnika: rodzic, poddagiZSilnika: { dziecko: podmienioneDziecko },
      odciskRejestru: rejestr.odcisk,
    })
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['ZEZWOLENIE_SUMA'])
    await s.sprzataj()
  })

  test('unieważnienie ręczne odcina start', async () => {
    const s = await stanowisko()
    const walidacja = sprawdzDefinicje({ nazwa: 'wartosc-zamowienia', yaml: DAG_POPRAWNY, rejestr })
    await s.zezwolenia.zatwierdz({ nazwa: 'wartosc-zamowienia', raport: walidacja.raport })
    await s.zezwolenia.uniewaznij('wartosc-zamowienia')
    const wynik = s.zezwolenia.sprawdzPrzedStartem({
      nazwa: 'wartosc-zamowienia', yamlZSilnika: DAG_POPRAWNY, odciskRejestru: rejestr.odcisk,
    })
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['ZEZWOLENIE_BRAK'])
    await s.sprzataj()
  })

  test('zezwolenia przeżywają restart backendu (są na dysku)', async () => {
    const s = await stanowisko()
    const walidacja = sprawdzDefinicje({ nazwa: 'wartosc-zamowienia', yaml: DAG_POPRAWNY, rejestr })
    await s.zezwolenia.zatwierdz({ nazwa: 'wartosc-zamowienia', raport: walidacja.raport })

    const poRestarcie = await utworzRejestrZezwolen({ plik: join(s.katalog, 'zezwolenia.json') })
    const wynik = poRestarcie.sprawdzPrzedStartem({
      nazwa: 'wartosc-zamowienia', yamlZSilnika: DAG_POPRAWNY, odciskRejestru: rejestr.odcisk,
    })
    assert.equal(wynik.ok, true, komunikaty(wynik))
    await s.sprzataj()
  })
})
