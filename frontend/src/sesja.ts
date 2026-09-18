import { useCallback, useEffect, useState } from 'react'

/**
 * Klient sesji (R-A, decyzja par. 5.1 i 5.2).
 *
 * Logika sesji siedzi w backendzie (modul T1, chat-backend/sesja/) - tutaj jest
 * tylko jej strona przegladarkowa. Trasy trzymamy w JEDNYM miejscu, zeby zmiana
 * po stronie T1 byla poprawka jednej stalej, a nie polowaniem po komponentach.
 *
 * Dwie zasady narzucone przez wariant B2 (par. 5.2 - proxy samo dokłada tozsamosc
 * Dagu, wiec caly origin musi byc za sesja):
 *   1. Ramki NIE montujemy, dopoki /api/sesja nie powie {zalogowany:true}.
 *      Niezalogowany operator dostaje na /dagu* czyste 401, wiec ramka
 *      wyrenderowalaby blad zamiast UI silnika.
 *   2. Stanu sesji NIE wnioskujemy z zawartosci ramki. Pytamy backend.
 */

/**
 * Wariant B2 (par. 5.2): prawdziwy token silnika zyje WYLACZNIE w konfiguracji
 * proxy, a przegladarka trzyma nie-sekretny sentinel. Jest on potrzebny, bo
 * route-guard SPA silnika przepuszcza dalej tylko przy NIEPUSTYM
 * `dagu_auth_token` w localStorage - samo wstrzykniecie naglowka na proxy nie
 * wystarcza i ramka ladowala ekran logowania silnika
 * (docs/audyt-dagu-bezpieczenstwo.md P4, krok 1 i 2).
 *
 * Sieje to RODZIC, a nie proxowany formularz logowania silnika - bo formularz
 * w ramce uczylby operatora wpisywania hasla do okna udajacego silnik.
 * Wartosc nie jest sekretem: proxy i tak podmienia naglowek Authorization.
 *
 * To jest jedyne miejsce w aplikacji, ktore zna wewnetrzny szczegol UI silnika.
 * Zmiana nazwy klucza po stronie Dagu przewroci tylko ta stala.
 */
const KLUCZ_SENTINELA = 'dagu_auth_token'
const SENTINEL = 'SENTINEL-proxy-managed'

const zasiejSentinel = () => {
  try { window.localStorage.setItem(KLUCZ_SENTINELA, SENTINEL) } catch { /* tryb prywatny */ }
}
const usunSentinel = () => {
  try { window.localStorage.removeItem(KLUCZ_SENTINELA) } catch { /* tryb prywatny */ }
}

export const TRASY_SESJI = {
  stan: '/api/sesja',
  logowanie: '/api/sesja/logowanie',
  wylogowanie: '/api/sesja/wylogowanie',
}

export type StanSesji = 'sprawdzam' | 'zalogowany' | 'niezalogowany' | 'blad'

let naOdmowe: (() => void) | null = null

/**
 * Kazde wlasne zadanie aplikacji idzie tedy. Utrata sesji w trakcie pracy objawia
 * sie 401 na najblizszym zadaniu - wtedy wracamy do formularza, zamiast zostawiac
 * operatora z UI, ktore juz nic nie moze.
 */
export async function zadanie(wejscie: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(wejscie, init)
  if (res.status === 401) naOdmowe?.()
  return res
}

export function useSesja() {
  const [stan, setStan] = useState<StanSesji>('sprawdzam')
  const [komunikat, setKomunikat] = useState<string | null>(null)

  const odswiez = useCallback(async () => {
    try {
      const res = await fetch(TRASY_SESJI.stan)
      if (!res.ok) { setStan('blad'); setKomunikat(`Backend odpowiedział ${res.status}.`); return }
      const dane = await res.json()
      if (dane.zalogowany) zasiejSentinel()
      setStan(dane.zalogowany ? 'zalogowany' : 'niezalogowany')
      setKomunikat(null)
    } catch (e) {
      setStan('blad')
      setKomunikat((e as Error).message)
    }
  }, [])

  useEffect(() => { void odswiez() }, [odswiez])

  useEffect(() => {
    naOdmowe = () => {
      usunSentinel()
      setStan('niezalogowany')
      setKomunikat('Sesja wygasła albo została unieważniona.')
    }
    return () => { naOdmowe = null }
  }, [])

  const zaloguj = useCallback(async (haslo: string) => {
    setKomunikat(null)
    const res = await fetch(TRASY_SESJI.logowanie, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ haslo }),
    })
    if (res.ok) { zasiejSentinel(); setStan('zalogowany'); return { ok: true as const } }
    const dane = await res.json().catch(() => ({}))
    const tekst = res.status === 401
      ? (dane.error ?? 'Błędne hasło.')
      : (dane.error ?? `Logowanie nie powiodło się (${res.status}).`)
    setKomunikat(tekst)
    return { ok: false as const, komunikat: tekst }
  }, [])

  const wyloguj = useCallback(async () => {
    // Wylogowanie ma uniewaznic sesje PO STRONIE SERWERA, nie tylko wyczyscic
    // ciasteczko - inaczej "wylogowany" byloby stwierdzeniem o przegladarce,
    // a nie o dostepie.
    await fetch(TRASY_SESJI.wylogowanie, { method: 'POST' }).catch(() => undefined)
    usunSentinel()
    setStan('niezalogowany')
    setKomunikat('Wylogowano.')
  }, [])

  return { stan, komunikat, zaloguj, wyloguj, odswiez }
}
