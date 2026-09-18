# Raport T1 — infrastruktura i granice dostępu

Zadanie: postawić działający stack z Dagu obok n8n, utwardzić sieć, wdrożyć wariant B2,
bramę sesji `/api/*` i naprawić dwa błędy zastane. Podstawa:
`docs/decyzja-architektoniczna.md` v3.1 §3, §5.2, §6, §9, §11, §13.3.

Każde twierdzenie poniżej ma pod sobą wklejony output. Gdzie czegoś nie domknąłem,
jest to w §10, nie schowane w środku akapitu.

---

## 1. Kopia zapasowa i próba odzyskania

Kopia leży **poza repozytorium**: `~/kopie-n8niframe/20260918-220353/`
(`MANIFEST.txt`, `SUMY.sha256`, migawka `.backup`, archiwa wolumenów).

Migawkę robi natywny online-backup SQLite, bo baza jest żywa i w trybie WAL.
Kontrola negatywna pokazuje, dlaczego to nie jest formalność:

```
=== A) migawka online-backup (.backup) — zrodlo autorytatywne kopii ===
ok
workflow_entity|15
execution_entity|12
execution_data|12
wersje_premii|4
wykonania_premii|5

=== B) KONTROLA: naiwna kopia samego database.sqlite (bez WAL) ===
ok
workflow_entity|12
execution_entity|5
execution_data|5
wersje_premii|0
wykonania_premii|0

=== C) odtworzenie z archiwum tar (komplet: database.sqlite + -wal + -shm) ===
ok
workflow_entity|15
execution_entity|12
execution_data|12
wersje_premii|4
wykonania_premii|5
```

Naiwna kopia gubi 3 procesy, 7 wykonań i **wszystkie cztery wersje Premii** —
a `PRAGMA integrity_check` mówi `ok` w obu przypadkach. Plik jest spójny, tylko starszy
o całą zawartość WAL.

### Próba odzyskania — przećwiczona, nie opisana

Archiwum rozpakowane do katalogu roboczego, n8n wystartowany **przeciw kopii**
(port prób `127.0.0.1:9578`), sprawdzenie przez REST, nie przez „kontener wstał":

```
POST /rest/login (admin@admin.com)  -> HTTP 200
LICZBA PROCESOW W ODTWORZONEJ BAZIE: 15
  - ag3nCPjnADFqUADE Demo MCP - wartosc zamowienia
  - UQeWUmSDcg9gKXXY Lista produktow i suma zamowienia
  - RZgNoMeoDQro7TPF My workflow
  - ZAo64C4IErU2Wafe My workflow 2
  - 015ihoScqe2goUO7 My workflow 3
  - LHEqv0MBSNZFSeOI My workflow 4
  - I00WFYfg9oDGRu9r My workflow 5
  - aEUUAnNsUr7LJIyr Premie 8% od pensji
  - FNgC8R2d33pddvSa Prosty status OK
  - ymF5aEnjmrNgqu9M Prototyp iframe - test
  - M3HqM75fuSkeM32P Prototyp iframe - test
  - ICRY74rH9w6xbTqr Prototyp iframe - test
  - moHBzpK8zjbeGz95 Prototyp iframe - test
  - gnzjOf2qHJoEPeGo Status OK
  - rnfu7SOGxjqaUbYH Średnia temperatura z trzech miast
LICZBA WYKONAN W ODTWORZONEJ BAZIE: 12
config (klucz szyfrowania): JEST, 56 B, prawa 600
```

Po próbie, kontrola u źródła: `wolumen n8niframe_n8n_data` — 15 procesów, nietknięty.
Wolumen w żadnym kroku nie był montowany inaczej niż `:ro`.

Suma kontrolna sprawdzona drugą drogą (`sha256sum --check`) — wszystkie `OK`.
Procedura krok po kroku: `docs/wycofanie.md` §4.

---

## 2. Stack z Dagu

