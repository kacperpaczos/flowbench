# Macierz wymaganie → zadanie → test — domknięcie Fazy 1

Data: 2026-09-20. Jedna spójna macierz: każde wymagane zachowanie ma **właściciela**
(zadanie T1–T5) i **dowód** (test albo pomiar), ze statusem na dzień domknięcia Fazy 1.
Wymagania pochodzą z `docs/decyzja-architektoniczna.md` v3.1 (§4.1, §4.2, §5, §7, §7a,
**§10**, §13); nic tu nie przeczy audytom (`audyt-dagu.md`, `audyt-dagu-walidacja.md`,
`audyt-dagu-bezpieczenstwo.md`).

**Zadania:** T1 infrastruktura i granice dostępu (raport `raport-t1-infrastruktura.md`) ·
T2 warstwa polityki kontraktu (`raport-t2-polityka-kontraktu.md`) · T3 integracja backendu,
ramki i UI (`raport-t3-integracja.md`) · T4 migracja definicji i fixture (`rejestr-workflow.md`
§7–§8; osobnego raportu nie ma — dowody w rejestrze i w `dags/`, `fixtures/`) · T5 odbiór
(`odbior-faza-1.md`, §5 = wynik z 2026-09-20).

**Statusy:** `potwierdzone` (dowód wykonaniem) · `częściowo` (dowiedzione w zakresie
wypisanym) · `niezweryfikowane` (bez pomiaru) · `poza zakresem` (decyzja świadoma).

---

## 1. Kontrakt danych (§4.1, K1–K7)

