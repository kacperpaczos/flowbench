// Testy integracyjne wobec ŻYWEGO Dagu (obraz przypięty po digeście).
//
// Stanowisko: projekt compose `dagu-policy`, wyłącznie 127.0.0.1:9210, katalog poza
// repozytorium, socket Dockera niezamontowany. Bez zmiennych środowiskowych poniżej
// testy się POMIJAJĄ - żeby `node --test` działało też bez stanowiska.
//
//   DAGU_POLITYKA_URL=http://127.0.0.1:9210/dagu/mcp
//   DAGU_POLITYKA_KLUCZ=<klucz API, rola developer, allowedSurfaces:["mcp"]>
//   DAGU_POLITYKA_KONTENER=dagu-policy      (opcjonalnie; potrzebny do testu podmiany na dysku)

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  utworzKlienta, utworzBramke, utworzRejestrZezwolen, sprawdzDefinicje,
  ustalWynik, pogodzOdpowiedzModelu,
} from '../../polityka/index.mjs'
import { rejestr, schematYaml, komunikaty, DAG_ROZGALEZIENIE } from './_wspolne.mjs'

const uruchom = promisify(execFile)
const URL_MCP = process.env.DAGU_POLITYKA_URL
const KLUCZ = process.env.DAGU_POLITYKA_KLUCZ
const KONTENER = process.env.DAGU_POLITYKA_KONTENER ?? 'dagu-policy'
const KLUCZ_ADMIN = process.env.DAGU_POLITYKA_KLUCZ_ADMIN
const URL_REST = process.env.DAGU_POLITYKA_REST ?? 'http://127.0.0.1:9210/dagu/api/v1'
const pominac = !URL_MCP || !KLUCZ

