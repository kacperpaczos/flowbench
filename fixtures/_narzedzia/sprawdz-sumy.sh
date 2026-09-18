#!/usr/bin/env bash
# Niezalezne przeliczenie sum kontrolnych z MANIFEST.json przy pomocy sha256sum(1).
# Nie uzywa Pythona ani migawki — sprawdza wylacznie, czy pliki na dysku zgadzaja
# sie z tym, co manifest o nich mowi.
#
# Uzycie:  fixtures/_narzedzia/sprawdz-sumy.sh [<katalog-fixtures>]
set -euo pipefail

KATALOG="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
MANIFEST="$KATALOG/MANIFEST.json"

[ -f "$MANIFEST" ] || { echo "brak $MANIFEST"; exit 1; }

echo "katalog:  $KATALOG"
echo "manifest: $(jq -r '.liczbaPlikow' "$MANIFEST") wpisow, ekstrakcja $(jq -r '.znacznikEkstrakcji' "$MANIFEST")"
echo

# sha256sum --check czyta format "<suma>  <sciezka>"
jq -r '.pliki[] | "\(.sha256)  \(.sciezka)"' "$MANIFEST" \
  | ( cd "$KATALOG" && sha256sum --check --strict - )

echo
echo "--- rozmiary ---"
blad=0
while IFS=$'\t' read -r sciezka oczekiwany; do
  faktyczny=$(stat -c %s "$KATALOG/$sciezka")
  if [ "$faktyczny" = "$oczekiwany" ]; then
    printf '%s: %s B OK\n' "$sciezka" "$faktyczny"
  else
    printf '%s: %s B != %s B w manifescie BLAD\n' "$sciezka" "$faktyczny" "$oczekiwany"
    blad=1
  fi
done < <(jq -r '.pliki[] | "\(.sciezka)\t\(.rozmiarB)"' "$MANIFEST")

exit "$blad"
