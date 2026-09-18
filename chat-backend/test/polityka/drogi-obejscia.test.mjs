// Drogi obejścia bramki - każda z tabeli w raporcie ma tu swoje sprawdzenie
// albo jawne stwierdzenie, że zostaje otwarta.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  utworzBramke, utworzRejestrZezwolen, sprawdzDefinicje, utworzKlienta,
} from '../../polityka/index.mjs'
import { rejestr, schematYaml, kody, komunikaty, DAG_POPRAWNY } from './_wspolne.mjs'

function atrapaSilnika() {
  const dagi = new Map()
  const wywolania = []
  return {
    dagi,
    wywolania,
    podmienNaDysku: (nazwa, spec) => dagi.set(nazwa, spec),
    dane: (x) => x,
    async odczytaj(a) {
      wywolania.push(['odczytaj', a])
      if (a.target === 'dag_spec') return dagi.get(a.name) ?? null
      return {}
    },
    async zmien(a) {
      wywolania.push(['zmien', a])
      if (a.mode === 'apply') dagi.set(a.name, a.spec)
      return { applied: a.mode === 'apply', valid: true, errors: [] }
    },
    async wykonaj(a) {
      wywolania.push(['wykonaj', a])
      return { action: a.action, dagName: a.name, dagRunId: 'RUN1' }
    },
    async pobierzSpec(nazwa) { return dagi.get(nazwa) ?? null },
  }
}

async function stanowisko(dodatkowe = {}) {
  const katalog = await mkdtemp(join(tmpdir(), 'obejscia-'))
  const klient = atrapaSilnika()
  const zezwolenia = await utworzRejestrZezwolen({ plik: join(katalog, 'z.json') })
  const bramka = utworzBramke({ klient, rejestr, zezwolenia, ...dodatkowe })
  const wolaj = (nazwa, argumenty) => bramka.obsluzJsonRpc(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: nazwa, arguments: argumenty } },
  ).then((o) => o.result)
  return { klient, zezwolenia, bramka, wolaj, sprzataj: () => rm(katalog, { recursive: true, force: true }) }
}

describe('obejście: wykonanie definicji podanej wprost (targetType=inline_spec)', () => {
  test('process_run odrzuca targetType od wołającego', async () => {
    const s = await stanowisko()
    await s.wolaj('process_write', { name: 'wartosc-zamowienia', spec: DAG_POPRAWNY })
    const odp = await s.wolaj('process_run', {
      name: 'wartosc-zamowienia', action: 'start', targetType: 'inline_spec',
    })
    assert.equal(odp.isError, true)
    assert.match(odp.content[0].text, /omijaloby zapis/)
    await s.sprzataj()
  })

  test('process_run odrzuca podanie spec', async () => {
    const s = await stanowisko()
    await s.wolaj('process_write', { name: 'wartosc-zamowienia', spec: DAG_POPRAWNY })
    const odp = await s.wolaj('process_run', {
      name: 'wartosc-zamowienia', action: 'start', spec: 'name: cokolwiek\nsteps: []\n',
    })
    assert.equal(odp.isError, true)
    await s.sprzataj()
  })

  test('do silnika idą wyłącznie pola z listy dozwolonych', async () => {
    const s = await stanowisko()
    await s.wolaj('process_write', { name: 'wartosc-zamowienia', spec: DAG_POPRAWNY })
    await s.wolaj('process_run', {
      name: 'wartosc-zamowienia', action: 'start', wait: true, cokolwiekZlego: 'X',
    })
    const [, argumenty] = s.klient.wywolania.findLast(([co]) => co === 'wykonaj')
    assert.equal(argumenty.targetType, 'dag')
    assert.equal(argumenty.cokolwiekZlego, undefined)
    assert.equal(argumenty.wait, true)
    await s.sprzataj()
  })
})

