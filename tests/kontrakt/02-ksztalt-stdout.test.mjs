// K1: stdout of a step under output_schema must be one clean JSON document.
// Source of expected messages: docs/audyt-dagu-walidacja.md §2.4-2.5.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zapiszDag, wykonaj } from './stos.mjs';
import { dagProducentKonsument } from './schematy.mjs';
import { NIE_JSON, LINIA_LOGU, PUSTY_STDOUT, DWA_DOKUMENTY, UPSTREAM } from './komunikaty.mjs';

async function oczekujBladStdout(nazwa, polecenie, komunikat) {
  await zapiszDag(nazwa, dagProducentKonsument(nazwa, polecenie));
  const w = await wykonaj(nazwa);

  assert.equal(w.kroki.produce.status, 'failed');
  assert.equal(w.kroki.produce.blad, komunikat);
  assert.equal(w.kroki.consume.status, 'aborted');
  assert.equal(w.kroki.consume.blad, UPSTREAM);
  assert.equal(w.status, 'failed');
  assert.ok(w.cli.includes(komunikat), 'komunikat musi byc widoczny takze w CLI');
  return w;
}

test('stdout nie-JSON: failed to decode stdout JSON for output_schema', async () => {
  await oczekujBladStdout('k-nie-json', `echo 'this is not json at all'`, NIE_JSON);
});

test('linia logu przed JSON-em: failed to decode stdout JSON for output_schema', async () => {
  await zapiszDag(
    'k-linia-logu',
    `name: k-linia-logu
steps:
  - id: produce
    run: |
      echo 'INFO starting work'
      echo '{"order_id":"A-1","total":1.5}'
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
    run: printf 'odebrano=%s\\n' "$RESULT"
`,
  );
  const w = await wykonaj('k-linia-logu');
  assert.equal(w.kroki.produce.blad, LINIA_LOGU);
  assert.equal(w.kroki.consume.status, 'aborted');
  assert.equal(w.status, 'failed');
});

test('pusty stdout: output_schema requires stdout to contain a JSON value', async () => {
  await oczekujBladStdout('k-pusty', '"true"', PUSTY_STDOUT);
});

test('dwa dokumenty JSON pod rzad: invalid character { after top-level value', async () => {
  await zapiszDag(
    'k-dwa-dokumenty',
    `name: k-dwa-dokumenty
steps:
  - id: produce
    run: |
      echo '{"order_id":"A-1","total":1.5}'
      echo '{"order_id":"A-2","total":2.5}'
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
    run: printf 'odebrano=%s\\n' "$RESULT"
`,
  );
  const w = await wykonaj('k-dwa-dokumenty');
  assert.equal(w.kroki.produce.blad, DWA_DOKUMENTY);
  assert.equal(w.status, 'failed');
});

test('JSON wielolinijkowy (pretty) przechodzi', async () => {
  await zapiszDag(
    'k-pretty',
    `name: k-pretty
steps:
  - id: produce
    run: |
      cat <<'JSON'
      {
        "order_id": "A-1",
        "total": 184.46
      }
      JSON
    output: RESULT
    output_schema:
      type: object
      additionalProperties: false
      required: [order_id, total]
      properties:
        order_id: {type: string}
        total: {type: number}
`,
  );
  const w = await wykonaj('k-pretty');
  assert.equal(w.status, 'succeeded');
  assert.equal(w.kroki.produce.status, 'succeeded');
});

test('K3: schemat tablicowy jest odrzucany przy ladowaniu DAG-a', async () => {
  // walidacja §2.5 - output_schema must resolve to an object schema.
  await zapiszDag(
    'k-schemat-tablica',
    `name: k-schemat-tablica
steps:
  - id: produce
    run: echo '[1,2,3]'
    output: RESULT
    output_schema: {type: array, items: {type: number}}
`,
  );
  const w = await wykonaj('k-schemat-tablica');

  assert.equal(w.runId, null, 'DAG nie powinien w ogole wystartowac');
  assert.notEqual(w.kod, 0);
  assert.ok(
    w.cli.includes('output_schema must resolve to an object schema'),
    `brak oczekiwanego komunikatu w: ${w.cli}`,
  );
  assert.ok(w.cli.includes('(value: map[items:map[type:number] type:array])'));
});

test('K3: schemat typu string jest odrzucany przy ladowaniu DAG-a', async () => {
  await zapiszDag(
    'k-schemat-string',
    `name: k-schemat-string
steps:
  - id: produce
    run: echo '"tekst"'
    output: RESULT
    output_schema: {type: string}
`,
  );
  const w = await wykonaj('k-schemat-string');

  assert.equal(w.runId, null);
  assert.ok(w.cli.includes('output_schema must resolve to an object schema'));
  assert.ok(w.cli.includes('(value: map[type:string])'));
});
