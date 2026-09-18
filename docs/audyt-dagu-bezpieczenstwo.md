# Audyt bezpieczeństwa Dagu — granica zaufania (R-A, R-B, R-C)

**Zadanie:** weryfikacyjne, rozstrzygnięte wykonaniem. Target: Dagu v2.16.6,
`ghcr.io/dagucloud/dagu@sha256:b242dc7b605aa20d6db78ba192beb82135d390025a7d9c8dfd7f08e14464c69f`.
**Stanowisko:** projekty compose `dagu-sec-*` na `127.0.0.1:91xx`, katalog roboczy poza
repozytorium (scratchpad sesji). Socket Dockera **nie** montowany. Sekrety wytworzone
lokalnie tylko na czas badania i **nie są** drukowane — raportowany jest wyłącznie fakt
dostępu (czytelność, liczba bajtów, nazwa zmiennej, kod HTTP).

Powiązania z wcześniejszymi dokumentami: `decyzja-architektoniczna.md` §5 (R-A/R-B/R-C),
`audyt-dagu.md` [D22][D32][D34][D35], `audyt-dagu-walidacja.md` §3.5 i §5.

---

## Werdykty w jednym miejscu

| Pyt. | Ryzyko | Werdykt |
| --- | --- | --- |
| P1 | R-C (sekrety w pliku config) | **IZOLACJA-POZORNA** |
| P2 | R-C rozszerzone (co osiąga krok) | Krok = root; dosięga sieć compose po nazwie; **ma otwarty egress do internetu**; nie dosięga usług hosta publikowanych na `127.0.0.1` |
| P3 | R-C (obejście bramki) | Krok nadpisuje `base.yaml` i `dags/` na dysku — **bramka polityki nie jest granicą bezpieczeństwa** |
| P4 | R-B (wariant B2) | **B2-WYKONALNE-Z-ZASTRZEŻENIEM** (Caddyfile niżej) |
| P5 | R-B (zawężenie klucza) | Minimalna rola: **`developer`** + `allowedSurfaces:["mcp"]` |
| P6 | R-A (uwierzytelnianie `/api/chat`) | Ciasteczko sesji `HttpOnly; SameSite=Strict` + serwerowa unieważnialność + kontrola Origin — **działa** |

---

## P1 — przeniesienie sekretów z `environment:` do pliku config: **IZOLACJA-POZORNA**

**Stanowisko:** Dagu z sekretami w `config.yaml` (`auth.builtin.token.secret`,
`auth.builtin.initial_admin.password`), **nie** w `environment:`. Plik ma prawa `-rw------- root root`.
Serwer i kroki DAG-a biegną tym samym użytkownikiem: `root (uid 0)` (`sudo -E -H -n -u #0 -g #0 -- dagu start-all`).

### Ustalenie 1 — środek robi połowę roboty: usuwa sekret ze *środowiska*

DAG napisany przez model przez MCP (`dagu_change`→`dagu_execute`) wypisał własne środowisko
(tylko nazwy) i sprawdził konkretne zmienne przez `printenv`:

```
DAGU_AUTH_TOKEN_SECRET unset
DAGU_AUTH_BUILTIN_INITIAL_ADMIN_PASSWORD unset
grep env for auth/secret/passw/token by NAME -> (none)
```

Więc dziedziczenie środowiska serwera z [D32] faktycznie znika, gdy sekrety siedzą w pliku.
To jest realny zysk — ale tylko wobec ścieżki „przez `env`".

### Ustalenie 2 — sekret jest czytelny przez plik, bo krok to root

W tym samym środowisku kroku Dagu **eksportuje** wskaźnik na plik konfiguracyjny:

```
DAGU_CONFIG SET len=26
DAGU_CONFIG points to: /var/lib/dagu/config.yaml
config.yaml READABLE bytes=290
keys_present_in_config:  mode  password  secret  username
secret_value_length_from_config=64        # krok odczytał 64-znakowy sekret podpisujący JWT (wartość NIE drukowana)
```

### Ustalenie 3 — pełne przejęcie admina, dowód end-to-end (bez drukowania sekretu)

