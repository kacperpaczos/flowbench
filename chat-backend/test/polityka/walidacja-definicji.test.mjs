// Testy bramki kontraktu. Każda luka z tabeli "Nie egzekwuje silnik"
// (decyzja architektoniczna v3, §4.1a) ma tu test negatywny pokazujący ODMOWĘ.
// Fan-in po rozgałęzieniu warunkowym ma test pozytywny - `continue_on: skipped`
// jest przez niego WYMAGANY [D13] i nie wolno go zakazywać hurtem.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { sprawdzDefinicje } from '../../polityka/index.mjs'
import { rejestr, schematYaml, kody, komunikaty, DAG_POPRAWNY, DAG_ROZGALEZIENIE } from './_wspolne.mjs'

const sprawdz = (nazwa, yaml, dodatkowe = {}) =>
  sprawdzDefinicje({ nazwa, yaml, rejestr, ...dodatkowe })

describe('pozytyw: definicja zgodna z kontraktem przechodzi', () => {
  test('proces odniesienia przechodzi i raportuje użyty kontrakt', () => {
    const wynik = sprawdz('wartosc-zamowienia', DAG_POPRAWNY)
    assert.equal(wynik.ok, true, komunikaty(wynik))
    assert.deepEqual(wynik.raport.uzyteKontrakty, [{ kontrakt: 'wartosc-zamowienia', wersja: 1 }])
    assert.match(wynik.raport.sumaKontrolna, /^sha256:[0-9a-f]{64}$/)
  })

  test('PUNKT 3: rozgałęzienie warunkowe z continue_on: skipped na obu gałęziach i fan-in PRZECHODZI', () => {
    const wynik = sprawdz('srednia-z-galezi', DAG_ROZGALEZIENIE)
    assert.equal(wynik.ok, true, komunikaty(wynik))
    assert.deepEqual(
      wynik.raport.uzyteKontrakty,
      [{ kontrakt: 'pomiar-temperatury', wersja: 1 },
        { kontrakt: 'pomiar-temperatury', wersja: 1 },
        { kontrakt: 'srednia-temperatur', wersja: 1 }])
  })

  test('continue_on w postaci skrótu "skipped" też przechodzi', () => {
    const yaml = DAG_ROZGALEZIENIE.replaceAll('continue_on:\n      skipped: true', 'continue_on: skipped')
    const wynik = sprawdz('srednia-z-galezi', yaml)
    assert.equal(wynik.ok, true, komunikaty(wynik))
  })

  test('suma kontrolna nie zmienia się po przeformatowaniu YAML-a', () => {
    const przeformatowany = DAG_POPRAWNY
      .replace('name: wartosc-zamowienia\n', '')
      .replace('description: Wartość zamówienia\n', 'description: "Wartość zamówienia"\nname: wartosc-zamowienia\n')
    const a = sprawdz('wartosc-zamowienia', DAG_POPRAWNY)
    const b = sprawdz('wartosc-zamowienia', przeformatowany)
    assert.equal(b.ok, true, komunikaty(b))
    assert.equal(a.raport.sumaKontrolna, b.raport.sumaKontrolna)
  })
})

describe('LUKA 1: krok publikujący wynik bez output_schema', () => {
  test('odmowa z kodem K3_BRAK_SCHEMATU', () => {
    const yaml = `name: bez-schematu
steps:
  - name: policz
    run: echo '{"produkt":"X","ilosc":1,"netto":1,"brutto":1}'
    output: WYNIK
  - name: pokaz
    depends: [policz]
    run: printf '%s' "$WYNIK" | jq -r .produkt
`
    const wynik = sprawdz('bez-schematu', yaml)
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['K3_BRAK_SCHEMATU'])
    assert.match(wynik.naruszenia[0].komunikat, /publikuje wynik przez output: WYNIK, ale nie ma output_schema/)
  })
})

