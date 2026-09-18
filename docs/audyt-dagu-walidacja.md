# Egzekwowalna walidacja kontraktu danych w Dagu v2.16.6

Data: 2026-09-18. Zadanie weryfikacyjne, wąskie: **czy Dagu sam egzekwuje kontrakt danych
na granicy kroku, czy musimy dobudować własną warstwę.**

Stanowisko: osobny projekt compose `dagu-schema`, port `127.0.0.1:9201`, katalog tymczasowy
poza repozytoriami. Obraz przypięty po digeście:
`ghcr.io/dagucloud/dagu@sha256:b242dc7b605aa20d6db78ba192beb82135d390025a7d9c8dfd7f08e14464c69f`
(`dagu version` → `2.16.6`). Stack skasowany po badaniu. Stack n8n (`n8niframe`, port 8080)
nietknięty.

---

## 0. Wniosek

# `NATYWNE-CZESCIOWO`

`output_schema` **istnieje, działa i świeci na czerwono** — krok z wynikiem niezgodnym ze
schematem dostaje status `failed`, DAG dostaje `failed`, kroki zależne `aborted`, a komunikat
jest widoczny w UI, w REST API i w MCP. To jest realny, egzekwowalny mechanizm i audyt
[D-audyt §7.3] niesłusznie zostawił go jako niesprawdzony.

Ale **nie pokrywa kontraktu, który przyjęła decyzja architektoniczna §4.1.** Trzy dziury,
każda potwierdzona wykonaniem:

1. **`output_schema` waliduje wyłącznie `stdout` kroku.** Kanał `DAGU_OUTPUT_FILE` /
   `outputs:` — czyli dokładnie ten, którym Dagu przekazuje `KLUCZ=wartość` do następnego
   kroku — **nie jest walidowany w ogóle**. Krok może wypisać na stdout ładny JSON zgodny
   ze schematem i jednocześnie wepchnąć do `DAGU_OUTPUT_FILE` kompletnie inny, niezgodny
   dokument; DAG kończy się na zielono, a odbiorca dostaje śmieci (§2.3).
2. **`output_schema` jest opcjonalne per krok i nie da się go narzucić globalnie.**
   Blok `defaults:` nie zna pola `output_schema` (§3.4). Nic nie zmusza agenta, żeby je dopisał.
3. **Jedna linijka `continue_on: {failure: true, mark_success: true}` kasuje walidację**
   i zamienia czerwony przebieg w zielony (§2.6). Linijkę tę pisze ten sam agent, który
   pisze schemat.

Do tego dochodzi odpowiedź na pytanie o nazwy: **nazwa DAG-a spoza `^[A-Za-z0-9_-]{1,64}$`
przechodzi przez MCP** — Dagu dopuszcza **kropkę** (§4). `dagu_change` przyjął i zapisał
DAG o nazwie `order.v3`. Nasze ograniczenie nazw trzeba egzekwować po naszej stronie.

**Co z tego wynika dla architektury (bez projektowania rozwiązania):** `output_schema` warto
włączyć do szablonu DAG-a jako element konwencji, bo jako jedyny daje twardy, czerwony
sygnał na granicy kroku. Ale jest to **kontrakt opt-in wewnątrz pliku pisanego przez model** —
ten sam model, który ma być pilnowany, może go pominąć, obejść drugim kanałem albo wyłączyć.
Jeżeli walidacja ma być kontraktem, a nie prośbą, silnik jej nie zapewni sam.

---

## 1. Dokładna, poprawna składnia `output_schema`

Pole jest **step-level**. Schemat konfiguracji przypiętej wersji
(`docker run --rm --entrypoint dagu <obraz> schema dag`, linie 8043–8047):

```json
"output_schema": {
  "additionalProperties": true,
  "description": "Inline JSON Schema object used to validate stdout JSON before publishing step output.",
  "type": "object"
}
```

Twarde reguły, wszystkie potwierdzone wykonaniem:

| Reguła | Dowód |
| --- | --- |
| Wartością musi być **inline JSON Schema typu obiektowego**. `type: array` i `type: string` są odrzucane przy ładowaniu DAG-a | §2.5 |
| Pominięcie `type` jest dozwolone (walidują się wtedy same `required`/`properties`) | §2.5 |
| Waliduje **cały stdout kroku**, sparsowany jako jeden dokument JSON | §2.4 |
| stdout musi być **czystym JSON-em** — jedna linia logu przed JSON-em wywala krok | §2.4 |
| Dwa dokumenty JSON pod rząd na stdout → błąd dekodowania | §2.4 |
| JSON „pretty" (wielolinijkowy) jest OK | §2.4 |
| Pusty stdout → błąd `output_schema requires stdout to contain a JSON value matching the schema` | §2.4 |
| Niedozwolone na `action: human.task` (schemat DAG-a, linie 6423–6470) | schemat |
| Dostępne także w `actions.<nazwa>.output_schema` (akcje własne) i w przestarzałym `step_types.<nazwa>.output_schema` | §3.5 |

Minimalny poprawny szablon (ten, który przeszedł pozytywnie):