```
NAME                      SERVICE         STATUS          PORTS
n8niframe-chat            chat-backend    Up              8787/tcp
n8niframe-dagu            dagu            Up              8080/tcp
n8niframe-frontend        frontend        Up              80/tcp
n8niframe-poswiadczenia   poswiadczenia   Up
n8niframe-proxy           proxy           Up              127.0.0.1:8080->80/tcp
```

Usługa `n8n` **nie jest na liście** — siedzi za profilem Compose i domyślnie nie wstaje.
Wolumen `n8niframe_n8n_data` istnieje, nietknięty.

Log startu silnika:

```
level=INFO msg="Builtin auth initialized" setupRequired=false
level=INFO msg="Loading DAGs" dir=/var/lib/dagu/dags
level=INFO msg="Scheduler started"
level=INFO msg="SSE routes configured" basePath=/dagu/api/v1
level=INFO msg="MCP route configured" path=/dagu/mcp
level=INFO msg="Server is starting" addr=0.0.0.0:8080
```

Obraz przypięty po digeście `sha256:b242dc7b…`, jeden wolumen na całe `/var/lib/dagu`,
`dags/` i `kontrakty/` z repozytorium (drugie read-only).

### Sekrety silnika plikiem, nie przez `environment:`

```
=== czy sekret trafil do docker inspect? ===
brak sekretow w Config.Env — zgodnie z zamierzeniem

=== plik konfiguracyjny w kontenerze ===
-r--------. 1 root root 201 /var/lib/dagu/config.yaml
```

**Co to daje i tylko tyle twierdzę:** sekret nie siedzi w `docker inspect` i nie jest
w środowisku każdego procesu potomnego silnika. Audyt P1 rozstrzygnął, że **to nie jest
izolacja** — krok biegnie jako root i ten plik czyta (potwierdzone niżej, §6).

---

## 3. Utwardzenie sieci

Sonda uruchomiona jako **prawdziwy DAG przez silnik** (`dagu start`), definicja w `/tmp`
kontenera, nie w `dags/`:

```
== tozsamosc kroku ==
uid=0(root) gid=0(root) groups=0(root)

== 1. WYJSCIE NA INTERNET (eksfiltracja) ==
  http://example.com/      -> 000
  http://api.anthropic.com/ -> 000
  http://1.1.1.1/          -> 000

== 2. RUCH BOCZNY PO NAZWIE DNS ==
  n8n          -> NAZWA NIEROZWIAZANA
  dagu         -> 172.23.0.2
  proxy        -> 172.23.0.5
  frontend     -> 172.23.0.3
  chat-backend -> 172.23.0.4

== 3. co realnie odpowiada ==
  http://n8n:5678/          -> 000
  http://proxy:80/          -> 200
  http://chat-backend:8787/ -> 404
  http://frontend:80/       -> 200

== 4. uslugi hosta przez brame (rootless) ==
  brama=brak
```

Sieć `internal: true` nie ma bramy w ogóle, więc usługi hosta odpadają z definicji.

Druga strona — chat-backend **ma** dosięgać API modelu:

```
== chat-backend -> API modelu (siec wyjsciowa) ==
  https://api.anthropic.com/v1/messages  -> HTTP 405   (serwer odpowiedzial: laczność jest)
  https://console.anthropic.com/          -> HTTP 200

== chat-backend -> silnik Dagu (siec wewnetrzna, MCP) ==
  http://dagu:8080/dagu/                  -> HTTP 200

== chat-backend -> stary n8n (ma byc odciety) ==
  http://n8n:5678/                        -> BLAD: ENOTFOUND
```

Sprawdzone też przy **włączonym** profilu `n8n` — krok nadal nie widzi tej nazwy,
bo stary silnik dostał osobną sieć `wycofanie`, dzieloną wyłącznie z proxy.

---

## 4. Uprawnienia — co jest naprawdę potrzebne i dlaczego