Krok odczytał hasło admina z `config.yaml`, zalogował się zwykłym `POST /auth/login`
i użył uzyskanego tokenu na endpoincie tylko-dla-admina:

```
step_read_admin_password_from_config=YES len=24
step_obtained_VALID_admin_token=YES role=admin (token withheld)
admin_api_call GET /api/v1/api-keys with obtained token -> HTTP 200
```

Odczyt samego `secret:` (64 B) daje materiał do **podrobienia** JWT admina; odczyt `password:`
daje **łatwiejszą** drogę — normalne logowanie. Obie są w zasięgu jednego kroku.

### Ustalenie 4 — brak natywnego zawężenia środowiska kroku w Community

* `env:` na poziomie DAG-a jest **addytywne**, nie odcina dziedziczenia:

  ```
  DAGU_CONFIG_visible=/var/lib/dagu/config.yaml   # nadal widoczne mimo własnego env:
  MYVAR=hello                                      # dodane
  whoami=0:0                                        # nadal root
  config_readable=YES
  ```
* Pole `user:` na kroku **nie istnieje** — schemat DAG-a je odrzuca:

  ```
  field 'steps': 'spec.step' has invalid keys: user
  ```
* Nie ma `secrets:` ani `run_config` zawężającego proces kroku. Jedyna natywna izolacja
  to **executor kontenerowy** (`container:`/`docker.run`) — a ten wymaga socketu Dockera,
  którego decyzja architektoniczna świadomie nie montuje. Bez osobnego użytkownika lub
  osobnego kontenera plik konfiguracyjny czytelny dla serwera jest czytelny dla kroku.

**Wniosek P1:** środek „env → plik" przenosi sekret z jednego czytelnego miejsca w drugie.
Krok DAG-a napisany przez model **zdobywa materiał do podrobienia tokenu administratora**
(a nawet prościej — loguje się hasłem z pliku). **IZOLACJA-POZORNA.**

---

## P2 — co krok osiąga poza kontenerem (bez socketu Dockera)

Sonda sieciowa z kroku DAG-a:

```
== identity ==        uid=0(root) gid=0(root)     hostname=<container id>
== capabilities ==    CapEff: 00000000a80425fb
   -> CHOWN, DAC_OVERRIDE, FOWNER, FSETID, KILL, SETGID, SETUID, SETPCAP,
      NET_BIND_SERVICE, NET_RAW, SYS_CHROOT, MKNOD, AUDIT_WRITE, SETFCAP
   -> NET_ADMIN: NIE   SYS_ADMIN: NIE   (domyślny zestaw Dockera, 14 uprawnień)
== compose peer by NAME ==     peer:80 -> 200   body: "peer-service-reached"
== 127.0.0.1 in-container ==   127.0.0.1:8080/dagu/ -> 301   (to jest sam kontener, nie host)
== host via gateway ==         gw:8080 -> 000   gw:9181 -> 000   gw:22 -> 000   gw:5678 -> 000  (brak połączenia)
== outbound internet ==        example.com -> 200    ***EGRESS OTWARTY***
```

**Interpretacja:** „bez socketu Dockera" **nie** znaczy „izolowany".

* Krok jest **rootem** z domyślnym zestawem capabilities (m.in. `NET_RAW`, `SETUID`,
  `DAC_OVERRIDE`).
* Dosięga **każdą inną usługę w sieci compose po nazwie DNS** (tu `peer:80`). W produkcji
  oznacza to zasięg na `n8n`, `chat-backend`, każdą usługę na wspólnej sieci — o ile nie
  rozdzieli się ich sieciami.
* `127.0.0.1` wewnątrz kontenera to sam kontener, **nie** host. Usługi hosta publikowane na
  `127.0.0.1:91xx`/`8080` **nie są** osiągalne przez bramę (rootless Docker) — to realna granica.
* **Egress do internetu jest otwarty** — krok może wysłać odczytany sekret na dowolny host
  zewnętrzny. To jest droga eksfiltracji, której sam brak socketu nie zamyka.

