/**
 * Adresy UI silnika i odczyt kontekstu z ramki.
 *
 * Decyzja par. 6 rozdziela dwa deep-linki, bo w Dagu to sa dwa rozne widoki:
 *   proces    -> /dagu/dags/<dagName>/status
 *   wykonanie -> /dagu/dag-runs/<dagName>/<dagRunId>
 * W n8n wystarczal jeden (`/n8n/workflow/<id>`), bo definicja i ostatni wynik
 * mieszkaly pod tym samym adresem. Budowanie i czytanie adresu siedzi w jednym
 * pliku, zeby te dwie strony nie mogly sie rozjechac.
 */

// Galaz proba-bytechef: silnikiem jest ByteChef (Spring Boot + React na
// 127.0.0.1:8081 przez Caddy - patrz komentarz w Caddyfile i docker-compose.yml).
// Adresy deep-linkow Dagu zostaja w kodzie (martwe na tej galezi) - wracaja
// razem z profilem "dagu".
export const SILNIK_BYTECHEF = 'http://127.0.0.1:8081'
export const PREFIKS = '/dagu'
export const ADRES_LISTY = SILNIK_BYTECHEF

export type RodzajKontekstu = 'lista' | 'proces' | 'wykonanie' | 'inne'

export type KontekstRamki = {
  rodzaj: RodzajKontekstu
  dagName: string | null
  dagRunId: string | null
  sciezka: string
}

export const KONTEKST_LISTY: KontekstRamki = {
  rodzaj: 'lista', dagName: null, dagRunId: null, sciezka: ADRES_LISTY,
}

export const adresProcesu = (dagName: string) =>
  `${PREFIKS}/dags/${encodeURIComponent(dagName)}/status`

export const adresWykonania = (dagName: string, dagRunId: string) =>
  `${PREFIKS}/dag-runs/${encodeURIComponent(dagName)}/${encodeURIComponent(dagRunId)}`

const WYKONANIE = /^\/dagu\/dag-runs\/([^/]+)\/([^/]+)/
const PROCES = /^\/dagu\/dags\/([^/]+)/

/** Sciezka w ramce -> co operator faktycznie oglada. */
export function czytajKontekst(sciezka: string): KontekstRamki {
  const wykonanie = WYKONANIE.exec(sciezka)
  if (wykonanie) {
    return {
      rodzaj: 'wykonanie',
      dagName: decodeURIComponent(wykonanie[1]),
      dagRunId: decodeURIComponent(wykonanie[2]),
      sciezka,
    }
  }
  const proces = PROCES.exec(sciezka)
  if (proces) {
    return { rodzaj: 'proces', dagName: decodeURIComponent(proces[1]), dagRunId: null, sciezka }
  }
  if (sciezka === ADRES_LISTY || sciezka === `${ADRES_LISTY}/` || sciezka === `${PREFIKS}/`) {
    return { ...KONTEKST_LISTY, sciezka }
  }
  return { rodzaj: 'inne', dagName: null, dagRunId: null, sciezka }
}

export const tenSamKontekst = (a: KontekstRamki, b: KontekstRamki) =>
  a.rodzaj === b.rodzaj && a.dagName === b.dagName && a.dagRunId === b.dagRunId
