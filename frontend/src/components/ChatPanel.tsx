import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { KontekstRamki } from '../kontekst-ramki'
import { zadanie } from '../sesja'

type Message = {
  id: number
  author: 'user' | 'bot' | 'error'
  text: string
  time: string
  meta?: string
}

type ChatReply = {
  reply: string
  dagName: string | null
  dagRunId: string | null
  nazwaWyswietlana: string | null
  sessionId: string | null
  costUsd: number | null
  durationMs: number | null
  statusLabel: string | null
  wToku: boolean
  ostrzezenie: string | null
}

const now = () =>
  new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })

let nextId = 1
const msg = (author: Message['author'], text: string, meta?: string): Message => ({
  id: nextId++, author, text, time: now(), meta,
})

const initialMessages: Message[] = [
  msg('bot', 'Cześć. Opisz proces, a napiszę go, uruchomię i pokażę wynik w ramce obok.'),
  msg('bot', 'Na przykład: „zrób proces, który liczy wartość brutto z pozycji zamówienia”.'),
]

export function ChatPanel({
  kontekst,
  onProces,
}: {
  kontekst: KontekstRamki
  onProces: (cel: { dagName: string; dagRunId: string | null }) => void
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const sessionId = useRef<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  const send = async (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || busy) return

    setMessages((prev) => [...prev, msg('user', text)])
    setDraft('')
    setBusy(true)

    try {
      const res = await zadanie('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Kontekst to FAKTYCZNIE otwarty widok ramki, a nie ostatni proces modelu.
        // Po recznej nawigacji operatora czat ma mowic o tym, na co operator patrzy
        // (par. 13.5 E3).
        body: JSON.stringify({
          message: text,
          sessionId: sessionId.current,
          dagName: kontekst.dagName,
          dagRunId: kontekst.dagRunId,
          sciezkaRamki: kontekst.sciezka,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        throw new Error(data.error ?? 'Sesja wygasła albo nie istnieje — zaloguj się ponownie.')
      }
      if (!res.ok) {
        // Tura przerwana w polowie: backend i tak mowi, co zdazylo powstac.
        // Pokazujemy to w ramce - inaczej operator nie ma jak sprawdzic, w jakim
        // stanie zostawil go przerwany model.
        if (data.dagName) onProces({ dagName: data.dagName, dagRunId: data.dagRunId ?? null })
        throw new Error(data.error ?? `błąd ${res.status}`)
      }

      const reply = data as ChatReply
      sessionId.current = reply.sessionId ?? sessionId.current

      const bits: string[] = []
      if (reply.durationMs) bits.push(`${Math.round(reply.durationMs / 1000)} s`)
      // par. 4.3: costUsd to liczba raportowana przez CLI modelu. Podpisujemy ja
      // jako SZACUNEK ZUZYCIA - przedstawianie jej jako potwierdzonej doplaty do
      // abonamentu byloby stwierdzeniem, ktorego nie mamy z czego wyprowadzic.
      if (reply.costUsd) bits.push(`szac. zużycie ${reply.costUsd.toFixed(2)} USD`)
      if (reply.statusLabel) bits.push(`silnik: ${reply.statusLabel}`)

      setMessages((prev) => [...prev, msg('bot', reply.reply, bits.join(' · ') || undefined)])

      // Sukces czytamy z silnika, nie z tresci odpowiedzi (par. 4.3, par. 13.5 E8).
      // Model, ktory napisal "gotowe" przy czerwonym przebiegu, dostaje tu sprostowanie.
      if (reply.ostrzezenie) {
        setMessages((prev) => [...prev, msg('error', reply.ostrzezenie as string)])
      } else if (reply.wToku && reply.statusLabel) {
        setMessages((prev) => [...prev, msg(
          'bot',
          `Przebieg jeszcze trwa (status w silniku: ${reply.statusLabel}). Powodzenia jeszcze nie potwierdzamy.`,
        )])
      }

      if (reply.dagName) onProces({ dagName: reply.dagName, dagRunId: reply.dagRunId })
    } catch (e) {
      setMessages((prev) => [...prev, msg('error', `Nie udało się: ${(e as Error).message}`)])
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="chat">
      <header className="chat-head">
        <h2>Asystent</h2>
        <span className="chat-sub">procesy przez MCP za warstwą polityki</span>
      </header>

      <div className="chat-log" ref={listRef}>
        {messages.map((message) => (
          <div key={message.id} className={'bubble is-' + message.author}>
            <p>{message.text}</p>
            <time>{message.time}{message.meta ? ` · ${message.meta}` : ''}</time>
          </div>
        ))}
        {busy && (
          <div className="bubble is-bot is-typing">
            <span className="dot" /><span className="dot" /><span className="dot" />
            <p className="typing-label">Model pisze i uruchamia proces…</p>
          </div>
        )}
      </div>

      <form className="chat-form" onSubmit={send}>
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={busy ? 'Czekam na odpowiedź…' : 'Opisz proces…'}
          aria-label="Wiadomość"
          disabled={busy}
        />
        <button type="submit" disabled={!draft.trim() || busy}>
          {busy ? '…' : 'Wyślij'}
        </button>
      </form>
    </aside>
  )
}
