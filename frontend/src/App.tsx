import { useCallback, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { EditorPanel, type CelRamki } from './components/EditorPanel'
import { ChatPanel } from './components/ChatPanel'
import { EkranLogowania } from './components/EkranLogowania'
import { KONTEKST_LISTY, type KontekstRamki } from './kontekst-ramki'
import { useNazwaProcesu } from './nazwa-procesu'
import { useSesja } from './sesja'

/**
 * Dwa stany kontekstu, celowo rozdzielone:
 *
 *   cel      - DOKAD czat kaze przejsc ramce (jednorazowe polecenie nawigacji),
 *   kontekst - CO ramka faktycznie pokazuje (odczytane z ramki).
 *
 * Wczesniej byl jeden `workflowId`, ustawiany wylacznie przez czat, i to byla
 * wada: po recznym przejsciu operatora w ramce czat dalej mowil o ostatnim
 * procesie modelu. Rozdzielenie zamyka ten rozjazd - nawigacja jest poleceniem,
 * kontekst jest obserwacja, i tylko obserwacja idzie do modelu.
 */
export function App() {
  const [section, setSection] = useState('procesy')
  const [cel, setCel] = useState<CelRamki>({ dagName: null, dagRunId: null, licznik: 0 })
  const [kontekst, setKontekst] = useState<KontekstRamki>(KONTEKST_LISTY)
  const sesja = useSesja()
  const zalogowany = sesja.stan === 'zalogowany'
  const nazwa = useNazwaProcesu(zalogowany ? kontekst.dagName : null)

  // licznik rosnie przy kazdym poleceniu z czatu, zeby powtorne wskazanie tego
  // samego procesu tez przeladowalo ramke.
  const otworzZCzatu = useCallback((wskazanie: { dagName: string; dagRunId: string | null }) => {
    setCel((poprzedni) => ({ ...wskazanie, licznik: poprzedni.licznik + 1 }))
  }, [])

  if (!zalogowany) {
    return (
      <EkranLogowania
        onZaloguj={sesja.zaloguj}
        komunikat={sesja.komunikat}
        sprawdzanie={sesja.stan === 'sprawdzam'}
      />
    )
  }

  return (
    <div className="app">
      <Sidebar active={section} onSelect={setSection} onWyloguj={sesja.wyloguj} />
      <EditorPanel cel={cel} nazwa={nazwa} onKontekst={setKontekst} />
      <ChatPanel kontekst={kontekst} onProces={otworzZCzatu} />
    </div>
  )
}
