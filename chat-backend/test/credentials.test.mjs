import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialStatus, syncCredentials, SKEW_MS } from '../credentials.mjs'

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
