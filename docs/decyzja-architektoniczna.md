# Decyzja architektoniczna: n8n → Dagu w prototypie

Data: 2026-09-18. **Wersja 3.1.** Faza 1 z dwóch. Podstawa: `docs/audyt-dagu.md`,
`docs/baseline-prototypu.md` (18 scenariuszy regresji), `docs/audyt-dagu-walidacja.md`
(werdykt `NATYWNE-CZESCIOWO`), `docs/rejestr-workflow.md` (15 obiektów rozliczonych)
oraz `docs/audyt-dagu-bezpieczenstwo.md`.

Wersja 3 wnosi ustalenia dwóch badań, które wersja 2 zostawiła otwarte, i **wycofuje**
dwa zapisy wersji 2: kanał `DAGU_OUTPUT_FILE` dla danych objętych kontraktem (§4.1)
oraz regexp identyfikatora `^[A-Za-z0-9_-]{1,64}$` (§4.2). Oba były błędne wobec
zachowania przypiętej wersji silnika.

## Status dokumentu

Wersja 3 domyka kontrakty danych i identyfikatorów. **Otwarte pozostają wyłącznie pozycje
oznaczone niżej jako blokujące** — każda z nazwanym zadaniem, które blokuje. Nic poza nimi
nie wstrzymuje implementacji.

| Co | Stan | Blokuje | Gdzie |
| --- | --- | --- | --- |
| Zakres Fazy 1, granica silnik/domena, wersjonowanie | ustalone | — | §1, §2, §3 |
| **Kontrakt kanału wyniku (K1–K6)** | **ustalone wersją 3**, potwierdzone wykonaniem | — | §4.1 |
| **Podział egzekwowania silnik / polityka** | **ustalone wersją 3** (`NATYWNE-CZESCIOWO`) | — | §4.1a |
| **Polityka identyfikatorów** | **ustalone wersją 3**, decyzja operatora | — | §4.2 |
| **Git jako nośnik wersji i rollbacku** | **ustalone wersją 3**, decyzja operatora | — | §11 |
| Rozliczenie 15 obiektów wiedzy | ustalone — `docs/rejestr-workflow.md` | — | §7a |
| Izolacja sekretów od kroku DAG-a (R-C) | **otwarte** — czeka na `docs/audyt-dagu-bezpieczenstwo.md` | T1 (konfiguracja Dagu), granica zaufania §5.0 | §5 R-C |
| Token silnika: `localStorage` czy proxy (R-B) | **otwarte** — czeka na ten sam raport | T1 (Caddyfile, logowanie), T3 (ramka) | §5 R-B |
| Mechanizm sesji `/api/chat` (R-A) | **otwarte** — czeka na ten sam raport | T1 (backend, proxy), T3 (frontend) | §5 R-A |
| Utraty funkcji A1–A2, L1–L7 | zaakceptowane 2026-09-18 pod W-1 i W-2 | — | §7.1, §7.2 |

Trzy otwarte pozycje mają jedno źródło: badanie bezpieczeństwa. Do jego werdyktu **T2
(warstwa polityki) i T4 (migracja) nie są zablokowane** — kontrakt danych, na którym stoją,
jest już zamknięty.

## 1. Zakres

**W zakresie:** wymiana silnika w `/home/paczos/Documents/BetterProton/n8nIframe`.

**Poza zakresem:** `/home/paczos/Documents/DrukujSam/monorepo/duzeprodukty/v2`. Ustalono
w audycie wstępnym, że n8n nie jest tam podłączone — zero trafień w kodzie, a historyczny
plan migracji ma status `wstrzymane przez użytkownika` i nigdy nie został wykonany. Własny
interpreter (`domain/conversion.py`, `application/conversion.py`, `application/prompt_rules.py`)
zostaje nietknięty. Faza 2 wymaga osobnej decyzji operatora.

## 2. Granica silnik / domena

Dagu odpowiada za: definicję procesu, kolejność kroków, zależności, warunki, rozgałęzienia,
harmonogramy, triggery, wykonanie, retry, historię wykonań i logi per krok.

Dagu **nie** odpowiada za: dane biznesowe, wiedzę domenową, uwierzytelnianie operatora
naszej aplikacji, kontekst rozmowy. Historia wykonań Dagu nie jest bazą domenową.

Deterministyczna logika kroków mieszka w skryptach poza definicją DAG-a. Definicja YAML
opisuje orkiestrację, nie reguły biznesowe.

Wewnętrzny agent AI Dagu (`type: agent`, `harness.run`) **nie jest używany**. Żaden krok
w przebiegu transformacji nie woła modelu. Model jest wyłącznie autorem definicji, przez MCP.

## 3. Wersjonowanie

```yaml
image: ghcr.io/dagucloud/dagu@sha256:b242dc7b605aa20d6db78ba192beb82135d390025a7d9c8dfd7f08e14464c69f
# tag równoważny: ghcr.io/dagucloud/dagu:2.16.6 (wydanie 2026-09-14)
```

Przypięcie po digeście, nie po tagu. Zakaz `latest`. Rootless Docker: `PUID=0`/`PGID=0`,
**bez** `user:` i bez `--user` — inaczej bind-mounty padają na EACCES.

## 4. Kontrakty danych

### 4.1 Granica kroku — kanał wyniku

Wersja 2 tego dokumentu kazała przenosić wynik przez `DAGU_OUTPUT_FILE` jako `RESULT=<JSON>`.
**To jest wycofane.** `docs/audyt-dagu-walidacja.md` §2.3 pokazał wykonaniem, że natywna
walidacja `output_schema` **nie widzi tego kanału**: krok wypisał zgodny JSON na stdout,
wepchnął do `DAGU_OUTPUT_FILE` dokument łamiący schemat w każdym punkcie, DAG skończył się
na zielono, a odbiorca dostał śmieci. Kanał, którego walidator nie widzi, nie może nieść
danych objętych kontraktem.

**Kontrakt obowiązujący (K1–K6):**

* **K1.** Krok, którego wynik jest wejściem innego kroku, wypisuje na **stdout dokładnie jeden
  dokument JSON** i nic więcej. Diagnostyka, postęp i ostrzeżenia idą na **stderr**.
* **K2.** Ten krok deklaruje `output: <NAZWA>` — płaskie przechwycenie stdout.
* **K3.** Ten krok deklaruje `output_schema:` będący **obiektowym** schematem JSON Schema,
  opisującym wynik dokładnie: `type: object`, `required`, `properties` z typami,
  `additionalProperties: false`.
* **K4.** Krok odbierający czyta wartość jako **zmienną środowiskową w cudzysłowie**
  (`"$NAZWA"`) i parsuje ją przez `jq`. Nigdy przez parsowanie tekstu ad hoc.
* **K5.** **Zakazane dla danych objętych kontraktem:** zapis do `$DAGU_OUTPUT_FILE`,
  deklaracja `outputs:` oraz odwołania `${steps.*.outputs.*}`.
* **K6.** Wynik większy niż praktyczny sufit kroku nie jedzie zmienną. Idzie **artefaktem**,
  a granicę kroku przekracza **manifest** — mały dokument JSON objęty K1–K4, zawierający
  ścieżkę względem katalogu artefaktów, rozmiar i sumę kontrolną. Walidacja manifestu **nie
  jest** walidacją zawartości pliku; zawartość waliduje krok odbierający, osobno.

**Dlaczego K4 mówi „zmienna w cudzysłowie", a nie „apostrofy wokół podstawienia".**
`docs/rejestr-workflow.md` §4.0(d) zgłosił kruchość: `${steps.x.outputs.RESULT}` trafia do
polecenia powłoki **jako tekst, przed uruchomieniem**, więc apostrof w danych rozwala
cytowanie. Rejestr rekomendował obejmowanie podstawienia apostrofami — co łamie się na
pierwszym `Gość's`. Sprawdzone wykonaniem 2026-09-18 na przypiętej wersji, oba kanały obok
siebie, ta sama wartość (apostrof, cudzysłowy, spacje, `$(id)`, backticki):