describe('LUKA 2: schemat osłabiony', () => {
  const zeSchematem = (schemat) => `name: schemat-slaby
steps:
  - name: policz
    run: echo '{"produkt":"X","ilosc":1,"netto":1,"brutto":1}'
    output: WYNIK
    output_schema: ${schemat}
`

  test('2a: output_schema: {} - odmowa K3_SCHEMAT_PUSTY', () => {
    const wynik = sprawdz('schemat-slaby', zeSchematem('{}'))
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['K3_SCHEMAT_PUSTY'])
    assert.match(wynik.naruszenia[0].komunikat, /przepuszcza dowolny JSON, czyli nie jest kontraktem/)
  })

  test('2b: brak required - odmowa K3_BRAK_REQUIRED', () => {
    const schemat = `
      type: object
      additionalProperties: false
      properties:
        produkt: {type: string}
        ilosc: {type: integer}
        netto: {type: number}
        brutto: {type: number}`
    const wynik = sprawdz('schemat-slaby', zeSchematem(schemat))
    assert.equal(wynik.ok, false)
    assert.ok(kody(wynik).includes('K3_BRAK_REQUIRED'), komunikaty(wynik))
  })

  test('2c: brak additionalProperties: false - odmowa K3_BRAK_ADDITIONAL_PROPERTIES', () => {
    const schemat = `
      type: object
      required: [produkt, ilosc, netto, brutto]
      properties:
        produkt: {type: string}
        ilosc: {type: integer}
        netto: {type: number}
        brutto: {type: number}`
    const wynik = sprawdz('schemat-slaby', zeSchematem(schemat))
    assert.equal(wynik.ok, false)
    assert.ok(kody(wynik).includes('K3_BRAK_ADDITIONAL_PROPERTIES'), komunikaty(wynik))
  })

  test('2d: typ string tam, gdzie kontrakt mówi number - odmowa K3_KONTRAKT_ROZNICA_TYPU', () => {
    const schemat = `
      type: object
      additionalProperties: false
      required: [produkt, ilosc, netto, brutto]
      properties:
        produkt: {type: string}
        ilosc: {type: integer}
        netto: {type: number}
        brutto: {type: string}`
    const wynik = sprawdz('schemat-slaby', zeSchematem(schemat))
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['K3_KONTRAKT_ROZNICA_TYPU'])
    assert.match(wynik.naruszenia[0].komunikat,
      /właściwość "brutto" ma być typu number, a w definicji jest string/)
  })

  test('2e: schemat poprawny, ale niezatwierdzony - odmowa K3_KONTRAKT_NIEZATWIERDZONY', () => {
    const schemat = `
      type: object
      additionalProperties: false
      required: [cokolwiek]
      properties:
        cokolwiek: {type: string}`
    const wynik = sprawdz('schemat-slaby', zeSchematem(schemat))
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['K3_KONTRAKT_NIEZATWIERDZONY'])
    assert.match(wynik.naruszenia[0].komunikat, /nie jest żadnym z zatwierdzonych kontraktów/)
  })

  test('2f: właściwość bez type - odmowa K3_WLASCIWOSC_BEZ_TYPU', () => {
    const schemat = `
      type: object
      additionalProperties: false
      required: [produkt]
      properties:
        produkt: {description: nazwa}`
    const wynik = sprawdz('schemat-slaby', zeSchematem(schemat))
    assert.equal(wynik.ok, false)
    assert.ok(kody(wynik).includes('K3_WLASCIWOSC_BEZ_TYPU'), komunikaty(wynik))
  })

  test('2g: schemat tablicowy - odmowa K3_SCHEMAT_NIEOBIEKTOWY', () => {
    const wynik = sprawdz('schemat-slaby', zeSchematem('{type: array, items: {type: string}}'))
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['K3_SCHEMAT_NIEOBIEKTOWY'])
  })
})

