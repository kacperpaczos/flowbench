#!/usr/bin/env bash
# n8n: wezel `Premia 8%` (set, includeOtherFields: true, wyrazenie
#      ={{ Math.round($json.pensja * 0.08 * 100) / 100 }}).
#
# `includeOtherFields: true` NIE ma odpowiednika w Dagu. `map(. + {...})` jest tu
# swiadomym odtworzeniem tej flagi: krok sam wypisuje caly dokument. Pominiecie tego
# zgubiloby `imie` i `stanowisko` po cichu, bez bledu (rejestr par. 4.4 pkt 2).
set -euo pipefail
: "${PRACOWNICY:?brak PRACOWNICY - krok musi miec depends na kroku publikujacym}"
echo "premie: dolicze 8% premii" >&2
printf '%s' "$PRACOWNICY" | jq -c '{elementy: (.elementy | map(. + {
  stawkaPremii: 0.08,
  premia: ((.pensja * 0.08) * 100 | round / 100)
}))}'
