# Raport T5-fin — odbiór uzupełniający: E5, E7, R07, komplet testów

Autor: niezależny tester (T5-fin). Nie jestem autorem implementacji.
Data: **2026-09-20**. Uzupełnia `docs/odbior-faza-1.md` §5 (odbiór z 17/18 zaliczonych,
R07 niezweryfikowany) i zamyka pozycje E5/E7 z §7 pkt 3 `docs/raport-t3-integracja.md`.

## 0. Rezultat w jednym akapicie

Wszystkie cztery pozycje wykonane i **zaliczone**: E5 (restart silnika w trakcie
wieloetapowego przebiegu → zombie detector → `failed` po ~85 s → `retry` na tym samym
`dagRunId`, ukończone kroki **nie powtórzyły** skutków), E7 (drill wycofania na kopii
wolumenu n8n: **15 procesów / 12 wykonań** potwierdzone REST-em, powrót na Dagu kopii,
oryginał nietknięty — sumy SHA-256 9/9 przed i po), R07 (oba warianty, „brak pliku"
i „wygasły token": health 200, `/api/chat` **503**, **zero** procesów `claude`), komplet
testów repo (202/202: kontrakt 40, backend 162). Koszt drilu: **0 USD** — żadnego
wywołania modelu, także na kopii.

## 1. Stanowisko kopii

Katalog poza repozytorium: `~/stanowiska/t5-stanowisko/` (projekt compose
`t5-stanowisko`, porty **98xx** — poza zajętymi zakresami 8080, 91xx, 92xx, 93xx, 9401,
96xx, 9701/9702). Zawartość: `docker-compose.yml` (usługi `dagu`, `chat`,
`poswiadczenia`, `n8n` za profilem `n8n`), kopia definicji `dags/` (skopiowana, **nie**
współdzielona z repo — żywy silnik nigdy nie widział plików drillowych) oraz
`seed-poswiadczen/` — sterowany seed poświadczeń dla R07.

| Usługa kopii | Obraz / źródło | Adres |
| --- | --- | --- |
| `t5-dagu` | ten sam digest `ghcr.io/dagucloud/dagu@sha256:b242dc7b…` | bez publikowanego portu (tylko sieć `internal`) — sterowanie `docker exec`, jak `wycofanie.md` §6.3 |
| `t5-chat` | ten sam obraz co żywy kontener: `n8niframe-chat-backend:latest` (`3cef51aae5e9`) | `127.0.0.1:9802` |
| `t5-poswiadczenia` | `alpine:3.22`, ta sama pętla co w repo | bez sieci |
| `t5-n8n` | `n8nio/n8n:2.38.7`, profil `n8n` | `127.0.0.1:9878` |

**Wolumeny kopii** (prefiks `t5_`, wszystkie utworzone przez tar z oryginałów
montowanych `:ro`; oryginały nietykalne):

* `t5_dagu_data` ← `n8niframe_dagu_data` (tar-pipe, ekstrakcja jako uid 0 — Dagu na
  kopii biegnie z `PUID=0` jak żywy);
* `t5_n8n_data` ← `n8niframe_n8n_data` (tar-pipe, ekstrakcja jako root + chown
  `1000:1000` — patrz lekcja w §3.4);
* `t5_dagu_bazowy`, `t5_zezwolenia`, `t5_poswiadczenia` — świeże (odpowiedniki
  wolumenów roboczych, nie noszą danych).

Klucze i sekrety: `.env` stanowiska to **dowiązanie** do `.env` repozytorium, więc kopia
miała ten sam sekret JWT i te same klucze API silnika (skopiowane w wolumenie) — żadna
wartość sekretu nie została wypisana w żadnym logu drillu.

**Celowo pominięte na kopii:** proxy (Caddy) i frontend — E5/E7/R07 nie testują routingu
ani osadzania (to pokrywa odbiór R01/R04/R11/R13 z §5 `odbior-faza-1.md`). Tym samym
publikacja portów `chat`/`n8n` na `127.0.0.1` jest artefaktem stanowiska, nie wzorcem
dla produkcji.

## 2. E5 — restart w trakcie przebiegu + ręczny retry

### 2.1 Procedura

Komendy poniżej uruchamiane z katalogu stanowiska (`~/stanowiska/t5-stanowisko`),
z pozyskanym do zmiennej `DAGU_PROXY_TOKEN` kluczem administratora (`.env`, wartość
niewypisywana). Drillowy DAG `t5-e5-dlugi` (definicja w `~/stanowiska/t5-stanowisko/dags/`, **poza
repozytorium**): łańcuch 4 kroków w schemacie `premie-od-pensji` (każdy krok z `output:`
i pełnym `output_schema`), czasy: krok1 = 3 s, krok2 = 3 s, krok3 = **180 s**, krok4 = 2 s.
Każde wykonanie kroku dokłada dwie linie (start/koniec ze znacznikiem epoki) do pliku
`/var/lib/dagu/t5-efekty/przebieg.log` w wolumenie kopii — **efekt uboczny, który
przeżywa restart**. Skrypt kroku: `dags/skrypty/t5-krok.sh`.

```
docker exec t5-dagu sh -c 'rm -rf /var/lib/dagu/t5-efekty'                 # czysty start
jq -n --rawfile spec dags/t5-e5-dlugi.yaml \
     '{spec:$spec, name:"t5-e5-dlugi", dagRunId:"t5-e5-run-01"}' > /tmp/t5-e5-body.json
docker cp /tmp/t5-e5-body.json t5-dagu:/tmp/body.json
docker exec -e TOKEN="$DAGU_PROXY_TOKEN" t5-dagu sh -c \
  'curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    --data @/tmp/body.json http://127.0.0.1:8080/dagu/api/v1/dag-runs'
# -> {"dagRunId":"t5-e5-run-01"}        start 12:39:33
```

### 2.2 Stan przed restartem (12:39:42)

```
GET /dagu/api/v1/dag-runs/t5-e5-dlugi/t5-e5-run-01
statusLabel=running
krok1  succeeded  12:39:33 → 12:39:36
krok2  succeeded  12:39:36 → 12:39:39
krok3  running    12:39:39 → (w toku)        ← restart w jego trakcie
krok4  not_started

przebieg.log (5 linii):
krok1 start=1789900773.315441270 pid=143
krok1 koniec=1789900776.323133080
krok2 start=1789900776.370868343 pid=149
krok2 koniec=1789900779.376614532
krok3 start=1789900779.426904082 pid=157
```

### 2.3 Restart i zachowanie zombie detector

```
date -Is; time docker restart t5-dagu; date -Is
# 2026-09-20T12:40:07+02:00
# t5-dagu   real 0m0.314s
# 2026-09-20T12:40:08+02:00
```

Silnik po starcie loguje `Started zombie detector interval=45s`. Odpytywanie co 10 s:
`running` do t+70 s, **`failed` obserwowany przy t+80 s**; znacznik `finishedAt` kroku
`12:41:33` = **85 s** po restarcie — w oknie ~45–90 s z audytu [D20].

```
statusLabel: failed
krok1  succeeded  12:39:33 → 12:39:36                       (bez zmian)
krok2  succeeded  12:39:36 → 12:39:39                       (bez zmian)
krok3  failed     12:39:39 → 12:41:33
       error: "process terminated unexpectedly - stale local process detected"
krok4  failed     → 12:41:33   (ten sam komunikat — przerwany z góry po porażce zależności)
```

### 2.4 Retry na tym samym runId

```
date -Is   # 2026-09-20T12:41:57+02:00
docker exec -e TOKEN="$DAGU_PROXY_TOKEN" t5-dagu sh -c \
  'curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{}" -w "\nHTTP:%{http_code}\n" \
    http://127.0.0.1:8080/dagu/api/v1/dag-runs/t5-e5-dlugi/t5-e5-run-01/retry'
# HTTP:200
```

Po ~183 s: `statusLabel=succeeded` (krok3 od zera 180 s + krok4 2 s).

### 2.5 Dowód 1 — kroki ukończone nie powtórzyły skutków

Znaczniki z API, przed restartem kontra po udanym retry — **identyczne co do znaku**:

```
           PRZED restartem            PO retry
krok1  12:39:33 → 12:39:36         12:39:33 → 12:39:36   (bez zmian)
krok2  12:39:36 → 12:39:39         12:39:36 → 12:39:39   (bez zmian)
```

Efekty uboczne (`przebieg.log`) — po retry **9 linii**: krok1 i krok2 mają nadal po
jednej parze start/koniec z **oryginalnymi** znacznikami epoki (`1789900773.315441270`
itd.), zero duplikatów; doszły wyłącznie wpisy krok3/krok4 z czasu po retry:

```
krok1 start=1789900773.315441270 pid=143        ← te same wartości co w 2.2
krok1 koniec=1789900776.323133080
krok2 start=1789900776.370868343 pid=149
krok2 koniec=1789900779.376614532
krok3 start=1789900779.426904082 pid=157        ← próba przerwana restartem
krok3 start=1789900917.325909917 pid=120        ← jedyna nowa próba (po retry)
krok3 koniec=1789901097.328838110
krok4 start=1789901097.359730121 pid=205
krok4 koniec=1789901099.362746947
```

Silnik potwierdza to sam: krok1/krok2 serwują stdout z katalogu przebiegu
**sprzed restartu** (`run_20260920_103933Z_96ae17`), krok3/krok4 z nowego katalogu
`run_20260920_104157Z_a53cd6` — oba pod tym samym `dagRunId`:

```
cat …/dag-run_20260920_103933Z_t5-e5-run-01/run_20260920_103933Z_96ae17/Krok_1…out
{"krok":"krok1","start":"1789900773.315441270","koniec":"1789900776.323133080","sekundy":3}
cat …/dag-run_20260920_103933Z_t5-e5-run-01/run_20260920_104157Z_a53cd6/Krok_3…out
{"krok":"krok3","start":"1789900917.325909917","koniec":"1789901097.328838110","sekundy":180}
```

### 2.6 Dowód 2 — wznowienie od miejsca awarii, ten sam runId

`retry` (bez `stepName`) uruchomił **wyłącznie** krok3 (od zera, w całości — bo krok nie
ukończony) i krok4 (`12:44:57 → 12:44:59`); krok1/krok2 nie zostały dotknięte (§2.5).
Wszystkie odczyty po retry poszły z tego samego adresu
`/dag-runs/t5-e5-dlugi/t5-e5-run-01` — **ten sam `dagRunId`**, dokładnie jak w audycie
[D7]. To potwierdza na prawdziwym module kluczową własność z audytu Dagu §5 (wiersz 9):
*Dagu nie wznawia samo, ale `retry` wznawia od miejsca awarii bez powtarzania
ukończonych kroków* — auto-retry po stronie naszego kodu pozostaje jedyną brakującą
warstwą (poza zakresem T5-fin, zgodnie z ograniczeniem „bez nowego watchdoga").

**E5: ZALICZONY** (zachowanie zgodne z audytem [D20]+[D7]: brak auto-wznowienia, ~85 s do
`failed`, ręczny `retry` wznowieniem od miejsca awarii).

## 3. E7 — drill wycofania na kopii

### 3.1 Warunek wstępny: oryginał spoczywa

`n8niframe-n8n`: `Exited (0) 38 hours ago` — wolumen `n8niframe_n8n_data` nie był
otwierany. Manifest sum kontrolnych **przed** drillem (montaż wyłącznie `:ro`):

```
docker run --rm -v n8niframe_n8n_data:/v:ro -v /tmp:/out alpine sh -c \
  'cd /v && find . -type f -print0 | sort -z | xargs -0 sha256sum > /out/przed.sha256'
# 9 plików: config, database.sqlite(+ -shm, -wal), 4× n8nEventLog*, nodes/package.json
```

### 3.2 Snapshot oryginału do NOWEGO wolumenu (oryginał tylko do odczytu)

```
docker run --rm -v n8niframe_n8n_data:/from:ro alpine tar c -C /from . \
  | docker run -i --rm -v t5_n8n_data:/to alpine tar x -C /to
docker run --rm -v t5_n8n_data:/v alpine chown -R 1000:1000 /v
```

Weryfikacja kopii względem źródła (suma po sumie):

```
cd /a && find . -type f -print0 | sort -z | xargs -0 sha256sum > /out/zrodlo.txt
cd /b && … > /out/kopia.txt ; diff …
# WYNIK: kopii i oryginał identyczne — 9/9 plików, sumy zgodne
ls -ln /v  →  własność 1000:1000, tryby zachowane (config 0600, 56 B)
```

### 3.3 n8n na kopii — potwierdzenie 15 procesów i 12 wykonań

Mechanizm jak w `wycofanie.md` §2 — profil Compose, na stanowisku kopii:

```
cd ~/stanowiska/t5-stanowisko
docker compose --profile n8n up -d n8n          # 12:48:28 → Started
curl http://127.0.0.1:9878/healthz              # HTTP 200 po 5 s
```

```
CIA=$(mktemp)
curl -s -o /dev/null -w '%{http_code}' -c "$CIA" -X POST http://127.0.0.1:9878/rest/login \
  -H 'Content-Type: application/json' -H 'browser-id: t5-drill' \
  -d '{"emailOrLdapLoginId":"admin@admin.com","password":"Admin123"}'
# -> 200

curl -s -b "$CIA" 'http://127.0.0.1:9878/rest/workflows?limit=100'   -> .data | length  = 15
curl -s -b "$CIA" 'http://127.0.0.1:9878/rest/executions?limit=100'  -> .data.count     = 12
```

Wykonania 1–12, wszystkie `success`, tryb `manual`, 2026-09-14 … 2026-09-18 — w tym
**wykonanie #12 dokładnie z wartości odniesienia R03** (`Status OK`,
`workflowId=gnzjOf2qHJoEPeGo`, `2026-09-18T12:48:44.085Z`). Żadnej operacji zapisu
przez REST nie wykonano (odczyty list i logowanie).

### 3.4 Powrót na Dagu kopii i nienaruszalność oryginału

```
docker compose --profile n8n stop n8n     # t5-n8n: Exited (0)
docker ps -a --filter name=n8niframe-n8n  # ORYGINAŁ: Exited (0) 38 hours ago (bez zmian)
# manifest sum PO drilu, montaż :ro:
diff przed.sha256 po.sha256               # brak różnic
# ORYGINAŁ NIETKNIĘTY: sumy 9/9 identyczne przed i po drilu
# kopia Dagu dalej w roli silnika:
GET /dagu/api/v1/dags (kopii)  -> HTTP 200, DAG-ów: 7
```

**Lekcja proceduralna** (do ewentualnej poprawki `wycofanie.md` §4.4): tar-pipe do
świeżego wolumenu wymaga, by **ekstrahujący** kontener miał prawo tworzenia plików —
katalog główny nowego wolumenu jest własnością `root:root`, a `n8n` w kontenerze biegnie
jako uid 1000. Pierwsze podejście (`--user 1000:1000` w ekstrakcji) skończyło się
`tar: can't open './config': Permission denied` i zerwanym potokiem; działające warianty:
ekstrakcja jako root + `chown -R 1000:1000` (użyte wyżej) albo wcześniejsze
`chown 1000:1000` katalogu głównego wolumenu. To nie kłóci się z `--user 0:0` z
`wycofanie.md` §4.4 (to jest cel próby odtworzenia, nie kopiowania); sed pozostaje ten
sam: **ekstrakcja na root + normalizacja własności, nigdy zapis do oryginału.**

**E7: ZALICZONY** — procedura wycofania przećwiczona na kopii w całości: snapshot →
n8n przeciw kopii → 15/12 → powrót na Dagu; oryginał nietknięty (dowód kryptograficzny).

## 4. R07 — wygasłe/brak poświadczeń (na kopii)

Stanowisko: `t5-chat` (`SESJA_ORIGIN=http://127.0.0.1:9802`) + `t5-poswiadczenia`
czytający seed z `~/stanowiska/t5-stanowisko/seed-poswiadczen/` (pętla co 5 s, ta sama
logika `sledz()` co w repo). Żadnych prawdziwych poświadczeń na kopii.

### 4.1 Wariant „brak pliku" (seed pusty od startu kopii)

```
curl -s -w '\nHTTP:%{http_code}\n' http://127.0.0.1:9802/api/health
{"ok":true,"credentials":"brak-poswiadczen","expiresAt":null,"polityka":"gotowa","sesja":"podpieta"}
HTTP:200

POST /api/chat bez sesji   -> HTTP:401                                   (brama sesji, przed 503)
POST /api/sesja/logowanie  -> HTTP:200 {"ok":true,…}                     (sesja kopii)
POST /api/chat z sesją     -> HTTP:503
{"error":"Backend nie widzi poświadczeń Claude Code. Sprawdź, czy ~/.claude/.credentials.json
istnieje na hoście i czy kontener ma go zamontowanego."}

docker exec t5-chat sh -c 'ps -ef | grep -c "[c]laude"'   # PRZED: 0, PO: 0
```

Wartość odniesienia baseline §6.6 (`{"ok":true,"credentials":"brak-poswiadczen",
"expiresAt":null}`, chat 503, zero `claude`) odtworzona dosłownie; dwa dopisane pola
(`polityka`, `sesja`) to stan modułów T1/T2, obecne też na żywym stacku.

### 4.2 Wariant „wygasły token"

Do seeda trafił **spreparowany** plik (jawnie fałszywe tokeny, brak sekretów) z
`expiresAt` z wartości odniesienia baseline:

```
WYGR=$(date -u -d 2026-09-15T14:04:36.097Z +%s%3N)        # 1789481076097
jq -n --argjson e "$WYGR" '{claudeAiOauth:{accessToken:"FAKSYFIKOWANY-TOKEN-DRILL-R07…",
  refreshToken:"FAKSYFIKOWANY-REFRESH-DRILL-R07", expiresAt:$e, scopes:["user:profile"],
  subscriptionType:"max"}}' > seed-poswiadczen/.credentials.json
sleep 8    # pętla posrednika: "poswiadczenia odswiezone 2026-09-20T10:52:02+00:00"
```

```
curl -s -w '\nHTTP:%{http_code}\n' http://127.0.0.1:9802/api/health
{"ok":true,"credentials":"wygasle","expiresAt":"2026-09-15T14:04:36.097Z","polityka":"gotowa","sesja":"podpieta"}
HTTP:200

POST /api/chat z sesją -> HTTP:503
{"error":"Logowanie Claude Code wygasło. Uruchom `claude` na hoście (wystarczy raz) —
odświeży token, a czat zacznie działać bez restartu kontenera."}

docker exec t5-chat sh -c 'ps -ef | grep -c "[c]laude"'   # 0
```

Wartość odniesienia baseline §3.6 odtworzona **co do znaku**, łącznie z `expiresAt`
(`2026-09-15T14:04:36.097Z`) i treścią komunikatu 503. Ścieżka 503 zapada przed
uruchomieniem CLI — zero procesów `claude` przed i po obu wariantach; koszt 0.

**R07: ZALICZONY (oba warianty).** Konsekwencja dla macierzy: wiersz R07 w
`docs/odbior-faza-1.md` §2/§5 może zmienić `niezweryfikowane` → `zaliczony 2026-09-20`
(na kopii stacku; ścieżka kodu bez zmian wobec baseline — `credentials.mjs`
`credentialStatus()` decydował, CLI nie startowało).

## 5. Komplet testów repo

| Pakiet | Komenda | tests | pass | fail |
| --- | --- | --- | --- | --- |
| `tests/` (kontrakt K1–K7, własny stack `dagu-test` na 9401, sprząta po sobie) | `bash tests/uruchom.sh` | 40 | **40** | **0** |
| `chat-backend` razem | `node --test 'chat-backend/test/*.test.mjs' 'chat-backend/test/polityka/*.test.mjs' 'chat-backend/test/sesja/*.test.mjs'` | 162 | **162** | **0** |
| — poświadczenia (`credentials.mjs`, zawiera testy naprawy GLM) | `node --test 'chat-backend/test/*.test.mjs'` | 9 | 9 | 0 |
| — polityka (T2) | `node --test 'chat-backend/test/polityka/*.test.mjs'` | 136 | 136 | 0 |
| — sesja (T1/brama) | `node --test 'chat-backend/test/sesja/*.test.mjs'` | 17 | 17 | 0 |

Środowisko: node **v24.19.0** na hoście. Uwaga praktyczna: forma `node --test test/`
(katalog nago) na node 24 kończy się `MODULE_NOT_FOUND`; działają globy per pakiet —
dokładnie takie, jakie dokumentuje `docs/raport-t2-polityka-kontraktu.md` i
`chat-backend/KONTRAKT.md` §417. Żaden test nie wymagał żywego stacku 8080;
`tests/uruchom.sh` podniósł własny projekt `dagu-test` (port 9401) i posprzątał go po
sobie (pułapka `trap`), nie dotykając stanowisk 91xx–96xx.

## 6. Zmiany stanu i sprzątanie

1. **Żywy stack (8080): wyłącznie odczyt** `GET /api/health` (raz, na końcu: 200,
   `"credentials":"wazne"`, `expiresAt 2026-09-20T17:27:35Z`). Pięć kontenerów `Up`
   bez restartów (uptime'y identyczne z początkiem sesji: proxy/frontend 26 h,
   chat/dagu/poswiadczenia 11–12 h). Żadnego `POST` ani `/api/chat`.
2. **Oryginalne wolumeny**: `n8niframe_n8n_data` — dowód nienaruszalności (SHA-256
   9/9 przed i po, §3.1–3.4); `n8niframe_dagu_data` — tylko montaż `:ro` podczas
   tar-pipe; pozostałe oryginalne wolumeny nietknięte.
3. **Stanowisko kopii** (`~/stanowiska/t5-stanowisko/`): kontenery `t5-*` i sieci
   zdjęte (`docker compose down` **bez** `-v`); wolumeny kopii `t5_dagu_data`,
   `t5_n8n_data`, `t5_dagu_bazowy`, `t5_zezwolenia`, `t5_poswiadczenia` świadomie
   zostają na dysku (dowody drillów: historia `t5-e5-run-01` z katalogami
   przed-restartem i po-retry, kopia n8n) i do kasowania przy kolejnym sprzątaniu;
   seed poświadczeń zresetowany do pustki (spreparowane poświadczenia usunięte,
   pośrednik zdążył skasować ich kopię z wolumenu przed zdjęciem stosu).
4. **Repozytorium**: jedyny nowy plik to ten raport. `dags/` bez diffu, `git status`
   bez zmian poza stanem sprzed zadania. Skrypty drillu — świadomie **poza** repo
   (stanowisko), bo są jednorazowe; ich dosłowna treść jest cytowana w §2/§4.
5. **Koszt**: 0 USD (zero wywołań modelu — także na kopii; R07 z definicji nie startuje
   CLI, a E5/E7 są poniżej warstwy modelu).
6. Stanowiska obce nietknięte: `dagu-sec` (91xx), `dagu-policy` (92xx),
   `n8n-fixture` (93xx), `kestra-local`, kontenery `t3-*` (nieuruchomione),
   `proba-*` (wolumeny pozostałe po wcześniejszych próbach, bez zmian).

## 7. Wnioski dla dokumentów odbiorczych (do decyzji autora macierzy)

* `odbior-faza-1.md`: R07 do odhaczenia jako zaliczony (§4.1–4.2 powyżej); podsumowanie
  przechodzi na **18/18**.
* `decyzja-architektoniczna.md` §13.5 / raport T3 §7 pkt 3: E5 i E7 mają teraz dowody
  wykonawcze; brakującą warstwą pozostaje wyłącznie **automatyczny** retry po stronie
  backendu (decyzja §7.2 pkt 9 to przewiduje jako „dopisać auto-retry do naszego kodu").
* `wycofanie.md` §4.4: dopisać niuans ekstrakcji tar-pipe do świeżego wolumenu
  (ekstrakcja jako root + `chown -R 1000:1000`, albo wcześniejsze przejęcie katalogu
  głównego wolumenu) — bez tego pierwszy przebieg procedury kończy się błędem tar
  na pliku `config` (klucz szyfrowania, tryb 0600).
