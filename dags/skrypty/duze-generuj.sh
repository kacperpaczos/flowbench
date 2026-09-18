#!/usr/bin/env bash
# K6: wynik wiekszy niz praktyczny sufit kroku NIE jedzie zmienna. Idzie artefaktem,
# a granice kroku przekracza MANIFEST - maly dokument objety K1-K4.
#
# Manifest niesie dokladnie to, co K6 wymienia: sciezke wzgledem katalogu artefaktow,
# rozmiar i sume kontrolna. Niesie tez DEKLARACJE o zawartosci (`liczbaRekordow`,
# `sumaWartosci`), ktorych sam manifest udowodnic nie potrafi - i o to chodzi.
#
# USZKODZ=tak psuje ZAWARTOSC pliku, ale rozmiar i sume liczy z pliku FAKTYCZNIE
# zapisanego. Manifest jest wtedy wewnetrznie spojny i przechodzi walidacje manifestu,
# a mimo to zawartosc jest zla. To jest dowod, ze jedno nie zastepuje drugiego.
set -euo pipefail
: "${DAGU_ARTEFAKTY:?brak DAGU_ARTEFAKTY}"
rekordy="${REKORDY:-50000}"
uszkodz="${USZKODZ:-nie}"

katalog="$DAGU_ARTEFAKTY/duze-dane"
mkdir -p "$katalog"
wzgledna="duze-dane/pomiary.json"
plik="$DAGU_ARTEFAKTY/$wzgledna"

echo "K6: generuje $rekordy rekordow do $wzgledna (uszkodz=$uszkodz)" >&2

# Deklarowana suma wartosci: 0+1+...+(n-1) = n*(n-1)/2, liczona niezaleznie od pliku.
suma_deklarowana=$(( rekordy * (rekordy - 1) / 2 ))

if [ "$uszkodz" = "tak" ]; then
  # Zawartosc zla: o jeden rekord za malo i jedno pole jako tekst zamiast liczby.
  # Manifest nadal opisuje ten plik poprawnie - rozmiar i suma licza sie z niego.
  jq -cn --argjson n "$rekordy" '{
    rekordy: ([range(0; $n - 1) | {id: ., wartosc: ., etykieta: ("pomiar-" + (.|tostring))}]
              | .[0].wartosc |= tostring)
  }' > "$plik"
else
  jq -cn --argjson n "$rekordy" '{
    rekordy: [range(0; $n) | {id: ., wartosc: ., etykieta: ("pomiar-" + (.|tostring))}]
  }' > "$plik"
fi

rozmiar=$(wc -c < "$plik")
suma=$(sha256sum "$plik" | cut -d' ' -f1)
echo "K6: plik ma $rozmiar B, sha256 $suma" >&2

jq -cn \
  --arg    sciezka "$wzgledna" \
  --argjson rozmiar "$rozmiar" \
  --arg    suma    "$suma" \
  --argjson liczba "$rekordy" \
  --argjson sumaw  "$suma_deklarowana" \
  '{sciezka: $sciezka, rozmiarB: $rozmiar, sha256: $suma,
    liczbaRekordow: $liczba, sumaWartosci: $sumaw}'
