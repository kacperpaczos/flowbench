# `fixtures/` — materiał dowodowy wyjęty z silnika n8n

Data ekstrakcji: **2026-09-18**. Faza 1 zastąpienia n8n przez Dagu.
Dokument nadrzędny: `docs/rejestr-workflow.md` — sekcja 7 opisuje samą ekstrakcję,
sekcja 8 przepisanie procesów na DAG-i i porównanie wyników.

Ten katalog jest **fotografią, nie projektem**. Zawiera definicje procesów i wyniki ich
wykonań przepisane z żywej bazy n8n, żeby po wyłączeniu silnika dało się sprawdzić, czy
nowa implementacja liczy to samo. **Nie ma tu ani jednego DAG-a Dagu i ani jednego YAML-a** —
to jest materiał odniesienia, nie implementacja. Implementacja leży w `dags/`
i jest z tym katalogiem porównywana skryptem `_narzedzia/porownaj.py`.

---

## 1. Skąd to jest

Źródłem jest **wolumen Dockera `n8niframe_n8n_data`**, plik `/home/node/.n8n/database.sqlite`
(SQLite w trybie WAL) wraz z jego `-wal` i `-shm`. Kontener `n8niframe-n8n` w trakcie
ekstrakcji **działał i nie był zatrzymywany ani restartowany**; wolumen był montowany
**wyłącznie read-only**.