Nie przepisałem `PUID=0`/`PGID=0` z decyzji jako recepty, tylko zmierzyłem cztery warianty
na bind-moncie o dokładnie takim właścicielu i prawach jak repozytorium
(`paczos:paczos`, katalog 755, pliki 644):

| Wariant | nowy plik w `dags/` | **nadpisanie** istniejącego (`upsert_dag`) | właściciel pliku na hoście | operator może edytować |
| --- | --- | --- | --- | --- |
| `PUID=1000/PGID=1000` (domyślne obrazu) | `Permission denied` | `Permission denied` | — | — |
| `PUID=1000` + `chmod 777 dags/` | OK | **`Permission denied`** | uid 525287 (obcy subuid) | **nie** |
| `PUID=0`/`PGID=1000` | OK | OK | `paczos:525287` (obca grupa) | tak, ale grupa obca |
| **`PUID=0`/`PGID=0`** | **OK** | **OK** | **`paczos:paczos`, prawa 644** | **tak** |

Output wariantu domyślnego i docelowego:

```
################ PUID=1000 PGID=1000 ################
proces jako: uid=1000 gid=1000 (dagu)
  /var/lib/dagu/dags  uid=0 gid=0 prawa=755
ZAPIS do bind-mounta dags/: cannot create /var/lib/dagu/dags/nowy.yaml: Permission denied
ODCZYT kontrakty/: OK

################ PUID=0 PGID=0 ################
proces jako: uid=0 gid=0 (root)
ZAPIS do bind-mounta dags/: OK
NADPISANIE istniejacego dags/istniejacy.yaml: OK
ODCZYT kontrakty/: OK

=== co powstalo na hoscie ===
.../dags/nowy.yaml  wlasciciel=paczos:paczos (uid=1000) prawa=644
```

**Dlaczego `0` jest tu najmniejszym działającym uprawnieniem, a nie wygodą.** Docker na tym
hoście jest **rootless**: uid 0 w kontenerze mapuje się na uid 1000 (`paczos`) na hoście,
czyli na właściciela plików repozytorium. Obraz domyślnie schodzi do `PUID=1000`
(`sudo -u #$PUID` w `/entrypoint.sh`), co w tym mapowaniu ląduje na obcym subuid i traci
prawo zapisu. `PUID=0` **nie znaczy „root na hoście"**.

Wariant z `chmod 777` odpada nie z estetyki, tylko dlatego, że **nie działa**:
`dagu_change upsert_dag` nadpisuje cały plik, a `777` na katalogu nie daje prawa do
nadpisania cudzego pliku. Zostawiłby też w repozytorium pliki, których operator nie może
edytować (`EDYCJA PRZEZ OPERATORA: BLAD`).

**Zawężenie, które udało się zrobić:** `kontrakty/` jest montowane `:ro` — silnik czyta je
we wszystkich wariantach i nigdy nie potrzebuje tam zapisu.

---

## 5. Wariant B2 — dowód z przeglądarki

### Na poziomie HTTP

```
=== co Dagu wysyla SAM (bezposrednio z silnika) ===
HTTP/1.1 200 OK
X-Frame-Options: DENY

=== przez proxy (po korekcie B2 + L6) ===
HTTP/1.1 200 OK
Content-Security-Policy: frame-ancestors 'self'

=== logowanie SPA odpowiadane przez proxy ===
{"token":"SENTINEL-proxy-managed","expiresAt":"2099-01-01T00:00:00Z","user":{...,"role":"admin",...}}

=== API dziala bez tokenu klienta (proxy dokłada prawdziwy) ===
GET /dagu/api/v1/dags  -> HTTP 200
GET /dagu/api/v1/auth/me -> HTTP 200

=== /setup zaslepiony na proxy ===
POST /dagu/api/v1/auth/setup -> HTTP 403
```

### W przeglądarce (headless Chrome 124, CDP)

