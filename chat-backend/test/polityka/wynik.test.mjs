// Sukces czytany z silnika po dagRunId, nigdy z treści odpowiedzi modelu
// (§4.3 i §13.5 E8). Klient jest tu podstawiony - sprawdzamy regułę, nie transport.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { ustalWynik, pogodzOdpowiedzModelu } from '../../polityka/index.mjs'

function klientZwracajacy(dane) {
  return {
    odczytaj: async () => dane,
    dane: (x) => x,
  }
}

const PRZEBIEG_CZERWONY = {
  data: {
    dagRunId: '034R5MZjVIWhb0m2MFJxDe',
    name: 'wartosc-zamowienia',
    statusLabel: 'failed',
    steps: [
      { name: 'policz', statusLabel: 'failed' },
      { name: 'pokaz', statusLabel: 'aborted' },
    ],
  },
}

const PRZEBIEG_ZIELONY = {
  data: {
    dagRunId: '034R5MZjVIWhb0m2MFJxDe',
    name: 'wartosc-zamowienia',
    statusLabel: 'succeeded',
    steps: [{ name: 'policz', statusLabel: 'succeeded' }],
  },
}

describe('E8: model pisze "gotowe" przy czerwonym przebiegu', () => {
  test('warstwa zwraca błąd mimo deklaracji modelu', async () => {
    const wynik = await ustalWynik({
      klient: klientZwracajacy(PRZEBIEG_CZERWONY),
      dagName: 'wartosc-zamowienia', dagRunId: '034R5MZjVIWhb0m2MFJxDe',
    })
    assert.equal(wynik.sukces, false)
    assert.equal(wynik.statusLabel, 'failed')

    const werdykt = pogodzOdpowiedzModelu({
      tekstModelu: 'Gotowe. Proces został utworzony i uruchomiony, wynik jest poprawny.',
      wynik,
    })
    assert.equal(werdykt.ok, false)
    assert.equal(werdykt.modelTwierdziSukces, true)
    assert.equal(werdykt.naruszenia[0].kod, 'WYNIK_CZERWONY')
    assert.match(werdykt.komunikat, /Model napisał, że zadanie się udało, ale silnik mówi co innego/)
    assert.match(werdykt.komunikat, /status "failed"/)
    assert.match(werdykt.komunikat, /policz \(failed\), pokaz \(aborted\)/)
  })

  test('przebieg zielony - werdykt pozytywny', async () => {
    const wynik = await ustalWynik({
      klient: klientZwracajacy(PRZEBIEG_ZIELONY),
      dagName: 'wartosc-zamowienia', dagRunId: '034R5MZjVIWhb0m2MFJxDe',
    })
    const werdykt = pogodzOdpowiedzModelu({ tekstModelu: 'Gotowe.', wynik })
    assert.equal(werdykt.ok, true)
    assert.equal(werdykt.statusLabel, 'succeeded')
    assert.equal(werdykt.komunikat, null)
  })

  test('model milczy o sukcesie, ale przebieg czerwony - i tak błąd', async () => {
    const wynik = await ustalWynik({
      klient: klientZwracajacy(PRZEBIEG_CZERWONY),
      dagName: 'wartosc-zamowienia', dagRunId: '034R5MZjVIWhb0m2MFJxDe',
    })
    const werdykt = pogodzOdpowiedzModelu({ tekstModelu: 'Opisałem proces.', wynik })
    assert.equal(werdykt.ok, false)
    assert.equal(werdykt.modelTwierdziSukces, false)
    assert.match(werdykt.komunikat, /Sukces ustalamy odczytem z silnika/)
  })

  test('brak dagRunId - odmowa WYNIK_NIEZNANY, nie domniemanie sukcesu', async () => {
    const wynik = await ustalWynik({ klient: klientZwracajacy(PRZEBIEG_ZIELONY), dagName: 'x', dagRunId: null })
    assert.equal(wynik.ok, false)
    assert.equal(wynik.naruszenia[0].kod, 'WYNIK_NIEZNANY')
    const werdykt = pogodzOdpowiedzModelu({ tekstModelu: 'Wszystko gotowe!', wynik })
    assert.equal(werdykt.ok, false)
  })

  test('silnik nieosiągalny - odmowa, nie cisza', async () => {
    const klient = { odczytaj: async () => { throw new Error('connect ECONNREFUSED') }, dane: (x) => x }
    const wynik = await ustalWynik({ klient, dagName: 'x', dagRunId: 'abc' })
    assert.equal(wynik.ok, false)
    assert.equal(wynik.naruszenia[0].kod, 'WYNIK_NIEZNANY')
    assert.match(wynik.naruszenia[0].komunikat, /ECONNREFUSED/)
  })

  test('"partial success" nie jest sukcesem', async () => {
    const wynik = await ustalWynik({
      klient: klientZwracajacy({ data: { statusLabel: 'partial success', steps: [], dagRunId: 'a', name: 'b' } }),
      dagName: 'b', dagRunId: 'a',
    })
    assert.equal(wynik.sukces, false)
    assert.equal(pogodzOdpowiedzModelu({ tekstModelu: 'Zrobione.', wynik }).ok, false)
  })
})