describe('LUKA 3: continue_on maskujący naruszenie kontraktu', () => {
  const zContinueOn = (blok) => `name: maskowanie
steps:
  - name: policz
    run: echo '{"produkt":"X","ilosc":1,"netto":1,"brutto":1}'
    output: WYNIK
    output_schema: ${schematYaml('wartosc-zamowienia', 1)}
    continue_on:
${blok}
`

  test('3a: failure: true na kroku ze schematem - odmowa CONTINUE_ON_MASKUJE', () => {
    const wynik = sprawdz('maskowanie', zContinueOn('      failure: true'))
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['CONTINUE_ON_MASKUJE'])
    assert.match(wynik.naruszenia[0].komunikat, /Przebieg kłamie o sukcesie/)
  })

  test('3b: mark_success: true na kroku ze schematem - odmowa CONTINUE_ON_MASKUJE', () => {
    const wynik = sprawdz('maskowanie', zContinueOn('      failure: true\n      mark_success: true'))
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['CONTINUE_ON_MASKUJE'])
    assert.match(wynik.naruszenia[0].komunikat, /mark_success: true/)
  })

  test('3c: to samo ukryte w defaults: - odmowa CONTINUE_ON_DEFAULTS', () => {
    const yaml = `name: maskowanie-defaults
defaults:
  continue_on:
    failure: true
    mark_success: true
${DAG_POPRAWNY.split('\n').slice(2).join('\n')}`
    const wynik = sprawdz('maskowanie-defaults', yaml)
    assert.equal(wynik.ok, false)
    assert.ok(kody(wynik).includes('CONTINUE_ON_DEFAULTS'), komunikaty(wynik))
    assert.match(komunikaty(wynik), /dotyczy KAŻDEGO kroku/)
  })
})

describe('LUKA 4: drugi kanał wyniku (K5)', () => {
  test('4a: zapis do $DAGU_OUTPUT_FILE - odmowa K5_OUTPUT_FILE', () => {
    const yaml = `name: drugi-kanal
steps:
  - name: policz
    run: |
      echo '{"produkt":"X","ilosc":1,"netto":1,"brutto":1}'
      echo 'RESULT={"cokolwiek":true}' >> "$DAGU_OUTPUT_FILE"
    output: WYNIK
    output_schema: ${schematYaml('wartosc-zamowienia', 1)}
`
    const wynik = sprawdz('drugi-kanal', yaml)
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['K5_OUTPUT_FILE'])
    assert.match(wynik.naruszenia[0].komunikat, /Natywna walidacja output_schema tego kanału nie widzi/)
  })

  test('4b: deklaracja outputs: - odmowa K5_OUTPUTS', () => {
    const yaml = `name: drugi-kanal
steps:
  - name: policz
    run: echo '{"produkt":"X","ilosc":1,"netto":1,"brutto":1}'
    output: WYNIK
    output_schema: ${schematYaml('wartosc-zamowienia', 1)}
    outputs:
      - name: RESULT
        type: string
`
    const wynik = sprawdz('drugi-kanal', yaml)
    assert.equal(wynik.ok, false)
    assert.ok(kody(wynik).includes('K5_OUTPUTS'), komunikaty(wynik))
  })

  test('4c: odwołanie ${steps.*.outputs.*} - odmowa K5_ODWOLANIE_OUTPUTS', () => {
    const yaml = `name: drugi-kanal
steps:
  - name: policz
    run: echo '{"produkt":"X","ilosc":1,"netto":1,"brutto":1}'
    output: WYNIK
    output_schema: ${schematYaml('wartosc-zamowienia', 1)}
  - name: pokaz
    depends: [policz]
    run: echo '\${steps.policz.outputs.RESULT}'
`
    const wynik = sprawdz('drugi-kanal', yaml)
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['K5_ODWOLANIE_OUTPUTS'])
    assert.match(wynik.naruszenia[0].komunikat, /Silnik go NIE rozwija i NIE zgłasza/)
  })
})

describe('LUKA 5: cykl w grafie', () => {
  test('a -> b -> a - odmowa GRAF_CYKL (lint silnika to przepuszcza)', () => {
    const yaml = `name: cykl
steps:
  - name: a
    depends: [b]
    run: echo a
  - name: b
    depends: [a]
    run: echo b
`
    const wynik = sprawdz('cykl', yaml)
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['GRAF_CYKL'])
    assert.match(wynik.naruszenia[0].komunikat, /Cykl zależności w procesie "cykl"/)
  })
})

