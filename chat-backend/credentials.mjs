import { copyFileSync, chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Poswiadczenia Claude Code montowane sa read-only z hosta (SEED) i kopiowane
 * do zapisywalnego miejsca w kontenerze (LIVE).
 *
 * Kopia MUSI powstawac przed kazdym wywolaniem, nie raz przy starcie kontenera:
 * token dostepowy zyje kilka godzin, a host odswieza go w tle. Kontener dzialajacy
 * dobe mial kopie starsza niz token i konczyl kazde zapytanie bledem
 * "OAuth session expired and could not be refreshed".
 *
 * Gdy token z hosta jest juz przeterminowany, celowo NIE uruchamiamy CLI:
 * odswiezenie w kontenerze zrotowaloby refresh token, ktorego kopia i tak nie
 * wrocilaby na hosta - i wylogowaloby uzytkownika na jego wlasnej maszynie.
 */

export const SKEW_MS = 60_000

export function readCredentials(seedPath) {
  const raw = readFileSync(seedPath, 'utf8')
  const parsed = JSON.parse(raw)
  const oauth = parsed?.claudeAiOauth
  if (!oauth || typeof oauth.expiresAt !== 'number') {
    throw new Error('nieoczekiwany format poswiadczen')
  }
  return oauth
}

export function credentialStatus(seedPath, now = Date.now()) {
  let oauth
  try {
    oauth = readCredentials(seedPath)
  } catch (e) {
    return {
      ok: false,
      reason: 'brak-poswiadczen',
      message:
        'Backend nie widzi poświadczeń Claude Code. Sprawdź, czy ~/.claude/.credentials.json ' +
        'istnieje na hoście i czy kontener ma go zamontowanego.',
    }
  }
  if (oauth.expiresAt - SKEW_MS <= now) {
    return {
      ok: false,
      reason: 'wygasle',
      expiresAt: oauth.expiresAt,
      message:
        'Logowanie Claude Code wygasło. Uruchom `claude` na hoście (wystarczy raz) — ' +
        'odświeży token, a czat zacznie działać bez restartu kontenera.',
    }
  }
  return { ok: true, expiresAt: oauth.expiresAt }
}

export function syncCredentials(seedPath, livePath) {
  mkdirSync(dirname(livePath), { recursive: true })
  copyFileSync(seedPath, livePath)
  chmodSync(livePath, 0o600)
}

/**
 * Konfiguracja modelu CLI (settings.json na hoscie, np. przelaczenie na GLM przez
 * ANTHROPIC_BASE_URL) jedzie tym samym kanalem co poswiadczenia: sidecar
 * `poswiadczenia` obserwuje plik na hoscie, backend kopiuje go do $HOME/.claude
 * przed kazdym zapytaniem.
 *
 * Z settings.json przenosimy WYLACZNIE blok "env". Reszta (hooks, permissions)
 * jest konfiguracja srodowiska hosta i w kontenerze ma prawouterwnie nie dzialac -
 * zabranie jej byle jakim sposobem moglo by zmienic zachowanie CLI w kontenerze
 * w sposob, ktorego nikt nie akceptowal.
 *
 * Brak pliku na hoscie kasuje kopie w kontenerze - inaczej po wylogowaniu modeli
 * na hoscie kontener biegalby dalej na zmyślonej konfiguracji.
 */
export function syncCliSettings(seedPath, livePath) {
  let raw
  try {
    raw = readFileSync(seedPath, 'utf8')
  } catch {
    try { unlinkSync(livePath) } catch {}
    return { ok: false, powod: 'brak-pliku' }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { ok: false, powod: 'niepoprawny-json', blad: String(e.message ?? e) }
  }
  const env = parsed?.env
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    try { unlinkSync(livePath) } catch {}
    return { ok: false, powod: 'brak-bloku-env' }
  }
  mkdirSync(dirname(livePath), { recursive: true })
  writeFileSync(livePath, JSON.stringify({ env }, null, 2))
  chmodSync(livePath, 0o600)
  return { ok: true, klucze: Object.keys(env).sort() }
}
