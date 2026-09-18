// Nasz serwer MCP - bramka, której model nie omija w chronionym zakresie.
//
// Dzisiaj model rozmawia z MCP silnika BEZPOŚREDNIO, więc bramka wpięta w jedno
// narzędzie backendu nie daje nic. Odwracamy kierunek: `claude -p --mcp-config`
// wskazuje na TEN serwer, a adres i klucz API Dagu nie opuszczają backendu.
// Wzorzec jest sprawdzony - prototyp tak samo rozmawia z MCP n8n po HTTP.
//
// Trzy narzędzia silnika (dagu_read / dagu_change / dagu_execute) są opakowane
// w cztery nasze. Zapis przechodzi przez politykę, uruchomienie przez kontrolę sumy
// kontrolnej, a status czytamy z silnika.

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { opiszNaruszenia, BladTransportu } from './bledy.mjs'
import { sprawdzDefinicje, wykryjPoddagi } from './walidacja-definicji.mjs'
import { sprawdzIdentyfikator } from './identyfikatory.mjs'
import { ustalWynik } from './wynik.mjs'

const PROTOKOL = '2025-06-18'

// Odczyt jest nieszkodliwy, ale zawężamy go do celów, których model faktycznie
// potrzebuje - mniejsza powierzchnia to mniej miejsc na niespodzianki.
const DOZWOLONE_CELE_ODCZYTU = new Set([
  'dags', 'dag', 'dag_spec', 'dag_search', 'runs', 'run', 'run_logs', 'step_log',
  'references', 'reference',
])

const NARZEDZIA = [
  {
    name: 'process_read',
    description:
      'Odczyt stanu procesów i wykonań. Odpowiednik dagu_read. Cele: dags, dag, dag_spec, ' +
      'dag_search, runs, run, run_logs, step_log, references, reference.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Co odczytać.' },
        name: { type: 'string', description: 'Nazwa procesu.' },
        dagRunId: { type: 'string', description: 'Identyfikator wykonania.' },
        stepName: { type: 'string' },
        query: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['target'],
    },
  },
  {
    name: 'process_write',
    description:
      'Zapis definicji procesu. Odpowiednik dagu_change type=upsert_dag. Definicja przechodzi ' +
      'przez politykę kontraktu: krok publikujący wynik musi mieć output_schema będący ' +
      'ZATWIERDZONYM kontraktem z katalogu kontrakty/, bez drugiego kanału (DAGU_OUTPUT_FILE, ' +
      'outputs:, ${steps.*.outputs.*}) i bez continue_on maskującego naruszenie. Przy odmowie ' +
      'zwraca listę naruszeń po polsku i NIE zapisuje niczego.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Identyfikator procesu, wzorzec ^[a-z0-9][a-z0-9-]{0,38}$.' },
        spec: { type: 'string', description: 'Pełna definicja YAML procesu.' },
        mode: { type: 'string', enum: ['preview', 'apply'], description: 'preview tylko sprawdza.' },
      },
      required: ['name', 'spec'],
    },
  },
  {
    name: 'process_run',
    description:
      'Uruchomienie, ponowienie albo zatrzymanie procesu. Odpowiednik dagu_execute. Tuż przed ' +
      'uruchomieniem definicja jest odczytywana z silnika i porównywana z wersją, która ' +
      'przeszła politykę; różnica oznacza odmowę.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        action: { type: 'string', enum: ['start', 'enqueue', 'retry', 'stop'] },
        dagRunId: { type: 'string' },
        params: { type: 'object' },
        stepName: { type: 'string' },
        wait: { type: 'boolean' },
        waitTimeoutSeconds: { type: 'number' },
      },
      required: ['name', 'action'],
    },
  },
  {
    name: 'process_status',
    description:
      'Status wykonania odczytany z silnika (statusLabel). Jedyne dopuszczone źródło prawdy ' +
      'o powodzeniu - treść odpowiedzi modelu nim nie jest.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, dagRunId: { type: 'string' } },
      required: ['name', 'dagRunId'],
    },
  },
]

const tekstowy = (tekst, blad = false) => ({ content: [{ type: 'text', text: tekst }], isError: blad })
const strukturalny = (dane, tekst) => ({
  content: [{ type: 'text', text: tekst ?? JSON.stringify(dane) }],
  structuredContent: dane,
  isError: false,
})