describe('integracja z żywym Dagu', { skip: pominac && 'brak DAGU_POLITYKA_URL / DAGU_POLITYKA_KLUCZ' }, () => {
  let klient
  let zezwolenia
  let bramka
  let katalog
  let czerwonyRunId = null
  const wolaj = (nazwa, argumenty) => bramka.obsluzJsonRpc(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: nazwa, arguments: argumenty } },
  ).then((o) => o.result)

  before(async () => {
    katalog = await mkdtemp(join(tmpdir(), 'integracja-'))
    klient = utworzKlienta({ url: URL_MCP, klucz: KLUCZ })
    zezwolenia = await utworzRejestrZezwolen({ plik: join(katalog, 'zezwolenia.json') })
    bramka = utworzBramke({ klient, rejestr, zezwolenia })
  })
  after(async () => {
    for (const nazwa of ['srednia-z-galezi', 'kontrakt-lamany', 'podmieniany', 'edytowany-w-ui']) {
      try { await klient.zmien({ type: 'delete_dag', name: nazwa }) } catch { /* może nie istnieć */ }
    }
    klient?.zamknij()
    await rm(katalog, { recursive: true, force: true })
  })

  test('PUNKT 3 na żywo: rozgałęzienie + continue_on: skipped + fan-in przechodzi politykę I się wykonuje', async () => {
    const zapis = await wolaj('process_write', { name: 'srednia-z-galezi', spec: DAG_ROZGALEZIENIE })
    assert.equal(zapis.isError, false, zapis.content[0].text)

    const start = await wolaj('process_run', {
      name: 'srednia-z-galezi', action: 'start', wait: true, waitTimeoutSeconds: 120,
    })
    assert.equal(start.isError, false, start.content[0].text)

    const dagRunId = start.structuredContent.dagRunId
    const wynik = await ustalWynik({ klient, dagName: 'srednia-z-galezi', dagRunId })
    assert.equal(wynik.statusLabel, 'succeeded', JSON.stringify(wynik))

    const poNazwie = Object.fromEntries(wynik.kroki.map((k) => [k.name, k.statusLabel]))
    assert.equal(poNazwie['pomiar-a'], 'succeeded')
    assert.equal(poNazwie['pomiar-b'], 'skipped', 'gałąź warunkowa miała zostać pominięta')
    assert.equal(poNazwie.srednia, 'succeeded', 'fan-in miał się wykonać mimo pominiętej gałęzi')

    // Fan-in naprawdę policzył średnią z gałęzi, która doszła - i przeszedł walidację
    // output_schema silnika, bo inaczej krok byłby czerwony.
    const log = klient.dane(await klient.odczytaj({
      target: 'step_log', name: 'srednia-z-galezi', dagRunId, stepName: 'srednia',
    }))
    const stdout = (log?.data ?? log)?.stdoutContent ?? ''
    const wyliczone = JSON.parse(stdout.trim())
    assert.deepEqual(wyliczone, { liczbaPomiarow: 1, srednia: 18.5, galezie: ['Warszawa'] })
  })

  test('silnik naprawdę czerwieni naruszenie schematu - to NIE jest nasza robota', async () => {
    // Definicja jest zgodna z kontraktem (schemat zatwierdzony), ale krok wypisuje
    // wynik łamiący ten schemat. Walidacja DANYCH należy do silnika.
    const spec = `name: kontrakt-lamany
steps:
  - name: policz
    run: echo '{"status":123}'
    output: WYNIK
    output_schema: ${schematYaml('status-procesu', 1)}
`
    const walidacja = sprawdzDefinicje({ nazwa: 'kontrakt-lamany', yaml: spec, rejestr })
    assert.equal(walidacja.ok, true, komunikaty(walidacja))

    const zapis = await wolaj('process_write', { name: 'kontrakt-lamany', spec })
    assert.equal(zapis.isError, false, zapis.content[0].text)
    const start = await wolaj('process_run', {
      name: 'kontrakt-lamany', action: 'start', wait: true, waitTimeoutSeconds: 120,
    })
    const dagRunId = start.structuredContent?.dagRunId
    const wynik = await ustalWynik({ klient, dagName: 'kontrakt-lamany', dagRunId })
    assert.equal(wynik.statusLabel, 'failed', JSON.stringify(wynik))
    czerwonyRunId = dagRunId
  })

  test('PUNKT 7 na żywo: model pisze "gotowe" przy czerwonym przebiegu - warstwa zwraca błąd', async () => {
    assert.ok(czerwonyRunId, 'brak czerwonego przebiegu do sprawdzenia')
    const wynik = await ustalWynik({ klient, dagName: 'kontrakt-lamany', dagRunId: czerwonyRunId })
    assert.equal(wynik.statusLabel, 'failed')
    const werdykt = pogodzOdpowiedzModelu({
      tekstModelu: 'Gotowe. Utworzyłem proces i uruchomiłem go, wynik jest poprawny.',
      wynik,
    })
    assert.equal(werdykt.ok, false)
    assert.equal(werdykt.modelTwierdziSukces, true)
    assert.match(werdykt.komunikat, /Model napisał, że zadanie się udało, ale silnik mówi co innego/)
  })

  test('PUNKT 6 na żywo: podmiana pliku definicji po walidacji, przed startem - start ODMAWIA', async () => {
    const spec = `name: podmieniany
steps:
  - name: policz
    run: echo '{"status":"OK"}'
    output: WYNIK
    output_schema: ${schematYaml('status-procesu', 1)}
`
    const zapis = await wolaj('process_write', { name: 'podmieniany', spec })
    assert.equal(zapis.isError, false, zapis.content[0].text)

    // Start przed podmianą przechodzi.
    const przed = await wolaj('process_run', { name: 'podmieniany', action: 'start', wait: true, waitTimeoutSeconds: 60 })
    assert.equal(przed.isError, false, przed.content[0].text)

    // Podmiana z pominięciem MCP - dokładnie to, co audyt bezpieczeństwa P3 pokazał
    // wykonaniem: krok DAG-a (root) ma zapis do katalogu dags/.
    const podmieniony = spec.replace("echo '{\"status\":\"OK\"}'", "echo '{\"status\":\"PODMIENIONE\"}'")
    await uruchom('docker', ['exec', '-i', KONTENER, 'sh', '-c',
      `cat > /var/lib/dagu/dags/podmieniany.yaml <<'YAML'\n${podmieniony}\nYAML`])

    const zDysku = await klient.pobierzSpec('podmieniany')
    assert.match(zDysku, /PODMIENIONE/, 'podmiana na dysku się nie udała')

    const po = await wolaj('process_run', { name: 'podmieniany', action: 'start', wait: true, waitTimeoutSeconds: 60 })
    assert.equal(po.isError, true, 'start podmienionej definicji NIE został wstrzymany')
    assert.match(po.content[0].text, /ZEZWOLENIE_SUMA/)
    assert.match(po.content[0].text, /Uruchomienie wstrzymane/)
  })

  test('klucz agenta (developer, allowedSurfaces=[mcp]) nie ma REST-a - zamkniete uprawnieniami', async () => {
    for (const sciezka of ['dags', 'api-keys', 'users', 'dag-runs']) {
      const odp = await fetch(`${URL_REST}/${sciezka}`, { headers: { Authorization: `Bearer ${KLUCZ}` } })
      assert.equal(odp.status, 403, `GET /${sciezka} zwrocil ${odp.status}, a mial 403`)
    }
    // nie utworzy sobie mocniejszego klucza
    const eskalacja = await fetch(`${URL_REST}/api-keys`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KLUCZ}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'eskalacja', role: 'admin', allowedSurfaces: ['mcp', 'rest_api'] }),
    })
    assert.equal(eskalacja.status, 403)
  })

  test('edycja definicji przez REST/UI silnika (rola admin) - start ODMAWIA', {
    skip: !KLUCZ_ADMIN && 'brak DAGU_POLITYKA_KLUCZ_ADMIN',
  }, async () => {
    const spec = `name: edytowany-w-ui
steps:
  - name: policz
    run: echo '{"status":"OK"}'
    output: WYNIK
    output_schema: ${schematYaml('status-procesu', 1)}
`
    const zapis = await wolaj('process_write', { name: 'edytowany-w-ui', spec })
    assert.equal(zapis.isError, false, zapis.content[0].text)

    // Dokladnie ta droga, ktora ma operator w UI Dagu: PUT /dags/{name}/spec.
    const edycja = await fetch(`${URL_REST}/dags/edytowany-w-ui/spec`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${KLUCZ_ADMIN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec: spec.replace('"status":"OK"', '"status":"PODMIENIONE"') }),
    })
    assert.equal(edycja.status, 200, 'edycja przez REST sie nie powiodla - test nie sprawdza tego, co mial')

    const po = await wolaj('process_run', { name: 'edytowany-w-ui', action: 'start', wait: true, waitTimeoutSeconds: 60 })
    assert.equal(po.isError, true, 'start po edycji w UI NIE zostal wstrzymany')
    assert.match(po.content[0].text, /ZEZWOLENIE_SUMA/)
  })

  test('odmowa polityki nie zostawia niczego w silniku', async () => {
    const spec = `name: nigdy-nie-zapisany
steps:
  - name: policz
    run: echo '{"status":"OK"}'
    output: WYNIK
`
    const zapis = await wolaj('process_write', { name: 'nigdy-nie-zapisany', spec })
    assert.equal(zapis.isError, true)
    assert.match(zapis.content[0].text, /K3_BRAK_SCHEMATU/)

    const dagi = klient.dane(await klient.odczytaj({ target: 'dags' }))
    const nazwy = JSON.stringify(dagi)
    assert.equal(nazwy.includes('nigdy-nie-zapisany'), false, 'definicja trafiła do silnika mimo odmowy')
  })
})