| # | Wymaganie | Zadanie | Test / dowód | Status |
| --- | --- | --- | --- | --- |
| K1 | Krok publikujący wypisuje na stdout **jeden czysty dokument JSON**, logi na stderr | T4 (definicje), T5 | `tests/kontrakt/01`, `02` (z 40 testów silnika); reguły kształtu z tabeli §4.1 (`failed to decode stdout JSON` itd.) | potwierdzone |
| K2+K3 | `output:` + **obiektowy** `output_schema` na każdym kroku publikującym | T2 | Odmowa `K3_BRAK_SCHEMATU` — raport T2 §3 (luka 1); test `walidacja-definicji.test.mjs` | potwierdzone |
| K3 | Schemat nie może być pusty ani osłabiony | T2 | Odmowy ×4: `K3_SCHEMAT_PUSTY`, `K3_BRAK_REQUIRED`, `K3_BRAK_ADDITIONAL_PROPERTIES`, `K3_KONTRAKT_ROZNICA_TYPU` — T2 §3 (luka 2) | potwierdzone |
| K4 | Odbiorca czyta `"$NAZWA"` i parsuje `jq` | T2, T4 | Pozytyw z wartością (apostrof, cudzysłów, `$(id)`, backtick) — pomiar decyzji §4.1 i rejestr §8.5 („KANAL DANYCH: wartość dosłowna, nic nie wykonane") | potwierdzone |
| K5 | Zakaz drugiego kanału (`$DAGU_OUTPUT_FILE`, `outputs:`, `${steps.*.outputs.*}`) | T2 | Odmowy ×3: `K5_OUTPUT_FILE`, `K5_OUTPUTS`, `K5_ODWOLANIE_OUTPUTS` — T2 §3 (luka 4); skan `dags/` bez trafień poza komentarzami (rejestr §8.5) | potwierdzone |
| K6 | Duże wyniki artefaktem + manifest; walidacja manifestu ≠ walidacja zawartości | T4 | DAG `duze-dane-manifest`: artefakt 2 716 684 B, sha256 zgodny po obu stronach, zawartość przeliczona (50 000 rekordów); kontrola negatywna `USZKODZ=tak`: manifest przechodzi, zawartość `failed` — rejestr §8.6 | potwierdzone |
| K6 | **Reguła polityki** na praktyczny sufit stdout i kształt manifestu | T2 | Nieimplementowana — jawna luka, T2 §8.5. Sufit kanału zmierzony: **128 KiB** (`MAX_ARG_STRLEN`), nie 1 MiB — decyzja §4.1b, rejestr §8.6 | częściowo |
| K7 | Rozgałęzienie: tylko `condition` + dokument bramkowy o zamkniętym słowniku (`enum`); `eval` i `${steps.*.outputs.*}` zakazane | T4 | Wzorzec przepracowany w `premie-od-pensji-galezie` (rejestr §8.5); wektor `eval` zmierzony (decyzja §4.1b) | potwierdzone (wzorzec); egzekwowanie polityką niewykazane |
| — | Naruszenie schematu naprawdę czerwieni (krok `failed`, zależne `aborted`, DAG `failed`), także w sub-DAG-u i z `retry_policy` | T2, T5 | Test integracyjny „silnik naprawdę czerwieni naruszenie schematu" (T2 §2); walidacja §2.2 | potwierdzone |
| — | `mark_success` nie maskuje naruszenia | T2 | Odmowy `CONTINUE_ON_MASKUJE`, `CONTINUE_ON_DEFAULTS` — T2 §3 (luka 3) | potwierdzone |
| — | `continue_on: skipped` na gałęzi warunkowej **wolno**; fan-in zbiega | T2, T5 | Test integracyjny rozgałęzienia z fan-inem (T2 §2, §4); przebieg wariantu B (rejestr §8.2) | potwierdzone |
| — | Cykl w grafie, DAG bez kroków, naruszenia poza pierwszym poziomem (`defaults:`, sub-DAG, akcje własne, `foreach`, `handler_on`) | T2 | Odmowy `GRAF_CYKL` (luka 5), `DAG_BEZ_KROKOW` (luka 7), kontrola zagnieżdżonych definicji — T2 §3 | potwierdzone |

## 2. Przypadek odbiorczy §10 (oba warianty muszą przejść)

| # | Wymaganie §10 | Zadanie | Test / dowód | Status |
| --- | --- | --- | --- | --- |
| W1 | ≥ 3 zależne kroki, wynik kroku jest wejściem następnego | T4 | 8 kroków wariantu B, każdy z `depends` i odczytem `"$NAZWA"` — rejestr §8.5 | potwierdzone |
| W2 | Rozgałęzienie warunkowe zależne od **zawartości danych** | T4 | `podatek_wysoki`/`podatek_niski`, bramka liczona ze zbioru (`{"liczbaPowyzej":2,"liczbaPonizej":1}`) — rejestr §8.5 | potwierdzone |
| W3 | Fan-in zbierający gałęzie w jeden wynik | T4 | `suma_premii` z `continue_on: {skipped: true}` na obu gałęziach; wynik identyczny z wariantem A **bajt w bajt** — rejestr §8.5 | potwierdzone |
| W4 | Żaden krok nie woła LLM; determinizm | T4, T5 | Skan `dags/` (zero `type: agent`/`harness`/`llm:`) — rejestr §8.5; R03: ten sam wynik danych co wykonanie #12 n8n | potwierdzone |
| W5 | Proces powstaje **przez czat** (MCP), nie ręcznie | T3, T5 | T3 scenariusze 01–05 (43/43 sprawdzeń E2E na żywej aplikacji) i odbiór R02/R16 (tura autorska przez bramkę polityki). Uwaga: sam wariant B Premii wprowadziła migracja T4 (rejestr §8) — nie podważa to E1 | potwierdzone (mechanizm) |
| W6 | Operator widzi w ramce graf, kroki, wejścia i wynik | T3, T5 | T3 §4 E1/E3 (odczyt DOM ramki, kliknięta nawigacja) i odbiór R01/R04 | potwierdzone |
| — | Wariant A — wierność liczb 1:1 z n8n | T4 | Porównanie z `fixtures/premie-od-pensji/oczekiwane-wyjscie.json` pole po polu: 31 liści zgodnych (wartości, typy, precyzja, kolejność, komplet pól) — rejestr §8.4; tabela zbiorcza §8.3: **5/5 procesów zgodnych** | potwierdzone |
| — | Wariant B — przypadek odbiorczy, **graf inny niż w n8n** (przeprojektowanie, nie odtworzenie — §10.1, W-3) | T4 | Rejestr §8.5 (tabela wymagań §10 + skan); nie jest przedstawiany jako „odtworzenie" | potwierdzone |

## 3. Identyfikatory (§4.2)

| # | Wymaganie | Zadanie | Test / dowód | Status |
| --- | --- | --- | --- | --- |
| I1 | Identyfikator spełnia `^[a-z0-9][a-z0-9-]{0,38}$` | T2, T3 | Odmowy: kropka, wielka litera, diakrytyk, podkreślenie, wiodący dywiz, 40 znaków, pusta — T2 §3 (luka 6); granica 39/40 znaków na żywej aplikacji — T3 §5.1 | potwierdzone |
| I2 | Nazwa polska zachowana i widoczna | T3, T4 | UI pokazuje nazwę wyświetlaną obok identyfikatora (T3 §5.2); `nazwaWyswietlana` w odpowiedzi `/api/chat` | potwierdzone |
| I3 | Transliteracja deterministyczna, kolizje po naszej stronie | T2 | Testy `identyfikatory.test.mjs` (29 testów) | potwierdzone |
| I4 | Segment URL kodowany, deep-link działa | T3, T5 | R04 (200 + `frame-ancestors 'self'`, prefiks nieobcinany); zmiana identyfikatora zrywa stary deep-link — **jawna zmiana semantyki**, T3 §5.3 | potwierdzone |

## 4. Bezpieczeństwo (§5, §5.2) — werdykty rozstrzygnięte 2026-09-18

| # | Wymaganie | Zadanie | Test / dowód | Status |
| --- | --- | --- | --- | --- |
| S1 | `/api/chat` odmawia bez sesji (401/200/401 po wylogowaniu) | T1 | 15-punktowa sonda T1 §6 + 17 testów `sesja/brama.test.mjs`; odbiór R08 | potwierdzone |
| S2 | Kontrola Origin/CSRF | T1 | POST z obcym `Origin` → 403 (T1 §6; audyt P6) | potwierdzone |
| S3 | Sesja rozmowy związana z operatorem | T1, T3 | Rozmowa z poprzedniej sesji → `403` **przed** uruchomieniem modelu (T3 §9.2); test jednostkowy wiązania | potwierdzone |
| S4 | Krok DAG-a wobec sekretów — wynik zgodny z werdyktem R-C, bez drukowania wartości | T1 | Pomiar T1 §10.2: krok czyta `config.yaml` **własnego** silnika (przyjęte, `IZOLACJA-POZORNA`); sekrety backendu, poświadczenia modelu, socket, egress — nieosiągalne | potwierdzone (przyjęcie R-C) |
| S5 | Token silnika wg werdyktu B2: nieosiągalny dla kodu strony | T1, T3 | `localStorage` zawiera wyłącznie `SENTINEL-proxy-managed`, zero JWT (T1 §5); odbiór R01 (jedno logowanie, `auth/me` 200) | potwierdzone |
| S6 | Bramka polityki nieobchodzalna w chronionym zakresie | T2 | 14 dróg obejścia z werdyktami (T2 §5.3); klucz agenta `developer`+`mcp`-only: REST → 403 (T1 §8, audyt P5). Droga #10 (Start w UI Dagu) **otwarta z definicji** — operator jest poza bramką (§5.2); rekomendacja tokena `viewer` niezrealizowana | częściowo (zgodnie z §5.2) |
| S7 | Podmiana definicji między walidacją a startem wykrywana | T2 | Kontrola sumy: podmiana po `process_write` → `ZEZWOLENIE_SUMA`, start odmawia (T2 §6); działa też dla REST/UI i sub-DAG-ów | potwierdzone (na `process_run`; nie na przycisku Start UI) |

## 5. Parity i dane (§7, §7a)

| # | Wymaganie | Zadanie | Test / dowód | Status |
| --- | --- | --- | --- | --- |
| P1 | 18 scenariuszy baseline rozliczonych | T5 | Odbiór §2+§5 (2026-09-20) + drill t5 (raport `raport-t5-odbor-uzupelniajacy.md` §3–4, 2026-09-20): **18 zaliczonych, 0 niezweryfikowanych**; niuanse opisane per wiersz | potwierdzone 18/18 |
| P2 | Cztery procesy odtworzone, zgodność co do wartości, typów, precyzji i kolejności | T4 | `fixtures/_narzedzia/porownaj.py` na stdout ostatnich kroków: **wszystkie zgodne** — rejestr §8.3 | potwierdzone |
| P3 | Premie: wariant A (1:1) **i** wariant B (nowy graf) jako dwa osobne sprawdzenia | T4 | Rejestr §8.4 (pole po polu) i §8.5 (wymagania §10; wynik B identyczny z A bajt w bajt) | potwierdzone |
| P4 | Trzy wersje pośrednie Premii zachowane | T4 | `fixtures/premie-od-pensji/wersje/` — 4 pliki z migawkami `execution_data.workflowData` | potwierdzone |
| P5 | 15 obiektów rozliczonych i fizycznie zachowanych | T4, T5 | Rejestr (15 workflow i 12 wykonań do zera) + ponowna weryfikacja po przełączeniu: wolumen `n8niframe_n8n_data` przeżył, `integrity_check ok`, 15/12 (rejestr §0.1) | potwierdzone |
| P6 | Historia pracy agenta w Gicie | T4 | `dags/` i `fixtures/` w repozytorium, kolejne definicje jako commity na `faza-1-dagu`; odbiór R02: nadpisanie `status-ok` = zero diffu w Gicie | potwierdzone |
| P7 | Nowe wykonania nie potrzebują n8n | T5 | Profil `n8n` wyłączony, kontener nie istnieje (odbiór R18); E2E na żywym stacku przechodzi (T3 §10, odbiór §5) | potwierdzone |

## 6. Integracja i odbiór (§10, §11)

| # | Wymaganie | Zadanie | Test / dowód | Status |
| --- | --- | --- | --- | --- |
| E1 | Czat → autorstwo → wykonanie → odczyt → widoczny wynik (w przeglądarce) | T3, T5 | T3 scenariusz 01 (16/16) + odbiór R02/R03 | potwierdzone |
| E2 | Poprawka **istniejącego** procesu w tej samej rozmowie | T3, T5 | T3 §4 E2 (`sessionId` zachowany) + odbiór R05 (nadpisanie definicji, `{"status":"NOK"}`) | potwierdzone |
| E3 | Ramka pokazuje właściwy proces i wykonanie, także po ręcznej nawigacji | T3 | T3 scenariusz 04 (4/4) — kliknięcie w UI silnika zmienia kontekst znany rodzicowi | potwierdzone |
| E4 | `onLoad` nie jest dowodem gotowości | T3, T5 | Napis „Edytor gotowy" usunięty; dowód = odczytany element UI / kod HTTP (T3 §2.6) | potwierdzone |
| E5 | Restart w trakcie pracy i ręczny retry | T5 | Restart `dagu` → 1 s, 6/6 DAG-ów i historia z wolumenu (odbiór R09); recreate zachowuje dane (T1 §9); odporność klienta MCP na restart (T3 §5.7). Idempotencja retry kroku `failed` — osobnego scenariusza brak w raportach | częściowo |
| E6 | Timeout, błąd modelu, brak procesu, wylogowanie, błąd ramki | T3, T5 | Limit 420 s (zmierzony), brak procesu, wylogowanie, 502 ramki (T3 §5.4–5.6); R08 (błędne żądania). Anulowanie tury — funkcji nadal nie ma (nie regresja, T3 §7.4) | częściowo |
| E7 | Przełączenie i wycofanie na kopii | T5 | Odzyskanie danych n8n z backupu **przećwiczone na kopii** (15 procesów, sha256 OK — T1 §1, `wycofanie.md` §4). Pełne przełączenie `git switch main` + profil `n8n` na żywym układzie nie było częścią odbioru §5 | częściowo |
| E8 | Sukces czytany z silnika po `dagRunId` | T2, T3 | Model pisze „gotowe" przy czerwonym przebiegu → aplikacja pokazuje błąd (T2 §7, T3 §4 E8, odbiór R03) | potwierdzone |

## 7. Regresja baseline R01–R18

Pełne rozliczenie: `docs/odbior-faza-1.md` §2 i §5 (2026-09-20) + `raport-t5-odbor-uzupelniajacy.md`
(drill E5/E7/R07 na kopii, ten dzień). Wynik: **18/18 zaliczonych**. Każdy wiersz tamtej tabeli
ma dowód i zrzut; tu tylko mapa na zadania:

| Scenariusze | Zadanie odpowiedzialne | Wynik |
| --- | --- | --- |
| R01, R04, R11, R12, R13, R17 | T1 (proxy, B2) + T3 (ramka) + T5 | zaliczone |
| R02, R03, R05, R06, R16 | T3 (kontrakt `/api/chat`, bramka) + T5 | zaliczone |
| R08 | T1 (brama sesji) + T5 | zaliczone |
| R09, R10, R18 | T1 (stack, sieć, trwałość) + T5 | zaliczone |
| R14, R15 | T2 (bramka MCP) + T1 (klucz agenta) + T5 | zaliczone |
| R07 | T5 | **zaliczony** — drill na kopii (raport t5 §4): oba warianty, 503 przed CLI, zero procesów `claude` |

## 8. Suma dowodów — źródła

| Zestaw | Liczba | Źródło |
| --- | --- | --- |
| Testy kontraktu na poziomie silnika | 40 | `tests/kontrakt/*.test.mjs` |
| Testy warstwy polityki | 143 (walidacja 47, identyfikatory 29, bramka MCP 17, rejestr 12, drogi obejścia 10, zezwolenia 8, procesy repo 7, integracja 7, wynik 6) | `chat-backend/test/polityka/` — raport T2 §2 |
| Testy bramy sesji | 17 | `chat-backend/test/sesja/brama.test.mjs` — raport T1 §6 |
| Testy poświadczeń (po naprawie GLM) | 9 | `chat-backend/test/credentials.test.mjs` — odbiór §5.1 |
| Sprawdzenia E2E na żywej aplikacji | 43 (5 scenariuszy) | raport T3 §4 |
| Scenariusze odbioru regresji | 18 (17 zaliczonych) | `odbior-faza-1.md` §5 |
| Porównanie z fixture | 5 procesów + kroki pośrednie, wszystkie zgodne | rejestr §8.3 |

**Razem: 209 automatycznych testów + 43 sprawdzenia E2E + 18 scenariuszy odbioru + porównanie
fixture.** Pozycje `częściowo`/`niezweryfikowane` powyżej są jednocześnie listą jawnych
pozostałości — rozliczenie ich w kontekście Dużych Produktów: `docs/handoff-faza-2.md`.
