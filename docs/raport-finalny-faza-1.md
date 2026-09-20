# Raport finalny Fazy 1 — wymiana silnika n8n → Dagu

Data: 2026-09-20. Dokument zbiera w jednym miejscu wynik domknięcia Fazy 1: żywy stack,
wersje, liczby testów z ich źródłami, wynik odbioru regresji (18 scenariuszy), pominięcia,
naprawę GLM i pełną listę ograniczeń. Szczegóły dowodowe pozostają w dokumentach źródłowych
(wskazanych przy każdym twierdzeniu); ten raport ich nie duplikuje.

---

## 0. Werdykt

**Faza 1 domknięta z jawnymi ograniczeniami.** Odbiór regresji: **18 z 18 scenariuszy
zaliczonych** — R07 dobił drill na kopii z 2026-09-20 (`docs/raport-t5-odbor-uzupelniajacy.md`
§4: oba warianty, health 200 z poprawnym stanem, `/api/chat` 503, zero procesów `claude`).
Kontrakt danych
K1–K6 (plus K7 i K6-artefakt) potwierdzony testami i pomiarami, trzy ryzyka bezpieczeństwa
rozstrzygnięte (R-A wdrożone, R-B wdrożone jako B2, **R-C przyjęte**), łańcuch
czat → autorstwo → wykonanie → odczyt → widoczny wynik działa w przeglądarce.
Przełączenie jest wykonane: n8n siedzi za profilem `n8n` i domyślnie nie wstaje.

## 1. Żywy stack

**Adres: http://127.0.0.1:8080** (wyłącznie pętla lokalna; `docker compose port proxy 80` →
`127.0.0.1:8080`, połączenie z LAN-u odrzucane — R10).

Stan z dnia raportu (odczyt read-only): `GET /api/health` →
`{"ok":true,"credentials":"wazne","polityka":"gotowa","sesja":"podpieta"}`, `GET /` → 200.

| Komponent | Wersja / obraz | Uwagi |
| --- | --- | --- |
| Silnik `dagu` | `ghcr.io/dagucloud/dagu@sha256:b242dc7b605aa20d6db78ba192beb82135d390025a7d9c8dfd7f08e14464c69f` | przypięcie **po digescie**, tag równoważny `2.16.6` (wydanie 2026-09-14); `serverInfo` MCP: `{"name":"dagu","version":"2.16.6"}`; wyłącznie w sieci `wewnetrzna` (`internal: true`) |
| Proxy `caddy` | `caddy:2.10-alpine`, `caddy version` → v2.10.2 | wariant B2: trzyma prawdziwy JWT, wstrzykuje `Authorization`, logowanie SPA odpowiada sentinelem; `frame-ancestors 'self'` zamiast zdjętego `X-Frame-Options: DENY` (L6); całe `/dagu*` za `forward_auth` |
| Frontend | build `./frontend`, nginx/1.27.5 | bez zmian względem baseline |
| `chat-backend` | build `./chat-backend`, node v22.23.2 | warstwa polityki + brama sesji + obserwator bramki |
| `poswiadczenia` | alpine 3.22 | sidecar bez sieci: `.credentials.json` i `settings.json` z hosta do wolumenu |
| `n8n` (wycofanie) | `n8nio/n8n:2.38.7` | **profil `n8n`, kontener nie istnieje** (R18); wolumen `n8niframe_n8n_data` nietknięty (15 procesów, 12 wykonań — rejestr §0.1) |

Pięć kontenerów `Up`, port publikuje wyłącznie proxy (odbiór R18). Sieci: `wewnetrzna`
(`internal: true` — silnik bez egressu, zmierzone: `example.com` → 000), `wyjsciowa`
(chat-backend i proxy), `wycofanie` (stary n8n, dzielona tylko z proxy) — raport T1 §3.

## 2. Liczby testów i ich źródła

