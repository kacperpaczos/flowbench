// Sukces ustala się ODCZYTEM Z SILNIKA po identyfikatorze wykonania - decyzja
// architektoniczna v3 par. 4.3 i par. 13.5 E8: "Model może napisać »gotowe« przy
// czerwonym przebiegu."
//
// Ten moduł nie interpretuje treści odpowiedzi modelu jako dowodu czegokolwiek.
// Czyta `statusLabel` z `dagu_read target=run` i to jest jedyne źródło prawdy.

import { naruszenie, odmowa } from './bledy.mjs'

/** Etykiety, które silnik zwraca dla przebiegu zakończonego powodzeniem. */
export const ETYKIETY_SUKCESU = new Set(['succeeded'])
/** Etykiety stanu nieostatecznego - przebieg jeszcze trwa albo czeka. */
export const ETYKIETY_W_TOKU = new Set(['running', 'queued', 'not started', 'waiting', 'partial success'])

/**
 * @returns {Promise<{ok:boolean, statusLabel:string|null, sukces:boolean, kroki:Array, naruszenia?:Array}>}
 */
export async function ustalWynik({ klient, dagName, dagRunId }) {
  if (!dagRunId) {
    return { ...odmowa(naruszenie('WYNIK_NIEZNANY', 'dagRunId',
      'Brak identyfikatora wykonania. Bez niego nie da się odczytać wyniku z silnika, ' +
      'a treść odpowiedzi modelu nie jest dowodem powodzenia.')),
    statusLabel: null, sukces: false, kroki: [] }
  }
  let odpowiedz
  try {
    odpowiedz = klient.dane(await klient.odczytaj({ target: 'run', name: dagName, dagRunId }))
  } catch (e) {
    return { ...odmowa(naruszenie('WYNIK_NIEZNANY', 'dagRunId',
      `Nie udało się odczytać wykonania ${dagRunId} procesu "${dagName}" z silnika: ${e.message}`)),
    statusLabel: null, sukces: false, kroki: [] }
  }

  const dane = odpowiedz?.data ?? odpowiedz
  const statusLabel = typeof dane?.statusLabel === 'string' ? dane.statusLabel : null
  if (statusLabel === null) {
    return { ...odmowa(naruszenie('WYNIK_NIEZNANY', 'statusLabel',
      `Silnik nie zwrócił statusu wykonania ${dagRunId} procesu "${dagName}".`)),
    statusLabel: null, sukces: false, kroki: [] }
  }
  const kroki = Array.isArray(dane.steps)
    ? dane.steps.map((k) => ({ name: k.name, statusLabel: k.statusLabel })) : []
  const sukces = ETYKIETY_SUKCESU.has(statusLabel)

  return { ok: true, statusLabel, sukces, kroki, dagName, dagRunId, wToku: ETYKIETY_W_TOKU.has(statusLabel) }
}

// Model kończy wiadomość deklaracją powodzenia w naturalnym języku. Szukamy jej po to,
// żeby ODRZUCIĆ ją przy czerwonym przebiegu - nie po to, żeby jej zaufać.
const WZ_DEKLARACJA_SUKCESU =
  /\b(gotowe|got[oó]w|zrobione|wykonane|uda[lł]o si[eę]|zako[nń]czy[lł]o si[eę] (?:sukcesem|powodzeniem)|dzia[lł]a|sukces(?:em)?|poprawnie)\b/i

/**
 * Godzi treść odpowiedzi modelu ze stanem odczytanym z silnika.
 * Zwraca ok:false zawsze, gdy przebieg nie jest zielony - niezależnie od tego, co napisał model.
 */
export function pogodzOdpowiedzModelu({ tekstModelu = '', wynik }) {
  const modelTwierdziSukces = WZ_DEKLARACJA_SUKCESU.test(String(tekstModelu))

  if (!wynik?.ok) {
    return { ok: false, statusLabel: wynik?.statusLabel ?? null, modelTwierdziSukces,
      komunikat: wynik?.naruszenia?.[0]?.komunikat
        ?? 'Nie udało się ustalić wyniku w silniku, więc nie potwierdzamy powodzenia.',
      naruszenia: wynik?.naruszenia ?? [] }
  }
  if (wynik.sukces) {
    return { ok: true, statusLabel: wynik.statusLabel, modelTwierdziSukces, komunikat: null, naruszenia: [] }
  }

  const czerwone = wynik.kroki.filter((k) => k.statusLabel && k.statusLabel !== 'succeeded')
  const szczegoly = czerwone.length
    ? ` Kroki niezakończone powodzeniem: ${czerwone.map((k) => `${k.name} (${k.statusLabel})`).join(', ')}.`
    : ''
  const wstep = modelTwierdziSukces
    ? 'Model napisał, że zadanie się udało, ale silnik mówi co innego. '
    : ''
  const n = naruszenie('WYNIK_CZERWONY', 'statusLabel',
    `${wstep}Wykonanie ${wynik.dagRunId} procesu "${wynik.dagName}" ma w silniku status ` +
    `"${wynik.statusLabel}".${szczegoly} Sukces ustalamy odczytem z silnika, nie z treści odpowiedzi.`)

  return { ok: false, statusLabel: wynik.statusLabel, modelTwierdziSukces,
    komunikat: n.komunikat, naruszenia: [n] }
}
