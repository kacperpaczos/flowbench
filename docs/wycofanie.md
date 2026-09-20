# Wycofanie Fazy 1 — procedura krok po kroku

Dokument operacyjny do `docs/decyzja-architektoniczna.md` §11. Opisuje trzy rzeczy:
**jak wrócić do n8n**, **co jest w kopii zapasowej** i **jak z tej kopii odtworzyć dane**.

Wszystkie polecenia uruchamia się z katalogu prototypu
(`/home/paczos/Documents/BetterProton/n8nIframe`).

> **Zakazane na każdym etapie**, bez wyjątków:
> `docker compose down -v`, `docker volume rm`, `docker system prune`.
> Każde z nich kasuje wolumen `n8niframe_n8n_data`, czyli jedyny egzemplarz
> 15 procesów i 12 wykonań, których nie da się odtworzyć z repozytorium.

---

## 1. Co w ogóle znaczy „wycofanie"

Faza 1 **nie zastąpiła** starego silnika, tylko postawiła nowy obok. Dlatego są
dwa różne poziomy cofania i trzeba wiedzieć, którego się potrzebuje:

| Poziom | Kiedy | Czas |
| --- | --- | --- |
| **A. Włącz stary silnik obok nowego** | chcesz zajrzeć do n8n, porównać wynik, odzyskać coś z historii | ~1 min |
| **B. Pełny powrót do stanu zastanego** | Faza 1 ma zostać odwołana w całości | ~5 min |

Poziom A niczego nie psuje i nie wymaga dotykania Gita.

---

## 2. Poziom A — stary silnik obok nowego

Usługa `n8n` siedzi za profilem Compose, więc `docker compose up -d` jej **nie** uruchamia.
Włącza się ją jawnie:

```sh
docker compose --profile n8n up -d n8n
```

Po kilkudziesięciu sekundach edytor jest pod `http://127.0.0.1:8080/n8n/`
(konto `admin@admin.com`, hasło demonstracyjne `Admin123` — lokalne, odnotowane w §11 decyzji).

Wyłączenie z powrotem:

```sh
docker compose --profile n8n stop n8n
```

**Przećwiczone 2026-09-18** — pełny wynik w raporcie T1:

```
docker compose --profile n8n up -d n8n      -> Container n8niframe-n8n Started
POST /n8n/rest/login                        -> HTTP 200
GET  /n8n/rest/workflows?limit=100          -> procesow: 15
GET  /n8n/rest/executions?limit=100         -> wykonan:  12
```

Uwaga, która bywa myląca: **krok DAG-a nadal nie dosięga `n8n`**, nawet gdy n8n chodzi —
stary silnik ma własną sieć `wycofanie`, dzieloną wyłącznie z proxy:

```
dagu: getent hosts n8n   -> NAZWA NIEROZWIAZANA
dagu: curl http://n8n:5678/ -> brak polaczenia
```

---

## 3. Poziom B — pełny powrót do stanu zastanego

Punkt wycofania: commit `931e6b3`, tag **`stan-zastany-n8n`** — działający prototyp
na n8n 2.38.7, przed jakąkolwiek zmianą silnika.

```sh
# 1. Zatrzymaj stack Fazy 1. BEZ -v — to jest ta jedna flaga, która kasuje dane.
docker compose --profile n8n stop

# 2. Wróć do stanu zastanego.
git switch main
#    albo, jeśli main poszedł dalej:
#    git checkout stan-zastany-n8n

# 3. Przywróć plik .env do postaci sprzed Fazy 1.
#    .env NIE jest w repozytorium, więc `git switch` go nie zmienia.
#    Stan zastany potrzebuje wyłącznie N8N_MCP_TOKEN; reszta kluczy jest nieszkodliwa,
#    ale porządniej ją usunąć.

# 4. Przebuduj obrazy i podnieś stary stack.
docker compose up -d --build
```

Aplikacja wraca na `http://127.0.0.1:8080/`, edytor n8n na `/n8n/`.
Żadnego ręcznego odtwarzania plików: definicje, historia i klucz szyfrowania siedzą
w wolumenie `n8niframe_n8n_data`, którego Faza 1 nie tknęła.