describe('LUKA 6: identyfikator spoza polityki §4.2', () => {
  const przypadki = [
    ['spacja', 'moje zamowienie'],
    ['kropka', 'order.v3'],
    ['wielka litera', 'Zamowienie'],
    ['znak diakrytyczny', 'zamówienie'],
    ['40 znaków', 'a'.repeat(40)],
    ['wiodący dywiz', '-zamowienie'],
    ['podkreślenie', 'moje_zamowienie'],
  ]
  for (const [opis, nazwa] of przypadki) {
    test(`odmowa dla nazwy z przypadku: ${opis}`, () => {
      const wynik = sprawdz(nazwa, DAG_POPRAWNY)
      assert.equal(wynik.ok, false)
      assert.ok(kody(wynik).some((k) => k.startsWith('ID_')), komunikaty(wynik))
    })
  }
})

describe('LUKA 7: DAG bez kroków', () => {
  test('brak steps: - odmowa DAG_BEZ_KROKOW', () => {
    const wynik = sprawdz('pusty-proces', 'name: pusty-proces\ndescription: nic tu nie ma\n')
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['DAG_BEZ_KROKOW'])
    assert.match(wynik.naruszenia[0].komunikat, /kończy go jako succeeded/)
  })

  test('pusta lista steps: - odmowa DAG_BEZ_KROKOW', () => {
    const wynik = sprawdz('pusty-proces', 'name: pusty-proces\nsteps: []\n')
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['DAG_BEZ_KROKOW'])
  })
})

describe('naruszenie ukryte poza pierwszym poziomem steps:', () => {
  test('w akcji własnej zdefiniowanej w DAG-u - odmowa', () => {
    const yaml = `name: akcja-wlasna
actions:
  emituj:
    input_schema:
      type: object
      required: [script]
      properties: {script: {type: string}}
    output_schema: {}
    template:
      run: "{{ .input.script }}"
steps:
  - name: policz
    action: emituj
    with:
      script: echo '{"produkt":"X","ilosc":1,"netto":1,"brutto":1}'
    output: WYNIK
`
    const wynik = sprawdz('akcja-wlasna', yaml)
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['K3_SCHEMAT_PUSTY'])
  })

  test('w akcji własnej z pliku bazowego - odmowa', () => {
    const plikBazowy = `actions:
  emituj:
    input_schema:
      type: object
      required: [script]
      properties: {script: {type: string}}
    output_schema:
      type: object
      properties:
        produkt: {type: string}
    template:
      run: "{{ .input.script }}"
`
    const yaml = `name: akcja-bazowa
steps:
  - name: policz
    action: emituj
    with:
      script: echo '{"produkt":"X"}'
    output: WYNIK
`
    const wynik = sprawdz('akcja-bazowa', yaml, { plikBazowy })
    assert.equal(wynik.ok, false)
    assert.ok(kody(wynik).includes('K3_BRAK_REQUIRED'), komunikaty(wynik))
    assert.ok(kody(wynik).includes('K3_BRAK_ADDITIONAL_PROPERTIES'), komunikaty(wynik))
    assert.match(komunikaty(wynik), /actions\.emituj\.output_schema/)
  })

  test('akcja własna z pliku bazowego przesłonięta lokalnie - odmowa', () => {
    const plikBazowy = `actions:
  emituj:
    input_schema: {type: object, required: [script], properties: {script: {type: string}}}
    output_schema: ${JSON.stringify(JSON.parse(schematYaml('wartosc-zamowienia', 1)))}
    template: {run: "{{ .input.script }}"}
`
    const yaml = `name: przeslonieta
actions:
  emituj:
    input_schema: {type: object, required: [script], properties: {script: {type: string}}}
    output_schema: {}
    template: {run: "{{ .input.script }}"}
steps:
  - name: policz
    action: emituj
    with: {script: "echo '{}'"}
    output: WYNIK
`
    const wynik = sprawdz('przeslonieta', yaml, { plikBazowy })
    assert.equal(wynik.ok, false)
    assert.ok(kody(wynik).includes('K3_KONTRAKT_NIEZATWIERDZONY'), komunikaty(wynik))
    assert.match(komunikaty(wynik), /nie wolno jej przesłonić/)
  })

  test('w definicji sub-DAG-a (action: dag.run) - odmowa', () => {
    const dziecko = `name: dziecko
steps:
  - name: policz
    run: echo '{"status":"OK"}'
    output: WYNIK
`
    const rodzic = `name: rodzic
steps:
  - name: wolaj
    action: dag.run
    with:
      dag: dziecko
`
    const wynik = sprawdz('rodzic', rodzic, { poddagi: { dziecko } })
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['K3_BRAK_SCHEMATU'])
    assert.match(wynik.naruszenia[0].pole, /^poddag\[dziecko\]\./)
  })

  test('sub-DAG, którego polityka nie widzi - odmowa SUBDAG_NIEZNANY', () => {
    const rodzic = `name: rodzic
steps:
  - name: wolaj
    action: dag.run
    with:
      dag: nieznane-dziecko
`
    const wynik = sprawdz('rodzic', rodzic)
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['SUBDAG_NIEZNANY'])
  })

  test('w ciele foreach - odmowa', () => {
    const yaml = `name: petla
steps:
  - name: iteruj
    foreach:
      as: item
      items: ["a", "b"]
      steps:
        - name: policz
          run: echo '{"status":"OK"}'
          output: WYNIK
`
    const wynik = sprawdz('petla', yaml)
    assert.equal(wynik.ok, false)
    assert.ok(kody(wynik).includes('K3_BRAK_SCHEMATU'), komunikaty(wynik))
  })

  test('kroki zapisane jako mapa, nie lista - polityka też je widzi', () => {
    const yaml = `name: mapa-krokow
steps:
  policz:
    run: echo '{"status":"OK"}'
    output: WYNIK
`
    const wynik = sprawdz('mapa-krokow', yaml)
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['K3_BRAK_SCHEMATU'])
  })
})

