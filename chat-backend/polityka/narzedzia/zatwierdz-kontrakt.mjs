#!/usr/bin/env node
// Promocja schematu z definicji procesu do rejestru kontraktów.
//
// Kontrakt wchodzi do katalogu kontrakty/ świadomą decyzją człowieka, jako plik widoczny
// w Gicie - nigdy jako efekt uboczny edycji DAG-a. To narzędzie tylko oszczędza
// przepisywania schematu ręcznie; nie wywołuje się samo i nie jest częścią bramki.
//
//   node chat-backend/polityka/narzedzia/zatwierdz-kontrakt.mjs [--zapisz] <plik.yaml> [...]
//
// Bez --zapisz wypisuje, co by zrobił, i niczego nie dotyka.

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsujDefinicje, zbierzKroki, zbierzUchwyty } from '../struktura.mjs'
import { wczytajRejestr } from '../rejestr-kontraktow.mjs'
import { naIdentyfikator } from '../identyfikatory.mjs'
import { odcisk } from '../kanonizacja.mjs'

const tutaj = dirname(fileURLToPath(import.meta.url))
const KORZEN = join(tutaj, '..', '..', '..')
const KATALOG = process.env.KONTRAKTY_DIR ?? join(KORZEN, 'kontrakty')

const argumenty = process.argv.slice(2)
const zapisz = argumenty.includes('--zapisz')
const pliki = argumenty.filter((a) => a !== '--zapisz')

if (pliki.length === 0) {
  console.error('Użycie: zatwierdz-kontrakt.mjs [--zapisz] <plik-dag.yaml> [...]')
  process.exit(2)
}

const rejestr = await wczytajRejestr(KATALOG)
const znane = new Map(rejestr.lista().map((w) => [w.odciskSchematu, w]))
const wersjeKontraktu = new Map()
for (const w of rejestr.lista()) {
  wersjeKontraktu.set(w.kontrakt, Math.max(wersjeKontraktu.get(w.kontrakt) ?? 0, w.wersja))
}

const doZapisu = []

for (const plik of pliki) {
  const zrodlo = await readFile(plik, 'utf8')
  const wynik = parsujDefinicje(zrodlo, plik)
  if (!wynik.ok) { console.error(`${plik}: ${wynik.naruszenie.komunikat}`); process.exitCode = 1; continue }
  const definicja = wynik.definicja
  const nazwaDaga = definicja.name ?? basename(plik, '.yaml')

  const kroki = [
    ...zbierzKroki(definicja.steps),
    ...zbierzUchwyty(definicja.handler_on),
  ]
  for (const { krok, nazwa } of kroki) {
    const schemat = krok.output_schema
    if (!schemat || typeof schemat !== 'object') continue

    const odciskSchematu = odcisk(schemat)
    const juz = znane.get(odciskSchematu)
    if (juz) {
      console.log(`= ${nazwaDaga} / ${nazwa}: już zatwierdzony jako ${juz.kontrakt} v${juz.wersja}`)
      continue
    }

    const idKontraktu = naIdentyfikator(krok.id ?? nazwa)
    if (idKontraktu === '') {
      console.error(`! ${nazwaDaga} / ${nazwa}: nie da się zbudować identyfikatora kontraktu`)
      process.exitCode = 1
      continue
    }
    const wersja = (wersjeKontraktu.get(idKontraktu) ?? 0) + 1
    wersjeKontraktu.set(idKontraktu, wersja)
    znane.set(odciskSchematu, { kontrakt: idKontraktu, wersja })

    const tresc = {
      kontrakt: idKontraktu,
      wersja,
      opis: `Wynik kroku "${nazwa}" procesu ${nazwaDaga}.`,
      zatwierdzony: new Date().toISOString().slice(0, 10),
      schemat,
    }
    doZapisu.push({ sciezka: join(KATALOG, idKontraktu, `v${wersja}.json`), tresc })
    console.log(`+ ${nazwaDaga} / ${nazwa}: ${idKontraktu} v${wersja}`)
  }
}

if (!zapisz) {
  console.log(`\nDo zapisania: ${doZapisu.length}. Uruchom ponownie z --zapisz, żeby utworzyć pliki.`)
} else {
  for (const { sciezka, tresc } of doZapisu) {
    await mkdir(dirname(sciezka), { recursive: true })
    await writeFile(sciezka, `${JSON.stringify(tresc, null, 2)}\n`)
  }
  console.log(`\nZapisano ${doZapisu.length} plików w ${KATALOG}. Sprawdź je w Gicie przed commitem.`)
}
