// Polityka identyfikatorów - decyzja architektoniczna v3 §4.2, macierz §13.2 (I1, I3).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  sprawdzIdentyfikator, naIdentyfikator, nadajIdentyfikator, WZORZEC_IDENTYFIKATORA,
} from '../../polityka/index.mjs'

describe('I1: wzorzec ^[a-z0-9][a-z0-9-]{0,38}$', () => {
  for (const nazwa of ['a', 'zamowienie', 'srednia-temperatura-z-trzech-miast', '0-start', 'a'.repeat(39)]) {
    test(`przyjmuje "${nazwa.slice(0, 20)}${nazwa.length > 20 ? '…' : ''}"`, () => {
      assert.equal(sprawdzIdentyfikator(nazwa).ok, true)
    })
  }

  const odrzucane = [
    ['spacja', 'moje zamowienie', 'ID_ZLY_ZNAK'],
    ['kropka (silnik ją przyjmuje, my nie)', 'order.v3', 'ID_ZLY_ZNAK'],
    ['wielka litera', 'Zamowienie', 'ID_ZLY_ZNAK'],
    ['znak diakrytyczny', 'zamówienie', 'ID_ZLY_ZNAK'],
    ['podkreślenie', 'moje_zamowienie', 'ID_ZLY_ZNAK'],
    ['wiodący dywiz', '-zamowienie', 'ID_ZLY_ZNAK'],
    ['ukryty plik', '.hidden', 'ID_ZLY_ZNAK'],
    ['wyjście z katalogu', '../etc', 'ID_ZLY_ZNAK'],
    ['40 znaków', 'a'.repeat(40), 'ID_ZA_DLUGI'],
    ['pusty', '', 'ID_PUSTY'],
  ]
  for (const [opis, nazwa, kod] of odrzucane) {
    test(`odrzuca: ${opis}`, () => {
      const wynik = sprawdzIdentyfikator(nazwa)
      assert.equal(wynik.ok, false)
      assert.equal(wynik.naruszenia[0].kod, kod)
      assert.ok(wynik.naruszenia[0].komunikat.length > 20)
    })
  }

  test('wzorzec jest wyeksportowany, żeby UI go nie duplikowało', () => {
    assert.equal(WZORZEC_IDENTYFIKATORA.source, '^[a-z0-9][a-z0-9-]{0,38}$')
  })
})

describe('I3: transliteracja deterministyczna', () => {
  const przypadki = [
    ['Średnia temperatura z trzech miast', 'srednia-temperatura-z-trzech-miast'],
    ['Premie 8% od pensji', 'premie-8-od-pensji'],
    ['Demo MCP - wartość zamówienia', 'demo-mcp-wartosc-zamowienia'],
    ['Łódź: żółć, ćma, ęsi', 'lodz-zolc-cma-esi'],
    ['   spacje   dookoła   ', 'spacje-dookola'],
    ['Status OK', 'status-ok'],
  ]
  for (const [wejscie, oczekiwane] of przypadki) {
    test(`"${wejscie}" -> "${oczekiwane}"`, () => {
      assert.equal(naIdentyfikator(wejscie), oczekiwane)
      assert.equal(sprawdzIdentyfikator(naIdentyfikator(wejscie)).ok, true)
    })
  }

  test('jest deterministyczna - dwa wywołania dają to samo', () => {
    assert.equal(naIdentyfikator('Żółta łódź'), naIdentyfikator('Żółta łódź'))
  })

  test('skraca do 39 znaków po granicy dywizu', () => {
    const id = naIdentyfikator('Bardzo dluga nazwa procesu ktora przekracza limit dlugosci')
    assert.ok(id.length <= 39, id)
    assert.ok(!id.endsWith('-'), id)
    assert.equal(sprawdzIdentyfikator(id).ok, true)
  })
})

describe('I3: kolizje rozstrzyga polityka, nie model', () => {
  test('pierwsza wolna nazwa idzie bez sufiksu', () => {
    const w = nadajIdentyfikator('Średnia temperatura z trzech miast', [])
    assert.equal(w.identyfikator, 'srednia-temperatura-z-trzech-miast')
    assert.equal(w.kolizja, false)
  })

  test('druga taka sama nazwa dostaje sufiks -2', () => {
    const w = nadajIdentyfikator('Średnia temperatura z trzech miast', ['srednia-temperatura-z-trzech-miast'])
    assert.equal(w.identyfikator, 'srednia-temperatura-z-trzech-miast-2')
    assert.equal(w.kolizja, true)
  })

  test('trzecia dostaje -3', () => {
    const w = nadajIdentyfikator('Średnia temperatura z trzech miast',
      ['srednia-temperatura-z-trzech-miast', 'srednia-temperatura-z-trzech-miast-2'])
    assert.equal(w.identyfikator, 'srednia-temperatura-z-trzech-miast-3')
  })

  test('sufiks mieści się w limicie 39 znaków', () => {
    const dluga = 'Bardzo dluga nazwa procesu ktora przekracza limit'
    const bazowy = naIdentyfikator(dluga)
    const w = nadajIdentyfikator(dluga, [bazowy])
    assert.ok(w.identyfikator.length <= 39, w.identyfikator)
    assert.equal(sprawdzIdentyfikator(w.identyfikator).ok, true)
    assert.match(w.identyfikator, /-2$/)
  })

  test('nazwa bez ani jednego dozwolonego znaku - odmowa, nie zgadywanie', () => {
    const w = nadajIdentyfikator('!!! ???', [])
    assert.equal(w.ok, false)
    assert.equal(w.naruszenia[0].kod, 'ID_PUSTY')
  })
})
