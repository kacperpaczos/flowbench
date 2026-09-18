import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { credentialStatus, syncCredentials } from './credentials.mjs'
import { wczytajBrameSesji } from './brama-sesji.mjs'
import {
  wczytajRejestr, utworzRejestrZezwolen, utworzKlienta, uruchomSerwerMcp,
  ustalWynik, pogodzOdpowiedzModelu,
} from './polityka/index.mjs'

const PORT = 8787
const MCP_CONFIG = '/app/mcp.json'
// Podniesiony z 240 s. Powod zmierzony na stanowisku: przy n8n model skladal
// workflow z gotowych wezlow SDK, przy Dagu pisze YAML i musi trafic w zatwierdzony
// kontrakt, wiec tura jest dluzsza. Jednokrokowy proces: 42-66 s. Dwukrokowy
// z dwoma kontraktami: powyzej 240 s, czyli stary limit ucinal realne zadanie
// w polowie i operator dostawal "przekroczono limit czasu" zamiast procesu.
const TIMEOUT_MS = 420_000
const CRED_SEED = '/seed/.credentials.json'
const CRED_LIVE = `${process.env.HOME}/.claude/.credentials.json`

// Czekanie na domkniecie przebiegu, gdy model wrocil przed silnikiem. Budzet jest
// swiadomie duzo mniejszy niz TIMEOUT_MS - po jego uplywie mowimy "w toku",
// a nie zmyslamy wyniku.
const BUDZET_DOMKNIECIA_MS = 30_000
const ODSTEP_DOPYTANIA_MS = 1_500

// --- prompt systemowy ---------------------------------------------------------
//
// UWAGA, to jest wazniejsze niz sama tresc: prompt NIE JEST SRODKIEM KONTROLI
// (decyzja par. 4.1a - "Prompt systemowy nadal opisuje konwencje, zeby model
// trafial za pierwszym razem. Nie jest srodkiem kontroli i nie wolno go w
// raporcie odbiorczym jako taki przedstawiac").
//
// Egzekwowaniem kontraktu zajmuja sie dwie inne warstwy, obie poza zasiegiem
// modelu: natywna walidacja `output_schema` w silniku oraz bramka MCP warstwy
// polityki (chat-backend/polityka/serwer-mcp.mjs), przez ktora ida wszystkie
// wywolania. Model, ktory zignoruje kazde zdanie ponizej, dostanie odmowe
// z bramki, a nie zielony przebieg.
const SYSTEM_BAZOWY = `Jesteś asystentem wbudowanym w firmowe narzędzie do procesów.
Odpowiadasz po polsku, zwięźle, bez emoji i bez markdownowych nagłówków.

Masz dostęp WYŁĄCZNIE do narzędzi MCP serwera "proces": process_read, process_write,
process_run, process_status. Nie masz dostępu do plików, powłoki ani do silnika inaczej niż
przez te cztery narzędzia. Każdy zapis i każde uruchomienie przechodzi przez warstwę polityki
kontraktu, która potrafi odmówić — odmowa wraca z kodem i zdaniem po polsku, przeczytaj je
i popraw definicję zamiast próbować tego samego jeszcze raz.

Silnikiem jest Dagu. Proces to DAG opisany w YAML, wykonanie to dag-run.

Identyfikatory:
- proces: ^[a-z0-9][a-z0-9-]{0,38}$ — bez kropki, wielkich liter i podkreślenia;
- krok (pole id): ^[a-zA-Z][a-zA-Z0-9_]*$ — tu myślnik jest niedozwolony, więc dane_pracownikow;
- polska nazwa procesu idzie do pola description: definicji, nigdy do identyfikatora.

Kontrakt danych K1–K7 obowiązuje przy każdym zapisie:
K1. Krok, którego wynik czyta inny krok, wypisuje na stdout dokładnie jeden dokument JSON
    i nic poza nim. Logi, postęp i ostrzeżenia idą na stderr.
K2. Ten krok deklaruje output: NAZWA (płaskie przechwycenie stdout).
K3. Ten krok deklaruje output_schema: obiektowy schemat JSON Schema z type: object,
    niepustym required, properties z typami i additionalProperties: false. Schemat musi być
    zatwierdzonym kontraktem — albo użyj gotowej akcji z pliku bazowego (action: <kontrakt>-v<N>),
    albo wpisz schemat wprost dokładnie w zatwierdzonej postaci.
K4. Krok odbierający czyta wartość jako zmienną w cudzysłowie ("$NAZWA") i parsuje ją przez jq.
    Musi mieć nadawcę w depends — brak depends to ciche puste dane, nie błąd.
K5. Zakazane: zapis do $DAGU_OUTPUT_FILE, deklaracja outputs:, odwołania \${steps.*.outputs.*}
    (także w preconditions) oraz continue_on z failure albo mark_success na kroku ze schematem.
K6. Wynik większy niż kilkadziesiąt kilobajtów nie jedzie zmienną — jedzie artefaktem, a granicę
    kroku przekracza mały manifest JSON objęty K1–K4.
K7. Rozgałęzienie warunkowe: osobny krok liczy dokument bramkowy o wartościach z zamkniętego
    enum, gałęzie porównują preconditions condition: "\${BRAMKA}" z expected: 're:…', a na obu
    gałęziach jest continue_on: {skipped: true}, inaczej fan-in nie zbiegnie. eval na danych
    jest zakazany.

Obraz silnika ma jq 1.7. Nie ma node ani python3 — logikę pisz w jq albo w powłoce.
Nie dodawaj schedule: — harmonogramy są w tej fazie odrzucane przez politykę.

Kolejność pracy:
1. process_read (target=dags, dag, dag_spec) — zobacz stan zastany, zanim cokolwiek zapiszesz.
2. process_write mode=preview — sprawdź definicję bez zapisu.
3. process_write mode=apply — zapisz.
4. process_run action=start z wait: true i waitTimeoutSeconds — uruchom i poczekaj na koniec.
5. process_status — odczytaj status z silnika i dopiero na tej podstawie opisz wynik.

Poprawka istniejącego procesu: najpierw process_read target=dag_spec, potem process_write
z CAŁĄ zmienioną definicją — zapis nadpisuje plik w całości, nie ma zmiany częściowej.

Nie pisz, że proces się udał, dopóki process_status nie zwróci statusu succeeded. Gdy przebieg
jest czerwony, powiedz to wprost i podaj, który krok zawiódł.

Na początku wiadomości użytkownika możesz dostać linijkę [Kontekst: ...] opisującą, co
użytkownik ma w tej chwili otwarte w ramce obok. To nie jest jego tekst — nie komentuj jej,
tylko z niej korzystaj. Gdy pyta "w jakim jestem procesie", odpowiedz na podstawie kontekstu
i w razie potrzeby dociągnij szczegóły przez process_read.`

