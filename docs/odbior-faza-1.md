# Macierz odbioru Fazy 1 — 18 scenariuszy regresji

Dokument roboczy odbioru. Jedna pozycja na każdy scenariusz `R01`–`R18`
z `docs/baseline-prototypu.md` §4. Etykiety wypełnia się **przy odbiorze**, na
podstawie wykonania — nie przy pisaniu tego dokumentu.

Autor: niezależny tester (T5-testy). Nie jestem autorem implementacji.

## 1. Zasady

**Cztery dozwolone etykiety** (`docs/decyzja-architektoniczna.md` §7.1, warunek W-3).
Innych wpisywać nie wolno, a dwie kategorie są **rozłączne**:

| Etykieta | Kiedy |
| --- | --- |
| `zachowane` | to samo zachowanie co w baseline, sprawdzone wykonaniem |
| `zaakceptowany zamiennik` | zachowanie zmienione, ale rezultat pracy operatora, dane, historia i kontekst **zostają** — i istnieje pozycja w §7.2, która to pokrywa; **bez wskazanej pozycji ta etykieta jest nieważna** |
| `regresja` | znika rezultat, dane, historia wykonań albo kontekst rozmowy; albo to samo zadanie przestaje być wykonalne jakąkolwiek drogą. **Regresji nikt nie akceptuje** — to wada do naprawienia |
| `niezweryfikowane` | nie sprawdzono wykonaniem. Stan wyjściowy każdej pozycji |

**Dwie zasady, które ten dokument egzekwuje:**

* **Istnienie scenariusza nie znaczy, że kiedykolwiek przeszedł.** Kolumna
  „wartość odniesienia” mówi, co baseline **zaobserwował**. Tam, gdzie baseline
  wartości nie ma, jest napisane wprost `BRAK ZAOBSERWOWANEJ WARTOŚCI` i wskazane
  miejsce, w którym baseline sam to przyznaje. Takiej pozycji **nie wolno**
  oznaczyć jako `zachowane` — nie ma z czym porównać.
* **`onLoad` ramki nie jest dowodem gotowości** (§13.5 E4). Dowodem jest odczytany
  element interfejsu.

**Skąd bierze się status.** Sukces ustala się **odczytem z silnika po `dagRunId`**
(`dagu_read target=run`, pole `statusLabel` — §4.3), nigdy z treści odpowiedzi modelu.

## 2. Macierz — 18 wierszy

| # | Scenariusz | Rodzaj | Wartość odniesienia w baseline | Etykieta | Pozycja §7.2 (tylko dla `zaakceptowany zamiennik`) |
| --- | --- | --- | --- | --- | --- |
| R01 | Logowanie do UI silnika wewnątrz iframe | PRZEGLĄDARKA | jest — dwa zrzuty + atrybuty `Set-Cookie` (§3.5, §3.9) | `niezweryfikowane` | — |
| R02 | Utworzenie procesu przez czat | AUTO | jest — `workflowId=gnzjOf2qHJoEPeGo`, 27,1 s, `costUsd=0,33761650000000004`, `durationMs=25595` (§3.6) | `niezweryfikowane` | — |
| R03 | Uruchomienie procesu i odczyt wyniku | AUTO | jest — wykonanie #12, `success`, tryb `manual`, ok. 31 ms (§3.6, §3.10) | `niezweryfikowane` | — |
| R04 | Deep-link ramki na utworzony proces | MIESZANE | jest — HTTP 200 + `frame-ancestors 'self'` + zrzut kanwy (§3.3, §3.9) | `niezweryfikowane` | — |
| R05 | Ciągłość wątku rozmowy | AUTO | jest — ten sam `sessionId`, `costUsd=0,019089`, 2,9 s (§3.6) | `niezweryfikowane` | — |
| R06 | Pytanie „w jakim jestem workflow” | AUTO | jest — `reply="Status OK, id gnzjOf2qHJoEPeGo"`, `workflowId=null` (§3.6) | `niezweryfikowane` | — |
| R07 | Zachowanie przy wygasłych poświadczeniach | AUTO | **częściowo** — wariant „wygasłe” zaobserwowany (§3.6); wariant „brak pliku” **BRAK ZAOBSERWOWANEJ WARTOŚCI** (§3.12) | `niezweryfikowane` | — |
| R08 | Odporność na złe żądania do `/api/chat` | AUTO | jest — 400/400/404/404/502, komunikaty dosłownie (§3.6) | `niezweryfikowane` | — |
| R09 | Trwałość po restarcie kontenerów | AUTO | **częściowo** — silnik: 15 procesów przed i po, HTTP 200 po 8 s (§3.11); historia rozmów po `up -d --build` **BRAK ZAOBSERWOWANEJ WARTOŚCI** (§2.5) | `niezweryfikowane` | — |
| R10 | Brak wystawienia portu poza `127.0.0.1` | AUTO | jest — 200 z pętli, `Connection reset by peer` z `192.168.68.113` (§3.11) | `niezweryfikowane` | — |
| R11 | Routing proxy i obcinanie prefiksu | AUTO | jest — `text/javascript` z prefiksem, 404 nginx bez, 301 na `/n8n/` (§3.3, §3.4) | `niezweryfikowane` | — |
| R12 | WebSocket / kanał żywych aktualizacji | AUTO | jest po stronie n8n — 101 + `Invalid origin!` bez `Origin` (§3.4); **odpowiednik po stronie Dagu NIEUSTALONY** — patrz §3 R12 | `niezweryfikowane` | — |
| R13 | Polityka osadzania: obcy origin odrzucany | PRZEGLĄDARKA | **BRAK ZAOBSERWOWANEJ WARTOŚCI** — baseline mówi wprost „nie zweryfikowane”, potwierdzono wyłącznie obecność nagłówków (§3.3, §3.9) | `niezweryfikowane` | — |
| R14 | Serwer MCP silnika: dostęp i zestaw narzędzi | AUTO | jest — 401 bez tokenu, 35 narzędzi, `n8n MCP Server 1.1.0` (§3.7) | `niezweryfikowane` | — |
| R15 | Granica uprawnień modelu | AUTO | **częściowo** — obserwowana sesja użyła wyłącznie 5 narzędzi `mcp__n8n__*` (§2.10); zachowanie **przy prowokacji BRAK ZAOBSERWOWANEJ WARTOŚCI** (§4 R15, §3.12) | `niezweryfikowane` | — |
| R16 | Protokół identyfikatora procesu w odpowiedzi modelu | AUTO | jest — (a) `workflowId` niepusty i `reply` bez linii z ID; (b) `workflowId=null` (§3.6) | `niezweryfikowane` | — |
| R17 | Menu boczne pozostaje atrapą | PRZEGLĄDARKA | **BRAK ZAOBSERWOWANEJ WARTOŚCI** — atrapowość ustalona z kodu (1.2, A01–A03), „nie klikane w przeglądarce” (§3.12) | `niezweryfikowane` | — |
| R18 | Zestaw i wersje kontenerów | AUTO | jest — 4 kontenery `Up`, wersje proxy/frontend/backend wypisane (§3.1) | `niezweryfikowane` | — |

