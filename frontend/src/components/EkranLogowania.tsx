import { useState, type FormEvent } from 'react'

/**
 * Brama wejsciowa do aplikacji. Zanim sesja istnieje, operator nie widzi nic
 * poza tym formularzem - w szczegolnosci NIE widzi ramki. Przy wariancie B2
 * proxy dokłada do ramki tozsamosc administratora silnika, wiec origin bez sesji
 * nie ma prawa niczego pokazac (par. 5.2).
 */
export function EkranLogowania({
  onZaloguj,
  komunikat,
  sprawdzanie,
}: {
  onZaloguj: (haslo: string) => Promise<{ ok: boolean }>
  komunikat: string | null
  sprawdzanie: boolean
}) {
  const [haslo, setHaslo] = useState('')
  const [zajete, setZajete] = useState(false)

  const wyslij = async (event: FormEvent) => {
    event.preventDefault()
    if (!haslo || zajete) return
    setZajete(true)
    try {
      const wynik = await onZaloguj(haslo)
      if (wynik.ok) setHaslo('')
    } finally {
      setZajete(false)
    }
  }

  return (
    <div className="logowanie">
      <form className="logowanie-karta" onSubmit={wyslij}>
        <span className="brand-mark">BP</span>
        <h1>Prototyp procesów</h1>
        <p className="logowanie-opis">
          Dostęp do asystenta i do UI silnika wymaga sesji. Bez niej aplikacja nie pokazuje
          ramki — proxy dokłada do niej tożsamość administratora silnika.
        </p>
        <label htmlFor="haslo">Hasło</label>
        <input
          id="haslo"
          type="password"
          value={haslo}
          autoFocus
          autoComplete="current-password"
          onChange={(event) => setHaslo(event.target.value)}
          disabled={zajete || sprawdzanie}
        />
        {komunikat && <p className="logowanie-blad">{komunikat}</p>}
        <button type="submit" disabled={!haslo || zajete || sprawdzanie}>
          {zajete ? 'Loguję…' : 'Zaloguj'}
        </button>
      </form>
    </div>
  )
}
