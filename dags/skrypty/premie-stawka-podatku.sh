#!/usr/bin/env bash
# WARIANT A. n8n: wezel `Stawka podatku` (set, wyrazenie WARUNKOWE
#      ={{ $json.pensjaZPremia > 10000 ? 0.32 : 0.12 }}).
#
# Warunek zostaje wewnatrz `jq`, tak jak w n8n zostawal wewnatrz jednego wezla.
# Graf jest liniowy - silnik nie widzi tu zadnej galezi, dokladnie jak n8n.
# To jest wariant A z decyzji par. 10.1: dowod WIERNOSCI LICZB, nie przypadek odbiorczy.
set -euo pipefail
: "${Z_DODATKIEM:?brak Z_DODATKIEM - krok musi miec depends na kroku publikujacym}"
echo "premie: wybieram stawke podatku progiem 10000" >&2
printf '%s' "$Z_DODATKIEM" | jq -c '{elementy: (.elementy | map(. + {
  progPodatkowy: 10000,
  stawkaPodatku: (if .pensjaZPremia > 10000 then 0.32 else 0.12 end)
}))}'