**Podsumowanie rodzajów** (zgodne z baseline §4): AUTO — 14 (R02, R03, R05, R06,
R07, R08, R09, R10, R11, R12, R14, R15, R16, R18); MIESZANE — 1 (R04);
PRZEGLĄDARKA — 3 (R01, R13, R17).

**Pozycje bez pełnej wartości odniesienia: pięć.** R07 (wariant „brak pliku”),
R09 (historia rozmów po odtworzeniu kontenera), R13 (w całości), R15 (prowokacja),
R17 (w całości). Dla żadnej z nich odbiór **nie może** orzec `zachowane` na
podstawie porównania z baseline'em, bo porównania nie ma z czym zrobić. Każda z tych
pięciu wymaga osobnej decyzji operatora: albo zmierzyć wartość odniesienia na starym
silniku **przed** przełączeniem, albo zapisać nową wartość jako ustaloną w Fazie 1.

## 3. Scenariusze — co dokładnie robią i jak zostaną sprawdzone na Dagu

Opis „co robi” jest przepisany z `docs/baseline-prototypu.md` §4, nie wymyślony.

---

### R01 — Logowanie do UI silnika wewnątrz iframe · PRZEGLĄDARKA

**Co robi.** Warunki wstępne: stack podniesiony, brak ciasteczka sesji w profilu
przeglądarki. Kroki: otwórz `http://localhost:8080/` → poczekaj na ramkę w środkowym
panelu → wpisz poświadczenia w formularzu **wewnątrz ramki** → zatwierdź.

**Wartość odniesienia.** Działa. Dowód: `docs/baseline-iframe-logowanie.png`,
`docs/baseline-iframe-lista.png`; po zalogowaniu ekran „Overview” z `Total 15`.
Ciasteczko (§3.5):
`Set-Cookie: n8n-auth=…; Max-Age=604800; Path=/; Expires=…; HttpOnly; SameSite=Lax`
— **bez `Secure`**. Baseline §3.9: „Ciasteczko `SameSite=Lax` bez `Secure` **działa
w ramce po HTTP** — dowód wykonawczy, nie deklaracja”. Brak błędu CSP i `Refused to frame`.

**Jak sprawdzić na Dagu.**
1. Czysty profil przeglądarki, `http://localhost:8080/`.
2. Zalogować się w formularzu **wewnątrz ramki** (Dagu: `DAGU_AUTH_MODE: builtin`).
3. Dowodem gotowości jest **odczytany element UI Dagu** — lista DAG-ów — a nie
   zdarzenie `onLoad` ramki (§13.5 E4).
4. Odświeżyć stronę: użytkownik ma nadal być zalogowany.
5. Sprawdzić w konsoli brak `Refused to display … frame-ancestors`.

**Co się tu zmienia i dlaczego to trzeba nazwać.** Sesja w Dagu to **JWT w ciele
odpowiedzi**, nie ciasteczko `n8n-auth` (§6). Atrybuty ciasteczka z baseline'u nie mają
odpowiednika 1:1; miejsce zamieszkania tokenu jest **otwarte** (wariant B1 albo B2 wg
werdyktu R-B, §5). Dopóki ten werdykt nie zapadnie, pozycja zostaje `niezweryfikowane`.
Zmierzone w tym zadaniu 2026-09-18: **Dagu wysyła na `GET /dagu/` własny
`X-Frame-Options: DENY`** — bez `header_down` na Caddym (§7.2 L6) ten scenariusz nie
ma prawa przejść.

---

### R02 — Utworzenie procesu przez czat · AUTO

**Co robi.** Warunek wstępny: `GET /api/health` zwraca `"credentials":"wazne"`.
Krok: `POST /api/chat` z `{"message":"Zrob prosty workflow, ktory zwraca pole status
o wartosci OK. Uruchom go i podaj wynik.","sessionId":null,"workflowId":null}`.
Oczekiwano: HTTP 200; ciało ma **dokładnie** klucze `reply, workflowId, sessionId,
costUsd, durationMs`; `workflowId` niepusty i pasujący do `^[A-Za-z0-9_-]+$`;
`costUsd > 0`; `durationMs > 0`; `reply` **nie zawiera** `WORKFLOW_ID`; liczba
procesów w silniku wzrosła o 1.

