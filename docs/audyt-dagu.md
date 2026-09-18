# Audyt Dagu jako zamiennika n8n w prototypie `n8nIframe`

Data badania: **2026-09-18**. Autor: worker badawczy (zadanie wyłącznie read-only wobec kodu prototypu).
Badanie prowadzone na osobnym stacku `dagu-probe` w `/tmp`, na portach `127.0.0.1:9080` / `9081`.
Prototyp n8n na `:8080` nie był ruszany.

---

## 0. Podsumowanie wykonawcze

* **Nie ma rzeczywistego blokera technicznego.** Wszystkie cztery filary kontraktu prototypu
  (autorstwo przez agenta przez MCP, osadzenie UI w iframe pod jednym originem, deep-link,
  uwierzytelnianie) zostały odtworzone na żywo w Dagu v2.16.6.
* **Największe ryzyko to licencja (GPL-3.0-or-later), a nie technika.** Uruchomienie Dagu jako
  osobnego kontenera konsumowanego przez iframe i HTTP/MCP jest zgodne z GPL, ale to nie jest
  „darmowe MIT". Szczegóły w §7.
* **Największa realna strata funkcjonalna vs n8n: brak edytora drag-and-drop i brak typowanego
  przepływu danych między krokami.** Dagu przekazuje między krokami **tekst** (plik
  `DAGU_OUTPUT_FILE` w formacie `KLUCZ=wartość`). Nie ma czegoś takiego jak `$json.pole`.
* **Community edition (czyli to, co jest na GPL) ma twarde limity produktowe**: max **2 klucze API**,
  **brak zarządzania użytkownikami** (jeden admin), brak SSO/OIDC, brak audit logów, brak terminala.
  Potwierdzone wykonaniem — HTTP 403 z komunikatem „requires a Dagu Pro license".
* **MCP Dagu wystarcza do autorstwa definicji**, ale ma tylko **3 narzędzia** i **nie pokrywa
  całego cyklu operacyjnego** (m.in. nie potrafi zatwierdzić kroku human-in-the-loop, nie zarządza
  webhookami, nie czyta artefaktów). Do tego trzeba dołożyć REST API.

---

## 1. Przypięta wersja i obraz

| Co | Wartość |
| --- | --- |
| Wersja | **v2.16.6** (release opublikowany 2026-09-14T14:45:57Z) |
| Repozytorium | `github.com/dagucloud/dagu` (repo id 484434975; `dagu-org/dagu` to przekierowanie na to samo repo) |
| Obraz | `ghcr.io/dagucloud/dagu:2.16.6` |
| Digest | `sha256:b242dc7b605aa20d6db78ba192beb82135d390025a7d9c8dfd7f08e14464c69f` |
| Utworzenie obrazu | 2026-09-14T14:15:41Z, `linux/amd64` |
| Źródła | tarball tagu v2.16.6, `sha256:c7b3cc99a0e35745d1ab6300d686783708bb7d9ea654e682e24134da90e7161b` |
| Licencja | GPL-3.0-or-later (1719 plików `.go` z nagłówkiem SPDX) |

Weryfikacja wersji **wykonaniem**:

```
$ docker run --rm ghcr.io/dagucloud/dagu:2.16.6 dagu version
2.16.6

$ docker image inspect ghcr.io/dagucloud/dagu:2.16.6 --format '{{index .RepoDigests 0}}'
ghcr.io/dagucloud/dagu@sha256:b242dc7b605aa20d6db78ba192beb82135d390025a7d9c8dfd7f08e14464c69f
```

**Wszystkie ustalenia w tym raporcie dotyczą tej wersji, nie gałęzi `main`.**

---

## 2. Stanowisko badawcze (co dokładnie postawiłem)

Osobny projekt compose `dagu-probe` w `/tmp/dagu-probe/stack`, odwzorowujący kontrakt prototypu:

```yaml
services:
  dagu:
    image: ghcr.io/dagucloud/dagu@sha256:b242dc7b605aa20d6db78ba192beb82135d390025a7d9c8dfd7f08e14464c69f
    environment:
      PUID: "0"                # rootless docker: bez tego zapisy na bind-mount padaja na EACCES
      PGID: "0"
      DAGU_HOST: 0.0.0.0
      DAGU_PORT: "8080"
      DAGU_BASE_PATH: /dagu    # natywne hostowanie pod podsciezka
      DAGU_PUBLIC_URL: http://127.0.0.1:9080/dagu
      DAGU_AUTH_MODE: builtin  # logowanie sesyjne, jak w n8n
      DAGU_AUTH_BUILTIN_INITIAL_ADMIN_USERNAME: admin
      DAGU_AUTH_BUILTIN_INITIAL_ADMIN_PASSWORD: <haslo probe>
      DAGU_AUTH_TOKEN_SECRET: <sekret probe>
    volumes:
      - ./dags:/var/lib/dagu/dags
      - ./data:/var/lib/dagu/data
    ports: ["127.0.0.1:9081:8080"]
  proxy:
    image: caddy:2.10-alpine
    ports: ["127.0.0.1:9080:80"]
```

Caddyfile (kluczowa różnica wobec prototypu n8n — **prefiks NIE jest obcinany**):

```caddy
:80 {
	# Dagu rejestruje wlasne trasy pod DAGU_BASE_PATH, wiec handle bez strip_prefix.
	handle /dagu* {
		reverse_proxy dagu:8080 {
			header_down -X-Frame-Options
			header_down Content-Security-Policy "frame-ancestors 'self'"
		}
	}
	# grupa kontrolna: ten sam upstream, naglowki nietkniete
	handle /raw/* { uri strip_prefix /raw; reverse_proxy dagu:8080 }
	handle { root * /srv/site; file_server }   # "aplikacja" osadzajaca iframe
}
```

Renderowanie sprawdzone headless Chrome (kontener `zenika/alpine-chrome`, sterowany przez CDP
z hosta), a nie samym `curl`.

---

## 3. Macierz funkcji

Kolumna **Status** przyjmuje dokładnie jedną z czterech wartości:
`POTWIERDZONE-WYKONANIEM` (jest wklejony realny output komendy/HTTP),
`POTWIERDZONE-KODEM-LUB-DOKUMENTACJĄ` (odczytane ze źródeł przypiętej wersji, bez uruchomienia),
`NIEZWERYFIKOWANE`, `BLOKER`.
Odnośniki `[Dxx]` prowadzą do dowodów w §4.

### Obszar 1 — Autorstwo definicji przez zewnętrznego agenta

| Obecna funkcja (n8n/prototyp) | Wymagany kontrakt | Odpowiednik w Dagu v2.16.6 | Dowód | Status | Luka / ograniczenie |
| --- | --- | --- | --- | --- | --- |
| Serwer MCP instancji n8n (35 narzędzi) pod `/n8n/mcp-server/http` | Agent tworzy/edytuje/waliduje/uruchamia proces przez MCP | **Jest** serwer MCP pod `<base>/mcp`, Streamable HTTP (JSON), auth przez klucz API o powierzchni `mcp` | [D1] `initialize` + `tools/list` na żywo | `POTWIERDZONE-WYKONANIEM` | Tylko **3 narzędzia** zamiast 35. Wszystko jest sprasowane w `dagu_read` / `dagu_change` / `dagu_execute` |
| `create_workflow_from_code` | Utworzenie definicji | `dagu_change` `type=upsert_dag` `mode=apply` | [D3] utworzenie `probe-order` i `probe-child` | `POTWIERDZONE-WYKONANIEM` | Definicja to YAML tekstem — agent musi znać schemat (serwer podaje go jako resource `dagu://reference/authoring`) |
| `get_workflow_details` | Odczyt definicji | `dagu_read` `target=dag_spec` / `dag` / `dags` / `dag_search` | [D1] schemat `dagu_read` | `POTWIERDZONE-WYKONANIEM` | — |
| `update_workflow` | Edycja definicji | `dagu_change` `upsert_dag` (nadpisuje całość) + `rename_dag`, `delete_dag` | [D3] | `POTWIERDZONE-WYKONANIEM` | Brak edycji częściowej/patcha — agent zawsze podmienia cały plik YAML |
| `validate_workflow` | Walidacja przed zapisem | `dagu_change` `mode=preview` — waliduje i **nie zapisuje** | [D2] błąd walidacji z konkretnym polem | `POTWIERDZONE-WYKONANIEM` | — |
| `get_workflow_sdk_reference`, `search_nodes` | Agent uczy się API | Resources `dagu://reference/{authoring,tools,change-tool,execute-tool,read-tool,notifications,apps}` + 5 promptów MCP | [D1b] `resources/list`, `prompts/list` | `POTWIERDZONE-WYKONANIEM` | Brak odpowiednika `search_nodes` — lista akcji jest w JSON Schema (`dagu schema dag`), nie w MCP |
| Claude Code CLI jako klient (`claude -p --mcp-config`) | Ten sam mechanizm co w prototypie | Działa bez zmian | [D4] pełne wywołanie `claude -p`, zwrócona lista 14 DAG-ów | `POTWIERDZONE-WYKONANIEM` | — |
| — | Zatwierdzenie kroku human-in-the-loop | **Nie ma w MCP.** Tylko REST `POST /dag-runs/{name}/{id}/human-tasks/{stepId}/complete` albo CLI `dagu human-task complete` | [D8] własna dokumentacja MCP mówi to wprost + wykonanie przez REST | `POTWIERDZONE-WYKONANIEM` | **Luka MCP** — czat musi mieć ścieżkę REST obok MCP |
| — | Zarządzanie webhookami, kluczami API, użytkownikami, artefaktami, suspend DAG-a | **Tylko REST API** | [D11], [D12] | `POTWIERDZONE-WYKONANIEM` | To samo — potrzebny cienki adapter REST |
| — | Dry-run, git-sync, worker/coordinator, licencja | **Tylko CLI** (`dagu dry`, `dagu sync`, `dagu worker`, `dagu license`) | `dagu --help` w kontenerze | `POTWIERDZONE-WYKONANIEM` | Nieistotne dla naszego przypadku |

