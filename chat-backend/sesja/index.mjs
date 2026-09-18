// Brama sesji /api/* — zadanie T1, ryzyko R-A z decyzji par. 5.1/5.2.
//
// Kontrakt tego modulu: chat-backend/sesja/KONTRAKT.md (zapisany PRZED ta
// implementacja). Mechanizm przepisany z dzialajacego stanowiska opisanego
// w docs/audyt-dagu-bezpieczenstwo.md par. P6 — nie wymyslany od nowa.
//
// Dlaczego to nie jest opcja: decyzja par. 5.2 wybrala wariant B2, w ktorym proxy
// samo dokłada tozsamosc admina Dagu do /dagu/*. Kazdy, kto dosiegnie tego originu,
// dostaje UI admina. Origin MUSI byc chroniony sesja — stad "fail closed" ponizej.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const NAZWA_CIASTECZKA = 'sesja_operatora'
// Sciezka ciasteczka to '/' — SWIADOMIE szersza niz pierwotne '/api'.
// Powod: uzgodniona z koordynatorem powierzchnia (chat-backend/brama-sesji.mjs)
// dodaje /api/sesja/weryfikacja jako cel `forward_auth` Caddy'ego, ktorym CALY
// origin — takze /dagu/* — staje za sesja. Przegladarka wysyla ciasteczko tylko
// do sciezek objetych Path, wiec przy Path=/api zadanie o /dagu/* przyszloby bez
// ciasteczka i forward_auth odrzucalby zalogowanego operatora.
// Zawezenie zostaje na innych osiach: HttpOnly + SameSite=Strict.
// Tak samo mial to stanowisko z audytu par. P6 (Path=/).
const SCIEZKA_CIASTECZKA = '/'
const METODY_ZMIENIAJACE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const TRASA_LOGOWANIA = '/api/sesja/logowanie'
const TRASA_WYLOGOWANIA = '/api/sesja/wylogowanie'
const TRASA_STANU = '/api/sesja'
// Cel `forward_auth` Caddy'ego: 200 przy waznej sesji, 401 bez niej. Dzieki temu
// /dagu/* stoi za ta sama brama co /api/* (decyzja par. 5.2: przy wariancie B2
// kazdy, kto dosiegnie originu, dostaje UI admina Dagu).
const TRASA_WERYFIKACJI = '/api/sesja/weryfikacja'

/** Porownanie o stalym czasie, niezalezne od dlugosci wejscia. */
function rowneHasla(podane, oczekiwane) {
  const a = createHash('sha256').update(String(podane), 'utf8').digest()
  const b = createHash('sha256').update(String(oczekiwane), 'utf8').digest()
  return timingSafeEqual(a, b)
}

function czytajCiasteczka(req) {
  const surowe = req.headers?.cookie
  if (!surowe) return {}
  const wynik = {}
  for (const czesc of surowe.split(';')) {
    const i = czesc.indexOf('=')
    if (i < 0) continue
    wynik[czesc.slice(0, i).trim()] = decodeURIComponent(czesc.slice(i + 1).trim())
  }
  return wynik
}

async function czytajCialo(req, limitBajtow = 64 * 1024) {
  const kawalki = []
  let rozmiar = 0
  for await (const kawalek of req) {
    rozmiar += kawalek.length
    if (rozmiar > limitBajtow) throw new Error('cialo zadania za duze')
    kawalki.push(kawalek)
  }
  return Buffer.concat(kawalki).toString('utf8')
}

function odpowiedz(res, kod, cialo, naglowki = {}) {
  const tresc = JSON.stringify(cialo)
  res.writeHead(kod, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(tresc),
    ...naglowki,
  })
  res.end(tresc)
}