| Zestaw | Liczba | Źródło |
| --- | --- | --- |
| Kontrakt na poziomie silnika | 40 | `tests/kontrakt/` |
| Warstwa polityki | 143 zadeklarowane; **136 wykonanych zielonych** (2026-09-20) | `chat-backend/test/polityka/` — raport T2 §2; różnica 7 = **testy warunkowo pominięte** w dwóch suite'ach (`procesy-repozytorium` wymaga katalogu `dags/`, `integracja-dagu` — `DAGU_POLITYKA_URL/KLUCZ`); pominięcie, nie porażka |
| Brama sesji | 17 | `chat-backend/test/sesja/brama.test.mjs` — raport T1 §6 |
| Poświadczenia (po naprawie GLM) | 9/9 | `chat-backend/test/credentials.test.mjs` — odbiór §5.1 |
| E2E na żywej aplikacji | 43/43 sprawdzeń (5 scenariuszy) | raport T3 §4 |
| Odbiór regresji | 18 scenariuszy: **17 zaliczonych**, 1 niezweryfikowane | `odbior-faza-1.md` §5 |
| Porównanie z fixture | 5 procesów + kroki pośrednie: **wszystkie zgodne** | `rejestr-workflow.md` §8.3 |

**Razem: 209 automatycznych testów zadeklarowanych, z czego 202 wykonanych i zielonych
w pełnym przebiegu 2026-09-20** (raport t5 §5; 7 warunkowo pominięte — patrz wiersz
polityki wyżej) **+ 43 sprawdzenia E2E + 18 scenariuszy odbioru.**
Pełna macierz wymaganie → zadanie → dowód: `docs/macierz-wymagania-testy.md`.

## 3. Wynik odbioru — 18 scenariuszy (2026-09-20)

Zmierzone na żywym stacku, głowka Chrome headless przez CDP, pod sesją operatora.
Pełne wiersze z dowodami: `odbior-faza-1.md` §2 (wartości odniesienia) i §5 (wyniki).

| # | Scenariusz | Wynik | Dowód (skrót) |
| --- | --- | --- | --- |
| R01 | Logowanie do UI silnika w ramce | **zaliczony** | formularz bramy sesji → ramka `/dagu/dags` renderuje Dagu 2.16.6 bez drugiego logowania (B2); zrzut `odbior-r01-logowanie-i-ramka.png` |
| R02 | Utworzenie procesu przez czat | **zaliczony** | 2 tury autorskie; polityka zablokowała start bez zezwolenia, definicja 1:1 (git zero diff), `statusLabel=succeeded`; nowy proces `odbior-status`, 6 → 7 |
| R03 | Uruchomienie i odczyt wyniku | **zaliczony** | odczyt z silnika niezależnie od czatu: `succeeded`, stdout `{"status":"OK"}` — jak wykonanie #12 n8n |
| R04 | Deep-link ramki | **zaliczony** | proces/wykonanie — 200 + `frame-ancestors 'self'`, prefiks nieobcinany |
| R05 | Ciągłość wątku rozmowy | **zaliczony** | ten sam `sessionId`; poprawka istniejącego procesu, odczyt `{"status":"NOK"}` |
| R06 | „W jakim jestem workflow" | **zaliczony** | `dagName`/`dagRunId` dokładnie `null`, odpowiedź normalna |
| R08 | Odporność na złe żądania | **zaliczony** | bez sesji 401, zła sesja/Origin 403, puste ciało 400 |
| R09 | Trwałość po restarcie | **zaliczony** (część silnikowa) | restart `dagu` → 1 s, 6/6 DAG-ów i historia z wolumenu; recreate backendu unieważnił sesję zgodnie z projektem |
| R10 | Port tylko na `127.0.0.1` | **zaliczony** | `127.0.0.1:8080`; z LAN-u odrzucone |
| R11 | Routing proxy i prefiks | **zaliczony** | moduł JS pod prefiksem 200 `text/javascript` (test, który n8n oblało); bez prefiksu 404 |
| R12 | Kanał żywych aktualizacji | **zaliczony** | kanał to **SSE** (`/dagu/api/v1/events/stream`, tematy `dag:<nazwa>`); bez tokenu 401; nowy `dagRunId` w ramce bez przeładowania; zrzut `odbior-r12-sse-zywa-aktualizacja.png` |
| R13 | Obcy origin odrzucany | **zaliczony** (z zastrzeżeniem) | ramka na `/dagu/` z obcego originu: tylko surowy 401, żadnego UI (ciasteczko `SameSite=Strict` nie jedzie cross-site); 200 silnika mają `frame-ancestors`; kontrola dodatnia same-origin renderuje; zrzuty `odbior-r13-*.png` |
| R14 | MCP silnika | **zaliczony** | bez tokenu 401, z tokenem 200; 3 narzędzia (`dagu_read/change/execute`) zamiast 35 n8n, wg mapy §6 decyzji |
| R15 | Granica uprawnień modelu | **zaliczony** | prowokacja: model odmawia i proponuje, nie tworzy; 13/13 wywołań narzędzi z prefiksem `mcp__proces__`, zero `Bash`/`WebFetch`/`Write` |
| R16 | Identyfikatory w odpowiedzi | **zaliczony** | tura autorska: pola niepuste, `succeeded`; pytanie: dokładne `null`; linia `WORKFLOW_ID:` nie istnieje — identyfikatory z obserwacji bramki (T3 §2.2) |
| R17 | Menu boczne = atrapa | **zaliczony** | 0 żądań sieciowych, `iframe.src` bez zmian; aplikacja sama komunikuje atrapę |
| R18 | Zestaw i wersje kontenerów | **zaliczony** | 5 kontenerów `Up`, obraz Dagu po digescie, n8n za profilem — tabela §1 wyżej |
| R07 | Wygasłe poświadczenia | **zaliczony** (kopia, 2026-09-20) | raport t5 §4: oba warianty — „brak pliku" i „wygasły token": health 200 z poprawnym stanem i `expiresAt`, `/api/chat` 503, zero procesów `claude` |

