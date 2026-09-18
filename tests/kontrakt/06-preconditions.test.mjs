// `preconditions` are a logical gate, not contract validation - decyzja §4.1a.
// An unmet precondition gives `skipped` and a GREEN run, so it must never be
// presented in an acceptance report as enforcement of K1-K6.
//
// This file also records two corrections to docs/audyt-dagu-walidacja.md §3.3,
// both measured on the pinned image 2026-09-18:
//   1. the `eval:` form quoted in §3.3 can never match, so the `skipped` the audit
//      observed did not prove the condition read the data at all;
//   2. `$( ... )` inside `eval` is cut at the FIRST `)`, so a jq expression with
//      parentheses silently becomes a broken shell command.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zapiszDag, wykonaj, stdoutKroku } from './stos.mjs';

// Contract-violating result (`total` as a string) plus a gate that only lets a
// numeric `total` through. Written without parentheses on purpose - see the last
// test in this file for why.
function dagBramka(nazwa, ladunek) {
  return `name: ${nazwa}
steps:
  - id: produce
    run: |
      cat <<'DANE'
      ${ladunek}
      DANE
    output: RESULT
  - id: gate
    depends: [produce]
    preconditions:
      - eval: "$(printf '%s' \\"\${RESULT}\\" | jq -r 'if .total|type == \\"number\\" then \\"ok\\" else \\"bad\\" end')"
        expected: "ok"
    run: echo przepuszczone
`;
}

test('preconditions nie sa walidacja: niespelniony warunek daje skipped i DAG succeeded', async () => {
  await zapiszDag('p-bramka', dagBramka('p-bramka', '{"order_id":"A-1","total":"NIE-LICZBA"}'));
  const w = await wykonaj('p-bramka');

  assert.equal(w.status, 'succeeded', 'DAG konczy sie na zielono mimo zlamanego kontraktu');
  assert.equal(w.kroki.produce.status, 'succeeded');
  assert.equal(w.kroki.gate.status, 'skipped');
  assert.equal(w.kroki.gate.blad, '', 'nikt nie dostaje alertu');
  assert.equal(w.kod, 0);
  assert.ok(
    w.cli.includes(String.raw`Preconditions failed for \"gate\"`),
    'silnik loguje pominiecie, ale nie jako blad',
  );
});

test('preconditions: kontrola dodatnia - warunek spelniony przepuszcza krok', async () => {
  // Bez tej kontroli `skipped` wyzej niczego nie dowodzi: w tym silniku `skipped`
  // jest takze domyslnym skutkiem zle napisanego `eval` (dwa testy nizej).
  await zapiszDag('p-bramka-ok', dagBramka('p-bramka-ok', '{"order_id":"A-1","total":184.46}'));
  const w = await wykonaj('p-bramka-ok');

  assert.equal(w.status, 'succeeded');
  assert.equal(w.kroki.gate.status, 'succeeded');
  assert.equal((await stdoutKroku(w, 'gate')).trim(), 'przepuszczone');
});

test('korekta audytu §3.3: eval bez podstawienia komendy NIGDY nie pasuje', async () => {
  // `eval` jest WARTOSCIA po podstawieniu, nie wierszem polecenia. Forma zapisana
  // w audycie ("echo ... | jq ...", bez $() ani backtickow) porownuje sie doslownie
  // z `expected` i zawsze wypada `skipped` - niezaleznie od danych. Kazdy warunek
  // napisany w ten sposob jest cicho wylaczona galezia, a DAG jest zielony.
  await zapiszDag(
    'p-eval-forma',
    `name: p-eval-forma
steps:
  - id: start
    run: echo start
  - id: forma_z_audytu
    depends: [start]
    preconditions:
      - eval: "echo tak"
        expected: "tak"
    run: echo forma-z-audytu-przeszla
  - id: forma_dzialajaca
    depends: [start]
    preconditions:
      - eval: "$(echo tak)"
        expected: "tak"
    run: echo forma-dzialajaca-przeszla
  - id: forma_backtick
    depends: [start]
    preconditions:
      - eval: "\`echo tak\`"
        expected: "tak"
    run: echo backticki-przeszly
`,
  );
  const w = await wykonaj('p-eval-forma');

  assert.equal(w.status, 'succeeded');
  assert.equal(
    w.kroki.forma_z_audytu.status,
    'skipped',
    'forma z audytu §3.3 nie pasuje nigdy, nawet dla trywialnie prawdziwego warunku',
  );
  assert.equal(w.kroki.forma_z_audytu.blad, '', 'i nie zglasza przy tym niczego');
  assert.equal(w.kroki.forma_dzialajaca.status, 'succeeded', '$() dziala');
  assert.equal(w.kroki.forma_backtick.status, 'succeeded', 'backticki dzialaja');
});

test('$( ) w eval urywa sie na pierwszym ) - krok failed, DAG aborted', async () => {
  // Nawias w wyrazeniu jq jest normalny (`(.total|type)`), wiec ta pulapka trafia
  // dokladnie w ksztalt warunku z decyzji §10.1. Silnik NIE mowi "zly nawias" -
  // mowi o bledzie skladni powloki na urwanym poleceniu. Backticki sa odporne.
  await zapiszDag(
    'p-nawias',
    `name: p-nawias
steps:
  - id: gate
    preconditions:
      - eval: "$(printf '%s' '{\\"t\\":1}' | jq -r 'if (.t|type)==\\"number\\" then \\"ok\\" else \\"bad\\" end')"
        expected: "ok"
    run: echo przepuszczone
`,
  );
  const w = await wykonaj('p-nawias');

  assert.equal(w.kroki.gate.status, 'failed');
  assert.equal(w.status, 'aborted', 'DAG konczy sie statusem aborted, nie failed');
  assert.ok(
    w.kroki.gate.blad.startsWith('failed to evaluate the value: Error=phase substitute: failed to execute command'),
    `nieoczekiwany komunikat: ${w.kroki.gate.blad}`,
  );
  assert.ok(
    w.kroki.gate.blad.includes('Syntax error: Unterminated quoted string'),
    'polecenie zostalo urwane w polowie cytowania',
  );
  assert.ok(
    w.kroki.gate.blad.includes(`jq -r 'if (.t|type"`),
    'urwanie nastepuje dokladnie na pierwszym nawiasie zamykajacym',
  );

  // Ta sama tresc w backtickach przechodzi - to jest obejscie, nie naprawa.
  await zapiszDag(
    'p-nawias-backtick',
    `name: p-nawias-backtick
steps:
  - id: gate
    preconditions:
      - eval: "\`printf '%s' '{\\"t\\":1}' | jq -r 'if (.t|type)==\\"number\\" then \\"ok\\" else \\"bad\\" end'\`"
        expected: "ok"
    run: echo przepuszczone
`,
  );
  const b = await wykonaj('p-nawias-backtick');
  assert.equal(b.status, 'succeeded');
  assert.equal(b.kroki.gate.status, 'succeeded');
});
