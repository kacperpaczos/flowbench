import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ADRES_LISTY, adresProcesu, adresWykonania, czytajKontekst, tenSamKontekst,
  KONTEKST_LISTY, type KontekstRamki,
} from '../kontekst-ramki'
import type { NazwaProcesu } from '../nazwa-procesu'
import { zadanie } from '../sesja'

export type CelRamki = { dagName: string | null; dagRunId: string | null; licznik: number }

/**
 * Srodkowy panel: prawdziwe UI silnika osadzone w ramce. Wlasnego canvasu nie ma
 * i miec nie bedzie - par. 7.2 mowi wprost, ze operator edytuje YAML w Monaco
 * silnika albo prosi czat.
 *
 * Dwie rzeczy, ktore ten komponent robi inaczej niz jego poprzednik:
 *
 * 1. KONTEKST IDZIE W DWIE STRONY. Poprzednia wersja znala tylko `workflowId`
 *    ustawiany przez czat, wiec po recznej nawigacji operatora w ramce czat mowil
 *    o ostatnim procesie MODELU, a nie o tym, co operator oglada. Ramka i rodzic
 *    sa na tym samym originie (jedno proxy, par. 6), wiec adres w ramce da sie
 *    po prostu odczytac - i to robimy, odpytujac `contentWindow.location`.
 *
 *    Dlaczego odpytywanie, a nie zdarzenia: UI silnika to SPA na History API.
 *    `popstate` NIE wystaje przy `pushState`, wiec klikniecie w liscie procesow
 *    zmienia adres bez jednego zdarzenia, ktore rodzic moglby zlapac. `postMessage`
 *    wymagaloby wstrzykniecia kodu do cudzej aplikacji, ktorej nie utrzymujemy.
 *    Odpytywanie jest jedynym sposobem, ktory widzi KAZDA zmiane trasy, i kosztuje
 *    jedno porownanie napisow co POLL_MS.
 *
 * 2. `onLoad` NIE JEST DOWODEM GOTOWOSCI (par. 13.5 E4). Zostaje jako efekt
 *    wizualny - gasi spinner - ale zadne zdanie w UI nie mowi na jego podstawie
 *    "edytor gotowy". Czy ramka w ogole dostala tresc, sprawdzamy osobno: tym
 *    samym adresem, wlasnym zadaniem, i patrzymy na KOD HTTP. Nie zagladamy do
 *    dokumentu ramki - zawartosc UI silnika jest cudza i zmieni sie bez uprzedzenia,
 *    a kod HTTP jest stabilny i mowi to, co trzeba: 200 tresc jest, 401 sesja
 *    padla, 502 silnika nie ma.
 */

const POLL_MS = 400

const adresCelu = (cel: CelRamki) => {
  if (cel.dagName && cel.dagRunId) return adresWykonania(cel.dagName, cel.dagRunId)
  if (cel.dagName) return adresProcesu(cel.dagName)
  return ADRES_LISTY
}

