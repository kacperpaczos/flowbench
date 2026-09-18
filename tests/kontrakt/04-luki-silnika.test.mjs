// LUKI SILNIKA - osiem testow, ktore przechodza na ZIELONO pokazujac, czego silnik
// NIE lapie. Zielony wynik tutaj nie jest akceptacja zachowania: kazdy z tych
// przypadkow jest naruszeniem kontraktu K1-K6 albo polityki identyfikatorow §4.2,
// ktore silnik przepuszcza. To sa testy regresji dla warstwy polityki (T2) - gdy
// polityka zacznie je blokowac, ta blokada bedzie widoczna po jej stronie, a tutaj
// nadal ma byc widoczne, ze SAM SILNIK ich nie zatrzymuje.
//
// Zrodlo: decyzja-architektoniczna.md §4.1a (tabela "Nie egzekwuje silnik"),
// audyt-dagu-walidacja.md §2.3, §2.4, §2.6, §3.1, §3.4, §4.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zapiszDag, wykonaj, stdoutKroku, mcp } from './stos.mjs';

const SMIECI = '{"order_id":123,"total":"junk","extra":"sneaked"}';

test('luka: drugi kanal - DAGU_OUTPUT_FILE jest calkowicie poza zasiegiem output_schema', async () => {
  // walidacja §2.3. stdout zgodny ze schematem, rownolegly kanal niezgodny w kazdym
  // punkcie: zly typ order_id, zly typ total, nadmiarowe pole mimo
  // additionalProperties: false. DAG konczy sie na zielono, odbiorca dostaje smieci.
  await zapiszDag(
    'l-drugi-kanal',
    `name: l-drugi-kanal
steps:
  - id: produce
    run: |
      printf 'RESULT=%s\\n' '${SMIECI}' >> "$DAGU_OUTPUT_FILE"
      echo '{"order_id":"A-1","total":1.5}'
    outputs:
      - {name: RESULT, type: json}
    output_schema:
      type: object
      additionalProperties: false
      required: [order_id, total]
      properties:
        order_id: {type: string}
        total: {type: number}
  - id: consume
    depends: [produce]
    run: printf '%s\\n' '\${steps.produce.outputs.RESULT}'
`,
  );
  const w = await wykonaj('l-drugi-kanal');

  assert.equal(w.status, 'succeeded', 'LUKA: silnik nie zaczerwienil przebiegu');
  assert.equal(w.kroki.produce.status, 'succeeded');
  assert.equal(w.kroki.produce.blad, '');
  assert.equal(
    (await stdoutKroku(w, 'consume')).trim(),
    SMIECI,
    'LUKA: odbiorca dostal dane niezgodne ze schematem, a przebieg jest zielony',
  );
});

test('luka: brak output_schema na kroku publikujacym wynik - pole jest opcjonalne', async () => {
  // walidacja §3.4 / decyzja §4.1a. Nie ma przelacznika "wymagaj output_schema".
  await zapiszDag(
    'l-brak-schematu',
    `name: l-brak-schematu
steps:
  - id: produce
    run: echo '${SMIECI}'
    output: RESULT
  - id: consume
    depends: [produce]
    run: printf '%s\\n' "$RESULT"
`,
  );
  const w = await wykonaj('l-brak-schematu');

  assert.equal(w.status, 'succeeded', 'LUKA: brak schematu nie jest bledem dla silnika');
  assert.equal((await stdoutKroku(w, 'consume')).trim(), SMIECI);
});