```
KROK 1 — ramka /dagu/dags BEZ sesji operatora
   {"url":"http://127.0.0.1:8080/dagu/dags",
    "tekst":"{\"error\":\"wymagana sesja operatora — zaloguj sie\"}"}

KROK 2 — logowanie operatora (brama sesji R-A)
   HTTP 200
   document.cookie widziane przez JS strony: '' (puste = HttpOnly dziala)

KROK 3 — ta sama ramka po zalogowaniu
   {"dostep":"OK — ramka czytelna z rodzica, czyli ten sam origin",
    "url":"http://127.0.0.1:8080/dagu/dags","tytul":"Workflows - Dagu",
    "elementow":478,"poleHasla":false,
    "tekst":"D Dagu All workspaces Overview Workflows Search Base Config Wiki Executions …"}

KROK 5 — CO PRZEGLADARKA TRZYMA
   localStorage: [… ["dagu_auth_token","SENTINEL-proxy-managed"] …]
   ocena: {"dagu_auth_token":"SENTINEL-proxy-managed",
           "zawieraSentinel":true,
           "zawieraJWT":false,
           "zawieraKluczApiDagu":false,
           "cookieWidocznyDlaJS":""}
```

We wcześniejszym przebiegu (przed dołożeniem `forward_auth`) sprawdzone było też przejście
przez **prawdziwy formularz logowania SPA** wypełniony i wysłany przez CDP: SPA zapisała
sentinel i wyrenderowała listę `6 workflows` z repozytorium, tożsamość w UI: `proxy-ui`.

**Prawdziwy token nie jest w repozytorium** — bierze się ze zmiennej z `.env`, a do Caddy
wchodzi plikiem (Compose `configs`), nie przez `environment:`, więc nie ma go też
w `docker inspect n8niframe-proxy`.

### Poprawka po przeglądzie koordynatora: cały `/dagu*` za sesją

Pierwsza wersja miała regresję: proxy wstrzykiwało token admina, ale ścieżki silnika
nie chroniła żadna sesja. Domknięte `forward_auth` do `/api/sesja/weryfikacja`:

```
  GET  /dagu/dags     bez sesji        -> HTTP 401
  GET  /dagu/dags     z sesja          -> HTTP 200
  GET  /dagu/dags     po wylogowaniu   -> HTTP 401
```

Niezalogowany dostaje **401 z ciałem JSON**, nie przekierowanie — formularz logowania
nigdy nie renderuje się wewnątrz ramki udającej silnik.

Uwaga składniowa, która kosztowała jeden cykl i jest warta zapisania: samo `route /dagu*`
**nie wystarcza**. Caddy sortuje dyrektywy własną kolejnością i wstawia `route` **po** grupie
`handle`, więc końcowy `handle {}` (aplikacja React) przejmował `/dagu/*` i oddawał SPA
aplikacji zamiast silnika — z kodem 200, więc wyglądało to na działające. Potrzebne są dwie
warstwy: zewnętrzne `handle /dagu*` (pierwszeństwo) i wewnętrzne `route` (kolejność).
Sprawdzone przez `caddy adapt`.

---

## 6. Sesja `/api/*` — moduł, nie edycja `server.mjs`

`chat-backend/sesja/` z własnym `KONTRAKT.md`, **zacommitowanym przed implementacją**
(commit `e9943ba`, implementacja w `8af6a3c`). Kontrakt w wersji 2 dociąga trasy
`/api/sesja/*` i punkt `weryfikacja`, zatwierdzone przez koordynatora po tamtym commicie.

Dowody wobec żywego stacku:

