// Kształt odmowy jest jeden dla całej warstwy: kod maszynowy, pole w sparsowanej
// strukturze i pełne zdanie po polsku dla operatora. Kody są stabilne - komunikaty
// wolno poprawiać, kodów nie. Spis kodów: chat-backend/KONTRAKT.md par. 7.

/** Naruszenie polityki. Nie jest wyjątkiem - odmowa to normalny wynik, nie awaria. */
export function naruszenie(kod, pole, komunikat) {
  return { kod, pole, komunikat }
}

export const odmowa = (...naruszenia) => ({ ok: false, naruszenia: naruszenia.flat() })
export const zgoda = (pola = {}) => ({ ok: true, ...pola })

/** Awaria, nie odmowa: zły plik kontraktu, nieosiągalny silnik, błąd programisty. */
export class BladRejestru extends Error {
  constructor(komunikat, plik) {
    super(komunikat)
    this.name = 'BladRejestru'
    this.plik = plik
  }
}

export class BladTransportu extends Error {
  constructor(komunikat, szczegoly) {
    super(komunikat)
    this.name = 'BladTransportu'
    this.szczegoly = szczegoly
  }
}

/** Jedna linia na naruszenie - to trafia przed oczy operatora. */
export function opiszNaruszenia(naruszenia) {
  if (!Array.isArray(naruszenia) || naruszenia.length === 0) return 'Brak naruszeń.'
  return naruszenia
    .map((n) => `[${n.kod}] ${n.pole ? `${n.pole}: ` : ''}${n.komunikat}`)
    .join('\n')
}