```
NOWY KANAL   (stdout + output: + output_schema), odbiorca: printf '%s' "$RESULT" | jq -r .produkt
  PRODUKT=[Kubek "Duzy" 0,5l - Gosc's $(id) `whoami`]        Result: Succeeded

STARY KANAL  (DAGU_OUTPUT_FILE + outputs:), odbiorca: echo '${steps.produce.outputs.RESULT}'
  /usr/bin/sh: 1: Syntax error: Unterminated quoted string   Result: Failed
```

Z tego wynikają dwie własności nowego kanału, obie potwierdzone tym samym przebiegiem:

1. **Wartość nie jest wstrzykiwana do wiersza poleceń.** Dagu podaje ją jako zmienną
   środowiskową, więc cytowanie danych przestaje być problemem autora DAG-a.
2. **`$(id)` i backticki w danych NIE są wykonywane** — wróciły dosłownie. Stary kanał
   wstawiał tekst przed uruchomieniem powłoki, więc był drogą do wykonania kodu z danych.
   To nie jest tylko wygoda zapisu; to zamknięcie wektora wstrzyknięcia.

**Dwie pułapki nowego kanału, obie potwierdzone wykonaniem — należą do testów negatywnych:**

* **Odwołanie `${steps.x.outputs.RESULT}` do kroku, który publikuje przez `output:`, nie jest
  rozwijane** — przechodzi dalej jako literał `${steps.produce.outputs.RESULT}`. Krok się
  **udaje**, a odbiorca dostaje tekst placeholdera zamiast danych. To cicha podmiana danych,
  nie błąd — dlatego K5 zakazuje tej formy, a polityka musi ją odrzucać przy zapisie.
* **`$NAZWA` jest widoczne wyłącznie w krokach zależnych.** Krok bez `depends` dostał wartość
  pustą. Krawędź zależności jest krawędzią danych — brak `depends` to cichy brak danych.

**Pozostałe reguły kształtu, wszystkie wymuszone przez silnik** (`audyt-dagu-walidacja.md` §2.4–2.5):

| Reguła | Co robi silnik, gdy złamana |
| --- | --- |
| stdout to **czysty** JSON — ani jednej linii logu przed nim | `failed: failed to decode stdout JSON for output_schema` |
| dokładnie **jeden** dokument, nie strumień | `failed: invalid character '{' after top-level value` |
| stdout **niepusty** | `failed: output_schema requires stdout to contain a JSON value` |
| schemat **obiektowy** (`type: object` albo brak `type`) | odrzucenie **przy ładowaniu**: `output_schema must resolve to an object schema` |
| wynik najwyższego poziomu będący tablicą → opakować w obiekt | jw. |

### 4.1a Egzekwowanie kontraktu — podział pracy

Werdykt badania: **`NATYWNE-CZESCIOWO`** (`docs/audyt-dagu-walidacja.md` §0). Silnik daje
realną, czerwoną walidację danych, ale nie da się nią objąć całego kontraktu. Podział jest
więc jawny — i to jest dokładnie ten podział, którego wersja 2 nie umiała wskazać.

**Egzekwuje silnik, bez naszego kodu:**

| Co | Kiedy | Dowód |
| --- | --- | --- |
| Wynik niezgodny ze schematem → krok `failed`, zależne `aborted`, DAG `failed` | wykonanie | walidacja §2.2 |
| Naruszenie propaguje z sub-DAG-a do rodzica; `retry_policy` ponawia i finalnie czerwieni | wykonanie | walidacja §2.2 |
| Nieznane pole kroku, krok bez polecenia, `depends` na nieistniejący krok, duplikat `id`, zły typ pola, brak wymaganego `with` akcji, niepoprawny YAML | zapis (`dagu_change`, też `mode=apply`) | walidacja §3.1 |
| `input_schema` akcji własnej | ładowanie definicji | walidacja §3.2 |
| Akcji własnej z pliku bazowego **nie da się przesłonić** definicją lokalną | ładowanie definicji | walidacja §3.5 |

**Nie egzekwuje silnik — to jest pełny zakres naszej warstwy polityki (T2):**

| Luka | Dlaczego silnik nie wystarcza | Dowód |
| --- | --- | --- |
| Brak `output_schema` na kroku publikującym wynik | pole jest opcjonalne; `defaults:` go nie zna, więc nie da się narzucić globalnie | walidacja §3.4 |
| Osłabienie schematu (`{}`, brak `required`, brak `additionalProperties: false`, typ `string` zamiast `number`) | każdy taki schemat jest dla silnika poprawny | walidacja §2.4 |
| `continue_on: {failure: true, mark_success: true}` na kroku ze schematem | zamienia czerwony przebieg w zielony | walidacja §2.6 |
| Zapis do `$DAGU_OUTPUT_FILE` / `outputs:` (drugi kanał) | całkowicie poza zasięgiem `output_schema` | walidacja §2.3 |
| Odwołanie `${steps.*.outputs.*}` | nierozwijane i **nie zgłaszane**; przechodzi lint | §4.1 wyżej, walidacja §3.1 |
| Cykl w grafie | przechodzi lint `dagu_change`, wybucha dopiero przy starcie | walidacja §3.1 |
| Nazwa DAG-a spoza naszej polityki | Dagu dopuszcza kropkę i 39 znaków; nasza polityka jest węższa | walidacja §4, §4.2 niżej |
| DAG bez kroków | przechodzi lint i kończy się `succeeded` | walidacja §3.1 |

**Czym warstwa polityki NIE jest.** Nie jest drugim silnikiem. Nie ma własnego schedulera,
własnego retry, własnej implementacji JSON Schema ani własnego wykonywania kroków. Waliduje
**sparsowaną strukturę** definicji (YAML → obiekt, po rozwinięciu `defaults:`, akcji własnych
i sub-DAG-ów), a nie tekst pliku wyrażeniami regularnymi.

**Czym nie są `preconditions`.** Potrafią sięgnąć do treści wyniku przez `eval` i `jq`, ale
niespełniony warunek daje krok `skipped` i **DAG `succeeded`** (walidacja §3.3). To bramka
logiczna, nie walidacja kontraktu, i nie wolno jej tak przedstawiać w odbiorze. Zarazem
`continue_on: skipped` na gałęziach warunkowych jest **wymagany** przez fan-in [D13] — polityka
musi odróżnić poprawnie pominiętą gałąź od zamaskowanego naruszenia kontraktu, a nie zakazywać
`continue_on` hurtem.

**Gdzie mieszkają kontrakty.** Schematy są wersjonowane i zatwierdzane **poza definicją, którą
edytuje agent**. Nośnikiem natywnym jest `actions:` w pliku bazowym Dagu: definicja akcji niesie
`input_schema` i `output_schema`, DAG używa jej przez samo `action: <nazwa>` i nie powtarza
schematu, a nazwy akcji nie da się przesłonić lokalnie (walidacja §3.5). To centralizuje
schematy, ale **nie jest samodzielną blokadą obejścia** — nic nie zmusza agenta, żeby użył
akcji zamiast zwykłego `run:`. Wymuszenie użycia należy do warstwy polityki.

**Prompt systemowy** nadal opisuje konwencję, żeby model trafiał za pierwszym razem.
**Nie jest środkiem kontroli** i nie wolno go w raporcie odbiorczym jako taki przedstawiać.

### 4.1b Uzupełnienia kontraktu z pomiarów implementacji (wersja 3.1)

Trzy rzeczy, których wersja 3 nie wiedziała, bo ujawniły się dopiero przy pisaniu prawdziwych
procesów. Wszystkie potwierdzone wykonaniem.

**K7 — `preconditions` i dane.** Rozgałęzienie warunkowe jest wymagane przez §10, ale
`preconditions` zachowują się inaczej niż reszta kontraktu i mają **otwarty wektor, który K4
zamknął**. Zmierzone na przypiętej wersji:

| Forma | Czy widzi wartość z kanału K4 (`output:`) | Czy uruchamia powłokę | Werdykt |
| --- | --- | --- | --- |
| `condition: "${NAZWA}"` + `expected: "re:…"` | **tak** — podstawia tekst dokumentu | **nie** — porównanie wzorcem | **jedyna dozwolona** |
| `eval: "… ${NAZWA} …"` | **nie** — nie jest podstawiane, warunek nigdy nie pasuje | tak | **zakazana** |
| cokolwiek z `${steps.*.outputs.*}` | tak — wkleja tekst do polecenia | tak | **zakazana bezwzględnie** |

Dowód dla ostatniego wiersza — dane wyprodukowane starym kanałem, `$(id -u)` **wykonane**
z zawartości danych:

```
produce:  DANE=zaczynam $(id -u) koniec        (przez DAGU_OUTPUT_FILE + outputs:)
warunek:  eval "echo '${steps.produce.outputs.DANE}'"  expected: re:zaczynam 0 koniec
wynik:    krok URUCHOMIONY  ->  podstawienie wykonalo komende z danych
warunek:  ten sam, expected: re:zaczynam \$\(id -u\) koniec
wynik:    skipped           ->  literal NIE zostal zachowany
```

Dlatego **K5 rozciąga się na `preconditions`**: zakaz `${steps.*.outputs.*}` obowiązuje
tam tak samo jak w `run:`, a `eval` na danych jest zakazany.

**Wzorzec rozgałęzienia — dokument bramkowy o zamkniętym słowniku.** Skoro `condition:`
porównuje tekst, to do porównania nie może trafić ani jeden znak pochodzący z danych.
Obowiązujący wzorzec: osobny krok liczy z danych **dokument bramkowy**, którego wszystkie
wartości pochodzą z zamkniętego zbioru wymuszonego `enum` w `output_schema`; gałęzie
porównują `condition` z tym dokumentem, a dane jadą do nich osobno, kanałem K4.

```yaml
- id: bramka_galezi
  run: "$SKRYPTY/bramka.sh"          # z danych liczy {"galazPowyzej":"tak"|"nie", …}
  output: BRAMKA
  output_schema:
    type: object
    additionalProperties: false
    required: [galazPowyzej, galazPonizej]
    properties:
      galazPowyzej: {type: string, enum: ["tak", "nie"]}
      galazPonizej: {type: string, enum: ["tak", "nie"]}

- id: podatek_wysoki
  depends: [rozdziel_progiem, bramka_galezi]
  preconditions:
    - condition: "${BRAMKA}"
      expected: 're:"galazPowyzej":"tak"'
  continue_on: {skipped: true}        # WYMAGANE na OBU gałęziach, inaczej fan-in nie zbiegnie
```

Zmierzone: `condition` podstawia wartość z kanału K4 i **rozróżnia** — gałąź z pasującym
wzorcem `succeeded`, gałąź z niepasującym `skipped`.

**K6 — realny sufit kanału to 128 KiB, nie 1 MiB.** L5 (§7.2) mówi o `max_output_size`
1 MiB i to prawda dla *silnika*, ale kanał K1–K4 przenosi wartość **zmienną środowiskową**,
więc ogranicza go `MAX_ARG_STRLEN` jądra. Zmierzone: **126 684 B przechodzi, 131 884 B nie**,
czyli próg to 131 072 B (128 KiB).

Gorsze od samego limitu jest **to, jak pęka**: krok *produkujący* kończy się na zielono,
a czerwony jest *odbiorca*, który nic złego nie zrobił. Dlatego próg przejścia na artefakt
i manifest (K6) jest w polityce **liczbowy i niższy** niż limit silnika, a nie „gdy się nie
zmieści".

**Identyfikator kroku ma własny, węższy zbiór znaków.** Nazwa DAG-a to `^[a-z0-9][a-z0-9-]{0,38}$`
(§4.2), ale `id` kroku musi pasować do `^[a-zA-Z][a-zA-Z0-9_]*$` — **bez myślnika**.
Stąd `dane_pracownikow`, nie `dane-pracownikow`. Rejestr §4 tego nie wiedział.

**Czego nie ma w obrazie.** Przypięty obraz ma `jq` 1.7, ale **nie ma `node` ani `python3`**.
Węzły `code` z n8n (JavaScript) nie zostały przeniesione — zostały **przepisane na `jq`**.
To jest zmiana implementacji przy zachowanym zachowaniu, i tak ma być raportowana.

### 4.2 Identyfikatory

Rozdzielamy dwie rzeczy, które w n8n były rozdzielone same z siebie (`id` nieprzezroczysty,
nazwa ozdobna), a w Dagu zlewają się w jedno pole:

* **identyfikator techniczny** = nazwa DAG-a = nazwa pliku YAML = segment URL,
* **nazwa wyświetlana** = polska, z diakrytykami, spacjami i procentami, trzymana w polu
  opisowym definicji i pokazywana w naszym UI.

**Polityka identyfikatora — decyzja operatora 2026-09-18:**

```
^[a-z0-9][a-z0-9-]{0,38}$
```

Węższa od tego, co przyjmuje silnik, i to celowo. Dagu dopuszcza `[A-Za-z0-9._-]` do 39 znaków
(`docs/audyt-dagu-walidacja.md` §4, potwierdzone wykonaniem: `dagu_change` przyjął i zapisał
DAG `order.v3`). Wersja 2 tego dokumentu obiecywała 64 znaki, których silnik **nie przyjmie**,
i zakazywała kropki, której silnik **nie zakazuje**. Oba stwierdzenia były błędne.

| Powód zawężenia | Skutek |
| --- | --- |
| Bez kropki | znikają `..`, `.hidden`, końcówka `.yaml` i kropka w segmencie URL |
| Bez wielkich liter i podkreślenia | jedna kanoniczna postać, brak kolizji przy porównaniach |
| Limit 39, nie 64 | aplikacja nigdy nie poprosi silnika o nazwę, której ten odrzuci |
| Pierwszy znak alfanumeryczny | brak nazw zaczynających się od `-` (mylonych z flagą) |

**Transliteracja i kolizje.** Nazwę polską sprowadzamy do identyfikatora deterministycznie:
diakrytyki → ASCII (`ą→a`, `ś→s`, `ż→z`, `ó→o`, `ł→l`), wielkie litery → małe, każdy ciąg
znaków spoza zbioru → pojedynczy `-`, obcięcie wiodących i końcowych `-`, skrócenie do 39
znaków po granicy `-`. Kolizja po transliteracji albo po skróceniu → sufiks `-2`, `-3`, …,
przydzielany przez warstwę polityki, **nie** przez model. Mapowanie identyfikator → nazwa
wyświetlana jest w definicji DAG-a, więc jedzie razem z nią do Gita.

**Zmiana nazwy zrywa stare deep-linki** — w n8n nie zrywała, bo kluczem był `id`. To jawna
zmiana semantyki, nie błąd; wchodzi na listę różnic wobec baseline'u i do scenariusza regresji.

### 4.3 Kontrakt HTTP naszego backendu

Kształt żądania i odpowiedzi `/api/chat` zmienia się **w dwóch miejscach i tylko w nich**:

* pole `workflowId` → **dwa** pola: `dagName` (identyfikator procesu wg §4.2) i `dagRunId`
  (identyfikator wykonania). W n8n jedno pole wystarczało, bo deep-link prowadził do procesu;
  w Dagu wynik ogląda się pod wykonaniem, a definicję pod procesem — to dwa różne adresy;
* dochodzi wymóg sesji (§5 R-A) — bez niej `/api/chat` odmawia.

`reply`, `sessionId`, `costUsd`, `durationMs` **zostają bez zmian**, bo frontend i ciągłość
wątku na nich stoją. `costUsd` pozostaje tym, czym było: liczbą raportowaną przez CLI modelu.
**Nie wolno jej przedstawiać jako potwierdzonej dopłaty do abonamentu** — to szacunek zużycia,
nie faktura.

Sukces operacji ustala się **odczytem z silnika po `dagRunId`** (`dagu_read target=run`,
pole `statusLabel`), nigdy z treści odpowiedzi modelu. Model może napisać „gotowe" przy
czerwonym przebiegu.

## 5. Bezpieczeństwo i granica zaufania