Baza jest żywa i ma WAL, więc skopiowanie plików osobno dałoby wynik niespójny.
`database.sqlite` ma datę 2026-09-14 21:25, a `-wal` — 2026-09-18 17:20. Sprawdzone
eksperymentalnie: sama kopia `database.sqlite`, bez dziennika, zawiera **12 workflow
i 5 wykonań** zamiast 15 i 12. Brakuje w niej `aEUUAnNsUr7LJIyr` („Premie 8% od pensji"),
`FNgC8R2d33pddvSa` i `gnzjOf2qHJoEPeGo` oraz wykonań #6–#12 — czyli **wszystkich pięciu
wykonań procesu Premie, a z nimi wszystkich czterech wersji jego definicji**, jedynego
śladu historii edycji przez czat. Co gorsza, `PRAGMA integrity_check` na takiej okrojonej
kopii zwraca `ok`: spójność strukturalna nie wyłapuje brakującego dziennika, wyłapują
to dopiero liczby wierszy.

Dlatego migawkę robi **natywny online-backup SQLite** (`.backup`), który czyta bazę przez
normalne API, sam scala WAL z plikiem głównym i zwraca jeden spójny plik.

**Migawka bazy nie wchodzi do repozytorium.** Leży poza `fixtures/`, w katalogu tymczasowym
sesji; jej ścieżka i suma kontrolna są w `MANIFEST.json` (`migawka.sha256`) i w sekcji 7
rejestru. Powód: zawiera hash hasła właściciela, materiał podpisujący instancji
(`deployment_key`) i wiersz `user_api_keys` — czyli dokładnie to, czego w repozytorium być nie może.

---

## 2. Co tu jest

```
fixtures/
├─ MANIFEST.json                     # ścieżka, rozmiar, sha256 i źródło każdego pliku
├─ README.md                         # ten plik
├─ status-ok/                        # ← gnzjOf2qHJoEPeGo „Status OK”
│  ├─ definicja-n8n.json
│  ├─ wejscie.json
│  └─ oczekiwane-wyjscie.json        # (bez `wezly-posrednie.json` — patrz niżej)
├─ demo-mcp-wartosc-zamowienia/      # ← ag3nCPjnADFqUADE
├─ lista-produktow-suma-zamowienia/  # ← UQeWUmSDcg9gKXXY
├─ premie-od-pensji/                 # ← aEUUAnNsUr7LJIyr
│  ├─ definicja-n8n.json
│  ├─ wejscie.json
│  ├─ wezly-posrednie.json           # wynik KAŻDEGO z siedmiu węzłów
│  ├─ oczekiwane-wyjscie.json
│  └─ wersje/                        # cztery wersje definicji z historii edycji przez czat
│     ├─ 01-3b7f786f-….json
│     ├─ 02-677655e1-….json
│     ├─ 03-74e1d18e-….json
│     └─ 04-2a2d5435-….json
├─ _artefakty-historyczne/           # dwa procesy zachowywane, ale nieodtwarzane
│  ├─ prototyp-iframe-test-ICRY74rH9w6xbTqr/definicja-n8n.json
│  └─ srednia-temperatura-trzech-miast-rnfu7SOGxjqaUbYH/definicja-n8n.json
└─ _narzedzia/
   ├─ ekstrakcja.py                  # skrypt, który wygenerował to drzewo
   ├─ weryfikuj.py                   # porównanie fixture z migawką i manifestem
   ├─ porownaj.py                    # porównanie wyników DAG-ów Dagu z fixture
   ├─ flatted.py                     # dekoder formatu, w którym n8n trzyma dane wykonań
   └─ sprawdz-sumy.sh                # niezależne przeliczenie sha256 przez sha256sum(1)
```

### Co znaczy każdy z trzech plików procesu

**`definicja-n8n.json`** — wiersz z `workflow_entity`, dwadzieścia kolumn, kolumny trzymające
JSON jako tekst rozpakowane do struktury. To jest definicja **bieżąca**, ta, którą widać
dziś w edytorze.

**`wejscie.json`** — dane wejściowe procesu. Wszystkie cztery procesy startują
z `manualTrigger`, który produkuje **jeden pusty element** i nie przyjmuje niczego z zewnątrz;
faktyczne wejście dziedzinowe jest **zaszyte w pierwszym węźle produkującym dane**
(`set` z przypisaniami, `set` w trybie `raw`, albo literał w kodzie JS węzła `code`).
Plik wypisuje je **jawnie**, w postaci, jaką przybrało w czasie wykonania, plus:
`gdzieZaszyteWDefinicji` (gdzie tego szukać w definicji), `deklaracjeTypowN8n` (deklaracja
typu per pole — tylko dla węzłów `set` w trybie `manual`, bo tylko one ją mają), `typy`
i `precyzjaLiczb`.

**`wezly-posrednie.json`** — wynik **każdego** węzła wykonania wzorcowego, w kolejności
wykonania. Powstaje tylko dla procesów o więcej niż jednym węźle wykonawczym; `status-ok`
ma jeden węzeł `set` po wyzwalaczu, więc nie ma czego porównywać pośrednio i **pliku tam nie ma**.
Bez tego pliku porównanie DAG-a z n8n mówi tylko „różni się", a nie „różni się na kroku
`Stawka podatku`". Każdy krok ma dodatkowo `poleDolozonePrzezTenWezel`
i `poleZgubionePrzezTenWezel` — to jest dokładnie ta informacja, której zabrakło przy
`includeOtherFields: true`: widać, co dany krok musi wyemitować sam.

**`oczekiwane-wyjscie.json`** — wynik **ostatniego wykonanego węzła** z migawki wykonania,
bez upraszczania: te same pola, ta sama kolejność elementów i pól, te same typy, ta sama
precyzja. Do tego `kolejnoscWezlow` (cała ścieżka wykonania) i koperta `pairedItem`, którą
n8n dokleja do każdego elementu.

Pole `typy` to płaska mapa `ścieżka → typ JSON`, gdzie `[]` oznacza element tablicy.
Rozróżnia `integer` od `number`, bo to rozróżnienie właśnie ginie przy przejściu na Dagu
(rejestr §4.0c). Pole `precyzjaLiczb` podaje liczbę cyfr po przecinku; gdy elementy tablicy
różnią się precyzją, jest tam **lista**, a nie jedna liczba — np. `szczegoly[].podatek`
ma `[1, 2]`, bo `3990.4` ma jedną cyfrę, a `939.12` i `5476.48` mają dwie. To nie jest
usterka danych, tylko skutek `Math.round(x*100)/100` w JS i dokładnie ta właściwość, którą
przy przepisywaniu na `jq` trzeba odtworzyć.

### Skąd wzięto wejście i wyjście

| DAG (nazwa robocza) | workflow n8n | wykonanie wzorcowe | węzeł wejścia | ostatni węzeł |
|---|---|---|---|---|
| `status-ok` | `gnzjOf2qHJoEPeGo` | #12 | `Set Status` | `Set Status` |
| `demo-mcp-wartosc-zamowienia` | `ag3nCPjnADFqUADE` | #3 | `Pozycja zamowienia` | `Policz wartosc brutto` |
| `lista-produktow-suma-zamowienia` | `UQeWUmSDcg9gKXXY` | #4 | `Lista produktow` | `Policz sume zamowienia` |
| `premie-od-pensji` | `aEUUAnNsUr7LJIyr` | #11 | `Dane pracownikow` | `Suma premii` |

Wykonanie wzorcowe to zawsze **najnowsze** wykonanie danego procesu, a jego
`workflowVersionId` jest równy `versionId` definicji bieżącej — sprawdzone i zapisane
w każdym pliku pod `_kontekst.wykonanieZgodneZBiezacaDefinicja`. Dzięki temu
`oczekiwane-wyjscie.json` opisuje tę samą wersję procesu, co `definicja-n8n.json`,
a nie jakąś wcześniejszą.

### Cztery wersje procesu `premie-od-pensji`

`premie-od-pensji/wersje/` to **jedyny ślad historii edycji przez czat** w całym wolumenie.
Tabela `workflow_history` trzyma dokładnie 15 wierszy — po jednym na workflow, czyli tylko
stan bieżący. Trzy wersje pośrednie przetrwały **wyłącznie** w migawkach
`execution_data.workflowData` (rejestr §1.1 i §3.8).

| plik | versionId | węzły | wykonania | w `workflow_history` |
|---|---|---|---|---|
| `01-3b7f786f-…` | `3b7f786f-b83d-4845-97cc-21b0f780b573` | 4 | #6, #7 | **nie** |
| `02-677655e1-…` | `677655e1-cc91-497b-95b0-ea570dd73a08` | 4 (zmieniona treść kroków) | #9 | **nie** |
| `03-74e1d18e-…` | `74e1d18e-91f6-4aab-a100-a4e035dfb14a` | 5 (+ `Dodatek 50 zl`) | #10 | **nie** |
| `04-2a2d5435-…` | `2a2d5435-eded-42e9-b78f-8be0bfafb1b3` | 7 (+ `Stawka podatku`, `Podatek dochodowy`) | #11 | tak (bieżąca) |

Numeracja `01`–`04` jest chronologiczna po numerze pierwszego wykonania. Każdy plik ma pełną
definicję pod kluczem `definicja` i listę swoich wykonań pod `wykonania`. Gdy tę samą wersję
uruchomiono więcej niż raz (wersja `01` — wykonania #6 i #7), skrypt ekstrakcji sprawdza, że
obie migawki są identyczne, i przerywa, gdyby nie były.

Uwaga do formatu: `execution_data.workflowData` **nie zawiera pola `versionId`** — ma tylko
`id`, `name`, `nodes`, `connections`, `settings`, `nodeGroups`. `versionId` pochodzi
z `execution_entity.workflowVersionId`; zgodność tej kolumny z `execution_data.workflowVersionId`
jest sprawdzona dla wszystkich pięciu wykonań.

---

## 3. Rozliczenie wszystkich 15 workflow

Klasyfikacja pochodzi z `docs/rejestr-workflow.md` §2 i nie jest tutaj zmieniana.

| # | id | nazwa | klasyfikacja | definicja w fixture? | uzasadnienie |
|---|---|---|---|---|---|
| 1 | `RZgNoMeoDQro7TPF` | My workflow | ZBĘDNY | **nie** — tylko wolumen | Pusty szkic: sam `manualTrigger`, zero kroków wykonawczych, zero wykonań. Nie ma czego odtwarzać ani z czym porównać. |
| 2 | `ZAo64C4IErU2Wafe` | My workflow 2 | ZBĘDNY | **nie** — tylko wolumen | `set` bez przypisań (`parameters={"options":{}}`), zero wykonań — próba obsługi edytora, nie proces. |
| 3 | `015ihoScqe2goUO7` | My workflow 3 | ZBĘDNY | **nie** — tylko wolumen | Duplikat wiersza 2 co do parametru. |
| 4 | `LHEqv0MBSNZFSeOI` | My workflow 4 | ZBĘDNY | **nie** — tylko wolumen | Przypisanie o pustej nazwie i pustej wartości, zero wykonań — nie produkuje danych. |
| 5 | `I00WFYfg9oDGRu9r` | My workflow 5 | ZBĘDNY | **nie** — tylko wolumen | Duplikat wiersza 4. |
| 6 | `ymF5aEnjmrNgqu9M` | Prototyp iframe - test | ZBĘDNY | **nie** — tylko wolumen | Jeden z czterech identycznych egzemplarzy (`wiadomosc = "Witaj z prototypu"`), nigdy nieuruchomiony. |
| 7 | `M3HqM75fuSkeM32P` | Prototyp iframe - test | ZBĘDNY | **nie** — tylko wolumen | Jak wyżej; różni się wyłącznie UUID-ami przypisań. |
| 8 | `ICRY74rH9w6xbTqr` | Prototyp iframe - test | **ARTEFAKT-HISTORYCZNY** | **tak** — `_artefakty-historyczne/prototyp-iframe-test-ICRY74rH9w6xbTqr/` | Jedyny ślad, że silnik wykonał cokolwiek **przed** podłączeniem MCP: wykonanie #1 o 12:14, klucz MCP powstał o 19:10. Rejestr każe zachować datowany punkt „przed”. Nie jest odtwarzany w Dagu. |
| 9 | `moHBzpK8zjbeGz95` | Prototyp iframe - test | ZBĘDNY | **nie** — tylko wolumen | Powtórzenie wiersza 8 dwie minuty później; wykonanie #2 nie wnosi nic ponad #1. |
| 10 | `ag3nCPjnADFqUADE` | Demo MCP - wartosc zamowienia | **DO-ODTWORZENIA** | **tak** — `demo-mcp-wartosc-zamowienia/` | Kanoniczny dowód łańcucha czat → MCP → proces → wykonanie → wynik (R02, R03, R14). |
| 11 | `UQeWUmSDcg9gKXXY` | Lista produktow i suma zamowienia | **DO-ODTWORZENIA** | **tak** — `lista-produktow-suma-zamowienia/` | Jego kształt (jeden dokument JSON → agregat) jest dokładnie tym, który wymusza konwencja `RESULT=<JSON w jednej linii>`. |
| 12 | `rnfu7SOGxjqaUbYH` | Średnia temperatura z trzech miast | **ARTEFAKT-HISTORYCZNY** | **tak** — `_artefakty-historyczne/srednia-temperatura-trzech-miast-rnfu7SOGxjqaUbYH/` | Behawioralnie zawiera się w wierszu 11, ale zostaje jako ślad pracy czatu poza domeną handlową, a jego nazwa (`ś`, spacje) to gotowy przypadek testowy ograniczenia identyfikatorów Dagu. |
| 13 | `FNgC8R2d33pddvSa` | Prosty status OK | ZBĘDNY | **nie** — tylko wolumen | Duplikat wiersza 15; różnica wyłącznie w wielkości liter wartości (`"ok"` vs `"OK"`). Fixture robimy dla wiersza 15, bo to jego wartości cytuje baseline. |
| 14 | `aEUUAnNsUr7LJIyr` | Premie 8% od pensji | **DO-ODTWORZENIA** | **tak** — `premie-od-pensji/` + 4 wersje | Jedyny proces spełniający wszystkie wymagania przypadku odbiorczego Fazy 1 i jedyny dowód na edycję istniejącego procesu przez czat. |
| 15 | `gnzjOf2qHJoEPeGo` | Status OK | **DO-ODTWORZENIA** | **tak** — `status-ok/` | Fixture scenariusza regresji R02/R03; baseline cytuje jego `id` i treść odpowiedzi jako wartości odniesienia. |

**Bilans: 6 workflow ma tu swoją definicję** (4 DO-ODTWORZENIA + 2 ARTEFAKT-HISTORYCZNY),
**9 zostaje wyłącznie w wolumenie**. Dziewiątka jest spisana na straty **jawnie** — to decyzja
rejestru §2, nie przeoczenie: gdyby wolumen zniknął, nikt po nich nie zapłacze. Fizycznie
zostają, bo wolumen zostaje nietknięty (decyzja architektoniczna §11).

---

## 4. Czego tu NIE ma

1. **Żadnych DAG-ów Dagu i żadnych YAML-i.** Celowo. Kontrakt danych między krokami Dagu
   (rejestr §4.0d — kruchość `RESULT=<JSON>`, cytowanie, `@base64` vs „jedna linia”) jest
   w chwili ekstrakcji nierozstrzygnięty u koordynatora.
2. **Żadnych sekretów.** Nie ma klucza szyfrowania n8n (`/home/node/.n8n/config`), hasha
   hasła właściciela, wartości `user_api_keys`, `deployment_key` ani zawartości
   `credentials_entity` (ta akurat jest pusta — 0 wierszy). Nie ma `N8N_MCP_TOKEN`.
3. **Pominięte pole migawki wykonania: `resumeToken`.** Każdy wiersz `execution_data.data`
   ma 64-znakowy token wznowienia wykonania. Nie jest przepisywany do żadnego pliku —
   jest materiałem sesyjnym silnika, bez wartości dla odtworzenia procesu. Pominięcie jest
   odnotowane w `MANIFEST.json` pod `polaPominiete`.
4. **Nie ma migawki bazy.** Patrz sekcja 1 — leży poza repozytorium.
5. **Nie ma pełnych `execution_data.data`.** Z każdego wykonania wzorcowego brany jest wynik
   węzła wejściowego i węzła ostatniego. Wyniki węzłów pośrednich (np. `Premia 8%`,
   `Dodatek 50 zl`, `Stawka podatku`, `Podatek dochodowy` w procesie `premie-od-pensji`)
   **nie są tu zapisane**, choć w migawce są. Powód: kontrakt danych dla kroków pośrednich
   zależy od tego, czy zostanie wybrany wariant A czy B rozgałęzienia (rejestr §4.4) — dopiero
   ta decyzja mówi, które granice kroków w ogóle będą istnieć. Odtworzenie ich jest tanie:
   `_narzedzia/flatted.py` plus jedno zapytanie do migawki.
6. **Nie ma wykonań #1, #2, #5, #6–#10.** Zachowane są tylko wykonania wzorcowe (#3, #4, #11, #12)
   i definicje z wykonań #6, #7, #9, #10 (jako wersje procesu `premie-od-pensji`, bez ich
   danych wynikowych).
7. **Nie ma `n8nEventLog*.log`.** Dziennik zdarzeń jest rotowany, sięga tylko
   do `2026-09-14T23:25:58+02:00` i był już rozliczony w rejestrze §0 i §3.9.
8. **Nie ma tabel infrastrukturalnych** (`migrations`, `role`, `scope`, `mcp_registry_server`,
   `settings`, `workflow_dependency`, …). Rejestr §3.9 rozlicza je do zera: wszystkie
   są odtwarzalne z obrazu i `docker-compose.yml`.

---

## 5. Jak odtworzyć ekstrakcję

Wymagania: działający kontener `n8niframe-n8n`, Docker (rootless — bez `--user`),
`python3` ≥ 3.9, `jq`, `sha256sum`.

### Krok 1 — spójna migawka bazy

Wolumen montowany **read-only**, katalog na wynik **poza repozytorium**:

```sh
KATALOG_MIGAWKI=$(mktemp -d)

docker run --rm --name n8n-fixture-backup \
  -v n8niframe_n8n_data:/vol:ro \
  -v "$KATALOG_MIGAWKI":/out \
  alpine:latest sh -c '
    apk add --no-cache sqlite >/dev/null &&
    sqlite3 "file:/vol/database.sqlite?mode=ro" ".backup /out/database.snapshot.sqlite"'
```

`.backup` to natywny online-backup SQLite: czyta bazę przez normalne API, więc sam scala
zawartość WAL. Kopiowanie `database.sqlite`, `-wal` i `-shm` osobno (np. przez `docker cp`)
daje wynik niespójny i **nie jest dopuszczalne**.

Sprawdzenie spójności — obie komendy muszą przejść, zanim cokolwiek dalej:

```sh
sqlite3 "file:$KATALOG_MIGAWKI/database.snapshot.sqlite?mode=ro" "PRAGMA integrity_check;"
# -> ok
sqlite3 "file:$KATALOG_MIGAWKI/database.snapshot.sqlite?mode=ro" "
  SELECT 'workflow_entity', count(*) FROM workflow_entity
  UNION ALL SELECT 'execution_entity', count(*) FROM execution_entity
  UNION ALL SELECT 'execution_data',  count(*) FROM execution_data;"
# -> 15 / 12 / 12, zgodnie z rejestrem §0 i §3.8
```

### Krok 2 — wygenerowanie drzewa

```sh
python3 fixtures/_narzedzia/ekstrakcja.py "$KATALOG_MIGAWKI/database.snapshot.sqlite" fixtures
```

Skrypt otwiera migawkę z `mode=ro`, nadpisuje pliki fixture i przelicza `MANIFEST.json`.
Przed każdym zapisem skanuje treść wzorcami na sekrety (`resumeToken`, `encryptionKey`,
hash bcrypt, ciąg 64-hex) i **przerywa**, gdy coś złapie.

Ekstrakcja **nie jest** powtarzalna bajt w bajt: każdy plik nosi
`_kontekst.znacznikEkstrakcji`, więc ponowne uruchomienie zmienia znacznik, a przez to sumy
kontrolne. Powtarzalna jest **treść merytoryczna** — do jej porównania służy `weryfikuj.py`,
który czyta z migawki, a nie z poprzedniego przebiegu.

### Krok 3 — weryfikacja

```sh
python3 fixtures/_narzedzia/weryfikuj.py "$KATALOG_MIGAWKI/database.snapshot.sqlite" fixtures
fixtures/_narzedzia/sprawdz-sumy.sh fixtures
```

`weryfikuj.py` sprawdza `integrity_check`, liczności 15/12/12, zgodność każdego
`wejscie.json` i `oczekiwane-wyjscie.json` z migawką (porównanie po kanonicznym JSON-ie,
więc łapie też różnicę `1` vs `1.0` i zmianę kolejności), zgodność czterech wersji Premii
z `execution_data.workflowData`, listy wykonań pod każdą wersją, oraz sumy i pokrycie
manifestu. Drukuje przy tym tabelę pole-po-polu dla `premie-od-pensji`.
`sprawdz-sumy.sh` przelicza sumy drugą, niezależną drogą — przez `sha256sum --check`.

### Krok 4 — po sobie

Skrypt nie zostawia kontenerów (`docker run --rm`). Migawkę usuwa się przez
`rm -rf "$KATALOG_MIGAWKI"`. Wolumen `n8niframe_n8n_data` nie jest w żadnym kroku
montowany inaczej niż `:ro`.

---

## 6. Znane ograniczenia tych fixture

1. **Wejście jest stałe.** Wszystkie cztery procesy mają dane zaszyte w definicji; nie ma
   wariantu „inne dane wejściowe”. Testy równoważności nowej implementacji z n8n opierają się
   więc na **jednym przypadku na proces**. Odporność na inne dane jest poza zasięgiem tego
   materiału — trzeba ją sprawdzić osobno.
2. **`sumaPodatku: 10406` i `sumaNaDoReke: 27004` to liczby całkowite**, bo suma po
   zaokrągleniu wypadła równo. Implementacja w Dagu, która zwróci `10406.0`, jest liczbowo
   poprawna, ale **nie przejdzie porównania kanonicznego** z tym fixture. To celowe: rejestr
   §4.0c mówi, że utrata rozróżnienia typów jest jedną z rzeczy, które trzeba zobaczyć,
   a nie przemilczeć.
3. **`unitPrice: 129.5` i `59` w `lista-produktow-suma-zamowienia`.** W definicji węzła
   `Lista produktow` (tryb `raw`) tekst JSON ma `129.50` i `59.00`, ale wykonanie zapisało
   `129.5` i `59` — bo JSON nie przechowuje zer końcowych. Fixture zapisuje wartości
   **po wykonaniu**, czyli `129.5` i `59`. To samo dotyczy `lineTotal: 259` i `177`.
4. **`_kontekst` i `_zrodlo` nie są danymi.** To metadane pochodzenia. Każdy program
   porównujący wyniki musi patrzeć na `elementy`, a nie na cały plik.
