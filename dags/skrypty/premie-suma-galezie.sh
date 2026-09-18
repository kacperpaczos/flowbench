#!/usr/bin/env bash
# WARIANT B, fan-in. Zbiera obie galezie w jeden wynik koncowy.
#
# Trzy rzeczy, ktorych w wariancie A nie ma i ktore sa tu konieczne:
#  1. Galaz POMINIETA (`skipped`, bo jej zbior byl pusty) nie publikuje zmiennej -
#     odbiorca dostaje wartosc PUSTA, nie blad. Pusta = zero elementow, nie awaria.
#  2. Po rozdzieleniu kolejnosc nie jest dana - sortujemy po `_pozycja` PRZED zwinieciem
#     (rejestr par. 4.4 pkt 3).
#  3. `_pozycja` jest polem sluzbowym tego wariantu i znika z wyniku koncowego, zeby
#     wynik byl porownywalny z fixture co do kompletu pol.
set -euo pipefail
echo "premie/B: fan-in dwoch galezi" >&2

wysoki="${WYSOKI:-}"
niski="${NISKI:-}"
[ -z "$wysoki" ] && { echo "premie/B: galaz 'powyzej' pominieta - zero elementow" >&2; wysoki='{"elementy":[]}'; }
[ -z "$niski"  ] && { echo "premie/B: galaz 'ponizej' pominieta - zero elementow"  >&2; niski='{"elementy":[]}'; }

printf '%s\n%s' "$wysoki" "$niski" | jq -cs '
  ([.[].elementy] | add | sort_by(._pozycja) | map(del(._pozycja))) as $e
  | def suma(f): (($e | map(f) | add) * 100 | round / 100);
  {elementy: [{
    liczbaPracownikow: ($e | length),
    sumaPensji:        suma(.pensja),
    sumaPremii:        suma(.premia),
    sumaDodatkow:      suma(.dodatek),
    sumaPremiiRazem:   suma(.premiaRazem),
    sumaPodatku:       suma(.podatek),
    sumaNaDoReke:      suma(.naDoReke),
    szczegoly: ($e | map({imie, pensja, premia, dodatek, premiaRazem,
                          stawkaPodatku, podatek, naDoReke}))
  }]}'