test('luka: oslabiony schemat - cztery oslabienia, kazde przepuszcza inne naruszenie', async () => {
  // walidacja §2.4 / decyzja §13.1 K3. Kazdy z tych czterech schematow jest dla
  // silnika calkowicie poprawny, a kazdy przepuszcza inne naruszenie kontraktu.
  // Wzorzec pelny (K3) to: type: object + required + properties z typami +
  // additionalProperties: false - i dopiero komplet cos znaczy.
  const oslabienia = [
    ['pusty', '{}', SMIECI],
    [
      'bez-required',
      '{type: object, additionalProperties: false, properties: {order_id: {type: string}, total: {type: number}}}',
      '{}',
    ],
    [
      'bez-additionalproperties',
      '{type: object, required: [order_id, total], properties: {order_id: {type: string}, total: {type: number}}}',
      '{"order_id":"A-1","total":1.5,"extra":"sneaked"}',
    ],
    [
      'string-zamiast-number',
      '{type: object, additionalProperties: false, required: [order_id, total], properties: {order_id: {type: string}, total: {type: string}}}',
      '{"order_id":"A-1","total":"184.46"}',
    ],
  ];

  for (const [etykieta, schemat, ladunek] of oslabienia) {
    const nazwa = `l-oslabiony-${etykieta}`;
    await zapiszDag(
      nazwa,
      `name: ${nazwa}
steps:
  - id: produce
    run: echo '${ladunek}'
    output: RESULT
    output_schema: ${schemat}
  - id: consume
    depends: [produce]
    run: printf '%s\\n' "$RESULT"
`,
    );
    const w = await wykonaj(nazwa);

    assert.equal(w.status, 'succeeded', `LUKA (${etykieta}): silnik przyjal oslabiony schemat`);
    assert.equal(w.kroki.produce.blad, '');
    assert.equal(
      (await stdoutKroku(w, 'consume')).trim(),
      ladunek,
      `LUKA (${etykieta}): dane lamiace kontrakt przeszly granice kroku`,
    );
  }
});

test('luka: continue_on mark_success zamienia naruszenie w zielony przebieg', async () => {
  // walidacja §2.6. Wynik sie nie publikuje, wiec smieci nie jada dalej - ale
  // przebieg klamie o sukcesie, a odbiorca dostaje pusta wartosc i leci dalej.
  await zapiszDag(
    'l-mark-success',
    `name: l-mark-success
steps:
  - id: produce
    run: echo '{"order_id":"A-1","total":"WRONG"}'
    output: RESULT
    output_schema:
      type: object
      additionalProperties: false
      required: [order_id, total]
      properties:
        order_id: {type: string}
        total: {type: number}
    continue_on: {failure: true, mark_success: true}
  - id: consume
    depends: [produce]
    run: printf 'odebrano=[%s]\\n' "$RESULT"
`,
  );
  const w = await wykonaj('l-mark-success');

  assert.equal(w.status, 'succeeded', 'LUKA: naruszenie zamaskowane na zielono');
  assert.equal(w.kroki.produce.status, 'succeeded');
  assert.equal(w.kod, 0);
  assert.equal(
    (await stdoutKroku(w, 'consume')).trim(),
    'odebrano=[]',
    'LUKA: odbiorca dostal pusta wartosc i poszedl dalej',
  );
});

test('luka: defaults: rozdaje mark_success wszystkim krokom naraz, a output_schema nie zna', async () => {
  // walidacja §3.4. Naruszenie ukryte w domyslnych ustawieniach krokow jest
  // grozniejsze niz na pojedynczym kroku - nie widac go przy zadnym kroku z osobna.
  await zapiszDag(
    'l-defaults-maskuje',
    `name: l-defaults-maskuje
defaults:
  continue_on: {failure: true, mark_success: true}
steps:
  - id: produce
    run: echo '{"order_id":"A-1","total":"WRONG"}'
    output: RESULT
    output_schema:
      type: object
      additionalProperties: false
      required: [order_id, total]
      properties:
        order_id: {type: string}
        total: {type: number}
  - id: consume
    depends: [produce]
    run: printf 'odebrano=[%s]\\n' "$RESULT"
`,
  );
  const maskuje = await wykonaj('l-defaults-maskuje');

  assert.equal(maskuje.status, 'succeeded', 'LUKA: defaults zamaskowalo naruszenie globalnie');
  assert.equal(maskuje.kroki.produce.status, 'succeeded');
  assert.equal((await stdoutKroku(maskuje, 'consume')).trim(), 'odebrano=[]');

  // Druga polowa tej samej luki: nie da sie pojsc w druga strone i narzucic
  // output_schema wszystkim krokom - defaults tego pola nie zna.
  await zapiszDag(
    'l-defaults-schemat',
    `name: l-defaults-schemat
defaults:
  output_schema: {type: object, required: [order_id]}
steps:
  - id: produce
    run: echo '{"nieistotne":1}'
    output: RESULT
`,
  );
  const schemat = await wykonaj('l-defaults-schemat');

  assert.equal(schemat.runId, null, 'DAG nie laduje sie w ogole');
  assert.ok(
    schemat.cli.includes("'spec.defaults' has invalid keys: output_schema"),
    `brak oczekiwanego komunikatu w: ${schemat.cli}`,
  );
});

