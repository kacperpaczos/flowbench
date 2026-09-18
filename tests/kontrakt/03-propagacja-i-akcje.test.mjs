// What the engine DOES enforce beyond a single flat step: sub-DAGs, retries,
// custom actions carrying schemas outside the agent-written file, and the one
// branching shape that is correct rather than a violation.
// Source: docs/audyt-dagu-walidacja.md §2.2, §3.2, §3.5; decyzja §4.1a, §10.1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zapiszDag, wykonaj, stdoutKroku } from './stos.mjs';
import { NIEZGODNY } from './komunikaty.mjs';

test('sub-DAG: naruszenie w dziecku propaguje do rodzica', async () => {
  await zapiszDag(
    'k-dziecko',
    `name: k-dziecko
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
`,
  );
  await zapiszDag(
    'k-rodzic',
    `name: k-rodzic
steps:
  - id: wywolaj
    action: dag.run
    with: {dag: k-dziecko}
`,
  );

  const dziecko = await wykonaj('k-dziecko');
  assert.equal(dziecko.status, 'failed');
  assert.equal(dziecko.kroki.produce.blad, NIEZGODNY);

  const rodzic = await wykonaj('k-rodzic');
  assert.equal(rodzic.status, 'failed', 'rodzic musi zaczerwienic sie od dziecka');
  assert.equal(rodzic.kroki.wywolaj.status, 'failed');
  assert.equal(
    rodzic.kroki.wywolaj.blad,
    NIEZGODNY,
    'rodzic dostaje komunikat dziecka doslownie',
  );
  assert.notEqual(rodzic.kod, 0);
});

test('retry_policy: ponawia walidacje jak zwykly blad kroku i finalnie konczy failed', async () => {
  await zapiszDag(
    'k-retry',
    `name: k-retry
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
    retry_policy: {limit: 2, interval_sec: 1}
`,
  );
  const w = await wykonaj('k-retry');

  assert.equal(w.status, 'failed');
  assert.equal(w.kroki.produce.status, 'failed');
  assert.equal(w.kroki.produce.blad, NIEZGODNY);
  assert.equal(w.surowe.nodes[0].retryCount, 2, 'oba ponowienia musialy sie odbyc');
  // The engine logs each retry with the validation message, not a definition error.
  assert.ok(w.cli.includes(`err="${NIEZGODNY}" retry=0`));
  assert.ok(w.cli.includes(`err="${NIEZGODNY}" retry=1`));
});

test('akcja wlasna z pliku bazowego: wynik zgodny przechodzi', async () => {
  await zapiszDag(
    'k-akcja-ok',
    `name: k-akcja-ok
steps:
  - id: produce
    action: emit_result
    with: {script: "echo '{\\"order_id\\":\\"A-1\\",\\"total\\":1.5}'"}
    output: RESULT
`,
  );
  const w = await wykonaj('k-akcja-ok');
  assert.equal(w.status, 'succeeded');
  assert.equal(w.kroki.produce.status, 'succeeded');
});

test('akcja wlasna z pliku bazowego: wynik niezgodny konczy sie failed', async () => {
  // The DAG never repeats the schema, so the agent cannot weaken it here.
  await zapiszDag(
    'k-akcja-zla',
    `name: k-akcja-zla
steps:
  - id: produce
    action: emit_result
    with: {script: "echo '{\\"order_id\\":\\"A-1\\",\\"total\\":\\"ZLE\\"}'"}
    output: RESULT
`,
  );
  const w = await wykonaj('k-akcja-zla');
  assert.equal(w.status, 'failed');
  assert.equal(w.kroki.produce.status, 'failed');
  assert.equal(w.kroki.produce.blad, NIEZGODNY);
});

test('akcja wlasna: input_schema odmawia juz przy ladowaniu definicji', async () => {
  await zapiszDag(
    'k-akcja-zle-wejscie',
    `name: k-akcja-zle-wejscie
steps:
  - id: produce
    action: emit_result
    with: {skrypt: "echo hi"}
    output: RESULT
`,
  );
  const w = await wykonaj('k-akcja-zle-wejscie');

  assert.equal(w.runId, null, 'DAG nie moze wystartowac');
  assert.notEqual(w.kod, 0);
  assert.ok(
    w.cli.includes('invalid "emit_result" input: validating root: required: missing properties: ["script"]'),
    `brak oczekiwanego komunikatu w: ${w.cli}`,
  );
  assert.ok(w.cli.includes('failed to load DAG from k-akcja-zle-wejscie'));
});