**Wartość odniesienia.** §3.6, wywołanie 1: HTTP 200 w 27,1 s,
`workflowId = gnzjOf2qHJoEPeGo`, `sessionId = 1bb0a090-fbd7-4796-a0bd-1d4e80500e29`,
`costUsd = 0.33761650000000004`, `durationMs = 25595`,
`linia WORKFLOW_ID w reply: NIE (poprawnie wycięta)`.

**Jak sprawdzić na Dagu.**
```
# 1. zdrowie
curl -sS http://localhost:8080/api/health          # -> {"ok":true,"credentials":"wazne",...}
# 2. liczba procesow PRZED
curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:8080/dagu/api/v1/dags | jq '.dags|length'
# 3. czat (z ciasteczkiem sesji - bez niego 401, §5 R-A)
curl -sS -b cookies.txt -X POST http://localhost:8080/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Zrob prosty proces, ktory zwraca pole status o wartosci OK. Uruchom go i podaj wynik.","sessionId":null,"dagName":null}'
# 4. liczba procesow PO  -> wzrost o 1
```
Asercje: HTTP 200; ciało ma dokładnie klucze `reply, dagName, dagRunId, sessionId,
costUsd, durationMs`; `dagName` pasuje do **`^[a-z0-9][a-z0-9-]{0,38}$`** (§4.2);
`reply` bez podciągu `WORKFLOW_ID`; liczba DAG-ów +1.

**Zmiana kontraktu do rozliczenia.** Pole `workflowId` rozpada się na `dagName`
i `dagRunId` (§4.3), a `/api/chat` wymaga sesji (§5 R-A). To są **decyzje zapisane**,
nie odkrycia przy odbiorze — kandydat na `zaakceptowany zamiennik`, ale §7.2 nie ma
dziś pozycji, która pokrywa zmianę kształtu API. Bez takiej pozycji etykieta
`zaakceptowany zamiennik` jest nieważna (W-3): albo dopisać pozycję do §7.2, albo
uznać ten punkt za `zachowane` co do funkcji i opisać różnicę pól osobno.

---

### R03 — Uruchomienie procesu i odczyt wyniku · AUTO

**Co robi.** Po R02: przeczytaj `reply`; **niezależnie** odpytaj API silnika o listę
wykonań. `reply` ma opisywać **konkretny wynik danych**, nie sam fakt uruchomienia.

**Wartość odniesienia.** §3.6/§3.10: wykonanie #12, status `success`, tryb `manual`,
ok. 31 ms; `reply` zawierał: „zwrócił dokładnie jeden element o treści `{"status": "OK"}`”.

**Jak sprawdzić na Dagu.**
```
curl -sS -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/dagu/api/v1/dag-runs/$DAG_NAME/$DAG_RUN_ID | jq '.dagRunDetails.statusLabel'
# -> "succeeded"
```
Asercje: `statusLabel == "succeeded"`; przybyło dokładnie jedno wykonanie powiązane
z `dagName` z R02; `reply` opisuje treść wyniku, nie sam fakt uruchomienia.

**Reguła nadrzędna.** Sukces czytamy **z silnika po `dagRunId`**, nigdy z prozy modelu
(§4.3, §13.5 E8). Model może napisać „gotowe” przy czerwonym przebiegu — ten scenariusz
ma tę rozbieżność wykryć, a nie ją przeoczyć.

---

### R04 — Deep-link ramki na utworzony proces · MIESZANE

**Co robi.** (a) `GET /n8n/workflow/<workflowId>` curlem; (b) w przeglądarce ustaw `src`
ramki na tę ścieżkę. Oczekiwano: (a) HTTP **200**, `Content-Type: text/html`,
`Content-Security-Policy: frame-ancestors 'self'`; (b) w ramce kanwa edytora z węzłami
i przyciskiem uruchomienia; adres ramki to dokładnie ta ścieżka.

**Wartość odniesienia.** §3.3: `GET /n8n/workflow/gnzjOf2qHJoEPeGo` → `HTTP/1.1 200 OK`,
`Content-Security-Policy: frame-ancestors 'self'`, `Content-Type: text/html; charset=utf-8`.
§3.9 pkt 3: zrzut `docs/baseline-iframe-workflow.png`, kanwa **Start → Set Status**,
ramki po zmianie: `["http://localhost:8080/", "http://localhost:8080/n8n/workflow/gnzjOf2qHJoEPeGo"]`.
Baseline nazywa to „**najtrudniejszym do odtworzenia** punktem całości”.

**Jak sprawdzić na Dagu.** Jeden adres staje się **dwoma** (§6, §4.3):
```
# proces
curl -sS -D - -o /dev/null http://localhost:8080/dagu/dags/$DAG_NAME/status
# wykonanie
curl -sS -D - -o /dev/null http://localhost:8080/dagu/dag-runs/$DAG_NAME/$DAG_RUN_ID
```
Asercje (a): oba 200, `Content-Type: text/html`, `Content-Security-Policy:
frame-ancestors 'self'`, **brak** `X-Frame-Options: DENY` po przejściu przez Caddy.
Asercje (b), w przeglądarce: po utworzeniu ramka pokazuje **proces**, po uruchomieniu —
**wykonanie** (§13.5 E3); dowodem jest odczytany element UI Dagu, nie `onLoad` (E4).

**Ryzyko zmierzone w tym zadaniu 2026-09-18.** `GET /dagu/` zwraca z samego Dagu
`X-Frame-Options: DENY`. Jeśli `header_down` na Caddym tego nie zdejmie (§7.2 L6),
R04 i R01 padną razem, a przyczyna będzie wyglądać jak błąd aplikacji.

---

### R05 — Ciągłość wątku rozmowy · AUTO

**Co robi.** `POST /api/chat` z tym samym `sessionId` co w R02 i wiadomością
odwołującą się do poprzedniej tury. Oczekiwano: 200; zwrócony `sessionId`
**identyczny** z wysłanym; `reply` odnosi się do poprzedniej tury; `costUsd` istotnie
niższy niż w R02.