```yaml
name: schema-pos
steps:
  - id: produce
    run: echo '{"order_id":"A-1","total":184.46}'
    output: RESULT
    output_schema:
      type: object
      additionalProperties: false
      required: [order_id, total]
      properties:
        order_id: {type: string}
        total: {type: number}
  - id: consume
    depends: [produce]
    run: echo "consumed=$(echo "$RESULT" | jq -r .order_id)"
```

Uwaga do tego szablonu: **`output: RESULT` (płaskie przechwycenie stdout) jest jedyną
kombinacją, w której walidowana wartość i wartość opublikowana to ta sama rzecz.**
Przy `outputs:` + `DAGU_OUTPUT_FILE` walidacja i publikacja to dwa rozłączne kanały (§2.3).

---

## 2. Przebiegi

### 2.1 Pozytywny — realny output

```
$ docker exec dagu-schema dagu start schema-pos

time=2026-09-18T14:23:26.851Z level=INFO msg="Executing root dag-run" dag=schema-pos run-id=034QzwK05JUKySrjOqmxNb params=""
time=2026-09-18T14:23:26.854Z level=INFO msg="DAG run started" dag=schema-pos run-id=034QzwK05JUKySrjOqmxNb worker-id=local attempt-id=44ce12 params=[]
time=2026-09-18T14:23:26.854Z level=INFO msg="Step started" dag=schema-pos ... step=produce
time=2026-09-18T14:23:26.855Z level=INFO msg="Step started" dag=schema-pos ... step=consume
time=2026-09-18T14:23:26.900Z level=INFO msg="DAG run finished" dag=schema-pos ... status=succeeded
Succeeded - 2026-09-18T14:23:26Z

dag: schema-pos (0s)
├─produce (0s) [succeeded]
│ ├─echo '{"order_id":"A-1","total":184.46}'
│ └─stdout: .../produce.20260918.142326.854.034QzwK0.out
│     {"order_id":"A-1","total":184.46}
│
└─consume (0s) [succeeded]
  ├─echo "consumed=$(echo "$RESULT" | jq -r .order_id)"
  └─stdout: .../consume.20260918.142326.855.034QzwK0.out
      consumed=A-1

Result: Succeeded
```

### 2.2 Negatywny — realny output

Ten sam schemat, wynik niezgodny: `total` jako string zamiast liczby + nadmiarowe pole `junk`
przy `additionalProperties: false`.

```
$ docker exec dagu-schema dagu start schema-neg

time=2026-09-18T14:23:26.979Z level=INFO msg="DAG run finished" dag=schema-neg run-id=034QzwKCAd6D1sD2PeqRM8 ... status=failed
time=2026-09-18T14:23:26.980Z level=ERROR msg="Failed to execute dag-run" dag=schema-neg run-id=034QzwKCAd6D1sD2PeqRM8 err="failed to validate output_schema: stdout JSON does not match output_schema"
Failed - 2026-09-18T14:23:26Z

dag: schema-neg (0s)
├─produce (0s) [failed]
│ ├─echo '{"order_id":"A-1","total":"184.46","junk":true}'
│ ├─stdout: .../produce.20260918.142326.977.034QzwKC.out
│ │   {"order_id":"A-1","total":"184.46","junk":true}
│ └─error: failed to validate output_schema: stdout JSON does not match
│     output_schema
│
└─consume [aborted]

Result: Failed

Error: failed to execute the dag-run schema-neg (dag-run ID: 034QzwKCAd6D1sD2PeqRM8): failed to validate output_schema: stdout JSON does not match output_schema
```

**Co dokładnie robi Dagu przy naruszeniu schematu:**

* krok → status `failed` (nie „warning", nie „log"),
* kroki zależne → status `aborted` z `error: "upstream failed"`,
* cały DAG-run → status `failed`, kod wyjścia CLI ≠ 0,
* `retry_policy` **próbuje ponownie** (`retry=0`, `retry=1`, potem `failed`) — walidacja
  jest traktowana jak zwykły błąd kroku, nie jak błąd definicji,
* naruszenie w sub-DAG-u **propaguje się do rodzica**:
  `parallel execution failed with 2 errors: sub DAG … failed: failed to validate output_schema…`.

**Widoczność w API** — `GET /dagu/api/v1/dag-runs/schema-neg/034QzUVXDn6H13bUR95AWy`:

```json
"nodes": [
  { "error": "failed to validate output_schema: stdout JSON does not match output_schema",
    "status": 2, "statusLabel": "failed",
    "step": { "id": "produce", "name": "produce", "output": "RESULT" } },
  { "error": "upstream failed", "status": 3, "statusLabel": "aborted",
    "step": { "id": "consume", "depends": ["produce"] } }
]
```

**Widoczność w MCP** (`dagu_read` `target=run` — to widzi agent):

```json
{"dagRunId":"034QzsOSo8AMN3QFmiuaKK","name":"mcp-schema-neg","status":2,"statusLabel":"failed",
 "steps":[{"id":"produce","status":2,"statusLabel":"failed",
           "error":"failed to validate output_schema: stdout JSON does not match output_schema"},
          {"id":"consume","status":3,"statusLabel":"aborted","error":"upstream failed"}]}
```

