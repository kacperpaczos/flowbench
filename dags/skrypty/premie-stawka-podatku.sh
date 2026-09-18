#!/usr/bin/env bash
# WARIANT A. n8n: wezel `Stawka podatku` (set, wyrazenie WARUNKOWE
#      ={{ $json.pensjaZPremia > 10000 ? 0.32 : 0.12 }}).
#
# Warunek zostaje wewnatrz `jq`, tak jak w n8n zostawal wewnatrz jednego wezla.
# Graf jest liniowy - silnik nie widzi tu zadnej galezi, dokladnie jak n8n.
# To jest wariant A z decyzji par. 10.1: dowod WIERNOSCI LICZB, nie przypadek odbiorczy.
#
# EDYCJA 2026-09-18: prog podatkowy byl wpisany na sztywno w dwoch miejscach tego
# skryptu. Teraz jest parametrem DAG-a (PROG_PODATKOWY, domyslnie 10000) - tak samo
# jak w wariancie B, ktory mial go od poczatku. Wartosci domyslne daja wynik
# identyczny z fixture; zmienil sie sposob zapisu, nie liczby.
set -euo pipefail
: "${Z_DODATKIEM:?brak Z_DODATKIEM - krok musi miec depends na kroku publikujacym}"
prog="${PROG_PODATKOWY:-10000}"
echo "premie: wybieram stawke podatku progiem ${prog}" >&2
printf '%s' "$Z_DODATKIEM" | jq -c --argjson prog "$prog" '{elementy: (.elementy | map(. + {
  progPodatkowy: $prog,
  stawkaPodatku: (if .pensjaZPremia > $prog then 0.32 else 0.12 end)
}))}'
