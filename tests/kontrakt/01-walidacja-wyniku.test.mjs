// K1-K4: does the engine actually turn a contract violation red?
// Source of expected statuses and messages: docs/audyt-dagu-walidacja.md §2.1-2.2, §2.4.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zapiszDag, wykonaj, stdoutKroku } from './stos.mjs';
import { dagProducentKonsument } from './schematy.mjs';
import { NIEZGODNY, UPSTREAM } from './komunikaty.mjs';

// The shape every negative case below must produce: the producing step fails with
// the validation message, the dependent step is aborted, the whole run is red.
async function oczekujCzerwony(w, komunikat) {
  assert.equal(w.kroki.produce.status, 'failed');
  assert.equal(w.kroki.produce.blad, komunikat);
  assert.equal(w.kroki.consume.status, 'aborted');
  assert.equal(w.kroki.consume.blad, UPSTREAM);
  assert.equal(w.status, 'failed');
  assert.notEqual(w.kod, 0, 'CLI musi wyjsc kodem != 0');
  assert.ok(w.cli.includes(komunikat), 'komunikat musi byc widoczny takze w CLI');
}

test('wynik zgodny ze schematem: DAG succeeded, krok succeeded', async () => {
  const nazwa = 'k-zgodny';
  await zapiszDag(nazwa, dagProducentKonsument(nazwa, `echo '{"order_id":"A-1","total":184.46}'`));
  const w = await wykonaj(nazwa);

  assert.equal(w.status, 'succeeded');
  assert.equal(w.kroki.produce.status, 'succeeded');
  assert.equal(w.kroki.produce.blad, '');
  assert.equal(w.kroki.consume.status, 'succeeded');
  assert.equal(w.kod, 0);
  // The value really crossed the step boundary through "$RESULT".
  assert.equal(
    (await stdoutKroku(w, 'consume')).trim(),
    'odebrano={"order_id":"A-1","total":184.46}',
  );
});

test('wynik niezgodny - zly typ pola: krok failed, zalezny aborted, DAG failed', async () => {
  const nazwa = 'k-zly-typ';
  await zapiszDag(nazwa, dagProducentKonsument(nazwa, `echo '{"order_id":"A-1","total":"184.46"}'`));
  await oczekujCzerwony(await wykonaj(nazwa), NIEZGODNY);
});

test('brak wymaganego pola: krok failed, zalezny aborted, DAG failed', async () => {
  const nazwa = 'k-brak-pola';
  await zapiszDag(nazwa, dagProducentKonsument(nazwa, `echo '{"order_id":"A-1"}'`));
  await oczekujCzerwony(await wykonaj(nazwa), NIEZGODNY);
});

test('nadmiarowe pole przy additionalProperties=false: krok failed, zalezny aborted, DAG failed', async () => {
  const nazwa = 'k-nadmiarowe';
  await zapiszDag(
    nazwa,
    dagProducentKonsument(nazwa, `echo '{"order_id":"A-1","total":1.5,"junk":true}'`),
  );
  await oczekujCzerwony(await wykonaj(nazwa), NIEZGODNY);
});

test('K4: apostrof, cudzyslow, $(id) i backtick w danych wracaja doslownie i nic sie nie wykonuje', async () => {
  // decyzja §4.1: the new channel is not injected into the command line, so a quoted
  // heredoc carries the hostile value into the producer without any shell evaluation.
  const nazwa = 'k-cytowanie';
  const wartosc = 'Kubek "Duzy" 0,5l - Gosc\'s $(id) `whoami`';
  await zapiszDag(
    nazwa,
    `name: ${nazwa}
steps:
  - id: produce
    run: |
      cat <<'DANE' | jq -R '{produkt: ., total: 1.5}'
      ${wartosc}
      DANE
    output: RESULT
    output_schema:
      type: object
      additionalProperties: false
      required: [produkt, total]
      properties:
        produkt: {type: string}
        total: {type: number}
  - id: consume
    depends: [produce]
    run: printf '%s' "$RESULT" | jq -r .produkt
`,
  );
  const w = await wykonaj(nazwa);

  assert.equal(w.status, 'succeeded');
  assert.equal((await stdoutKroku(w, 'consume')).trim(), wartosc);
});

test('$NAZWA jest puste w kroku bez depends - krawedz zaleznosci jest krawedzia danych', async () => {
  // decyzja §4.1, druga pulapka: no `depends` is a silent absence of data.
  const nazwa = 'k-bez-depends';
  await zapiszDag(
    nazwa,
    `name: ${nazwa}
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
    run: printf 'odebrano=[%s]\\n' "$RESULT"
`,
  );
  const w = await wykonaj(nazwa);

  assert.equal(w.status, 'succeeded', 'silnik nie zglasza tego jako bledu');
  assert.equal((await stdoutKroku(w, 'consume')).trim(), 'odebrano=[]');
});