Powyższy przebieg `mcp-schema-neg` został **w całości przeprowadzony przez MCP**:
`dagu_change type=upsert_dag mode=apply` (`valid: true, applied: true`) →
`dagu_execute action=start` → `dagu_read target=run`. `output_schema` przechodzi przez
walidację autorską MCP bez zastrzeżeń i zapisuje się do YAML-a 1:1 (`dagu_read target=dag_spec`
zwraca blok `output_schema:` dosłownie).

**Widoczność w UI** — headless Chrome (CDP), strona
`/dagu/dag-runs/schema-neg/034QzUVXDn6H13bUR95AWy`. Czerwony baner na górze strony, czerwony
węzeł `produce` na grafie, czerwony wpis w tabeli kroków:

```
Failed at produce
failed to validate output_schema: stdout JSON does not match output_schema
View stderr   Inspect step
…
No  Step Name  Execution                                        Status    Error / Logs
1   produce    echo {"order_id":"A-1","total":"184.46","junk":…  failed    failed to validate output_schema: stdout JSON does not match output_schema
2   consume    echo consumed=$(echo "$RESULT" | jq -r .order_id) aborted   upstream failed
```

Komunikat jest **jednozdaniowy i bez szczegółu pola** — Dagu nie mówi, które pole zawiodło
ani dlaczego. Przy schemacie z pięcioma polami operator dostaje tylko „nie pasuje".

### 2.3 Dziura #1 — `output_schema` nie widzi `DAGU_OUTPUT_FILE`

To jest najważniejsze ustalenie tego badania, bo trafia dokładnie w konwencję z §4.1
decyzji architektonicznej.

```yaml
name: t-bypass
steps:
  - id: produce
    run: |
      printf 'RESULT={"order_id":123,"total":"junk","extra":"sneaked"}\n' >> "$DAGU_OUTPUT_FILE"
      echo '{"order_id":"A-1","total":1.5}'
    outputs:
      - {name: RESULT, type: json}
    output_schema: {type: object, additionalProperties: false, required: [order_id, total],
                    properties: {order_id: {type: string}, total: {type: number}}}
  - id: consume
    depends: [produce]
    run: echo "downstream got ${steps.produce.outputs.RESULT}"
```

```
$ docker exec dagu-schema dagu start t-bypass

time=2026-09-18T14:23:31.412Z level=INFO msg="DAG run finished" dag=t-bypass run-id=034QzwR60nqFWhpoofSDtM ... status=succeeded
Succeeded - 2026-09-18T14:23:31Z

├─produce (0s) [succeeded]
│ └─stdout: .../produce.20260918.142331.367.034QzwR6.out
│     {"order_id":"A-1","total":1.5}          ← to Dagu zwalidowal
│
└─consume (0s) [succeeded]
  ├─echo "downstream got {"order_id":123,"total":"junk","extra":"sneaked"}"
  └─stdout: .../consume.20260918.142331.409.034QzwR6.out
      downstream got {order_id:123,total:junk,extra:sneaked}   ← to dostal odbiorca

Result: Succeeded
```

`order_id` jako liczba zamiast stringa, `total` jako string zamiast liczby, nadmiarowe pole
`extra` mimo `additionalProperties: false` — **wszystko przeszło granicę kroku, DAG zielony.**

Odwrotny wariant też jest opisany: krok, który pisze wynik **wyłącznie** do
`DAGU_OUTPUT_FILE` i nic nie wypisuje na stdout, **nie przechodzi** walidacji — ale
z powodu pustego stdout, a nie z powodu treści wyniku:

```
$ docker exec dagu-schema dagu start t-outfile
err="failed to validate output_schema: output_schema requires stdout to contain a JSON value matching the schema"
Result: Failed
```

Czyli: dla kroku publikującego przez `outputs:` `output_schema` jest albo ślepe (gdy stdout
zawiera cokolwiek innego i poprawnego), albo bezużytecznie hałaśliwe (gdy stdout jest pusty).
Sensowna jest **tylko** kombinacja `output: NAZWA` + `output_schema`.

### 2.4 Co dokładnie łapie, a czego nie łapie walidator

Wszystkie wiersze — realny przebieg na przypiętej wersji.

