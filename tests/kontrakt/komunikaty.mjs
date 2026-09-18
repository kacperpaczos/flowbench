// Engine messages, copied verbatim from docs/audyt-dagu-walidacja.md and
// re-confirmed by execution on the pinned image. Any change here means the
// engine changed its contract with us, so these are literals, not patterns.

// §2.2 - result does not match the schema
export const NIEZGODNY =
  'failed to validate output_schema: stdout JSON does not match output_schema';

// §2.2 - a step whose dependency failed
export const UPSTREAM = 'upstream failed';

// §2.4 - stdout is not a JSON document at all
export const DEKODOWANIE = (szczegol) =>
  `failed to validate output_schema: failed to decode stdout JSON for output_schema: ${szczegol}`;
export const NIE_JSON = DEKODOWANIE("invalid character 'h' in literal true (expecting 'r')");
export const LINIA_LOGU = DEKODOWANIE("invalid character 'I' looking for beginning of value");
export const DWA_DOKUMENTY = DEKODOWANIE("invalid character '{' after top-level value");

// §2.4 - stdout empty
export const PUSTY_STDOUT =
  'failed to validate output_schema: output_schema requires stdout to contain a JSON value matching the schema';

// §3.1 - cycle, caught only at start
export const CYKL = 'failed to setup execution plan: cyclic plan detected';

// §4 - DAG name longer than the engine allows
export const ZA_DLUGA_NAZWA = 'name must be less than 40 characters';