### Czego wycofanie NIE cofa

* **Wolumeny Fazy 1** zostają na dysku. To jest celowe — gdyby Fazę 1 wznowiono, nic nie
  przepada. Nie ma powodu ich kasować, a `docker volume rm` jest zakazane.

  | Wolumen | Co trzyma |
  | --- | --- |
  | `n8niframe_dagu_data` | całe `/var/lib/dagu`: definicje, historia, logi, klucze API, `config.yaml` |
  | `n8niframe_dagu_bazowy` | sam `base.yaml` — zapis dla silnika, odczyt dla warstwy polityki |
  | `n8niframe_zezwolenia` | dziennik zezwoleń warstwy polityki (przeżywa `recreate` backendu) |
  | `n8niframe_poswiadczenia` | jedna kopia `.credentials.json` z hosta |
* **Klucze API Dagu** dalej istnieją wewnątrz tego wolumenu. Jeśli wycofanie jest trwałe,
  unieważnij je (§6.3) zanim porzucisz instancję.
* **Kopia zapasowa** w `~/kopie-n8niframe/` zostaje. Patrz §4.

---

## 4. Kopia zapasowa i odtworzenie z niej

### 4.1 Gdzie leży

```
~/kopie-n8niframe/<RRRRMMDD-GGMMSS>/
├── MANIFEST.txt                            # co, kiedy, z jakiego commitu, z jakimi liczbami
├── SUMY.sha256                             # sumy kontrolne
├── n8n/database.snapshot.sqlite            # online-backup SQLite — ZRODLO AUTORYTATYWNE
└── wolumeny/
    ├── n8niframe_n8n_data.tar.gz           # caly wolumen: baza + WAL + config + nodes/
    ├── n8niframe_caddy_data.tar.gz
    └── n8niframe_caddy_config.tar.gz
```

Kopia jest **poza repozytorium** i poza katalogiem prototypu. `.gitignore` i tak wyklucza
`*.sqlite` oraz `snapshots/`, ale kopia nie leży nawet w drzewie projektu.

### 4.2 Dlaczego `.backup`, a nie zwykłe kopiowanie pliku

Baza n8n jest **żywa i w trybie WAL**. Skopiowanie samego `database.sqlite` (np. `docker cp`)
daje wynik, który wygląda na poprawny i **cicho gubi dane**. Zmierzone na tej bazie:

```
migawka .backup (online-backup)   : 15 workflow / 12 wykonan / 12 execution_data, 4 wersje Premii
naiwna kopia samego database.sqlite: 12 workflow /  5 wykonan /  5 execution_data, 0 wersji Premii
PRAGMA integrity_check             : "ok" w OBU przypadkach
```

`integrity_check` mówi „ok", bo plik jest spójny — tylko starszy o całą zawartość WAL.
Dlatego migawkę robi się wyłącznie natywnym online-backupem SQLite.

### 4.3 Jak zrobić nową kopię

```sh
KOPIA="$HOME/kopie-n8niframe/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$KOPIA/n8n" "$KOPIA/wolumeny"

# Spójna migawka bazy. Wolumen montowany WYLACZNIE read-only.
docker run --rm -v n8niframe_n8n_data:/vol:ro -v "$KOPIA/n8n":/out alpine:latest sh -c '
  apk add --no-cache sqlite >/dev/null &&
  sqlite3 "file:/vol/database.sqlite?mode=ro" ".backup /out/database.snapshot.sqlite"'

# Caly wolumen (klucz szyfrowania w `config`, nodes/, binaryData).
docker run --rm -v n8niframe_n8n_data:/vol:ro -v "$KOPIA/wolumeny":/out alpine:latest \
  tar -czf /out/n8niframe_n8n_data.tar.gz -C /vol .

( cd "$KOPIA" && find . -type f \( -name '*.tar.gz' -o -name '*.sqlite' \) -printf '%P\n' \
  | sort | xargs sha256sum > SUMY.sha256 )
```

### 4.4 Jak odtworzyć — i jak to sprawdzić

