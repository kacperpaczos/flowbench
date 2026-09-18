import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { credentialStatus, syncCredentials } from './credentials.mjs'

const PORT = 8787
const MCP_CONFIG = '/app/mcp.json'
const TIMEOUT_MS = 240_000
const CRED_SEED = '/seed/.credentials.json'
const CRED_LIVE = `${process.env.HOME}/.claude/.credentials.json`

const SYSTEM = `Jesteś asystentem wbudowanym w firmowe narzędzie do procesów.
Odpowiadasz po polsku, zwięźle, bez emoji i bez markdownowych nagłówków.

Masz dostęp WYŁĄCZNIE do narzędzi MCP instancji n8n. Nie masz dostępu do plików ani powłoki.

Gdy użytkownik prosi o workflow:
1. Wywołaj get_workflow_sdk_reference, zanim napiszesz kod SDK.
2. Sprawdź kod przez validate_workflow.
3. Utwórz workflow przez create_workflow_from_code.
4. Uruchom go przez execute_workflow w trybie "manual".
5. Pobierz wynik przez get_workflow_execution z includeData=true i opisz go w jednym akapicie.

Buduj workflow, które działają bez zewnętrznych kont i poświadczeń: ręczny trigger,
węzły Set i Code. Jeśli zadanie wymaga zewnętrznej usługi, powiedz to wprost i zaproponuj
wersję na danych przykładowych.

Na początku wiadomości użytkownika możesz dostać linijkę [Kontekst: ...] opisującą, co
użytkownik ma teraz otwarte w edytorze obok. To nie jest jego tekst — nie komentuj jej,
tylko wykorzystaj. Gdy pyta o "ten workflow" albo "w jakim jestem workflow", odnieś się do
id z kontekstu i w razie potrzeby sprawdź szczegóły przez get_workflow_details.

Jeżeli w trakcie odpowiedzi powstał lub został uruchomiony workflow, zakończ wiadomość
osobną ostatnią linią dokładnie w formacie:
WORKFLOW_ID: <id>
Nie dodawaj tej linii, gdy żaden workflow nie powstał.`

const ALLOWED = 'mcp__n8n'
const DISALLOWED = 'Bash,Read,Write,Edit,NotebookEdit,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite'

function runClaude(message, sessionId) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p', message,
      '--mcp-config', MCP_CONFIG,
      '--strict-mcp-config',
      '--allowedTools', ALLOWED,
      '--disallowedTools', DISALLOWED,
      '--append-system-prompt', SYSTEM,
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

const json = (res, status, body) => {
  const s = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s) })
  res.end(s)
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/health') {
    const creds = credentialStatus(CRED_SEED)
    return json(res, 200, {
      ok: true,
      credentials: creds.ok ? 'wazne' : creds.reason,
      expiresAt: creds.expiresAt ? new Date(creds.expiresAt).toISOString() : null,
    })
  }
  if (req.method !== 'POST' || req.url !== '/api/chat') return json(res, 404, { error: 'nie znaleziono' })

  let body = ''
  req.on('data', (c) => { body += c; if (body.length > 100_000) req.destroy() })
  req.on('end', async () => {
    let parsed
    try { parsed = JSON.parse(body) } catch { return json(res, 400, { error: 'nieprawidlowy JSON' }) }
    const message = String(parsed.message ?? '').trim()
    if (!message) return json(res, 400, { error: 'pusta wiadomosc' })

    // Model nie widzi iframe'a. Bez tego pytania w rodzaju "w jakim jestem workflow"
    // sa nie do odpowiedzenia.
    const openId = String(parsed.workflowId ?? '').trim()
    const context = /^[A-Za-z0-9_-]{1,64}$/.test(openId)
      ? `[Kontekst: użytkownik ma teraz otwarty w edytorze workflow o id ${openId}.]`
      : '[Kontekst: w edytorze otwarta jest lista workflow, użytkownik nie ogląda konkretnego workflow.]'
    const prompt = `${context}\n\n${message}`

    const creds = credentialStatus(CRED_SEED)
    if (!creds.ok) {
      console.error('poswiadczenia:', creds.reason)
      return json(res, 503, { error: creds.message })
    }
    syncCredentials(CRED_SEED, CRED_LIVE)

    try {
      const r = await runClaude(prompt, parsed.sessionId || null)
      const text = String(r.result ?? '')
      const m = text.match(/^WORKFLOW_ID:\s*([A-Za-z0-9_-]+)\s*$/m)
      json(res, 200, {
        reply: text.replace(/^WORKFLOW_ID:.*$/m, '').trim(),
        workflowId: m ? m[1] : null,
        sessionId: r.session_id ?? null,
        costUsd: r.total_cost_usd ?? null,
        durationMs: r.duration_ms ?? null,
      })
    } catch (e) {
      console.error('blad czatu:', e.message)
      json(res, 500, { error: e.message })
    }
  })
})

server.headersTimeout = TIMEOUT_MS + 20_000
server.requestTimeout = TIMEOUT_MS + 20_000
server.listen(PORT, () => console.log(`chat-backend nasluchuje na :${PORT}`))