## 4. Dowody z komendami

Pełny spis komend per scenariusz: `odbior-faza-1.md` §3 („Jak sprawdzić na Dagu") i §5
(„dowód"). Reprezentatywne odczyty żywego stacku (wszystkie read-only, bez wywoływania
modelu):

```sh
# zdrowie backendu: poświadczenia, polityka, sesja
curl -sS http://127.0.0.1:8080/api/health
# -> {"ok":true,"credentials":"wazne","polityka":"gotowa","sesja":"podpieta"}

# deep-linki procesu i wykonania (R04): 200 + Content-Security-Policy: frame-ancestors 'self'
curl -sS -D - -o /dev/null http://127.0.0.1:8080/dagu/dags/premie-od-pensji/status
curl -sS -D - -o /dev/null http://127.0.0.1:8080/dagu/dag-runs/<nazwa>/<dagRunId>

# status przebiegu czytany z silnika, nie z prozy modelu (E8)
curl -sS -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8080/dagu/api/v1/dag-runs/<nazwa>/<dagRunId> | jq '.dagRunDetails.statusLabel'

# routing i obcinanie prefiksu (R11): 200 text/javascript z prefiksem, 404 bez
curl -sS http://127.0.0.1:8080/dagu/ | grep -o '/dagu/assets/[^"]*\.js' | head -1

# ograniczenie publikacji (R10)
docker compose port proxy 80          # -> 127.0.0.1:8080
curl http://<adres-LAN>:8080/         # -> Connection reset by peer
```

Dowody niszczące i pomiarowe (egress, root kroku, podmiana definicji, prowokacja modelu)
wykonano na izolowanych stanowiskach opisanych w raportach T1 §3/§10, T2 §5–§6 i rejestrze
§8; na żywym stacku w dniu odbioru nie uruchamiano niczego poza wymienionym w §7.

## 5. Naprawa GLM (2026-09-20) i koszt tury czatu

Pierwsza tura czatu odbioru padła z 500 („Your organization has disabled Claude subscription
access"). Przyczyna: host przełączył CLI na **GLM** (`~/.claude/settings.json`,
`ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic`), a kontener dostawał z hosta wyłącznie
`.credentials.json` — CLI w kontenerze dzwonił do Anthropic z poświadczeniami, które tam
nie działają. Naprawa tym samym kanałem co poświadczenia (odbiór §5.1):

* sidecar `poswiadczenia` obserwuje i kopiuje także `settings.json` do wolumenu,
* `syncCliSettings()` (`chat-backend/credentials.mjs`) kopiuje przed każdym zapytaniem
  **wyłącznie blok `env`** — hooks i permissions hosta celowo nie przechodzą; brak pliku
  na hoscie kasuje kopię,
* testy 9/9.

Po naprawie wszystkie tury przeszły na GLM. **Koszt odbioru: 5 wywołań `/api/chat`,
łącznie 0,90 USD** (0,09–0,29 USD za turę; tura autorska ~100–120 s). `costUsd` pozostaje
szacunkiem raportowanym przez CLI — **nie jest fakturą** (decyzja §4.3). Liczby odniesienia
z baseline'u są cenami Claude i **nie są porównywalne**; kryteria tak/nie scenariuszy
zostały.

## 6. Pominięcia

* ~~**R07 — zachowanie przy wygasłych poświadczeniach: `niezweryfikowane`.**~~ **Zamknięte
  2026-09-20 drillem na kopii** (`docs/raport-t5-odbor-uzupelniajacy.md` §4): oba warianty —
  „brak pliku" i „wygasły token" — dały health 200 z poprawnym stanem i `expiresAt`,
  `/api/chat` **503** z komunikatem zgodnym co do znaku z baseline'em i **zero** procesów
  `claude`. Ścieżka kodu bez zmian wobec baseline'u (503 przed uruchomieniem CLI).
* Pełne **E7** (przełączenie `git switch main` + profil `n8n` na żywym układzie) nie było
  częścią odbioru §5; odzyskanie danych n8n z backupu jest przećwiczone na kopii
  (raport T1 §1, procedura `wycofanie.md` §4).
* **Anulowanie tury przez operatora** — funkcji nadal nie ma (nie było jej też przed
  zmianą: nie regresja, raport T3 §7.4).

## 7. Zmiany stanu wprowadzone przez odbiór (odbiór §5.2)

1. 5 wywołań `/api/chat` (0,90 USD, GLM); powstał 1 proces (`odbior-status`, **usunięty po
   badaniu** — `dags/` wróciło do 6, git czysty); definicja `status-ok` nadpisana treścią
   identyczną (zero diffu); 4 wykonania w historii Dagu (historia silnika = licznik roboczy,
   nie wiedza).
2. Restart `dagu` (R09) i recreate `chat-backend` + `poswiadczenia` (naprawa GLM). Wolumen
   `n8niframe_dagu_data` i `n8niframe_n8n_data` nietknięte.
3. Kod naprawy GLM: `chat-backend/credentials.mjs`, `server.mjs`,
   `test/credentials.test.mjs`, `docker-compose.yml`.
4. Dokument odbioru + 4 zrzuty `docs/odbior-*.png`; serwer obcego originu zatrzymany.

## 8. Ograniczenia Fazy 1 — lista jawna

1. **R-C przyjęte, nie domknięte.** Krok DAG-a biegnie jako root w kontenerze silnika:
   czyta `config.yaml` (materiał do podrobienia tokenu admina), zapisuje po `base.yaml`
   i `dags/`. Bramka polityki jest **narzędziem poprawności danych, nie mechanizmem
   bezpieczeństwa** (audyt P1–P3, decyzja §5.2).
2. **Model zagrożeń: jeden operator, wyłącznie `127.0.0.1`.** Napastnikiem jest model, który
   się myli, nie model, który atakuje. Przy drugim operatorze albo wystawieniu poza pętlę
   lokalną przyjęcie R-C przestaje być proporcjonalne — to warunek brzegowy zapisany
   w §5.2 decyzji.
3. **Ceny wariantu B2:** wylogowanie nie unieważnia serwerowo (rotacja = wymiana tokenu
   w konfiguracji Caddy), proxy nadaje wszystkim wspólną tożsamość admina Dagu. Rekomendacja
   wystawienia przeglądarce tokena `viewer` (T2 §5.3, droga #10) — **niezrealizowana**.
4. **Ruch boczny w sieci wewnętrznej:** krok dosięga `proxy`, `frontend`, `chat-backend`
   po nazwie DNS; łagodzone sesją (401 bez ciasteczka), pełne domknięcie wymaga osobnej
   instancji silnika (raport T1 §10.1). Egress na internet jest zamknięty (`internal: true`,
   zmierzone), usługi hosta nieosiągalne (rootless Docker).
5. **Harmonogramy wyłączone** — `schedule:` odrzuca polityka (`HARMONOGRAM_POZA_BRAMKA`),
   bo zaplanowanego startu nie da się objąć kontrolą sumy; powrót wymaga decyzji operatora
   (raport T2 §8.4).
6. **Forma A kontraktu (akcje z pliku bazowego) nie działa na żywym układzie** — `base.yaml`
   jest pusty, działa wyłącznie forma B (schemat w definicji); raport T3 §10.1.
7. **Reguły polityki dla K6 nieimplementowane** (sufit stdout, kształt manifestu) — sam K6
   jest potwierdzony jako DAG dowodowy `duze-dane-manifest` (rejestr §8.6). Praktyczny sufit
   kanału: **128 KiB** (`MAX_ARG_STRLEN`), nie 1 MiB z L5.
8. **Tury `/api/chat` są szeregowane** (obserwator bramki wiąże wywołania z turą) — jawna
   drobna regresja przy dwóch równoległych rozmowach; prototyp jednoosobowy (raport T3 §2.2).
9. **Sesje operatora w pamięci procesu** — restart backendu = ponowne logowanie; trwały
   magazyn sesji to sprawa Fazy 2 (raport T1 §10.4).
10. **Historia rozmów CLI nie jest trwała** — wolumen poświadczeń celowo nie obejmuje
    `projects/`; znane zachowanie, takie samo jak w baseline (odbiór R09).
11. **Fałszywie dodatnia heurystyka** `WZ_DEKLARACJA_SUKCESU` w `chat-backend/polityka/wynik.mjs`
    (plik T2): trafia w słowo sukcesu zacytowane/zaprzeczone; werdykt pozostaje poprawny
    (bierze się ze statusu z silnika), nieprawdziwe bywa tylko zdanie wstępne komunikatu
    (raport T3 §7.5). Zgłoszone, nie naprawione.
12. ~~**R07 niezweryfikowane**~~ (zamknięte drillem t5, §6) i ~~brak pełnego E7~~
    (przećwiczone na kopii — raport t5 §3; na żywym układzie celowo nie wykonywane, by nie
    ryzykować stacku bez potrzeby — przełączenie produkcyjne to decyzja operatora).
13. **Limity Community:** jeden użytkownik, maks. 2 klucze API (oba zajęte: `proxy-ui`,
    `agent-mcp`), brak RBAC/audit — ograniczenie edycji produktu, nie licencji (decyzja §7.2
    L1, audyt [D35]).

## 9. Dokumenty źródłowe

`decyzja-architektoniczna.md` (v3.1) · `audyt-dagu.md` · `audyt-dagu-walidacja.md` ·
`audyt-dagu-bezpieczenstwo.md` · `rejestr-workflow.md` (§0.1, §7–§8) · `baseline-prototypu.md` ·
`raport-t1-infrastruktura.md` · `raport-t2-polityka-kontraktu.md` · `raport-t3-integracja.md` ·
`odbior-faza-1.md` (§5 = 2026-09-20) · `macierz-wymagania-testy.md` · `handoff-faza-2.md` ·
`wycofanie.md`.
