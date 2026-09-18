#!/usr/bin/env bash
# WARIANT B: dokument bramkowy dla `preconditions`.
#
# DLACZEGO OSOBNY KROK, a nie warunek wprost na dokumencie z danymi.
# `preconditions` NIE korzystaja z kanalu K4. Sprawdzone wykonaniem na przypietej
# wersji silnika:
#   * `eval` z podstawieniem `$NAZWA` wkleja WARTOSC DO TEKSTU POLECENIA przed
#     uruchomieniem powloki - apostrof w danych (`Gosc's`) rozwala cytowanie,
#     a `$(id)` w danych trafia do powloki. To jest dokladnie ten wektor, ktory
#     kontrakt K4 zamknal dla danych, a ktory w `preconditions` zostal otwarty;
#   * `condition: "${NAZWA}"` + `expected: "re:..."` dziala i NIE uruchamia powloki,
#     ale porownuje TEKST dokumentu wzorcem.
#
# Stad ten krok: bramka dostaje dokument o slownictwie ZAMKNIETYM ("tak"/"nie"),
# w ktorym nie ma ani jednego znaku pochodzacego z danych wejsciowych. Dane jada
# osobno, zmienna srodowiskowa, i sa parsowane `jq` wewnatrz galezi.
set -euo pipefail
: "${ROZDZIAL:?brak ROZDZIAL - krok musi miec depends na kroku rozdzielajacym}"
echo "premie/B: wyznaczam bramki galezi" >&2
printf '%s' "$ROZDZIAL" | jq -c '{
  galazPowyzej: (if .liczbaPowyzej > 0 then "tak" else "nie" end),
  galazPonizej: (if .liczbaPonizej > 0 then "tak" else "nie" end)
}'
