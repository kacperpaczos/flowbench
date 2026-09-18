# Decyzja architektoniczna: n8n → Dagu w prototypie

Data: 2026-09-18. Wersja 2. Faza 1 z dwóch. Podstawa: `docs/audyt-dagu.md` (1020 linii,
63 wiersze potwierdzone wykonaniem) i `docs/baseline-prototypu.md` (1205 linii, 18 scenariuszy
regresji).

## Status dokumentu

Operator zaakceptował kierunek i zakres Fazy 1, zgłaszając pięć poprawek. Wersja 2 je wnosi.
Ten dokument **nie jest jeszcze zamknięty** — trzy rzeczy czekają na dowód, dwie na decyzję.

| Co | Stan | Gdzie |
| --- | --- | --- |
| Zakres Fazy 1, granica silnik/domena, wersjonowanie, rollback | ustalone | §1, §2, §3, §11 |
| Izolacja sekretów od kroku DAG-a | **w weryfikacji** — środek może być pozorny | §5 R-C, `task_d6d69c09cb63` |
| Token silnika: `localStorage` czy proxy | **w weryfikacji** | §5 R-B, `task_d6d69c09cb63` |
| Egzekwowalna walidacja kontraktu danych | **w weryfikacji** — czy Dagu umie sam | §4.1a, `task_14d9d1890c33` |
| Rozliczenie 15 istniejących workflow | **w toku** | §7a, `task_40b2e9cf2d63` |
| Utraty funkcji A1–A2, L1–L7 | **zaakceptowane wprost 2026-09-18**, pod warunkami W-1 i W-2 | §7.1, §7.2 |

Dopóki którakolwiek pozycja „w weryfikacji" lub „w toku" jest otwarta, implementacja nie rusza
w zakresie, którego ta pozycja dotyczy.

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

### 4.1 Granica kroku

Dagu przekazuje między krokami **tekst** w `DAGU_OUTPUT_FILE` w formacie `KLUCZ=wartość`.
Nie istnieje `$json.pole`. Decyzja operatora: akceptujemy tę stratę i przyjmujemy konwencję.

**Konwencja obowiązkowa:**

* każdy krok, którego wynik jest wejściem innego kroku, zapisuje **jeden** klucz `RESULT`,
  którego wartością jest kompletny dokument JSON w jednej linii;
* krok odbierający czyta go przez `jq`, nigdy przez parsowanie tekstu ad hoc;
* kroki fan-in deklarują wynik przez `output:`, nie przez `outputs:` — agregat Dagu
  ignoruje to drugie;
* gałęzie warunkowe mają `continue_on: skipped`, inaczej fan-in po rozgałęzieniu nie zbiegnie.

### 4.1a Egzekwowanie konwencji — prompt to za mało

Poprzednia wersja tego dokumentu mówiła, że konwencję wymusza prompt systemowy agenta.
**To nie jest egzekwowanie.** Prompt jest prośbą do modelu; model może ją zignorować, a wtedy
zła definicja wchodzi do silnika i psuje się dopiero w trakcie wykonania, albo — gorzej —
nie psuje się wcale i przepuszcza złe dane dalej.

Kontrakt musi być egzekwowany maszynowo, na dwóch poziomach:

* **przy zapisie definicji** — zła definicja nie zostaje przyjęta;
* **w trakcie wykonania** — wynik niezgodny z kontraktem zatrzymuje przebieg głośno,
  zamiast płynąć dalej jako tekst.

**Którym mechanizmem — nierozstrzygnięte, zlecone:** `task_14d9d1890c33` ustala, czy Dagu
v2.16.6 potrafi to sam (`output_schema` i walidacja przy zapisie), czy trzeba dobudować
własną warstwę. Audyt zgłosił istnienie `output_schema`, ale **nie uruchomił go** — próba
padła na `sync |0: invalid argument` i nie wrócono do tematu.

Trzy możliwe wyniki i ich konsekwencje dla architektury:

| Wynik | Co z tego wynika |
| --- | --- |
| `NATYWNE-WYSTARCZY` | Kontrakt opisujemy w szablonach DAG-ów; nasz backend zostaje cienki, bez zmiany ścieżki MCP. |
| `NATYWNE-CZESCIOWO` | Natywne tam, gdzie działa; własna warstwa tylko na luki. |
| `NATYWNE-NIE-DZIALA` | Konieczny **adapter MCP po naszej stronie**: chat-backend przestaje być przezroczysty i staje się serwerem MCP opakowującym `dagu_change`, walidującym definicję przed przekazaniem do Dagu. To jedyne miejsce, w którym da się przechwycić autorstwo, bo dziś model rozmawia z MCP Dagu bezpośrednio. Harness (`claude -p`, `--resume`, ciągłość wątku) pozostaje bez zmian — zmienia się wyłącznie adapter narzędzi, zgodnie z granicą wyznaczoną w zleceniu. |

