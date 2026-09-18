import { useCallback, useEffect, useState } from 'react'

/**
 * Srodkowy panel: rzeczywisty edytor n8n osadzony w iframe.
 *
 * n8n stoi za tym samym reverse proxy i tym samym originem co ta aplikacja
 * (http://localhost:8080), tylko pod sciezka /n8n/. Dzieki temu ciasteczko sesji
 * dziala jak przy zwyklym logowaniu, a n8n moze zostawic CSP frame-ancestors 'self'.
 */
export function EditorPanel({ workflowId }: { workflowId: string | null }) {
  const src = workflowId ? `/n8n/workflow/${workflowId}` : '/n8n/'
  const [loading, setLoading] = useState(true)
  const [reloads, setReloads] = useState(0)

  // Nowy workflow z czatu = nowe ladowanie ramki.
  useEffect(() => { setLoading(true) }, [src])

  const reload = useCallback(() => {
    setLoading(true)
    setReloads((n) => n + 1)
  }, [])

  return (
    <main className="editor">
      <header className="editor-bar">
        <div className="editor-title">
          <h1>Procesy</h1>
          <span className="badge">edytor n8n · osadzony</span>
          {workflowId && <span className="badge is-alt">z czatu · {workflowId}</span>}
        </div>
        <div className="editor-actions">
          <span className={'status' + (loading ? ' is-loading' : '')}>
            {loading ? 'Ładowanie edytora…' : 'Edytor gotowy'}
          </span>
          <button type="button" className="ghost-btn" onClick={reload}>
            Przeładuj
          </button>
        </div>
      </header>

      <div className="editor-frame">
        {loading && (
          <div className="frame-overlay">
            <div className="spinner" aria-hidden="true" />
            <p>Łączenie z edytorem n8n…</p>
          </div>
        )}
        <iframe
          key={`${src}#${reloads}`}
          src={src}
          title="Edytor n8n"
          onLoad={() => setLoading(false)}
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </main>
  )
}