Procedura nieprzećwiczona nie jest procedurą, więc poniżej jest ta, którą przećwiczono
**2026-09-18**, razem z jej wynikiem.

> **Niuans ekstrakcji tar-pipe do świeżego wolumenu** (z drillu uzupełniającego,
> 2026-09-20 — raport t5 §7): poniższa próba rozpakowuje do katalogu `mktemp`, natomiast
> odtworzenie prosto do **nowego** wolumenu Dockera robi się przez potok
> `tar -xzf - -C /data` w kontenerze — i wtedy pliki powstają jako **root**, a pierwszy
> przebieg kończy się błędem tar na pliku `config` (klucz szyfrowania, tryb 0600).
> Po ekstrakcji trzeba jawnie oddać własność: `chown -R 1000:1000` na zawartość wolumenu,
> albo przejąć katalog główny wolumenu jeszcze przed rozpakowaniem.

```sh
KOPIA=~/kopie-n8niframe/<wybrana>
( cd "$KOPIA" && sha256sum --check SUMY.sha256 )          # 1. sumy

PROBA=$(mktemp -d)                                         # 2. rozpakowanie
tar -xzf "$KOPIA/wolumeny/n8niframe_n8n_data.tar.gz" -C "$PROBA"

# 3. start n8n PRZECIW KOPII, na porcie prob (95xx), nie przeciw wolumenowi produkcyjnemu.
#    --user 0:0 bo Docker jest rootless: uid 0 w kontenerze = wlasciciel plikow na hoscie.
#    N8N_USER_FOLDER jawnie, bo n8n liczy katalog danych z os.homedir(), a HOME roota to /root.
docker run -d --name n8n-proba-odzyskania --user 0:0 \
  -e N8N_USER_FOLDER=/home/node -e N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=false \
  -v "$PROBA":/home/node/.n8n -p 127.0.0.1:9578:5678 n8nio/n8n:2.38.7

# 4. sprawdzenie przez REST (nie przez samo "kontener wstal")
CIA=$(mktemp)
curl -s -c "$CIA" -X POST http://127.0.0.1:9578/rest/login -H 'Content-Type: application/json' \
  -H 'browser-id: proba' -d '{"emailOrLdapLoginId":"admin@admin.com","password":"Admin123"}'
curl -s -b "$CIA" -H 'browser-id: proba' 'http://127.0.0.1:9578/rest/workflows?limit=100'

# 5. po sobie. Kontener usuwamy; ZADNYCH operacji na wolumenach.
docker rm -f n8n-proba-odzyskania
docker run --rm -v "$PROBA":/p alpine rm -rf /p/.     # n8n zostawia pliki obcego subuid
```

Wynik próby z 2026-09-18:

```
POST /rest/login (admin@admin.com)  -> HTTP 200
GET  /rest/workflows                -> LICZBA PROCESOW W ODTWORZONEJ BAZIE: 15
GET  /rest/executions               -> LICZBA WYKONAN W ODTWORZONEJ BAZIE: 12
config (klucz szyfrowania)          -> JEST, 56 B, prawa 600
kontrola u zrodla po probie         -> wolumen n8niframe_n8n_data: 15 procesow, nietkniety
```

---

## 5. Odtworzenie danych Dagu

Definicje procesów są w repozytorium (`dags/`), więc `git switch` je przywraca — to jest
cała sztuczka §11 decyzji. W wolumenie `n8niframe_dagu_data` zostaje to, czego w Gicie nie ma:
**historia przebiegów, logi kroków i klucze API**.

Kopia tego wolumenu, gdy potrzebna:

```sh
docker run --rm -v n8niframe_dagu_data:/vol:ro -v "$KOPIA/wolumeny":/out alpine:latest \
  tar -czf /out/n8niframe_dagu_data.tar.gz -C /vol .
```

**Uwaga:** ten wolumen zawiera `config.yaml` z sekretem podpisującym JWT oraz materiał
kluczy API. Archiwum jest tak samo wrażliwe jak `.env` — trzymać poza repozytorium.

