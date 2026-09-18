// Bramka MCP: zapis przez politykę, uruchomienie przez kontrolę sumy kontrolnej.
// Silnik jest tu podstawiony atrapą - sprawdzamy reguły bramki, nie transport.
// Rozmowa z żywym Dagu i z `claude -p` jest w integracja-dagu.test.mjs.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { utworzBramke, uruchomSerwerMcp, utworzRejestrZezwolen } from '../../polityka/index.mjs'
import { rejestr, DAG_POPRAWNY } from './_wspolne.mjs'

/** Atrapa silnika: trzyma definicje w mapie i pozwala je podmienić "z pominięciem MCP". */
function atrapaSilnika() {
  const dagi = new Map()
  const przebiegi = new Map()
  let licznik = 0
  return {
    dagi,
    przebiegi,
    podmienNaDysku: (nazwa, spec) => dagi.set(nazwa, spec),
    dane: (x) => x,
    async odczytaj(a) {
      if (a.target === 'dag_spec') return dagi.get(a.name) ?? null
      if (a.target === 'run') return przebiegi.get(a.dagRunId) ?? null
      if (a.target === 'dags') return { dags: [...dagi.keys()] }
      throw new Error(`atrapa nie zna celu ${a.target}`)
    },
    async zmien(a) {
      if (a.type !== 'upsert_dag') throw new Error('atrapa obsluguje tylko upsert_dag')
      if (a.mode === 'apply') dagi.set(a.name, a.spec)
      return { applied: a.mode === 'apply', valid: true, errors: [] }
    },
    async wykonaj(a) {
      const dagRunId = `RUN${++licznik}`
      przebiegi.set(dagRunId, {
        data: { dagRunId, name: a.name, statusLabel: 'succeeded', steps: [] },
      })
      return { action: a.action, dagName: a.name, dagRunId, statusLabel: 'succeeded' }
    },
    async pobierzSpec(nazwa) { return dagi.get(nazwa) ?? null },
  }
}

async function stanowisko() {
  const katalog = await mkdtemp(join(tmpdir(), 'bramka-'))
  const klient = atrapaSilnika()
  const zezwolenia = await utworzRejestrZezwolen({ plik: join(katalog, 'zezwolenia.json') })
  const bramka = utworzBramke({ klient, rejestr, zezwolenia })
  const wolaj = (nazwa, argumenty) =>
    bramka.obsluzJsonRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: nazwa, arguments: argumenty } })
  return { katalog, klient, zezwolenia, bramka, wolaj, sprzataj: () => rm(katalog, { recursive: true, force: true }) }
}

