import { useEffect, useRef, useState, type FormEvent } from 'react'

type Message = {
  id: number
  author: 'user' | 'bot' | 'error'
  text: string
  time: string
  meta?: string
}

type ChatReply = {
  reply: string
  workflowId: string | null
  sessionId: string | null
  costUsd: number | null
  durationMs: number | null
}

const now = () =>
  new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })

let nextId = 1
const msg = (author: Message['author'], text: string, meta?: string): Message => ({
  id: nextId++, author, text, time: now(), meta,
})

const initialMessages: Message[] = [
  msg('bot', 'Cześć. Opisz proces, a napiszę go w n8n, uruchomię i pokażę wynik w edytorze obok.'),
  msg('bot', 'Na przykład: „zrób workflow, który liczy wartość brutto z listy pozycji zamówienia”.'),
]

export function ChatPanel({
  onWorkflow,
  workflowId,
}: {
  onWorkflow: (id: string) => void
  workflowId: string | null
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
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // workflowId mowi modelowi, co uzytkownik ma otwarte w edytorze obok.
        body: JSON.stringify({ message: text, sessionId: sessionId.current, workflowId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `błąd ${res.status}`)

      const reply = data as ChatReply
      sessionId.current = reply.sessionId ?? sessionId.current

      const bits: string[] = []
      if (reply.durationMs) bits.push(`${Math.round(reply.durationMs / 1000)} s`)
      if (reply.costUsd) bits.push(`${reply.costUsd.toFixed(2)} USD`)

      setMessages((prev) => [...prev, msg('bot', reply.reply, bits.join(' · ') || undefined)])
      if (reply.workflowId) onWorkflow(reply.workflowId)
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
        <span className="chat-sub">n8n przez MCP</span>
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
            <p className="typing-label">Model pisze i uruchamia workflow…</p>
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