**Podział kompetencji, wprost:**

* **MCP umie:** czytać DAG-i/wykonania/logi/Wiki, walidować i zapisywać definicje, start / enqueue /
  retry / stop, czekać na wynik (`wait=true`, do 300 s), subskrybować zasób wykonania.
* **Tylko REST API:** zatwierdzenie human-task, webhooki (create/toggle/HMAC/regenerate), artefakty,
  klucze API, użytkownicy, suspend/resume harmonogramu, `restart` (nowe ID), kolejki.
* **Tylko CLI:** `dry` (symulacja), `sync` (git), `worker`/`coordinator` (tryb rozproszony),
  `license`, `upgrade`, `exec` (jednorazowe polecenie jako DAG-run).
* **Nie ma nigdzie:** edycji częściowej definicji (patch), wyszukiwarki „węzłów"/integracji,
  odpowiednika n8n-owych 1000+ node'ów z gotowymi credentialami.

### Obszar 2 — Wykonanie

| Obecna funkcja | Wymagany kontrakt | Odpowiednik w Dagu v2.16.6 | Dowód | Status | Luka / ograniczenie |
| --- | --- | --- | --- | --- | --- |
| `execute_workflow` (manual) | Uruchomienie na żądanie | `dagu_execute action=start`, opcjonalnie `wait=true` | [D5] | `POTWIERDZONE-WYKONANIEM` | `waitTimeoutSeconds` max 300 |
| Kolejka wykonań | Uruchomienie asynchroniczne | `action=enqueue` + kolejki globalne (`queue:`) | schemat narzędzia [D1] | `POTWIERDZONE-KODEM-LUB-DOKUMENTACJĄ` | Kolejki globalne wymagają konfiguracji serwera — nie testowałem |
| `get_workflow_execution` | Podgląd stanu | `dagu_read target=run` / `runs`; REST `GET /dag-runs/{name}/{id}` | [D5], [D8] | `POTWIERDZONE-WYKONANIEM` | — |
| Wynik i dane wyjściowe | Wyniki | `structuredContent` z listą kroków + statusami + `outputs` | [D5] | `POTWIERDZONE-WYKONANIEM` | — |
| Log per węzeł | Logi per krok | `dagu_read target=step_log` (stdout i stderr osobno, `tail/head/offset/limit/stream`) | [D6] | `POTWIERDZONE-WYKONANIEM` | — |
| Anulowanie | Stop | `dagu_execute action=stop` | [D9] — run przeszedł w `aborted`, krok `signal: terminated` | `POTWIERDZONE-WYKONANIEM` | — |
| Retry | Ponowienie | `dagu_execute action=retry` (+ `stepName`, `includeDownstream`) | [D7] | `POTWIERDZONE-WYKONANIEM` | Patrz obszar 4 — to jest *wznowienie od miejsca awarii*, nie ślepe powtórzenie |
| Harmonogram (cron) | Automatyczne uruchamianie | Pole `schedule:` w DAG-u, wbudowany scheduler | [D10] — 9 uruchomień, co minutę, równo o pełnej minucie | `POTWIERDZONE-WYKONANIEM` | Suspend/wznowienie harmonogramu tylko przez REST/UI, nie przez MCP |
| Trigger webhook | Wyzwalacz zewnętrzny | `POST <base>/api/v1/webhooks/{dag}` + token per-DAG (opcjonalnie HMAC) | [D11] — HTTP 200, zwrócone `dagRunId` | `POTWIERDZONE-WYKONANIEM` | Endpoint webhooka jest publiczny (bez sesji), chroniony wyłącznie tokenem/HMAC |
| **Brak w n8n w tym prototypie** | Krok „czekaj na zatwierdzenie" | **JEST**: `action: human.task` (`with.prompt` + opcjonalny `with.form` jako JSON Schema) oraz osobno `approval:` na kroku wykonawczym | [D8] — run zatrzymał się w statusie `waiting`, po zatwierdzeniu dokończył się **pod tym samym ID** | `POTWIERDZONE-WYKONANIEM` | Zatwierdzenie **nie przez MCP**. `human.task` nie działa w sub-DAG-ach, w handlerach i w `foreach.steps`; nie ma „odrzuć" ani „cofnij" |

### Obszar 3 — Dane

| Obecna funkcja | Wymagany kontrakt | Odpowiednik w Dagu v2.16.6 | Dowód | Status | Luka / ograniczenie |
| --- | --- | --- | --- | --- | --- |
| n8n: typowane elementy `items[]`, `$json.pole` | Typowane dane między krokami | **Plik**: krok dopisuje rekordy `NAZWA=wartość` (albo heredoc) do `$DAGU_OUTPUT_FILE`, deklaruje `outputs: [{name, type}]`, następny krok czyta `${steps.<id>.outputs.<name>}` | [D13] | `POTWIERDZONE-WYKONANIEM` | `type` ma tylko dwie wartości: `string` i `json`. `json` znaczy „ten tekst musi się parsować", nic więcej |
| `$json.brutto` | Adresowanie pola w obiekcie | **Nie istnieje.** `${steps.calc.outputs.totals.brutto}` nie jest rozwijane i leci do shella jako literał | [D14] — `bad substitution`; spec 007 mówi wprost: „Nested output paths (…) are unsupported" | `POTWIERDZONE-WYKONANIEM` | **Realna strata.** Dane przekraczają granicę kroku jako **tekst**; JSON trzeba sparsować ponownie (np. `jq`) w kroku odbierającym |
| Wyniki pośrednie | Podgląd | Zakładka *Outputs* w UI, `GET /dag-runs/{n}/{id}/outputs`, logi per krok | [D6], UI [D18] | `POTWIERDZONE-WYKONANIEM` | — |
| IF / Switch | Rozgałęzienia warunkowe | `preconditions` (`condition` + `expected`, wsparcie `re:` dla regex, `negate`), akcja `router.route` | [D13] — `big_order` wykonany, `small_order` `skipped` „Precondition unmet" | `POTWIERDZONE-WYKONANIEM` | Krok z niespełnionym warunkiem ma status `skipped`, co **domyślnie blokuje fan-in** (patrz niżej) |
| Merge / fan-in | Złączenie gałęzi | `depends: [a, b]` — ale trzeba dać `continue_on: skipped` na **gałęziach**, nie na złączeniu | [D13] — pierwszy przebieg: `summary skipped (upstream skipped)`; po poprawce: `succeeded` | `POTWIERDZONE-WYKONANIEM` | Pułapka projektowa, łatwa do przeoczenia przez agenta |
| Split In Batches / fan-out | Równoległość | `parallel: {items, max_concurrent}` na kroku `action: dag.run` + `foreach` dla ciała inline | [D15] — 3 sub-runy, `max_concurrent: 2`, agregat `{summary, results, outputs}` | `POTWIERDZONE-WYKONANIEM` | Kolejność `results`/`outputs` **nie jest gwarantowana** (spec 018) |
| Sub-workflow | Podprocesy | `action: dag.run` / `dag.enqueue` → osobny root child-run z własnym ID | [D15] | `POTWIERDZONE-WYKONANIEM` | — |
| Zwrot danych z podprocesu | Fan-in danych | Agregat zbiera **tylko** zmienne z `output: NAZWA`. Zadeklarowane `outputs:` dziecka **nie trafiają** do agregatu | [D15] — najpierw `outputs: {}`, po zmianie na `output: HANDLED` → wartości się pojawiły | `POTWIERDZONE-WYKONANIEM` | **Niespójność** — dwa mechanizmy wyjścia, do fan-in działa tylko starszy |
| Limity równoległości | Kontrola obciążenia | `max_active_steps` (kroki), `queue:` + globalne kolejki (DAG-i), `parallel.max_concurrent` | [D13] `max_active_steps: 4`; schemat | `POTWIERDZONE-WYKONANIEM` | `max_active_runs` jest **deprecated** i ignorowany dla kolejek lokalnych |
| Duże zbiory / partie | Zachowanie przy dużych danych | `max_output_size` domyślnie **1 MiB na krok**; przekroczenie = błąd kroku. Limit dotyczy też dopasowań w `preconditions` i `continue_on` | schemat DAG (`dagu schema dag`) | `POTWIERDZONE-KODEM-LUB-DOKUMENTACJĄ` | Duże dane trzeba przenosić **plikami/artefaktami**, nie przez zmienne. Nie testowałem przekroczenia limitu |
| — | Typowane parametry wejściowe | `params:` z JSON Schema (`type`, `enum`, `minimum`, `pattern`, …) — Dagu buduje `paramSchema` | [D3] — zwrócony `paramSchema` | `POTWIERDZONE-WYKONANIEM` | Dotyczy tylko wejścia DAG-a, nie granic między krokami |
| — | Walidacja stdout schematem | `output_schema:` — inline JSON Schema walidujący stdout przed publikacją | schemat DAG | `POTWIERDZONE-KODEM-LUB-DOKUMENTACJĄ` | Nie przetestowałem pozytywnie; przy moim pierwszym podejściu krok padał z `sync \|0: invalid argument` |

### Obszar 4 — Trwałość i odzyskiwanie