Środek domykający egress (np. `internal: true` na sieci albo polityka wyjścia) **nie jest**
dziś w konfiguracji i leży poza tym raportem jako rekomendacja.

---

## P3 — czy krok może zmienić własne reguły: **bramka polityki to nie granica**

Raport walidacji (§3.5) ustalił, że akcje własne w `base.yaml` niosą `output_schema`,
którego **nie da się przesłonić z DAG-a** przez MCP. To prawda **na poziomie MCP**. Ale
`base.yaml` i `dags/` leżą na tym samym wolumenie, do którego krok (root) ma zapis:

```
before: base.yaml contains emit_result guard? YES   (zainstalowana najmocniejsza natywna bramka)
after:  base.yaml contains emit_result guard? NO    (krok nadpisał plik: 'env: []')
overwrote probe-secret.yaml directly on disk: YES    (podmieniona CUDZA definicja, z pominięciem lintu MCP)
planted new dag file zz-implant.yaml: YES            (nowy DAG, którego operator nigdy nie widział)
```

Dagu podnosi pliki z dysku niezależnie od MCP — podłożony DAG jest widoczny i wykonywalny:

```
dags list: [... probe-secret, sabotage, zz-implant, zz-injected]
$ dagu start zz-implant  -> status=succeeded   stdout: "persistent-implant"
```

**Wniosek P3:** `output_schema`/lint MCP i bramka `base.yaml` mają wartość jako pomoc
w spójności danych, ale **nie są mechanizmem bezpieczeństwa**. Wystarczy jeden wykonany krok
(a wykonywanie kroków jest istotą produktu), by:
* skasować bramkę `base.yaml`,
* nadpisać definicję **między** walidacją a startem (TOCTOU: walidacja przez MCP, potem zapis
  pliku, potem `start` czyta plik z dysku),
* uruchomić starą/podmienioną definicję,
* zostawić trwały implant DAG-a.

Bramka polityki egzekwowana na wejściu MCP nie ma sensu jako granica, dopóki krok ma zapis
do `dags/` i `base.yaml`.

---

## P4 — wariant B2 (token po stronie proxy): **B2-WYKONALNE-Z-ZASTRZEŻENIEM**