describe('K4: krawędź zależności jest krawędzią danych', () => {
  test('odbiorca czyta "$WYNIK" bez depends - odmowa K4_BRAK_DEPENDS', () => {
    const yaml = DAG_POPRAWNY.replace('    depends: [policz]\n', '')
    const wynik = sprawdz('wartosc-zamowienia', yaml)
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['K4_BRAK_DEPENDS'])
    assert.match(wynik.naruszenia[0].komunikat, /widoczne wyłącznie w krokach zależnych/)
  })

  test('zależność pośrednia (a -> b -> c) wystarcza', () => {
    const yaml = `name: posrednia
steps:
  - name: policz
    run: echo '{"status":"OK"}'
    output: WYNIK
    output_schema: ${schematYaml('status-procesu', 1)}
  - name: srodek
    depends: [policz]
    run: echo srodek
  - name: pokaz
    depends: [srodek]
    run: printf '%s' "$WYNIK" | jq -r .status
`
    const wynik = sprawdz('posrednia', yaml)
    assert.equal(wynik.ok, true, komunikaty(wynik))
  })

  test('depends wskazuje krok przez jego id, nie przez name - to jest poprawne', () => {
    // Sprawdzone wykonaniem na przypiętej wersji silnika: `depends: [pierwszy]` wobec
    // kroku `name: "Krok pierwszy", id: pierwszy` linituje sie i wykonuje na zielono.
    const yaml = `name: depends-po-id
steps:
  - id: policz
    name: "Policz wartość"
    run: echo '{"status":"OK"}'
    output: WYNIK
    output_schema: ${schematYaml('status-procesu', 1)}
  - id: pokaz
    name: "Pokaż wynik"
    depends: [policz]
    run: printf '%s' "$WYNIK" | jq -r .status
`
    const wynik = sprawdz('depends-po-id', yaml)
    assert.equal(wynik.ok, true, komunikaty(wynik))
  })

  test('cykl po identyfikatorach id też jest wykrywany', () => {
    const yaml = `name: cykl-po-id
steps:
  - id: a
    name: "Krok A"
    depends: [b]
    run: echo a
  - id: b
    name: "Krok B"
    depends: [a]
    run: echo b
`
    const wynik = sprawdz('cykl-po-id', yaml)
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['GRAF_CYKL'])
  })

  test('K4 liczy zależność wskazaną przez id', () => {
    const yaml = `name: k4-po-id
steps:
  - id: policz
    name: "Policz wartość"
    run: echo '{"status":"OK"}'
    output: WYNIK
    output_schema: ${schematYaml('status-procesu', 1)}
  - id: pokaz
    name: "Pokaż wynik"
    run: printf '%s' "$WYNIK" | jq -r .status
`
    const wynik = sprawdz('k4-po-id', yaml)
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['K4_BRAK_DEPENDS'])
  })

  test('depends na nieistniejący krok - odmowa GRAF_ZALEZNOSC_NIEISTNIEJACA', () => {
    const yaml = `name: zla-zaleznosc
steps:
  - name: a
    depends: [nie-ma-mnie]
    run: echo a
`
    const wynik = sprawdz('zla-zaleznosc', yaml)
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['GRAF_ZALEZNOSC_NIEISTNIEJACA'])
  })
})