describe('obejście: harmonogram startuje poza bramką', () => {
  test('definicja z schedule: - odmowa HARMONOGRAM_POZA_BRAMKA', () => {
    const yaml = `name: co-godzine
schedule: "0 * * * *"
${DAG_POPRAWNY.split('\n').slice(2).join('\n')}`
    const wynik = sprawdzDefinicje({ nazwa: 'co-godzine', yaml, rejestr })
    assert.equal(wynik.ok, false)
    assert.ok(kody(wynik).includes('HARMONOGRAM_POZA_BRAMKA'), komunikaty(wynik))
    assert.match(komunikaty(wynik), /nie przechodzi przez kontrolę sumy kontrolnej/)
  })

  test('harmonogram w sub-DAG-u też jest widziany', () => {
    const dziecko = `name: dziecko
schedule: "@daily"
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
    const wynik = sprawdzDefinicje({ nazwa: 'rodzic', yaml: rodzic, rejestr, poddagi: { dziecko } })
    assert.equal(wynik.ok, false)
    assert.ok(kody(wynik).includes('HARMONOGRAM_POZA_BRAMKA'), komunikaty(wynik))
  })
})

describe('obejście: drugi kanał ukryty w obsłudze cyklu życia', () => {
  test('handler_on.failure z zapisem do $DAGU_OUTPUT_FILE - odmowa', () => {
    const yaml = `name: uchwyt
handler_on:
  failure:
    name: sprzatanie
    run: echo 'RESULT={"x":1}' >> "$DAGU_OUTPUT_FILE"
${DAG_POPRAWNY.split('\n').slice(2).join('\n')}`
    const wynik = sprawdzDefinicje({ nazwa: 'uchwyt', yaml, rejestr })
    assert.equal(wynik.ok, false)
    assert.ok(kody(wynik).includes('K5_OUTPUT_FILE'), komunikaty(wynik))
    assert.match(komunikaty(wynik), /handler_on\.failure/)
  })

  test('handler_on publikujący wynik bez kontraktu - odmowa', () => {
    const yaml = `name: uchwyt
handler_on:
  success:
    name: raport
    run: echo '{"status":"OK"}'
    output: RAPORT
${DAG_POPRAWNY.split('\n').slice(2).join('\n')}`
    const wynik = sprawdzDefinicje({ nazwa: 'uchwyt', yaml, rejestr })
    assert.equal(wynik.ok, false)
    assert.ok(kody(wynik).includes('K3_BRAK_SCHEMATU'), komunikaty(wynik))
  })
})

describe('obejście: podmiana pliku bazowego silnika', () => {
  const bazaZKontraktem = `actions:
  wartosc-zamowienia-v1:
    input_schema: {type: object, required: [script], properties: {script: {type: string}}}
    output_schema: ${JSON.stringify(JSON.parse(schematYaml('wartosc-zamowienia', 1)))}
    template: {run: "{{ .input.script }}"}
`
  const dagFormaA = `name: forma-a
steps:
  - name: policz
    action: wartosc-zamowienia-v1
    with:
      script: echo '{"produkt":"X","ilosc":1,"netto":1,"brutto":1}'
    output: WYNIK
`

  test('gdy T1 poda funkcję odczytu, podmiana base.yaml jest wykrywana przy starcie', async () => {
    let baza = bazaZKontraktem
    const s = await stanowisko({ odczytajPlikBazowy: async () => baza })

    const zapis = await s.wolaj('process_write', { name: 'forma-a', spec: dagFormaA })
    assert.equal(zapis.isError, false, zapis.content[0].text)

    const przed = await s.wolaj('process_run', { name: 'forma-a', action: 'start' })
    assert.equal(przed.isError, false, przed.content[0].text)

    // Krok (root) nadpisuje base.yaml i kasuje kontrakt - audyt bezpieczeństwa P3.
    baza = `actions:
  wartosc-zamowienia-v1:
    input_schema: {type: object, required: [script], properties: {script: {type: string}}}
    template: {run: "{{ .input.script }}"}
`
    const po = await s.wolaj('process_run', { name: 'forma-a', action: 'start' })
    assert.equal(po.isError, true, 'podmiana pliku bazowego nie została wykryta')
    assert.match(po.content[0].text, /ZEZWOLENIE_SUMA/)
    assert.match(po.content[0].text, /Plik bazowy silnika zmienił się/)
    await s.sprzataj()
  })

  test('bez funkcji odczytu ta droga zostaje otwarta - i tak jest w raporcie', async () => {
    const s = await stanowisko({ plikBazowy: bazaZKontraktem })
    await s.wolaj('process_write', { name: 'forma-a', spec: dagFormaA })
    const po = await s.wolaj('process_run', { name: 'forma-a', action: 'start' })
    // Bramka nie zna aktualnej treści pliku bazowego, więc nie ma czego porównać.
    assert.equal(po.isError, false)
    await s.sprzataj()
  })
})

describe('klient silnika nie oddaje klucza', () => {
  test('żadne wywołanie ani komunikat błędu nie zawiera klucza', async () => {
    const klucz = 'dagu_TAJNYKLUCZ0000000000'
    const klient = utworzKlienta({ url: 'http://127.0.0.1:1/nie-ma', klucz })
    assert.equal(Object.values(klient).some((w) => typeof w === 'string' && w.includes(klucz)), false)
    assert.equal(JSON.stringify(Object.keys(klient)).includes(klucz), false)
    await assert.rejects(
      () => klient.odczytaj({ target: 'dags' }),
      (e) => {
        assert.equal(e.message.includes(klucz), false, 'klucz wyciekł do komunikatu błędu')
        assert.equal(String(e.szczegoly ?? '').includes(klucz), false)
        return true
      })
  })
})