/**
 * Katalog zatwierdzonych kontraktow doklejany do promptu.
 *
 * Powod jest zmierzony, nie teoretyczny. Bez katalogu model NIE MA JAK poznac
 * ksztaltu kontraktu: bramka nie wystawia narzedzia "wypisz kontrakty", a plik
 * bazowy silnika nie jest czytelny przez MCP. Na stanowisku skonczylo sie to
 * tym, ze model zalozyl POMOCNICZY PROCES, ktorego jedynym zadaniem bylo
 * zgrepowanie base.yaml - zmarnowana tura, smiec na liscie procesow i, przy
 * trudniejszym zadaniu, przekroczony limit czasu.
 *
 * To nadal nie jest srodek kontroli (par. 4.1a): model, ktory zignoruje katalog
 * i wpisze wlasny schemat, dostanie K3_KONTRAKT_NIEZATWIERDZONY z bramki.
 * Katalog skraca droge do trafienia za pierwszym razem, i tyle.
 */
function katalogKontraktow(rejestr) {
  const wiersze = rejestr.lista().map((wpis) => {
    const pelny = rejestr.znajdz(wpis.kontrakt, wpis.wersja)
    return `- ${wpis.kontrakt} v${wpis.wersja} (akcja: ${wpis.nazwaAkcji}) — ${wpis.opis}\n`
      + `  schemat: ${JSON.stringify(pelny?.schemat ?? {})}`
  })
  return 'ZATWIERDZONE KONTRAKTY. Krok publikujący wynik musi użyć jednego z nich — albo przez\n'
    + 'action: <nazwa-akcji> bez powtarzania schematu, albo wpisując output_schema dokładnie\n'
    + 'w tej postaci. Inny schemat to odmowa K3_KONTRAKT_NIEZATWIERDZONY. Nowego kontraktu nie\n'
    + 'da się dodać z poziomu rozmowy — to zmiana pliku w katalogu kontrakty/, poza procesem.\n\n'
    + wiersze.join('\n')
}

