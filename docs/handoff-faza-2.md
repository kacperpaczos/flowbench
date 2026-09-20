# Handoff do Fazy 2 — migracja Dużych Produktów v2

Data: 2026-09-20. **Status: Faza 2 nie jest rozpoczęta ani ukończona.** Zakres Dużych
Produktów (`DrukujSam/monorepo/duzeprodukty/v2`) był świadomie poza zakresem Fazy 1
(decyzja §1) i wymaga osobnej decyzji operatora — ten dokument niczego nie startuje.
Cel: przekazać, czego Faza 1 nauczyła się na żywym silniku, zanim ktokolwiek dotknie
produktu.

## Czego uczy Faza 1 (dowody w raportach, nie obietnice)

* **Kontrakt kanału wyniku działa end-to-end.** K1–K7 przeżyły realne procesy: silnik
  czerwieni dane łamiące `output_schema`, warstwa polityki (`chat-backend/polityka/`)
  odrzuca definicje bez zatwierdzonego kontraktu; porównanie z fixture n8n wyszło
  zgodne pole po polu (rejestr §8.3–§8.5). To jest baza, na której Duże Produkty mają
  prawo stanąć.
* **Rozgałęzienie po danych wymaga dokumentu bramkowego o zamkniętym słowniku** (`enum`
  w `output_schema`, `condition:` + `continue_on: skipped` na obu gałęziach) — wzorzec
  w `dags/premie-od-pensji-galezie.yaml` (K7, decyzja §4.1b).
* **Duże dane jadą artefaktem + manifestem, nie zmienną.** Praktyczny sufit kanału to
  **128 KiB** (`MAX_ARG_STRLEN`), nie 1 MiB; dla Dużych Produktów to ograniczenie
  pierwszorzędne. Dowód i negatywny test: `dags/duze-dane-manifest.yaml`, rejestr §8.6.
* **Autorstwo przez czat jest realne, ale wolne:** tura autorska ~100–120 s, limit 420 s;
  katalog kontraktów w prompcie (17 KB przy 22 kontraktach) skaluje się źle — przy
  setkach kontraktów potrzebne narzędzie „wypisz kontrakty" (raport T3 §2.5, §7.10).
* **Forma A kontraktu (akcje z `base.yaml`) jest nieczynna** — plik bazowy jest pusty;
  wpisanie do niego akcji z rejestru ożywiłoby wspólną bibliotekę schematów przed Fazą 2
  (raport T3 §10.1).

## Pozostałe luki Fazy 1, które Fazie 2 trzeba rozliczyć

1. **R-C przyjęte:** krok = root, czyta `config.yaml`, zapisuje po `dags/`/`base.yaml`;
   bramka polityki nie jest granicą bezpieczeństwa (audyt P1–P3). Przy wielu operatorach
   albo wystawieniu poza `127.0.0.1` **przestaje być proporcjonalne** — decyzja: osobna
   instancja silnika (piaskownica agenta + promocja definicji z Gita), Dagu Pro albo inny
   silnik (decyzja §5.2, §7.2 L1 z czterema opcjami, nie dwiema).
2. R07 (wygasłe poświadczenia) niezweryfikowane; pełne E7 (przełączenie na n8n) nie
   przećwiczone na żywym układzie (`raport-finalny-faza-1.md` §6).
3. Rekomendacja tokena `viewer` dla przeglądarki niezrealizowana — przycisk Start w UI
   silnika omija kontrolę sumy definicji (raport T2 §5.3 droga #10).
4. Harmonogramy wyłączone (`HARMONOGRAM_POZA_BRAMKA`) — jeśli Duże Produkty mają
   harmonogram, decyzja o jego powrocie musi uprzedzać implementację.
5. Sesje w pamięci procesu; historia rozmów CLI nietrwała; tury `/api/chat` szeregowane.
6. Reguły polityki dla K6 (sufit stdout, kształt manifestu) nieimplementowane.
7. Fałszywie dodatnia heurystyka `WZ_DEKLARACJA_SUKCESU` w `polityka/wynik.mjs` (T3 §7.5).

## Czego NIE wolno zakładać

* **Że Duże Produkty przeniosą się „jak premie".** Przypadek odbiorczy Fazy 1 celowo
  naśladował kształt transformacji produktowej, ale nie dotknął produktu; brak
  drag-and-drop jest zaakceptowany jako ograniczenie edycji (A1) i **nie jest zgodą na
  utratę rezultatów, danych, historii ani kontekstu** (W-1/W-3).
* **Że wynik >128 KiB przejdzie zmienną między krokami** — pęknie na odbiorcy, zielonym
  będzie producent. Od pierwszego kroku: artefakt + manifest (K6).
* **Że `preconditions`/`eval` czyta dane bezpiecznie** — `eval` wkleja dane do polecenia
  (wektor wykonania kodu); wyłącznie `condition` + dokument bramkowy (K7).
* **Że krok DAG-a jest odizolowany od sekretów silnika** — nie jest (R-C).
* **Że wyniki kosztowe z odbioru są porównywalne z baseline** — ceny GLM vs ceny Claude
  to dwie różne skale; `costUsd` to szacunek CLI, nie faktura (§4.3).
* **Że wolumen n8n wolno czymkolwiek dotknąć.** 15 obiektów rozliczonych jako
  „ZBĘDNY" to nie zgoda na skasowanie; `docker compose down -v`, `volume rm`, `system
  prune` pozostają zakazane (decyzja §7a, §11).
* **Że sformułowania „Dagu Pro" dotyczą licencji GPL** — prawa z GPL do kodu i limity
  edycji Community to dwie różne rzeczy (decyzja §8).

## Od czego zacząć, gdy operator podejmie decyzję

`decyzja-architektoniczna.md` §5.2 (warunek brzegowy), §7.2 L1 (opcje a–d), §8 (licencja),
§12 (czego ta decyzja nie rozstrzyga) + `raport-finalny-faza-1.md` §8 (ograniczenia).
