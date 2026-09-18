#!/usr/bin/env bash
# n8n: wezel `Policz wartosc brutto` (code, runOnceForAllItems, VAT 23%, grosze).
# Petla `for (const item of $input.all())` staje sie jawnym `map()`.
set -euo pipefail
: "${POZYCJA:?brak POZYCJA - krok musi miec depends na kroku publikujacym}"
echo "demo: licze netto i brutto dla $(printf '%s' "$POZYCJA" | jq '.elementy|length') pozycji" >&2
printf '%s' "$POZYCJA" | jq -c '{elementy: (.elementy | map({
  produkt,
  ilosc,
  netto:  ((.cenaNetto * .ilosc)        * 100 | round / 100),
  brutto: ((.cenaNetto * .ilosc * 1.23) * 100 | round / 100)
}))}'