const ALLOWED = 'mcp__proces'
const DISALLOWED = 'Bash,Read,Write,Edit,NotebookEdit,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite'

// --- warstwa polityki ---------------------------------------------------------

const srodowisko = {
  mcpUrl: process.env.DAGU_MCP_URL,
  mcpToken: process.env.DAGU_MCP_TOKEN,
  kontraktyDir: process.env.KONTRAKTY_DIR ?? '/app/kontrakty',
  zezwoleniaPlik: process.env.ZEZWOLENIA_PLIK ?? '/app/dane/zezwolenia.json',
  politykaPort: Number(process.env.POLITYKA_MCP_PORT ?? 8788),
  politykaSekret: process.env.POLITYKA_MCP_SEKRET ?? null,
  plikBazowy: process.env.DAGU_BASE_YAML ?? null,
}

/**
 * Odpornosc na restart silnika.
 *
 * Klient MCP trzyma identyfikator sesji uzgodniony przy pierwszym polaczeniu.
 * Gdy silnik zostanie zrestartowany (E5 - "restart w trakcie pracy"), ta sesja
 * przestaje istniec po jego stronie, a kazde kolejne wywolanie wraca bledem.
 * Zmierzone na stanowisku: po `docker restart` silnika backend odpowiadal
 * "silnik nie zna procesu" na proces, ktory lezal w katalogu dags/ - czyli
 * podawal awarie polaczenia jako fakt o danych. To jest gorsze niz blad.
 *
 * Odczyty ponawiamy raz, po skasowaniu sesji. Zapisu i uruchomienia NIE
 * ponawiamy: nie wiemy, czy zadanie doszlo do silnika przed zerwaniem, a
 * powtorzony `start` to drugi przebieg. Sesje i tak kasujemy, wiec nastepne
 * wywolanie polaczy sie na nowo.
 */
function zOdpornosciaNaRestart(klient) {
  const ponawiany = (nazwa) => async (...argumenty) => {
    try {
      return await klient[nazwa](...argumenty)
    } catch (pierwszy) {
      klient.zamknij()
      try {
        return await klient[nazwa](...argumenty)
      } catch {
        throw pierwszy
      }
    }
  }
  const bezPonowienia = (nazwa) => async (...argumenty) => {
    try {
      return await klient[nazwa](...argumenty)
    } catch (e) {
      klient.zamknij()
      throw e
    }
  }
  return {
    ...klient,
    odczytaj: ponawiany('odczytaj'),
    pobierzSpec: ponawiany('pobierzSpec'),
    zmien: bezPonowienia('zmien'),
    wykonaj: bezPonowienia('wykonaj'),
  }
}

/**
 * Obserwator identyfikatorow. Czym jest, a czym nie jest:
 *
 * NIE jest kontrola. Kontrola sukcesu siedzi w ustalWynik() - odczycie z silnika.
 * Jest wylacznie zrodlem tego, CO pokazac operatorowi w ramce. Wczesniej model
 * dopisywal "WORKFLOW_ID: <id>" ostatnia linia odpowiedzi; to znaczylo, ze model,
 * ktory zapomni tej linii, zabiera aplikacji mozliwosc sprawdzenia przebiegu -
 * a wiec dokladnie ten model, ktory klamie o sukcesie, najlatwiej uciekal spod
 * kontroli z par. 13.5 E8. Dlatego identyfikatory bierzemy z tego, co naprawde
 * przeszlo przez bramke, a nie z tresci odpowiedzi.
 */
function zObserwacja(klient) {
  let tura = null

  const zapamietaj = (pola) => { if (tura) Object.assign(tura, pola) }

  return {
    klient: {
      ...klient,
      async zmien(argumenty) {
        const wynik = await klient.zmien(argumenty)
        const dane = klient.dane(wynik)
        const zapisano = argumenty?.mode === 'apply' && dane?.applied !== false
        if (zapisano && argumenty?.name) zapamietaj({ dagName: String(argumenty.name) })
        return wynik
      },
      async wykonaj(argumenty) {
        const wynik = await klient.wykonaj(argumenty)
        const dane = klient.dane(wynik)
        const dagName = dane?.dagName ?? dane?.run?.name ?? argumenty?.name ?? null
        const dagRunId = dane?.dagRunId ?? dane?.run?.dagRunId ?? null
        if (dagName) zapamietaj({ dagName: String(dagName) })
        if (dagRunId) zapamietaj({ dagRunId: String(dagRunId) })
        return wynik
      },
    },
    rozpocznij() { tura = { dagName: null, dagRunId: null } },
    zakoncz() { const x = tura; tura = null; return x ?? { dagName: null, dagRunId: null } },
  }
}