Prompt systemowy nadal opisuje konwencję, ale wyłącznie po to, żeby model trafiał za pierwszym
razem. **Nie jest środkiem kontroli** i nie wolno go w raporcie odbiorczym jako taki przedstawiać.

### 4.2 Identyfikatory

Nazwy DAG-ów są ograniczone do `^[A-Za-z0-9_-]{1,64}$`. To nie jest ozdoba: `server.mjs`
waliduje tym wyrażeniem identyfikator wstrzykiwany do kontekstu modelu, a `EditorPanel`
wkleja go wprost w URL ramki. Nazwa spoza tego zbioru zrywa deep-link.

Czy Dagu sam odrzuci nazwę spoza tego zbioru, czy musimy jej pilnować u siebie — sprawdza
`task_14d9d1890c33`. Jeśli Dagu przyjmuje dowolną nazwę, ograniczenie egzekwujemy w adapterze,
razem z resztą kontraktu.

### 4.3 Kontrakt HTTP naszego backendu

Kształt żądania i odpowiedzi `/api/chat` **nie zmienia się**, poza nazwą pola identyfikatora
procesu. Pola `reply`, `sessionId`, `costUsd`, `durationMs` zostają bez zmian, bo frontend
i ciągłość wątku na nich stoją.

## 5. Bezpieczeństwo

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
  niż administracyjne — **zlecone do weryfikacji**, `task_d6d69c09cb63`, pytanie 2.
* **B2 — token po stronie proxy.** Caddy trzyma token i wstrzykuje `Authorization` do żądań
  `/dagu/*`; przeglądarka nie ma czego wykraść. Daje ten sam efekt dla operatora — jedno
  logowanie — przy istotnie mniejszym ryzyku. **Wykonalność nierozstrzygnięta:** SPA Dagu może
  mimo wstrzykniętego nagłówka żądać logowania, bo jej własny stan klienta mówi
  „niezalogowany". Zlecone do weryfikacji w tym samym zadaniu.

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
> **Zlecone do weryfikacji:** `task_d6d69c09cb63`, pytanie 1. Do czasu werdyktu R-C pozostaje
> **otwarte**, a nie zamknięte. Jeśli środek okaże się pozorny, wracam do operatora
> z wariantami, które operator odrzucił wcześniej (executor kontenerowy, osobna instancja)
> albo ze stwierdzeniem, że w Community nie da się tego domknąć.

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
| Sesja | ciasteczko `n8n-auth`, `SameSite=Lax` | JWT w ciele odpowiedzi, token w `localStorage` |
| Autorstwo definicji | 6 narzędzi MCP (z 35) | 3 narzędzia MCP: `dagu_read`, `dagu_change`, `dagu_execute` |
| Zatwierdzenia, webhooki, artefakty | węzły n8n | REST pod tym samym prefiksem i tokenem — cienki klient w backendzie |
| Deep-link | `/n8n/workflow/<id>` | `/dagu/dag-runs/<nazwa>/<runId>`, lista: `/dagu/dags/<nazwa>/status` |
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
* **W-2.** Konwencje z §4.1 (`RESULT`/JSON, `output:` przy fan-in, `continue_on: skipped`
  na gałęziach, nazwy DAG-ów) muszą mieć **walidację maszynową oraz testy**, w tym testy
  negatywne pokazujące, że naruszenie konwencji jest wykrywane. Prompt systemowy nie jest
  środkiem kontroli i nie może być przedstawiany jako spełnienie tego warunku.

### 7.2 Utraty zaakceptowane wprost

