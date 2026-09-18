// Wykonywana wersja = wersja zwalidowana (par. 13.3 S7).
//
// Między walidacją a startem jest okno. Silnik podnosi definicje z dysku niezależnie
// od MCP, a krok DAG-a (root) ma zapis do katalogu dags/ - audyt bezpieczeństwa P3
// pokazał wykonaniem podmianę CUDZEJ definicji z pominięciem lintu. Nie umiemy tego
// zapisu zablokować, ale umiemy go WYKRYĆ: tuż przed uruchomieniem odczytujemy
// definicję z silnika i porównujemy jej sumę kontrolną z tą, która przeszła politykę.
//
// Suma idzie z kanonicznej STRUKTURY, nie z bajtów - silnik przy zapisie przeformatowuje
// YAML, więc suma z bajtów dawałaby fałszywe odmowy przy każdym zapisie.

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { naruszenie, odmowa, zgoda } from './bledy.mjs'
import { kanoniczny, odcisk } from './kanonizacja.mjs'
import { parsujDefinicje } from './struktura.mjs'

export function sumaDefinicji({ nazwa, definicje }) {
  return odcisk({ nazwa, definicje })
}

export async function utworzRejestrZezwolen({ plik }) {
  let stan = {}
  if (plik) {
    try {
      stan = JSON.parse(await readFile(plik, 'utf8'))
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
  }

  async function zapisz() {
    if (!plik) return
    await mkdir(dirname(plik), { recursive: true })
    const tymczasowy = `${plik}.${randomUUID()}.tmp`
    await writeFile(tymczasowy, JSON.stringify(stan, null, 2), { mode: 0o600 })
    await rename(tymczasowy, plik)   // podmiana atomowa: albo stary plik, albo nowy
  }

  return {
    plik,

    /** Wołane PO udanej walidacji, przed zapisem definicji do silnika. */
    async zatwierdz({ nazwa, raport }) {
      const zezwolenie = {
        zezwolenieId: randomUUID(),
        nazwa,
        sumaKontrolna: raport.sumaKontrolna,
        odciskRejestru: raport.odciskRejestru,
        odciskBazy: raport.odciskBazy ?? null,
        poddagi: raport.poddagi ?? [],
        uzyteKontrakty: raport.uzyteKontrakty ?? [],
        czas: new Date().toISOString(),
      }
      stan[nazwa] = zezwolenie
      await zapisz()
      return zgoda({ zezwolenie })
    },

    znajdz: (nazwa) => stan[nazwa] ?? null,

    async uniewaznij(nazwa) {
      delete stan[nazwa]
      await zapisz()
      return zgoda()
    },

    /**
     * Wołane TUŻ PRZED start/retry/trigger, na treści odczytanej z silnika.
     * @param {object} p
     * @param {string} p.nazwa
     * @param {string|object} p.yamlZSilnika   definicja odczytana przez dagu_read target=dag_spec
     * @param {object} [p.poddagiZSilnika]     { nazwa: yaml } dla wołanych sub-DAG-ów
     * @param {string} p.odciskRejestru        aktualny rejestr.odcisk
     * @param {string|null} [p.odciskBazy]     aktualny odcisk base.yaml, jeśli wołający go zna
     */
    sprawdzPrzedStartem({ nazwa, yamlZSilnika, poddagiZSilnika = {}, odciskRejestru, odciskBazy = null }) {
      const zezwolenie = stan[nazwa]
      if (!zezwolenie) {
        return odmowa(naruszenie('ZEZWOLENIE_BRAK', 'name',
          `Proces "${nazwa}" nie ma ważnego zezwolenia - nigdy nie przeszedł polityki albo ` +
          'zezwolenie zostało unieważnione. Zapisz definicję przez process_write, wtedy ' +
          'zostanie zwalidowana i zatwierdzona.'))
      }
      if (zezwolenie.odciskRejestru !== odciskRejestru) {
        return odmowa(naruszenie('ZEZWOLENIE_REJESTR', 'kontrakty/',
          `Rejestr kontraktów zmienił się od czasu zatwierdzenia procesu "${nazwa}". ` +
          'Zezwolenia nie przenosimy na nowy rejestr automatycznie - zapisz definicję ponownie, ' +
          'żeby przeszła politykę wobec obowiązujących kontraktów.'))
      }

      const wynik = parsujDefinicje(yamlZSilnika, 'definicja-z-silnika')
      if (!wynik.ok) return odmowa(wynik.naruszenie)
      const definicje = { [nazwa]: kanoniczny(wynik.definicja) }
      for (const nazwaPoddaga of zezwolenie.poddagi ?? []) {
        const zrodlo = poddagiZSilnika[nazwaPoddaga]
        if (zrodlo === undefined) {
          return odmowa(naruszenie('ZEZWOLENIE_SUMA', `poddag[${nazwaPoddaga}]`,
            `Proces "${nazwa}" woła "${nazwaPoddaga}", ale nie dostaliśmy jego aktualnej definicji ` +
            'z silnika - nie da się potwierdzić, że wykonana zostanie wersja zwalidowana.'))
        }
        const wynikPoddaga = parsujDefinicje(zrodlo, `poddag[${nazwaPoddaga}]`)
        if (!wynikPoddaga.ok) return odmowa(wynikPoddaga.naruszenie)
        definicje[nazwaPoddaga] = kanoniczny(wynikPoddaga.definicja)
      }

      const suma = sumaDefinicji({ nazwa, definicje })
      if (suma !== zezwolenie.sumaKontrolna) {
        return odmowa(naruszenie('ZEZWOLENIE_SUMA', 'definicja',
          `Definicja procesu "${nazwa}" w silniku różni się od tej, która przeszła politykę. ` +
          `Zatwierdzono ${zezwolenie.sumaKontrolna.slice(0, 23)}…, w silniku leży ` +
          `${suma.slice(0, 23)}…. Uruchomienie wstrzymane: albo definicję zmieniono z pominięciem ` +
          'bramki (zapis pliku wprost do katalogu dags/), albo zezwolenie jest nieaktualne. ' +
          'Zapisz definicję ponownie przez process_write.'))
      }
      if (zezwolenie.odciskBazy !== null && odciskBazy !== null && zezwolenie.odciskBazy !== odciskBazy) {
        return odmowa(naruszenie('ZEZWOLENIE_SUMA', 'base.yaml',
          `Plik bazowy silnika zmienił się od czasu zatwierdzenia procesu "${nazwa}". ` +
          'Akcje własne z pliku bazowego niosą kontrakty, więc jego podmiana unieważnia zezwolenie.'))
      }

      return zgoda({ zezwolenie })
    },
  }
}
