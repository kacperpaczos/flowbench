# Rejestr workflow w wolumenie `n8niframe_n8n_data`

Data: 2026-09-18. Faza 1 migracji n8n → Dagu. Dokument rozlicza **każdy** obiekt wiedzy
w silniku n8n z osobna, żeby wymiana silnika nie odbyła się kosztem czegoś, czego nikt
nie policzył.

Podstawa: `docs/baseline-prototypu.md` §3.10 i §5 (pozycje W01–W10),
`docs/decyzja-architektoniczna.md`, `docs/audyt-dagu.md`.

Zasada tego dokumentu: **nic nie znika bez jawnego rozliczenia.** Decyzja architektoniczna
(§11) mówi, że wolumen zostaje nietknięty — to jest zachowanie, nie rozliczenie. Rozliczenie
jest tutaj.

---

## 0. Metoda i dowód liczności

Odczyt **wyłącznie nieniszczący**, dwiema niezależnymi drogami:

1. **REST API n8n** przez działający stack (`http://127.0.0.1:8080/n8n/rest/...`), sesja
   konta `admin@admin.com` (konto lokalne, hasło jawne w README).
2. **Kopia** `database.sqlite` + `-wal` + `-shm` wyciągnięta przez `docker cp`
   do katalogu tymczasowego i otwarta w trybie `mode=ro`. Żywy plik w wolumenie nie był
   otwierany ani modyfikowany.

Obie drogi dają tę samą liczbę. Wklejony output:

```
$ curl -s -b cookies.txt "http://127.0.0.1:8080/n8n/rest/workflows" | jq '{count, ids_returned: (.data|length)}'
{"count": 15, "ids_returned": 15}

$ curl -s -b cookies.txt --get "http://127.0.0.1:8080/n8n/rest/workflows" \
       --data-urlencode 'filter={"isArchived":true}'  | jq .count
0

$ python3 -c "... sqlite3 'file:<kopia>/database.sqlite?mode=ro' ..."
workflow_entity  = 15
execution_entity = 12
archived         = 0
active           = 0
```

**15 workflow — zgodne z baseline'em §3.10.** Zero zarchiwizowanych, zero aktywnych,
zero opublikowanych (`activeVersionId = null` we wszystkich 15 wierszach). Liczba `Total 15`
jest też widoczna na zrzucie `docs/baseline-iframe-lista.png`, więc trzecie, niezależne
potwierdzenie istnieje od strony interfejsu.

**12 wykonań** (id 1–12), wszystkie `success`, wszystkie w trybie `manual`. Baseline mówił
„11 + 1" — to ta sama liczba, zapisana inaczej.

### Skąd wiem, co powstało ręcznie, a co przez czat

Nie z nazw i nie ze zgadywania. Z dwóch niezależnych pól w bazie, które zgadzają się
co do jednego wiersza:

* `workflow_history.authors` — wartość `Admin Local` albo `Admin Local (via MCP)`;
* `workflow_entity.meta` — `null` albo `{"aiBuilderAssisted":true,"builderVariant":"mcp"}`.

```
$ select versionId, workflowId, authors from workflow_history order by createdAt;
… RZgNoMeoDQro7TPF  'Admin Local'
… ZAo64C4IErU2Wafe  'Admin Local'
… (7 kolejnych)     'Admin Local'
… ag3nCPjnADFqUADE  'Admin Local (via MCP)'
… UQeWUmSDcg9gKXXY  'Admin Local (via MCP)'
… rnfu7SOGxjqaUbYH  'Admin Local (via MCP)'
… FNgC8R2d33pddvSa  'Admin Local (via MCP)'
… aEUUAnNsUr7LJIyr  'Admin Local (via MCP)'
… gnzjOf2qHJoEPeGo  'Admin Local (via MCP)'
```

Podział wypada 9 ręcznych / 6 przez MCP i pokrywa się z trzecim, częściowym źródłem —
dziennikiem zdarzeń (`n8nEventLog*.log`), w którym w zachowanym oknie czasowym są dokładnie
3 zdarzenia `n8n.audit.workflow.created` i 3 wywołania narzędzia `create_workflow_from_code`,
oraz 3 zdarzenia `n8n.audit.workflow.updated` i 3 wywołania `update_workflow`. Dziennik jest
rotowany i sięga tylko do `2026-09-14T23:25:58+02:00`, więc nie obejmuje pierwszych dziewięciu.

---

## 1. Rejestr

Wszystkie znaczniki czasu w UTC, tak jak zwraca je API. Kolumna „aktywny / opublikowany"
ma jedną wartość dla całej tabeli — `nie / nie` — bo w instancji nie ma ani jednego
workflow aktywnego ani opublikowanego; zostawiam ją mimo to, bo to element rozliczenia.