/**
 * Buduje logikę serwera bez transportu - żeby dało się ją testować bez gniazda.
 */
export function utworzBramke({ klient, rejestr, zezwolenia, plikBazowy = null, logger = null }) {
  /** Pobiera z silnika definicje sub-DAG-ów wołanych przez daną definicję (domknięcie). */
  async function pobierzPoddagi(yamlZrodlowy) {
    const poddagi = {}
    const doPobrania = [...wykryjPoddagi(yamlZrodlowy)]
    while (doPobrania.length > 0) {
      const nazwa = doPobrania.pop()
      if (Object.prototype.hasOwnProperty.call(poddagi, nazwa)) continue
      let spec = null
      try { spec = await klient.pobierzSpec(nazwa) } catch { spec = null }
      if (typeof spec !== 'string') continue      // brak definicji -> SUBDAG_NIEZNANY w walidacji
      poddagi[nazwa] = spec
      doPobrania.push(...wykryjPoddagi(spec))
    }
    return poddagi
  }

  async function processRead(argumenty) {
    const cel = String(argumenty?.target ?? '')
    if (!DOZWOLONE_CELE_ODCZYTU.has(cel)) {
      return tekstowy(
        `Odmowa: cel odczytu "${cel}" nie jest dostępny przez tę bramkę. Dostępne: ` +
        `${[...DOZWOLONE_CELE_ODCZYTU].join(', ')}.`, true)
    }
    const wynik = await klient.odczytaj(argumenty)
    const dane = klient.dane(wynik)
    return strukturalny(dane ?? {}, JSON.stringify(dane))
  }

  async function processWrite(argumenty) {
    const nazwa = String(argumenty?.name ?? '')
    const spec = argumenty?.spec
    const tryb = argumenty?.mode === 'preview' ? 'preview' : 'apply'

    const wynikId = sprawdzIdentyfikator(nazwa)
    if (!wynikId.ok) return odmowaNarzedzia(wynikId.naruszenia)
    if (typeof spec !== 'string' || spec.trim() === '') {
      return tekstowy('Odmowa: pole "spec" musi zawierać pełną definicję YAML procesu.', true)
    }

    const poddagi = await pobierzPoddagi(spec)
    const walidacja = sprawdzDefinicje({ nazwa, yaml: spec, rejestr, plikBazowy, poddagi })
    if (!walidacja.ok) return odmowaNarzedzia(walidacja.naruszenia)

    if (tryb === 'preview') {
      const podglad = await klient.zmien({ type: 'upsert_dag', mode: 'preview', name: nazwa, spec })
      return strukturalny({ polityka: 'przeszla', silnik: klient.dane(podglad) },
        'Polityka: przeszła. Wynik lintu silnika w structuredContent.')
    }

    const zapis = await klient.zmien({ type: 'upsert_dag', mode: 'apply', name: nazwa, spec })
    const daneZapisu = klient.dane(zapis)
    if (daneZapisu && daneZapisu.applied === false) {
      return tekstowy(
        `Silnik odrzucił definicję przy zapisie: ${JSON.stringify(daneZapisu.errors ?? daneZapisu)}`, true)
    }

    // Zatwierdzamy to, co NAPRAWDĘ leży w silniku, a nie to, co przyszło w żądaniu.
    // Inaczej zezwolenie opisywałoby tekst, którego nikt już nie wykona.
    const zSilnika = await klient.pobierzSpec(nazwa)
    const poddagiZSilnika = await pobierzPoddagi(zSilnika ?? spec)
    const powtorna = sprawdzDefinicje({ nazwa, yaml: zSilnika ?? spec, rejestr, plikBazowy, poddagi: poddagiZSilnika })
    if (!powtorna.ok) {
      return odmowaNarzedzia(powtorna.naruszenia,
        'Definicja zapisana w silniku nie przechodzi polityki, choć przesłana przechodziła. ' +
        'Zapis został wykonany, ale zezwolenia nie wystawiono - proces się nie uruchomi.')
    }
    await zezwolenia.zatwierdz({ nazwa, raport: powtorna.raport })

    return strukturalny({
      applied: true,
      name: nazwa,
      sumaKontrolna: powtorna.raport.sumaKontrolna,
      uzyteKontrakty: powtorna.raport.uzyteKontrakty,
    }, `Zapisano proces "${nazwa}". Polityka: przeszła. Kontrakty w użyciu: ` +
       `${powtorna.raport.uzyteKontrakty.map((k) => `${k.kontrakt} v${k.wersja}`).join(', ') || 'brak'}.`)
  }

  async function processRun(argumenty) {
    const nazwa = String(argumenty?.name ?? '')
    const akcja = String(argumenty?.action ?? '')
    const wynikId = sprawdzIdentyfikator(nazwa)
    if (!wynikId.ok) return odmowaNarzedzia(wynikId.naruszenia)

    // `stop` nie uruchamia niczego - wstrzymywanie go kontrolą sumy odcinałoby
    // operatorowi jedyny sposób zatrzymania przebiegu, który już trwa.
    if (akcja !== 'stop') {
      const zSilnika = await klient.pobierzSpec(nazwa)
      if (typeof zSilnika !== 'string') {
        return tekstowy(`Odmowa: nie udało się odczytać definicji procesu "${nazwa}" z silnika, ` +
          'więc nie da się potwierdzić, że wykonana zostanie wersja zwalidowana.', true)
      }
      const poddagiZSilnika = await pobierzPoddagi(zSilnika)
      const kontrola = zezwolenia.sprawdzPrzedStartem({
        nazwa, yamlZSilnika: zSilnika, poddagiZSilnika, odciskRejestru: rejestr.odcisk,
      })
      if (!kontrola.ok) return odmowaNarzedzia(kontrola.naruszenia)
    }

    const wykonanie = await klient.wykonaj({ targetType: 'dag', ...argumenty })
    const dane = klient.dane(wykonanie)
    return strukturalny(dane ?? {}, JSON.stringify(dane))
  }

  async function processStatus(argumenty) {
    const wynik = await ustalWynik({
      klient, dagName: String(argumenty?.name ?? ''), dagRunId: String(argumenty?.dagRunId ?? ''),
    })
    if (!wynik.ok) return odmowaNarzedzia(wynik.naruszenia)
    return strukturalny(
      { statusLabel: wynik.statusLabel, sukces: wynik.sukces, kroki: wynik.kroki },
      `Status wykonania wg silnika: ${wynik.statusLabel}.`)
  }

  function odmowaNarzedzia(naruszenia, wstep = 'Odmowa polityki kontraktu.') {
    const tekst = `${wstep}\n\n${opiszNaruszenia(naruszenia)}`
    return { content: [{ type: 'text', text: tekst }], structuredContent: { odmowa: true, naruszenia }, isError: true }
  }

  const obsluga = {
    process_read: processRead,
    process_write: processWrite,
    process_run: processRun,
    process_status: processStatus,
  }

  /** Obsługa jednego komunikatu JSON-RPC. Zwraca obiekt odpowiedzi albo null (powiadomienie). */
  async function obsluzJsonRpc(wiadomosc) {
    const { id = null, method, params } = wiadomosc ?? {}
    const odp = (result) => ({ jsonrpc: '2.0', id, result })
    const blad = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } })

    if (typeof method !== 'string') return blad(-32600, 'Brak pola "method".')
    if (method.startsWith('notifications/')) return null

    switch (method) {
      case 'initialize':
        return odp({
          protocolVersion: PROTOKOL,
          capabilities: { tools: {} },
          serverInfo: { name: 'polityka-procesow', version: '1.0.0' },
          instructions:
            'Procesy tworzysz i uruchamiasz WYŁĄCZNIE przez te narzędzia. Krok, którego wynik ' +
            'czyta inny krok, wypisuje na stdout dokładnie jeden dokument JSON (logi na stderr), ' +
            'deklaruje output: NAZWA oraz output_schema będący zatwierdzonym kontraktem. Odbiorca ' +
            'czyta "$NAZWA" przez jq i musi mieć nadawcę w depends. Zakazane: zapis do ' +
            '$DAGU_OUTPUT_FILE, outputs:, ${steps.*.outputs.*} oraz continue_on z failure/mark_success ' +
            'na kroku ze schematem. continue_on: skipped na gałęzi warunkowej jest dozwolony.',
        })
      case 'ping':
        return odp({})
      case 'tools/list':
        return odp({ tools: NARZEDZIA })
      case 'tools/call': {
        const nazwa = params?.name
        const funkcja = obsluga[nazwa]
        if (!funkcja) return blad(-32602, `Nieznane narzędzie: ${nazwa}`)
        try {
          return odp(await funkcja(params?.arguments ?? {}))
        } catch (e) {
          if (logger) logger.error?.('polityka/mcp:', e.message)
          const tekst = e instanceof BladTransportu
            ? `Silnik jest w tej chwili nieosiągalny: ${e.message}`
            : `Błąd wewnętrzny bramki: ${e.message}`
          return odp(tekstowy(tekst, true))
        }
      }
      default:
        return blad(-32601, `Nieobsługiwana metoda: ${method}`)
    }
  }

  return { obsluzJsonRpc, narzedzia: NARZEDZIA, obsluga }
}

