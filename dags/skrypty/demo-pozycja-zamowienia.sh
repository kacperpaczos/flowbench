#!/usr/bin/env bash
# n8n: wezel `Pozycja zamowienia` (set, mode=manual, 3 przypisania: string + 2x number).
# Deklaracja typu per pole nie ma odpowiednika w Dagu - typy odtwarza `output_schema`
# kroku i `jq` po stronie odbiorcy (decyzja par. 4.2, utrata A2).
set -euo pipefail
echo "demo: emituje pozycje zamowienia" >&2
jq -cn '{elementy: [{produkt: "Kabel HDMI 2.1", cenaNetto: 49.99, ilosc: 3}]}'
