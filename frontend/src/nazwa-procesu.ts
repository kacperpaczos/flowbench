import { useEffect, useState } from 'react'
import { zadanie } from './sesja'

/**
 * Nazwa wyswietlana procesu (par. 4.2).
 *
 * Identyfikator techniczny idzie do URL, a operator ma widziec nazwe polska.
 * Nazwa siedzi w polu `description` definicji, czyli w silniku - a klucz do
 * silnika nie opuszcza backendu, wiec pytamy o nia nasz backend, nie Dagu.
 */

export type StanNazwy = 'brak-kontekstu' | 'ladowanie' | 'jest' | 'nie-znaleziono' | 'blad'

export type NazwaProcesu = {
  stan: StanNazwy
  nazwaWyswietlana: string | null
  komunikat: string | null
}

const POCZATEK: NazwaProcesu = { stan: 'brak-kontekstu', nazwaWyswietlana: null, komunikat: null }

export function useNazwaProcesu(dagName: string | null): NazwaProcesu {
  const [wynik, setWynik] = useState<NazwaProcesu>(POCZATEK)

  useEffect(() => {
    if (!dagName) { setWynik(POCZATEK); return }
    let aktualne = true
    setWynik({ stan: 'ladowanie', nazwaWyswietlana: null, komunikat: null })

    zadanie(`/api/proces?nazwa=${encodeURIComponent(dagName)}`)
      .then(async (res) => {
        const dane = await res.json().catch(() => ({}))
        if (!aktualne) return
        if (res.status === 401) {
          setWynik({ stan: 'blad', nazwaWyswietlana: null, komunikat: 'Sesja wygasła — zaloguj się ponownie.' })
          return
        }
        if (!res.ok) {
          // 503 = "nie udalo sie zapytac silnika". To nie to samo, co
          // "takiego procesu nie ma", i komunikat ma to rozroznic.
          setWynik({ stan: 'blad', nazwaWyswietlana: null, komunikat: dane.error ?? `błąd ${res.status}` })
          return
        }
        if (!dane.istnieje) {
          setWynik({
            stan: 'nie-znaleziono',
            nazwaWyswietlana: null,
            komunikat: `Silnik nie zna procesu o identyfikatorze „${dagName}”.`,
          })
          return
        }
        setWynik({ stan: 'jest', nazwaWyswietlana: dane.nazwaWyswietlana ?? null, komunikat: null })
      })
      .catch((e: Error) => {
        if (aktualne) setWynik({ stan: 'blad', nazwaWyswietlana: null, komunikat: e.message })
      })

    return () => { aktualne = false }
  }, [dagName])

  return wynik
}