```
  GET  /              (aplikacja, otwarta)         -> HTTP 200
  GET  /api/sesja     (otwarta)                    -> HTTP 200
  GET  /dagu/dags     bez sesji                    -> HTTP 401
  POST /api/chat      bez sesji                    -> HTTP 401
  POST logowanie      zle haslo                    -> HTTP 401
  POST logowanie      obcy Origin                  -> HTTP 403
  POST logowanie      dobre haslo                  -> HTTP 200
  GET  /dagu/dags     z sesja                      -> HTTP 200
  GET  /dagu/api/v1/dags z sesja                   -> HTTP 200
  GET  weryfikacja    z sesja                      -> HTTP 200
  GET  weryfikacja    obcy Origin                  -> HTTP 403
  POST /api/chat      obcy Origin                  -> HTTP 403
  POST wylogowanie                                 -> HTTP 200
  GET  /dagu/dags     po wylogowaniu               -> HTTP 401
  POST /api/chat      po wylogowaniu               -> HTTP 401
```

`/api/chat` z sesją i dobrym Origin — pełne, prawdziwe wywołanie modelu:

```
HTTP 200  (po 3 s)
  reply: 'dziala'
  sessionId: a6e8c44b-e10c-4baf-b67c-83ca73dce3e6
```

Ciasteczko:

```
Set-Cookie: sesja_operatora=<UKRYTE>; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800
```

Unieważnienie jest **serwerowe**: `POST /api/sesja/wylogowanie` kasuje wpis w rejestrze,
więc to samo ciasteczko natychmiast daje 401 — sprawdzone wyżej i w teście jednostkowym.

17 testów jednostkowych, wszystkie przechodzą:

```
ℹ tests 17
ℹ pass 17
ℹ fail 0
```

### Wiązanie rozmowy z operatorem (S3)

Moduł daje mechanizm (`kontrola.sesja.czyRozmowaNalezy` / `zwiazRozmowe`), pokryty testem
„druga sesja nie widzi `sessionId` pierwszej". **Wpięcie należy do T3** — `server.mjs` dziś
bierze `sessionId` prosto z ciała żądania. Opisane w `KONTRAKT.md` §1.3 razem z gotowym
fragmentem do wklejenia. To jest wspólny wiersz S3 (T1, T3) w §13.3.

### Uwaga o ścieżce ciasteczka

Brief mówił „ścieżka ograniczona" i wersja 1 miała `Path=/api`. `forward_auth` na `/dagu/*`
tego nie dopuszcza: przeglądarka wysyła ciasteczko tylko do ścieżek objętych `Path`, więc
przy `/api` żądanie o `/dagu/*` przyszłoby bez ciasteczka i proxy odrzuciłoby **zalogowanego**
operatora. `Path=/` jest ceną objęcia całego originu sesją — czyli tego, czego wprost wymaga
§5.2. Zawężenie zostaje na `HttpOnly` i `SameSite=Strict`; stanowisko z audytu §P6 też miało
`Path=/`. Zapisane w `KONTRAKT.md` §2, nie schowane.

---

## 7. Poświadczenia — naprawa błędu zastanego §9 pkt 1

`~/.claude` zawiera nie tylko `.credentials.json`, ale też `history.jsonl` (685 KB historii
promptów), `projects/` (pełne transkrypty rozmów), `sessions/`, `shell-snapshots/`,
`settings.json`, `telemetry/`, `uploads/`. Montowanie całego katalogu naprawiłoby i-węzeł,
ale **zwiększyłoby ekspozycję** przy okazji naprawy czegoś innego. Wariant uzgodniony
z koordynatorem: pośrednik — kontener bez sieci, bez modelu, który widzi `~/.claude:ro`
i przepisuje **jeden plik** do wolumenu, a chat-backend montuje ten wolumen `:ro`.

### Test 1 — atomowa podmiana, stary i nowy sposób obok siebie

```
nowy i-wezel na hoscie: 8536610
  stare (montaz pliku)      -> WERSJA-1   <-- ZOSTAL PRZY STARYM = BLAD ZASTANY
  nowe  (katalog+posrednik) -> WERSJA-2   <-- WIDZI NOWY = NAPRAWIONE
```