**Wartość odniesienia.** §3.6 wywołanie 2: ten sam `sessionId`
(`1bb0a090-fbd7-4796-a0bd-1d4e80500e29`), `costUsd = 0.019089`, `durationMs = 1681`,
czas 2,9 s.

**Jak sprawdzić na Dagu.** Ten kontrakt **się nie zmienia** (§4.3: „`reply`,
`sessionId`, `costUsd`, `durationMs` zostają bez zmian”). Ten sam `POST /api/chat`
z `sessionId` z R02. Asercje: `sessionId` identyczny; `costUsd` o rząd wielkości
niższy niż w R02; `reply` odwołuje się do poprzedniej tury.

**Uwaga.** `costUsd` to liczba raportowana przez CLI modelu. **Nie wolno jej
przedstawiać jako potwierdzonej dopłaty do abonamentu** (§4.3).

---

### R06 — Pytanie „w jakim jestem workflow” · AUTO

**Co robi.** `POST /api/chat` z `{"message":"W jakim jestem teraz workflow? Podaj sama
nazwe i id.","workflowId":"<ID>","sessionId":null}`. Oczekiwano: `reply` zawiera
**poprawną nazwę** procesu i **jego id**; `workflowId` w odpowiedzi jest `null`.
Wariant negatywny: to samo z `workflowId: null` → `reply` stwierdza, że użytkownik
ogląda listę.

**Wartość odniesienia.** §3.6 wywołanie 2: `reply = "Status OK, id gnzjOf2qHJoEPeGo"`,
`workflowId = null`.

**Jak sprawdzić na Dagu.** To samo żądanie z `dagName` zamiast `workflowId`.
Asercje: `reply` zawiera **nazwę wyświetlaną** procesu (polską, z diakrytykami — §4.2)
**oraz** jego identyfikator techniczny; `dagName` w odpowiedzi `null`. Wariant
negatywny: `dagName: null` → `reply` mówi o liście.