export function utworzBrameSesji(opcje = {}) {
  const env = opcje.srodowisko ?? process.env
  const teraz = opcje.teraz ?? (() => Date.now())

  const haslo = env.SESJA_HASLO ?? ''
  const origin = env.SESJA_ORIGIN ?? 'http://localhost:8080'
  const ttlMs = Math.max(1, Number(env.SESJA_TTL_H ?? 8)) * 3600_000
  const secure = env.SESJA_SECURE === '1'

  // Fail closed. Bez hasla brama nie wpuszcza NIKOGO — patrz KONTRAKT par. 0.
  const skonfigurowana = haslo.length > 0
  if (!skonfigurowana) {
    console.warn(
      'UWAGA: SESJA_HASLO nieustawione — brama sesji odmawia kazdemu zadaniu (401). ' +
      'Przy wariancie B2 otwarty origin znaczy otwarty UI admina Dagu.',
    )
  }

  /** sid -> { id, wygasa, rozmowy:Set<string> }. Rejestr SERWEROWY, unieważnialny. */
  const sesje = new Map()

  const sprzatnij = () => {
    const t = teraz()
    for (const [sid, wpis] of sesje) if (wpis.wygasa <= t) sesje.delete(sid)
  }

  /**
   * Kontrola Origin/CSRF. Kolejnosc wzgledem sesji jest istotna: obcy Origin
   * dostaje 403 NAWET z waznym ciasteczkiem (audyt P6, dowod 5).
   */
  const originPasuje = (req) => {
    const podany = req.headers?.origin
    if (podany !== undefined) return podany === origin
    if (!METODY_ZMIENIAJACE.has(String(req.method ?? 'GET').toUpperCase())) {
      // Przegladarka nie wysyla Origin przy zwyklym GET. Trasy czytajace
      // (/api/proces) musza dzialac; nic tu nie zmienia stanu ani nie kosztuje.
      return true
    }
    // Zadanie zmieniajace stan bez Origin: ostatnia szansa to Sec-Fetch-Site.
    const sfs = req.headers?.['sec-fetch-site']
    if (sfs !== undefined) return sfs === 'same-origin'
    return false
  }

  const ciasteczkoSesji = (sid, maxAgeSek) => {
    const czesci = [
      `${NAZWA_CIASTECZKA}=${sid}`,
      `Path=${SCIEZKA_CIASTECZKA}`,
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${maxAgeSek}`,
    ]
    if (secure) czesci.push('Secure')
    return czesci.join('; ')
  }

  const znajdzSesje = (req) => {
    const sid = czytajCiasteczka(req)[NAZWA_CIASTECZKA]
    if (!sid) return null
    const wpis = sesje.get(sid)
    if (!wpis) return null
    if (wpis.wygasa <= teraz()) { sesje.delete(sid); return null }
    return wpis
  }

  /** Uchwyt oddawany na zewnatrz. Metody rozmow sa tu, bo adapter przekazuje
   *  tylko wynik sprawdz() — to jedyna droga do nich dla server.mjs (par. 1.3). */
  const uchwyt = (wpis) => ({
    id: wpis.id,
    wygasa: wpis.wygasa,
    czyRozmowaNalezy(sessionId) {
      if (!sessionId) return true                 // nowa rozmowa — nie ma czego sprawdzac
      return wpis.rozmowy.has(String(sessionId))
    },
    zwiazRozmowe(sessionId) {
      if (sessionId) wpis.rozmowy.add(String(sessionId))
    },
  })

  async function obsluz(req, res) {
    const sciezka = String(req.url ?? '').split('?')[0]
    const metoda = String(req.method ?? 'GET').toUpperCase()

    if (sciezka === TRASA_STANU && metoda === 'GET') {
      const wpis = znajdzSesje(req)
      odpowiedz(res, 200, { zalogowany: Boolean(wpis), wygasa: wpis?.wygasa ?? null })
      return true
    }

    if (sciezka === TRASA_WERYFIKACJI && (metoda === 'GET' || metoda === 'HEAD')) {
      // Ta sama trojca kodow co `sprawdz`: 403 obcy Origin, 401 brak sesji, 200 jest.
      // Caddy przepisuje te odpowiedz klientowi, wiec operator widzi ten sam blad
      // na /dagu/*, co na /api/*.
      if (!originPasuje(req)) odpowiedz(res, 403, { error: 'zly origin zadania (CSRF)' })
      else if (znajdzSesje(req)) odpowiedz(res, 200, { ok: true })
      else odpowiedz(res, 401, { error: 'wymagana sesja operatora — zaloguj sie' })
      return true
    }

    if (sciezka === TRASA_LOGOWANIA && metoda === 'POST') {
      if (!originPasuje(req)) {
        odpowiedz(res, 403, { error: 'zly origin zadania (CSRF)' })
        return true
      }
      if (!skonfigurowana) {
        odpowiedz(res, 401, { error: 'SESJA_HASLO nieustawione — backend odmawia' })
        return true
      }
      let podane
      try {
        const cialo = JSON.parse(await czytajCialo(req))
        podane = cialo?.haslo
      } catch {
        odpowiedz(res, 400, { error: 'nieprawidlowy JSON' })
        return true
      }
      if (typeof podane !== 'string' || podane.length === 0) {
        odpowiedz(res, 400, { error: 'brak pola haslo' })
        return true
      }
      if (!rowneHasla(podane, haslo)) {
        odpowiedz(res, 401, { error: 'zle haslo' })
        return true
      }
      sprzatnij()
      const sid = randomBytes(32).toString('base64url')
      const wygasa = teraz() + ttlMs
      sesje.set(sid, { id: sid.slice(0, 8), wygasa, rozmowy: new Set() })
      odpowiedz(res, 200, { ok: true, wygasa }, { 'Set-Cookie': ciasteczkoSesji(sid, Math.floor(ttlMs / 1000)) })
      return true
    }

    if (sciezka === TRASA_WYLOGOWANIA && metoda === 'POST') {
      if (!originPasuje(req)) {
        odpowiedz(res, 403, { error: 'zly origin zadania (CSRF)' })
        return true
      }
      // Unieważnienie SERWEROWE: wpis znika, wiec to samo ciasteczko jest
      // natychmiast nieważne. Czyszczenie ciasteczka u klienta to dodatek.
      const sid = czytajCiasteczka(req)[NAZWA_CIASTECZKA]
      if (sid) sesje.delete(sid)
      odpowiedz(res, 200, { ok: true }, { 'Set-Cookie': ciasteczkoSesji('', 0) })
      return true
    }

    return false
  }

  function sprawdz(req) {
    if (!originPasuje(req)) {
      return { ok: false, status: 403, komunikat: 'zly origin zadania (CSRF)' }
    }
    if (!skonfigurowana) {
      return { ok: false, status: 401, komunikat: 'SESJA_HASLO nieustawione — backend odmawia' }
    }
    const wpis = znajdzSesje(req)
    if (!wpis) {
      return { ok: false, status: 401, komunikat: 'wymagana sesja operatora — zaloguj sie' }
    }
    return { ok: true, sesja: uchwyt(wpis) }
  }

  return { obsluz, sprawdz }
}

export default utworzBrameSesji