| Wejście na stdout | Schemat | Wynik |
| --- | --- | --- |
| `{"order_id":"A-1","total":184.46}` | `required [order_id,total]`, typy zgodne | `succeeded` |
| `{"order_id":"A-1"}` | brak wymaganego `total` | `failed: stdout JSON does not match output_schema` |
| `{"order_id":"A-1","total":1.5,"junk":true}` | `additionalProperties: false` | `failed: stdout JSON does not match output_schema` |
| `{"order":{"id":"A-1","lines":[{"sku":"X","qty":"DWA"}]}}` | zagnieżdżony `qty: integer` | `failed` — **walidacja zagnieżdżona działa** |
| `this is not json at all` | dowolny | `failed: failed to decode stdout JSON for output_schema: invalid character 'h' in literal true (expecting 'r')` |
| pusty stdout (`run: "true"`) | dowolny | `failed: output_schema requires stdout to contain a JSON value matching the schema` |
| `INFO starting work` + linia z JSON-em | dowolny | `failed: failed to decode stdout JSON for output_schema: invalid character 'I' looking for beginning of value` |
| dwa dokumenty JSON pod rząd | dowolny | `failed: … invalid character '{' after top-level value` |
| JSON „pretty", wielolinijkowy (heredoc) | zgodny | `succeeded` |
| `{"pad":"<200 kB x>","total":1.5}` | zgodny | `succeeded` — limit 1 MiB nietknięty |
| krok z `action: file.read` czytający zły JSON | niezgodny | `failed` — **działa też na krokach akcyjnych** |
| krok wewnątrz `foreach` | niezgodny | `failed: one or more foreach item bodies failed` |
| krok z `stdout: /tmp/plik` (przekierowanie) | niezgodny | `failed` — przekierowanie **nie** obchodzi walidacji |
| krok z `exit 3` i poprawnym JSON-em | zgodny | `failed: exit status 3` — kod wyjścia sprawdzany **przed** schematem |

Wniosek praktyczny: **stdout kroku objętego `output_schema` musi być czystym, pojedynczym
dokumentem JSON.** Każda diagnostyka, każdy `echo "start"`, każdy `set -x` wywala krok.
To jest ostry wymóg dla promptów agenta, a nie detal.

### 2.5 Ograniczenie kształtu samego schematu

```
$ docker exec dagu-schema dagu start t-array
Error: failed to load DAG from t-array: failed to process document 0: failed to build DAG:
  field 'steps': field 'output_schema': output_schema must resolve to an object schema
  (value: map[items:map[type:number] type:array])

$ docker exec dagu-schema dagu start t-typestring
Error: failed to load DAG from t-typestring: … output_schema must resolve to an object schema
  (value: map[type:string])
```

Schemat **bez** `type` jest przyjmowany i działa:

```
t-notype: output_schema: {required: [order_id, total]}  wobec  {"order_id":"A-1"}
→ failed: stdout JSON does not match output_schema
```

Czyli: `type: object` albo brak `type`. **Nie da się zwalidować kroku, którego wynikiem jest
tablica JSON na najwyższym poziomie** — trzeba ją opakować w obiekt. To kolejne ograniczenie
do konwencji.

### 2.6 Dziura #3 — `continue_on` kasuje walidację

```yaml
name: t-continueon
steps:
  - id: produce
    run: echo '{"order_id":"A-1","total":"WRONG"}'
    output: RESULT
    output_schema: {type: object, required: [order_id, total],
                    properties: {order_id: {type: string}, total: {type: number}}}
    continue_on: {failure: true, mark_success: true}
  - id: consume
    depends: [produce]
    run: echo "downstream got [$RESULT]"
```

```
$ docker exec dagu-schema dagu start t-continueon
  ├─echo "downstream got [$RESULT]"
      downstream got []
Result: Succeeded
```

DAG zielony mimo naruszenia. Sam wynik się nie opublikował (`$RESULT` pusty), więc śmieci
nie przechodzą — ale **przebieg kłamie o sukcesie**, a odbiorca dostaje pustą wartość
i leci dalej. To samo działa na krokach używających zwalidowanej akcji własnej (§3.5,
`t-action-escape` → `Result: Succeeded`, `poszlo dalej`).

### 2.7 Diagnoza `sync |0: invalid argument` — pierwsze podejście audytu

Nierozwiązana zagadka z audytu (§7.3) jest rozwiązana. **To nie jest błąd `output_schema`.**
To zamaskowany komunikat błędu parsowania `DAGU_OUTPUT_FILE`.

Reprodukcja minimalna, bez żadnego `output_schema`:

```yaml
name: s-a
steps:
  - id: produce
    run: |
      printf 'OTHER=x\n' >> "$DAGU_OUTPUT_FILE"
      echo 'hello'
    output: RESULT
```

```
$ docker exec dagu-schema dagu start s-a
err="sync |0: invalid argument"   Result: Failed
```

Ten sam DAG **bez** linii `output: RESULT` pokazuje prawdziwy błąd:

```
$ docker exec dagu-schema dagu start s-c
err="failed to parse DAGU_OUTPUT_FILE: undeclared step output \"OTHER\""   Result: Failed
```

I para rozstrzygająca — identyczne DAG-i, różnią się wyłącznie obecnością `output: RESULT`:

```
s-i (z `output: RESULT`):  err="sync |0: invalid argument"
s-j (bez `output:`):       err="failed to parse DAGU_OUTPUT_FILE: step output \"notjson\" is not valid JSON"
```

**Mechanizm.** Maskowanie jest udowodnione parą `s-i`/`s-j` powyżej. Samo miejsce w kodzie
jest wnioskiem, nie pomiarem: `output: NAZWA` każe Dagu przechwycić stdout przez potok
(`os.Pipe()`; Go nazywa końce potoku `|0` i `|1` — stąd `|0` w komunikacie), a ścieżka błędu
woła na nim `File.Sync()`; `fsync` na potoku zwraca `EINVAL` i ten błąd nadpisuje prawdziwy.
Że chodzi o `fsync` na obiekcie, którego nie da się zsynchronizować, widać wprost na
wariancie z przekierowaniem stdout na urządzenie znakowe:

```
name: t-syncnoschema           (zero output_schema, zero DAGU_OUTPUT_FILE)
steps:
  - id: produce
    run: echo 'plain text, no schema here'
    stdout: /dev/stdout
→ err="sync /dev/stdout: invalid argument"

t-syncdevnull (stdout: /dev/null) → err="sync /dev/null: invalid argument"
```

**Konsekwencja praktyczna, niezależna od walidacji:** jeżeli agent napisze krok, który ma
jednocześnie `output: NAZWA` i pisze do `$DAGU_OUTPUT_FILE`, i pomyli się w tym drugim —
zobaczy komunikat `sync |0: invalid argument`, z którego nie wynika absolutnie nic.
To jest pułapka diagnostyczna dla operatora i dla modelu. Można ją ominąć trzymając się
jednego kanału wyjścia na krok.

---

## 3. Inne natywne mechanizmy egzekwowania kształtu

### 3.1 `mode=preview` / lint przy zapisie DAG-a przez MCP

Sprawdzone przez `dagu_change type=upsert_dag mode=preview`. To **nie jest** tylko sprawdzian
składni YAML — to prawdziwy lint strukturalny. Wynik `structuredContent.valid` + lista
`errors`.

| Wada definicji | `valid` | Komunikat |
| --- | --- | --- |
| nieznane pole kroku (`totally_unknown_field`) | `false` | `'spec.step' has invalid keys: totally_unknown_field` |
| krok bez `run`/`action` | `false` | `field 'command': step command is required` |
| `depends` na nieistniejący krok | `false` | `step a depends on non-existent step nie-istnieje` |
| dwa kroki o tym samym `id` | `false` | `step name must be unique; duplicate step ID: a` |
| zły typ pola (`continue_on.failure: 'yes-please'`) | `false` | `continue_on.failure: expected bool, got string` |
| `action: http.request` bez wymaganego `with.method` | `false` | `field 'with': with.method is required` |
| niepoprawny YAML | `false` | `[3:4] value is not allowed in this context` + wskazanie linii |
| **cykl `a → b → a`** | **`true`** | brak — przechodzi lint |
| **`${steps.calc.outputs.R.b}` (zagnieżdżona ścieżka, pułapka [D14])** | **`true`** | brak — przechodzi lint |
| DAG bez `steps:` w ogóle | `true` | brak |
| błąd składni shella w `run:` | `true` | brak (oczywiste i nie do naprawienia) |

Cykl jest wykrywany dopiero przy uruchomieniu:
`err="failed to setup execution plan: cyclic plan detected"` → `Result: Failed`.
DAG bez kroków uruchamia się i kończy `succeeded`.

Zagnieżdżona ścieżka `${steps.x.outputs.y.z}` — czyli dokładnie ta, o którą rozbił się
audyt w [D14] — **przechodzi lint bez słowa ostrzeżenia** i wybucha dopiero w shellu
(`bad substitution`). Pole `valueReferenceNotices` w `GET /dags/{name}/spec`, które brzmi
jakby miało to łapać, dla tego przypadku zwraca `[]`.

`mode=apply` uruchamia ten sam lint i **nie zapisuje** definicji, która go nie przeszła
(`"DAG spec is not valid; no changes were applied."`).

### 3.2 Walidacja wejścia kroku akcyjnego (`input_schema`)

Działa i jest egzekwowana **przy ładowaniu definicji**, czyli wcześniej niż wykonanie:

```
$ docker exec dagu-schema dagu start t-action-badinput
Error: failed to load DAG from t-action-badinput: … field 'with':
  invalid "emit_result" input: validating root: required: missing properties: ["script"]
  (value: map[skrypt:echo hi])
```

To samo dotyczy akcji wbudowanych (`with.method is required` dla `http.request`, §3.1).

### 3.3 `preconditions` na zawartości wyniku — **NIE są walidacją**, i nie robią tego, co tu napisałem pierwotnie

> **Poprawka z 2026-09-18, po wdrożeniu.** Pierwsza wersja tej sekcji twierdziła, że „pole
> `eval` wykonuje podstawienie komend, więc `jq` na wyniku poprzedniego kroku działa".
> **To jest nieprawda.** `${RESULT}` **nie jest podstawiane** w `eval`, więc pokazany niżej
> przebieg nie dowodził, że warunek odczytał dane — dowodził tylko, że warunek nigdy nie
> pasował. Wniosek sekcji (niespełniony warunek → `skipped`, DAG zielony) pozostaje w mocy,
> ale stał na złym uzasadnieniu. Błąd wykryty niezależnie przez dwa zadania wdrożeniowe
> i potwierdzony ponownym pomiarem; poniżej właściwy obraz.

**Co naprawdę robią `preconditions`** — zmierzone na przypiętej wersji:

| Forma | Widzi wartość z `output:` | Uruchamia powłokę | Uwaga |
| --- | --- | --- | --- |
| `condition: "${NAZWA}"` + `expected: "re:…"` | **tak** | **nie** | porównanie wzorcem na tekście dokumentu |
| `eval: "… ${NAZWA} …"` | **nie** | tak | warunek nigdy nie pasuje — to jest przypadek z pierwotnej wersji tej sekcji |
| dowolna forma z `${steps.*.outputs.*}` | tak | tak | **wkleja dane do polecenia i wykonuje je** |

Dowód na `condition` — ta sama bramka, dwie gałęzie, rozróżnia poprawnie:

```
bramka:      {"galaz":"tak","inna":"nie"}   (output: BRAMKA + output_schema z enum)
pasuje:      condition ${BRAMKA}  expected re:"galaz":"tak"   -> succeeded
nie_pasuje:  condition ${BRAMKA}  expected re:"galaz":"nie"   -> skipped
```

Dowód na wektor wstrzyknięcia przez **stary** kanał — `$(id -u)` **wykonane z zawartości danych**:

```
produce:  DANE=zaczynam $(id -u) koniec      (DAGU_OUTPUT_FILE + outputs:)
warunek:  eval "echo '${steps.produce.outputs.DANE}'"  expected: re:zaczynam 0 koniec
          -> krok URUCHOMIONY   (komenda z danych wykonana)
warunek:  ten sam, expected: re:zaczynam \$\(id -u\) koniec
          -> skipped            (literal NIE zachowany)
```

**Sedno pozostaje bez zmian:** niespełniony warunek daje krok `skipped`, a DAG kończy się
`succeeded` — nikt nie dostaje alertu:

```
$ docker exec dagu-schema dagu start t-precond
time=… level=INFO msg="Preconditions failed for \"gate\"" step=gate
time=… level=INFO msg="DAG run finished" dag=t-precond … status=succeeded
└─gate [skipped]
Result: Succeeded
```

Jako bramka logiczna — tak, i to jedyny sposób na rozgałęzienie warunkowe. Jako egzekwowanie
kontraktu — nie. Bezpieczny wzorzec rozgałęzienia (dokument bramkowy o zamkniętym słowniku,
`condition` zamiast `eval`, zakaz `${steps.*.outputs.*}`) opisuje
`docs/decyzja-architektoniczna.md` §4.1b.

### 3.4 Czy da się narzucić `output_schema` globalnie? Nie

Blok `defaults:` — jedyne miejsce, w którym Dagu rozdaje ustawienia wszystkim krokom naraz —
ma dokładnie te pola:

```
continue_on, env, mail_on_error, preconditions, repeat_policy, retry_policy,
signal_on_stop, timeout_sec
```

`output_schema` **nie jest** wśród nich (`dagu schema dag`, `properties.defaults`).
Nie ma żadnego przełącznika „wymagaj `output_schema` na każdym kroku publikującym wynik".

### 3.5 Najmocniejsza natywna dźwignia: akcje własne w pliku bazowym

Jedyny mechanizm, który przenosi schemat **poza** plik pisany przez agenta: `actions:`
w `base.yaml` (pole DAG-a `actions` jest scalane z konfiguracją bazową). Definicja akcji
niesie `input_schema` (wymagane) i `output_schema` (opcjonalne). Zweryfikowane:

```yaml
# /var/lib/dagu/base.yaml
actions:
  emit_result:
    input_schema:
      type: object
      required: [script]
      properties: {script: {type: string}}
    output_schema:
      type: object
      additionalProperties: false
      required: [order_id, total]
      properties: {order_id: {type: string}, total: {type: number}}
    template:
      run: "{{ .input.script }}"      # kontekst szablonu to `.input`, nie `.with` ani `.inputs`
```

```
t-action-ok        (wynik zgodny)     → Result: Succeeded
t-action-bad       (total: "ZLE")     → err="failed to validate output_schema: stdout JSON does not match output_schema"  Result: Failed
t-action-badinput  (with: {skrypt:})  → Error: … invalid "emit_result" input: required: missing properties: ["script"]
```

Dwie własności, które czynią to istotnym:

* DAG używa akcji przez samo `action: emit_result` — **nie powtarza schematu**, więc agent
  nie może go „przypadkiem" osłabić;
* **nazwy akcji nie da się przesłonić lokalnie w DAG-u**:

```
$ docker exec dagu-schema dagu start t-action-shadow
Error: … field 'actions.emit_result': duplicate custom action "emit_result" conflicts with
  an existing custom action or legacy step_types definition in DAG (value: emit_result)
```

Czego to nie rozwiązuje: nic nie zmusza agenta, żeby użył `action: emit_result` zamiast
zwykłego `run:`. I `continue_on: {failure: true, mark_success: true}` na kroku z tą akcją
dalej kasuje walidację (`t-action-escape` → `Result: Succeeded`, `poszlo dalej`).
Plik bazowy nie jest też edytowalny przez MCP (`dagu_change` zna tylko `*_dag`, `*_profile`,
`*_wiki_page`) — ale jest edytowalny przez REST tym samym kluczem, jeśli klucz ma powierzchnię
`rest_api` i rolę admina.