### Test 2 — rotacja, trzy podmiany pod rząd

```
  po rotacji 3: stare=WERSJA-1  nowe=WERSJA-3
  po rotacji 4: stare=WERSJA-1  nowe=WERSJA-4
  po rotacji 5: stare=WERSJA-1  nowe=WERSJA-5
```

Montaż pojedynczego pliku został zamrożony na `WERSJA-1` przez cztery kolejne atomowe
podmiany. Pośrednik nadąża za każdą.

### Test 3 — wygaśnięcie (prawdziwy kod `chat-backend/credentials.mjs`)

```
  token wazny jeszcze 2 h                    -> ok=true  powod=-
  token wygasa za 30 s (w oknie SKEW=60 s)   -> ok=false powod=wygasle
  token wygasl godzine temu                  -> ok=false powod=wygasle
  plik o zlym formacie                       -> ok=false powod=brak-poswiadczen
  brak pliku                                 -> ok=false powod=brak-poswiadczen
```

### Test 4 — prawa dostępu

```
kopia w wolumenie:                 -rw------- 1 root root 524 .credentials.json   (600)
chat-backend zapis do /seed:       Read-only file system
posrednik zapis do ~/.claude:      Read-only file system  (takze nowy plik)
posrednik NetworkMode:             none   (tylko loopback)
posrednik ReadonlyRootfs:          true
```

Kopiowanie jest atomowe (`cp` do `.tmp` w tym samym katalogu, potem `mv`) i w pętli co 5 s,
bo jednorazowa kopia przy starcie odtworzyłaby dokładnie naprawiany błąd.
Na żywym stacku: `/api/health -> "credentials":"wazne"`.

---

## 8. Klucz agenta (§5.2, audyt P5)

Dwa klucze, czyli cały limit Community — trzeci odrzucony wykonaniem:

```
utworzony: proxy-ui  rola=admin     powierzchnia=rest_api
utworzony: agent-mcp rola=developer powierzchnia=mcp
trzeci -> HTTP 403 {"code":"forbidden","message":"Community edition supports up to 2 API keys…"}
```

Zawężenie klucza agenta sprawdzone wprost:

```
  REST tym kluczem (ma byc 403):
    /dagu/api/v1/dags        -> HTTP 403
    /dagu/api/v1/api-keys    -> HTTP 403
    /dagu/api/v1/users       -> HTTP 403
  MCP tym kluczem (ma dzialac):
    /dagu/mcp                -> HTTP 200
```

Konto administratora zakładane przez `POST /api/v1/auth/setup`, **nie** przez zmienne
środowiskowe — dzięki temu hasło admina nie musi nigdzie siedzieć na stałe. Ta trasa jest
zablokowana na proxy (403), bootstrap idzie przez `docker compose exec`.

**Ważny szczegół, który łatwo przeoczyć:** `DAGU_MCP_URL` wskazuje **bezpośrednio**
`http://dagu:8080/dagu/mcp`, z pominięciem proxy. Gdyby backend wołał MCP przez proxy,
`header_up Authorization` **podmieniłby** klucz agenta na token admina i całe zawężenie
z P5 byłoby fikcją. Zapisane komentarzem w `docker-compose.yml`.

---

## 9. `recreate` zachowuje dane

```
PRZED:  przebiegi 1  katalogi z logami 5  pliki logow 4  klucze API 2  definicje 6
PO:     przebiegi 1  katalogi z logami 5  pliki logow 4  klucze API 2  definicje 6
status.jsonl konkretnego starego przebiegu: JEST
API po recreate: przebiegow widocznych 1, definicji 6, GET /dagu/dags -> 200
```

Powód, dla którego to wychodzi: montowany jest **cały** `/var/lib/dagu` jednym wolumenem.
Audyt [D19] pokazał, że montowanie samych `dags/` i `data/` gubi logi (25 katalogów → 2,
log starego przebiegu → 404).

