#!/usr/bin/env bash
# n8n: wezel `Dane pracownikow` (code) - zwracal TRZY ELEMENTY strumienia.
# W Dagu strumien elementow nie istnieje: trzy pozycje ida jako jedna tablica
# w jednym dokumencie, a kazdy nastepny krok robi jawny `map()` (rejestr par. 4.4 pkt 1).
set -euo pipefail
echo "premie: emituje 3 pracownikow" >&2
jq -cn '{elementy: [
  {imie: "Anna Kowalska",    stanowisko: "Analityk",  pensja: 7200},
  {imie: "Piotr Nowak",      stanowisko: "Developer", pensja: 11500},
  {imie: "Maria Wisniewska", stanowisko: "Kierownik", pensja: 15800}
]}'