describe('powierzchnia MCP naszej bramki', () => {
  test('tools/list wystawia cztery narzędzia i żadnego dagu_*', async () => {
    const s = await stanowisko()
    const odp = await s.bramka.obsluzJsonRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const nazwy = odp.result.tools.map((t) => t.name)
    assert.deepEqual(nazwy, ['process_read', 'process_write', 'process_run', 'process_status'])
    assert.equal(nazwy.some((n) => n.startsWith('dagu_')), false)
    await s.sprzataj()
  })

  test('initialize zwraca konwencję kontraktu w instructions', async () => {
    const s = await stanowisko()
    const odp = await s.bramka.obsluzJsonRpc({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    assert.equal(odp.result.serverInfo.name, 'polityka-procesow')
    assert.match(odp.result.instructions, /DAGU_OUTPUT_FILE/)
    assert.match(odp.result.instructions, /continue_on: skipped na gałęzi warunkowej jest dozwolony/)
    await s.sprzataj()
  })

  test('nieznana metoda - błąd JSON-RPC, nie przepuszczenie', async () => {
    const s = await stanowisko()
    const odp = await s.bramka.obsluzJsonRpc({ jsonrpc: '2.0', id: 1, method: 'resources/read' })
    assert.equal(odp.error.code, -32601)
    await s.sprzataj()
  })

  test('process_read z celem spoza listy - odmowa', async () => {
    const s = await stanowisko()
    const odp = await s.wolaj('process_read', { target: 'dag_profile' })
    assert.equal(odp.result.isError, true)
    assert.match(odp.result.content[0].text, /nie jest dostępny przez tę bramkę/)
    await s.sprzataj()
  })
})

describe('process_write: zapis przechodzi przez politykę', () => {
  test('definicja zgodna z kontraktem - zapis i zezwolenie', async () => {
    const s = await stanowisko()
    const odp = await s.wolaj('process_write', { name: 'wartosc-zamowienia', spec: DAG_POPRAWNY })
    assert.equal(odp.result.isError, false, odp.result.content[0].text)
    assert.equal(odp.result.structuredContent.applied, true)
    assert.ok(s.klient.dagi.has('wartosc-zamowienia'))
    assert.ok(s.zezwolenia.znajdz('wartosc-zamowienia'))
    await s.sprzataj()
  })

  test('definicja łamiąca kontrakt - odmowa i NIC nie trafia do silnika', async () => {
    const s = await stanowisko()
    const zly = DAG_POPRAWNY.replace(/    output_schema: [\s\S]*?\n  - name: pokaz/, '  - name: pokaz')
    const odp = await s.wolaj('process_write', { name: 'wartosc-zamowienia', spec: zly })
    assert.equal(odp.result.isError, true)
    assert.equal(odp.result.structuredContent.odmowa, true)
    assert.match(odp.result.content[0].text, /K3_BRAK_SCHEMATU/)
    assert.equal(s.klient.dagi.size, 0, 'silnik dostał definicję mimo odmowy')
    await s.sprzataj()
  })

  test('nazwa spoza §4.2 - odmowa przed dotknięciem silnika', async () => {
    const s = await stanowisko()
    const odp = await s.wolaj('process_write', { name: 'Moje Zamowienie', spec: DAG_POPRAWNY })
    assert.equal(odp.result.isError, true)
    assert.match(odp.result.content[0].text, /ID_ZLY_ZNAK/)
    assert.equal(s.klient.dagi.size, 0)
    await s.sprzataj()
  })

  test('sub-DAG jest dociągany z silnika i też podlega polityce', async () => {
    const s = await stanowisko()
    s.klient.podmienNaDysku('dziecko', `name: dziecko
steps:
  - name: policz
    run: echo '{"status":"OK"}'
    output: WYNIK
`)
    const rodzic = `name: rodzic
steps:
  - name: wolaj
    action: dag.run
    with:
      dag: dziecko
`
    const odp = await s.wolaj('process_write', { name: 'rodzic', spec: rodzic })
    assert.equal(odp.result.isError, true)
    assert.match(odp.result.content[0].text, /K3_BRAK_SCHEMATU/)
    assert.match(odp.result.content[0].text, /poddag\[dziecko\]/)
    await s.sprzataj()
  })
})

describe('process_run: wykonywana wersja = wersja zwalidowana', () => {
  test('bez wcześniejszego zapisu - odmowa ZEZWOLENIE_BRAK', async () => {
    const s = await stanowisko()
    s.klient.podmienNaDysku('podlozony', DAG_POPRAWNY)
    const odp = await s.wolaj('process_run', { name: 'podlozony', action: 'start' })
    assert.equal(odp.result.isError, true)
    assert.match(odp.result.content[0].text, /ZEZWOLENIE_BRAK/)
    await s.sprzataj()
  })

  test('po poprawnym zapisie - start przechodzi', async () => {
    const s = await stanowisko()
    await s.wolaj('process_write', { name: 'wartosc-zamowienia', spec: DAG_POPRAWNY })
    const odp = await s.wolaj('process_run', { name: 'wartosc-zamowienia', action: 'start' })
    assert.equal(odp.result.isError, false, odp.result.content[0].text)
    assert.match(odp.result.structuredContent.dagRunId, /^RUN/)
    await s.sprzataj()
  })

  test('S7: podmiana definicji na dysku po zapisie - start ODMAWIA', async () => {
    const s = await stanowisko()
    await s.wolaj('process_write', { name: 'wartosc-zamowienia', spec: DAG_POPRAWNY })
    // Dokładnie scenariusz z audytu bezpieczeństwa P3: krok (root) nadpisuje plik
    // w katalogu dags/ z pominięciem MCP, więc lint i polityka go nie widziały.
    s.klient.podmienNaDysku('wartosc-zamowienia', DAG_POPRAWNY.replace('jq -r .produkt', 'sh -c "cokolwiek"'))
    const odp = await s.wolaj('process_run', { name: 'wartosc-zamowienia', action: 'start' })
    assert.equal(odp.result.isError, true)
    assert.match(odp.result.content[0].text, /ZEZWOLENIE_SUMA/)
    assert.match(odp.result.content[0].text, /Uruchomienie wstrzymane/)
    await s.sprzataj()
  })

  test('retry podmienionej definicji też odmawia', async () => {
    const s = await stanowisko()
    await s.wolaj('process_write', { name: 'wartosc-zamowienia', spec: DAG_POPRAWNY })
    s.klient.podmienNaDysku('wartosc-zamowienia', DAG_POPRAWNY.replace('policz', 'policz2'))
    const odp = await s.wolaj('process_run', { name: 'wartosc-zamowienia', action: 'retry', dagRunId: 'RUN1' })
    assert.equal(odp.result.isError, true)
    assert.match(odp.result.content[0].text, /ZEZWOLENIE_SUMA/)
    await s.sprzataj()
  })

  test('stop nie jest wstrzymywany kontrolą sumy - operator musi móc zatrzymać przebieg', async () => {
    const s = await stanowisko()
    await s.wolaj('process_write', { name: 'wartosc-zamowienia', spec: DAG_POPRAWNY })
    s.klient.podmienNaDysku('wartosc-zamowienia', DAG_POPRAWNY.replace('policz', 'policz2'))
    const odp = await s.wolaj('process_run', { name: 'wartosc-zamowienia', action: 'stop' })
    assert.equal(odp.result.isError, false, odp.result.content[0].text)
    await s.sprzataj()
  })
})

describe('process_status czyta status z silnika', () => {
  test('zwraca statusLabel', async () => {
    const s = await stanowisko()
    await s.wolaj('process_write', { name: 'wartosc-zamowienia', spec: DAG_POPRAWNY })
    const start = await s.wolaj('process_run', { name: 'wartosc-zamowienia', action: 'start' })
    const odp = await s.wolaj('process_status', {
      name: 'wartosc-zamowienia', dagRunId: start.result.structuredContent.dagRunId,
    })
    assert.equal(odp.result.isError, false)
    assert.equal(odp.result.structuredContent.statusLabel, 'succeeded')
    await s.sprzataj()
  })

  test('nieznane wykonanie - odmowa WYNIK_NIEZNANY', async () => {
    const s = await stanowisko()
    const odp = await s.wolaj('process_status', { name: 'x', dagRunId: 'NIE-MA' })
    assert.equal(odp.result.isError, true)
    assert.match(odp.result.content[0].text, /WYNIK_NIEZNANY/)
    await s.sprzataj()
  })
})

describe('transport HTTP naszego serwera MCP', () => {
  test('initialize przez HTTP zwraca Mcp-Session-Id i listę narzędzi', async () => {
    const katalog = await mkdtemp(join(tmpdir(), 'bramka-http-'))
    const zezwolenia = await utworzRejestrZezwolen({ plik: join(katalog, 'z.json') })
    const serwer = await uruchomSerwerMcp({ port: 0, klient: atrapaSilnika(), rejestr, zezwolenia })

    const wyslij = (cialo) => fetch(serwer.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify(cialo),
    })

    const init = await wyslij({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    assert.equal(init.status, 200)
    assert.ok(init.headers.get('mcp-session-id'))
    assert.equal((await init.json()).result.serverInfo.name, 'polityka-procesow')

    const powiadomienie = await wyslij({ jsonrpc: '2.0', method: 'notifications/initialized' })
    assert.equal(powiadomienie.status, 202)

    const lista = await wyslij({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    assert.equal((await lista.json()).result.tools.length, 4)

    await serwer.zamknij()
    await rm(katalog, { recursive: true, force: true })
  })

  test('nasłuch wyłącznie na 127.0.0.1 i opcjonalny sekret', async () => {
    const katalog = await mkdtemp(join(tmpdir(), 'bramka-http-'))
    const zezwolenia = await utworzRejestrZezwolen({ plik: join(katalog, 'z.json') })
    const serwer = await uruchomSerwerMcp({
      port: 0, host: '127.0.0.1', sekret: 'tajne', klient: atrapaSilnika(), rejestr, zezwolenia,
    })
    assert.match(serwer.url, /^http:\/\/127\.0\.0\.1:/)

    const bez = await fetch(serwer.url, { method: 'POST', body: '{}' })
    assert.equal(bez.status, 401)

    const z = await fetch(serwer.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tajne' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    assert.equal(z.status, 200)

    await serwer.zamknij()
    await rm(katalog, { recursive: true, force: true })
  })
})