Dziennik zezwoleń warstwy polityki dostał osobny wolumen i też przeżywa:

```
plik PRZEZYL: {"proba":"przed-recreate","kiedy":"2026-09-18T22:44:21+02:00"}
/app/dane -> brak w kontenerze silnika (dobrze)
```

Wolumen zezwoleń **nie jest** współdzielony z wolumenem silnika — krok DAG-a biegnie jako
root i gdyby miał tam zapis, podmieniłby własne zezwolenie.

Plik bazowy silnika na osobnym wolumenie, żeby warstwa polityki mogła go czytać, nie
dostając przy okazji `config.yaml` z sekretem:

```
  zawartosc /silnik:   -rw-r--r-- base.yaml  (298 B)
  czy widac config.yaml silnika: nie — dobrze
  proba zapisu: Read-only file system
  DAGU_BASE_YAML=/silnik/base.yaml -> CZYTELNY
```

---

## 10. Czego NIE domknąłem — lista jawna

1. **Krok DAG-a dosięga `proxy`, `frontend` i `chat-backend` po nazwie DNS.** Zmierzone,
   nie założone (§3). Sieci Dockera są dwukierunkowe, a proxy **musi** dosięgać silnika,
   więc i silnik dosięga proxy. Przez proxy krok widzi to, co Caddy wystawia. Częściowo
   złagodzone: `/api/*` i `/dagu/*` są za sesją (401), więc krok bez ciasteczka operatora
   niczego tam nie zrobi; zostaje aplikacja React i trasa `/n8n/*`, gdy profil wycofania
   jest włączony. **Domknięcie wymaga osobnej instancji silnika albo polityki sieciowej
   poza Compose** — to jest warunek brzegowy Fazy 2 z §5.2, nie coś, co tu dodałem.

2. **R-C pozostaje przyjęte — potwierdziłem to pomiarem, nie zmieniłem.** Test S4 z §13.3,
   bez drukowania wartości:

   ```
   == A. SEKRETY WLASNEGO SILNIKA (werdykt R-C: PRZYJETE) ==
     DAGU_CONFIG w srodowisku: /var/lib/dagu/config.yaml
     /var/lib/dagu/config.yaml -> CZYTELNY (201 B), klucze: auth mode builtin token secret ttl
        dlugosc wartosci auth.builtin.token.secret: 64 znakow (WARTOSC NIE DRUKOWANA)
     klucze API silnika na dysku: 2 plikow, czytelne: 2

   == B. SEKRETY BACKENDU (maja byc NIEOSIAGALNE) ==
     /app/mcp.json            -> brak w kontenerze silnika
     /seed/.credentials.json  -> brak w kontenerze silnika
     /app/dane/zezwolenia.json-> brak w kontenerze silnika
     klucz agenta DAGU_MCP_TOKEN w srodowisku kroku: brak
     haslo operatora SESJA_HASLO w srodowisku kroku:  brak
     zmienne z nazwa sugerujaca sekret: 0

   == C/D/E ==
     /seed                -> niezamontowany
     /var/run/docker.sock -> brak
     http://example.com/  -> 000
   ```

   Czyli: krok **nadal** zdobywa materiał do podrobienia tokenu admina **swojego** silnika
   (to jest przyjęte), ale **nie** dosięga sekretów backendu, poświadczeń modelu, socketu
   Dockera ani drogi wyjścia. „Zmienne z nazwą sugerującą sekret: 0" to dokładnie ten wąski
   zysk, który obiecuje przeniesienie sekretów do pliku — i nic więcej.

3. **Wylogowanie z Dagu nie unieważnia serwerowo** (cena B2 z §5.2). Prawdziwy token żyje
   w konfiguracji proxy; „logout" w SPA czyści tylko sentinel. Rotacja = wymiana
   `DAGU_PROXY_TOKEN` i `docker compose up -d proxy`. Przy limicie 2 kluczy rotacja jest
   „skasuj, potem utwórz", nie „utwórz obok i przełącz".

