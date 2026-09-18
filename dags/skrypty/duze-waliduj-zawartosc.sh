#!/usr/bin/env bash
# K6: walidacja ZAWARTOSCI - osobny krok, osobne kryterium, osobny wynik.
# Otwiera artefakt i sprawdza DEKLARACJE, ktorych manifest udowodnic nie mogl:
# faktyczna liczbe rekordow, typy pol i faktyczna sume wartosci.
set -euo pipefail
: "${MANIFEST:?brak MANIFEST}"
: "${DAGU_ARTEFAKTY:?brak DAGU_ARTEFAKTY}"

sciezka=$(printf '%s' "$MANIFEST" | jq -r .sciezka)
liczba_dekl=$(printf '%s' "$MANIFEST" | jq -r .liczbaRekordow)
suma_dekl=$(printf '%s' "$MANIFEST" | jq -r .sumaWartosci)
plik="$DAGU_ARTEFAKTY/$sciezka"

echo "K6/zawartosc: otwieram $sciezka i licze rekordy" >&2
fakty=$(jq -c '{
  liczbaRekordow: (.rekordy | length),
  sumaWartosci:   (.rekordy | map(.wartosc | select(type == "number")) | add // 0),
  zlyTyp:         (.rekordy | map(select((.wartosc | type) != "number")) | length)
}' "$plik")

liczba_fakt=$(printf '%s' "$fakty" | jq -r .liczbaRekordow)
suma_fakt=$(printf '%s' "$fakty" | jq -r .sumaWartosci)
zly_typ=$(printf '%s' "$fakty" | jq -r .zlyTyp)

blad=0
[ "$liczba_fakt" = "$liczba_dekl" ] || {
  echo "K6/zawartosc: rekordow $liczba_fakt, deklarowano $liczba_dekl" >&2; blad=1; }
[ "$suma_fakt" = "$suma_dekl" ] || {
  echo "K6/zawartosc: suma wartosci $suma_fakt, deklarowano $suma_dekl" >&2; blad=1; }
[ "$zly_typ" = "0" ] || {
  echo "K6/zawartosc: $zly_typ rekordow ma pole 'wartosc' innego typu niz number" >&2; blad=1; }

if [ "$blad" != "0" ]; then
  echo "K6/zawartosc: ZAWARTOSC NIEZGODNA z deklaracja manifestu" >&2
  exit 1
fi

echo "K6/zawartosc: zgodna" >&2
jq -cn --argjson l "$liczba_fakt" --argjson s "$suma_fakt" '{
  liczbaRekordow: $l, sumaWartosci: $s, zgodnaZDeklaracja: true
}'