| Obecna funkcja | Wymagany kontrakt | Odpowiednik w Dagu v2.16.6 | Dowód | Status | Luka / ograniczenie |
| --- | --- | --- | --- | --- | --- |
| n8n: SQLite w `n8n_data` | Gdzie mieszkają definicje | **Zwykłe pliki YAML** w `$DAGU_HOME/dags/<nazwa>.yaml` — dokładnie ten tekst, który podał agent | [D16] | `POTWIERDZONE-WYKONANIEM` | Świetne dla gita, ale nie ma bazy → nie ma transakcyjności |
| Historia wykonań | Gdzie mieszka historia | `$DAGU_HOME/data/dag-runs/<dag>/dag-runs/RRRR/MM/DD/dag-run_.../a_.../status.jsonl` — **append-only JSONL, bez bazy danych** | [D17] | `POTWIERDZONE-WYKONANIEM` | — |
| Logi | Gdzie mieszkają | `$DAGU_HOME/logs/<dag>/dag-run_.../<krok>.*.out/.err` | [D17] | `POTWIERDZONE-WYKONANIEM` | **Osobne drzewo niż `data/`** — łatwo zapomnieć o wolumenie |
| Artefakty | Gdzie mieszkają | Katalog per run, `${context.paths.artifacts_dir}`; `GET /dag-runs/{n}/{id}/artifacts` + preview/download | [D12] | `POTWIERDZONE-WYKONANIEM` | — |
| Restart kontenera | Przeżycie restartu | Definicje, historia i klucze API przeżywają, **jeśli** cały `DAGU_HOME` jest na wolumenie | [D19] — po `--force-recreate` liczba runów bez zmian (6), DAG-i bez zmian (14), ale **liczba katalogów z logami spadła 25 → 2**, a log starego runu zwrócił `404 log file not found` | `POTWIERDZONE-WYKONANIEM` | **Pułapka:** montowanie tylko `dags/` i `data/` **gubi logi**. Trzeba montować `/var/lib/dagu` w całości |
| — | **Wznowienie przerwanego wykonania** | **NIE MA automatycznego wznowienia.** Po restarcie kontenera run wisiał w `running`, a po ~45–90 s zombie detector oznaczył go jako `failed` z błędem `process terminated unexpectedly - stale local process detected` | [D20] | `POTWIERDZONE-WYKONANIEM` | **To trzeba powiedzieć wprost: Dagu nie wznawia samo.** Odzyskanie jest ręczne (`retry`) |
| — | **Ponowne wykonanie kroku / DAG-a** | `retry` = **ten sam `dagRunId`**, kroki `succeeded` **nie są uruchamiane ponownie**, wznowienie od miejsca awarii. `restart` = **nowy `dagRunId`**, całość od zera. `retry --step X [--downstream]` = pojedynczy krok | [D7] — znacznik czasu kroku `s1` identyczny przed i po retry (`1789736042.894752145`), `s2`/`s3` z nowymi znacznikami | `POTWIERDZONE-WYKONANIEM` | Rozróżnienie jest czyste i udokumentowane, ale wymaga **ręcznego wywołania** |
| — | Wznowienie po human-task | Ta ścieżka **jest** automatyczna: zatwierdzenie kolejkuje ponowienie tego samego run-ID z zachowaniem ukończonych węzłów | [D8] — `{"queued":true,"remainingWaitingSteps":0}` → run `succeeded` | `POTWIERDZONE-WYKONANIEM` | — |
| — | Retencja | `hist_retention_days` (domyślnie 30) lub `hist_retention_runs` | schemat DAG | `POTWIERDZONE-KODEM-LUB-DOKUMENTACJĄ` | — |

### Obszar 5 — UI