### 5.0 Granica zaufania — co w ogóle obiecujemy

Zanim pojedyncze ryzyka: **kogo ten system kontroluje, a kogo nie.** Bez tego zdania każdy
środek z tej sekcji czyta się jak obietnica szersza, niż jest.

| Aktor | Postawa | Uzasadnienie |
| --- | --- | --- |
| **Model jako autor definicji** (przez MCP) | **kontrolowany** | Definicja przechodzi przez lint silnika i warstwę polityki (§4.1a). Model nie ma powłoki ani plików poza tą ścieżką. |
| **Krok DAG-a napisany przez model** (kod wykonywany przez silnik) | **kontrolowany warunkowo** | Zakres kontroli zależy od werdyktu R-C. Do czasu werdyktu zakładamy, że krok widzi wszystko, co widzi proces serwera Dagu. |
| **Operator aplikacji** (przeglądarka, czat, ramka) | **kontrolowany na wejściu** | Sesja `/api/chat` (R-A), ograniczenia ramki. Nie kontrolujemy tego, co operator robi świadomie w UI Dagu. |
| **Ktokolwiek z zapisem do `docker-compose.yml`, pliku bazowego Dagu, katalogu `dags/` albo do wolumenu** | **POZA GWARANCJĄ** | Taki aktor przepisuje same reguły. Żaden środek z tej sekcji go nie zatrzymuje i nie udajemy, że zatrzymuje. |
| **Administrator hosta / użytkownik OS uruchamiający Docker** | **POZA GWARANCJĄ** | Rootless Docker mapuje kontener na tego użytkownika. Ma dostęp do wszystkich plików, wolumenów i procesów obu silników. |
| **Sieć poza `127.0.0.1`** | **nie dotyczy** | Nic nie jest publikowane poza pętlą lokalną. |

Dwa wnioski, które trzeba wypowiedzieć wprost, bo ocena gotowości słusznie je wytknęła:

* **„Sekret w pliku zamiast w `environment:`" nie jest dowodem izolacji.** Jeśli krok biegnie
  tym samym użytkownikiem co serwer, plik jest dla niego czytelny i sekret tylko zmienił
  miejsce. Werdykt: R-C.
* **„Bez socketu Dockera" nie znaczy „izolowany".** Krok nadal ma sieć kontenera, system
  plików kontenera i wszystko, co ten kontener osiąga. Werdykt: R-C.

### 5.1 Trzy ryzyka

Trzy ryzyka rozdzielone, bo mają różne źródła i różne środki zaradcze. Wcześniejsza wersja
tego dokumentu łączyła R-A z R-B, co sugerowało, że naprawa jednego obniża drugie. Nie obniża.

### R-A — brak uwierzytelniania `/api/chat`

**Źródło:** stan zastany, wykryty w baseline. Istnieje dziś, z n8n, niezależnie od Dagu
i niezależnie od tego, jak trzymamy token silnika.

**Skutek:** każdy, kto dosięgnie portu, wywołuje model na nasz koszt i zleca mu autorstwo
oraz uruchamianie procesów.

**Środek:** uwierzytelnianie `/api/chat` — decyzja operatora z 2026-09-18.

**Czego NIE naprawia:** niczego z R-B. Atak przez XSS działa w już uwierzytelnionej
przeglądarce operatora, więc przechodzi przez tę bramkę, nie obok niej.

### R-B — token silnika dostępny dla kodu strony

**Źródło:** Dagu nie daje ciasteczka sesji, tylko JWT w ciele odpowiedzi [D22]. Żeby ramka
działała po jednym logowaniu, token musi skądś pochodzić.

**Skutek:** jeśli token leży w `localStorage` naszego originu, XSS w naszej aplikacji
oddaje napastnikowi tyle Dagu, ile ten token może.

**Środek — DO ROZSTRZYGNIĘCIA, dwa warianty:**

* **B1 — token w `localStorage`** (wybór operatora z 2026-09-18). Ryzyko przyjęte świadomie.
  Obniżenie ryzyka zależy od tego, czy token da się wystawić z mniejszymi uprawnieniami
  niż administracyjne — **zlecone do weryfikacji**, badanie bezpieczeństwa (`task_9cb45f14bf1f`), pytanie P5.
* **B2 — token po stronie proxy.** Caddy trzyma token i wstrzykuje `Authorization` do żądań
  `/dagu/*`; przeglądarka nie ma czego wykraść. Daje ten sam efekt dla operatora — jedno
  logowanie — przy istotnie mniejszym ryzyku. **Wykonalność nierozstrzygnięta:** SPA Dagu może
  mimo wstrzykniętego nagłówka żądać logowania, bo jej własny stan klienta mówi
  „niezalogowany". Zlecone do weryfikacji w tym samym zadaniu, pytanie P4.

Jeśli B2 okaże się wykonalne, rekomenduję zmianę wyboru na B2 i przedstawię ją operatorowi
jako osobną decyzję. Do tego czasu obowiązuje B1.

### R-C — krok DAG-a napisany przez model ma dostęp do sekretów silnika

**Źródło:** audyt [D32] — krok dziedziczy `DAGU_AUTH_TOKEN_SECRET` i hasło admina ze
środowiska serwera, więc może podrobić JWT administratora.

**Środek wybrany przez operatora:** przeniesienie sekretów z `environment:` do pliku
konfiguracyjnego.

> **UWAGA — środek nie jest jeszcze potwierdzony i może być pozorny.** Krok biegnie
> w tym samym kontenerze i prawdopodobnie tym samym użytkownikiem co serwer, więc plik
> konfiguracyjny może być dla niego zwyczajnie czytelny. Wtedy sekret przenosi się
> z jednego czytelnego miejsca w drugie i nic nie zyskujemy.
> **Zlecone do weryfikacji:** badanie bezpieczeństwa (`task_9cb45f14bf1f`), pytanie P1. Do czasu werdyktu R-C pozostaje
> **otwarte**, a nie zamknięte. Jeśli środek okaże się pozorny, wracam do operatora
> z wariantami, które operator odrzucił wcześniej (executor kontenerowy, osobna instancja)
> albo ze stwierdzeniem, że w Community nie da się tego domknąć.

### 5.2 Werdykty badania i decyzje operatora (wersja 3.1)

`docs/audyt-dagu-bezpieczenstwo.md` rozstrzygnął wszystkie trzy ryzyka wykonaniem.
Dwa są domknięte, jedno **nie da się domknąć** i zostało przyjęte świadomie.

| Ryzyko | Werdykt badania | Decyzja operatora 2026-09-18 |
| --- | --- | --- |
| **R-A** — brak sesji `/api/chat` | mechanizm działa: ciasteczko `HttpOnly; SameSite=Strict`, serwerowa unieważnialność, kontrola `Origin`; dowody 401 bez sesji / 200 z sesją / 403 obcy Origin / 401 po wylogowaniu | **wdrożyć** (T1) |
| **R-B** — token silnika w przeglądarce | `B2-WYKONALNE-Z-ZASTRZEŻENIEM`: samo wstrzyknięcie nagłówka nie przechodzi route-guarda SPA; działa sentinel w `localStorage` + podmiana nagłówka na Caddy, dowód z headless Chrome | **B2** — zmiana wcześniejszego wyboru B1 |
| **R-C** — krok DAG-a wobec sekretów i reguł | `IZOLACJA-POZORNA`: krok biegnie jako **root** w kontenerze silnika, czyta `config.yaml`, zdobywa materiał do podrobienia tokenu admina (P1); nadpisuje `base.yaml` i `dags/`, podkłada wykonywalny DAG (P3); ma **otwarty egress** do internetu (P2) | **ryzyko przyjęte + utwardzenie sieci** |

#### R-C: co dokładnie zostało przyjęte, a co domknięte

**Przyjęte świadomie.** W wersji Community Dagu **nie da się** doprowadzić do stanu „krok
nie tknie sekretu silnika". Pole `user:` na kroku nie istnieje, `env:` jest addytywne i nie
odcina dziedziczenia, jedyna natywna izolacja to executor kontenerowy — a ten wymaga socketu
Dockera, którego świadomie nie montujemy. Operator przyjmuje, że **agent jest faktycznie
administratorem swojej instancji Dagu.**