/**
 * Serwer HTTP (Streamable HTTP, odpowiedzi w JSON - dokładnie tak odpowiada MCP Dagu).
 * Nasłuch domyślnie wyłącznie na 127.0.0.1.
 */
export async function uruchomSerwerMcp({
  host = '127.0.0.1', port = 8788, sciezka = '/mcp', sekret = null,
  klient, rejestr, zezwolenia, plikBazowy = null, logger = null,
}) {
  const bramka = utworzBramke({ klient, rejestr, zezwolenia, plikBazowy, logger })
  const sesje = new Set()

  const serwer = createServer((req, res) => {
    const adres = new URL(req.url, `http://${host}:${port}`)
    if (adres.pathname !== sciezka) return odpowiedzJson(res, 404, { error: 'nie znaleziono' })

    if (sekret) {
      const naglowek = req.headers.authorization ?? ''
      if (naglowek !== `Bearer ${sekret}`) return odpowiedzJson(res, 401, { error: 'brak uprawnien' })
    }
    // Serwer nie wystawia strumienia server->client; klient ma używać POST.
    if (req.method === 'GET') return odpowiedzJson(res, 405, { error: 'metoda niedozwolona' })
    if (req.method === 'DELETE') {
      const sesja = req.headers['mcp-session-id']
      if (sesja) sesje.delete(sesja)
      return odpowiedzJson(res, 200, { ok: true })
    }
    if (req.method !== 'POST') return odpowiedzJson(res, 405, { error: 'metoda niedozwolona' })

    let cialo = ''
    req.on('data', (c) => { cialo += c; if (cialo.length > 2_000_000) req.destroy() })
    req.on('end', async () => {
      let wiadomosc
      try { wiadomosc = JSON.parse(cialo) } catch {
        return odpowiedzJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Nieprawidlowy JSON' } })
      }
      const wiele = Array.isArray(wiadomosc)
      const lista = wiele ? wiadomosc : [wiadomosc]
      const odpowiedzi = []
      let nowaSesja = null
      for (const pozycja of lista) {
        if (pozycja?.method === 'initialize') {
          nowaSesja = randomUUID().replaceAll('-', '').toUpperCase()
          sesje.add(nowaSesja)
        }
        const wynik = await bramka.obsluzJsonRpc(pozycja)
        if (wynik !== null) odpowiedzi.push(wynik)
      }
      const naglowki = {}
      if (nowaSesja) naglowki['Mcp-Session-Id'] = nowaSesja
      if (odpowiedzi.length === 0) return odpowiedzJson(res, 202, null, naglowki)
      return odpowiedzJson(res, 200, wiele ? odpowiedzi : odpowiedzi[0], naglowki)
    })
  })

  await new Promise((resolve, reject) => {
    serwer.once('error', reject)
    serwer.listen(port, host, resolve)
  })
  const faktycznyPort = serwer.address().port

  return {
    url: `http://${host}:${faktycznyPort}${sciezka}`,
    port: faktycznyPort,
    bramka,
    zamknij: () => new Promise((resolve) => serwer.close(resolve)),
  }
}

function odpowiedzJson(res, status, cialo, naglowki = {}) {
  if (cialo === null) { res.writeHead(status, naglowki); return res.end() }
  const tekst = JSON.stringify(cialo)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(tekst),
    ...naglowki,
  })
  res.end(tekst)
}