---

## 4. Nazwy DAG-ów przez MCP — **nazwa spoza naszego zbioru przechodzi**

Pytanie było konkretne: czy `dagu_change` przyjmie DAG o nazwie spoza
`^[A-Za-z0-9_-]{1,64}$`. **Tak — przez kropkę.**

Reguła Dagu, odczytana z komunikatu błędu, brzmi:
*„name must only contain alphanumeric characters, dashes, **dots**, and underscores"*,
plus *„name must be less than 40 characters"*. Jest więc **szersza** od naszej o kropkę
i **węższa** od naszej o długość (39 vs 64 znaki).

Realne wywołania `dagu_change` (spec: trywialny DAG z jednym krokiem `echo hello`):

```
[spacja]     mode=apply name='moje zamowienie'
   applied=false  errors=["field 'name': name must only contain alphanumeric characters,
                   dashes, dots, and underscores (value: moje zamowienie)"]

[kropka]     mode=apply name='order.v2'
   -> "DAG change applied."

[ukosnik]    mode=apply name='grupa/zamowienia'      -> odrzucone (ten sam komunikat)
[diakrytyk]  mode=apply name='zamówienie-ąćę'        -> odrzucone
[dwukropek]  mode=apply name='order:v2'              -> odrzucone
[81 znakow]  mode=apply name='aaaa…a'                -> odrzucone: "name must be less than 40 characters"
```

Pełna odpowiedź dla nazwy z kropką (`order.v3`):

```json
{"applied": true, "created": true, "dagName": "order.v3",
 "dagUri": "dagu://dags/order.v3/spec", "errors": [], "mode": "apply",
 "type": "upsert_dag", "valid": true,
 "dag": {"name": "order.v3", "steps": [{"id": "s1", "commands": [{"command": "echo", "args": ["hello"]}]}]}}
```

Plik wylądował na dysku i jest w pełni obsługiwany przez API:

```
$ ls stack/dagu/dags/ | grep order
order.v2.yaml
order.v3.yaml

$ curl -H "Authorization: Bearer …" .../api/v1/dags/order.v3
HTTP 200  {"dag":{"name":"order.v3", …}}
```

Granice zbadane po stronie Dagu (wszystkie przez `mode=preview`):

| Nazwa | Dagu | Nasza regexp `^[A-Za-z0-9_-]{1,64}$` |
| --- | --- | --- |
| `order.v3`, `a.b.c`, `a..b`, `order.v3.yaml` | **przyjmuje** | odrzuca |
| `.hidden` | **przyjmuje** | odrzuca |
| `-lead`, `_lead`, `UPPER_case-1.2_3` | przyjmuje | częściowo (bez kropki) |
| `..` | odrzuca (przypadek specjalny) | odrzuca |
| 39 znaków | przyjmuje | przyjmuje |
| 40+ znaków | **odrzuca** (`less than 40 characters`) | przyjmuje do 64 |
| spacja, `/`, `:`, diakrytyki | odrzuca | odrzuca |

`type: rename_dag` waliduje identycznie: `order v9` i `order/v9` odrzucone z
`"Invalid destination DAG name: name must only contain alphanumeric characters, dashes,
dots, and underscores"`, a `order.v9` przechodzi.

**Rozstrzygnięcie:** ograniczenie nazw z §4.2 decyzji architektonicznej **musi być
egzekwowane po naszej stronie**. Dagu go nie egzekwuje, a nazwa z kropką zapisze się
bez żadnego ostrzeżenia i zerwie nasz deep-link. Dodatkowo nasza regexp obiecuje 64 znaki,
których Dagu nie przyjmie — sam limit trzeba obniżyć do 39.

---

## 5. Gdzie w ogóle da się przechwycić (bo model rozmawia z MCP bezpośrednio)

Wyłącznie stwierdzenie faktów, bez projektowania — projekt należy do koordynatora.

Ścieżka w prototypie: **model → HTTP MCP Dagu (`/dagu/mcp`) → dysk Dagu**. Nasz backend
w tej ścieżce dziś nie stoi. Miejsca, w których coś może stanąć między modelem a zapisem
definicji, ustalone w tym badaniu:

1. **Wewnątrz definicji DAG-a** — `output_schema` na kroku. Egzekwuje w czasie wykonania,
   ale pisze to ten sam agent i może to pominąć albo wyłączyć `continue_on`.
2. **Plik bazowy `base.yaml`, blok `actions:`** — jedyne miejsce, w którym schemat mieszka
   poza plikiem pisanym przez agenta i nie da się go przesłonić z DAG-a (§3.5). Wciąż opt-in
   na poziomie użycia.
3. **Sam lint `dagu_change`** — działa zawsze, także w `mode=apply`, ale sprawdza kształt
   definicji, nie kształt danych, i przepuszcza cykl oraz zagnieżdżone ścieżki `${…}` (§3.1).
4. **Warstwa sieciowa przed `/dagu/mcp`** — Caddy już stoi przed Dagu i prefiksu nie obcina
   (audyt [D23]); jest to jedyny punkt, przez który przechodzi **każde** wywołanie MCP
   modelu, zanim dotknie Dagu. Badanie nie obejmowało tego, czy i jak dałoby się tam
   inspekcjonować treść JSON-RPC.