test('akcji wlasnej z pliku bazowego nie da sie przeslonic lokalnie', async () => {
  // walidacja §3.5 - this is what keeps the schema outside the agent's file.
  await zapiszDag(
    'k-akcja-przeslona',
    `name: k-akcja-przeslona
actions:
  emit_result:
    input_schema:
      type: object
      properties: {script: {type: string}}
    template:
      run: "echo '{\\"cokolwiek\\":1}'"
steps:
  - id: produce
    action: emit_result
    with: {script: "echo hi"}
    output: RESULT
`,
  );
  const w = await wykonaj('k-akcja-przeslona');

  assert.equal(w.runId, null);
  assert.ok(
    w.cli.includes('duplicate custom action "emit_result" conflicts with an existing custom action'),
    `brak oczekiwanego komunikatu w: ${w.cli}`,
  );
});

// The branching shape decyzja §10.1 Wariant B calls for: two conditional branches
// on the content of the previous step's result, `continue_on: skipped` on both,
// fan-in collecting them. This is CORRECT use, not a masked violation - the suite
// has to be able to tell the two apart.
const DAG_ROZGALEZIENIE = `name: k-rozgalezienie
params:
  - PENSJA: "12000"
steps:
  - id: normalizuj
    run: echo "{\\"pensjaZPremia\\":\${PENSJA}}"
    output: BAZA
    output_schema:
      type: object
      additionalProperties: false
      required: [pensjaZPremia]
      properties:
        pensjaZPremia: {type: number}
  - id: stawka_wysoka
    depends: [normalizuj]
    preconditions:
      - eval: "$(printf '%s' \\"\${BAZA}\\" | jq -r 'if .pensjaZPremia > 10000 then \\"wysoka\\" else \\"niska\\" end')"
        expected: "wysoka"
    run: echo '{"stawka":0.32}'
    output: WYSOKA
    output_schema:
      type: object
      additionalProperties: false
      required: [stawka]
      properties:
        stawka: {type: number}
    continue_on: {skipped: true}
  - id: stawka_niska
    depends: [normalizuj]
    preconditions:
      - eval: "$(printf '%s' \\"\${BAZA}\\" | jq -r 'if .pensjaZPremia > 10000 then \\"wysoka\\" else \\"niska\\" end')"
        expected: "niska"
    run: echo '{"stawka":0.12}'
    output: NISKA
    output_schema:
      type: object
      additionalProperties: false
      required: [stawka]
      properties:
        stawka: {type: number}
    continue_on: {skipped: true}
  - id: zbierz
    depends: [stawka_wysoka, stawka_niska]
    run: |
      printf '%s\\n%s\\n' "$WYSOKA" "$NISKA" | jq -s -c 'map(select(type=="object")) | {stawka: .[0].stawka}'
    output: WYNIK
    output_schema:
      type: object
      additionalProperties: false
      required: [stawka]
      properties:
        stawka: {type: number}
`;

test('continue_on: skipped na galezi warunkowej + fan-in: DAG succeeded (galaz wysoka)', async () => {
  await zapiszDag('k-rozgalezienie', DAG_ROZGALEZIENIE);
  const w = await wykonaj('k-rozgalezienie', ['PENSJA=12000']);

  assert.equal(w.status, 'succeeded');
  assert.equal(w.kroki.stawka_wysoka.status, 'succeeded');
  assert.equal(w.kroki.stawka_niska.status, 'skipped');
  assert.equal(w.kroki.zbierz.status, 'succeeded');
  assert.equal((await stdoutKroku(w, 'zbierz')).trim(), '{"stawka":0.32}');
});

test('continue_on: skipped na galezi warunkowej + fan-in: DAG succeeded (galaz niska)', async () => {
  await zapiszDag('k-rozgalezienie', DAG_ROZGALEZIENIE);
  const w = await wykonaj('k-rozgalezienie', ['PENSJA=8000']);

  assert.equal(w.status, 'succeeded');
  assert.equal(w.kroki.stawka_wysoka.status, 'skipped');
  assert.equal(w.kroki.stawka_niska.status, 'succeeded');
  assert.equal(w.kroki.zbierz.status, 'succeeded');
  assert.equal((await stdoutKroku(w, 'zbierz')).trim(), '{"stawka":0.12}');
});

test('fan-in nie maskuje naruszenia: zly wynik galezi nadal czerwieni DAG', async () => {
  // Guards the test above: `continue_on: skipped` must not become a blanket excuse.
  await zapiszDag(
    'k-rozgalezienie-zla',
    DAG_ROZGALEZIENIE.replace('name: k-rozgalezienie', 'name: k-rozgalezienie-zla').replace(
      `run: echo '{"stawka":0.32}'`,
      `run: echo '{"stawka":"0.32"}'`,
    ),
  );
  const w = await wykonaj('k-rozgalezienie-zla', ['PENSJA=12000']);

  assert.equal(w.status, 'failed');
  assert.equal(w.kroki.stawka_wysoka.status, 'failed');
  assert.equal(w.kroki.stawka_wysoka.blad, NIEZGODNY);
});
