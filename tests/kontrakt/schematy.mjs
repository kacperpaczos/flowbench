// Shared DAG fragments. Kept in one place so a test that is meant to differ in
// exactly one thing differs in exactly one thing.

// The object schema from walidacja §1: the minimal correct template.
export const SCHEMAT = `
    output_schema:
      type: object
      additionalProperties: false
      required: [order_id, total]
      properties:
        order_id: {type: string}
        total: {type: number}`;

// Producer + dependent consumer, K1-K4 channel: stdout -> output: -> "$RESULT".
export function dagProducentKonsument(nazwa, polecenie, schemat = SCHEMAT) {
  return `name: ${nazwa}
steps:
  - id: produce
    run: ${polecenie}
    output: RESULT${schemat}
  - id: consume
    depends: [produce]
    run: printf 'odebrano=%s\\n' "$RESULT"
`;
}