4. **Rejestr sesji jest w pamięci procesu.** Restart backendu = operator loguje się ponownie.
   Dla prototypu wystarcza (audyt §P6 zastrzeżenie), trwały magazyn to Faza 2.

5. **Proxy jest w sieci `wyjsciowa`**, wbrew ilustracji z §5.2. Powód techniczny, zmierzony:
   kontener podpięty wyłącznie do sieci `internal: true` nie dostaje mapowania portu —
   Docker 29.8.0 rootless cicho je gubi (`{"80/tcp":null}`, `curl -> 000`); ten sam kontener
   dopięty do zwykłej sieci publikuje port normalnie (`-> 200`). `dagu` zostaje wyłącznie
   w `wewnetrzna`.

6. **`n8n` przeniesione do własnej sieci `wycofanie`**, też wbrew ilustracji z §5.2, która
   trzyma je w `wewnetrzna`. Tamten układ nie przeszedłby wymagania odbiorczego „krok nie
   dosięga n8n po nazwie". Nic na tym nie traci: jedynym klientem n8n jest proxy.

7. **Nie sprawdzałem zachowania pod HTTPS.** `Secure` na ciasteczku jest za flagą
   `SESJA_SECURE=1`, ale lokalnie po HTTP świadomie wyłączone i nieprzetestowane.

8. **Nie sprawdzałem SSE pod obciążeniem ani długiego strumienia `events/stream` przez
   `forward_auth`.** Trasa jest jedna i obejmuje SSE tak samo jak XHR, ale zmierzyłem
   tylko, że strona i API działają; nie mierzyłem, co się dzieje ze strumieniem, gdy sesja
   wygaśnie **w trakcie** otwartego połączenia.

9. **Zostały dwa wolumeny po stanowiskach prób**: `proba-uprawnien-dagu`
   i `proba-poswiadczen_poswiadczenia`. Nie usunąłem ich, bo `docker volume rm` jest
   zakazane bezwzględnie. Są puste znaczeniowo i nikt ich nie montuje.

10. **`chat-backend/Dockerfile` jest formalnie w moim zakresie, ale edytował go T3**
    (dodał warstwę polityki, `brama-sesji.mjs`, `COPY sesja*`). **Nie zacommitowałem jego
    zmian** — zostawiłem je w drzewie roboczym dla niego. To samo dotyczy `entrypoint.sh`,
    `server.mjs` i `frontend/**`.

11. **`dags/.dag.index`** — silnik zapisuje własny indeks obok definicji, bo `dags/` jest
    montowane zapisywalnie. Dodałem go do `.gitignore` (stan silnika, nie definicja).
    `.gitignore` nie jest niczyją własnością wprost; jeśli T4 woli inaczej, to jedna linia.

---

## 11. Commity

```
e9943ba Kontrakt bramy sesji /api/* dla T3 (przed implementacja)
8af6a3c Brama sesji /api/*: ciasteczko HttpOnly, unieważnialnosc serwerowa, kontrola Origin
2d88a44 Stack Dagu: dwa silniki obok siebie, utwardzenie sieci, B2 i brama sesji
1e7ffaa gitignore: indeks silnika Dagu w dags/ to stan wykonania, nie definicja
bf73dde Uzupelnienia po przegladzie koordynatora: base.yaml dla polityki, trwalosc zezwolen, 403 na weryfikacji
```

Żaden commit nie zawiera sekretu — sprawdzone skanem wzorców (klucz `dagu_…`, JWT,
przypisane wartości `SESJA_HASLO`/`DAGU_*_TOKEN`/`DAGU_AUTH_TOKEN_SECRET`, ciąg 64-hex).
Jedyne trafienie 64-hex to wymagany digest obrazu.