// Tury czatu sa szeregowane. Powod jest wprost taki: obserwator wyzej wiaze
// wywolania bramki z JEDNA tura, a bramka nie wie, ktory proces CLI ja wywolal.
// Dwie rownolegle tury wymieszalyby identyfikatory, wiec zamiast zgadywac -
// czekamy. Prototyp jest jednoosobowy (model zagrozen par. 5.2), a panel czatu
// i tak blokuje pole tekstowe na czas odpowiedzi.
let kolejka = Promise.resolve()
const wKolejce = (zadanie) => {
  const wynik = kolejka.then(zadanie, zadanie)
  kolejka = wynik.then(() => undefined, () => undefined)
  return wynik
}

const stan = {
  rejestr: null, zezwolenia: null, klient: null, obserwator: null, mcp: null, sesja: null,
  system: SYSTEM_BAZOWY,
}

async function przygotujPolityke() {
  if (!srodowisko.mcpUrl) {
    throw new Error('brak DAGU_MCP_URL - backend nie wie, gdzie stoi MCP silnika')
  }
  // Bez rejestru kontraktow polityka nie ma czego egzekwowac, wiec backend NIE WSTAJE.
  // Katalog kontrakty/ nie jest w obrazie (kontekst budowania to ./chat-backend) -
  // musi byc zamontowany read-only przez compose.
  try {
    stan.rejestr = await wczytajRejestr(srodowisko.kontraktyDir)
  } catch (e) {
    throw new Error(
      `nie udalo sie wczytac zatwierdzonych kontraktow z ${srodowisko.kontraktyDir}: ${e.message}. `
      + 'Compose musi montowac ./kontrakty:/app/kontrakty:ro albo ustawic KONTRAKTY_DIR.')
  }
  stan.zezwolenia = await utworzRejestrZezwolen({ plik: srodowisko.zezwoleniaPlik })
  // Klucz silnika zyje wylacznie w tym domknieciu i nie opuszcza backendu:
  // model dostaje adres NASZEGO serwera MCP, nie adres Dagu (KONTRAKT.md par. 4.5).
  const surowy = utworzKlienta({ url: srodowisko.mcpUrl, klucz: srodowisko.mcpToken })
  const odporny = zOdpornosciaNaRestart(surowy)
  stan.obserwator = zObserwacja(odporny)
  stan.klient = odporny
  stan.mcp = await uruchomSerwerMcp({
    host: '127.0.0.1',
    port: srodowisko.politykaPort,
    sekret: srodowisko.politykaSekret,
    klient: stan.obserwator.klient,
    rejestr: stan.rejestr,
    zezwolenia: stan.zezwolenia,
    odczytajPlikBazowy: srodowisko.plikBazowy
      ? () => readFile(srodowisko.plikBazowy, 'utf8')
      : null,
    logger: console,
  })
  stan.system = `${SYSTEM_BAZOWY}\n\n${katalogKontraktow(stan.rejestr)}`
  console.log(`polityka: bramka MCP na ${stan.mcp.url}, kontraktow: ${stan.rejestr.lista().length},`
    + ` prompt systemowy: ${stan.system.length} znakow`)
}

// --- model --------------------------------------------------------------------

function runClaude(message, sessionId) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p', message,
      // Wskazuje na bramke polityki (127.0.0.1), nie na MCP silnika. --strict-mcp-config
      // jest obowiazkowe: bez niego CLI dociagnelo by konfiguracje MCP uzytkownika
      // i model mogl by odzyskac bezposrednie polaczenie z Dagu (KONTRAKT.md par. 4.7).
      '--mcp-config', MCP_CONFIG,
      '--strict-mcp-config',
      '--allowedTools', ALLOWED,
      '--disallowedTools', DISALLOWED,
      '--append-system-prompt', stan.system,
      '--output-format', 'json',
    ]
    if (sessionId) args.push('--resume', sessionId)

    // stdin zamkniety: inaczej CLI czeka 3 s na dane, po czym pisze ostrzezenie
    // do stderr - to wlasnie ono przykrywalo prawdziwy komunikat bledu.
    const child = spawn('claude', args, { cwd: '/app', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('przekroczono limit czasu')) }, TIMEOUT_MS)

    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => {
      clearTimeout(timer)
      // CLI potrafi zwrocic kod != 0 i JEDNOCZESNIE poprawny JSON z opisem bledu
      // (np. wygasle logowanie). Najpierw czytamy stdout, bo tam jest tresc.
      let parsed = null
      try { parsed = JSON.parse(out) } catch { /* ponizej */ }

      if (parsed && parsed.is_error) {
        return reject(new Error(String(parsed.result || 'model zwrocil blad bez opisu')))
      }
      if (parsed) return resolve(parsed)
      reject(new Error(
        err.trim().slice(-600) || out.trim().slice(0, 600) || `claude zakonczyl sie kodem ${code}`,
      ))
    })
  })
}

