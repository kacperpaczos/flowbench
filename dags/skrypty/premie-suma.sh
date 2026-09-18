#!/usr/bin/env bash
# n8n: wezel `Suma premii` (code, fan-in: sumy po wszystkich elementach + tablica szczegoly).
# Kolejnosc pol i kolejnosc elementow zachowane takie, jak w migawce wykonania #11.
set -euo pipefail
: "${Z_PODATKIEM:?brak Z_PODATKIEM - krok musi miec depends na kroku publikujacym}"
echo "premie: zwijam raport zbiorczy" >&2
printf '%s' "$Z_PODATKIEM" | jq -c '
  .elementy as $e
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