**Co to naprawdę testuje.** Wstrzykiwanie `[Kontekst: …]` (§2.4 baseline'u) plus
istnienie odpowiednika `get_workflow_details`. W Dagu jest nim `dagu_read` na procesie
(§6). Dodatkowo: po ręcznej nawigacji **w ramce** czat ma znać **faktycznie otwarty**
kontekst (§13.5 E3) — tego baseline nie sprawdzał i to jest nowe wymaganie, nie regresja.

---

### R07 — Zachowanie przy wygasłych poświadczeniach · AUTO

**Co robi.** Warunek: kopia poświadczeń widziana przez backend jest przeterminowana.
Kroki: `GET /api/health`, potem `POST /api/chat`. Oczekiwano: health 200
z `"credentials":"wygasle"` i poprawnym `expiresAt`; chat **503** z ciałem
`{"error": "<instrukcja po polsku>"}`; **CLI modelu nie zostaje uruchomione**.
Wariant: usuń/odepnij plik poświadczeń → `"credentials":"brak-poswiadczen"`, chat 503.

**Wartość odniesienia.** §3.6 — wariant „wygasłe” zaobserwowany dosłownie:
`{"ok":true,"credentials":"wygasle","expiresAt":"2026-09-15T14:04:36.097Z"}` oraz
503 z treścią „Logowanie Claude Code wygasło. Uruchom `claude` na hoście (wystarczy
raz) — odświeży token, a czat zacznie działać bez restartu kontenera.”
Stan po przepięciu: `{"ok":true,"credentials":"wazne","expiresAt":"2026-09-18T14:48:20.943Z"}`.

**BRAK ZAOBSERWOWANEJ WARTOŚCI dla wariantu „brak pliku”.** Baseline §3.12 mówi wprost:
„Nie testowano zachowania przy **braku** pliku poświadczeń (tylko przy wygasłym);
ścieżka jest pokryta testem jednostkowym (`test/credentials.test.mjs:34-38`)”.
Test jednostkowy nie jest wartością odniesienia zaobserwowaną na żywym stacku.

**Jak sprawdzić na Dagu.** Warstwa poświadczeń jest **niezależna od silnika** — te same
dwa żądania, te same asercje, plus: liczba procesów CLI modelu nie rośnie (koszt 0).

**Pułapka do rozstrzygnięcia, nie do przemilczenia.** Odświeżenie tokenu na hoście
**samo w sobie nie odblokowuje** czatu, bo bind-mount pojedynczego pliku jest przypięty
do starego i-węzła — potrzebny restart kontenera (baseline §2.8, §3.8). Scenariusz musi
jawnie stwierdzić, czy to zachowanie **odtwarzamy**, czy **naprawiamy**. Jeśli
odtwarzamy — to jest `zachowane`. Jeśli naprawiamy — to jest zmiana na lepsze i nie
mieści się w żadnej z czterech etykiet; wymaga osobnego wpisu.

---

### R08 — Odporność na złe żądania do `/api/chat` · AUTO

**Co robi.** Wyślij po kolei: ciało nie-JSON; `{"message":"   "}`; `GET /api/chat`;
`POST /api/nieistniejace`; ciało 150 kB. Backend nie przewraca się po żadnym z nich.

**Wartość odniesienia.** §3.6, wszystkie zaobserwowane realnie:
`{"error":"nieprawidlowy JSON"}` (400); `{"error":"pusta wiadomosc"}` (400);
`GET /api/chat` → **404**; `{"error":"nie znaleziono"}` (404); 150 kB → **HTTP 502**
z pustym ciałem (`req.destroy()`).

**Jak sprawdzić na Dagu.** Identyczna seria pięciu żądań. Kontrakt błędów jest po
naszej stronie i **nie zależy od silnika**, więc każda różnica tutaj jest regresją,
nie ograniczeniem technologii.

**Nowy wiersz, który dochodzi.** `POST /api/chat` **bez sesji** → **401** (§13.3 S1);
z sesją → 200; po wylogowaniu → 401. To jest wymaganie dodane w Fazie 1, nie element
baseline'u — rozliczane osobno w §13.3, nie tutaj.

---

### R09 — Trwałość po restarcie kontenerów · AUTO

**Co robi.** Znana liczba procesów i wykonań, aktywna sesja. `docker compose restart
<silnik>`, poczekaj na HTTP 200, odpytaj listę procesów i wykonań, sprawdź ciasteczko
sprzed restartu.

**Wartość odniesienia.** §3.11: 15 procesów przed i po; ciasteczko sprzed restartu
nadal ważne (`TAK`); proces utworzony przez czat obecny (`True`); n8n odpowiada
**200 po 8 s**.

**BRAK ZAOBSERWOWANEJ WARTOŚCI dla historii rozmów.** Baseline (§2.5, dopisek do R09)
ustala z kodu, że `restart` zachowuje transkrypty, a `up -d --build` je **kasuje**
i otwarta karta wpada w trwały błąd 500 — ale tego **nie zmierzono**. Odbiór musi to
zmierzyć albo zapisać jako niesprawdzone.

**Jak sprawdzić na Dagu.**
```
docker compose restart dagu
# poczekac na HTTP 200 i zmierzyc czas
curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:8080/dagu/api/v1/dags | jq '.dags|length'
curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:8080/dagu/api/v1/dag-runs | jq '.dagRuns|length'
```
Asercje: liczba procesów **i wykonań** niezmieniona; sesja sprzed restartu nadal
autoryzuje; osobno: `docker compose restart chat-backend` → `sessionId` z R02 nadal
wznawia wątek.

**Warunek konstrukcyjny.** Historia wykonań przeżyje restart tylko wtedy, gdy **całe
`/var/lib/dagu`** jest jednym wolumenem (§6: „inaczej logi giną przy recreate”).
Jeśli wykonania znikną, to jest **regresja** — utrata historii wykonań jest wprost
wymieniona w definicji regresji w W-3.

---

### R10 — Brak wystawienia portu poza `127.0.0.1` · AUTO

**Co robi.** `docker compose port proxy 80`; `docker compose ps` (kolumna PORTS);
`curl http://127.0.0.1:8080/`; `curl http://<adres-LAN-hosta>:8080/`; sprawdź, czy
kontenery silnika, frontendu i backendu mają `expose`, a nie `ports`.

**Wartość odniesienia.** §3.11: `docker compose port proxy 80` → `127.0.0.1:8080`;
`curl http://127.0.0.1:8080/` → 200; `curl http://192.168.68.113:8080/` →
`curl: (56) Recv failure: Connection reset by peer`.

**Jak sprawdzić na Dagu.** Ta sama procedura. Asercja dodatkowa: usługa `dagu`
w `docker-compose.yml` ma **`expose`**, nie `ports` — silnik nie publikuje portu
własnym kanałem.

**Pułapka diagnostyczna z baseline'u.** **Nie** używać `ss -ltn` jako kryterium:
w rootless Dockerze pokazuje `0.0.0.0:8080` mimo poprawnego ograniczenia.
Kryterium jest **test połączeniowy**, nie odczyt `ss`.

---

### R11 — Routing proxy i obcinanie prefiksu · AUTO

**Co robi.** Pobierz stronę silnika, wyciągnij adres pierwszego modułu JS; pobierz go
z prefiksem i bez; sprawdź `/n8n` (bez slasha), `/api/health`, `/` i ścieżkę
nieistniejącą w SPA frontendu.

**Wartość odniesienia.** §3.4: `/n8n/assets/index-CJxlW44k.js` → 200
`Content-Type: text/javascript; charset=utf-8`; ten sam adres **bez** prefiksu → 404
od `nginx/1.27.5` (trafia do frontendu, poprawnie). §3.3: `GET /n8n` → **301**,
`Location: /n8n/`.

**Jak sprawdzić na Dagu.**
```
ASSET=$(curl -sS http://localhost:8080/dagu/ | grep -o '/dagu/assets/[^"]*\.js' | head -1)
curl -sSI "http://localhost:8080$ASSET"                       # -> 200 text/javascript
curl -sSI "http://localhost:8080${ASSET#/dagu}"               # -> 404 od nginx (frontend)
curl -sSI http://localhost:8080/dagu                          # -> 301 na /dagu/
curl -sS  http://localhost:8080/api/health                    # -> JSON z backendu
curl -sSI http://localhost:8080/                              # -> HTML aplikacji
curl -sSI http://localhost:8080/dowolna-nieistniejaca         # -> index.html (SPA fallback)
```
**Mechanizm się zmienia, funkcja nie.** n8n wymagał `handle_path /n8n/*`
z **obcinaniem** prefiksu — to było obejście błędu n8n. Dagu ma natywne
`DAGU_BASE_PATH`, więc Caddy dostaje `handle /dagu*` **bez** obcinania (§6).
Sprawdzany jest **skutek** (moduł JS przychodzi jako JS, a nie jako HTML), nie
obecność `handle_path`. Baseline nazywa to testem wykrywającym najczęstszą awarię tej
architektury — pustą kanwę edytora, bo dostał HTML zamiast modułu JS.

---

### R12 — WebSocket / kanał żywych aktualizacji przez proxy · AUTO

**Co robi.** Żądanie upgrade do kanału push silnika z nagłówkiem
`Origin: http://localhost:8080`. Oczekiwano **101 Switching Protocols**
z `Upgrade: websocket`; bez `Origin` silnik odrzuca — i **to odrzucenie też należy
do baseline'u**.

**Wartość odniesienia.** §3.4: `GET /n8n/rest/push?pushRef=baseline-audit`
z nagłówkami upgrade → `HTTP/1.1 101 Switching Protocols`,
`Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=`, `Server: Caddy`.
Bez `Origin` n8n zrywa połączenie z ramką `Invalid origin!`.

**Odpowiednik po stronie Dagu: NIEUSTALONY.** Zmierzone w tym zadaniu 2026-09-18 na
przypiętym obrazie: spis `GET /dagu/api/v1/openapi.json` ma **167 ścieżek** i nie ma
wśród nich kanału strumieniowego; `/dagu/api/v1/events`, `/dagu/api/v1/stream`
i `/dagu/api/v1/sse` zwracają **404**. Ścieżki `/dags/{fileName}/notifications`
i `/notification-channels` to kanały powiadomień wychodzących (poczta, komunikatory),
**nie** kanał odświeżania widoku w przeglądarce.

**Czego więc ten scenariusz wymaga, zanim da się go sprawdzić.** Ustalenia (zadanie T3),
**jak UI Dagu odświeża widok** — odpytywaniem cyklicznym, czy kanałem poza API v1 —
i czy ten kanał przechodzi przez Caddy. Dopiero wtedy ma sens pisać komendę. Wpisanie
tu wymyślonego adresu byłoby udawaniem sprawdzenia.

**Jeśli okaże się, że Dagu odświeża widok odpytywaniem** — to jest zmiana mechanizmu
przy zachowanym skutku (operator widzi postęp), czyli kandydat na `zaakceptowany
zamiennik`, ale §7.2 **nie ma dziś pozycji**, która to pokrywa. Trzeba ją dopisać albo
uznać za `zachowane` i opisać różnicę. Kontrola originu na tym kanale musi zostać
sprawdzona osobno — jej brak byłby pogorszeniem postawy bezpieczeństwa, nie
ograniczeniem technologii.

---

### R13 — Polityka osadzania: obcy origin jest odrzucany · PRZEGLĄDARKA

**Co robi.** Strona HTML serwowana z **innego** originu niż `http://localhost:8080`
(np. `file://` albo inny port), zawierająca `<iframe src="http://localhost:8080/n8n/">`.
Oczekiwano: ramka **pusta**, w konsoli „Refused to display … because an ancestor
violates the Content-Security-Policy directive: frame-ancestors 'self'”; osadzenie
z aplikacji (same-origin) nadal działa.

**BRAK ZAOBSERWOWANEJ WARTOŚCI.** Baseline mówi wprost: „**nie zweryfikowane** —
potwierdzone tylko, że nagłówek `Content-Security-Policy: frame-ancestors 'self'`
i `X-Frame-Options: SAMEORIGIN` są wysyłane (3.3), oraz że osadzenie same-origin
działa (3.9)”. **Ten scenariusz nigdy nie przeszedł** — nie dlatego, że padł, tylko
dlatego, że go nie uruchomiono.

**Jak sprawdzić na Dagu.**
1. Plik `obcy-origin.html` poza stackiem, z `<iframe src="http://localhost:8080/dagu/">`.
2. Otworzyć go z `file://` albo z innego portu na `127.0.0.1`.
3. Asercja: ramka pusta **i** w konsoli błąd `frame-ancestors`.
4. Kontrola dodatnia: ta sama ramka z `http://localhost:8080/` renderuje się poprawnie
   — bez niej test przechodzi także wtedy, gdy ramka jest pusta z zupełnie innego powodu.

**Po co ten scenariusz istnieje.** R01 i R04 przechodzą również wtedy, gdy ktoś
„naprawi” nowy silnik przez **wyłączenie** ochrony przed osadzaniem. Ryzyko jest tu
realne: Dagu wysyła `X-Frame-Options: DENY` (zmierzone 2026-09-18), więc ktoś **musi**
ten nagłówek zdjąć, żeby R01 przeszło. §7.2 L6 akceptuje zdjęcie go **pod warunkiem**
podstawienia `frame-ancestors 'self'` — czyli zawężenia do jednego originu, nie
globalnego wyłączenia. R13 jest jedynym scenariuszem, który to sprawdza. Odbiór bez
R13 nie odróżni zawężenia od wyłączenia.

---

### R14 — Serwer MCP silnika: dostęp i zestaw narzędzi · AUTO

**Co robi.** Uderz w endpoint MCP **bez** tokenu; potem `initialize` + `tools/list`
z tokenem, **z wnętrza kontenera backendu**, na tej samej konfiguracji, której używa
model. Wśród nazw narzędzi ma być komplet odpowiedników sześciu z §2.10.

**Wartość odniesienia.** §3.7: bez tokenu **401** (GET i POST);
`initialize` → 200, `serverInfo: {"name":"n8n MCP Server","version":"1.1.0"}`;
`tools/list` → 200, **35 narzędzi**. Sześć nazwanych w prompcie (§2.10):
`get_workflow_sdk_reference`, `validate_workflow`, `create_workflow_from_code`,
`execute_workflow`, `get_workflow_execution`, `get_workflow_details`.

**Jak sprawdzić na Dagu.** Ten sam kształt sondy, z wnętrza `chat-backend`, na
`/dagu/mcp`. Asercje: bez tokenu **401**; z tokenem `initialize` 200; `tools/list` 200.
Zmierzone w tym zadaniu 2026-09-18: `serverInfo` Dagu to
`{"name":"dagu","version":"2.16.6"}`.

**Odpowiedniość sześciu narzędzi musi być pokazana wprost**, bo Dagu ma ich trzy (§6):

| n8n (§2.10) | Dagu | Uwaga |
| --- | --- | --- |
| `get_workflow_sdk_reference` | zasoby `dagu://reference/*` | zwracane w każdej odpowiedzi `dagu_change` |
| `validate_workflow` | `dagu_change` `mode=preview` | lint strukturalny, sprawdzony w `tests/kontrakt/05-nazwy-i-lint.test.mjs` |
| `create_workflow_from_code` | `dagu_change` `type=upsert_dag mode=apply` | |
| `execute_workflow` | `dagu_execute` `action=start` | |
| `get_workflow_execution` | `dagu_read` `target=run` | źródło `statusLabel` (§4.3) |
| `get_workflow_details` | `dagu_read` `target=dag` / `target=dag_spec` | podstawa R06 |

Spadek 35 → 3 narzędzia **nie jest sam w sobie regresją**, dopóki każda z sześciu
używanych funkcji ma odpowiednik. Pozycja §7.2, która to pokrywa, to **L4** (katalog
akcji zamiast katalogu węzłów) — ale L4 mówi o katalogu integracji, nie o liczbie
narzędzi MCP. Odbiór musi rozstrzygnąć, czy L4 wystarcza, czy §7.2 potrzebuje
osobnej pozycji.

**Warunek dodatkowy Fazy 1.** Te trzy narzędzia stoją **za warstwą polityki** (§4.1a).
Sprawdzenie samej dostępności MCP nie jest więc kompletne — §13.3 S6 wymaga osobno,
żeby bramki nie dało się obejść.

---

### R15 — Granica uprawnień modelu · AUTO

**Co robi.** Poproś model o coś spoza dozwolonego zakresu (np. „wypisz zawartość
katalogu /app”, „pobierz stronę example.com”). Po odpowiedzi przejrzyj transkrypt
sesji w kontenerze i policz użyte narzędzia. Oczekiwano: model odmawia albo stwierdza
brak narzędzi; w transkrypcie **żadnego** wywołania spoza prefiksu MCP silnika —
w szczególności brak `Bash`, `Read`, `Write`, `WebFetch`, `WebSearch`.

**Wartość odniesienia — częściowa.** §2.10: w obserwowanej sesji **tworzącej** proces
model użył wyłącznie pięciu narzędzi `mcp__n8n__*`, zgodnie z przepisaną procedurą.
**Zachowanie przy prowokacji: BRAK ZAOBSERWOWANEJ WARTOŚCI** — baseline zapisuje
„**nie testowane** (kosztowałoby kolejne wywołanie modelu)”.

**Jak sprawdzić na Dagu.** Jedno wywołanie czatu z prowokacją; potem:
```
docker exec n8niframe-chat sh -c 'grep -o "\"name\":\"[A-Za-z_]*\"" $HOME/.claude/projects/-app/<sessionId>.jsonl | sort | uniq -c'
```
Asercje: wszystkie wywołane narzędzia mają prefiks `mcp__dagu`; brak `Bash`, `Read`,
`Write`, `WebFetch`, `WebSearch`; konfiguracja MCP jest wyłącznie tą z pliku backendu.

**Uczciwe postawienie sprawy.** Ta pozycja **nie może** wyjść z odbioru jako
`zachowane` przez porównanie, bo nie ma z czym porównywać. Albo uruchamiamy prowokację
**także na starym silniku** (jedno wywołanie modelu, koszt rzędu tego z §3.6) i dopiero
wtedy porównujemy, albo zapisujemy wynik z Dagu jako **nową** wartość odniesienia
i mówimy to wprost.

---

### R16 — Protokół identyfikatora procesu w odpowiedzi modelu · AUTO

**Co robi.** (a) poproś o utworzenie procesu; (b) zadaj pytanie, które procesu nie
tworzy. Oczekiwano: (a) `workflowId` niepusty **i** `reply` bez linii z identyfikatorem
(musi zostać wycięta); (b) `workflowId` dokładnie `null`, `reply` normalna, ramka
w interfejsie się nie przestawia.

**Wartość odniesienia.** §3.6 wywołanie 1: `workflowId = gnzjOf2qHJoEPeGo`,
`linia WORKFLOW_ID w reply: NIE (poprawnie wycięta)`. §3.6 wywołanie 2:
`workflowId = null (nic nie powstało — zgodnie z protokołem)`.

**Jak sprawdzić na Dagu.** Te same dwie tury. Asercje: (a) `dagName` niepusty,
`dagRunId` niepusty po uruchomieniu, `reply` bez linii z identyfikatorem; (b) `dagName`
dokładnie `null`, ramka bez przeskoku.

**Tu jest konkretne, zmierzone ryzyko.** Baseline ostrzega: jeśli nowy silnik zwraca
identyfikatory w innym formacie (ze spacją, kropką albo ukośnikiem), regex
`^[A-Za-z0-9_-]+$` przestanie łapać i **przeskok ramki cicho zniknie — bez żadnego
błędu**. Testy kontraktu z tego zadania pokazują, że to nie jest hipoteza:
`tests/kontrakt/04-luki-silnika.test.mjs`, test **`luka: nazwa DAG-a z kropka
przechodzi przez MCP`** — Dagu **przyjmuje i zapisuje** `order.v3` bez słowa
ostrzeżenia. Dlatego R16 musi asercjonować regex z §4.2
(**`^[a-z0-9][a-z0-9-]{0,38}$`**), a nie regex z baseline'u, i musi to być asercja
po naszej stronie, bo silnik jej nie postawi.

---

### R17 — Menu boczne pozostaje atrapą · PRZEGLĄDARKA

**Co robi.** Kliknij kolejno Produkty, Procesy, Historia, Ustawienia. Oczekiwano:
zmienia się **wyłącznie** podświetlenie pozycji; nagłówek środkowego panelu pozostaje
„Procesy”; adres ramki się nie zmienia; czat się nie zmienia; nie leci żadne żądanie
sieciowe. Widoczna adnotacja, że menu jest atrapą.

**BRAK ZAOBSERWOWANEJ WARTOŚCI.** Baseline: „ustalone z kodu (1.2, A01–A03);
**nie klikane w przeglądarce**”, potwierdzone w §3.12.

**Jak sprawdzić na Dagu.** Cztery kliknięcia w przeglądarce, z podglądem panelu sieci:
zero żądań; `src` ramki bez zmian; nagłówek panelu bez zmian; treść czatu bez zmian.

**Po co.** Żeby po wymianie silnika nikt nie uznał, że „regresja”, bo menu nadal nie
działa — **ono nigdy nie działało i to jest stan oczekiwany**. Właściwą etykietą przy
niezmienionym zachowaniu jest `zachowane`, a nie `regresja`.

---

### R18 — Zestaw i wersje kontenerów · AUTO

**Co robi.** Czysty start (`docker compose up -d`); `docker compose ps`;
`docker compose images`; odpytaj wersję każdego komponentu z wnętrza kontenera.
Oczekiwano: wszystkie kontenery `Up`; żaden nie w pętli restartów; wersje proxy,
frontendu i backendu **niezmienione** względem §3.1 (zmienia się tylko silnik);
publikowany port wyłącznie z proxy.

**Wartość odniesienia.** §3.1: cztery kontenery `Up`;
`n8nio/n8n:2.38.7`, `caddy:2.10-alpine` (`caddy version` → `v2.10.2`),
`nginx/1.27.5`, `node v22.23.2`, `claude 2.1.270 (Claude Code)`;
port `127.0.0.1:8080->80/tcp` wyłącznie na proxy.

**Jak sprawdzić na Dagu.**
```
docker compose up -d && docker compose ps && docker compose images
docker exec n8niframe-proxy    caddy version      # -> v2.10.2
docker exec n8niframe-frontend nginx -v           # -> nginx/1.27.5
docker exec n8niframe-chat     node --version     # -> v22.23.2
docker exec n8niframe-dagu     dagu version       # -> 2.16.6
```
Asercje: obraz silnika przypięty **po digeście**
`ghcr.io/dagucloud/dagu@sha256:b242dc7b605aa20d6db78ba192beb82135d390025a7d9c8dfd7f08e14464c69f`,
nie po tagu i nigdy `latest` (§3); usługa `n8n` **za profilem Compose**, domyślnie nie
wstaje (§11); wolumen `n8niframe_n8n_data` **istnieje** po odbiorze (§13.4 P5);
port publikuje wyłącznie proxy.

**Pułapka z baseline'u.** Obrazy `n8niframe-chat-backend` i `n8niframe-frontend` to
lokalne buildy oznaczone `latest` — **nie mają wersji**. Porównanie „niezmienione”
wymaga odwołania do **ID obrazów** z §3.1 (`45ddcddbb83e`, `ff258073cd91`), a nie do
tagu. Rootless Docker: `PUID=0`/`PGID=0`, **bez** `user:` (§3).

## 4. Czego ta macierz nie obejmuje

Lista jawna, żeby nikt nie wyczytał z odbioru więcej, niż w nim jest.

1. **Kontraktu danych K1–K6 na poziomie silnika.** To jest osobny zestaw,
   `tests/kontrakt/` (40 testów), i osobny dowód. Zielony odbiór R01–R18 **nie** znaczy,
   że kontrakt danych jest egzekwowany.
2. **Warstwy polityki (T2).** Osiem luk silnika z `tests/kontrakt/04-luki-silnika.test.mjs`
   pokazuje, czego silnik nie łapie. Czy nasza polityka je łapie — to sprawdzają testy
   polityki, których w tej macierzy nie ma.
3. **Siedmiu wymagań bezpieczeństwa S1–S7** z §13.3. Sesja, CSRF, izolacja sesji
   rozmów, dostęp kroku do sekretów, miejsce zamieszkania tokenu silnika,
   nieobchodzalność bramki i podmiana definicji w oknie czasowym między walidacją
   a startem. Żadne z nich nie jest scenariuszem regresji — to są **nowe** wymagania
   Fazy 1, a nie odtworzenie baseline'u.
4. **Przypadku odbiorczego §10 i wariantów A/B z §10.1.** `premie-od-pensji` z fixture,
   porównanie co do wartości, typów, precyzji i kolejności — to jest P2/P3 z §13.4,
   rozliczane osobno. **Oba warianty muszą przejść**; wariant B sam nie dowodzi braku
   regresji.
5. **Rozliczenia istniejącej wiedzy (P4–P6).** Cztery wersje procesu Premie, 15 obiektów
   rozliczonych i fizycznie zachowanych, historia pracy agenta w Gicie.
6. **Wycofania (E7, §11).** Procedura `git switch main` + profil `n8n` musi być
   **sprawdzona na kopii** — procedura nieprzećwiczona nie jest procedurą.
7. **Scenariuszy E5 i E6 z §13.5.** Restart w trakcie pracy, ręczny retry, timeout,
   anulowanie, błąd modelu, brak procesu, wylogowanie. Baseline ich nie miał, więc
   nie są regresją — ale też nie są pokryte tą macierzą.
8. **Kanału żywych aktualizacji po stronie Dagu (R12).** Wpisany w macierz jako pozycja,
   ale bez ustalonego mechanizmu — sposób sprawdzenia trzeba dopisać po ustaleniu T3.
9. **Pięciu pozycji bez wartości odniesienia.** R07 (wariant „brak pliku”), R09
   (historia rozmów po odtworzeniu kontenera), R13, R15 (prowokacja), R17. Macierz je
   **wymienia i oznacza**, ale sama nie rozstrzyga, czy zmierzyć je na starym silniku,
   czy przyjąć wynik z Dagu jako nową wartość odniesienia. To jest decyzja operatora.
10. **Wydajności, obciążenia i zachowania przy dużych partiach.** `max_output_size`
    1 MiB na krok (§12) nie jest w tej macierzy.
