// What the engine DOES reject on the write path (dagu_change lint, name rules),
// and where our policy §4.2 has to be narrower than the engine.
// Source: docs/audyt-dagu-walidacja.md §3.1, §4; decyzja §4.2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zapiszDag, wykonaj, stdoutKroku, mcp } from './stos.mjs';
import { ZA_DLUGA_NAZWA } from './komunikaty.mjs';

const SPEC = (nazwa) => `name: ${nazwa}\nsteps:\n  - id: s1\n    run: echo hello\n`;

test('nazwa 40+ znakow: silnik odrzuca - name must be less than 40 characters', async () => {
  // Nasza regexp §4.2 obiecywala 64 znaki, ktorych silnik nie przyjmie.
  const nazwa = 'a'.repeat(42);
  const r = await mcp('dagu_change', { type: 'upsert_dag', mode: 'apply', name: nazwa, spec: SPEC(nazwa) });

  assert.equal(r.valid, false);
  assert.equal(r.applied, false);
  assert.deepEqual(r.errors, [`field 'name': ${ZA_DLUGA_NAZWA} (value: ${nazwa})`]);
});

test('nazwa 39 znakow przechodzi - granica jest dokladnie tam, gdzie mowi komunikat', async () => {
  const nazwa = 'b'.repeat(39);
  const r = await mcp('dagu_change', { type: 'upsert_dag', mode: 'preview', name: nazwa, spec: SPEC(nazwa) });

  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
});

test('nazwy ze spacja, ukosnikiem, dwukropkiem i diakrytykiem: silnik odrzuca', async () => {
  const KOMUNIKAT =
    'name must only contain alphanumeric characters, dashes, dots, and underscores';
  for (const nazwa of ['moje zamowienie', 'grupa/zamowienia', 'order:v2', 'zamowienie-ace']) {
    const r = await mcp('dagu_change', { type: 'upsert_dag', mode: 'preview', name: nazwa, spec: SPEC(nazwa) });
    if (nazwa === 'zamowienie-ace') {
      // kontrola dodatnia: ta sama nazwa bez diakrytykow jest poprawna
      assert.equal(r.valid, true, 'nazwa bez diakrytykow musi przejsc');
      continue;
    }
    assert.equal(r.valid, false, `silnik powinien odrzucic "${nazwa}"`);
    assert.deepEqual(r.errors, [`field 'name': ${KOMUNIKAT} (value: ${nazwa})`]);
  }

  const zDiakrytykiem = 'zamowienie-acę';
  const r = await mcp('dagu_change', {
    type: 'upsert_dag',
    mode: 'preview',
    name: zDiakrytykiem,
    spec: SPEC(zDiakrytykiem),
  });
  assert.equal(r.valid, false, 'diakrytyk musi zostac odrzucony');
});

test('lint dagu_change lapie wady struktury definicji', async () => {
  // walidacja §3.1 - komplet wierszy z tabeli, kazdy z dokladnym komunikatem.
  const przypadki = [
    [
      'nieznane pole kroku',
      'name: w1\nsteps:\n  - id: a\n    run: echo a\n    totally_unknown_field: 1\n',
      "'spec.step' has invalid keys: totally_unknown_field",
    ],
    ['krok bez run i action', 'name: w2\nsteps:\n  - id: a\n', "field 'command': step command is required"],
    [
      'depends na nieistniejacy krok',
      'name: w3\nsteps:\n  - id: a\n    depends: [nie-istnieje]\n    run: echo a\n',
      'step a depends on non-existent step nie-istnieje',
    ],
    [
      'duplikat id',
      'name: w4\nsteps:\n  - id: a\n    run: echo a\n  - id: a\n    run: echo b\n',
      // Audyt §3.1 cytowal ten komunikat w skroconej postaci; silnik zwraca go
      // jako dwa zlaczone bledy - tu jest brzmienie faktyczne.
      "field 'steps': step name must be unique (value: a); field 'steps': duplicate step ID: a (value: a)",
    ],
    [
      'zly typ pola',
      "name: w5\nsteps:\n  - id: a\n    run: echo a\n    continue_on: {failure: 'yes-please'}\n",
      'continue_on.failure: expected bool, got string',
    ],
    [
      'brak wymaganego with akcji',
      'name: w6\nsteps:\n  - id: a\n    action: http.request\n    with: {url: "http://127.0.0.1"}\n',
      'with.method is required',
    ],
    [
      'niepoprawny YAML',
      'name: w7\nsteps:\n  - id: a\n   run: echo a\n',
      'value is not allowed in this context',
    ],
  ];

  for (const [etykieta, spec, komunikat] of przypadki) {
    const nazwa = spec.match(/^name: (\S+)/)[1];
    const r = await mcp('dagu_change', { type: 'upsert_dag', mode: 'preview', name: nazwa, spec });

    assert.equal(r.valid, false, `lint powinien odrzucic: ${etykieta}`);
    assert.ok(
      r.errors.some((e) => e.includes(komunikat)),
      `${etykieta}: brak "${komunikat}" w ${JSON.stringify(r.errors)}`,
    );
  }
});

test('mode=apply nie zapisuje definicji, ktora nie przeszla lintu', async () => {
  const spec = 'name: w-odrzucony\nsteps:\n  - id: a\n';
  const r = await mcp('dagu_change', { type: 'upsert_dag', mode: 'apply', name: 'w-odrzucony', spec });

  assert.equal(r.valid, false);
  assert.equal(r.applied, false);

  const brak = await wykonaj('w-odrzucony');
  assert.equal(brak.runId, null, 'definicja nie moze istniec na dysku');
  assert.notEqual(brak.kod, 0);
});

test('pulapka: ${steps.x.outputs.R} do kroku publikujacego przez output: przechodzi jako literal', async () => {
  // decyzja §4.1, pierwsza pulapka. Ani lint, ani wykonanie tego nie zglasza:
  // krok sie udaje, a odbiorca dostaje tekst placeholdera zamiast danych.
  // To jest cicha podmiana danych i nalezy do zakresu warstwy polityki (§4.1a),
  // tak samo jak osiem przypadkow z 04-luki-silnika.test.mjs.
  const spec = `name: w-literal
steps:
  - id: produce
    run: echo '{"order_id":"A-1","total":1.5}'
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
    run: printf '%s\\n' '\${steps.produce.outputs.RESULT}'
`;
  const lint = await mcp('dagu_change', { type: 'upsert_dag', mode: 'preview', name: 'w-literal', spec });
  assert.equal(lint.valid, true, 'lint tego nie zglasza');
  assert.deepEqual(lint.errors, []);

  await zapiszDag('w-literal', spec);
  const w = await wykonaj('w-literal');

  assert.equal(w.status, 'succeeded', 'przebieg jest zielony');
  assert.equal(
    (await stdoutKroku(w, 'consume')).trim(),
    '${steps.produce.outputs.RESULT}',
    'odbiorca dostal literal placeholdera zamiast danych',
  );
});