Sprawdzone: `docker compose up -d --force-recreate --no-deps dagu` **nie gubi** niczego,
bo montowany jest cały `/var/lib/dagu` jednym wolumenem (audyt [D19] pokazał, że montowanie
samych `dags/` i `data/` gubi logi: 25 katalogów → 2, a log starego przebiegu → HTTP 404):

```
PRZED recreate: przebiegi 1  katalogi z logami 5  pliki logow 4  klucze API 2  definicje 6
PO   recreate: przebiegi 1  katalogi z logami 5  pliki logow 4  klucze API 2  definicje 6
status.jsonl konkretnego starego przebiegu: JEST
```

---

## 6. Rzeczy, o które ktoś zapyta w połowie wycofania

### 6.1 Dlaczego `PUID=0`/`PGID=0` przy Dagu — i czy to znaczy „root na hoście"

**Nie znaczy.** Docker na tym hoście jest **rootless**: uid 0 w kontenerze mapuje się na
uid 1000 (`paczos`) na hoście. `PUID=0` to tutaj „biegnij jako właściciel plików repozytorium",
czyli **najmniejsze uprawnienie, które w ogóle działa**, a nie wygoda. Zmierzone warianty:

| Wariant | nowy plik w `dags/` | **nadpisanie** istniejącego (`upsert_dag`!) | właściciel pliku na hoście | operator może edytować |
| --- | --- | --- | --- | --- |
| `PUID=1000/PGID=1000` (domyślne obrazu) | `Permission denied` | `Permission denied` | — | — |
| `PUID=1000` + `chmod 777 dags/` | OK | **`Permission denied`** | uid 525287 (obcy subuid) | **nie** |
| `PUID=0`/`PGID=1000` | OK | OK | `paczos:525287` (obca grupa) | tak, ale grupa obca |
| **`PUID=0`/`PGID=0`** | **OK** | **OK** | **`paczos:paczos`, prawa 644** | **tak** |

Wariant z `chmod 777` odpada nie z powodu estetyki, tylko dlatego, że **nie działa**:
`dagu_change upsert_dag` nadpisuje cały plik, a nadpisania cudzego pliku `777` na katalogu
nie załatwia. Zostawiłby też w repozytorium pliki, których operator nie może edytować.

### 6.2 Dlaczego proxy jest w sieci `wyjsciowa`

Z powodu technicznego, nie z potrzeby wyjścia na świat. Zmierzone na tym hoście
(Docker 29.8.0, rootless): kontener podpięty **wyłącznie** do sieci `internal: true` nie
dostaje mapowania portu — Docker cicho je gubi:

```
kontener tylko w internal        -> .NetworkSettings.Ports = {"80/tcp":null},  curl -> 000
ten sam kontener + zwykla siec   -> {"80/tcp":[{"HostIp":"127.0.0.1",...}]},   curl -> 200
```

Silnik `dagu` zostaje wyłącznie w `wewnetrzna` i to się nie zmienia.

### 6.3 Unieważnienie kluczy Dagu

Dagu Community dopuszcza **maksymalnie 2 klucze API**, więc rotacja to „skasuj, potem utwórz",
nie „utwórz obok i przełącz".

```sh
read -rs -p 'haslo admina Dagu: ' H; echo
docker compose exec -T -e H="$H" dagu sh -c '
  TOK=$(curl -s -X POST http://127.0.0.1:8080/dagu/api/v1/auth/login \
        -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"$H\"}" \
        | sed -E "s/.*\"token\":\"([^\"]*)\".*/\1/")
  curl -s -H "Authorization: Bearer $TOK" http://127.0.0.1:8080/dagu/api/v1/api-keys
  # DELETE /dagu/api/v1/api-keys/<id> dla kazdego klucza do unieważnienia
'
```

Po wymianie klucza proxy trzeba podmienić `DAGU_PROXY_TOKEN` w `.env` i zrobić
`docker compose up -d proxy`.

### 6.4 Gdzie jest hasło operatora do aplikacji

`SESJA_HASLO` w `.env`. Bez niego brama sesji odmawia każdemu żądaniu (fail closed) —
i tak ma być, bo przy wariancie B2 otwarty origin oznacza otwarty UI administratora Dagu.