| Obecna funkcja (n8n) | Wymagany kontrakt | Odpowiednik w Dagu v2.16.6 | Dowód | Status | Luka / ograniczenie |
| --- | --- | --- | --- | --- | --- |
| Lista workflowów | Widok listy | `/dags` — tabela, filtry, „Grep", „Active only", akcje Start/Stop/Retry w wierszu | [D18] — 1602 elementy DOM, 12 wierszy tabeli, „11 workflows" | `POTWIERDZONE-WYKONANIEM` | — |
| Kanwa z grafem | Gotowy widok grafu | **Jest** — graf renderowany (mermaid), z układem poziomym/pionowym, zoom, fit-to-screen, **Export as PNG / SVG** | [D21] — przyciski „Horizontal layout", „Zoom in", „Export as PNG" | `POTWIERDZONE-WYKONANIEM` | — |
| Inspekcja węzła (input/output) | Inspekcja kroków | Zakładki *Status / Timeline / Outputs / Spec*, tabela kroków z `stdout`/`stderr`, komunikatem błędu i przyciskami akcji | [D18] — widoczne `calc … succeeded stdout stderr`, `small_order … skipped Precondition unmet` | `POTWIERDZONE-WYKONANIEM` | — |
| **Edytor drag-and-drop** | Edycja definicji z poziomu UI | **Edytor YAML (Monaco) z przyciskiem Save** w zakładce *Spec* | [D21] — w DOM iframe'a `monaco-editor …`, 1 `textarea`, przyciski `Docs`, `Copy`, `Save` | `POTWIERDZONE-WYKONANIEM` | **To jest realna utrata funkcji.** Graf jest **tylko do oglądania** — nie da się przeciągnąć węzła ani połączyć kroków myszą. Operator, który dziś klika w n8n, w Dagu będzie pisał YAML (albo prosił czat) |
| Panel wykonań | Historia | `/dag-runs`, `/dag-runs/{name}/{runId}`, kolejki, „Monitor", „Events" | [D18] | `POTWIERDZONE-WYKONANIEM` | — |
| Biblioteka integracji (1000+ node'ów) | Gotowe integracje | ~56 wbudowanych akcji (`http.request`, `mail.send`, `postgres.query`, `s3.*`, `ssh.run`, `jq.filter`, `chat.completion`, `docker.run`, `k8s.run`, …) + „Dagu Actions" z GitHuba | lista `actionName` z `dagu schema dag` | `POTWIERDZONE-KODEM-LUB-DOKUMENTACJĄ` | **Duża strata katalogowa.** Nie ma gotowych kredensjałów do setek SaaS-ów; wszystko idzie przez `http.request` i własne skrypty |
| Kreator/logowanie | Logowanie w iframe | Ekran logowania renderuje się w iframe; token JWT w `localStorage` | [D22], [D18] | `POTWIERDZONE-WYKONANIEM` | Patrz obszar 6 — mechanizm inny niż ciasteczko n8n |

### Obszar 6 — Osadzenie w iframe (sprawdzone realnie)

| Obecna funkcja (prototyp) | Wymagany kontrakt | Odpowiednik w Dagu v2.16.6 | Dowód | Status | Luka / ograniczenie |
| --- | --- | --- | --- | --- | --- |
| Caddy `handle_path /n8n/*` **obcina** prefiks, bo n8n rejestruje trasy w korzeniu | UI działa pod podścieżką | **Dagu ma natywne `DAGU_BASE_PATH`** i rejestruje pod nim WSZYSTKO: `/dagu/assets/*`, `/dagu/api/v1`, `/dagu/mcp` | [D23] — log startu: `SSE routes configured basePath=/dagu`, `MCP route configured path=/dagu/mcp` | `POTWIERDZONE-WYKONANIEM` | **Lepiej niż n8n.** Prefiksu **nie wolno** obcinać — `handle`, nie `handle_path` |
| Błąd n8n: `/n8n/assets/x.js` → `text/html` | Assety nie uciekają do korzenia | `/dagu/assets/bundle.js` → `Content-Type: text/javascript; charset=utf-8` | [D24] | `POTWIERDZONE-WYKONANIEM` | index.html ma wpieczone `basePath: "/dagu"`, `apiURL: "/dagu/api/v1"` |
| Ciasteczko `n8n-auth`, `SameSite=Lax` | Logowanie działa w iframe | **Nie ma ciasteczka.** `POST /dagu/api/v1/auth/login` zwraca **JWT w ciele**, SPA trzyma go w `localStorage` (`dagu_auth_token`) | [D22] | `POTWIERDZONE-WYKONANIEM` | Zaleta w iframe (zero problemów z SameSite/Secure), ale **rodzic musi obsłużyć logowanie inaczej** — albo pozwolić operatorowi zalogować się w iframe, albo (bo ten sam origin) zasiać token do `localStorage` |
| `N8N_CONTENT_SECURITY_POLICY: frame-ancestors 'self'` | Iframe pod tym samym originem | **Dagu wysyła twardo `X-Frame-Options: DENY` i NIE wysyła żadnego CSP.** Nagłówek jest zaszyty w kodzie (`securityheaders.go:14`), **nie ma opcji konfiguracyjnej** | [D25] surowe nagłówki | `POTWIERDZONE-WYKONANIEM` | **To jedyne miejsce, gdzie trzeba ingerować.** Proxy musi usunąć `X-Frame-Options` i dodać `Content-Security-Policy: frame-ancestors 'self'`. To **nie jest globalne wyłączenie zabezpieczeń** — DENY jest zastępowany węższym, celowym `'self'` |
| — | Dowód, że iframe faktycznie się renderuje | Headless Chrome, odczyt `contentDocument` z rodzica (ten sam origin) | [D26] — ramka `/dagu/dags` = 1602 elementy, 150 SVG, tekst listy DAG-ów; ramka kontrolna `/raw/…` (nagłówki nietknięte) = `contentDocument: null`, czyli **zablokowana** | `POTWIERDZONE-WYKONANIEM` | — |
| Aktualizacje na żywo (`/n8n/rest/push`, WebSocket) | Live updates przez proxy | **SSE**, nie WebSocket: `GET /dagu/api/v1/events/stream` | [D27] — `Content-Type: text/event-stream`, `X-Accel-Buffering: no`, `event: control` + `: heartbeat` przez Caddy | `POTWIERDZONE-WYKONANIEM` | Caddy przepuszcza bez dodatkowej konfiguracji. Uwaga: otwarty strumień SSE psuje `chrome --dump-dom --virtual-time-budget` (dlatego użyłem CDP) |
| `iframe.src = /n8n/workflow/<id>` | Deep-link do procesu | `/dagu/dags/<nazwa>/<zakładka>` (np. `/spec`, `/status`) | [D21] | `POTWIERDZONE-WYKONANIEM` | — |
| `iframe.src = .../executions/<id>` | Deep-link do wykonania | `/dagu/dag-runs/<nazwa>/<dagRunId>` | [D28] — wyrenderowany konkretny run z grafem, parametrami, tabelą kroków i „Actor: probe-agent" | `POTWIERDZONE-WYKONANIEM` | — |
| — | Deep-link do DAG-a bez zakładki | `/dagu/dags/<nazwa>` i `/dagu/dags/<nazwa>/` | [D29] | `POTWIERDZONE-WYKONANIEM` | **Obserwacja:** raz (przy oczekiwaniu 16 s) ramka pokazała error boundary „Unable to load this page…". Przy 22 s renderowała się poprawnie, a na instancji kontrolnej (bez auth) działała od razu. Traktuję to jako **wyścig przy starcie**, nie jako błąd base-path — ale w produkcji lepiej linkować **z zakładką** |
| — | Autoryzacja API pod prefiksem | Bez tokenu `HTTP 401`; z `Authorization: Bearer` `HTTP 200` z danymi | [D30] | `POTWIERDZONE-WYKONANIEM` | — |

### Obszar 7 — Licencja

| Pytanie | Ustalenie | Dowód | Status |
| --- | --- | --- | --- |
| Jaka licencja | **GPL-3.0-or-later**, tekst `LICENSE` to wierny GNU GPL v3 bez żadnego wyjątku ani dodatku; 1719 plików `.go` z `SPDX-License-Identifier: GPL-3.0-or-later` | odczyt tagu v2.16.6 | `POTWIERDZONE-WYKONANIEM` |
| Czy to MIT | **Nie.** GitHub API zwraca `"spdx_id": "GPL-3.0"` | zapytanie do API | `POTWIERDZONE-WYKONANIEM` |
| Dagu jako osobna usługa w kontenerze, konsumowana przez nasze UI (iframe) i HTTP/MCP | **Zgodne.** Nie dystrybuujemy binarki, nie linkujemy jej z naszym kodem, używamy jej jako osobnego programu przez sieć | `LICENSING.md` §„Current Public License" | `POTWIERDZONE-KODEM-LUB-DOKUMENTACJĄ` |
| Embedded Go API | `github.com/dagucloud/dagu/v2` — **experimental**; kto importuje i **dystrybuuje** binarkę, musi ocenić obowiązki GPL dla dzieła połączonego. Prawa do komercyjnego osadzania **nie są udzielane** przez to repo | `LICENSING.md` §„Embedded Go API" | `POTWIERDZONE-KODEM-LUB-DOKUMENTACJĄ` |
| Czy iframe cokolwiek zmienia prawnie | **Nie.** Iframe to wyłącznie sposób wyświetlenia cudzej strony w przeglądarce. Granicą GPL jest **dystrybucja dzieła połączonego**, a nie sposób renderowania. Iframe niczego nie „rozwiązuje" | wniosek z cytatów poniżej | `POTWIERDZONE-KODEM-LUB-DOKUMENTACJĄ` |

Cytat z `LICENSING.md` **przypiętej wersji v2.16.6** (`sha256:ef20425f…`):

> „Dagu source code is distributed under the GNU General Public License version 3 or later
> (`GPL-3.0-or-later`)."

> „The Go package `github.com/dagucloud/dagu/v2` exposes an experimental embedded API. Applications
> that import or link this package and distribute the resulting binary should evaluate GPL
> obligations for the combined work."

> „Commercial embedding rights are not granted by this repository, this document, or the public GPL
> license. They require a separate written agreement with the copyright holder or authorized licensor."

> „Using the Dagu CLI or server as a separate program is different from importing the embedded Go API
> into another distributed binary."

**Moja konkluzja.** Dla **wewnętrznej aplikacji firmowej**, w której Dagu chodzi jako osobny kontener,
a nasza aplikacja rozmawia z nim przez HTTP/MCP i pokazuje jego własne UI w iframe — jesteśmy po
bezpiecznej stronie. GPL nakłada obowiązki przy **dystrybucji**; my nic nie dystrybuujemy i nic nie
linkujemy. GPL v3 nie ma klauzuli sieciowej (to AGPL ją ma), więc samo wystawienie usługi wewnątrz
firmy nie rodzi obowiązku publikacji naszego kodu.

**Czerwone linie, których nie wolno przekroczyć bez prawnika:**

1. Zaimportowanie `github.com/dagucloud/dagu/v2` do naszego kodu Go i zbudowanie jednej binarki —
   `LICENSING.md` **wprost** każe to ocenić pod kątem GPL i mówi, że prawa do komercyjnego osadzania
   wymagają osobnej umowy.
2. Dystrybucja produktu **zawierającego** Dagu (obraz, instalator, appliance u klienta) — to już jest
   dystrybucja dzieła i wtedy GPL działa w pełni.
3. Patchowanie Dagu i wysyłanie tak zmienionej wersji poza firmę.

**Punkty otwarte (wymagają prawnika, nie inżyniera):** czy nasz `docker-compose.yml`, który *pobiera*
obraz `ghcr.io/dagucloud/dagu`, staje się „dystrybucją", jeśli kiedykolwiek wyjdzie poza firmę razem
z obrazem; oraz jak dokładnie liczyć granicę „dzieła połączonego", gdybyśmy chcieli dołożyć własne
akcje jako pluginy w Go. Nie rozstrzygam tego.

### Obszar 8 — Bezpieczeństwo

| Pytanie | Ustalenie | Dowód | Status | Ryzyko |
| --- | --- | --- | --- | --- |
| Jako kto działa kod kroku | Jako **ten sam użytkownik OS co serwer Dagu**. W moim stacku `uid=0 gid=0 user=root` (bo `PUID=0` przy rootless docker) | [D31] | `POTWIERDZONE-WYKONANIEM` | Zwykły krok ma pełnię praw procesu serwera wewnątrz kontenera |
| Dostęp do plików | Pełny odczyt/zapis w kontenerze, w tym `/var/lib/dagu/data/apikeys/` i zamontowany katalog `dags/` z hosta | [D31] | `POTWIERDZONE-WYKONANIEM` | Agent może nadpisać cudze definicje DAG-ów |
| Sekrety w środowisku | **Krok dziedziczy pełne środowisko serwera**, w tym `DAGU_AUTH_TOKEN_SECRET` i `DAGU_AUTH_BUILTIN_INITIAL_ADMIN_PASSWORD` | [D32] — wypisane **same nazwy** zmiennych | `POTWIERDZONE-WYKONANIEM` | **Poważne.** Mając `DAGU_AUTH_TOKEN_SECRET` krok może podrobić JWT i zostać adminem. Sekrety trzeba podawać **plikiem konfiguracyjnym**, nie zmiennymi środowiskowymi |
| Klucze API na dysku | Przechowywane jako **bcrypt** (`key_hash: $2a$12$…`) + `sha256` digest, nie plaintext | [D33] — same nazwy pól | `POTWIERDZONE-WYKONANIEM` | Odczyt katalogu nie daje odtworzenia klucza |
| Socket Dockera | **Nie jest montowany domyślnie** | [D31] — `ls: cannot access '/var/run/docker.sock'` | `POTWIERDZONE-WYKONANIEM` | Ale `action: docker.run` / `container.run` **wymaga** go zamontować — i wtedy krok agenta = root na hoście |
| Sieć | Krok widzi tylko sieć compose; `n8niframe-n8n` **nie rozwiązuje się** | [D31] | `POTWIERDZONE-WYKONANIEM` | Wyjście do internetu jest nadal otwarte, jeśli kontener ma trasę |
| Model uprawnień | Role: `admin`, `manager`, `developer`, `operator`, `viewer`; klucz API ma rolę, `allowedSurfaces` (`rest_api`/`mcp`) i `workspaceAccess` | [D34] — utworzenie klucza `role: admin`, `allowedSurfaces: [mcp, rest_api]` | `POTWIERDZONE-WYKONANIEM` | **Ale wiele kont użytkowników to funkcja płatna** (patrz niżej), więc w wersji GPL ograniczanie sprowadza się do ról kluczy API |
| Ograniczenia edycji | Globalne `permissions.writeDags` / `permissions.runDags` (widoczne w konfiguracji SPA) | index.html `permissions: {writeDags, runDags}` | `POTWIERDZONE-KODEM-LUB-DOKUMENTACJĄ` | Nie testowałem wyłączenia |
| Izolacja kroku pisanego przez AI | `action: container.run` / `docker.run` / `k8s.run` — krok w osobnym kontenerze/podzie | lista akcji, spec 037/038 | `POTWIERDZONE-KODEM-LUB-DOKUMENTACJĄ` | Wymaga socketu Dockera (patrz wyżej) — czyli wymienia jedno ryzyko na inne. Alternatywa: **osobna instancja Dagu** dla DAG-ów pisanych przez agenta |

**Limity wersji Community (to, co jest na GPL) — potwierdzone wykonaniem [D35]:**

```
POST /dagu/api/v1/api-keys   (3. klucz)
HTTP 403 {"code":"forbidden","message":"Community edition supports up to 2 API keys.
          Delete an existing key or configure a license to create more."}

POST /dagu/api/v1/users
HTTP 403 {"code":"forbidden","message":"User management requires a Dagu Pro license"}

GET  /dagu/api/v1/audit-logs
HTTP 404 page not found
```

W kodzie bramki licencyjne to `FeatureSSO`, `FeatureRBAC`, `FeatureAudit` plus
`communityAPIKeyLimit = 2` (`internal/service/frontend/api/v1/apikeys.go:18`).
Praktycznie: **w wersji GPL mamy jedno konto administratora i maksymalnie dwa klucze API.**

---

## 4. Dowody

### [D1] MCP — rzeczywista lista narzędzi (odpytanie serwera, nie README)

```
$ curl -X POST http://127.0.0.1:9080/dagu/mcp -H "Authorization: Bearer dagu_65r…" \
       -H 'Accept: application/json, text/event-stream' \
       -d '{"jsonrpc":"2.0","id":1,"method":"initialize", …}'
HTTP/1.1 200 OK
Mcp-Session-Id: 6M4YG4BPHRBVV5JUMJJ5IO6X4K
{"result":{"protocolVersion":"2025-06-18","serverInfo":{"name":"dagu","version":"2.16.6"},
 "capabilities":{"prompts":{},"resources":{"subscribe":true},"tools":{}}, …}}

$ … {"method":"tools/list"}
TOOL: dagu_change  | Preview or apply Dagu changes      annotations: {'destructiveHint': True, 'openWorldHint': False}
TOOL: dagu_execute | Execute, enqueue, retry, or stop DAG-runs  annotations: {'destructiveHint': True, 'openWorldHint': False}
TOOL: dagu_read    | Read Dagu state                    annotations: {'openWorldHint': False, 'readOnlyHint': True}
```

Pełne enumy z ich schematów wejściowych:

* `dagu_change.type`: `upsert_dag`, `rename_dag`, `delete_dag`, `set_dag_profile`,
  `clear_dag_profile`, `upsert_wiki_page`, `rename_wiki_page`, `delete_wiki_page`;
  `mode`: `preview` | `apply`.
* `dagu_execute.action`: `start`, `enqueue`, `retry`, `stop`;
  `targetType`: `dag` | `inline_spec` | `run`;
  dodatkowo `params`, `queue`, `singleton`, `labels`, `stepName`, `includeDownstream`,
  `wait`, `waitTimeoutSeconds` (1–300).
* `dagu_read.target`: `references`, `reference`, `dags`, `dag`, `dag_spec`, `dag_profile`,
  `dag_search`, `wiki`, `wiki_page`, `wiki_search`, `runs`, `run`, `run_logs`, `step_log`.

**Uprawnienia:** dostęp wymaga klucza API o powierzchni `mcp`; klucz niesie rolę
(`admin`/`manager`/`developer`/`operator`/`viewer`) i zakres workspace'ów. Klucz z rolą `viewer`
nie przejdzie przez `dagu_change`/`dagu_execute`.

### [D1b] MCP — zasoby i prompty

```
RES dags -> dagu://dags                       RES dag_runs -> dagu://runs
RES wiki -> dagu://wiki                       RES run_inspector -> ui://dagu/run-inspector/v9
RES dagu_authoring_reference -> dagu://reference/authoring
RES dagu_mcp_{read,change,execute}_tool_reference, dagu_notifications_reference, dagu_mcp_apps_reference
TPL dag_spec          -> dagu://dags/{name}/spec
TPL dag_run           -> dagu://runs/{name}/{dagRunId}
TPL dag_run_step_log  -> dagu://runs/{name}/{dagRunId}/steps/{stepName}/logs
TPL sub_dag_run       -> dagu://runs/{name}/{dagRunId}/sub/{subRunId}
PROMPT dagu_create_dag, dagu_edit_dag, dagu_debug_failed_run, dagu_create_wiki_page, dagu_edit_wiki_page
```

### [D2] Walidacja przez MCP (`mode=preview`)

```
spec: steps: [{name: a, command: echo hi, depends: [nope-does-not-exist]}]
→ {"applied": false, "valid": false,
   "errors": ["field 'depends': step a depends on non-existent step nope-does-not-exist (value: nope-does-not-exist)"]}
```

### [D3] Utworzenie DAG-a przez MCP i typowane parametry

```
dagu_change mode=apply type=upsert_dag name=probe-child
→ {"applied": true, "created": true, "valid": true, "errors": [],
   "dag": {"name":"probe-child",
           "paramDefs":[{"name":"item","type":"string"}],
           "paramSchema":{"type":"object","properties":{"item":{"type":"string"}}}, …}}
```

### [D4] Claude Code CLI podłączony do MCP Dagu (ten sam kontrakt co w prototypie)

```
$ claude -p --mcp-config /tmp/dagu-probe/mcpcfg.json --strict-mcp-config \
    --allowedTools "mcp__dagu" --disallowedTools "Bash,Read,Write,Edit,WebFetch,WebSearch" \
    --output-format json \
    "Uzyj narzedzia dagu_read z target=dags i wypisz TYLKO liste nazw DAG-ow, po przecinku."

"result": "example-01-basic-sequential, example-02-parallel-execution, example-03-scheduling,
           example-04-nested-workflows, example-05-template-and-file, probe-approval,
           probe-artifact, probe-child, probe-longrun, probe-order, probe-retry, probe-sched,
           probe-sec, probe-sec2",
"is_error": false, "num_turns": 3, "duration_ms": 5379
```

`mcpcfg.json` ma dokładnie kształt z prototypu:
`{"mcpServers":{"dagu":{"type":"http","url":"http://127.0.0.1:9080/dagu/mcp","headers":{"Authorization":"Bearer …"}}}}`

### [D5] Wykonanie z oczekiwaniem na wynik

```
dagu_execute {"action":"start","name":"probe-order","wait":true,"waitTimeoutSeconds":120}
→ runId: 034QxhnwpTBboKFv7XEKhu  status: succeeded
   calc         succeeded
   big_order    succeeded
   small_order  skipped
   fanout       succeeded
   summary      succeeded
```

### [D6] Logi per krok przez MCP

```
dagu_read {"target":"step_log","name":"probe-order","dagRunId":"…","stepName":"summary"}
→ {"data":{"stdoutContent":"SUMMARY totals={netto:149.97,brutto:184.46}\nnetto via jq: 149.97",
           "stderrContent":"","lineCount":…,"hasMore":false}}
```

*(Uwaga na `{netto:…}` bez cudzysłowów — to skutek podstawienia tekstowego do polecenia shella,
opisany przy obszarze 3.)*

### [D7] Retry = wznowienie od miejsca awarii, ten sam run-ID

```
start  →  run 034QxkIJccen8tFkfjwzo4  failed
   s1 succeeded / s2 failed (exit status 7) / s3 aborted (upstream failed)
   s1 stdout: "s1 ran at 1789736042.894752145"

retry (ten sam dagRunId)  →  run 034QxkIJccen8tFkfjwzo4  succeeded
   s1: s1 ran at 1789736042.894752145      ← IDENTYCZNY znacznik: krok NIE zostal powtorzony
   s2: s2 OK at 1789736051.166441852
   s3: s3 ran at 1789736051.173371938
```

### [D8] Human-in-the-loop — pełny cykl

DAG:

```yaml
  - id: gate
    action: human.task
    with:
      prompt: "Zatwierdz wysylke zamowienia 42"
      form:
        type: object
        properties:
          decision: {type: string, enum: [ship, hold]}
          note: {type: string}
        required: [decision]
```

```
start z wait=true  →  completed: false, status: waiting
   prepare succeeded / gate waiting / after not_started

MCP nie ma narzedzia do zatwierdzenia. Z dagu://reference/authoring:
  "The MCP tool surface does not expose human-task completion; completion uses the
   local dagu human-task complete command."
Jest natomiast REST:

POST /dagu/api/v1/dag-runs/probe-approval/034Qxj8pmrkgt9fJTQPFsK/human-tasks/gate/complete
     {"decision":"ship","note":"ok z czatu"}
HTTP 200 {"alreadyCompleted":false,"queued":true,"remainingWaitingSteps":0,"stepId":"gate"}

→ status: succeeded (ten sam dagRunId), kroki: prepare/gate/after = succeeded
→ log kroku "after": operator decided=ship note=ok z czatu
```

Uwaga: payload to **płaski obiekt** formularza, nie `{"input": {...}}` — próba z `input`
kończy się `HTTP 400 unexpected additional properties ["input"]`.

### [D9] Anulowanie

```
dagu_execute {"action":"stop","name":"probe-longrun","dagRunId":"034QxqFey01F26JehQ6R29"}
→ after stop: aborted
   quick succeeded / slow aborted "signal: terminated" / tail not_started
```

### [D10] Harmonogram cron

```yaml
name: probe-sched
schedule: "* * * * *"
```

```
GET /dagu/api/v1/dag-runs?name=probe-sched
count 9
  034Qy40HeJFXIg4hdu0xpn succeeded 2026-09-18T15:07:00+02:00
  034Qy2TwkERRvI4Y1QZkI8 succeeded 2026-09-18T15:06:00+02:00
  034Qy0xbwEolJiC2GS8IDD succeeded 2026-09-18T15:05:00+02:00
  034QxzRH28nsjn4rgxNSuH succeeded 2026-09-18T15:04:00+02:00
  034QxxuwEKP8AxZ5M0zlRF succeeded 2026-09-18T15:03:00+02:00
```

### [D11] Trigger webhook

```
POST /dagu/api/v1/dags/probe-order/webhook          HTTP 201
  → {"authMode":"token_only","enabled":true,"tokenPrefix":"dagu_wh_wBR1",
     "hmac":{"enabled":false,"secretConfigured":false}, …}  + pelny token w polu "token"

POST /dagu/api/v1/webhooks/probe-order
     Authorization: Bearer dagu_wh_…      body {"NETTO":200}
HTTP 200 {"dagName":"probe-order","dagRunId":"01a0b4a9-0fd3-750f-ae2b-b83380c9e28d"}
```

### [D12] Artefakty

```yaml
  - id: make
    run: printf 'raport\nnetto 149.97\n' > "${context.paths.artifacts_dir}/raport.txt"
```

```
GET /dagu/api/v1/dag-runs/probe-artifact/034QyGt6Gv4c4asm4QnPO4/artifacts
HTTP 200 {"items":[{"name":"raport.txt","path":"raport.txt","size":20,"type":"file"}]}
```

### [D13] Typowane wyjścia, rozgałęzienie warunkowe, fan-in

```yaml
  - id: calc
    run: |
      awk -v n="${params.NETTO}" 'BEGIN{printf "netto=%.2f\nbrutto=%.2f\ntotals<<JSON\n{\"netto\":%.2f,\"brutto\":%.2f}\nJSON\n", n, n*1.23, n, n*1.23}' >> "$DAGU_OUTPUT_FILE"
    outputs:
      - {name: netto,  type: string}
      - {name: brutto, type: string}
      - {name: totals, type: json}
  - id: big_order
    preconditions:
      - condition: "${steps.calc.outputs.brutto}"
        expected: "re:^1[0-9][0-9]\\."
```

```
przebieg 1 (bez continue_on na galeziach):
   calc succeeded / big_order succeeded / small_order skipped / fanout succeeded
   summary SKIPPED  "upstream skipped"          ← fan-in zablokowany przez pominieta galaz
przebieg 2 (continue_on: skipped na small_order):
   summary succeeded
```

Bez `outputs` deklarowanych, samo stdout **nie** jest wyjściem:

```
run: echo '{"netto":149.97}' + outputs:[{name: totals, type: json}]
→ failed: "failed to parse DAGU_OUTPUT_FILE: declared step output \"totals\" was not emitted"
```

### [D14] Brak adresowania pól JSON przez granicę kroku

```
run: echo "brutto=[${steps.calc.outputs.totals.brutto}]"
→ FAILED, stderr: /bin/bash: line 1: brutto=[${steps.calc.outputs.totals.brutto}]: bad substitution

run: echo 'WHOLE=${steps.calc.outputs.totals}'
→ OK, stdout: WHOLE={"netto":149.97,"brutto":184.46}     ← caly JSON jako TEKST
```

Potwierdzenie w `specs/007-value-resolution-steps.md:44`:

> „Nested output paths such as `${steps.build.outputs.metadata.tag}` are unsupported braced text."

### [D15] Fan-out do sub-DAG-a i agregat fan-in

```yaml
  - id: fanout
    action: dag.run
    with: {dag: probe-child, params: {item: ${ITEM}}}
    parallel: {items: [alpha, beta, gamma], max_concurrent: 2}
```

stdout kroku `fanout` — **gdy dziecko deklaruje `outputs:`**:

```json
{"summary":{"total":3,"succeeded":3,"failed":0},
 "results":[{"name":"probe-child","dagRunId":"4cVM…","params":"item=alpha","outputs":{},"status":"succeeded"}, …],
 "outputs":[{},{},{}]}
```

stdout kroku `fanout` — **po zmianie dziecka na `output: HANDLED`**:

```json
{"summary":{"total":3,"succeeded":3,"failed":0},
 "results":[{"params":"item=gamma","outputs":{"HANDLED":"child handled gamma"},"status":"succeeded"},
            {"params":"item=alpha","outputs":{"HANDLED":"child handled alpha"},"status":"succeeded"},
            {"params":"item=beta", "outputs":{"HANDLED":"child handled beta"}, "status":"succeeded"}],
 "outputs":[{"HANDLED":"child handled gamma"}, …]}
```

Zwróć uwagę na kolejność: `gamma, alpha, beta` — **nie** kolejność `items`.

### [D16] Definicje na dysku (plik 1:1 z tym, co wysłał agent)

```
$ ls /tmp/dagu-probe/stack/dags/
example-01-basic-sequential.yaml  …  probe-child.yaml  probe-order.yaml  wiki/

$ cat /tmp/dagu-probe/stack/dags/probe-child.yaml
name: probe-child
params:
  - name: item
    type: string
steps:
  - id: work
    run: echo "child handled ${params.item}"
    outputs:
      - name: handled
        type: string
```

### [D17] Rozmieszczenie danych

```
$ dagu config
Base config:              /var/lib/dagu/base.yaml
DAGs directory:           /var/lib/dagu/dags
DAG runs:                 /var/lib/dagu/data/dag-runs
Data directory:           /var/lib/dagu/data
Log directory:            /var/lib/dagu/logs
Suspend flags:            /var/lib/dagu/suspend
Queue:                    /var/lib/dagu/data/queue

$ find /var/lib/dagu/data/dag-runs -maxdepth 6 | head
/var/lib/dagu/data/dag-runs/probe-sched/dag-runs/2026/09/18/dag-run_20260918_131200Z_034QyBbxUEbyaSsTRihsHX/a_20260918_131200_073Z_e61f66/status.jsonl

$ head -c 300 …/status.jsonl
{"root":{"name":"probe-sched","id":"034QyBbxUEbyaSsTRihsHX"},"name":"probe-sched",
 "dagRunId":"034QyBbxUEbyaSsTRihsHX","attemptId":"e61f66","status":4,"triggerType":1,
 "workerId":"local","pid":237, "nodes":[…
```

Żadnej bazy danych — katalogi i pliki JSONL.

### [D18] UI w iframe, po zalogowaniu (headless Chrome + CDP, odczyt `contentDocument` z rodzica)

```json
{"id":"list","src":"/dagu/dags","location":"http://proxy/dagu/dags","readyState":"complete",
 "elementCount":1602,"svgCount":150,"tableRows":12,
 "text":"D Dagu All workspaces Overview Workflows Search Base Config Wiki Executions Queues Monitor
   Events Audit Logs Notifications Rules Channels Incidents Connections Routing Integrations Webhooks
   API Reference Profiles & Secrets Administration Dark Mode English admin v2.16.6 Home Workflows DAGs
   Workflows New View All workflows Grep Active only 11 workflows Expand rows Name Description Status
   Latest status Last Run Europe/Warsaw Live / Schedule Toggle & next run Actions Operations
   example-01-basic-sequential Execute steps one after another not_started - No schedule Start Stop Retry …"}
```

### [D19] Recreate kontenera — co przeżywa, a co ginie

```
PRZED:  probe-order runs: 6      katalogow z logami: 25      du -sh logs: 736K
$ docker compose -p dagu-probe up -d --force-recreate --no-deps dagu
PO:     probe-order runs: 6      dags: 14                    katalogow z logami: 2

GET /dagu/api/v1/dag-runs/probe-order/034QxiYfk6enNoQW6WBpeW/log?step=summary
HTTP 404 {"code":"not_found","message":"log file not found for dag-run 034QxiYfk6enNoQW6WBpeW"}
```

Przyczyna: montowałem `./dags` i `./data`, ale **nie** `/var/lib/dagu/logs`.

### [D20] Brak automatycznego wznowienia po restarcie

```
start probe-longrun (krok slow = sleep 180)   →  quick succeeded, slow running
$ docker restart dagu-probe-dagu

t+15s: running | quick=succeeded slow=running tail=not_started
t+30s: running | …
t+45s: running | …
t+60s: running | …
t+75s: failed  | quick=succeeded slow=failed tail=failed

nodes[].error: "process terminated unexpectedly - stale local process detected"
(zombie detector chodzi co 45 s: 'Started zombie detector interval=45s')
```

Odzyskanie **wyłącznie ręczne** — `retry` na tym samym run-ID:

```
quick  succeeded  startedAt 2026-09-18T14:54:24+02:00   ← oryginalny znacznik, krok nie powtorzony
slow   running    startedAt 2026-09-18T14:56:31+02:00
tail   not_started
```

### [D21] Edytor YAML i sterowanie grafem — wewnątrz iframe'a

```json
{"location":"http://proxy/dagu/dags/probe-order/spec",
 "textareas":1,
 "cmEditors":["monaco-editor no-user-select  showUnused showDeprecated vs",
              "monaco-scrollable-element editor-scrollable vs",
              "lines-content monaco-editor-background"],
 "mermaidSvgs":78,
 "buttons":["…","Start","Stop","Retry","Refresh","Rename","Delete",
            "Horizontal layout","Vertical layout","Zoom in","Zoom out","Fit to screen",
            "Reset zoom","Export as PNG","Export as SVG","Expand graph","Docs","Copy","Save"]}
```

Brak jakiegokolwiek elementu drag-and-drop do budowania grafu — `contentEditable: 0`,
jedyny edytor to Monaco z YAML-em.

### [D22] Logowanie — JWT w ciele odpowiedzi, brak ciasteczka

```
$ curl -i -c cookies.txt -X POST http://127.0.0.1:9080/dagu/api/v1/auth/login \
       -d '{"username":"admin","password":"…"}'
HTTP/1.1 200 OK
{"expiresAt":"2026-09-19T14:47:51+02:00","token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",
 "user":{"authProvider":"builtin","role":"admin","username":"admin","workspaceAccess":{"all":true}}}

$ cat cookies.txt
# Netscape HTTP Cookie File
(pusty — zadnego Set-Cookie)
```

Klucze w `localStorage` (z bundla): `dagu_auth_token`, `dagu_auth_token_expires_at`.

### [D23] Start Dagu z `DAGU_BASE_PATH=/dagu`

```
level=INFO msg="SSE invalidation stream configured for multiplexed topics"
level=INFO msg="SSE routes configured" basePath=/dagu/api/v1
level=INFO msg="MCP route configured" path=/dagu/mcp
level=INFO msg="Server is starting" addr=0.0.0.0:8080
```

index.html serwowany pod prefiksem ma wpieczoną konfigurację:

```html
<link rel="icon" href="/dagu/assets/favicon.ico" />
apiURL: "/dagu/api/v1",  basePath: "/dagu",  version: "2.16.6",  authMode: "builtin",
permissions: { writeDags: "true" === "true", runDags: "true" === "true" }
```

### [D24] Test, który n8n oblał — typ MIME modułu JS pod prefiksem

```
$ curl -D - http://127.0.0.1:9080/dagu/assets/bundle.js
HTTP/1.1 200 OK
Content-Security-Policy: frame-ancestors 'self'
Content-Type: text/javascript; charset=utf-8      ← nie text/html
Via: 1.1 Caddy
X-Content-Type-Options: nosniff
```

(Cały front to jeden plik `bundle.js`; nie ma lazy-chunków.)

### [D25] Surowe nagłówki Dagu (bez proxy, port 9081)

```
$ curl -i http://127.0.0.1:9081/dagu
HTTP/1.1 200 OK
Cache-Control: no-cache, no-store, must-revalidate
Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=()
Referrer-Policy: strict-origin-when-cross-origin
Vary: Origin
X-Content-Type-Options: nosniff
X-Frame-Options: DENY            ← zaszyte na sztywno, BEZ opcji konfiguracji
X-Xss-Protection: 0
Content-Type: text/html; charset=utf-8
(brak jakiegokolwiek naglowka Content-Security-Policy)
```

Kod, `internal/service/frontend/securityheaders.go:14`, wywoływany bezwarunkowo z `server.go:868`:

```go
h.Set("X-Frame-Options", "DENY")
h.Set("X-Content-Type-Options", "nosniff")
h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
h.Set("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=()")
h.Set("X-XSS-Protection", "0")
if tlsEnabled { h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains") }
```

Po korekcie na proxy (`header_down -X-Frame-Options` + `header_down Content-Security-Policy "frame-ancestors 'self'"`):

```
HTTP/1.1 200 OK
Content-Security-Policy: frame-ancestors 'self'     ← jest
Content-Type: text/html; charset=utf-8
Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=()
Referrer-Policy: strict-origin-when-cross-origin
Via: 1.1 Caddy
X-Content-Type-Options: nosniff
X-Xss-Protection: 0
(X-Frame-Options usuniety)
```

### [D26] Dowód renderowania w iframe + grupa kontrolna

Strona rodzica (ten sam origin) z dwiema ramkami: `/dagu/dags` (nagłówki poprawione) oraz
`/raw/dagu/dags` (ten sam upstream, nagłówki **nietknięte**). Odczyt `contentDocument` z rodzica:

```json
{"ts":"2026-09-18T13:08:54.656Z","frames":[
 {"id":"ok","src":"/dagu/dags","location":"http://proxy/dagu/login","readyState":"complete",
  "title":"Dagu","elementCount":43,"svgCount":3,
  "text":"Dagu Sign in to your account Username Password Sign In English"},
 {"id":"raw","src":"/raw/dagu/dags","contentDocument":null}
]}
```

`contentDocument: null` na ramce kontrolnej = przeglądarka **zablokowała** osadzenie przez
`X-Frame-Options: DENY`. To dowód, że korekta nagłówka jest konieczna **i wystarczająca**.

### [D27] SSE przez reverse proxy

```
$ curl -N -D - -H "Authorization: Bearer …" -H 'Accept: text/event-stream' \
       http://127.0.0.1:9080/dagu/api/v1/events/stream
HTTP/1.1 200 OK
Cache-Control: no-cache
Content-Security-Policy: frame-ancestors 'self'
Content-Type: text/event-stream
Via: 1.1 Caddy
X-Accel-Buffering: no

event: control
data: {"sessionID":"1a27ad70-d640-411d-a01e-e6d489c10c8c","subscribed":[]}

: heartbeat
```

Nie WebSocket — to zmiana wobec `/n8n/rest/push`, ale dla Caddy jest łatwiejsza.

### [D28] Deep-link do konkretnego wykonania — wyrenderowany w iframe

```json
{"id":"run","src":"/dagu/dag-runs/probe-order/034QxiYfk6enNoQW6WBpeW",
 "location":"http://proxy/dagu/dag-runs/probe-order/034QxiYfk6enNoQW6WBpeW",
 "elementCount":1243,"svgCount":105,"tableRows":6,
 "text":"… Home Executions DAG Runs probe-order 034QxiYfk6enNoQW6WBpeW probe-order Definition Copy link
   succeeded Refresh R Stop Retry Dequeue Sep 18, 12:52:54 UTC 0s local RUN ID 034QxiYfk6enNoQW6WBpeW
   Parameters NETTO=149.97 Status Timeline Outputs Spec calc big_order small_order fanout -> probe-child x3
   summary NETTO=149.97 Started 2026-09-18 12:52:54 Finished 2026-09-18 12:52:54 Duration 0s Trigger Manual
   Actor probe-agent Worker local … No Step Name Execution Last Run Status Error / Logs Actions
   1 calc Script defined … succeeded stdout stderr 2 big_order echo BIG ORDER …"}
```

To jest dokładny odpowiednik „iframe przeskakuje na konkretne wykonanie" z prototypu —
z grafem, parametrami, statusem, timeline i logami per krok.

### [D29] Deep-link do DAG-a — obserwacja o wyścigu

```
oczekiwanie 16 s:  /dagu/dags/probe-order/  →  269 elementow,
                   "Unable to load this page The page may have changed since this tab was opened. Reload"
oczekiwanie 22 s:  /dagu/dags/probe-order/  →  1316 elementow, pelny widok z grafem i tabela krokow
kontrola (instancja bez auth, base_path=/dagu, bez proxy, strona najwyzszego poziomu):
                   /dagu/dags/probe-order   →  1030 elementow, poprawnie od razu
kontrola (instancja bez base_path):
                   /dags/probe-order        →  1030 elementow, poprawnie od razu
```

Wniosek: to **nie** jest błąd hostowania pod prefiksem. Mimo to w produkcji linkuj z zakładką
(`/dagu/dags/<nazwa>/status`), bo ta forma nie zawiodła ani razu.

### [D30] API pod prefiksem — autoryzacja

```
GET /dagu/api/v1/dags                              → HTTP 401
GET /dagu/api/v1/dags  (Authorization: Bearer …)   → HTTP 200
{"dags":[{"dag":{"name":"example-01-basic-sequential","description":"Execute steps one after another",…},
          "errors":[],"fileName":"example-01-basic-sequential",
          "latestDAGRun":{"statusLabel":"not_started",…},"suspended":false}, …]}
```

### [D31] Co może kod kroku DAG-a

Krok DAG-a napisany jak dowolny inny, uruchomiony przez Dagu:

```
uid=0 gid=0 user=root
cwd=/var/lib/dagu/data/dag-run-work/probe-sec/t2wa4vh2x2vcm2fhmnnggy2q5y/root
--- can read dagu data dir? ---
f0e6e27d-1fc8-483d-9887-9282c3ee30cb.json          ← katalog kluczy API czytelny
--- can read host-mounted dags? ---
example-01-basic-sequential.yaml …                 ← cudze definicje czytelne (i zapisywalne)
--- docker socket? ---
ls: cannot access '/var/run/docker.sock': No such file or directory
--- server env visible to step? ---
14                                                 ← 14 zmiennych DAGU_*
DAGU_AUTH_MODE=builtin
--- network egress ---
n8n NOT resolvable                                 ← izolacja sieci compose dziala
--- write outside DAGU_HOME ---
wrote /tmp OK
```

### [D32] Sekrety serwera widoczne dla kroku (wypisane **tylko nazwy**)

```
DAGU_AUTH_BUILTIN_INITIAL_ADMIN_PASSWORD
DAGU_AUTH_BUILTIN_INITIAL_ADMIN_USERNAME
DAGU_AUTH_MODE
DAGU_AUTH_TOKEN_SECRET
DAGU_BASE_PATH
DAGU_DAGS_DIR
DAGU_EXECUTABLE
DAGU_HOME
DAGU_HOST
DAGU_OUTPUT_FILE
DAGU_PORT
DAGU_PUBLIC_URL
DAGU_SKIP_EXAMPLES
DAGU_TZ
```

`DAGU_AUTH_TOKEN_SECRET` w środowisku kroku = krok może **podrobić JWT administratora**.

### [D33] Format przechowywania klucza API (same nazwy pól i długości)

```
.id = f0e6e27d-1…(36 chars)          .role = admin
.name = probe-mcp                    .allowed_surfaces = [list len 2]
.attribution_class = service_account .workspace_access.all = True
.key_hash = $2a$12$TNZ…(60 chars)    ← bcrypt
.key_digest = sha256:v1:…(74 chars)
.key_prefix = dagu_65r
```

### [D34] Utworzenie klucza API dla agenta

```
POST /dagu/api/v1/api-keys
{"name":"probe-mcp","role":"admin","allowedSurfaces":["mcp","rest_api"],
 "attributionClass":"service_account","serviceAccountName":"probe-agent"}
HTTP 201 → {"apiKey":{"id":"f0e6e27d-…","keyPrefix":"dagu_65r","serviceAccountId":"api_key:f0e6e27d-…"},
            "key":"dagu_65r…"}     ← pelny klucz zwracany tylko tutaj
```

Role dostępne (z OpenAPI): `admin` (pełny, w tym zarządzanie użytkownikami), `manager`
(CRUD DAG-ów + wykonania + audit), `developer` (CRUD DAG-ów + wykonania),
`operator` (**tylko uruchamianie**), `viewer` (tylko odczyt).

### [D35] Limity wersji Community — potwierdzone wykonaniem

```
POST /dagu/api/v1/api-keys  (drugi klucz)   HTTP 201
POST /dagu/api/v1/api-keys  (trzeci klucz)  HTTP 403
  {"code":"forbidden","message":"Community edition supports up to 2 API keys. Delete an existing key
   or configure a license to create more."}

POST /dagu/api/v1/users                     HTTP 403
  {"code":"forbidden","message":"User management requires a Dagu Pro license"}

GET  /dagu/api/v1/audit-logs                HTTP 404
GET  /dagu/api/v1/license                   HTTP 404
```

---

## 5. Luki i rekomendacje

| # | Luka | Klasyfikacja | Uzasadnienie w jednym zdaniu |
| --- | --- | --- | --- |
| 1 | `X-Frame-Options: DENY` zaszyty w kodzie, brak opcji konfiguracji | **mały adapter** | Trzy linijki w Caddyfile wymieniają `DENY` na węższe `frame-ancestors 'self'` i osadzenie działa — sprawdzone [D25][D26]. |
| 2 | MCP nie potrafi zatwierdzić kroku human-in-the-loop | **mały adapter** | REST `POST …/human-tasks/{stepId}/complete` robi dokładnie to samo i działa [D8]; chat-backend już i tak mówi HTTP-em. |
| 3 | MCP nie obsługuje webhooków, artefaktów, kluczy API, suspend | **mały adapter** | Wszystko jest w REST API pod tym samym prefiksem i tym samym tokenem [D11][D12][D34]. |
| 4 | Brak `${steps.x.outputs.json.pole}` — dane przez granicę kroku to tekst | **akceptowalny zamiennik** | Krok odbierający robi `jq` na całym JSON-ie [D14]; to brzydsze i bardziej podatne na błędy cytowania, ale w pełni wykonalne. |
| 5 | Agregat fan-in zbiera tylko `output: VAR`, ignoruje zadeklarowane `outputs:` | **akceptowalny zamiennik** | Sub-DAG-i piszące wynik przez `output:` działają [D15]; wymaga tylko trzymania się jednej konwencji w promptach dla agenta. |
| 6 | Fan-in po rozgałęzieniu wymaga `continue_on: skipped` na gałęziach | **akceptowalny zamiennik** | Jedna linijka w szablonie DAG-a i konwencja w prompcie dla agenta [D13]. |
| 7 | **Brak edytora drag-and-drop**; graf jest tylko do oglądania | **akceptowalny zamiennik** — ale to prawdziwa utrata funkcji | Operator dostaje Monaco z YAML-em i podgląd grafu [D21]; nie da się tego nazwać „nowym UI" — w n8n klika się myszą, tu pisze się tekst albo prosi czat. |
| 8 | Katalog integracji ~56 akcji zamiast 1000+ node'ów n8n | **akceptowalny zamiennik** dla prototypu, **potencjalny blocker** dla produktu | Dla procesów opartych o HTTP/SQL/S3/mail wystarcza; jeśli plan zakłada „kliknij i podłącz Slacka/HubSpota z gotowym OAuth", tego tu nie ma. |
| 9 | **Brak automatycznego wznowienia przerwanego wykonania** po restarcie | **akceptowalny zamiennik** | Zombie detector oznacza run jako `failed` po ~45–90 s, a `retry` wznawia od miejsca awarii bez powtarzania ukończonych kroków [D20][D7] — wystarczy dopisać auto-retry do naszego kodu. |
| 10 | Logi giną przy recreate, jeśli zamontujemy tylko `dags/` i `data/` | **mały adapter** | Zamontować całe `/var/lib/dagu` jako jeden wolumen [D19]. |
| 11 | **Wersja Community: 1 użytkownik, max 2 klucze API, brak SSO/RBAC/audit** | **rzeczywisty blocker** — dla wieloosobowej aplikacji firmowej | Nie da się nadać drugiej osobie własnego konta ani odseparować agenta od operatora rolami użytkowników [D35]; dla prototypu z jednym operatorem to obojętne, przy skalowaniu na zespół to zakup Dagu Pro albo rezygnacja. |
| 12 | **Krok DAG-a dziedziczy `DAGU_AUTH_TOKEN_SECRET` i hasło admina ze środowiska serwera** | **rzeczywisty blocker** — do czasu poprawienia konfiguracji | DAG napisany przez agenta AI może odczytać sekret podpisujący JWT i wystawić sobie token admina [D32]; sekrety trzeba przenieść do pliku konfiguracyjnego i/lub odizolować instancję agenta. |
| 13 | Limit `max_output_size` = 1 MiB na krok | **akceptowalny zamiennik** | Duże dane przenosi się artefaktami lub plikami, nie zmiennymi [D12]. |
| 14 | Licencja GPL-3.0-or-later, brak praw do komercyjnego osadzania | **rzeczywisty blocker** — wyłącznie dla scenariusza „wbudujemy Dagu w naszą binarkę / sprzedamy z produktem" | `LICENSING.md` wprost mówi, że osadzanie komercyjne wymaga osobnej umowy; dla naszego scenariusza (osobny kontener, wewnętrzne użycie) blokera nie ma. |

### Co zrobić, gdyby prototyp miał iść na Dagu

1. **Caddy**: `handle /dagu*` (BEZ `handle_path`), plus `header_down -X-Frame-Options` i
   `header_down Content-Security-Policy "frame-ancestors 'self'"`.
2. **Wolumen**: jeden, na całe `/var/lib/dagu`.
3. **Sekrety**: `DAGU_AUTH_TOKEN_SECRET` i hasło admina **przez plik konfiguracyjny**, nie przez
   `environment:` w compose — inaczej każdy krok DAG-a je widzi.
4. **Chat-backend**: MCP do autorstwa i uruchamiania, cienki klient REST do zatwierdzeń
   human-task, webhooków i artefaktów.
5. **Logowanie w iframe**: ponieważ to ten sam origin, rodzic może zasiać `dagu_auth_token`
   do `localStorage` po własnym logowaniu; alternatywnie operator loguje się raz w ramce.
6. **Deep-link**: `/dagu/dags/<nazwa>/status` i `/dagu/dag-runs/<nazwa>/<runId>`.
7. **Izolacja agenta**: osobna instancja Dagu (albo osobny workspace + klucz API roli `developer`)
   dla DAG-ów pisanych przez model; nie montować socketu Dockera do instancji, do której pisze agent.
8. **Auto-recovery**: własny watchdog, który po wykryciu `failed` z błędem
   „stale local process detected" wywołuje `retry` na tym samym run-ID.

---

## 6. Rekomendowana przypięta wersja i obraz

```yaml
services:
  dagu:
    image: ghcr.io/dagucloud/dagu@sha256:b242dc7b605aa20d6db78ba192beb82135d390025a7d9c8dfd7f08e14464c69f
    # tag rownowazny: ghcr.io/dagucloud/dagu:2.16.6  (v2.16.6, 2026-09-14)
```

| Pole | Wartość |
| --- | --- |
| Tag | `ghcr.io/dagucloud/dagu:2.16.6` |
| Digest | `sha256:b242dc7b605aa20d6db78ba192beb82135d390025a7d9c8dfd7f08e14464c69f` |
| Architektura | `linux/amd64` |
| Data zbudowania | 2026-09-14T14:15:41Z |
| Wersja binarki (sprawdzona `dagu version`) | `2.16.6` |
| Wersja w UI | `v2.16.6` (widoczna w nawigacji, [D18]) |
| Wersja w `serverInfo` MCP | `{"name":"dagu","version":"2.16.6"}` ([D1]) |

Uwagi do przypięcia: przy rootless Dockerze i bind-mountach ustaw `PUID=0`/`PGID=0`
(kontenerowy root mapuje się na użytkownika hosta) — **nie** podawaj `user:` ani `--user`.
Nie używaj tagu `latest` z `deploy/docker/compose.minimal.yaml` z repozytorium.

---

## 7. Czego NIE sprawdziłem

Jawna lista, żeby nikt nie czytał z tego raportu więcej, niż w nim jest:

1. **Tryb rozproszony** (`dagu coordinator` + `dagu worker`, `worker_selector`, kolejki globalne)
   — badałem wyłącznie pojedynczy proces `start-all`.
2. **Zachowanie przy dużych zbiorach i partiach**: nie przekroczyłem `max_output_size` (1 MiB),
   nie puściłem fan-outu na setki elementów, nie zmierzyłem zużycia pamięci ani czasu.
3. **`output_schema`** — nie mam pozytywnego przebiegu; pierwsza próba padła z niejasnym
   `sync |0: invalid argument` i nie wróciłem do tego.
4. **Kolejki globalne**, `overlap_policy`, `catchup_window`, `skip_if_successful` — tylko z opisu schematu.
5. **`type: agent`** (krok, w którym LLM wybiera następny krok) i `harness.run` — tylko z dokumentacji.
6. **Izolacja przez `container.run` / `docker.run` / `k8s.run`** — nie montowałem socketu Dockera,
   więc nie sprawdziłem ani działania, ani skuteczności izolacji.
7. **HMAC dla webhooków**, `forward_headers`, `X-Dagu-Profile` — utworzyłem tylko webhook
   `token_only`.
8. **Powiadomienia** (`mail_on`, notification channels/rules), incydenty, Wiki, `git-sync`,
   `secrets.*` (Vault/AWS/GCP/Azure), profile runtime, `tools:` (aqua) — poza zakresem.
9. **Zachowanie po awarii hosta / kill -9 samego procesu Dagu** — testowałem `docker restart`
   i `docker compose up --force-recreate`, nie twardą awarię maszyny.
10. **Wydajność i limity SSE** (`sse.max_clients`, wolny klient) przy wielu otwartych iframe'ach.
11. **Przeglądarka użytkownika** — renderowanie potwierdzone w headless Chrome 124
    (`zenika/alpine-chrome`), nie w Chrome/Firefox operatora ani na jego rozdzielczości.
12. **Migracja istniejących workflowów n8n do DAG-ów** — nie próbowałem; n8n i Dagu mają
    niekompatybilne modele danych (elementy/`$json` vs tekstowe wyjścia kroków).
13. **Strona prawna** — §7 to lektura `LICENSING.md` i `LICENSE`, nie opinia prawna.
