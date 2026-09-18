// Polityka identyfikatorów - decyzja architektoniczna v3 par. 4.2.
//
// Rozdzielamy identyfikator techniczny (nazwa DAG-a = nazwa pliku = segment URL)
// od nazwy wyświetlanej (polska, z diakrytykami). Nasz wzorzec jest WĘŻSZY od tego,
// co przyjmuje silnik: Dagu dopuszcza [A-Za-z0-9._-] do 39 znaków i przyjął `order.v3`
// (audyt-dagu-walidacja.md par. 4). Zawężenie jest celowe - patrz tabela w par. 4.2.

import { naruszenie, odmowa, zgoda } from './bledy.mjs'

export const WZORZEC_IDENTYFIKATORA = /^[a-z0-9][a-z0-9-]{0,38}$/
export const MAKS_DLUGOSC = 39

// Diakrytyki, których NFD nie rozkłada (ł) albo które chcemy odwzorować wprost.
const OSOBNE = new Map(Object.entries({ ł: 'l', Ł: 'l', ß: 'ss', đ: 'd', Đ: 'd', ø: 'o', Ø: 'o' }))

export function sprawdzIdentyfikator(nazwa, pole = 'name') {
  if (typeof nazwa !== 'string' || nazwa.length === 0) {
    return odmowa(naruszenie('ID_PUSTY', pole, 'Proces musi mieć identyfikator; dostaliśmy pusty.'))
  }
  if (nazwa.length > MAKS_DLUGOSC) {
    return odmowa(naruszenie('ID_ZA_DLUGI', pole,
      `Identyfikator "${nazwa}" ma ${nazwa.length} znaków, a wolno najwyżej ${MAKS_DLUGOSC}. ` +
      'Silnik i tak odrzuci dłuższą nazwę; nazwę opisową trzymamy w polu "description".'))
  }
  if (!WZORZEC_IDENTYFIKATORA.test(nazwa)) {
    return odmowa(naruszenie('ID_ZLY_ZNAK', pole,
      `Identyfikator "${nazwa}" jest spoza dozwolonego zbioru ${WZORZEC_IDENTYFIKATORA.source}. ` +
      'Dozwolone są tylko małe litery, cyfry i dywiz, a pierwszy znak musi być literą albo cyfrą. ' +
      'Kropka, spacja, wielka litera, podkreślenie i znak diakrytyczny są zakazane; ' +
      'nazwę po polsku wpisz w pole "description".'))
  }
  return zgoda()
}

/**
 * Deterministyczna transliteracja nazwy wyświetlanej na identyfikator.
 * Nie rozstrzyga kolizji - od tego jest nadajIdentyfikator().
 */
export function naIdentyfikator(nazwaWyswietlana) {
  const tekst = String(nazwaWyswietlana ?? '')
  let bez = ''
  for (const znak of tekst) {
    if (OSOBNE.has(znak)) { bez += OSOBNE.get(znak); continue }
    // NFD rozkłada literę na znak bazowy + znak łączący; znaki łączące wyrzucamy.
    bez += znak.normalize('NFD').replace(/[̀-ͯ]/g, '')
  }
  const male = bez.toLowerCase()
  const zdywizami = male.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return przytnij(zdywizami)
}

/** Skrócenie do 39 znaków po granicy dywizu, żeby nie ucinać w środku słowa. */
function przytnij(id) {
  if (id.length <= MAKS_DLUGOSC) return id
  const ciety = id.slice(0, MAKS_DLUGOSC)
  const ostatni = ciety.lastIndexOf('-')
  const kandydat = ostatni > 0 ? ciety.slice(0, ostatni) : ciety
  return kandydat.replace(/-+$/g, '')
}

/**
 * Przydziela identyfikator i rozstrzyga kolizję sufiksem -2, -3, ...
 * Kolizje rozstrzyga NASZA warstwa, nigdy model (par. 4.2).
 */
export function nadajIdentyfikator(nazwaWyswietlana, zajete = []) {
  const zbior = zajete instanceof Set ? zajete : new Set(zajete)
  const bazowy = naIdentyfikator(nazwaWyswietlana)
  if (bazowy === '') {
    return { identyfikator: null, bazowy: '', kolizja: false,
      ...odmowa(naruszenie('ID_PUSTY', 'name',
        `Z nazwy "${nazwaWyswietlana}" nie da się zbudować identyfikatora - ` +
        'po transliteracji nie zostaje ani jeden dozwolony znak.')) }
  }
  if (!zbior.has(bazowy)) return { ok: true, identyfikator: bazowy, bazowy, kolizja: false }

  for (let n = 2; n < 1000; n += 1) {
    const sufiks = `-${n}`
    // Sufiks musi się zmieścić w limicie, więc najpierw robimy mu miejsce.
    const rdzen = przytnij(bazowy.slice(0, MAKS_DLUGOSC - sufiks.length)).replace(/-+$/g, '')
    const kandydat = `${rdzen}${sufiks}`
    if (!zbior.has(kandydat)) return { ok: true, identyfikator: kandydat, bazowy, kolizja: true }
  }
  return { identyfikator: null, bazowy, kolizja: true,
    ...odmowa(naruszenie('ID_ZLY_ZNAK', 'name',
      `Nie udało się nadać wolnego identyfikatora dla nazwy "${nazwaWyswietlana}" - ` +
      'wyczerpano sufiksy od -2 do -999.')) }
}