Model zagrożeń Fazy 1 jest wypowiedziany wprost: **napastnikiem jest model, który się myli,
nie model, który atakuje.** Prototyp jest jednoosobowy, wyłącznie na `127.0.0.1`, za sesją
z R-A. Przy takim modelu przyjęcie R-C jest proporcjonalne. Przy dwóch operatorach albo przy
wystawieniu poza pętlę lokalną **przestaje być** — i wtedy wraca decyzja o rozdzieleniu
instancji (piaskownica agenta + instancja wykonawcza z promocją definicji z Gita) albo
o innym silniku. To jest warunek brzegowy Fazy 2, zapisany, nie zapomniany.

**Domknięte mimo wszystko — dwie rzeczy, które kosztują prawie nic:**

1. **Egress kroku do internetu.** Dziś otwarty (`example.com → 200`), czyli gotowa droga
   eksfiltracji odczytanego sekretu. Sieć silnika dostaje `internal: true`.
2. **Ruch boczny po nazwie DNS.** Dziś krok dosięga każdą usługę w sieci compose (`peer:80 → 200`),
   czyli `n8n` i `chat-backend`. Sieci zostają rozdzielone.

```yaml
networks:
  wewnetrzna:          # bez wyjscia na zewnatrz
    internal: true
  wyjsciowa: {}        # tylko dla chat-backend, ktory wola API modelu

services:
  dagu:         { networks: [wewnetrzna] }
  n8n:          { networks: [wewnetrzna] }          # profil rollbacku
  proxy:        { networks: [wewnetrzna] }
  chat-backend: { networks: [wewnetrzna, wyjsciowa] }
```

Pozostaje nieosiągalne dla kroku i **to jest realna granica, potwierdzona pomiarem**:
usługi hosta na `127.0.0.1` (rootless Docker nie routuje bramy do loopbacku hosta) oraz host
przez socket Dockera (niemontowany).

#### R-B: B2 i jego cena

Przeglądarka trzyma **sentinel bez wartości**; prawdziwy JWT żyje wyłącznie w konfiguracji
Caddy. XSS w naszej aplikacji nie ma czego wykraść, a strumień SSE — który niesie token
w URL, więc w B1 wyciekałby do logów proxy, historii i referrera — niesie sentinel.

Cena, zapisana bez upiększania:

* **wylogowanie nie unieważnia serwerowo** — czyści tylko sentinel; rotacja = wymiana tokenu
  w konfiguracji Caddy;
* **proxy nadaje wszystkim jedną, wspólną tożsamość** — brak tożsamości per-osoba (Community
  i tak nie ma wielu kont, L1);
* **sesja z R-A staje się konieczna, nie opcjonalna** — skoro proxy samo dokłada tożsamość
  Dagu, każdy, kto dosięgnie originu, dostaje UI. Origin musi być chroniony sesją.

#### Klucz agenta: minimalna rola

Klucz, którym model rozmawia z Dagu, ma rolę **`developer`** i `allowedSurfaces: ["mcp"]`.
Zmierzone: `viewer` nie tworzy DAG-ów, `operator` dostaje `Insufficient permissions` na
`dagu_change`, `developer` wystarcza do `dagu_read` + `dagu_change` + `dagu_execute`.
Powierzchnia `mcp` odcina **całe** REST (403), więc klucz nie tknie kluczy API, użytkowników
ani pliku bazowego.

Zastrzeżenie, które trzeba wypowiedzieć: to zawęża **płaszczyznę sterowania**, nie płaszczyznę
danych. Wykonany krok i tak jest rootem (P1, P3). Zawężenie klucza jest warstwą, nie granicą.

Ograniczenie Community: **maksymalnie 2 klucze API**. Nie da się mieć naraz klucza admina
operatora, osobnego klucza agenta i zapasowego.

#### Operator w UI jest poza bramką — i tak ma być

Warstwa polityki (§4.1a) stoi na ścieżce **modelu**. Operator, który edytuje YAML w Monaco
albo klika Start w UI Dagu, **omija ją** — i to nie jest wada do naprawienia:

* bramka pilnuje **poprawności wobec pomyłek modelu**, a nie działań człowieka, który
  świadomie edytuje proces;
* odebranie operatorowi edycji w Monaco byłoby regresją wobec A1 (§7.2), gdzie zapisano
  wprost, że operator edytuje YAML w Monaco albo prosi czat;
* R-C i tak jest przyjęte, więc traktowanie bramki jako granicy bezpieczeństwa byłoby
  udawaniem.

**Warstwa polityki jest narzędziem poprawności danych, nie mechanizmem bezpieczeństwa.**
Tak ma być nazywana w raporcie odbiorczym i w `chat-backend/KONTRAKT.md`.

### Środki niezależne od powyższych

| Decyzja | Uzasadnienie | Status |
| --- | --- | --- |
| Socket Dockera **nie jest montowany** do Dagu | Krok zostaje w kontenerze, bez dostępu do hosta | ustalone |
| Publikacja wyłącznie na `127.0.0.1:8080` | Bez zmian wobec dzisiejszego stanu | ustalone |
| `X-Frame-Options: DENY` zdejmowany na proxy, podstawiane `frame-ancestors 'self'` | Dagu ma DENY zaszyte w kodzie i nie wystawia CSP (zweryfikowane osobno) | **wymaga jawnej akceptacji — L6** |

## 6. Mapa stary → nowy

| Warstwa | n8n dziś | Dagu po zmianie |
| --- | --- | --- |
| Silnik | `n8nio/n8n:2.38.7` | `ghcr.io/dagucloud/dagu@sha256:b242dc7b…` |
| Prefiks | `handle_path /n8n/*` (obcinanie — obejście błędu n8n) | `handle /dagu*`, **bez** obcinania; Dagu ma natywne `DAGU_BASE_PATH` |
| Nagłówki ramki | `N8N_CONTENT_SECURITY_POLICY` w konfiguracji silnika | `header_down` na Caddym, bo Dagu nie daje opcji |
| Sesja | ciasteczko `n8n-auth`, `SameSite=Lax` | JWT w ciele odpowiedzi; gdzie mieszka token — **otwarte**, wariant B1 albo B2 wg werdyktu R-B |
| Autorstwo definicji | 6 narzędzi MCP (z 35) | 3 narzędzia MCP: `dagu_read`, `dagu_change`, `dagu_execute`, **za warstwą polityki** (§4.1a) |
| Zatwierdzenia, webhooki, artefakty | węzły n8n | REST pod tym samym prefiksem i tokenem — cienki klient w backendzie |
| Deep-link | `/n8n/workflow/<id>` — jedno pole | **dwa pola**: proces `/dagu/dags/<nazwa>/status`, wykonanie `/dagu/dag-runs/<nazwa>/<dagRunId>` (§4.3) |
| Wolumen | `n8n_data:/home/node/.n8n` | całe `/var/lib/dagu` jednym wolumenem — inaczej logi giną przy recreate |

## 7. Utraty funkcji i ich status akceptacji

Pełna lista z klasyfikacją: `docs/audyt-dagu.md` §5. Tu każda utrata, która zmienia sposób
pracy albo postawę bezpieczeństwa, z **jawnym statusem**. Reguła: utrata bez zapisanej zgody
operatora nie jest przyjęta tylko dlatego, że stoi w dokumencie.

### 7.1 Warunek nadrzędny operatora

Zgoda udzielona 2026-09-18, cytat dosłowny:

> „Akceptuję L2, L4, L5 i L7 w zakresie wewnętrznego prototypu, z powyższymi warunkami.
> To zgoda na **ograniczenia technologii, nie na utratę istniejących funkcji lub danych**.
> Konwencje przepływu danych i rozgałęzień mają być **egzekwowane walidacją i testami,
> nie wyłącznie promptem ani pamięcią operatora**."

Z tego wynikają dwa wiążące warunki odbioru, ważniejsze niż pojedyncze pozycje niżej:

* **W-1.** Żadna pozycja z tej listy nie usprawiedliwia utraty funkcji ani danych, które
  dziś istnieją. Ograniczenie silnika i regresja to dwie różne rzeczy; dowodem rozróżnienia
  jest rejestr z §7a i scenariusze regresji z baseline'u.
* **W-2.** Kontrakt z §4.1 (K1–K6) i polityka identyfikatorów z §4.2 muszą mieć **walidację
  maszynową oraz testy**, w tym testy negatywne pokazujące, że naruszenie jest wykrywane.
  Prompt systemowy nie jest środkiem kontroli i nie może być przedstawiany jako spełnienie
  tego warunku.
* **W-3 (nowe w wersji 3).** **Ograniczenie technologii i regresja to dwie rozłączne
  kategorie i w odbiorze wolno ich używać tylko rozłącznie.**

  | Kategoria | Definicja | Przykład z tej migracji | Kto może zaakceptować |
  | --- | --- | --- | --- |
  | **Zaakceptowane ograniczenie** | Silnik nie umie czegoś, co umiał poprzedni, ale **rezultat pracy operatora, jego dane, historia i kontekst pozostają** | A1 — brak drag-and-drop: proces powstaje i działa tak samo, zmienia się sposób edycji | operator, wpisem w §7.2 |
  | **Regresja** | Znika **rezultat, dane, historia wykonań albo kontekst rozmowy**; albo to samo zadanie przestaje być wykonalne jakąkolwiek drogą | utrata wyniku wykonania, utrata trzech wersji pośrednich procesu Premie, zerwanie ciągłości wątku czatu, brak możliwości poprawienia istniejącego procesu przez czat | **nikt** — regresja jest wadą do naprawienia |

  Zgoda na A1 nie jest zgodą na to, żeby operator stracił proces, wynik albo historię.
  Zgoda na A2 (tekst zamiast typów) nie jest zgodą na to, żeby pole po cichu zniknęło
  z wyniku. Każda pozycja w raporcie odbiorczym T5 dostaje **jedną** z czterech etykiet:
  `zachowane` / `zaakceptowany zamiennik` / `regresja` / `niezweryfikowane` — a etykieta
  `zaakceptowany zamiennik` wymaga wskazania pozycji z §7.2, która ją pokrywa.

### 7.2 Utraty zaakceptowane wprost

| # | Utrata | Decyzja operatora |
| --- | --- | --- |
| A1 | **Brak edytora drag-and-drop.** Graf jest do oglądania; operator edytuje YAML w Monaco albo prosi czat. Prawdziwa utrata funkcji wobec n8n. | zaakceptowane 2026-09-18 |
| A2 | **Brak typowanego przepływu danych** między krokami; tekst zamiast `$json.pole`. | zaakceptowane 2026-09-18 |
| L1 | **Community: jeden uzytkownik, max 2 klucze API, brak SSO, RBAC i audit logow** (HTTP 403) | zaakceptowane **dla prototypu z jednym operatorem**. To ograniczenie **edycji produktu**, nie licencji — patrz §8. Przed Fazą 2 wymagana osobna decyzja, i ma ona **więcej niż dwie opcje**: (a) zostać przy jednym operatorze, (b) postawić uwierzytelnianie i role we własnej warstwie przed Dagu, (c) Dagu Pro, (d) inny silnik. Wersja 2 pisała „Pro albo rezygnacja” — to był fałszywy wybór dwuczłonowy. |
| L2 | **Licencja GPL-3.0-or-later**; osobnej umowy wymaga wyłącznie **komercyjne osadzanie embedded Go API** | zaakceptowane. Nasz scenariusz nie dotyka tego zastrzeżenia — patrz §8, gdzie rozdzielone są trzy różne rzeczy, które wersja 2 zlewała w jedno. |
| L3 | **Brak automatycznego wznowienia przerwanego wykonania.** Zombie detector oznacza run jako `failed` po ~45–90 s; `retry` wznawia od miejsca awarii, ten sam run-ID, bez powtarzania ukończonych kroków | **ręczny retry**, bez watchdoga w Fazie 1. Semantyka ma zostać zmierzona, opisana i pokryta scenariuszem regresji — nie wystarczy ją zadeklarować. |
| L4 | **Katalog ~56 akcji** zamiast 1000+ węzłów n8n | zaakceptowane. Integracje spoza katalogu piszemy jako własne kroki. |
| L5 | **Limit `max_output_size` 1 MiB na krok** | zaakceptowane. Duże dane przez artefakty i pliki, nie przez zmienne. |
| L6 | **Zdjęcie `X-Frame-Options: DENY` na proxy**, podstawienie `frame-ancestors 'self'` | zaakceptowane. Zawężenie do jednego originu, nie globalne wyłączenie. |
| L7 | **Ograniczenia składniowe:** fan-in czyta tylko `output:`, ignoruje `outputs:`; gałęzie warunkowe wymagają `continue_on: skipped` | zaakceptowane **pod warunkiem W-2** — egzekwowane walidacją i testami, nie pamięcią operatora. |

## 7a. Rozliczenie istniejącej wiedzy

Zachowanie wolumenu nie jest rozliczeniem. Rejestr `docs/rejestr-workflow.md` rozliczył
**15 workflow i 12 wykonań do zera**: 4 DO-ODTWORZENIA, 2 ARTEFAKT-HISTORYCZNY, 9 ZBĘDNY,
0 nierozstrzygniętych — plus obiekty inne niż workflow (konto właściciela, klucz szyfrowania,
klucze API instancji, poświadczenia, tagi, zmienne, historia wykonań).

**Klasyfikacja „ZBĘDNY" nie jest zgodą na skasowanie.** Wszystkie 15 obiektów zostaje
fizycznie w wolumenie `n8niframe_n8n_data` (§11). Rejestr mówi, czego **nie przepisujemy**,
a nie co wolno usunąć.

**Jedno ustalenie rejestru ma rangę wymagania, nie ciekawostki** (§1.1): trzy wersje pośrednie
procesu `Premie 8% od pensji` istnieją **wyłącznie** w migawkach `execution_data.workflowData`.
Tabela `workflow_history` trzyma tylko stan bieżący. Skasowanie historii wykonań kasuje więc
historię edycji przez czat — jedyny w tym wolumenie dowód, że model **poprawiał istniejący
proces**, a nie tworzył nowy. Te cztery wersje muszą wyjść do `fixtures/` (T4, wymaganie P4).
## 8. Licencja

Wersja 2 zlewała w jedno trzy rzeczy, które są od siebie niezależne. Rozdzielam je, bo ocena
gotowości słusznie wytknęła, że sformułowania były za szerokie. **To zadanie niczego
w licencjonowaniu nie zmienia i nie proponuje zmiany** — porządkuje wyłącznie opis stanu.

| # | Rzecz | Co faktycznie mówi przypięta wersja | Co z tego wynika dla nas |
| --- | --- | --- | --- |
| 1 | **Prawa do kodu** | GPL-3.0-or-later; tekst `LICENSE` to wierny GNU GPL v3 bez wyjątków, 1719 plików `.go` z nagłówkiem SPDX (audyt §7) | Pełne prawa do używania, modyfikowania i redystrybucji **na warunkach GPL**, także komercyjnie. GPL nie zabrania użytku komercyjnego i nie wymaga opłat. |
| 2 | **Embedded Go API** | `LICENSING.md` v2.16.6: pakiet `github.com/dagucloud/dagu/v2` jest eksperymentalny; kto go **importuje i dystrybuuje binarkę**, musi ocenić obowiązki GPL dla dzieła połączonego, a „commercial embedding rights are not granted by this repository" | **Nas nie dotyczy.** Nie importujemy pakietu i nie dystrybuujemy binarki. `LICENSING.md` sam odróżnia to od używania CLI/serwera jako osobnego programu. |
| 3 | **Edycja produktu (Community vs Pro)** | HTTP 403 „requires a Dagu Pro license" na zarządzaniu użytkownikami, audit logach i trzecim kluczu API (audyt [D35]) | Sprawa **handlowa i funkcjonalna, nie prawna**. Nie ogranicza praw z punktu 1. Konsekwencje dla skalowania na zespół — L1. |

