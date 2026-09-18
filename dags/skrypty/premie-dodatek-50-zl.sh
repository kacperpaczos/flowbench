#!/usr/bin/env bash
# n8n: wezel `Dodatek 50 zl` (set x3 pola, includeOtherFields: true).
set -euo pipefail
: "${Z_PREMIA:?brak Z_PREMIA - krok musi miec depends na kroku publikujacym}"
echo "premie: dolicze dodatek 50 zl" >&2
printf '%s' "$Z_PREMIA" | jq -c '{elementy: (.elementy | map(. + {
  dodatek: 50,
  premiaRazem:   ((.premia + 50)            * 100 | round / 100),
  pensjaZPremia: ((.pensja + .premia + 50)  * 100 | round / 100)
}))}'