export function EditorPanel({
  cel,
  kontekst,
  nazwa,
  onKontekst,
}: {
  cel: CelRamki
  kontekst: KontekstRamki
  nazwa: NazwaProcesu
  onKontekst: (kontekst: KontekstRamki) => void
}) {
  const src = adresCelu(cel)
  const ramka = useRef<HTMLIFrameElement>(null)
  const ostatni = useRef<KontekstRamki>(KONTEKST_LISTY)
  const [loading, setLoading] = useState(true)
  const [reloads, setReloads] = useState(0)
  const [sonda, setSonda] = useState<{ status: number | null; blad: string | null }>(
    { status: null, blad: null })

  // Nowy cel z czatu albo przeladowanie = nowe ladowanie ramki i nowa sonda.
  useEffect(() => {
    setLoading(true)
    setSonda({ status: null, blad: null })
    let aktualne = true
    zadanie(src, { method: 'GET' })
      .then((res) => { if (aktualne) setSonda({ status: res.status, blad: null }) })
      .catch((e: Error) => { if (aktualne) setSonda({ status: null, blad: e.message }) })
    return () => { aktualne = false }
  }, [src, cel.licznik, reloads])

  useEffect(() => {
    const zerknij = () => {
      const okno = ramka.current?.contentWindow
      if (!okno) return
      let sciezka: string
      try {
        sciezka = okno.location.pathname
      } catch {
        // Ten sam origin, wiec normalnie sie nie zdarza. Gdyby sie zdarzylo,
        // wolimy nic nie powiedziec niz powiedziec nieprawde.
        return
      }
      const swiezy = czytajKontekst(sciezka)
      if (tenSamKontekst(swiezy, ostatni.current) && swiezy.sciezka === ostatni.current.sciezka) return
      ostatni.current = swiezy
      onKontekst(swiezy)
    }
    zerknij()
    const uchwyt = window.setInterval(zerknij, POLL_MS)
    return () => window.clearInterval(uchwyt)
  }, [onKontekst])

  // Jedyna rola tego zdarzenia: zgasic spinner. Zadne stwierdzenie w UI ani w
  // testach nie opiera sie na nim (par. 13.5 E4).
  const przyLoad = useCallback(() => setLoading(false), [])

  const reload = useCallback(() => setReloads((n) => n + 1), [])

  const ramkaMaTresc = sonda.status === null ? null : sonda.status === 200
  const bladRamki = sonda.blad
    ? `Nie udało się sprawdzić adresu ramki: ${sonda.blad}`
    : ramkaMaTresc === false
      ? `Silnik odpowiedział na adres ramki kodem ${sonda.status}. Ramka nie pokaże procesu.`
      : null

  const identyfikator = kontekst.dagName
  const tytul = nazwa.nazwaWyswietlana ?? (identyfikator ? '—' : 'Procesy')

  return (
    <main className="editor">
      <header className="editor-bar">
        <div className="editor-title">
          <h1 title={nazwa.nazwaWyswietlana ?? undefined}>{tytul}</h1>
          {/* par. 4.2: nazwa polska dla czlowieka, identyfikator techniczny obok niej. */}
          {identyfikator && <span className="badge is-id" title="Identyfikator techniczny procesu">{identyfikator}</span>}
          {kontekst.rodzaj === 'wykonanie' && kontekst.dagRunId && (
            <span className="badge is-alt" title="Identyfikator wykonania">wykonanie · {kontekst.dagRunId}</span>
          )}
          {kontekst.rodzaj === 'lista' && <span className="badge">lista procesów</span>}
        </div>
        <div className="editor-actions">
          <span
            className={'status' + (loading ? ' is-loading' : bladRamki ? ' is-blad' : '')}
            title="Zdarzenie load ramki nie jest dowodem gotowości UI silnika ani zalogowania (par. 13.5 E4)."
          >
            {loading
              ? 'Wczytywanie ramki…'
              : bladRamki
                ? `Adres ramki odpowiada kodem ${sonda.status ?? '—'}`
                : 'Ramka wczytana (to nie jest dowód gotowości)'}
          </span>
          <button type="button" className="ghost-btn" onClick={reload}>
            Przeładuj
          </button>
        </div>
      </header>

      {nazwa.stan === 'nie-znaleziono' && (
        <p className="pasek-ostrzezenia">{nazwa.komunikat}</p>
      )}
      {nazwa.stan === 'blad' && (
        <p className="pasek-ostrzezenia">Nie udało się odczytać nazwy procesu: {nazwa.komunikat}</p>
      )}
      {bladRamki && <p className="pasek-ostrzezenia">{bladRamki} Użyj „Przeładuj”.</p>}

      <div className="editor-frame">
        {loading && (
          <div className="frame-overlay">
            <div className="spinner" aria-hidden="true" />
            <p>Łączenie z UI silnika…</p>
          </div>
        )}
        <iframe
          ref={ramka}
          key={`${src}#${cel.licznik}#${reloads}`}
          src={src}
          title="UI silnika procesów"
          onLoad={przyLoad}
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </main>
  )
}