describe('forma odwołania do kontraktu', () => {
  test('forma A: action z pliku bazowego niosąca zatwierdzony kontrakt przechodzi', () => {
    const plikBazowy = `actions:
  wartosc-zamowienia-v1:
    input_schema: {type: object, required: [script], properties: {script: {type: string}}}
    output_schema: ${JSON.stringify(JSON.parse(schematYaml('wartosc-zamowienia', 1)))}
    template: {run: "{{ .input.script }}"}
`
    const yaml = `name: forma-a
steps:
  - name: policz
    action: wartosc-zamowienia-v1
    with:
      script: echo '{"produkt":"X","ilosc":1,"netto":1,"brutto":1}'
    output: WYNIK
`
    const wynik = sprawdz('forma-a', yaml, { plikBazowy })
    assert.equal(wynik.ok, true, komunikaty(wynik))
    assert.equal(wynik.raport.kroki[0].forma, 'A')
    assert.deepEqual(wynik.raport.uzyteKontrakty, [{ kontrakt: 'wartosc-zamowienia', wersja: 1 }])
  })

  test('v2 kontraktu jest osobnym, zatwierdzonym schematem - też przechodzi', () => {
    const yaml = `name: wartosc-zamowienia
steps:
  - name: policz
    run: echo '{"produkt":"X","ilosc":1,"netto":1,"brutto":1,"stawkaVat":0.23}'
    output: WYNIK
    output_schema: ${schematYaml('wartosc-zamowienia', 2)}
`
    const wynik = sprawdz('wartosc-zamowienia', yaml)
    assert.equal(wynik.ok, true, komunikaty(wynik))
    assert.deepEqual(wynik.raport.uzyteKontrakty, [{ kontrakt: 'wartosc-zamowienia', wersja: 2 }])
  })

  test('dorzucenie pola do zatwierdzonego schematu w DAG-u - odmowa', () => {
    const rozszerzony = JSON.parse(schematYaml('wartosc-zamowienia', 1))
    rozszerzony.properties.rabat = { type: 'number' }
    const yaml = `name: wartosc-zamowienia
steps:
  - name: policz
    run: echo '{}'
    output: WYNIK
    output_schema: ${JSON.stringify(rozszerzony)}
`
    const wynik = sprawdz('wartosc-zamowienia', yaml)
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['K3_KONTRAKT_NIEZATWIERDZONY'])
  })
})

describe('inne odmowy kształtu kanału', () => {
  test('output: w postaci obiektowej - odmowa K2_OUTPUT_NIEPLASKI', () => {
    const yaml = `name: nieplaski
steps:
  - name: policz
    run: echo '{"status":"OK"}'
    output:
      STATUS: {from: stdout}
    output_schema: ${schematYaml('status-procesu', 1)}
`
    const wynik = sprawdz('nieplaski', yaml)
    assert.equal(wynik.ok, false)
    assert.ok(kody(wynik).includes('K2_OUTPUT_NIEPLASKI'), komunikaty(wynik))
  })

  test('output_schema bez output: - odmowa K2_BRAK_OUTPUT', () => {
    const yaml = `name: bez-output
steps:
  - name: policz
    run: echo '{"status":"OK"}'
    output_schema: ${schematYaml('status-procesu', 1)}
`
    const wynik = sprawdz('bez-output', yaml)
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['K2_BRAK_OUTPUT'])
  })

  test('definicja, która nie jest YAML-em - odmowa YAML_NIEPOPRAWNY', () => {
    const wynik = sprawdz('zly-yaml', 'name: [3:4\n  - to nie jest yaml')
    assert.equal(wynik.ok, false)
    assert.deepEqual(kody(wynik), ['YAML_NIEPOPRAWNY'])
  })
})
