#!/usr/bin/env bash
# K6: walidacja MANIFESTU. Sprawdza wylacznie to, o czym manifest moze cokolwiek wiedziec:
# czy plik pod deklarowana sciezka istnieje, czy ma deklarowany rozmiar i deklarowana sume.
#
# NIE otwiera zawartosci i NIE sprawdza zadnej deklaracji o niej. Pola `liczbaRekordow`
# i `sumaWartosci` przechodza tedy NIESPRAWDZONE - sprawdza je osobny krok.
set -euo pipefail
: "${MANIFEST:?brak MANIFEST - krok musi miec depends na kroku generujacym}"
: "${DAGU_ARTEFAKTY:?brak DAGU_ARTEFAKTY}"

sciezka=$(printf '%s' "$MANIFEST" | jq -r .sciezka)
rozmiar_dekl=$(printf '%s' "$MANIFEST" | jq -r .rozmiarB)
suma_dekl=$(printf '%s' "$MANIFEST" | jq -r .sha256)
plik="$DAGU_ARTEFAKTY/$sciezka"

echo "K6/manifest: sprawdzam $sciezka" >&2
[ -f "$plik" ] || { echo "K6/manifest: BRAK PLIKU $plik" >&2; exit 1; }

rozmiar_fakt=$(wc -c < "$plik")
suma_fakt=$(sha256sum "$plik" | cut -d' ' -f1)

[ "$rozmiar_fakt" = "$rozmiar_dekl" ] || {
  echo "K6/manifest: rozmiar $rozmiar_fakt != deklarowany $rozmiar_dekl" >&2; exit 1; }
[ "$suma_fakt" = "$suma_dekl" ] || {
  echo "K6/manifest: sha256 $suma_fakt != deklarowana $suma_dekl" >&2; exit 1; }

echo "K6/manifest: zgodne - plik nie zostal obciety ani podmieniony" >&2

jq -cn --arg s "$sciezka" --argjson r "$rozmiar_fakt" --arg h "$suma_fakt" '{
  sciezka: $s, rozmiarB: $r, sha256: $h,
  zgodnyRozmiar: true, zgodnaSuma: true,
  zawartoscSprawdzona: false,
  uwaga: "walidacja manifestu nie jest walidacja zawartosci - liczbaRekordow i sumaWartosci przeszly tedy niesprawdzone"
}'
