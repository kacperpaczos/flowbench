#!/usr/bin/env bash
# n8n: wezel `Set Status` (set, 1 przypisanie status="OK", typ string).
# Wejscie procesu jest zaszyte w definicji - tak samo jak bylo w n8n.
set -euo pipefail
echo "status-ok: ustawiam pole status" >&2
jq -cn '{elementy: [{status: "OK"}]}'
