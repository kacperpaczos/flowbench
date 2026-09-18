// Testy jednostkowe bramy sesji (T1). Bez sieci — sztuczne req/res.
// Dowody end-to-end wobec zywego stacku sa w raporcie T1.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { utworzBrameSesji } from '../../sesja/index.mjs'

const ORIGIN = 'http://127.0.0.1:8080'
const SRODOWISKO = { SESJA_HASLO: 'tajne-haslo-operatora', SESJA_ORIGIN: ORIGIN, SESJA_TTL_H: '8' }

function zadanie({ metoda = 'POST', url = '/api/chat', naglowki = {}, cialo = null } = {}) {
  const req = {
    method: metoda,
    url,
    headers: Object.fromEntries(Object.entries(naglowki).map(([k, v]) => [k.toLowerCase(), v])),
  }
  req[Symbol.asyncIterator] = async function* () {
    if (cialo !== null) yield Buffer.from(typeof cialo === 'string' ? cialo : JSON.stringify(cialo))
  }
  return req
}

function odpowiedz() {
  return {
    kod: null, naglowki: null, tresc: null, wyslana: false,
    writeHead(kod, naglowki) { this.kod = kod; this.naglowki = naglowki },
    end(tresc) { this.tresc = tresc ? JSON.parse(tresc) : null; this.wyslana = true },
  }
}

async function zaloguj(brama, haslo = SRODOWISKO.SESJA_HASLO) {
  const req = zadanie({ url: '/api/sesja/logowanie', naglowki: { origin: ORIGIN }, cialo: { haslo } })
  const res = odpowiedz()
  const obsluzone = await brama.obsluz(req, res)
  return { obsluzone, res, ciasteczko: res.naglowki?.['Set-Cookie'] ?? null }
}

/** Z naglowka Set-Cookie robi naglowek Cookie do kolejnego zadania. */
const jakoCookie = (setCookie) => setCookie.split(';')[0]

test('bez sesji: /api/chat odmawia 401', () => {
  const brama = utworzBrameSesji({ srodowisko: SRODOWISKO })
  const w = brama.sprawdz(zadanie({ naglowki: { origin: ORIGIN } }))
  assert.equal(w.ok, false)
  assert.equal(w.status, 401)
})

test('logowanie zlym haslem: 401, bez ciasteczka', async () => {
  const brama = utworzBrameSesji({ srodowisko: SRODOWISKO })
  const { res, ciasteczko } = await zaloguj(brama, 'nie-to-haslo')
  assert.equal(res.kod, 401)
  assert.equal(ciasteczko, null)
})

test('logowanie dobrym haslem: 200 i ciasteczko HttpOnly SameSite=Strict', async () => {
  const brama = utworzBrameSesji({ srodowisko: SRODOWISKO })
  const { res, ciasteczko } = await zaloguj(brama)
  assert.equal(res.kod, 200)
  assert.match(ciasteczko, /^sesja_operatora=/)
  assert.match(ciasteczko, /HttpOnly/)
  assert.match(ciasteczko, /SameSite=Strict/)
  // Path=/ jest wymagane przez forward_auth na /dagu/* — uzasadnienie w module.
  assert.match(ciasteczko, /Path=\/(;|$)/)
  assert.doesNotMatch(ciasteczko, /Secure/)      // lokalnie po HTTP, swiadomie
})

test('z sesja: /api/chat przechodzi', async () => {
  const brama = utworzBrameSesji({ srodowisko: SRODOWISKO })
  const { ciasteczko } = await zaloguj(brama)
  const w = brama.sprawdz(zadanie({ naglowki: { origin: ORIGIN, cookie: jakoCookie(ciasteczko) } }))
  assert.equal(w.ok, true)
  assert.ok(w.sesja)
})

test('obcy Origin: 403 nawet z waznym ciasteczkiem', async () => {
  const brama = utworzBrameSesji({ srodowisko: SRODOWISKO })
  const { ciasteczko } = await zaloguj(brama)
  const w = brama.sprawdz(zadanie({ naglowki: { origin: 'http://evil.example', cookie: jakoCookie(ciasteczko) } }))
  assert.equal(w.ok, false)
  assert.equal(w.status, 403)
})

test('POST bez Origin i bez Sec-Fetch-Site: 403', async () => {
  const brama = utworzBrameSesji({ srodowisko: SRODOWISKO })
  const { ciasteczko } = await zaloguj(brama)
  const w = brama.sprawdz(zadanie({ naglowki: { cookie: jakoCookie(ciasteczko) } }))
  assert.equal(w.status, 403)
})

test('GET bez Origin przechodzi (przegladarka nie wysyla Origin przy GET)', async () => {
  const brama = utworzBrameSesji({ srodowisko: SRODOWISKO })
  const { ciasteczko } = await zaloguj(brama)
  const w = brama.sprawdz(zadanie({ metoda: 'GET', url: '/api/proces', naglowki: { cookie: jakoCookie(ciasteczko) } }))
  assert.equal(w.ok, true)
})

test('wylogowanie unieważnia SERWEROWO: to samo ciasteczko daje 401', async () => {
  const brama = utworzBrameSesji({ srodowisko: SRODOWISKO })
  const { ciasteczko } = await zaloguj(brama)
  const cookie = jakoCookie(ciasteczko)
  assert.equal(brama.sprawdz(zadanie({ naglowki: { origin: ORIGIN, cookie } })).ok, true)

  const res = odpowiedz()
  await brama.obsluz(zadanie({ url: '/api/sesja/wylogowanie', naglowki: { origin: ORIGIN, cookie } }), res)
  assert.equal(res.kod, 200)

  const po = brama.sprawdz(zadanie({ naglowki: { origin: ORIGIN, cookie } }))
  assert.equal(po.ok, false)
  assert.equal(po.status, 401)
})

