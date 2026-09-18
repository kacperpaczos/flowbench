// Adapter sesji /api/chat (R-A, decyzja par. 5.1 i 5.2).
//
// Sam modul sesji jest wlasnoscia zadania T1 i mieszka w chat-backend/sesja/.
// Ten plik go WYLACZNIE podpina - nie implementuje wlasnego uwierzytelniania,
// zeby nie powstala druga, rozjezdzajaca sie implementacja tego samego.
//
// Zachowanie jest "fail closed": gdy modulu nie ma albo nie ma spodziewanej
// powierzchni, /api/chat odmawia 401. Decyzja par. 5.2 mowi wprost, ze przy
// wariancie B2 proxy samo dokłada tozsamosc Dagu, wiec "sesja staje sie
// konieczna, nie opcjonalna" - backend bez dzialajacej sesji nie ma prawa
// wpuszczac nikogo do modelu.

const SCIEZKA_MODULU = './sesja/index.mjs'

/**
 * Powierzchnia, ktorej ten adapter oczekuje od modulu T1.
 * Uzgodniona z koordynatorem 2026-09-18; frontend wola te same trasy
 * (frontend/src/sesja.ts, stala TRASY_SESJI).
 */
export const OCZEKIWANA_POWIERZCHNIA = `
  export function utworzBrameSesji(opcje) -> {
    // Obsluguje wlasne trasy sesji. Zwraca true, gdy zadanie zostalo obsluzone
    // i odpowiedz juz poszla. Trasy:
    //   GET  /api/sesja               -> { zalogowany: boolean }   (otwarta, bez sesji)
    //   POST /api/sesja/logowanie     -> 200 + ciasteczko HttpOnly; SameSite=Strict
    //                                    (otwarta, bez sesji)
    //   POST /api/sesja/wylogowanie   -> 200; UNIEWAZNIA SESJE PO STRONIE SERWERA,
    //                                    nie tylko czysci ciasteczko
    //   GET  /api/sesja/weryfikacja   -> 200 / 401; cel forward_auth Caddy'ego,
    //                                    ktorym caly origin (takze /dagu*) staje
    //                                    za sesja - wariant B2, par. 5.2
    async obsluz(req, res): boolean

    // Sprawdza sesje zadania.
    //   { ok: true, sesja }
    //   { ok: false, status: 401, komunikat }  - brak albo wygasla sesja
    //   { ok: false, status: 403, komunikat }  - OBCY ORIGIN; to jest inny blad
    //                                            niz brak sesji i operator ma
    //                                            widziec roznice
    sprawdz(req): { ok, sesja?, status?, komunikat? }
  }`.trim()

function brakModulu(powod) {
  return {
    dostepna: false,
    powod,
    async obsluz() { return false },
    sprawdz() {
      return {
        ok: false,
        status: 401,
        komunikat:
          'Sesja jest wymagana, a modul sesji nie jest podpiety, wiec backend odmawia. ' +
          `Powod: ${powod}`,
      }
    },
  }
}

/**
 * Laduje modul sesji T1. Nie rzuca - zwraca brame, ktora odmawia,
 * zeby brak modulu nie zamienial sie w otwarty backend.
 */
export async function wczytajBrameSesji(opcje = {}) {
  let modul
  try {
    modul = await import(SCIEZKA_MODULU)
  } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND') return brakModulu('brak chat-backend/sesja/index.mjs')
    return brakModulu(`modul sesji nie daje sie zaladowac: ${e.message}`)
  }

  const fabryka = modul.utworzBrameSesji ?? modul.utworzSesje ?? modul.default
  if (typeof fabryka !== 'function') {
    return brakModulu('modul sesji nie eksportuje fabryki utworzBrameSesji')
  }

  let brama
  try {
    brama = await fabryka(opcje)
  } catch (e) {
    return brakModulu(`fabryka sesji rzucila wyjatkiem: ${e.message}`)
  }
  if (!brama || typeof brama.sprawdz !== 'function') {
    return brakModulu('brama sesji nie ma metody sprawdz(req)')
  }

  return {
    dostepna: true,
    powod: null,
    obsluz: typeof brama.obsluz === 'function'
      ? (req, res) => brama.obsluz(req, res)
      : async () => false,
    sprawdz: (req) => brama.sprawdz(req),
  }
}