// --- odczyt z silnika ---------------------------------------------------------

const czekaj = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Sukces ustalamy odczytem z silnika po dagRunId (par. 4.3, par. 13.5 E8).
 * Gdy model wrocil, zanim przebieg sie domknal, dopytujemy przez ograniczony
 * czas - "running" to nie jest ani sukces, ani porazka i nie wolno go zaokraglic
 * w zadna strone.
 */
async function wynikPrzebiegu(dagName, dagRunId) {
  const koniec = Date.now() + BUDZET_DOMKNIECIA_MS
  let wynik = await ustalWynik({ klient: stan.klient, dagName, dagRunId })
  while (wynik.ok && wynik.wToku && Date.now() < koniec) {
    await czekaj(ODSTEP_DOPYTANIA_MS)
    wynik = await ustalWynik({ klient: stan.klient, dagName, dagRunId })
  }
  return wynik
}

/**
 * Polska nazwa wyswietlana procesu: pole description definicji (par. 4.2).
 *
 * "Silnik nie zna takiego procesu" i "nie udalo sie zapytac silnika" to DWA
 * ROZNE zdania i nie wolno ich skleic. Sklejone, awaria polaczenia wyglada dla
 * operatora jak usuniety proces.
 */
async function opisProcesu(dagName) {
  if (!dagName) return { istnieje: false, nazwaWyswietlana: null, blad: null }
  try {
    const odpowiedz = stan.klient.dane(await stan.klient.odczytaj({ target: 'dag', name: dagName }))
    const dane = odpowiedz?.data ?? odpowiedz
    if (!dane || typeof dane !== 'object' || !dane.name) {
      return { istnieje: false, nazwaWyswietlana: null, blad: null }
    }
    const opis = typeof dane.description === 'string' ? dane.description.trim() : ''
    return { istnieje: true, nazwaWyswietlana: opis || null, blad: null }
  } catch (e) {
    console.error(`odczyt procesu "${dagName}":`, e.message)
    return { istnieje: false, nazwaWyswietlana: null, blad: e.message }
  }
}

// --- HTTP ---------------------------------------------------------------------

const json = (res, status, body) => {
  const s = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s) })
  res.end(s)
}

const czytajCialo = (req, limit = 100_000) => new Promise((resolve, reject) => {
  let body = ''
  req.on('data', (c) => { body += c; if (body.length > limit) req.destroy() })
  req.on('end', () => resolve(body))
  req.on('error', reject)
})

/**
 * Linijka kontekstu dla modelu. Kontekst pochodzi z tego, co ramka FAKTYCZNIE
 * pokazuje (frontend czyta to z iframe'a), a nie z ostatniego procesu modelu -
 * inaczej po recznej nawigacji operatora czat mowilby o czyms innym niz to,
 * na co operator patrzy (par. 13.5 E3).
 */
function liniaKontekstu({ dagName, dagRunId, nazwaWyswietlana, sciezkaRamki }) {
  if (!dagName) {
    // Widoki silnika poza lista procesow (kolejki, wiki, zdarzenia) tez istnieja.
    // Mowimy, co jest naprawde otwarte, zamiast zaokraglac wszystko do "lista".
    const gdzie = sciezkaRamki && !/^\/dagu\/dags\/?$/.test(sciezkaRamki)
      ? ` Otwarty widok silnika: ${sciezkaRamki}.`
      : ''
    return '[Kontekst: użytkownik nie ogląda w ramce obok konkretnego procesu.' + gdzie + ']'
  }
  const nazwa = nazwaWyswietlana ? ` („${nazwaWyswietlana}")` : ''
  if (dagRunId) {
    return `[Kontekst: użytkownik ogląda w ramce obok wykonanie ${dagRunId} procesu ` +
      `${dagName}${nazwa}.]`
  }
  return `[Kontekst: użytkownik ogląda w ramce obok proces ${dagName}${nazwa}, bez konkretnego wykonania.]`
}

