type Item = { id: string; label: string; icon: JSX.Element }

const icons = {
  produkty: (
    <path d="M3 7.5 10 4l7 3.5v5L10 16l-7-3.5v-5Z M10 9.5 3 6 M10 9.5l7-3.5 M10 9.5V16" />
  ),
  procesy: (
    <path d="M4 5.5h4v3H4v-3Zm8 6h4v3h-4v-3Zm-8 0h4v3H4v-3Zm4-1.5h2a2 2 0 0 1 2 2v1" />
  ),
  historia: <path d="M10 5v5l3 2M3.5 10a6.5 6.5 0 1 0 2-4.7M3.5 4v3h3" />,
  ustawienia: (
    <path d="M10 7.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Zm6.2 2.4c0 .4 0 .8-.1 1.1l1.4 1-1.5 2.6-1.6-.6c-.6.5-1.2.8-1.9 1L12.2 17H9.8l-.3-1.9c-.7-.2-1.3-.5-1.9-1l-1.6.6L4.5 12l1.4-1a6 6 0 0 1 0-2.2l-1.4-1L6 5.2l1.6.6c.6-.5 1.2-.8 1.9-1L9.8 3h2.4l.3 1.9c.7.2 1.3.5 1.9 1l1.6-.6L17.5 8l-1.4 1c.1.3.1.7.1 1Z" />
  ),
}

const items: Item[] = [
  { id: 'produkty', label: 'Produkty', icon: icons.produkty },
  { id: 'procesy', label: 'Procesy', icon: icons.procesy },
  { id: 'historia', label: 'Historia', icon: icons.historia },
  { id: 'ustawienia', label: 'Ustawienia', icon: icons.ustawienia },
]

export function Sidebar({
  active,
  onSelect,
  onWyloguj,
}: {
  active: string
  onSelect: (id: string) => void
  onWyloguj: () => void
}) {
  return (
    <nav className="sidebar">
      <div className="brand">
        <span className="brand-mark">BP</span>
        <span className="brand-name">Prototyp</span>
      </div>

      <ul className="nav-list">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={'nav-item' + (active === item.id ? ' is-active' : '')}
              onClick={() => onSelect(item.id)}
              aria-current={active === item.id ? 'page' : undefined}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                {item.icon}
              </svg>
              {item.label}
            </button>
          </li>
        ))}
      </ul>

      {/* Wylogowanie uniewaznia sesje po stronie serwera (par. 5.2), nie tylko
          czysci ciasteczko - i odbiera dostep takze do ramki, bo caly origin
          stoi za ta sama sesja. */}
      <button type="button" className="wyloguj" onClick={onWyloguj}>
        Wyloguj
      </button>

      <p className="sidebar-note">
        Menu jest atrapą — prototyp sprawdza wyłącznie osadzenie UI silnika procesów.
      </p>
    </nav>
  )
}