**Nasz scenariusz:** Dagu jako osobny kontener, konsumowany przez iframe i HTTP/MCP, użycie
wewnętrzne, bez dystrybucji, bez linkowania. Punkt 1 spełniony, punkt 2 nie dotyczy, punkt 3
zaakceptowany dla prototypu.

**Czego NIE twierdzę, wbrew wersji 2:** że „każde komercyjne osadzanie wymaga osobnej umowy"
(zastrzeżenie dotyczy wyłącznie embedded Go API) ani że sprzedaż z produktem jest sama w sobie
zakazana (GPL dopuszcza dystrybucję za opłatą; problemem byłoby dopiero dzieło połączone
dystrybuowane na warunkach niezgodnych z GPL). Iframe nie zmienia nic prawnie — granicą GPL
jest dystrybucja dzieła połączonego, nie sposób renderowania.

**To nie jest opinia prawna.** Gdyby kiedykolwiek pojawiła się dystrybucja albo osadzanie,
decyzję podejmuje prawnik, nie ten dokument.

## 9. Naprawy błędów zastanych

Decyzją operatora Faza 1 naprawia dwa błędy wykryte w baseline, oba w komponentach, które
migracja zachowuje. Obie naprawy są **jawnymi różnicami wobec dzisiejszego zachowania**,
nie cichymi zmianami:

1. **Bind-mount poświadczeń.** `docker-compose.yml:64` montuje pojedynczy plik, co przypina
   i-węzeł; gdy host atomowo podmienia plik przy odświeżeniu tokenu, kontener zostaje przy
   starym. Zweryfikowane dwukrotnie. Naprawa: montowanie katalogu zamiast pliku. To obala
   zdanie z README, że kopiowanie przed każdym żądaniem wystarcza — README też się poprawia.
2. **Brak uwierzytelniania `/api/chat`.** Patrz §5.

## 10. Przypadek odbiorczy Fazy 1

Decyzja operatora: wieloetapowy DAG na realnym, wersjonowanym zbiorze wejściowym (fixture
w repozytorium), nie na danych wymyślanych w locie. Wypełnia go **`premie-od-pensji`** —
jedyny z 15 procesów, który spełnia wszystkie wymagania naraz (rejestr §2).

Wymagania, wszystkie muszą być spełnione naraz:

* co najmniej **3 zależne kroki**, gdzie wynik kroku jest wejściem następnego;
* co najmniej jedno **rozgałęzienie warunkowe** zależne od zawartości danych;
* **fan-in** zbierający wyniki gałęzi w jeden wynik końcowy;
* **żaden krok nie woła LLM** — ten sam wejściowy fixture daje ten sam wynik;
* proces powstaje **przez czat**, przez MCP, nie jest wklejony ręcznie;
* operator widzi w ramce graf, kroki, wejścia i wynik.

### 10.1 Dwa osobne sprawdzenia, nie jedno

Rejestr §4.4 wykazał, że w n8n warunek na stawkę podatku jest **wyrażeniem wewnątrz jednego
węzła** — graf jest liniowy, silnik nie widzi żadnej gałęzi. Odtworzenie go jako widocznego
rozgałęzienia **nie jest kopią 1:1, tylko przeprojektowaniem**. Dlatego rozdzielamy:

| | Wariant A — wierność | Wariant B — przypadek odbiorczy |
| --- | --- | --- |
| Warunek | zostaje wewnątrz `jq` (`if .pensjaZPremia > 10000 then 0.32 else 0.12 end`) | wyniesiony do `preconditions`, dwie gałęzie, `continue_on: skipped` na obu, fan-in |
| Graf | liniowy, jak w n8n | rozgałęziony, **inny niż w n8n** |
| Czego dowodzi | że **zachowanie i liczby** są te same co w n8n | że silnik i nasz kontrakt obsługują rozgałęzienie i fan-in |
| Sprawdzenie | porównanie z `fixtures/premie-od-pensji/oczekiwane-wyjscie.json` co do wartości, typów, precyzji i kolejności | wymagania §10 wyżej, w tym widok w ramce |

**Oba muszą przejść.** Wariant B bez wariantu A nie dowodzi braku regresji — dowodzi tylko,
że nowy graf się wykonuje. Wariant A bez wariantu B nie spełnia §10. Przedstawienie samego
wariantu B jako „odtworzenia procesu" byłoby dokładnie tym, czego W-3 zakazuje.

Kształt przypadku celowo naśladuje transformację produktową (normalizacja → rozgałęzienie po
rodzaju → wyprowadzenie wartości → agregacja podproduktów), żeby Faza 1 sprawdziła dokładnie
te właściwości Dagu, których Faza 2 będzie potrzebować — bez dotykania Dużych Produktów.

## 11. Rollback

Stary silnik zostaje do wycofania, ale **nie jest wymagany na nowej ścieżce**.

**Podstawa wycofania — decyzja operatora 2026-09-18: katalog prototypu jest od teraz
repozytorium Git.** Wersja 2 obiecywała wycofanie „z oznaczonego commitu", którego nie było —
`git status` zwracał „not a git repository". Teraz jest:

| Element | Wartość |
| --- | --- |
| Gałąź bazowa | `main` |
| Punkt wycofania | commit `931e6b3`, tag **`stan-zastany-n8n`** — działający prototyp na n8n 2.38.7, przed jakąkolwiek zmianą silnika |
| Gałąź pracy Fazy 1 | `faza-1-dagu` |
| Poza repozytorium świadomie | `.env` (token MCP), poświadczenia Claude Code, migawki bazy SQLite n8n, katalogi robocze silników |
| W repozytorium świadomie | `dags/` ze skryptami i kontraktami — bo `dagu_change upsert_dag` nadpisuje cały plik i bez Gita historia pracy agenta nie ma gdzie mieszkać (rejestr §4.4 pkt 5) |

Znany fakt, odnotowany w commicie bazowym: `docs/baseline-prototypu.md` i `docker-compose.yml`
zawierają **lokalne hasło demonstracyjne** konta n8n — jawnie i jako hash bcrypt. To konto
prototypu na `127.0.0.1`, nie sekret produkcyjny; wpis jest tu po to, żeby nikt nie odkrył
tego później jako niespodzianki.

**Procedura wycofania:**

* Usługa `n8n` zostaje w `docker-compose.yml` za profilem Compose, domyślnie nie wstaje.
* Wolumen `n8niframe_n8n_data` zostaje nietknięty, z 15 procesami i 12 wykonaniami.
* Wycofanie: `git switch main` (albo `git checkout stan-zastany-n8n`), przebudowanie obrazów,
  uruchomienie profilu `n8n`. Żadnego ręcznego odtwarzania plików.
* Skrypt wycofania i procedura krok po kroku są produktem implementacji (T1), nie tego
  dokumentu, i **muszą być sprawdzone na kopii** — procedura nieprzećwiczona nie jest procedurą.
* Zakazane na każdym etapie: `docker compose down -v`, `docker volume rm`, `docker system prune`.

## 12. Czego ta decyzja nie rozstrzyga

* Trybu rozproszonego Dagu (coordinator + worker) — nie badany.
* Zachowania przy dużych partiach i przekroczeniu `max_output_size` (1 MiB/krok) — nie badane.
* Skuteczności izolacji przez `container.run` — nie badana, bo socket Dockera nie był montowany.
* Czy Dagu jest właściwym wyborem dla wieloosobowej aplikacji firmowej — patrz §7 pkt 4.
* Czegokolwiek dotyczącego Dużych Produktów v2.

## 13. Macierz wymaganie → zadanie → test

Jedna tabela, w której każde wymagane zachowanie ma **właściciela** i **sprawdzenie**.
Pozycja bez sprawdzenia nie jest wymaganiem, tylko życzeniem. Kolumna „test" nazywa dowód,
nie intencję. `R01`–`R18` to scenariusze regresji z `docs/baseline-prototypu.md`.

### 13.1 Kontrakt danych (§4.1)

