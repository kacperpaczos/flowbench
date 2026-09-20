import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialStatus, syncCredentials, syncCliSettings, SKEW_MS } from '../credentials.mjs'

const dir = mkdtempSync(join(tmpdir(), 'creds-'))
const seed = join(dir, 'seed.json')
const live = join(dir, 'nested', 'live.json')
const write = (expiresAt) =>
  writeFileSync(seed, JSON.stringify({ claudeAiOauth: { accessToken: 'a', refreshToken: 'r', expiresAt } }))

const NOW = 1_800_000_000_000

test('token wazny -> zgoda na wywolanie', () => {
  write(NOW + 3600_000)
  assert.equal(credentialStatus(seed, NOW).ok, true)
})

test('token wygasly -> odmowa z instrukcja, bez uruchamiania CLI', () => {
  write(NOW - 1000)
  const s = credentialStatus(seed, NOW)
  assert.equal(s.ok, false)
  assert.equal(s.reason, 'wygasle')
  assert.match(s.message, /claude` na hoście/)
})

test('token tuz przed wygasnieciem traktowany jak wygasly (margines)', () => {
  write(NOW + SKEW_MS - 1)
  assert.equal(credentialStatus(seed, NOW).ok, false)
})

test('brak pliku -> czytelny komunikat, nie wyjatek', () => {
  const s = credentialStatus(join(dir, 'nie-ma.json'), NOW)
  assert.equal(s.ok, false)
  assert.equal(s.reason, 'brak-poswiadczen')
})

test('sync kopiuje aktualna tresc i ustawia prawa 600', () => {
  write(NOW + 3600_000)
  syncCredentials(seed, live)
  assert.equal(readFileSync(live, 'utf8'), readFileSync(seed, 'utf8'))
  assert.equal(statSync(live).mode & 0o777, 0o600)
})

test('powtorny sync nadpisuje stara kopie nowa trescia z hosta', () => {
  write(NOW + 3600_000)
  syncCredentials(seed, live)
  const stary = readFileSync(live, 'utf8')
  write(NOW + 7200_000)                 // host odswiezyl token
  syncCredentials(seed, live)
  assert.notEqual(readFileSync(live, 'utf8'), stary)
  assert.equal(readFileSync(live, 'utf8'), readFileSync(seed, 'utf8'))
})

test('syncCliSettings: przenosi wylacznie blok env, prawa 600', () => {
  const seedS = join(dir, 'settings.json')
  const liveS = join(dir, 'nested', 'settings-live.json')
  writeFileSync(seedS, JSON.stringify({
    env: { ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic', ANTHROPIC_AUTH_TOKEN: 'x' },
    hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'evil' }] }] },
    permissions: { defaultMode: 'auto' },
  }))
  const r = syncCliSettings(seedS, liveS)
  assert.equal(r.ok, true)
  assert.deepEqual(r.klucze, ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'])
  const zapisane = JSON.parse(readFileSync(liveS, 'utf8'))
  assert.deepEqual(Object.keys(zapisane), ['env'])
  assert.equal(zapisane.env.ANTHROPIC_BASE_URL, 'https://api.z.ai/api/anthropic')
  assert.equal((statSync(liveS).mode & 0o777), 0o600)
  assert.equal('hooks' in zapisane, false)
  assert.equal('permissions' in zapisane, false)
})

test('syncCliSettings: brak pliku na hoscie kasuje kopie (nie zostaje zmyślona konfiguracja)', () => {
  const liveS = join(dir, 'nested', 'settings-live.json')
  const r = syncCliSettings(join(dir, 'nie-ma.json'), liveS)
  assert.equal(r.ok, false)
  assert.equal(r.powod, 'brak-pliku')
  assert.throws(() => statSync(liveS))
})

test('syncCliSettings: blok env bez zadanego pola env kasuje kopie', () => {
  const seedS = join(dir, 'settings-bez-env.json')
  const liveS = join(dir, 'nested', 'settings-live2.json')
  writeFileSync(seedS, JSON.stringify({ permissions: { defaultMode: 'auto' } }))
  syncCliSettings(seedS, liveS)
  const r = syncCliSettings(seedS, liveS)
  assert.equal(r.ok, false)
  assert.equal(r.powod, 'brak-bloku-env')
  assert.throws(() => statSync(liveS))
})
