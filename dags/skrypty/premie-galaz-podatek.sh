#!/usr/bin/env bash
# WARIANT B, galaz obliczeniowa. Ta sama arytmetyka co w wariancie A - rozni sie tylko tym,
# ze stawka jest STALA dla calej galezi, bo o przydziale zadecydowal krok rozdzielajacy
# i `preconditions` silnika, a nie wyrazenie wewnatrz kroku.
#
# GALAZ  - klucz w dokumencie rozdzialu (`powyzej` albo `ponizej`)
# STAWKA - stawka podatku dla tej galezi
set -euo pipefail
: "${ROZDZIAL:?brak ROZDZIAL - krok musi miec depends na kroku rozdzielajacym}"
: "${GALAZ:?brak GALAZ}"
: "${STAWKA:?brak STAWKA}"
echo "premie/B: galaz ${GALAZ}, stawka ${STAWKA}" >&2
printf '%s' "$ROZDZIAL" | jq -c --arg galaz "$GALAZ" --argjson stawka "$STAWKA" '
  .progPodatkowy as $prog
  | {elementy: (.[$galaz] | map(. + {progPodatkowy: $prog, stawkaPodatku: $stawka}
      | . + {
          podatek:  ((.pensjaZPremia * .stawkaPodatku)                  * 100 | round / 100),
          naDoReke: ((.pensjaZPremia - .pensjaZPremia * .stawkaPodatku) * 100 | round / 100)
        }))}'
