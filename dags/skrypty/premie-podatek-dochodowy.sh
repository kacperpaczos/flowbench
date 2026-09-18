#!/usr/bin/env bash
# n8n: wezel `Podatek dochodowy` (set x2 pola, includeOtherFields: true).
set -euo pipefail
: "${ZE_STAWKA:?brak ZE_STAWKA - krok musi miec depends na kroku publikujacym}"
echo "premie: licze podatek i kwote na reke" >&2
printf '%s' "$ZE_STAWKA" | jq -c '{elementy: (.elementy | map(. + {
  podatek:  ((.pensjaZPremia * .stawkaPodatku)                      * 100 | round / 100),
  naDoReke: ((.pensjaZPremia - .pensjaZPremia * .stawkaPodatku)     * 100 | round / 100)
}))}'