| # | id | nazwa | węzły (liczba i typy) | co robi | aktywny / opublikowany | wykonania | utworzony → zmodyfikowany | pochodzenie |
|---|---|---|---|---|---|---|---|---|
| 1 | `RZgNoMeoDQro7TPF` | My workflow | 1 — `manualTrigger` | Pusty szkic: sam wyzwalacz, ani jednego kroku wykonawczego. | nie / nie | 0 | 2026-09-14 12:03:54 → 12:03:54 | ręcznie, UI (`authors='Admin Local'`, `meta=null`) |
| 2 | `ZAo64C4IErU2Wafe` | My workflow 2 | 2 — `manualTrigger`, `set` | Wyzwalacz i węzeł Set bez żadnego przypisania (`parameters={"options":{}}`) — nie produkuje żadnego pola. | nie / nie | 0 | 2026-09-14 12:04:31 → 12:04:40 | ręcznie, UI |
| 3 | `015ihoScqe2goUO7` | My workflow 3 | 2 — `manualTrigger`, `set` | To samo co wiersz 2, co do parametru. | nie / nie | 0 | 2026-09-14 12:05:21 → 12:05:29 | ręcznie, UI |
| 4 | `LHEqv0MBSNZFSeOI` | My workflow 4 | 2 — `manualTrigger`, `set` | Set z jednym przypisaniem o **pustej nazwie i pustej wartości** — nadal nic nie produkuje. | nie / nie | 0 | 2026-09-14 12:06:45 → 12:06:58 | ręcznie, UI |
| 5 | `I00WFYfg9oDGRu9r` | My workflow 5 | 2 — `manualTrigger`, `set` | To samo co wiersz 4. | nie / nie | 0 | 2026-09-14 12:08:25 → 12:08:38 | ręcznie, UI |
| 6 | `ymF5aEnjmrNgqu9M` | Prototyp iframe - test | 2 — `manualTrigger`, `set` | Ustawia jedno pole tekstowe `wiadomosc = "Witaj z prototypu"`. | nie / nie | 0 | 2026-09-14 12:09:48 → 12:10:15 | ręcznie, UI |
| 7 | `M3HqM75fuSkeM32P` | Prototyp iframe - test | 2 — `manualTrigger`, `set` | Identyczny z wierszem 6 (różni się wyłącznie UUID-ami przypisań). | nie / nie | 0 | 2026-09-14 12:11:35 → 12:12:02 | ręcznie, UI |
| 8 | `ICRY74rH9w6xbTqr` | Prototyp iframe - test | 2 — `manualTrigger`, `set` | Identyczny z wierszem 6. **Pierwszy workflow w tej instancji, który w ogóle wykonano** (wykonanie #1). | nie / nie | 1 (#1) | 2026-09-14 12:14:17 → 12:14:44 | ręcznie, UI |
| 9 | `moHBzpK8zjbeGz95` | Prototyp iframe - test | 2 — `manualTrigger`, `set` | Identyczny z wierszem 6; uruchomiony raz, 2 minuty po wierszu 8 (wykonanie #2). | nie / nie | 1 (#2) | 2026-09-14 12:16:12 → 12:16:39 | ręcznie, UI |
| 10 | `ag3nCPjnADFqUADE` | Demo MCP - wartosc zamowienia | 3 — `manualTrigger`, `set`, `code` | Ustawia jedną pozycję zamówienia (`produkt` string, `cenaNetto` 49.99, `ilosc` 3, oba jako **number**) i liczy w JS wartość netto oraz brutto z VAT 23%, zaokrąglone do groszy. | nie / nie | 1 (#3) | 2026-09-14 19:11:50 → 19:11:50 | **czat / MCP** (`authors='… (via MCP)'`, `builderVariant='mcp'`) |
| 11 | `UQeWUmSDcg9gKXXY` | Lista produktow i suma zamowienia | 3 — `manualTrigger`, `set` (`mode: raw`), `code` | Wstawia gotowy dokument JSON zamówienia `ZAM-2026-001` z trzema pozycjami i liczy wartość każdej linii, sumę netto, VAT 23%, brutto, liczbę pozycji i liczbę sztuk. | nie / nie | 1 (#4) | 2026-09-14 21:15:32 → 21:15:32 | **czat / MCP** |
| 12 | `rnfu7SOGxjqaUbYH` | Średnia temperatura z trzech miast | 3 — `manualTrigger`, `set` (`mode: raw`), `code` | Wstawia JSON z trzema pomiarami temperatury i liczy średnią, z jawnym zabezpieczeniem na pustą tablicę wejściową. | nie / nie | 1 (#5) | 2026-09-14 21:17:55 → 21:17:55 | **czat / MCP** |
| 13 | `FNgC8R2d33pddvSa` | Prosty status OK | 2 — `manualTrigger`, `set` | Ustawia jedno pole `status = "ok"`. | nie / nie | 1 (#8) | 2026-09-15 06:11:02 → 06:11:02 | **czat / MCP** |
| 14 | `aEUUAnNsUr7LJIyr` | Premie 8% od pensji | 7 — `manualTrigger`, `code` ×2, `set` ×4 | Generuje trzech pracowników z pensjami, dolicza każdemu 8% premii i 50 zł dodatku, **wybiera stawkę podatku 12% albo 32% zależnie od tego, czy pensja z premią przekracza 10 000**, liczy podatek i kwotę netto, a na końcu zwija wszystko w jeden raport zbiorczy z sumami. | nie / nie | 5 (#6, #7, #9, #10, #11) | 2026-09-14 21:26:52 → 2026-09-15 09:28:18 | **czat / MCP, budowany przyrostowo** — 1 utworzenie + 3 edycje przez `update_workflow` |
| 15 | `gnzjOf2qHJoEPeGo` | Status OK | 2 — `manualTrigger`, `set` | Ustawia jedno pole `status = "OK"`. | nie / nie | 1 (#12) | 2026-09-18 12:48:41 → 12:48:41 | **czat / MCP**, utworzony przez audyt baseline'u jako dowód dla R02/R03 |

**Suma:** 15 workflow, 12 wykonań, 0 aktywnych, 0 opublikowanych, 0 zarchiwizowanych.
Kolumna „wykonania" sumuje się do 12 i zgadza się z tabelą `workflow_statistics`
(8 wierszy, bo 7 workflow nigdy nie było uruchomionych).

### 1.1 Wiersz 14 zasługuje na osobny akapit

`aEUUAnNsUr7LJIyr` to jedyny workflow w tej instancji, który **nie powstał jednym strzałem**.
Jego pięć wykonań odwołuje się do **czterech różnych wersji definicji**, a każda ma więcej
węzłów od poprzedniej. Rekonstrukcja z `execution_data.workflowData`:

| wykonanie | versionId | węzły w tej wersji |
|---|---|---|
| #6, #7 | `3b7f786f…` | Start, Dane pracownikow, Premia 8%, Suma premii (4) |
| #9 | `677655e1…` | te same 4, zmieniona treść kroków |
| #10 | `74e1d18e…` | + Dodatek 50 zl (5) |
| #11 | `2a2d5435…` | + Stawka podatku, Podatek dochodowy (7) — wersja bieżąca |

To jest dowód na zachowanie, którego nie ma nigdzie indziej w tym wolumenie: **model edytował
istniejący proces w kolejnych turach rozmowy, a nie tworzył nowy.** Trzy zdarzenia
`n8n.audit.workflow.updated` (2026-09-15 11:25:41, 11:26:38, 11:28:18 czasu lokalnego) i trzy
wywołania narzędzia `update_workflow` w dzienniku potwierdzają to niezależnie.

Trzy wersje pośrednie **nie istnieją w tabeli `workflow_history`** — ta trzyma dokładnie
15 wierszy, po jednym na workflow, czyli tylko stan bieżący. Jedynym miejscem, gdzie
wersje pośrednie przetrwały, są migawki `execution_data.workflowData`. Wniosek praktyczny:
skasowanie historii wykonań kasuje też historię edycji.

---

## 2. Klasyfikacja migracyjna

| # | id | nazwa | decyzja | uzasadnienie |
|---|---|---|---|---|
| 1 | `RZgNoMeoDQro7TPF` | My workflow | **ZBĘDNY** | Pusty szkic bez ani jednego kroku wykonawczego i bez wykonań — nie ma czego odtwarzać. |
| 2 | `ZAo64C4IErU2Wafe` | My workflow 2 | **ZBĘDNY** | Set bez przypisań, zero wykonań; próba obsługi edytora, nie proces. |
| 3 | `015ihoScqe2goUO7` | My workflow 3 | **ZBĘDNY** | Duplikat wiersza 2 co do parametru. |
| 4 | `LHEqv0MBSNZFSeOI` | My workflow 4 | **ZBĘDNY** | Przypisanie o pustej nazwie i wartości — nie produkuje danych, zero wykonań. |
| 5 | `I00WFYfg9oDGRu9r` | My workflow 5 | **ZBĘDNY** | Duplikat wiersza 4. |
| 6 | `ymF5aEnjmrNgqu9M` | Prototyp iframe - test | **ZBĘDNY** | Jeden z czterech identycznych egzemplarzy, nigdy nieuruchomiony. |
| 7 | `M3HqM75fuSkeM32P` | Prototyp iframe - test | **ZBĘDNY** | Jak wyżej. |
| 8 | `ICRY74rH9w6xbTqr` | Prototyp iframe - test | **ARTEFAKT-HISTORYCZNY** | Jedyny ślad, że silnik wykonał cokolwiek **przed** podłączeniem MCP (wykonanie #1 o 12:14, klucz MCP powstał dopiero o 19:10) — zostaje w wolumenie jako datowany punkt „przed", nie jest odtwarzany. |
| 9 | `moHBzpK8zjbeGz95` | Prototyp iframe - test | **ZBĘDNY** | Powtórzenie wiersza 8 dwie minuty później; wykonanie #2 nie wnosi nic ponad #1. |
| 10 | `ag3nCPjnADFqUADE` | Demo MCP - wartosc zamowienia | **DO-ODTWORZENIA** | To workflow z README i z baseline'u §3.10 — kanoniczny dowód, że łańcuch czat → MCP → proces → wykonanie → wynik zadziałał end-to-end; nowy silnik musi umieć to samo (R02, R03, R14). |
| 11 | `UQeWUmSDcg9gKXXY` | Lista produktow i suma zamowienia | **DO-ODTWORZENIA** | Jedyny, którego kształt (jeden dokument JSON na wejściu → agregat na wyjściu) jest dokładnie kształtem wymuszonym konwencją `RESULT=<JSON w jednej linii>` z decyzji §4.1 — najtańszy i najostrzejszy test tej konwencji. |
| 12 | `rnfu7SOGxjqaUbYH` | Średnia temperatura z trzech miast | **ARTEFAKT-HISTORYCZNY** | Behawioralnie zawiera się w wierszu 11 (raw JSON → Code → agregat); różni się tylko dziedziną. Zostaje jako ślad, że czat radził sobie poza domeną handlową. Osobna wartość: jego **nazwa** jest gotowym przypadkiem testowym dla ograniczenia identyfikatorów Dagu (patrz §4.0). |
| 13 | `FNgC8R2d33pddvSa` | Prosty status OK | **ZBĘDNY** | Duplikat wiersza 15 — ta sama struktura, ta sama semantyka, różnica wyłącznie w wielkości liter wartości (`"ok"` vs `"OK"`). |
| 14 | `aEUUAnNsUr7LJIyr` | Premie 8% od pensji | **DO-ODTWORZENIA** | Jedyny workflow, który spełnia naraz wszystkie wymagania przypadku odbiorczego Fazy 1 (decyzja §10): ≥3 zależne kroki, rozgałęzienie zależne od zawartości danych, fan-in, żaden krok nie woła modelu, powstał przez czat. Dodatkowo jedyny dowód na **edycję istniejącego procesu przez czat** — to osobne zachowanie, nie wariant tworzenia. |
| 15 | `gnzjOf2qHJoEPeGo` | Status OK | **DO-ODTWORZENIA** | To jest fixture scenariusza regresji R02/R03 — baseline cytuje jego `id`, `costUsd` i treść odpowiedzi jako wartości odniesienia; bez odpowiednika w Dagu R02 i R03 nie mają z czym się porównać. |

**Bilans: 4 DO-ODTWORZENIA, 2 ARTEFAKT-HISTORYCZNY, 9 ZBĘDNY, 0 NIEROZSTRZYGNIĘTE.**

Świadomie nie wsadziłem wszystkiego do kosza „artefakt historyczny". Dziewięć wierszy
oznaczonych ZBĘDNY jest **spisanych na straty jawnie**: nikt ich nie przepisuje, nikt ich
nie archiwizuje osobno, i jeśli wolumen kiedyś zniknie, nikt po nich nie zapłacze. To jest
decyzja, nie przeoczenie. Fizycznie zostają, bo wolumen zostaje (decyzja §11).

Kolumna NIEROZSTRZYGNIĘTE jest pusta nie dlatego, że wszystko jest jasne, tylko dlatego,
że o każdym z 15 obiektów dało się rozstrzygnąć na podstawie jego definicji, wykonań
i pochodzenia. Rzeczy, których **nie** dało się ustalić, są w §5 — dotyczą motywacji
i otoczenia, nie klasyfikacji.

---

## 3. Wiedza poza workflowami

Poniżej obiekty, które przy wymianie silnika albo przeżyją, albo zginą. Żadnych wartości
sekretów — tylko nazwy, liczności i typy.

### 3.1 Konto właściciela

| co | wartość |
|---|---|
| liczba kont | **1** (`select count(*) from user` = 1) |
| id | `67660c81-38d6-40f4-bdf9-42990a8b50eb` |
| e-mail / nazwa | `admin@admin.com`, „Admin Local" |
| rola | `global:owner` |
| `isManagedByEnv` | `true` |
| `signInType` | `email`, `mfaEnabled: false` |

**Czy potrzebne po migracji: nie samo konto — potrzebna jest jego własność.** Konto nie
zawiera żadnej wiedzy: jest w całości odtwarzalne z `docker-compose.yml:26-31`
(`N8N_INSTANCE_OWNER_*` + hash bcrypt). Przeżyć musi *zachowanie*: właściciel zakładany
bezkreatorowo, z konfiguracji, przy każdym starcie — bez tego R01 wymaga ręcznego kroku
i stack przestaje wstawać gotowy do pracy.

**Co się z nim dzieje:** ginie razem z wolumenem, nic nie tracimy. W Dagu odpowiednikiem jest
admin i hasło w pliku konfiguracyjnym (decyzja §5, R-C), nie w `environment:`.

### 3.2 Klucz szyfrowania

| co | wartość |
|---|---|
| plik | `/home/node/.n8n/config`, **56 B**, uprawnienia `-rw-------` |
| zawartość | jedno pole `encryptionKey`, 32 znaki |

**Czy potrzebny po migracji: NIE — i to jest ustalone, nie założone.** Klucz służy wyłącznie
do odszyfrowania zapisanych poświadczeń. Poświadczeń nie ma ani jednego (§3.4), więc klucz
nie chroni niczego. Baseline (W05) zostawiał to pytanie otwarte — „jeśli ktoś je dodał,
plik trzeba zachować". Odpowiedź brzmi: nikt nie dodał, licznik wynosi zero.

**Co się z nim dzieje:** ginie razem z wolumenem. Bez konsekwencji.

### 3.3 Tokeny i klucze API instancji

**`user_api_keys` — 1 wiersz:**

| pole | wartość |
|---|---|
| `id` | `yRsJFnUDDaTaUKZy` |
| `label` | `MCP Server API Key` |
| `audience` | `mcp-server-api` |
| `scopes` | `[]` |
| właściciel | konto z §3.1 |
| utworzony | 2026-09-14 19:10:02 |
| ostatnio użyty | 2026-09-18 14:01:30 |
| wartość | **nie podaję** — to jest `N8N_MCP_TOKEN` z `.env` (plik spoza gita, `.gitignore:1`) |

Znacznik czasu jest wymowny: klucz powstał o **19:10:02**, a pierwszy workflow z MCP
(`ag3nCPjnADFqUADE`) o **19:11:50** — sto osiem sekund później. To niezależnie potwierdza
kolumnę „pochodzenie" w §1.

> **Rozbieżność, na którą trzeba uważać.** `GET /n8n/rest/api-keys` zwraca
> `{"items":[],"counts":{"mine":0,"all":0}}` — czyli **zero**, mimo że w bazie klucz jest.
> Endpoint listuje tylko klucze o powierzchni publicznego API; klucz o `audience`
> `mcp-server-api` do niego nie należy. Kto będzie unieważniał token przed wyłączeniem n8n
> na podstawie tego endpointu, uzna że nie ma czego unieważniać.

**`deployment_key` — 4 wiersze**, wszystkie wygenerowane przy pierwszym starcie instancji
(2026-09-14 11:59:04), wszystkie `status=active`. Typy: `instance.id`, `signing.hmac`,
`signing.jwt`, `signing.binary_data`. Wartości **nie podaję**. To materiał podpisujący
instancji — `signing.jwt` podpisuje ciasteczko sesji n8n (stąd obserwacja z baseline'u §3.11,
że ciasteczko przeżywa restart: token jest samonośny i weryfikowany tym kluczem).

**Czy potrzebne po migracji: nie.** Oba zbiory są związane z instancją n8n i po jej wyłączeniu
nie znaczą nic.

**Co się z nimi dzieje:** klucz MCP należy **jawnie unieważnić w n8n zanim instancja
przestanie wstawać** — inaczej zostaje ważny sekret w `.env` bez właściciela, który mógłby go
cofnąć. `deployment_key` ginie z wolumenem; skutek uboczny — wszystkie wydane ciasteczka
sesji przestają być weryfikowalne, co po migracji jest bez znaczenia.

### 3.4 Poświadczenia (credentials)

```
credentials_entity            0
shared_credentials            0
credential_dependency         0
dynamic_credential_entry      0
dynamic_credential_resolver   0
dynamic_credential_user_entry 0
oauth_clients / oauth_access_tokens / oauth_refresh_tokens / oauth_user_consents   0
secrets_provider_connection   0
```

`GET /n8n/rest/credentials` → `{"data":[]}`.

**Czy potrzebne po migracji: nie ma czego migrować.** Zero. Potwierdza to skuteczność zakazu
z promptu systemowego (`chat-backend/server.mjs:23-25`) — model przez cztery dni pracy nie
utworzył ani jednego poświadczenia.

**Co się z nimi dzieje:** nic, bo ich nie ma. Zastrzeżenie w §5 pkt 6.

### 3.5 Tagi, foldery, adnotacje

```
tag_entity              0
workflows_tags          0
folder / folder_tag     0
annotation_tag_entity   0
execution_annotations   0
execution_annotation_tags 0
```

**Czy potrzebne: nie ma czego migrować.** Ani jeden z 15 workflow nie jest otagowany
(`"tags": []` we wszystkich odpowiedziach API). Dagu Community i tak nie ma odpowiednika.

### 3.6 Projekty

**1 projekt:** `IHayLHJhOJfiBMSF`, typ `personal`, nazwa „Admin Local <admin@admin.com>",
utworzony automatycznie razem z właścicielem (2026-09-14 11:59:02). `project_relation` — 1
wiersz, rola `project:personalOwner`. `shared_workflow` — 15 wierszy, każdy workflow
przypisany do tego jednego projektu z rolą `workflow:owner`.

**Czy potrzebne po migracji: nie.** Cała struktura projektowa to jeden domyślny projekt
osobisty jednego użytkownika. Dagu Community ma 1 użytkownika i nie ma projektów ani RBAC
(decyzja §7 pkt 4) — i nic przez to nie tracimy, bo nie ma czego podzielić.

**Co się z nim dzieje:** ginie z wolumenem, bez straty. Uwaga na przyszłość: gdyby prototyp
kiedykolwiek miał obsłużyć więcej niż jednego operatora, ta kolumna przestaje być pusta,
a Dagu Community nie ma na to odpowiedzi.

### 3.7 Zmienne

`variables` — **0 wierszy.** `GET /n8n/rest/variables` → `{"data":[]}`. Nic do rozliczenia.

### 3.8 Historia wykonań

| co | wartość |
|---|---|
| `execution_entity` | **12** (id 1–12) |
| `execution_data` | 12 — każdy wiersz ma `data` (wejścia/wyjścia węzłów) **i** `workflowData` (pełna migawka definicji) |
| statusy | 12 × `success`, 0 błędów |
| tryby | 12 × `manual` |
| `execution_metadata`, `binary_data` | 0 — żadnych danych binarnych |
| `workflow_statistics` | 8 wierszy, wszystkie `manual_success` |
| `retryOf` / `retrySuccessId` | wszędzie `null` — żadne wykonanie nie było ponowieniem |

**Czy potrzebna po migracji: nie jako dane, tak jako dowód.** Historia wykonań Dagu nie jest
i nie będzie kontynuacją tej historii — to inny silnik, inny format, inny licznik
(decyzja §2: „historia wykonań Dagu nie jest bazą domenową"). Ale jest to jedyny zapis
mówiący, że te procesy naprawdę chodziły, a nie tylko zostały zapisane.

**Co się z nią dzieje:** zostaje w wolumenie. **Jedno zastrzeżenie, które trzeba wypowiedzieć
głośno:** w `execution_data.workflowData` siedzą trzy wersje pośrednie `aEUUAnNsUr7LJIyr`
(§1.1), których nie ma w żadnej innej tabeli. To jedyny fragment wolumenu, którego utrata
byłaby **nieodwracalna w sensie informacyjnym** — definicje bieżące da się odtworzyć z tego
dokumentu i z `workflow_history`, a historii edycji nie da się odtworzyć z niczego.

### 3.9 Pozostała zawartość wolumenu — rozliczenie do zera

| obiekt | licznik | co to jest | czy potrzebne | los |
|---|---|---|---|---|
| `workflow_history` | 15 | po jednym wierszu na workflow — **tylko stan bieżący**, plus kolumna `authors` (dowód pochodzenia z §0) | nie po migracji; w trakcie — tak, to źródło tego rejestru | ginie z wolumenem, treść przepisana tutaj |
| `workflow_dependency` | 37 | indeks typów węzłów użytych w definicjach | nie — w pełni wyprowadzalne z definicji | ginie, bez straty |
| `settings` | 6 | `userManagement.isInstanceOwnerSetUp=true`, `mcp.access.enabled=true`, `chat.access.enabled=false`, `instanceAi.settings` (`enabled:false`), `features.ldap` (domyślne), `ui.banners.dismissed` | nie — wszystko odtwarzalne z `docker-compose.yml` (`N8N_MCP_MANAGED_BY_ENV`, `N8N_MCP_ACCESS_ENABLED`) albo z domyślnych | ginie, bez straty |
| `mcp_registry_server` | 74 | katalog gotowych serwerów MCP dostarczony z obrazem; **wszystkie 74 wiersze mają identyczny `createdAt` 2026-09-14 11:59:06** — dane zasiewowe, nie wiedza operatora | nie | ginie, bez straty |
| `role` / `scope` / `role_scope` | 15 / 187 / 605 | wbudowany model uprawnień n8n | nie | ginie, bez straty |
| `migrations` | 248 | historia migracji schematu n8n | nie | ginie, bez straty |
| `instance_version_history` | 1 | `2.38.7` — instancja nigdy nie była aktualizowana | nie (wersja jest w `docker-compose.yml:5`) | ginie, bez straty |
| `installed_nodes`, `installed_packages` | 0 / 0 | + `nodes/package.json` z `"dependencies": {}` | — | **ważne ustalenie: żadnych węzłów community.** Nie ma niestandardowego kodu do przeniesienia |
| `storage/` | pusty katalog | miejsce na pliki binarne n8n | nie | ginie, bez straty |
| `webhook_entity`, `scheduled_job`, `scheduled_task`, `poller_state` | 0 | wyzwalacze | nie | **zero webhooków i zero harmonogramów** — spójne z „wszystko ręcznie" |
| `workflow_published_version`, `workflow_publish_history`, `workflow_review_*` | 0 | mechanizm publikacji i recenzji n8n 2.x | nie | nigdy nieużywany |
| `agents*`, `chat_hub_*`, `instance_ai_*`, `evaluation_*`, `data_table*` | 0 | funkcje n8n 2.x poza zakresem prototypu | nie | nigdy nieużywane |
| `n8nEventLog*.log` | 4 pliki, ~87 KB | dziennik zdarzeń, **rotowany** — najstarszy zachowany wpis `2026-09-14T23:25:58+02:00` | nie | ginie z wolumenem; pierwszych 9 workflow i tak już w nim nie ma |
| `crash.journal` | 0 B | pusty — czysty ostatni start | nie | — |
| cały wolumen | **3,2 MB** (`database.sqlite` 2,0 MB + `-wal` 1,0 MB + logi 84 KB + `config` 4 KB) | — | — | **nietykalny do odwołania** (decyzja §11) |

---

## 4. Mapowanie na Dagu — cztery workflow DO-ODTWORZENIA

Podstawa: `docs/audyt-dagu.md` [D13], [D14], [D15], [D16], [D17] i decyzja §4.1.
Kluczowe ustalenie, które rządzi całą tą sekcją: **dane między krokami idą tekstem**
w `DAGU_OUTPUT_FILE` w formacie `KLUCZ=wartość`; `$json.pole` nie istnieje, a zagnieżdżone
ścieżki typu `${steps.x.outputs.totals.brutto}` lecą do shella jako literał i kończą się
`bad substitution` [D14].

### 4.0 Cztery rzeczy, które dotyczą wszystkich czterech mapowań

**(a) Nazwa staje się identyfikatorem — i żadna z dzisiejszych nazw nie przejdzie.**
W n8n kluczem jest nieprzezroczysty `id` (np. `ag3nCPjnADFqUADE`), a nazwa jest ozdobą.
W Dagu kluczem jest **nazwa DAG-a**, ograniczona do `^[A-Za-z0-9_-]{1,64}$` (decyzja §4.2).
Wszystkie 15 dzisiejszych nazw zawiera spacje, a `Średnia temperatura z trzech miast`
zawiera dodatkowo `ś`. Każdemu odtwarzanemu procesowi trzeba nadać **nową nazwę ASCII**,
a to znaczy dwie zmiany semantyki:

* deep-link R04 przestaje wskazywać nieprzezroczysty identyfikator, a zaczyna wskazywać
  nazwę wybraną przez człowieka albo model;
* **zmiana nazwy DAG-a zrywa stare deep-linki.** W n8n zmiana nazwy nie ruszała `id`.

**(b) Wyzwalacz przestaje być węzłem.** `n8n-nodes-base.manualTrigger` nie ma odpowiednika
w Dagu — DAG bez pola `schedule:` jest po prostu uruchamiany na żądanie
(`dagu_execute action=start`). Każdy z czterech procesów traci przez to jeden widoczny
element grafu. Dla R04 („w ramce widać kanwę edytora z węzłami") to zauważalna różnica,
nie kosmetyczna.

**(c) Typy giną na granicy kroku.** Węzeł `set` w n8n deklaruje typ per pole
(`{"name":"cenaNetto","value":49.99,"type":"number"}`). Dagu ma w `outputs:` dokładnie dwa
typy: `string` i `json`, gdzie `json` znaczy wyłącznie „ten tekst musi się sparsować".
Liczba przeżywa tylko **wewnątrz** dokumentu JSON, a nie jako zadeklarowany typ pola.

**(d) Konwencja `RESULT=<JSON w jednej linii>` ma nieopisaną jeszcze kruchość.**
Podstawienie `${steps.x.outputs.RESULT}` trafia do polecenia powłoki jako **tekst**, przed
uruchomieniem. W dowodzie [D6] widać skutek uboczny tego mechanizmu w samym Dagu:
`SUMMARY totals={netto:149.97,brutto:184.46}` — cudzysłowy zniknęły. Żeby konwencja z decyzji
§4.1 działała, **każdy krok odbierający musi objąć podstawienie apostrofami**
(`echo '${steps.x.outputs.RESULT}' | jq …`), a dokument JSON nie może zawierać apostrofu.
To nie jest problem teoretyczny: pola tekstowe w tych workflow zawierają nazwy produktów
i imiona. Rekomendacja: konwencja powinna wymuszać `@base64` albo `@json` przy emisji, a nie
tylko „jedna linia". **Do rozstrzygnięcia przed implementacją.**

---

### 4.1 `gnzjOf2qHJoEPeGo` „Status OK" → DAG `status-ok`

Fixture scenariusza R02/R03. Najprostszy, więc pierwszy do przeniesienia.

| węzeł n8n | konstrukcja Dagu |
|---|---|
| `Start` (`manualTrigger`) | — (brak `schedule:`; start przez `dagu_execute action=start`) |
| `Set Status` (`set`, 1 przypisanie `status="OK"`, typ string) | jeden krok zapisujący `RESULT={"status":"OK"}` do `$DAGU_OUTPUT_FILE`, z `outputs: [{name: RESULT, type: json}]` |

```yaml
name: status-ok
steps:
  - id: set-status
    run: printf 'RESULT={"status":"OK"}\n' >> "$DAGU_OUTPUT_FILE"
    outputs:
      - {name: RESULT, type: json}
```

**Co się zmienia:** 2 węzły → 1 krok. Odpowiedź czatu dla R03 („zwrócił dokładnie jeden
element o treści `{"status": "OK"}`") musi być teraz odczytana z `outputs` biegu
(`dagu_read target=run`), a nie z tabeli elementów. Sformułowanie „jeden element" traci sens,
bo Dagu nie ma elementów — kryterium akceptacji R03 wymaga przeredagowania.

**Niewykonalne: nic.**

---

### 4.2 `ag3nCPjnADFqUADE` „Demo MCP - wartosc zamowienia" → DAG `demo-mcp-wartosc-zamowienia`

Proces z README. Dowód end-to-end dla R02/R03/R14.

| węzeł n8n | konstrukcja Dagu |
|---|---|
| `Start` (`manualTrigger`) | — |
| `Pozycja zamowienia` (`set`, `mode: manual`, 3 przypisania: string + 2 × number) | krok emitujący `RESULT={"produkt":"Kabel HDMI 2.1","cenaNetto":49.99,"ilosc":3}`, `outputs: [{name: RESULT, type: json}]` |
| `Policz wartosc brutto` (`code`, `runOnceForAllItems`, pętla po `$input.all()`, VAT 23%, zaokrąglenie do groszy) | krok `depends: [pozycja-zamowienia]`, czytający `RESULT` przez `jq` i emitujący nowy `RESULT` |

```yaml
name: demo-mcp-wartosc-zamowienia
steps:
  - id: pozycja-zamowienia
    run: |
      printf 'RESULT=%s\n' '{"produkt":"Kabel HDMI 2.1","cenaNetto":49.99,"ilosc":3}' >> "$DAGU_OUTPUT_FILE"
    outputs:
      - {name: RESULT, type: json}
  - id: policz-wartosc-brutto
    depends: [pozycja-zamowienia]
    run: |
      printf 'RESULT=%s\n' "$(echo '${steps.pozycja-zamowienia.outputs.RESULT}' \
        | jq -c '{produkt, ilosc,
                  netto:  ((.cenaNetto*.ilosc)      *100|round/100),
                  brutto: ((.cenaNetto*.ilosc*1.23) *100|round/100)}')" >> "$DAGU_OUTPUT_FILE"
    outputs:
      - {name: RESULT, type: json}
```

**Co zmienia semantykę:**

1. **Deklaracja typów znika.** `cenaNetto` i `ilosc` były w n8n polami typu `number`;
   tutaj są liczbami wewnątrz tekstu, a typowanie odtwarza dopiero `jq` po stronie odbiorcy.
   Błąd cytowania nie objawi się błędem typu, tylko cichym wynikiem tekstowym.
2. **Pętla `for (const item of $input.all())` traci sens.** n8n uruchamiał ten kod raz
   na każdy element strumienia; tutaj jest jeden dokument i jedno przejście. Przy jednej
   pozycji wynik jest identyczny, ale kod przestaje być odporny na wiele pozycji —
   to trzeba zapisać, a nie przemilczeć.
3. **Zaokrąglanie do zweryfikowania.** `Math.round(x*100)/100` w JS i `(x*100|round/100)`
   w `jq` to dwie różne implementacje na liczbach zmiennoprzecinkowych. Zgodność co do grosza
   trzeba **sprawdzić**, nie założyć.

**Niewykonalne: nic** — pod warunkiem, że w obrazie Dagu jest `jq` (patrz §5 pkt 2).

---

### 4.3 `UQeWUmSDcg9gKXXY` „Lista produktow i suma zamowienia" → DAG `lista-produktow-suma-zamowienia`

Najlepsze dopasowanie z całej czwórki: ten proces **już dziś** ma kształt „jeden dokument JSON
na wejściu → jeden dokument JSON na wyjściu", czyli dokładnie ten, który wymusza konwencja
z decyzji §4.1.

| węzeł n8n | konstrukcja Dagu |
|---|---|
| `Start` (`manualTrigger`) | — |
| `Lista produktow` (`set`, **`mode: raw`**, całe zamówienie jako jeden `jsonOutput`) | krok emitujący ten sam dokument jako `RESULT` — **przeniesienie 1:1**, bo źródło już jest jednym JSON-em |
| `Policz sume zamowienia` (`code`: `lineTotal` per pozycja, `subtotal`, `vat` 23%, `total`, `itemCount`, `unitsTotal`) | krok `jq` z `map` + `reduce`, emitujący `RESULT` |

```yaml
name: lista-produktow-suma-zamowienia
steps:
  - id: lista-produktow
    run: |
      printf 'RESULT=%s\n' "$(jq -cn '{orderId:"ZAM-2026-001", currency:"PLN", items:[
        {sku:"P-001", name:"Klawiatura mechaniczna",  unitPrice:349.99, quantity:1},
        {sku:"P-002", name:"Mysz bezprzewodowa",      unitPrice:129.50, quantity:2},
        {sku:"P-003", name:"Podkladka pod mysz XL",   unitPrice:59.00,  quantity:3}]}')" >> "$DAGU_OUTPUT_FILE"
    outputs:
      - {name: RESULT, type: json}
  - id: policz-sume
    depends: [lista-produktow]
    run: |
      printf 'RESULT=%s\n' "$(echo '${steps.lista-produktow.outputs.RESULT}' | jq -c '
        (.items | map(. + {lineTotal: ((.unitPrice*.quantity)*100|round/100)})) as $lines
        | {orderId, currency, lines: $lines,
           itemCount:  ($lines|length),
           unitsTotal: ($lines|map(.quantity)|add),
           subtotal:   (($lines|map(.lineTotal)|add)*100|round/100)}
        | . + {vatRate: 0.23, vat: (.subtotal*0.23*100|round/100)}
        | . + {total: ((.subtotal + .vat)*100|round/100)}')" >> "$DAGU_OUTPUT_FILE"
    outputs:
      - {name: RESULT, type: json}
```

**Co zmienia semantykę:** praktycznie nic poza typowaniem i kruchością cytowania z §4.0(d) —
a ta akurat tu gryzie najmocniej, bo dokument zawiera trzy pola tekstowe z nazwami produktów.

**Niewykonalne: nic.** **Rekomendacja: to jest workflow, od którego należy zacząć migrację** —
jeśli konwencja `RESULT` nie udźwignie tego przypadku, nie udźwignie żadnego.

---

### 4.4 `aEUUAnNsUr7LJIyr` „Premie 8% od pensji" → DAG `premie-od-pensji`

Najtrudniejszy i najważniejszy. Jedyny, który spełnia wszystkie wymagania przypadku
odbiorczego Fazy 1 (decyzja §10), i jedyny, w którym mapowanie **nie jest** przepisaniem
1:1.

| węzeł n8n | konstrukcja Dagu | uwaga |
|---|---|---|
| `Start` (`manualTrigger`) | — | |
| `Dane pracownikow` (`code`, zwraca **3 elementy**) | krok emitujący `RESULT=[{…},{…},{…}]` — jedną **tablicę** JSON | Dagu nie ma strumienia elementów; 3 elementy stają się 1 dokumentem |
| `Premia 8%` (`set`, `includeOtherFields:true`, wyrażenie `={{ Math.round($json.pensja*0.08*100)/100 }}`) | krok `jq 'map(. + {stawkaPremii:0.08, premia: ((.pensja*0.08)*100\|round/100)})'` | pętla per element staje się jawnym `map()` |
| `Dodatek 50 zl` (`set` ×3 pola, wyrażenia na `$json.premia`, `$json.pensja`) | kolejny `jq map` | |
| `Stawka podatku` (`set`, wyrażenie **warunkowe** `$json.pensjaZPremia > 10000 ? 0.32 : 0.12`) | **dwa różne mapowania — patrz niżej** | tu leży cała trudność |
| `Podatek dochodowy` (`set` ×2 pola) | kolejny `jq map` | |
| `Suma premii` (`code`, fan-in: sumy po wszystkich elementach + tablica `szczegoly`) | krok z `depends:` na gałęziach, `jq` z `add`/`reduce`, emitujący `RESULT` | **jeśli powyżej są gałęzie, każda z nich musi mieć `continue_on: skipped`** [D13] |

#### Rozgałęzienie — trzeba wybrać, bo nie da się mieć obu

Dziś warunek na stawkę podatku jest **wyrażeniem wewnątrz jednego węzła**. Silnik n8n nie
widzi tu żadnej gałęzi: graf jest liniowy, 7 węzłów w jednym ciągu. Są dwa sposoby
odtworzenia i dają **różne grafy**:

* **Wariant A — warunek zostaje w `jq`.** `if .pensjaZPremia > 10000 then 0.32 else 0.12 end`.
  Wynik **identyczny co do liczby**, graf nadal liniowy, zero pułapek. Ale wtedy ten proces
  **nie spełnia** wymagania decyzji §10 „co najmniej jedno rozgałęzienie warunkowe zależne
  od zawartości danych", bo rozgałęzienia nie widać w silniku — i nie widać go w ramce.
* **Wariant B — warunek wyniesiony do `preconditions`.** Krok rozdzielający tablicę na dwie
  (`>10000` i `<=10000`), dwa kroki liczące, `continue_on: skipped` na **obu gałęziach**,
  i fan-in. Spełnia §10 i pokazuje operatorowi prawdziwy graf — ale **to nie jest odtworzenie
  dzisiejszego procesu, tylko jego przeprojektowanie**: n8n nigdy nie dzielił zbioru
  pracowników na dwie ścieżki.

**Rekomendacja:** wariant B dla przypadku odbiorczego Fazy 1, z jawnym zapisem w dokumentacji,
że graf jest inny niż w n8n i dlaczego. Wariant A, gdyby celem było wierne odtworzenie.
Milczące wybranie jednego z nich byłoby dokładnie tym, czego ten dokument ma nie dopuścić.

#### Co jest niewykonalne albo zmienia semantykę

1. **Strumień elementów nie ma odpowiednika.** n8n uruchamiał każdy `set` i `code` raz na
   pracownika, automatycznie. W Dagu tablica jedzie jako jeden dokument i każdy krok musi
   jawnie zrobić `map()`. Skutek uboczny: **limit `max_output_size` 1 MiB na krok** staje się
   twardym sufitem rozmiaru zbioru — n8n takiego sufitu nie miał. Dla trzech pracowników
   to obojętne, dla realnych danych Fazy 2 — nie.
2. **`includeOtherFields: true` nie ma odpowiednika.** To n8n-owe „zachowaj co przyszło,
   dołóż te pola". W Dagu każdy krok musi **sam** ponownie wyemitować cały dokument;
   zapomniane pole znika po cichu, bez błędu. Cztery węzły `set` w tym workflow polegają
   na tej fladze — to cztery miejsca, w których łatwo zgubić dane.
3. **Kolejność przy ewentualnym `parallel:`.** Gdyby trzej pracownicy mieli kiedyś pójść
   przez `action: dag.run` z `parallel:`, agregat zwraca wyniki w **niegwarantowanej
   kolejności** [D15, spec 018]; tablica `szczegoly` musiałaby być sortowana przed zwinięciem.
   n8n zachowywał kolejność elementów.
4. **Fan-in bierze tylko `output:`, nie `outputs:`** [D15] — niespójność samego Dagu,
   już zapisana w decyzji §4.1, ale to właśnie ten workflow jest pierwszym, który się o nią
   potknie.
5. **Historia edycji nie ma gdzie zamieszkać.** Dagu trzyma DAG-i jako zwykłe pliki YAML
   bez bazy i bez tabeli wersji [D16]; `dagu_change upsert_dag` nadpisuje cały plik, nie
   istnieje edycja częściowa. Trzy wersje pośrednie tego procesu (§1.1), które w n8n dają się
   odtworzyć z migawek wykonań, w Dagu po prostu by nie powstały. **Jeśli historia „jak czat
   dochodził do rozwiązania" ma przetrwać, katalog `dags/` musi iść pod git** — to osobna
   decyzja, której nie ma w `decyzja-architektoniczna.md`.

---

## 5. Czego nie dało się ustalić

1. **Dlaczego powstało dokładnie pięć pustych „My workflow N" i cztery identyczne
   „Prototyp iframe - test".** Pochodzenie jest ustalone (ręcznie, w UI — `authors='Admin Local'`,
   `meta=null`), ale intencja nie. Dziennik zdarzeń jest rotowany i najstarszy zachowany wpis
   ma znacznik `2026-09-14T23:25:58+02:00`, czyli **po** utworzeniu całej dziewiątki.
   Klasyfikacji to nie zmienia; motywacji nie odtworzę.
2. **Czy obraz Dagu zawiera `jq`.** Wszystkie cztery mapowania w §4 zakładają `jq` w kroku.
   Audyt Dagu używał `awk` [D13] i pokazywał wynik `jq` w treści kroku [D6], ale **nie ma
   w nim wprost potwierdzenia, jakie interpretery są w obrazie**
   `ghcr.io/dagucloud/dagu@sha256:b242dc7b…` — w szczególności czy jest `node` albo `python3`,
   którymi można by przenieść kod węzłów `code` dosłownie. Sam tego nie sprawdziłem, bo Dagu
   należy w tej chwili do innego zadania. **To trzeba zweryfikować przed implementacją §4** —
   jeśli `jq` nie ma, wszystkie cztery mapowania wymagają przepisania na `awk`, albo obraz
   wymaga rozszerzenia.
3. **Czy zawartość `execution_data.data` (wejścia i wyjścia poszczególnych węzłów) jest warta
   zachowania.** Policzyłem rozmiary (1 160 – 5 884 B na wykonanie) i odczytałem z niej
   `workflowData`, ale nie przeglądałem samych danych wynikowych. Jeśli dowodem ma być
   *wynik*, a nie sama definicja, to osobna ekstrakcja — do decyzji operatora.
4. **Czy `N8N_MCP_TOKEN` z `.env` to na pewno klucz `yRsJFnUDDaTaUKZy`.** Wszystko na to
   wskazuje — jedyny klucz w bazie, `audience=mcp-server-api`, utworzony 108 s przed pierwszym
   workflow z MCP, `lastUsedAt` z dzisiaj. Ale **nie porównałem wartości**, bo porównanie
   wymagałoby wzięcia sekretu do ręki. Przed unieważnieniem klucza ktoś musi to potwierdzić
   świadomie.
5. **Który z 15 workflow widać na `docs/baseline-iframe-workflow.png`.** Zrzutu listy użyłem
   (widać na nim `Total 15`), zrzutu pojedynczego procesu nie korelowałem z `id` — na zrzucie
   nie ma identyfikatora, a adres ramki nie jest na nim czytelny.
6. **Czy w tej instancji kiedykolwiek istniały poświadczenia, które potem skasowano.**
   `credentials_entity` wynosi **0 teraz**. n8n nie prowadzi tabeli nagrobków, a okno dziennika
   zdarzeń nie sięga początku instancji. Zdanie „poświadczeń nigdy nie było" jest
   **nieudowadnialne**; udowodnione jest tylko „nie ma ich dziś". Dla klucza szyfrowania (§3.2)
   różnicy to nie robi — nie ma czego odszyfrowywać.
7. **Ile z 12 wykonań przeżyłoby retencję.** n8n ma `saveDataSuccessExecution: "all"`
   i `executionTimeout: -1`, czyli nic nie jest przycinane. Nie sprawdziłem, czy w tym wolumenie
   kiedykolwiek zadziałało czyszczenie — sekwencja `execution_entity` ma wartość 12, a wierszy
   jest 12, więc **nic nie zostało usunięte**, ale to argument z licznika, nie z dziennika.

---

## 6. Zmiany stanu wprowadzone przez tę inwentaryzację

Dla uczciwości, w konwencji załącznika do `baseline-prototypu.md`:

1. **Jedno logowanie do API silnika** kontem `admin@admin.com` (konto lokalne, hasło jawne
   w README). Skutek: +1 zdarzenie `n8n.audit.user.login.success` w dzienniku i odświeżony
   `lastActiveAt` na koncie właściciela.
2. **Kopia bazy** (`database.sqlite`, `-wal`, `-shm`) wyciągnięta przez `docker cp` do katalogu
   tymczasowego sesji i otwarta z `mode=ro`. Pliki w wolumenie nie były otwierane do zapisu
   ani modyfikowane.
3. **Pobranie obrazu `alpine:latest`** do lokalnego rejestru Dockera, jednorazowo, żeby
   zmierzyć rozmiar wolumenu przez `docker run --rm -v n8niframe_n8n_data:/data:ro`. Montowanie
   read-only, bez `--user` (rootless Docker).
4. **Zero wywołań `/api/chat`.** Zero utworzonych, zmienionych, usuniętych i uruchomionych
   workflow. Zero restartów kontenerów. Zero operacji na wolumenie poza odczytem.
   Liczniki na koniec pracy: **15 workflow, 12 wykonań** — bez zmian wobec §0.
5. **Utworzony wyłącznie ten plik.** Żaden inny plik w repozytorium nie został zmieniony.

> **Uwaga metodyczna.** Przy próbie odczytania samych *nazw pól* z pliku `/home/node/.n8n/config`
> polecenie parsujące padło i wypisało w moim terminalu roboczym linię pliku razem z wartością
> klucza szyfrowania. Wartość **nie jest reprodukowana w tym dokumencie**, plik nie został
> zmieniony, a klucz i tak nie chroni niczego (§3.2). Odnotowuję, bo rozliczenie, które ukrywa
> własne potknięcia, jest warte mniej niż to, które ich nie ukrywa.

---

## 7. Ekstrakcja fixture (2026-09-18)

Sekcje 0–6 rozliczyły, **co** jest w wolumenie. Ta sekcja rozlicza, **co z tego wyjęto**
do repozytorium i z jakim wynikiem weryfikacji. Wynik ekstrakcji leży w `fixtures/`;
`fixtures/README.md` opisuje sam katalog, ta sekcja opisuje robotę.

Zakres świadomie ograniczony: **żadnego DAG-a, żadnego YAML-a Dagu.** Kontrakt danych
z §4.0(d) (kruchość `RESULT=<JSON w jednej linii>`, cytowanie, `@base64` vs „jedna linia")
jest nierozstrzygnięty; pliki napisane przed tą decyzją byłyby pracą do wyrzucenia.

### 7.1 Metoda: dlaczego online-backup, a nie `docker cp`

§0 użył `docker cp` na trzech plikach (`database.sqlite`, `-wal`, `-shm`) i to wystarczyło
do **policzenia** wierszy. Do **wyjęcia treści** nie wystarczy — i teraz wiadomo dlaczego,
bo to sprawdzone, a nie założone. Kopia samego `database.sqlite`, bez dziennika:

```
$ docker run --rm -v n8niframe_n8n_data:/vol:ro -v "$TMP":/out alpine:latest \
      sh -c 'cp /vol/database.sqlite /out/tylko-main.sqlite'
$ sqlite3 "file:$TMP/tylko-main.sqlite?mode=ro" "
    SELECT 'workflow_entity', count(*) FROM workflow_entity
    UNION ALL SELECT 'execution_entity', count(*) FROM execution_entity
    UNION ALL SELECT 'execution_data', count(*) FROM execution_data;"
workflow_entity|12
execution_entity|5
execution_data|5

$ sqlite3 "file:$TMP/tylko-main.sqlite?mode=ro" "PRAGMA integrity_check;"
ok
```

**12 / 5 / 5 zamiast 15 / 12 / 12** — i `integrity_check` mimo to mówi `ok`. Spójność
strukturalna nie wyłapuje brakującego dziennika; wyłapują to dopiero liczby wierszy.
Czego konkretnie brakuje w takiej kopii: workflow `aEUUAnNsUr7LJIyr` („Premie 8% od pensji"),
`FNgC8R2d33pddvSa` i `gnzjOf2qHJoEPeGo`, oraz wykonania #6–#12 — **czyli wszystkie pięć
wykonań procesu Premie, a z nimi wszystkie cztery wersje jego definicji z §1.1.** Materiał,
który §3.8 nazywa jedynym nieodwracalnym w sensie informacyjnym, jest dokładnie tym,
co naiwna kopia gubi w całości. Datowanie tłumaczy resztę: `database.sqlite` ma znacznik
2026-09-14 21:25, a `-wal` — 2026-09-18 17:20; cała praca z 15 i 18 września siedzi
w dzienniku.

Dlatego migawkę robi **natywny online-backup SQLite** (`.backup`), w kontenerze
pomocniczym montującym wolumen **read-only**:

```
$ docker run --rm --name n8n-fixture-backup \
    -v n8niframe_n8n_data:/vol:ro -v "$KATALOG_MIGAWKI":/out \
    alpine:latest sh -c '
      apk add --no-cache sqlite >/dev/null &&
      sqlite3 "file:/vol/database.sqlite?mode=ro" ".backup /out/database.snapshot.sqlite"'
```

Baza była w tym czasie otwarta przez działający kontener `n8niframe-n8n`
(`PRAGMA journal_mode` → `wal`). `.backup` czyta ją przez normalne API SQLite, więc scala
WAL z plikiem głównym sam. Wersje narzędzi: Docker 29.8.0 (rootless — bez `--user`),
`alpine@sha256:5b02b42e…`, SQLite 3.53.4.

### 7.2 Dowód spójności migawki

```
$ sqlite3 "file:$SNAP?mode=ro" "PRAGMA integrity_check; PRAGMA quick_check;"
ok
ok

$ sqlite3 "file:$SNAP?mode=ro" "
    SELECT 'workflow_entity ', count(*) FROM workflow_entity
    UNION ALL SELECT 'execution_entity', count(*) FROM execution_entity
    UNION ALL SELECT 'execution_data  ', count(*) FROM execution_data
    UNION ALL SELECT 'workflow_history', count(*) FROM workflow_history
    UNION ALL SELECT 'credentials_entity', count(*) FROM credentials_entity;"
workflow_entity |15
execution_entity|12
execution_data  |12
workflow_history|15
credentials_entity|0

$ sha256sum "$SNAP"
435c6392fb61b740112d0c4ff93293afb9e7edab84d7cf11f32899bf791039a2  database.snapshot.sqlite
$ stat -c %s "$SNAP"
2207744
```

**15 / 12 / 12 — zgodne z §0 i §3.8.** `workflow_history` = 15 i `credentials_entity` = 0
potwierdzają §3.9 i §3.4 na tej samej migawce.

**Migawka nie wchodzi do repozytorium.** Leży poza `fixtures/`, w katalogu tymczasowym sesji:

```
/tmp/claude-1000/-home-paczos-Documents-BetterProton-n8nIframe/\
1a50f909-fd31-41ec-b6d5-e2bd0bb21621/scratchpad/snapshot/database.snapshot.sqlite
sha256 435c6392fb61b740112d0c4ff93293afb9e7edab84d7cf11f32899bf791039a2, 2 207 744 B
```

Powód: zawiera hash hasła właściciela (§3.1), `deployment_key` (§3.3) i wiersz
`user_api_keys` (§3.3). To jest katalog sesji — **migawka zniknie razem z sesją.** Kto chce
ją zachować, musi ją skopiować świadomie i poza gita; kto chce ją odtworzyć, ma komendę
w §7.1 i w `fixtures/README.md` §5.

### 7.3 Co wyciągnięto

23 pliki w `fixtures/`, wszystkie w `MANIFEST.json`:

| co | ile plików | źródło |
|---|---|---|
| definicje czterech procesów DO-ODTWORZENIA | 4 | `workflow_entity` (20 kolumn) |
| wejścia czterech procesów | 4 | `execution_data.data`, węzeł wejściowy |
| oczekiwane wyjścia czterech procesów | 4 | `execution_data.data`, ostatni węzeł |
| cztery wersje definicji `Premie 8% od pensji` | 4 | `execution_data.workflowData` |
| definicje dwóch ARTEFAKTÓW-HISTORYCZNYCH | 2 | `workflow_entity` |
| `README.md` + 4 narzędzia (`ekstrakcja.py`, `weryfikuj.py`, `flatted.py`, `sprawdz-sumy.sh`) | 5 | — |

Wykonania wzorcowe: #12 (`status-ok`), #3 (`demo-mcp-wartosc-zamowienia`),
#4 (`lista-produktow-suma-zamowienia`), #11 (`premie-od-pensji`) — w każdym przypadku
najnowsze wykonanie danego procesu, którego `workflowVersionId` jest równy `versionId`
definicji bieżącej. Sprawdzone, zapisane w każdym pliku pod
`_kontekst.wykonanieZgodneZBiezacaDefinicja`.

**Jedno ustalenie techniczne warte zapisania.** `execution_data.data` nie jest zwykłym
JSON-em — to format biblioteki `flatted`: płaska tablica, w której **każdy string wewnątrz
kontenera jest indeksem** do tej tablicy, a prawdziwe stringi leżą w niej jako osobne wpisy.
`jq` tego nie rozwinie. Dekoder ma 30 linii i leży w `fixtures/_narzedzia/flatted.py`;
bez niego migawki wykonań są nieczytelne, a to one są jedynym nośnikiem §1.1.

**Drugie: `workflowData` nie zawiera `versionId`.** Ma tylko `id`, `name`, `nodes`,
`connections`, `settings`, `nodeGroups`. Przypisanie wersji do migawki idzie przez
`execution_entity.workflowVersionId`; zgodność z `execution_data.workflowVersionId`
sprawdzona dla wszystkich pięciu wykonań Premii — pięć na pięć.

### 7.4 Cztery wersje Premii — potwierdzenie §1.1

§1.1 rekonstruował ten podział z migawek; teraz każda wersja ma swój plik z pełną definicją
i listą wykonań, a przypisanie jest sprawdzone wobec bazy:

```
[OK] 01-3b7f786f-…: wykonania [6, 7] = [6, 7] z bazy
[OK] 01-3b7f786f-…: definicja = execution_data.workflowData (#6), 4 wezlow
[OK] 02-677655e1-…: wykonania [9] = [9] z bazy
[OK] 02-677655e1-…: definicja = execution_data.workflowData (#9), 4 wezlow
[OK] 03-74e1d18e-…: wykonania [10] = [10] z bazy
[OK] 03-74e1d18e-…: definicja = execution_data.workflowData (#10), 5 wezlow
[OK] 04-2a2d5435-…: wykonania [11] = [11] z bazy
[OK] 04-2a2d5435-…: definicja = execution_data.workflowData (#11), 7 wezlow
[OK] roznych versionId w execution_entity = 4
```

Wersję `01` uruchomiono dwa razy (#6 i #7); skrypt sprawdza, że obie migawki są identyczne,
i przerywa, gdyby nie były. **Tabela §1.1 potwierdza się co do wiersza.** Trzy wersje
pośrednie nadal nie istnieją w `workflow_history` — teraz istnieją w `fixtures/`.

### 7.5 Weryfikacja wyjść: te same pola, typy i precyzja

`fixtures/_narzedzia/weryfikuj.py` porównuje każdy `wejscie.json` i `oczekiwane-wyjscie.json`
z migawką po **kanonicznym JSON-ie**, więc łapie też różnicę `1` vs `1.0` i zmianę kolejności.
Wynik dla wszystkich czterech procesów — 16 sprawdzeń, wszystkie zielone. Pełne porównanie
pole-po-polu dla `premie-od-pensji` (wykonanie #11):

```
  pole                                      migawka typ             fixture typ      zgodne
  -----------------------------------------------------------------------------------------
  [0].liczbaPracownikow                           3 int                   3 int      tak
  [0].sumaPensji                              34500 int               34500 int      tak
  [0].sumaPremii                               2760 int                2760 int      tak
  [0].sumaDodatkow                              150 int                 150 int      tak
  [0].sumaPremiiRazem                          2910 int                2910 int      tak
  [0].sumaPodatku                             10406 int               10406 int      tak
  [0].sumaNaDoReke                            27004 int               27004 int      tak
  [0].szczegoly[0].imie              'Anna Kowalska' str      'Anna Kowalska' str      tak
  [0].szczegoly[0].pensja                      7200 int                7200 int      tak
  [0].szczegoly[0].premia                       576 int                 576 int      tak
  [0].szczegoly[0].dodatek                       50 int                  50 int      tak
  [0].szczegoly[0].premiaRazem                  626 int                 626 int      tak
  [0].szczegoly[0].stawkaPodatku               0.12 float              0.12 float    tak
  [0].szczegoly[0].podatek                   939.12 float            939.12 float    tak
  [0].szczegoly[0].naDoReke                 6886.88 float           6886.88 float    tak
  [0].szczegoly[1].imie               'Piotr Nowak' str       'Piotr Nowak' str      tak
  [0].szczegoly[1].pensja                     11500 int               11500 int      tak
  [0].szczegoly[1].premia                       920 int                 920 int      tak
  [0].szczegoly[1].dodatek                       50 int                  50 int      tak
  [0].szczegoly[1].premiaRazem                  970 int                 970 int      tak
  [0].szczegoly[1].stawkaPodatku               0.32 float              0.32 float    tak
  [0].szczegoly[1].podatek                   3990.4 float            3990.4 float    tak
  [0].szczegoly[1].naDoReke                  8479.6 float            8479.6 float    tak
  [0].szczegoly[2].imie              'Maria Wisniewska' str      'Maria Wisniewska' str      tak
  [0].szczegoly[2].pensja                     15800 int               15800 int      tak
  [0].szczegoly[2].premia                      1264 int                1264 int      tak
  [0].szczegoly[2].dodatek                       50 int                  50 int      tak
  [0].szczegoly[2].premiaRazem                 1314 int                1314 int      tak
  [0].szczegoly[2].stawkaPodatku               0.32 float              0.32 float    tak
  [0].szczegoly[2].podatek                  5476.48 float           5476.48 float    tak
  [0].szczegoly[2].naDoReke                11637.52 float          11637.52 float    tak
  [OK ] 31/31 lisci zgodnych co do sciezki, wartosci i typu
```

**Trzy rzeczy, które ta tabela mówi, a §4 tylko zapowiadał:**

1. **`sumaPodatku` i `sumaNaDoReke` są `int`, nie `float`.** `939.12 + 3990.4 + 5476.48`
   wypadło równo `10406`, więc JS zapisał liczbę całkowitą. Implementacja w Dagu, która
   zwróci `10406.0`, będzie liczbowo poprawna i **nie przejdzie** porównania z tym fixture.
   To jest §4.0(c) („typy giną na granicy kroku") pokazane na konkretnej wartości.
2. **Precyzja nie jest jednolita w obrębie jednego pola.** `szczegoly[].podatek` ma
   `[1, 2]` cyfr po przecinku — `3990.4` obok `939.12`. To skutek `Math.round(x*100)/100`,
   a nie formatowania. Fixture zapisuje to jawnie w polu `precyzjaLiczb`.
3. **Zaokrąglanie `jq` vs JS pozostaje do sprawdzenia** (§4.2 pkt 3). Fixture daje teraz
   liczbę odniesienia co do grosza dla każdego z 31 liści — jest z czym porównywać.

Dla `lista-produktow-suma-zamowienia` jedno ostrzeżenie o precyzji, które trzeba znać:
w definicji węzła `Lista produktow` (tryb `raw`) tekst JSON ma `"unitPrice": 129.50`
i `59.00`, ale wykonanie zapisało `129.5` i `59`, bo JSON nie przechowuje zer końcowych.
Fixture zapisuje wartości **po wykonaniu**. To samo dotyczy `lineTotal: 259` i `177`.

### 7.6 Manifest

`fixtures/MANIFEST.json` opisuje **każdy** plik w `fixtures/` oprócz siebie samego (nie może
zawierać własnej sumy): ścieżka, rozmiar, sha256, źródło (tabela + kolumna + identyfikator
wiersza) i znacznik ekstrakcji. Dodatkowo nagłówek z sumą i licznościami migawki oraz sekcja
`polaPominiete`. Weryfikacja drugą, niezależną drogą — przez `sha256sum --check`, bez Pythona
i bez migawki:

```
$ ./fixtures/_narzedzia/sprawdz-sumy.sh fixtures
katalog:  fixtures
manifest: 23 wpisow, ekstrakcja 2026-09-18T17:33:46Z

README.md: OK
_artefakty-historyczne/prototyp-iframe-test-ICRY74rH9w6xbTqr/definicja-n8n.json: OK
_artefakty-historyczne/srednia-temperatura-trzech-miast-rnfu7SOGxjqaUbYH/definicja-n8n.json: OK
_narzedzia/ekstrakcja.py: OK
_narzedzia/flatted.py: OK
_narzedzia/sprawdz-sumy.sh: OK
_narzedzia/weryfikuj.py: OK
demo-mcp-wartosc-zamowienia/definicja-n8n.json: OK
demo-mcp-wartosc-zamowienia/oczekiwane-wyjscie.json: OK
demo-mcp-wartosc-zamowienia/wejscie.json: OK
lista-produktow-suma-zamowienia/definicja-n8n.json: OK
lista-produktow-suma-zamowienia/oczekiwane-wyjscie.json: OK
lista-produktow-suma-zamowienia/wejscie.json: OK
premie-od-pensji/definicja-n8n.json: OK
premie-od-pensji/oczekiwane-wyjscie.json: OK
premie-od-pensji/wejscie.json: OK
premie-od-pensji/wersje/01-3b7f786f-b83d-4845-97cc-21b0f780b573.json: OK
premie-od-pensji/wersje/02-677655e1-cc91-497b-95b0-ea570dd73a08.json: OK
premie-od-pensji/wersje/03-74e1d18e-91f6-4aab-a100-a4e035dfb14a.json: OK
premie-od-pensji/wersje/04-2a2d5435-eded-42e9-b78f-8be0bfafb1b3.json: OK
status-ok/definicja-n8n.json: OK
status-ok/oczekiwane-wyjscie.json: OK
status-ok/wejscie.json: OK

--- rozmiary ---   (23 pozycje, wszystkie OK — pominięte dla zwięzłości)
EXIT=0
```

`weryfikuj.py` sprawdza dodatkowo **pokrycie**: `23 wpisow = 23 plikow na dysku
(bez MANIFEST.json); nadmiarowe na dysku: brak`. Plik dołożony do `fixtures/` bez
przeliczenia manifestu zostanie wykryty.

**Jedna rzecz, której manifest nie daje: powtarzalności bajt w bajt.** Każdy plik nosi
`_kontekst.znacznikEkstrakcji`, więc ponowne uruchomienie ekstrakcji zmienia znacznik,
a przez to wszystkie sumy. Powtarzalna jest **treść merytoryczna** — do jej porównania służy
`weryfikuj.py`, który czyta z migawki, a nie z poprzedniego przebiegu.

### 7.7 Skan na sekrety

18 plików danych (wszystkie `*.json` w `fixtures/` poza `MANIFEST.json`, razem 63 221 B),
wzorce słownikowe, bez rozróżniania wielkości liter:

```
$ grep -rniE 'token|hash|secret|key|passw|credential|api[_-]?key|bearer|authorization|encryption|jwt|hmac|signing' \
       fixtures --include='*.json' --exclude='MANIFEST.json'
(brak wyjścia)   rc=1
```

Całe `fixtures/`, wzorce na **kształt** sekretu (bcrypt, 32-hex, 64-hex, JWT, base64 ≥ 40 znaków),
z pominięciem zadeklarowanych sum sha256 w manifeście:

```
$ grep -rnE '\$2[aby]\$[0-9]{2}\$|\b[0-9a-f]{32}\b|\b[0-9a-f]{64}\b|eyJ[A-Za-z0-9_-]{10,}\.|[A-Za-z0-9+/]{40,}={0,2}' \
       fixtures/ | grep -v '^fixtures/MANIFEST.json:.*"sha256"'
(brak wyjścia)   rc=1
```

Nazwy zakazanych tabel i pól w plikach danych:

```
$ grep -rniE 'credentials_entity|user_api_keys|deployment_key|N8N_MCP_TOKEN|encryptionKey|resumeToken' \
       fixtures/ --include='*.json' | grep -v MANIFEST.json
(brak wyjścia)   rc=1
```

**Uczciwe zastrzeżenie: skan słownikowy po *całym* katalogu daje 31 trafień, nie zero.**
Rozkładają się tak — `_narzedzia/ekstrakcja.py` 17, `README.md` 9, `_narzedzia/weryfikuj.py` 3,
`MANIFEST.json` 2 — i wszystkie są **prozą, kodem albo metadanymi, nigdy wartością**:
README wymienia, czego tu nie ma („hash hasła właściciela", „`deployment_key`",
„`N8N_MCP_TOKEN`"); skrypty zawierają `import hashlib`, `hashlib.sha256()`, `key=str`
w `sorted()` i literały samych wzorców ochronnych (`re.compile(r"resumeToken")`);
manifest ma `"credentials_entity": 0` w licznościach i nazwę pominiętego pola
w `polaPominiete`. Zero z tych 31 wierszy niesie sekret. Podaję tę liczbę, bo raport,
który dobiera zakres skanu tak, żeby wyszło zero, jest wart mniej niż ten, który pokazuje
trafienia i je rozlicza.

Trzecia linia obrony jest **przed** zapisem, nie po: `ekstrakcja.py` skanuje treść każdego
pliku wzorcami `resumeToken`, `encryptionKey`, bcrypt i 64-hex i **przerywa pracę**, gdy coś
złapie. Manifest ma węższy zestaw (bcrypt, `encryptionKey`), bo z założenia zawiera sumy
sha256 i nazywa pominięte pole.

**Pola pominięte świadomie:** `execution_data.data → resumeToken` — 64-znakowy token
wznowienia wykonania, obecny w każdym z 12 wierszy. Nie jest przepisywany do żadnego pliku;
pominięcie odnotowane w `MANIFEST.json` pod `polaPominiete`.

### 7.8 Czego nie dało się wyciągnąć

1. **Trzech pośrednich wersji `Premie 8% od pensji` z `workflow_history`** — bo ich tam nie ma
   i nigdy nie było (§1.1). Wyciągnięto je z migawek wykonań; to **jedyne** dostępne źródło.
   Gdyby wykonania #6, #9 i #10 kiedyś skasowano, tej historii nie odzyska nikt.
2. **`versionId` z `execution_data.workflowData`** — kolumna go nie zawiera (§7.3).
   Przypisanie idzie z `execution_entity.workflowVersionId`. Gdyby te dwie tabele się
   rozjechały, plik `wersje/NN-<uuid>.json` niósłby złą etykietę; sprawdzone, że nie rozjeżdżają
   się w żadnym z 5 wykonań Premii, ale to sprawdzenie, nie gwarancja formatu.
3. **Wersji pośrednich pozostałych 14 workflow** — nie istnieją, bo każdy z nich powstał
   jednym strzałem i ma dokładnie jedną wersję. To nie jest luka, to fakt o tej instancji.
4. **Danych wejściowych „z zewnątrz"** — nie ma takich. Wszystkie cztery procesy startują
   z `manualTrigger`, który produkuje jeden pusty element; wejście dziedzinowe jest zaszyte
   w węźle `set`/`code`. `wejscie.json` wypisuje je jawnie, ale to jest **rekonstrukcja
   z wykonania**, nie zapis tego, co ktoś podał — bo nikt nic nie podawał.
5. **Wyników węzłów pośrednich** — celowo pominięte, nie utracone. W migawce są
   (`Premia 8%`, `Dodatek 50 zl`, `Stawka podatku`, `Podatek dochodowy`), ale kontrakt dla
   granic kroków pośrednich zależy od wyboru wariantu A/B rozgałęzienia (§4.4), a ten wybór
   jeszcze nie padł. Odtworzenie jest tanie: `flatted.py` + jedno zapytanie.
6. **Wykonań #1, #2, #5, #8** — nie wchodzą do fixture, bo dotyczą workflow ZBĘDNYCH albo
   ARTEFAKTÓW-HISTORYCZNYCH, dla których zachowujemy samą definicję. Zostają w wolumenie.
7. **Sprawdzenia, czy `N8N_MCP_TOKEN` z `.env` to klucz `yRsJFnUDDaTaUKZy`** — §5 pkt 4
   nadal otwarty. Nie porównywałem wartości, bo to wymagałoby wzięcia sekretu do ręki,
   a fixture i tak nie mogą go zawierać.
8. **Czegokolwiek z `credentials_entity`** — tabela ma 0 wierszy (potwierdzone na migawce,
   §7.2). Nie ma czego wyciągać, a nie „nie udało się".

### 7.9 Zmiany stanu wprowadzone przez tę ekstrakcję

W konwencji §6:

1. **Trzy kontenery pomocnicze**, każdy `docker run --rm` (usuwany natychmiast), obraz
   `alpine:latest` już obecny lokalnie: sondaż dostępności `sqlite`, online-backup bazy,
   kopia samego `database.sqlite` na dowód niespójności z §7.1. Wolumen
   `n8niframe_n8n_data` montowany za każdym razem **wyłącznie `:ro`**. Zero kontenerów
   długo żyjących, zero portów, zero projektu compose.
2. **Zero zapisów do wolumenu.** Listing po pracy jest identyczny z listingiem sprzed pracy
   co do rozmiarów i znaczników czasu wszystkich 11 pozycji: `database.sqlite` 2 129 920 B
   (14 wrz 21:25), `-wal` 1 083 592 B (18 wrz 17:20), `-shm` 32 768 B (18 wrz 17:20).
3. **Kontener `n8niframe-n8n` działał przez cały czas i działa nadal** (`Up 5 hours`).
   Zero restartów, zero `docker compose down`, zero operacji na wolumenach.
4. **Zero wywołań REST API n8n i zero wywołań `/api/chat`.** Ta ekstrakcja, w odróżnieniu
   od §6 pkt 1, **nie logowała się do silnika** — cała wiedza pochodzi z migawki. Liczniki
   na koniec: 15 workflow, 12 wykonań — bez zmian wobec §0.
5. **Utworzony katalog `fixtures/` (23 pliki) i ta sekcja.** Żaden inny plik
   w repozytorium nie został zmieniony.
6. **Migawka bazy zostaje w katalogu tymczasowym sesji** i zniknie razem z nią (§7.2).
   To jest świadoma decyzja, nie przeoczenie: plik zawiera materiał, którego nie wolno
   położyć w repozytorium, a `fixtures/` wystarczą do wszystkiego, po co go robiono.
