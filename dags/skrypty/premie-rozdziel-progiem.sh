#!/usr/bin/env bash
# WARIANT B, krok rozdzielajacy. NIE MA odpowiednika w n8n - to jest przeprojektowanie,
# nie odtworzenie (decyzja par. 10.1). W n8n warunek byl wyrazeniem wewnatrz jednego wezla
# i silnik nie widzial zadnej galezi.
#
# Dokladamy `_pozycja` - indeks wejsciowy. Po rozdzieleniu i zlozeniu z powrotem kolejnosc
# elementow nie jest dana z gory, a fixture ma kolejnosc Anna/Piotr/Maria. `_pozycja`
# pozwala ja przywrocic i jest usuwana przed emisja wyniku koncowego.
set -euo pipefail
: "${Z_DODATKIEM:?brak Z_DODATKIEM - krok musi miec depends na kroku publikujacym}"
prog="${PROG_PODATKOWY:-10000}"
echo "premie/B: rozdzielam zbior progiem ${prog}" >&2
printf '%s' "$Z_DODATKIEM" | jq -c --argjson prog "$prog" '
  ([.elementy | to_entries[] | .value + {_pozycja: .key}]) as $we
  | {
      progPodatkowy: $prog,
      powyzej: [$we[] | select(.pensjaZPremia >  $prog)],
      ponizej: [$we[] | select(.pensjaZPremia <= $prog)]
    }
  | . + {liczbaPowyzej: (.powyzej | length), liczbaPonizej: (.ponizej | length)}'
