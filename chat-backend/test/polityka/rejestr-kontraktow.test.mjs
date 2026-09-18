// Kontrakty wersjonowane POZA definicją agenta - §4.1a "Gdzie mieszkają kontrakty".
// Sedno: zmiana kontraktu to zmiana pliku w kontrakty/, a nie efekt uboczny edycji DAG-a.

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { wczytajRejestr, sprawdzDefinicje, BladRejestru } from '../../polityka/index.mjs'
import { rejestr, schematYaml, kody } from './_wspolne.mjs'

async function tymczasowyRejestr(pliki) {
  const katalog = await mkdtemp(join(tmpdir(), 'kontrakty-'))
  for (const [sciezka, tresc] of Object.entries(pliki)) {
    const pelna = join(katalog, sciezka)
    await mkdir(join(pelna, '..'), { recursive: true })
    await writeFile(pelna, typeof tresc === 'string' ? tresc : JSON.stringify(tresc, null, 2))
  }
  return katalog
}

describe('rejestr z repozytorium', () => {
  test('wczytuje wszystkie zatwierdzone wersje', () => {
    const lista = rejestr.lista()
    assert.ok(lista.length >= 6, `wczytano ${lista.length}`)
    assert.ok(lista.some((w) => w.kontrakt === 'wartosc-zamowienia' && w.wersja === 1))
    assert.ok(lista.some((w) => w.kontrakt === 'wartosc-zamowienia' && w.wersja === 2))
  })

  test('odcisk rejestru jest stabilny między wczytaniami', async () => {
    const drugi = await wczytajRejestr(rejestr.katalog)
    assert.equal(drugi.odcisk, rejestr.odcisk)
  })

  test('nazwa akcji dla formy A to <kontrakt>-v<N>', () => {
    assert.equal(rejestr.znajdz('wartosc-zamowienia', 1).nazwaAkcji, 'wartosc-zamowienia-v1')
  })

  test('akcjeBazowe() dają gotowy blok actions: do base.yaml', () => {
    const akcje = rejestr.akcjeBazowe()
    const akcja = akcje['status-procesu-v1']
    assert.ok(akcja, 'brak akcji status-procesu-v1')
    assert.deepEqual(akcja.output_schema, rejestr.znajdz('status-procesu', 1).schemat)
    assert.deepEqual(akcja.input_schema.required, ['script'])
    assert.equal(akcja.template.run, '{{ .input.script }}')
  })
})

describe('rejestr odrzuca katalog, który nie jest rejestrem', () => {
  test('pole "kontrakt" niezgodne z nazwą katalogu', async () => {
    const katalog = await tymczasowyRejestr({
      'abc/v1.json': { kontrakt: 'inny', wersja: 1, schemat: { type: 'object' } },
    })
    await assert.rejects(() => wczytajRejestr(katalog), BladRejestru)
    await rm(katalog, { recursive: true, force: true })
  })

  test('pole "wersja" niezgodne z nazwą pliku', async () => {
    const katalog = await tymczasowyRejestr({
      'abc/v1.json': { kontrakt: 'abc', wersja: 7, schemat: { type: 'object' } },
    })
    await assert.rejects(() => wczytajRejestr(katalog), BladRejestru)
    await rm(katalog, { recursive: true, force: true })
  })

  test('dwie wersje o identycznym schemacie - dopasowanie byłoby niejednoznaczne', async () => {
    const schemat = { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string' } } }
    const katalog = await tymczasowyRejestr({
      'abc/v1.json': { kontrakt: 'abc', wersja: 1, schemat },
      'abc/v2.json': { kontrakt: 'abc', wersja: 2, schemat },
    })
    await assert.rejects(() => wczytajRejestr(katalog), /identyczny/)
    await rm(katalog, { recursive: true, force: true })
  })

  test('schemat, który nie jest poprawnym JSON Schema', async () => {
    const katalog = await tymczasowyRejestr({
      'abc/v1.json': { kontrakt: 'abc', wersja: 1, schemat: { type: 'object', properties: { a: { type: 'nie-ma-takiego-typu' } } } },
    })
    await assert.rejects(() => wczytajRejestr(katalog), BladRejestru)
    await rm(katalog, { recursive: true, force: true })
  })
})

describe('zmiana kontraktu nie legalizuje po cichu błędnego wyniku', () => {
  let katalog

  before(async () => {
    katalog = await tymczasowyRejestr({
      'wynik/v1.json': {
        kontrakt: 'wynik', wersja: 1, opis: 'Wynik z liczbą.',
        schemat: {
          type: 'object', additionalProperties: false, required: ['suma'],
          properties: { suma: { type: 'number' } },
        },
      },
    })
  })
  after(() => rm(katalog, { recursive: true, force: true }))

  const dag = (typSumy) => `name: proces
steps:
  - name: policz
    run: echo '{"suma":1}'
    output: WYNIK
    output_schema:
      type: object
      additionalProperties: false
      required: [suma]
      properties:
        suma: {type: ${typSumy}}
`

  test('osłabienie typu w DAG-u jest odrzucane, choć sam schemat jest poprawny', async () => {
    const r = await wczytajRejestr(katalog)
    const wynik = sprawdzDefinicje({ nazwa: 'proces', yaml: dag('string'), rejestr: r })
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['K3_KONTRAKT_ROZNICA_TYPU'])
  })

  test('po dodaniu v2 z typem string ten sam DAG przechodzi - ale zmiana jest w pliku, nie w DAG-u', async () => {
    await writeFile(join(katalog, 'wynik', 'v2.json'), JSON.stringify({
      kontrakt: 'wynik', wersja: 2, opis: 'Wynik z sumą jako tekstem.',
      schemat: {
        type: 'object', additionalProperties: false, required: ['suma'],
        properties: { suma: { type: 'string' } },
      },
    }))
    const r = await wczytajRejestr(katalog)
    const wynik = sprawdzDefinicje({ nazwa: 'proces', yaml: dag('string'), rejestr: r })
    assert.equal(wynik.ok, true)
    assert.deepEqual(wynik.raport.uzyteKontrakty, [{ kontrakt: 'wynik', wersja: 2 }])
    // i - co najważniejsze - odcisk rejestru się zmienił, więc stare zezwolenia padają
    assert.notEqual(r.odcisk, (await wczytajRejestr(rejestr.katalog)).odcisk)
  })
})

describe('forma B: schemat w DAG-u musi być literalnie schematem z rejestru', () => {
  test('przestawienie kolejności kluczy nie psuje dopasowania (kanonizacja)', () => {
    const yaml = `name: status-ok
steps:
  - name: policz
    run: echo '{"status":"OK"}'
    output: WYNIK
    output_schema:
      required: [status]
      properties:
        status: {type: string}
      additionalProperties: false
      type: object
`
    const wynik = sprawdzDefinicje({ nazwa: 'status-ok', yaml, rejestr })
    assert.equal(wynik.ok, true, JSON.stringify(wynik.naruszenia))
  })

  test('usunięcie jednego pola z required - odmowa', () => {
    const schemat = JSON.parse(schematYaml('wartosc-zamowienia', 1))
    schemat.required = schemat.required.slice(0, 2)
    const yaml = `name: wartosc-zamowienia
steps:
  - name: policz
    run: echo '{}'
    output: WYNIK
    output_schema: ${JSON.stringify(schemat)}
`
    const wynik = sprawdzDefinicje({ nazwa: 'wartosc-zamowienia', yaml, rejestr })
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['K3_KONTRAKT_NIEZATWIERDZONY'])
  })
})