| # | Utrata | Decyzja operatora |
| --- | --- | --- |
| A1 | **Brak edytora drag-and-drop.** Graf jest do oglądania; operator edytuje YAML w Monaco albo prosi czat. Prawdziwa utrata funkcji wobec n8n. | zaakceptowane 2026-09-18 |
| A2 | **Brak typowanego przepływu danych** między krokami; tekst zamiast `$json.pole`. | zaakceptowane 2026-09-18 |
| L1 | **Community: jeden użytkownik, max 2 klucze API, brak SSO, RBAC i audit logów** (HTTP 403 „requires a Dagu Pro license") | zaakceptowane **dla prototypu**; przed Fazą 2 wymagana osobna decyzja: zakup Dagu Pro albo inny silnik. Zapisane jako warunek brzegowy, nie jako sprawa zamknięta. |
| L2 | **Licencja GPL-3.0-or-later**; komercyjne osadzanie embedded Go API wymaga osobnej umowy | zaakceptowane dla użytku wewnętrznego. Wbudowanie Dagu w naszą binarkę lub sprzedaż z produktem to osobna rozmowa prawna. |
| L3 | **Brak automatycznego wznowienia przerwanego wykonania.** Zombie detector oznacza run jako `failed` po ~45–90 s; `retry` wznawia od miejsca awarii, ten sam run-ID, bez powtarzania ukończonych kroków | **ręczny retry**, bez watchdoga w Fazie 1. Semantyka ma zostać zmierzona, opisana i pokryta scenariuszem regresji — nie wystarczy ją zadeklarować. |
| L4 | **Katalog ~56 akcji** zamiast 1000+ węzłów n8n | zaakceptowane. Integracje spoza katalogu piszemy jako własne kroki. |
| L5 | **Limit `max_output_size` 1 MiB na krok** | zaakceptowane. Duże dane przez artefakty i pliki, nie przez zmienne. |
| L6 | **Zdjęcie `X-Frame-Options: DENY` na proxy**, podstawienie `frame-ancestors 'self'` | zaakceptowane. Zawężenie do jednego originu, nie globalne wyłączenie. |
| L7 | **Ograniczenia składniowe:** fan-in czyta tylko `output:`, ignoruje `outputs:`; gałęzie warunkowe wymagają `continue_on: skipped` | zaakceptowane **pod warunkiem W-2** — egzekwowane walidacją i testami, nie pamięcią operatora. |

## 7a. Rozliczenie istniejącej wiedzy

Zachowanie wolumenu nie jest rozliczeniem. Baseline ustalił, że w instancji n8n jest
**15 workflow**; każdy musi dostać jawną decyzję: odtworzyć w Dagu, zachować jako artefakt
historyczny, spisać na straty jako zbędny, albo nazwać nierozstrzygniętym.

**Zlecone:** `task_40b2e9cf2d63` → `docs/rejestr-workflow.md`. Rejestr obejmuje także obiekty
inne niż workflow: konto właściciela, klucz szyfrowania, klucze API instancji, poświadczenia,
tagi, zmienne i historię wykonań.

Do czasu powstania rejestru **rozliczenie wiedzy jest otwarte** i blokuje pełny odbiór Fazy 1.
Żaden obiekt nie może zniknąć ani zostać pominięty bez wpisu w tym rejestrze.

## 8. Licencja

GPL-3.0-or-later, nie MIT. Nasz scenariusz — Dagu jako osobny kontener, konsumowany przez
iframe i HTTP/MCP, użycie wewnętrzne, bez dystrybucji i bez linkowania — jest zgodny.

`LICENSING.md` v2.16.6 wprost zastrzega, że **komercyjne osadzanie embedded Go API wymaga
osobnej umowy**. Iframe nie zmienia nic prawnie. Gdyby kiedykolwiek pojawił się pomysł
wbudowania Dagu w naszą binarkę albo sprzedaży z produktem — to jest osobna rozmowa
z licencjodawcą, nie decyzja inżynierska.

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

Decyzja operatora: wieloetapowy DAG na realnym, wersjonowanym zbiorze wejściowym dogranym
do prototypu (snapshot JSON w repozytorium), nie na danych wymyślanych w locie.

Wymagania, wszystkie muszą być spełnione naraz:

* co najmniej **3 zależne kroki**, gdzie wynik kroku jest wejściem następnego;
* co najmniej jedno **rozgałęzienie warunkowe** zależne od zawartości danych;
* **fan-in** zbierający wyniki gałęzi w jeden wynik końcowy;
* **żaden krok nie woła LLM** — ten sam wejściowy snapshot daje ten sam wynik;
* proces powstaje **przez czat**, przez MCP, nie jest wklejony ręcznie;
* operator widzi w ramce graf, kroki, wejścia i wynik.

Kształt przypadku celowo naśladuje transformację produktową (normalizacja → rozgałęzienie po
rodzaju → wyprowadzenie wartości → agregacja podproduktów), żeby Faza 1 sprawdziła dokładnie
te właściwości Dagu, których Faza 2 będzie potrzebować — bez dotykania Dużych Produktów.

## 11. Rollback

Stary silnik zostaje do wycofania, ale **nie jest wymagany na nowej ścieżce**.

* Usługa `n8n` zostaje w `docker-compose.yml` za profilem Compose, domyślnie nie wstaje.
* Wolumen `n8niframe_n8n_data` zostaje nietknięty, z 15 istniejącymi procesami.
* Wycofanie: przywrócenie `proxy/Caddyfile`, `EditorPanel.tsx`, `App.tsx` i konfiguracji
  MCP w `chat-backend` z oznaczonego commitu, plus uruchomienie profilu `n8n`.
* Skrypt wycofania i procedura krok po kroku są produktem implementacji, nie tego dokumentu.
* Zakazane na każdym etapie: `docker compose down -v`, `docker volume rm`, `docker system prune`.

## 12. Czego ta decyzja nie rozstrzyga

* Trybu rozproszonego Dagu (coordinator + worker) — nie badany.
* Zachowania przy dużych partiach i przekroczeniu `max_output_size` (1 MiB/krok) — nie badane.
* Skuteczności izolacji przez `container.run` — nie badana, bo socket Dockera nie był montowany.
* Czy Dagu jest właściwym wyborem dla wieloosobowej aplikacji firmowej — patrz §7 pkt 4.
* Czegokolwiek dotyczącego Dużych Produktów v2.
