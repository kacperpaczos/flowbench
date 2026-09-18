#!/usr/bin/env bash
# Runs the whole contract suite from a clean state, with one command.
#
# Brings up its own Dagu stack (compose project `dagu-test`, 127.0.0.1:9401, work
# directory outside the repository) and tears it down again - also when a test
# fails, when node crashes, or when the run is interrupted.
#
# It never touches the n8n stack (`n8niframe`, 8080) or the parallel stacks
# `dagu-sec` (91xx), `dagu-policy` (92xx), `n8n-fixture` (93xx), and it never
# passes `-v` to `docker compose down`.
set -uo pipefail

KATALOG_TESTOW="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJEKT=dagu-test

sprzataj() {
  # Belt and braces: globalTeardown already does this, but a hard crash or a
  # Ctrl-C would skip it and leave a container holding port 9401.
  if docker compose -p "$PROJEKT" ls -q 2>/dev/null | grep -q .; then
    docker compose -p "$PROJEKT" down --remove-orphans >/dev/null 2>&1
  fi
  rm -rf "${TMPDIR:-/tmp}/dagu-test-kontrakt"
}
trap sprzataj EXIT INT TERM

node --test \
  --test-global-setup="$KATALOG_TESTOW/kontrakt/przygotowanie.mjs" \
  "$KATALOG_TESTOW/kontrakt/*.test.mjs"