test('sesja wygasa po TTL', async () => {
  let zegar = 1_000_000
  const brama = utworzBrameSesji({ srodowisko: { ...SRODOWISKO, SESJA_TTL_H: '1' }, teraz: () => zegar })
  const { ciasteczko } = await zaloguj(brama)
  const cookie = jakoCookie(ciasteczko)
  assert.equal(brama.sprawdz(zadanie({ naglowki: { origin: ORIGIN, cookie } })).ok, true)
  zegar += 3600_000 + 1
  assert.equal(brama.sprawdz(zadanie({ naglowki: { origin: ORIGIN, cookie } })).status, 401)
})

test('rozmowa zwiazana z operatorem: druga sesja nie widzi sessionId pierwszej (S3)', async () => {
  const brama = utworzBrameSesji({ srodowisko: SRODOWISKO })
  const pierwsza = await zaloguj(brama)
  const druga = await zaloguj(brama)

  const s1 = brama.sprawdz(zadanie({ naglowki: { origin: ORIGIN, cookie: jakoCookie(pierwsza.ciasteczko) } })).sesja
  const s2 = brama.sprawdz(zadanie({ naglowki: { origin: ORIGIN, cookie: jakoCookie(druga.ciasteczko) } })).sesja

  s1.zwiazRozmowe('rozmowa-abc')
  assert.equal(s1.czyRozmowaNalezy('rozmowa-abc'), true)
  assert.equal(s2.czyRozmowaNalezy('rozmowa-abc'), false, 'druga sesja nie moze wznowic cudzej rozmowy')
  assert.equal(s2.czyRozmowaNalezy(null), true, 'nowa rozmowa jest dozwolona')
})

test('wylogowanie kasuje tez przypisania rozmow', async () => {
  const brama = utworzBrameSesji({ srodowisko: SRODOWISKO })
  const { ciasteczko } = await zaloguj(brama)
  const cookie = jakoCookie(ciasteczko)
  brama.sprawdz(zadanie({ naglowki: { origin: ORIGIN, cookie } })).sesja.zwiazRozmowe('rozmowa-xyz')
  await brama.obsluz(zadanie({ url: '/api/sesja/wylogowanie', naglowki: { origin: ORIGIN, cookie } }), odpowiedz())

  const znowu = await zaloguj(brama)
  const s = brama.sprawdz(zadanie({ naglowki: { origin: ORIGIN, cookie: jakoCookie(znowu.ciasteczko) } })).sesja
  assert.equal(s.czyRozmowaNalezy('rozmowa-xyz'), false)
})

test('fail closed: brak SESJA_HASLO odmawia wszystkim', () => {
  const brama = utworzBrameSesji({ srodowisko: { SESJA_ORIGIN: ORIGIN } })
  const w = brama.sprawdz(zadanie({ naglowki: { origin: ORIGIN } }))
  assert.equal(w.ok, false)
  assert.equal(w.status, 401)
})

test('GET /api/sesja dziala bez sesji i nie zdradza nic ponad stan', async () => {
  const brama = utworzBrameSesji({ srodowisko: SRODOWISKO })
  const res = odpowiedz()
  const obsluzone = await brama.obsluz(zadanie({ metoda: 'GET', url: '/api/sesja' }), res)
  assert.equal(obsluzone, true)
  assert.equal(res.kod, 200)
  assert.deepEqual(res.tresc, { zalogowany: false, wygasa: null })
})

test('weryfikacja (cel forward_auth): 401 bez sesji, 200 z sesja', async () => {
  const brama = utworzBrameSesji({ srodowisko: SRODOWISKO })

  const bez = odpowiedz()
  assert.equal(await brama.obsluz(zadanie({ metoda: 'GET', url: '/api/sesja/weryfikacja' }), bez), true)
  assert.equal(bez.kod, 401)

  const { ciasteczko } = await zaloguj(brama)
  const z = odpowiedz()
  await brama.obsluz(zadanie({
    metoda: 'GET', url: '/api/sesja/weryfikacja', naglowki: { cookie: jakoCookie(ciasteczko) },
  }), z)
  assert.equal(z.kod, 200)
})

test('weryfikacja z obcym Origin: 403, nie 401', async () => {
  const brama = utworzBrameSesji({ srodowisko: SRODOWISKO })
  const { ciasteczko } = await zaloguj(brama)
  const res = odpowiedz()
  await brama.obsluz(zadanie({
    metoda: 'GET', url: '/api/sesja/weryfikacja',
    naglowki: { origin: 'http://evil.example', cookie: jakoCookie(ciasteczko) },
  }), res)
  assert.equal(res.kod, 403)
})

test('weryfikacja po wylogowaniu znow daje 401', async () => {
  const brama = utworzBrameSesji({ srodowisko: SRODOWISKO })
  const { ciasteczko } = await zaloguj(brama)
  const cookie = jakoCookie(ciasteczko)
  await brama.obsluz(zadanie({ url: '/api/sesja/wylogowanie', naglowki: { origin: ORIGIN, cookie } }), odpowiedz())
  const po = odpowiedz()
  await brama.obsluz(zadanie({ metoda: 'GET', url: '/api/sesja/weryfikacja', naglowki: { cookie } }), po)
  assert.equal(po.kod, 401)
})

test('obsluz() nie przejmuje cudzych tras', async () => {
  const brama = utworzBrameSesji({ srodowisko: SRODOWISKO })
  const res = odpowiedz()
  assert.equal(await brama.obsluz(zadanie({ url: '/api/chat' }), res), false)
  assert.equal(res.wyslana, false)
})