**Pytanie:** Caddy trzyma token Dagu i wstrzykuje `Authorization` do `/dagu/*`; czy SPA Dagu
działa, czy mimo to żąda logowania (bo jej własny stan klienta mówi „niezalogowany")?

### Krok 1 — samo wstrzyknięcie nagłówka NIE wystarcza

Caddy z `header_up Authorization "Bearer <token>"`. API działa bez tokenu klienta
(`GET /dagu/api/v1/dags -> 200`), ale headless Chrome (CDP) pokazuje, że **SPA i tak ląduje
na ekranie logowania**, bo jej route-guard sprawdza `localStorage['dagu_auth_token']`:

```
FINAL_URL: http://.../dagu/login
HAS_PASSWORD_INPUT: True
BODY_SNIPPET: "Dagu  Sign in to your account  Username Password Sign In"
LS_TOKEN_PRESENT: False
```

To dokładnie ta obawa z decyzji §5 R-B. Samo B2 „wprost" — **nie działa**.

### Krok 2 — wariant działający: sentinel w `localStorage` + podmiana nagłówka na proxy

Route-guard SPA wymaga jedynie **niepustego** `dagu_auth_token`; nie dekoduje JWT lokalnie
(sesję potwierdza `GET /api/v1/auth/me`, który przez wstrzyknięcie zwraca 200). Wystarczy więc
zasiać **nie-sekretny** sentinel, a prawdziwy token trzymać wyłącznie na Caddym:

```
LS_TOKEN_VALUE_IS_SENTINEL: True          (przeglądarka trzyma tylko 'SENTINEL-...', nie JWT)
FINAL_URL: http://.../dagu/dags           (aplikacja się renderuje)
HAS_PASSWORD_INPUT: False
DAG_ROWS_VISIBLE: 4
NETWORK: 200 /api/v1/auth/me   200 /api/v1/dags   200 /api/v1/events/stream?...&token=SENTINEL-...
```

### Krok 3 — postać samodzielna: proxowany endpoint logowania (bez JS w rodzicu)

Caddy przechwytuje `POST /dagu/api/v1/auth/login` i zwraca sentinel. Operator wpisuje
cokolwiek, klika „Sign In", SPA zapisuje sentinel i wchodzi do aplikacji. **Zweryfikowane
w przeglądarce** (wypełnienie i submit realnego formularza React przez CDP):

```
START_URL:        http://.../dagu/login   (pwd input: True)
AFTER_LOGIN_URL:  http://.../dagu         (pwd input: False)
LS_TOKEN_VALUE:   SENTINEL-proxy-managed
APP_RENDERED:     True   DAG_ROWS_VISIBLE: 4
```

### Caddyfile, który zadziałał

```caddyfile
{
	admin off
	auto_https off
}
:80 {
	# Własny POST logowania SPA odpowiadany przez proxy NIE-SEKRETNYM sentinelem.
	# Przeglądarka nigdy nie dostaje prawdziwego JWT Dagu.
	handle /dagu/api/v1/auth/login {
		header Content-Type application/json
		respond `{"token":"SENTINEL-proxy-managed","expiresAt":"2099-01-01T00:00:00Z","user":{"authProvider":"builtin","role":"admin","username":"admin","workspaceAccess":{"all":true}}}` 200
	}
	# Reszta: proxy do Dagu z PODMIANĄ Authorization na prawdziwy token trzymany tylko tu.
	# Obejmuje XHR i SSE (events/stream) jednakowo — bez osobnej trasy dla strumienia.
	handle /dagu* {
		reverse_proxy dagu:8080 {
			header_up Authorization "Bearer <PRAWDZIWY_TOKEN_DAGU_TYLKO_TUTAJ>"
		}
	}
}
```

Uwaga składniowa (potwierdzona wykonaniem): **`handle /dagu*` bez `redir /dagu /dagu/`** — ta
para tworzy pętlę 301 (`ERR_TOO_MANY_REDIRECTS`), bo Dagu samo przekierowuje `/dagu/`→`/dagu`.
Przeglądarka cache'uje 301-permanent, więc po testach trzeba czyścić cache klienta.

### Zastrzeżenia (dlaczego „Z ZASTRZEŻENIEM", nie „WYKONALNE")

1. **Wymaga przechwycenia logowania** (albo zasiania sentinela z rodzica). Samo wstrzyknięcie
   nagłówka nie przechodzi route-guarda SPA.
2. **SSE niesie token w URL** (`events/stream?...&token=<localStorage>`). Przy sentinelu to
   nieszkodliwe (nagłówek wstrzyknięty ma pierwszeństwo, `200`). **Ale to jest dodatkowy
   argument przeciw B1:** w B1 w tym URL siedzi *prawdziwy* JWT → trafia do logów proxy,
   historii i referrera.
3. **Proxy nadaje wszystkim jedną, wspólną tożsamość admina bez poświadczeń** — logowanie
   przyjmuje cokolwiek. Dla jednoosobowego prototypu za bramką R-A akceptowalne; dla wielu
   użytkowników — nie (brak tożsamości per-osoba; Community i tak nie ma wielu kont, [D35]).
4. **Wylogowanie nie unieważnia serwerowo** — prawdziwy token żyje na proxy. „Logout" czyści
   tylko lokalny sentinel. Rotacja = wymiana tokenu w konfiguracji Caddy.
5. Bramka R-A (P6) staje się **konieczna**: skoro proxy samo dokłada admina Dagu, to każdy,
   kto dosięgnie originu, dostaje UI admina. Origin musi być chroniony sesją.

---

## P5 — minimalny klucz API, który wciąż pozwala tworzyć i uruchamiać DAG-i przez MCP

Role Dagu (z OpenAPI/[D34]): `admin`, `manager`, `developer`, `operator`, `viewer`.
Utworzone klucze `allowedSurfaces:["mcp"]` (bez `rest_api`) i przetestowane wprost przez MCP:

| Rola (mcp-only) | `dagu_read` | `dagu_change` (upsert+apply) | `dagu_execute` (start) |
| --- | --- | --- | --- |
| `viewer` | OK | — (tylko odczyt) | — |
| `operator` | OK | **DENIED** `Insufficient permissions` | OK (istniejący DAG) |
| **`developer`** | **OK** | **OK** `applied=True` | **OK** |

```
operator  dagu_change(apply) -> [{"text": "Insufficient permissions"}]
developer dagu_change(apply) -> OK applied=True
developer dagu_execute(start) -> OK
```

**Minimalna rola: `developer`** z powierzchnią wyłącznie `mcp`. `operator` nie wystarcza
(nie tworzy DAG-ów). `viewer` tylko czyta.

### Czego ten klucz (developer, mcp-only) NIE może

Powierzchnia `mcp` odcina **całe** REST — każde wywołanie kończy się `403`:

```
GET  /api/v1/dags        -> 403        (klucze/uzytkownicy/base config idą przez REST)
GET  /api/v1/api-keys    -> 403
POST /api/v1/api-keys    -> 403        (nie utworzy sobie klucza admina)
GET  /api/v1/users       -> 403
GET  /api/v1/dag-runs    -> 403
(dla porównania: token admina na tych samych ścieżkach -> 200)
```

Czyli klucz `developer`/`mcp` **nie** tknie: kluczy API, użytkowników, `base.yaml` (edytowalny
tylko REST-em z rolą admina — walidacja §3.5), ani żadnego REST-a poza MCP.

### Zastrzeżenia P5 (spina się z P1/P3)

* Zawężenie działa **na płaszczyźnie sterowania (klucz)**. **Płaszczyzna danych — wykonany
  krok — jest nieograniczona:** krok stworzony kluczem `developer` biegnie jako root i czyta
  `config.yaml` (P1) oraz nadpisuje `base.yaml`/`dags/` (P3). Zawężony klucz **nie** zawęża
  tego, co robi krok.
* Community: **maks. 2 klucze API**, brak kont użytkowników, brak RBAC per-osoba ([D35]).
  Trzeci klucz: `403 "Community edition supports up to 2 API keys"`. Nie da się mieć naraz
  admina operatora + osobnego klucza agenta + zapasowego.

---

## P6 — uwierzytelnianie `/api/chat` (R-A): mechanizm sesji, zweryfikowany

Stan zastany (`chat-backend/server.mjs`): `/api/chat` **nie ma żadnej autoryzacji**. Poniższy
mechanizm zbudowano na osobnym stanowisku (Node, `127.0.0.1:9186`), **nie** wpięto do repo.

**Mechanizm:** ciasteczko sesji `HttpOnly; SameSite=Strict; Path=/` z **serwerowym** rejestrem
sesji (unieważnialnym), plus kontrola `Origin`/`Sec-Fetch-Site` na każdym POST-cie.

* **Iframe na tym samym originie:** ramka jest first-party (frame-ancestors 'self'), więc
  ciasteczko `SameSite=Strict` jest wysyłane. Cross-site ramka by go nie dostała — ale
  architektura dopuszcza tylko ten sam origin.
* **Odmowa bez sesji:** brak/wygasłe/unieważnione ciasteczko → `401`.
* **Unieważnienie przy wylogowaniu:** `POST /api/logout` usuwa wpis serwerowy → to samo
  ciasteczko natychmiast nieważne (nie tylko czyszczenie po stronie klienta).
* **Origin/CSRF:** POST z obcym `Origin` (albo bez `Origin` i bez `Sec-Fetch-Site`) → `403`,
  nawet z ważnym ciasteczkiem. `SameSite=Strict` + kontrola `Origin` = podwójna zapora.

### Dowód (kody HTTP)

```
1) /api/chat bez sesji (ten origin)                 -> HTTP 401
2) login złym hasłem                                -> HTTP 401
3) login dobrym hasłem                              -> HTTP 200
   Set-Cookie: sid=<REDACTED>; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800
4) /api/chat z ciasteczkiem sesji (ten origin)      -> HTTP 200
5) /api/chat z ciasteczkiem, ale Origin=evil.example -> HTTP 403   (CSRF zablokowany)
6) logout -> 200,  potem /api/chat tym ciasteczkiem -> HTTP 401   (unieważnienie serwerowe)
7) POST bez Origin i bez Sec-Fetch-Site             -> HTTP 403
```

### Rdzeń kodu (działający fragment stanowiska)

```js
const sessions = new Map()                       // sid -> { exp }   (serwerowy, unieważnialny)
const sameOrigin = (req) => {                     // kontrola CSRF/Origin
  const o = req.headers.origin
  if (o !== undefined) return o === ORIGIN
  const sfs = req.headers['sec-fetch-site']
  if (sfs !== undefined) return sfs === 'same-origin'
  return false                                    // POST bez Origin i bez Sec-Fetch-Site -> odrzuć
}
const validSession = (req) => {
  const sid = cookie(req).sid
  const rec = sid && sessions.get(sid)
  if (!rec || rec.exp < Date.now()) { if (rec) sessions.delete(sid); return false }
  return true
}
// POST /api/login: eq(password, SHARED_PASSWORD) w timingSafeEqual, potem:
//   sessions.set(sid, { exp: Date.now() + TTL })
//   Set-Cookie: `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=...`   (+ Secure pod HTTPS)
// POST /api/chat:
if (!sameOrigin(req)) return send(res, 403, { error: 'zly origin (CSRF)' })
if (!validSession(req)) return send(res, 401, { error: 'brak sesji' })
// ... dopiero teraz wywołanie modelu
// POST /api/logout: sessions.delete(sid) + ciasteczko Max-Age=0
```

**Zastrzeżenia P6:**
* To uwierzytelnia **dostęp do originu**, jedno wspólne hasło operatora. Nie rozróżnia osób
  (spójne z jednoosobowym prototypem i limitem Community).
* Pod HTTPS dodać `Secure` do ciasteczka. Lokalnie po HTTP `Secure` pominięte świadomie.
* Rejestr sesji w pamięci ginie przy restarcie backendu (operator loguje się ponownie) —
  dla trwałości trzeba magazynu; dla prototypu w pamięci wystarcza.
* R-A i R-B są **niezależne**: ta bramka broni originu, ale XSS w już zalogowanej przeglądarce
  operatora działa **wewnątrz** sesji, więc przechodzi przez nią, nie obok — dlatego B2 (P4)
  dokłada osobną warstwę (przeglądarka bez prawdziwego tokenu Dagu).

---

## Propozycja granicy zaufania

Model zagrożeń: **napastnik = kod, który dociera do modelu przez `/api/chat`, oraz krok DAG-a,
który ten kod tworzy.** Gwarancja dotyczy powstrzymania *tego* aktora — nie administratora hosta.

| Aktyw / zdolność | Status | Czym egzekwowane (po wdrożeniu P4+P6) |
| --- | --- | --- |
| Wywołanie modelu na koszt operatora | **chronione** | sesja `/api/chat` (P6): 401 bez sesji, 403 przy obcym Origin |
| Prawdziwy JWT Dagu w przeglądarce | **chronione** | B2 (P4): przeglądarka trzyma sentinel; token tylko na Caddy |
| Powierzchnia sterowania klucza agenta | **chronione** | rola `developer` + `mcp`-only (P5): REST → 403 |
| Usługi hosta na `127.0.0.1` | **chronione** | rootless Docker: brama nie routuje do loopbacku hosta (P2) |
| Dostęp do hosta przez socket Dockera | **chronione** | socket nie montowany (decyzja, potwierdzone) |
| — — — | — — — | — — — |
| Sekret podpisujący JWT / hasło admina wobec **kroku** | **NIECHRONIONE** | krok = root, czyta `config.yaml` (P1) — Community nie izoluje kroku |
| Integralność `base.yaml` / `dags/` wobec **kroku** | **NIECHRONIONE** | krok ma zapis do wolumenu, nadpisuje bramkę i definicje (P3) |
| Eksfiltracja przez egress kroku | **NIECHRONIONE** | otwarty ruch wychodzący z kroku (P2) — brak polityki wyjścia |
| Tożsamość per-osoba, audyt, unieważnienie tokenu Dagu | **NIECHRONIONE** | Community: 1 użytkownik, brak RBAC/audit ([D35]); B2 nie unieważnia serwerowo (P4) |
| Podniesienie kroku do admina Dagu | **NIECHRONIONE** | P1+P3 łącznie: krok zdobywa admina i utrwala się |

### Jawnie POZA gwarancją

**Administrator hosta oraz ktokolwiek z prawem zapisu do `docker-compose.yml`, `base.yaml`
lub katalogu `dags/` jest poza granicą zaufania.** Kto edytuje te pliki, podmienia obraz,
zmienne środowiskowe, montowania albo wstrzykuje dowolny DAG — z definicji przejmuje silnik.
**Nie obiecujemy ochrony przed takim aktorem** i żaden środek z tego raportu jej nie daje.
Gwarancja dotyczy wyłącznie aktora działającego *przez interfejs* (czat → model → MCP → DAG),
nie aktora z dostępem do *warstwy wdrożenia*.

### Zdanie zbiorcze

W wersji Community Dagu **nie da się** domknąć R-C do „krok nie tknie sekretu silnika":
krok biegnie jako root w kontenerze serwera i czyta jego plik konfiguracyjny (P1), a bramka
polityki nie jest granicą, bo krok pisze po `dags/`/`base.yaml` (P3). R-A (P6) i R-B (P4) są
domykalne i zweryfikowane. R-C wymaga **realnej izolacji wykonania** (executor kontenerowy —
socket Dockera, świadomie odrzucony; albo osobna instancja/host silnika dla agenta; albo
Dagu Pro) — i to jest decyzja dla operatora, nie do rozstrzygnięcia w tym audycie.

---

## Czego NIE sprawdziłem (jawna lista)

1. **Executor kontenerowy jako izolacja P1/P3** — wymaga socketu Dockera, którego nie
   montowałem. Nie wiem, czy `container.run` z osobnym userem faktycznie odcina odczyt
   `config.yaml`; teoretycznie tak, ale niezweryfikowane.
2. **Podniesienie uprawnień kroku przez capabilities** (`SETUID`/`DAC_OVERRIDE` są obecne) —
   nie próbowałem wychodzić poza kontener; sprawdziłem tylko dostęp do FS i sieci.
3. **Path traversal w nazwie DAG-a / w ścieżkach MCP** (`../`) — poza tym badaniem
   (sygnalizowane w walidacji §6 poz. 10).
4. **Podmiana definicji dokładnie w oknie walidacja→start przez sam MCP** (bez zapisu pliku) —
   pokazałem TOCTOU przez zapis pliku (P3); czysto-MCP-owego wyścigu nie mierzyłem.
5. **Trwałość i skala sesji P6** — rejestr w pamięci, jeden proces; nie testowałem wielu
   instancji backendu ani współdzielonego magazynu sesji.
6. **`Secure`/HTTPS i realne SameSite w prawdziwej przeglądarce dla P6** — dowód P6 jest przez
   `curl` (semantyka cookie/Origin), nie przez pełny render iframe; zachowanie SameSite w
   ramce same-origin przyjąłem ze specyfikacji, nie zmierzyłem w Chrome.
7. **Wygaśnięcie/rotacja tokenu Dagu w B2** — sprawdziłem token ważny ~24 h; nie testowałem
   zachowania proxy po jego wygaśnięciu (SPA z sentinelem nie wie o wygaśnięciu edge-tokenu).
8. **Blokada egressu kroku** (`internal: true` / polityka wyjścia) — zidentyfikowana jako
   luka (P2), ale środka zaradczego nie wdrożyłem ani nie zmierzył.
9. **Zachowanie przy `remoteNode`/trybie rozproszonym** (`coordinator`+`worker`) — badałem
   `start-all` w jednym procesie.
10. **Interpolacja/pułapki w `respond` Caddy dla różnych treści logowania** — sprawdziłem
    jeden kształt odpowiedzi sentinel; nie testowałem, czy przyszłe wersje SPA wymuszą
    dodatkowe pola w odpowiedzi `/auth/login`.