| # | Wymaganie | Zadanie | Test / dowód |
| --- | --- | --- | --- |
| K1 | Krok publikujący wynik wypisuje na stdout jeden dokument JSON, logi na stderr | T2 polityka, T4 migracja | Pozytyw: DAG przechodzi. Negatyw: linia logu przed JSON-em → `failed to decode stdout JSON`. |
| K2+K3 | `output:` i obiektowy `output_schema` na każdym kroku publikującym wynik | T2 | Negatyw: DAG bez `output_schema` na kroku publikującym → **odmowa zapisu** przez politykę. |
| K3 | Schemat nie może być pusty ani osłabiony | T2 | Negatyw ×4: `output_schema: {}`, brak `required`, brak `additionalProperties: false`, typ `string` zamiast `number` → odmowa. |
| K4 | Odbiorca czyta `"$NAZWA"` i parsuje `jq` | T2, T4 | Pozytyw z wartością zawierającą apostrof, cudzysłów, `$(id)` i backtick — wynik dosłowny, nic nie wykonane. |
| K5 | Zakaz drugiego kanału | T2 | Negatyw ×3: zapis do `$DAGU_OUTPUT_FILE`, deklaracja `outputs:`, odwołanie `${steps.*.outputs.*}` → odmowa. |
| K6 | Duże wyniki artefaktem + manifest | T4 | Test przekroczenia praktycznego sufitu stdout: dane **nie są obcięte**, manifest się zgadza, odbiorca waliduje zawartość osobno. |
| — | Naruszenie schematu naprawdę czerwieni | T5 | Wynik niezgodny → krok `failed`, zależny `aborted`, DAG `failed`; sprawdzone też w sub-DAG-u i z `retry_policy`. |
| — | `mark_success` nie maskuje naruszenia | T2, T5 | Negatyw: `continue_on: {failure: true, mark_success: true}` na kroku ze schematem → odmowa zapisu. |
| — | `continue_on: skipped` na gałęzi warunkowej **wolno** | T2, T5 | Pozytyw: DAG z rozgałęzieniem i fan-in przechodzi politykę i wykonuje się. |
| — | Cykl w grafie | T2 | Negatyw: `a→b→a` przechodzi lint silnika, ma zostać odrzucony przez politykę. |
| — | `defaults:`, akcje własne i sub-DAG-i objęte polityką | T2 | Negatyw: naruszenie ukryte w `defaults:` oraz w definicji sub-DAG-a → odmowa. |

### 13.2 Identyfikatory (§4.2)

| # | Wymaganie | Zadanie | Test / dowód |
| --- | --- | --- | --- |
| I1 | Identyfikator spełnia `^[a-z0-9][a-z0-9-]{0,38}$` | T2, T3 | Negatyw: spacja, kropka, wielka litera, diakrytyk, 40 znaków, wiodący `-` → odmowa. |
| I2 | Nazwa polska jest zachowana i widoczna | T3, T4 | Cztery odtworzone procesy mają nazwy wyświetlane z diakrytykami; UI je pokazuje. |
| I3 | Transliteracja deterministyczna, kolizje rozstrzygane po naszej stronie | T2 | `Średnia temperatura z trzech miast` → `srednia-temperatura-z-trzech-miast`; druga taka nazwa → sufiks `-2`. |
| I4 | Segment URL kodowany, deep-link działa | T3 | R04 na odtworzonym procesie; zmiana nazwy → stary deep-link jawnie nieaktualny (różnica, nie awaria). |

### 13.3 Bezpieczeństwo (§5) — testy zależne od werdyktu badania

| # | Wymaganie | Zadanie | Test / dowód |
| --- | --- | --- | --- |
| S1 | `/api/chat` odmawia bez sesji | T1 | `POST /api/chat` bez sesji → 401; z sesją → 200; po wylogowaniu → 401. |
| S2 | Kontrola Origin/CSRF | T1 | Żądanie z obcym `Origin` → odrzucone. |
| S3 | Sesja rozmowy związana z operatorem | T1, T3 | Druga sesja nie widzi `sessionId` pierwszej. |
| S4 | Krok DAG-a nie sięga sekretów backendu ani materiału do podrobienia tokenu | T1 | Krok testowy próbuje odczytu → wynik zgodny z werdyktem R-C; **bez drukowania wartości**. |
| S5 | Token silnika zgodnie z werdyktem B1/B2 | T1, T3 | Ramka działa po jednym logowaniu; jeśli B2 — token nieosiągalny dla kodu strony. |
| S6 | Bramka polityki nieobchodzalna w chronionym zakresie | T2 | Próba obejścia przez MCP, REST, UI i zapis pliku → każda albo zablokowana, albo wykryta przy uruchomieniu. |
| S7 | Podmiana definicji między walidacją a startem niemożliwa | T2 | Start/retry/trigger wykonuje **zwalidowaną** wersję — test z podmianą pliku w oknie czasowym. |

### 13.4 Parity i dane (§7, §7a)

| # | Wymaganie | Zadanie | Test / dowód |
| --- | --- | --- | --- |
| P1 | 18 scenariuszy baseline odtworzonych, każdy z etykietą wg W-3 | T5 | Raport z czterema etykietami; `zaakceptowany zamiennik` wskazuje pozycję z §7.2. |
| P2 | Cztery procesy odtworzone, wynik zgodny co do wartości, typów, precyzji i kolejności | T4 | Porównanie z `fixtures/<proces>/oczekiwane-wyjscie.json`; różnice wyjaśnione albo zerowe. |
| P3 | Premie: zachowanie 1:1 **i** osobno nowy graf | T4, T5 | Wariant A porównany z fixture co do liczb; wariant B oceniony jako przypadek odbiorczy §10. Dwa osobne wyniki, nie jeden. |
| P4 | Trzy wersje pośrednie Premii zachowane | T4 | `fixtures/premie-od-pensji/wersje/` — cztery pliki, każdy z listą swoich wykonań. |
| P5 | 15 obiektów rozliczonych i fizycznie zachowanych | T4, T5 | Rejestr + `fixtures/README.md`; wolumen `n8niframe_n8n_data` istnieje po odbiorze. |
| P6 | Historia pracy agenta przeżywa nadpisanie definicji | T4 | Kolejne `upsert_dag` tego samego procesu dają kolejne commity na `faza-1-dagu`. |
| P7 | Nowe wykonania nie potrzebują n8n | T5 | Profil `n8n` wyłączony, pełne E2E przechodzi. |

### 13.5 Integracja i odbiór (§10, §11)

| # | Wymaganie | Zadanie | Test / dowód |
| --- | --- | --- | --- |
| E1 | Czat → autorstwo → wykonanie → odczyt → widoczny wynik, w przeglądarce | T3, T5 | E2E na żywej aplikacji, nie ręcznym YAML-em i nie samym API. |
| E2 | Poprawka **istniejącego** procesu przez czat, w tej samej rozmowie | T3, T5 | Druga tura rozmowy zmienia proces; `sessionId` zachowany. |
| E3 | Ramka pokazuje właściwy proces i właściwe wykonanie | T3 | Po utworzeniu — proces; po uruchomieniu — wykonanie; po ręcznej nawigacji w ramce czat zna **faktycznie otwarty** kontekst. |
| E4 | `onLoad` ramki nie jest dowodem gotowości | T3, T5 | Dowodem jest odczytany element UI Dagu, nie zdarzenie ładowania. |
| E5 | Restart w trakcie pracy i ręczny retry | T5 | Kroki `completed` nie dublują skutków; krok `failed` ma opisaną idempotencję. Bez watchdoga. |
| E6 | Timeout, anulowanie, błąd modelu, brak procesu, wylogowanie | T5 | Każdy przypadek daje operatorowi widoczny, zrozumiały komunikat. |
| E7 | Przełączenie i wycofanie na kopii | T5 | `git switch main` + profil `n8n` przywraca działanie; dane obu silników nienaruszone. |
| E8 | Sukces czytany z silnika po `dagRunId` | T2, T3 | Test: model pisze „gotowe" przy czerwonym przebiegu → aplikacja pokazuje błąd. |
