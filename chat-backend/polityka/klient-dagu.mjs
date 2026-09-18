// Jedyne miejsce w aplikacji, które zna klucz API silnika.
//
// Klucz siedzi w domknięciu i nie jest zwracany żadnym wywołaniem. To jest sedno
// punktu 5: model rozmawia z NASZYM serwerem MCP, a nie z Dagu, więc klucz nie ma
// powodu opuszczać backendu. Zalecana rola klucza: `developer` z allowedSurfaces:["mcp"]
// (audyt-dagu-bezpieczenstwo.md P5) - odcina cały REST, w tym klucze API i base.yaml.

import { BladTransportu } from './bledy.mjs'

const PROTOKOL = '2025-06-18'

export function utworzKlienta({ url, klucz, fetchImpl = fetch, nazwaKlienta = 'polityka-kontraktu' }) {
  if (!url) throw new Error('utworzKlienta: brak adresu MCP silnika')
  let sesja = null
  let gotowy = null
  let nastepneId = 1

  async function wyslij(cialo, { zSesja = true } = {}) {
    const naglowki = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOKOL,
    }
    if (klucz) naglowki.Authorization = `Bearer ${klucz}`
    if (zSesja && sesja) naglowki['Mcp-Session-Id'] = sesja

    let odpowiedz
    try {
      odpowiedz = await fetchImpl(url, { method: 'POST', headers: naglowki, body: JSON.stringify(cialo) })
    } catch (e) {
      // Komunikat celowo bez nagłówków - nie drukujemy klucza nawet w błędzie.
      throw new BladTransportu(`Silnik jest nieosiągalny pod ${url}: ${e.message}`)
    }
    const nowaSesja = odpowiedz.headers.get('mcp-session-id')
    if (nowaSesja) sesja = nowaSesja
    if (odpowiedz.status === 202) return null                      // potwierdzenie powiadomienia
    const tekst = await odpowiedz.text()
    if (!odpowiedz.ok) {
      throw new BladTransportu(`Silnik odpowiedział ${odpowiedz.status}`, tekst.slice(0, 500))
    }
    if (tekst.trim() === '') return null
    return rozpakuj(tekst)
  }

  /** Streamable HTTP dopuszcza odpowiedź jako JSON albo jako strumień SSE. */
  function rozpakuj(tekst) {
    const przyciety = tekst.trimStart()
    if (przyciety.startsWith('{') || przyciety.startsWith('[')) return JSON.parse(przyciety)
    let ostatni = null
    for (const linia of tekst.split('\n')) {
      if (!linia.startsWith('data:')) continue
      const dane = linia.slice(5).trim()
      if (dane === '' || dane === '[DONE]') continue
      try { ostatni = JSON.parse(dane) } catch { /* linie nie-JSON pomijamy */ }
    }
    if (ostatni === null) throw new BladTransportu('Nie da się odczytać odpowiedzi MCP silnika', tekst.slice(0, 300))
    return ostatni
  }

  async function polacz() {
    if (gotowy) return gotowy
    gotowy = (async () => {
      const wynik = await wyslij({
        jsonrpc: '2.0', id: nastepneId++, method: 'initialize',
        params: { protocolVersion: PROTOKOL, capabilities: {}, clientInfo: { name: nazwaKlienta, version: '1.0.0' } },
      }, { zSesja: false })
      if (wynik?.error) throw new BladTransportu(`initialize odrzucone: ${wynik.error.message}`)
      await wyslij({ jsonrpc: '2.0', method: 'notifications/initialized' })
      return true
    })()
    return gotowy
  }

  async function wolaj(nazwaNarzedzia, argumenty) {
    await polacz()
    const wynik = await wyslij({
      jsonrpc: '2.0', id: nastepneId++, method: 'tools/call',
      params: { name: nazwaNarzedzia, arguments: argumenty ?? {} },
    })
    if (wynik?.error) throw new BladTransportu(`${nazwaNarzedzia}: ${wynik.error.message}`, wynik.error.data)
    return wynik?.result ?? null
  }

  /** Wyciąga dane z odpowiedzi narzędzia: structuredContent albo pierwszy blok tekstowy z JSON-em. */
  function dane(wynikNarzedzia) {
    if (!wynikNarzedzia) return null
    if (wynikNarzedzia.structuredContent !== undefined) return wynikNarzedzia.structuredContent
    const blok = (wynikNarzedzia.content ?? []).find((c) => c.type === 'text')
    if (!blok) return null
    try { return JSON.parse(blok.text) } catch { return blok.text }
  }

  return {
    polacz,
    odczytaj: (argumenty) => wolaj('dagu_read', argumenty),
    zmien: (argumenty) => wolaj('dagu_change', argumenty),
    wykonaj: (argumenty) => wolaj('dagu_execute', argumenty),
    listaNarzedzi: async () => { await polacz(); return wyslij({ jsonrpc: '2.0', id: nastepneId++, method: 'tools/list' }) },
    dane,

    /** Definicja procesu w postaci, w jakiej leży w silniku - podstawa kontroli sumy. */
    async pobierzSpec(nazwa) {
      const wynik = await wolaj('dagu_read', { target: 'dag_spec', name: nazwa })
      const tresc = dane(wynik)
      if (typeof tresc === 'string') return tresc
      const kandydat = tresc?.spec ?? tresc?.data?.spec ?? tresc?.yaml ?? tresc?.data?.yaml
      if (typeof kandydat === 'string') return kandydat
      const blok = (wynik?.content ?? []).find((c) => c.type === 'text')
      return blok?.text ?? null
    },

    zamknij() { sesja = null; gotowy = null },
  }
}
