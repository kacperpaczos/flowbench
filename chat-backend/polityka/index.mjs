// Powierzchnia publiczna warstwy polityki. Umowa z zadaniem T3 spisana jest
// w chat-backend/KONTRAKT.md - ten plik ma się z nią zgadzać co do nazw.

export { naruszenie, opiszNaruszenia, BladRejestru, BladTransportu } from './bledy.mjs'
export {
  sprawdzIdentyfikator, naIdentyfikator, nadajIdentyfikator,
  WZORZEC_IDENTYFIKATORA, MAKS_DLUGOSC,
} from './identyfikatory.mjs'
export { wczytajRejestr, nazwaAkcjiDlaKontraktu } from './rejestr-kontraktow.mjs'
export { sprawdzDefinicje, wykryjPoddagi } from './walidacja-definicji.mjs'
export { utworzRejestrZezwolen, sumaDefinicji } from './zezwolenia.mjs'
export { utworzKlienta } from './klient-dagu.mjs'
export { ustalWynik, pogodzOdpowiedzModelu, ETYKIETY_SUKCESU } from './wynik.mjs'
export { uruchomSerwerMcp, utworzBramke } from './serwer-mcp.mjs'
export { kanoniczny, odcisk } from './kanonizacja.mjs'