const WZORZEC_NAZWY = /^[a-z0-9][a-z0-9-]{0,38}$/
const WZORZEC_WYKONANIA = /^[A-Za-z0-9_-]{1,64}$/

async function obsluzCzat(req, res) {
  const kontrola = await stan.sesja.sprawdz(req)
  if (!kontrola.ok) {
    return json(res, kontrola.status ?? 401, { error: kontrola.komunikat ?? 'wymagana sesja' })
  }

  let parsed
  try { parsed = JSON.parse(await czytajCialo(req)) } catch { return json(res, 400, { error: 'nieprawidlowy JSON' }) }
  const message = String(parsed.message ?? '').trim()
  if (!message) return json(res, 400, { error: 'pusta wiadomosc' })

  // Wiazanie rozmowy z sesja (par. 13.3 S3, chat-backend/sesja/KONTRAKT.md par. 1.3).
  // sessionId przychodzi z CIALA zadania i idzie prosto do `claude --resume`, wiec bez
  // tego sprawdzenia druga sesja operatora wznowilaby cudza rozmowe, znajac samo jej id.
  // Modul sesji nie moze tego wymusic sam - nie widzi ciala zadania.
  const sesja = kontrola.sesja ?? null
  if (typeof sesja?.czyRozmowaNalezy === 'function'
      && !sesja.czyRozmowaNalezy(parsed.sessionId ?? null)) {
    return json(res, 403, { error: 'Ta rozmowa należy do innej sesji.' })
  }

  const otwartyProces = WZORZEC_NAZWY.test(String(parsed.dagName ?? '')) ? String(parsed.dagName) : null
  const otwarteWykonanie = otwartyProces && WZORZEC_WYKONANIA.test(String(parsed.dagRunId ?? ''))
    ? String(parsed.dagRunId) : null
  const surowaSciezka = String(parsed.sciezkaRamki ?? '')
  const sciezkaRamki = /^\/dagu\/[A-Za-z0-9/_.\-]{0,200}$/.test(surowaSciezka) ? surowaSciezka : null
  const { nazwaWyswietlana: nazwaOtwartego } = await opisProcesu(otwartyProces)
  const prompt = `${liniaKontekstu({
    dagName: otwartyProces, dagRunId: otwarteWykonanie,
    nazwaWyswietlana: nazwaOtwartego, sciezkaRamki,
  })}\n\n${message}`

  const creds = credentialStatus(CRED_SEED)
  if (!creds.ok) {
    console.error('poswiadczenia:', creds.reason)
    return json(res, 503, { error: creds.message })
  }
  syncCredentials(CRED_SEED, CRED_LIVE)

  try {
    const { odpowiedz, obserwacja } = await wKolejce(async () => {
      stan.obserwator.rozpocznij()
      try {
        const r = await runClaude(prompt, parsed.sessionId || null)
        return { odpowiedz: r, obserwacja: stan.obserwator.zakoncz() }
      } catch (e) {
        // Tura przerwana (limit czasu, blad CLI) nie znaczy, ze nic sie nie stalo.
        // Model mogl juz zapisac albo uruchomic proces - wtedy operator ma prawo
        // go zobaczyc, zamiast dostac samo "przekroczono limit czasu" i puste UI.
        e.obserwacja = stan.obserwator.zakoncz()
        throw e
      }
    })

    const text = String(odpowiedz.result ?? '')
    if (typeof sesja?.zwiazRozmowe === 'function' && odpowiedz.session_id) {
      sesja.zwiazRozmowe(odpowiedz.session_id)
    }
    const dagName = obserwacja.dagName ?? otwartyProces
    const dagRunId = obserwacja.dagRunId
    const { nazwaWyswietlana } = await opisProcesu(dagName)

    let statusLabel = null
    let wToku = false
    let ostrzezenie = null
    if (dagRunId) {
      const wynik = await wynikPrzebiegu(dagName, dagRunId)
      const werdykt = pogodzOdpowiedzModelu({ tekstModelu: text, wynik })
      statusLabel = wynik.statusLabel
      wToku = Boolean(wynik.ok && wynik.wToku)
      // Przy przebiegu wciaz trwajacym nie oglaszamy bledu - ale tez nie
      // potwierdzamy sukcesu; UI pokazuje status i tyle.
      ostrzezenie = werdykt.ok || wToku ? null : werdykt.komunikat
    }

    json(res, 200, {
      reply: text,
      dagName: dagName ?? null,
      dagRunId: dagRunId ?? null,
      nazwaWyswietlana,
      sessionId: odpowiedz.session_id ?? null,
      // costUsd to liczba raportowana przez CLI modelu - SZACUNEK ZUZYCIA, a nie
      // potwierdzona doplata do abonamentu (par. 4.3). Frontend ma ja tak podpisac.
      costUsd: odpowiedz.total_cost_usd ?? null,
      durationMs: odpowiedz.duration_ms ?? null,
      statusLabel,
      wToku,
      ostrzezenie,
    })
  } catch (e) {
    console.error('blad czatu:', e.message)
    const slad = e.obserwacja ?? { dagName: null, dagRunId: null }
    json(res, 500, {
      error: e.message,
      dagName: slad.dagName ?? null,
      dagRunId: slad.dagRunId ?? null,
    })
  }
}