test('luka: nazwa DAG-a z kropka przechodzi przez MCP - ograniczenie musi byc po naszej stronie', async () => {
  // walidacja §4. Nasza polityka §4.2 to ^[a-z0-9][a-z0-9-]{0,38}$; silnik dopuszcza
  // kropke, wielkie litery i podkreslenie. `order.v3` zapisze sie bez slowa ostrzezenia.
  const nazwa = 'order.v3';
  const r = await mcp('dagu_change', {
    type: 'upsert_dag',
    mode: 'apply',
    name: nazwa,
    spec: `name: ${nazwa}\nsteps:\n  - id: s1\n    run: echo hello\n`,
  });

  assert.equal(r.valid, true, 'LUKA: lint silnika nie widzi problemu');
  assert.equal(r.applied, true, 'LUKA: definicja zostala zapisana');
  assert.deepEqual(r.errors, []);
  assert.equal(r.dagName, nazwa);
  assert.equal(r.dagUri, `dagu://dags/${nazwa}/spec`);

  // Inne nazwy spoza naszej polityki, ktore silnik takze przyjmuje.
  for (const n of ['.hidden', 'UPPER_case-1.2_3', '_lead']) {
    const p = await mcp('dagu_change', {
      type: 'upsert_dag',
      mode: 'preview',
      name: n,
      spec: `name: ${n}\nsteps:\n  - id: s1\n    run: echo hello\n`,
    });
    assert.equal(p.valid, true, `LUKA: silnik przyjmuje nazwe "${n}"`);
    assert.deepEqual(p.errors, []);
  }
});

test('luka: cykl a->b->a przechodzi lint dagu_change i wybucha dopiero przy starcie', async () => {
  // walidacja §3.1. Lint jest strukturalny, ale cyklu nie widzi.
  const spec =
    'name: l-cykl\nsteps:\n  - id: a\n    depends: [b]\n    run: echo a\n  - id: b\n    depends: [a]\n    run: echo b\n';
  const podglad = await mcp('dagu_change', { type: 'upsert_dag', mode: 'preview', name: 'l-cykl', spec });

  assert.equal(podglad.valid, true, 'LUKA: cykl przechodzi lint');
  assert.deepEqual(podglad.errors, []);

  const zapis = await mcp('dagu_change', { type: 'upsert_dag', mode: 'apply', name: 'l-cykl', spec });
  assert.equal(zapis.applied, true, 'LUKA: cykl zapisuje sie na dysk');

  const w = await wykonaj('l-cykl');
  assert.notEqual(w.kod, 0);
  assert.ok(
    w.cli.includes('failed to setup execution plan: cyclic plan detected'),
    `brak oczekiwanego komunikatu w: ${w.cli}`,
  );
  // Druga polowa luki: run-ID powstal, ale przebiegu nie da sie odczytac po nim
  // z API - a to jest dokladnie droga, ktora aplikacja ustala sukces (decyzja §4.3).
  assert.notEqual(w.runId, null, 'silnik wydal run-ID');
  assert.equal(w.brakPrzebiegu, true, 'LUKA: API nie zna tego przebiegu (404)');
  assert.equal(w.status, null);
});

test('luka: DAG bez krokow przechodzi lint i konczy sie succeeded', async () => {
  // walidacja §3.1 / decyzja §4.1a. Pusty proces wyglada dla odbiorcy jak sukces.
  const zapis = await mcp('dagu_change', {
    type: 'upsert_dag',
    mode: 'apply',
    name: 'l-bez-krokow',
    spec: 'name: l-bez-krokow\n',
  });

  assert.equal(zapis.valid, true, 'LUKA: DAG bez krokow przechodzi lint');
  assert.equal(zapis.applied, true);
  assert.deepEqual(zapis.errors, []);
  assert.deepEqual(zapis.dag.steps, []);

  const w = await wykonaj('l-bez-krokow');
  assert.equal(w.status, 'succeeded', 'LUKA: pusty proces konczy sie na zielono');
  assert.equal(w.kod, 0);
});