5. **Prompt systemowy** — stan dzisiejszy; nie jest mechanizmem egzekwowania.

Punkty 1–3 są natywne i sprawdzone. Punkt 4 jest wyłącznie obserwacją topologiczną,
nie jest w tym raporcie zweryfikowany.

---

## 6. Czego NIE sprawdziłem

Jawna lista, żeby nikt nie czytał z tego raportu więcej, niż w nim jest.

1. **`output_schema` w krokach kontenerowych** (`container:`, `container.run`, `docker.run`,
   `k8s.run`) — nie montowałem socketu Dockera, więc żaden krok kontenerowy nie został
   uruchomiony. Nie wiem, czy przechwytywanie stdout przez potok zachowuje się tam tak samo
   (to jest ta sama ścieżka kodu, która produkuje `sync |0`).
2. **`output_schema` w trybie rozproszonym** (`dagu coordinator` + `dagu worker`) — badałem
   wyłącznie pojedynczy proces `start-all`.
3. **`output_schema` na krokach `type: agent` / `harness.run`** — decyzja architektoniczna
   wyklucza te kroki z użycia, więc nie testowałem.
4. **Zachowanie przy przekroczeniu `max_output_size` (1 MiB)** razem z `output_schema` —
   doszedłem do 200 kB, granicy nie przekroczyłem.
5. **Wydajność walidacji** — nie mierzyłem narzutu `output_schema` ani przy dużych
   dokumentach, ani przy fan-oucie na dziesiątki elementów.
6. **Które słowniki JSON Schema są wspierane** — sprawdziłem `type`, `required`,
   `properties`, `additionalProperties`, `items` i zagnieżdżenie. Nie sprawdziłem
   `pattern`, `format`, `enum`, `oneOf`/`anyOf`/`allOf`, `$ref`, `minimum`/`maximum`,
   `minLength`, `const`, `dependentRequired`. Biblioteką jest `santhosh-tekuri/jsonschema`
   (odczytane z binarki), więc wsparcie jest prawdopodobnie pełne dla draftów 4–2020-12,
   ale **tego nie zweryfikowałem wykonaniem**.
7. **Czy `output_schema` da się podać jako ścieżkę/URL zamiast inline** — schemat mówi
   `type: object` i odrzuca wszystko, co nie jest obiektowym schematem; wariantu
   ścieżkowego (`jsonSchemaDeclaration`, dostępnego dla `params`) nie próbowałem.
8. **Walidacja parametrów wejściowych DAG-a** (`params` z JSON Schema, pięć obsługiwanych
   formatów) — to osobny, wejściowy punkt kontroli; nie uruchomiłem go ani razu.
9. **Czy klucz API o powierzchni wyłącznie `mcp` może zmienić `base.yaml`** — mój klucz miał
   obie powierzchnie (`mcp` + `rest_api`) i rolę `admin`. Rozgraniczenia nie sprawdziłem;
   to jest teren równoległego badania bezpieczeństwa.
10. **Nazwy DAG-ów z path traversal** (`../coś`) — nie testowałem; mieści się w badaniu
    bezpieczeństwa, nie w tym.
11. **Czy nazwa z kropką faktycznie zrywa nasz deep-link** — po stronie Dagu działa
    (`GET /dags/order.v3` → HTTP 200). Nie sprawdzałem `server.mjs` ani `EditorPanel`,
    bo nie wolno mi było ruszać repozytorium poza tym plikiem.
12. **Renderowanie UI poza jednym zrzutem** — zrobiłem jeden headless (CDP) zrzut strony
    nieudanego przebiegu. Nie sprawdzałem widoku listy, powiadomień ani incydentów.

---

## 7. Stanowisko badawcze i sprzątanie

```yaml
# projekt compose: dagu-schema, katalog tymczasowy poza repozytoriami
services:
  dagu:
    image: ghcr.io/dagucloud/dagu@sha256:b242dc7b605aa20d6db78ba192beb82135d390025a7d9c8dfd7f08e14464c69f
    container_name: dagu-schema
    environment:
      PUID: "0"                       # rootless docker, bez `user:` i bez --user
      PGID: "0"
      DAGU_HOST: 0.0.0.0
      DAGU_PORT: "8080"
      DAGU_BASE_PATH: /dagu
      DAGU_PUBLIC_URL: http://127.0.0.1:9201/dagu
      DAGU_AUTH_MODE: builtin
    volumes:
      - ./dagu:/var/lib/dagu          # jeden wolumen na calosc, zgodnie z [D19]
    ports: ["127.0.0.1:9201:8080"]
```

Socket Dockera niezamontowany. Wyłącznie `127.0.0.1`. Stack n8n (`n8niframe`, port 8080,
wolumen `n8niframe_n8n_data`) nietknięty; portów 8080, 9080 ani 91xx nie używałem.
Stack `dagu-schema` i kontener headless Chrome (port 9222, do zrzutu UI) zatrzymane
i usunięte po zakończeniu badania.