async function obsluzProces(req, res, adres) {
  const kontrola = await stan.sesja.sprawdz(req)
  if (!kontrola.ok) {
    return json(res, kontrola.status ?? 401, { error: kontrola.komunikat ?? 'wymagana sesja' })
  }
  const nazwa = String(adres.searchParams.get('nazwa') ?? '')
  if (!WZORZEC_NAZWY.test(nazwa)) {
    return json(res, 400, {
      error: `Identyfikator "${nazwa}" nie pasuje do wzorca ^[a-z0-9][a-z0-9-]{0,38}$.`,
      dagName: nazwa, istnieje: false, nazwaWyswietlana: null,
    })
  }
  const opis = await opisProcesu(nazwa)
  if (opis.blad) {
    return json(res, 503, {
      error: `Nie udało się zapytać silnika o proces „${nazwa}”: ${opis.blad}`,
      dagName: nazwa, istnieje: null, nazwaWyswietlana: null,
    })
  }
  json(res, 200, { dagName: nazwa, istnieje: opis.istnieje, nazwaWyswietlana: opis.nazwaWyswietlana })
}

const server = createServer((req, res) => {
  const adres = new URL(req.url, 'http://127.0.0.1')

  ;(async () => {
    // Trasy sesji (logowanie, wylogowanie) obsluguje modul T1, zanim cokolwiek innego.
    if (await stan.sesja.obsluz(req, res)) return

    if (req.method === 'GET' && adres.pathname === '/api/health') {
      const creds = credentialStatus(CRED_SEED)
      return json(res, 200, {
        ok: true,
        credentials: creds.ok ? 'wazne' : creds.reason,
        expiresAt: creds.expiresAt ? new Date(creds.expiresAt).toISOString() : null,
        polityka: stan.mcp ? 'gotowa' : 'niedostepna',
        sesja: stan.sesja.dostepna ? 'podpieta' : `niepodpieta: ${stan.sesja.powod}`,
      })
    }
    // Nazwa wyswietlana procesu dla ramki: par. 4.2 rozdziela identyfikator techniczny
    // (idzie do URL) od nazwy polskiej (idzie do UI), a nazwa siedzi w definicji w silniku.
    if (req.method === 'GET' && adres.pathname === '/api/proces') return obsluzProces(req, res, adres)
    if (req.method === 'POST' && adres.pathname === '/api/chat') return obsluzCzat(req, res)
    return json(res, 404, { error: 'nie znaleziono' })
  })().catch((e) => {
    console.error('blad serwera:', e.message)
    if (!res.headersSent) json(res, 500, { error: 'blad wewnetrzny backendu' })
  })
})

server.headersTimeout = TIMEOUT_MS + 20_000
server.requestTimeout = TIMEOUT_MS + 20_000

const start = async () => {
  stan.sesja = await wczytajBrameSesji({ backend: 'chat' })
  if (!stan.sesja.dostepna) {
    console.warn(`UWAGA: modul sesji niepodpiety (${stan.sesja.powod}) - /api/chat odmawia 401`)
  }
  await przygotujPolityke()
  server.listen(PORT, () => console.log(`chat-backend nasluchuje na :${PORT}`))
}

start().catch((e) => {
  console.error('start nieudany:', e.message)
  process.exit(1)
})
