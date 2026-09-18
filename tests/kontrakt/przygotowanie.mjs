// Global setup/teardown for `node --test`. Brings the dagu-test stack up before
// any test file runs and tears it down afterwards, so the suite is runnable from
// a clean state with a single command and leaves nothing behind.

import { podnies, zatrzymaj } from './stos.mjs';

export async function globalSetup() {
  await podnies();
}

export async function globalTeardown() {
  await zatrzymaj();
}
