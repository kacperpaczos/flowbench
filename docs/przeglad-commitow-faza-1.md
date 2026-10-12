# Przegląd niezcommitowanych zmian Fazy 1 — raport recenzenta

Data: 2026-09-20. Rola: recenzent i opiekun commitów Fazy 1; **nie jestem autorem
żadnej z przeglądanych zmian** (kod naprawy GLM, dokumenty workerów, zrzuty). Zakres:
całość diffu względem `HEAD` (`ae567c1`) plus pliki nieśledzone w `docs/`. Konwencja:
komunikaty commitów po polsku, bez diakrytyków, tematycznie — zgodnie z historią repo.

## 1. Bezpieczeństwo — skan na sekrety przed commitem

**Wynik: czysty.** Co dokładnie sprawdzono:

* **`.env` jest zignorowany i nieśledzony** — `git check-ignore -v .env` wskazuje regułę
  `.gitignore:2`; w indeksie nie ma żadnego pliku sekretowego (`git ls-files` zwraca
  wyłącznie `.env.example` i kod). `.gitignore` obejmuje `.env*`, `*.credentials.json`,
  `*.pem`, `*.key`, `secrets/`; wyjątek `!.env.example` jest poprawny.
* **Zero wartości z `.env` w zmianach.** Przeliczono wszystkie wartości kluczy
  (`DAGU_AUTH_TOKEN_SECRET`, `DAGU_PROXY_TOKEN`, `DAGU_AGENT_TOKEN`, `SESJA_HASLO`,
  `SESJA_ORIGIN`, `SESJA_TTL_H`) przeciwko pełnemu diffowi i nowym dokumentom. Jedyne
  trafienie to `SESJA_ORIGIN` = `http://127.0.0.1:8080` — pętla lokalna, udokumentowana
  w HEAD wielokrotnie; to nie sekret.
* **Wzorce tokenów/kluczy**: `sk-…`, `ghp_`, `AKIA…`, `eyJ…` (JWT), bcrypt `$2a/b/y$`,
  base64 40+ — brak trafień. Dwa pozorne: skrót `sha256:b242dc7b…` (digest obrazu Dagu,
  identyfikator treści, nie sekret) oraz `ANTHROPIC_AUTH_TOKEN` w testach — jako nazwa
  klucza z atrapą `'x'`.
* **Hasło demonstracyjne `Admin123`** występuje w nowych dokumentach (raport t5), ale jest
  stanem ustalonym repo: siedzi w HEAD (README, docker-compose.yml — jako hash bcrypt,
  baseline, wycofanie) i jest odnotowane jako celowe, lokalne, demonstracyjne w §11 decyzji
  architektonicznej. Stack słucha wyłącznie na pętli (R10). Nie wprowadzono żadnego nowego
  materiału uwierzytelniającego.
* **Szyfrogramy n8n**: rejestr workflow wymienia marker `U2FsdGVkX1` i blob-y po 536 znaków,
  ale **żaden pełny szyfrogram nie trafił do dokumentu** (skan po pełnych blobach: 0 trafień;
  w treści jest wyłącznie nazwa markera). Spreparowane poświadczenia w drillu R07 są jawnie
  fałszywe (`FAKSYFIKOWANY-TOKEN-DRILL-R07`).
* **Zrzuty PNG** — poprawne obrazy (weryfikacja `file`), 28–140 KB, brak załączonych danych.

## 2. Egzekwowanie kontraktu i bramek

* **Brak drugiego silnika/daemona.** Zmiana w `docker-compose.yml` nie dodaje usługi —
  rozszerza istniejącego sidecara `poswiadczenia` o obserwację drugiego pliku
  (`settings.json`) tą samą pętlą `sledz()`, z podmianą atomową (`cp` + `mv` w tym samym
  katalogu) i usuwaniem kopii, gdy plik źródłowy znika.
* **Brak obejścia bramek.** `syncCliSettings()` (`chat-backend/credentials.mjs`) przenosi
  z hosta **wyłącznie blok `env`** konfiguracji CLI; `hooks` i `permissions` hosta celowo
  nie przechodzą — testy tego dopilnują (`'hooks' in zapisane === false`, prawa 0600).
  Bramka polityki (`chat-backend/polityka/`) i brama sesji nie są w diffie dotykane.
  Kanał GLM (`ANTHROPIC_BASE_URL`) to decyzja operatora na hoście, odbita do kontenera;
  opisana w `docs/odbior-faza-1.md` §5.1.
* **Testy**: pełna suita `chat-backend` na commicie roboczym: **162/162** (`node --test`),
  w tym 9 nowych dla `syncCliSettings` (zgodnie z twierdzeniem §5.1).

## 3. Zmiany wprowadzone przez recenzenta (zlecone, faktograficzne)

Dwa uzupełnienia wskazane przez koordynatora (źródło prawdy:
`docs/raport-t5-odbor-uzupelniajacy.md` §7):

1. `docs/odbior-faza-1.md` — etykieta wiersza R07 w §2 i wpis w tabeli §5 zmienione na
   `zaliczony 2026-09-20 (kopia, raport t5)`; dowód z raportu t5 §4 (oba warianty:
   „brak pliku” i „wygasły token”, health 200 z właściwym stanem, `/api/chat` 503,
   zero procesów `claude`, koszt 0). Odbiór: **18/18**.
2. `docs/wycofanie.md` §4.4 — notatka o niuansie ekstrakcji tar-pipe do świeżego wolumenu:
   pliki powstają jako root, potrzebne `chown -R 1000:1000` (albo wcześniejsze przejęcie
   katalogu głównego wolumenu), inaczej pierwszy przebieg kończy się błędem tar na pliku
   `config` (klucz szyfrowania, tryb 0600).

Poza tym **nic nie poprawiano** — nie znaleziono usterek technicznych wymagających korekty
(`.gitignore` kompletny, zrzuty poprawne, odnośniki do plików zgadzają się z nazwami).

## 4. Co zostawiono i wymaga rozliczenia przez autorów

* **`docs/raport-finalny-faza-1.md`** (§0, tabela §2, §6, §12) i
  **`docs/macierz-wymagania-testy.md`** (3 miejsca) nadal podają **17/18** i
  `R07 niezweryfikowane`. Po drillu t5 są nieaktualne. Nie poprawiano: recenzent miał
  jawny zakaz zmian w treści innych dokumentów; do uaktualnienia przez autorów/koordynatora.
* **Narracja §2 odbioru** („każda z tych pięciu pozycji ma nadal `niezweryfikowane`”)
  opisuje stan z 2026-09-18 (przed wykonaniem odbioru); tabela i §5 dają stan na
  2026-09-20. Warstwy chronologiczne zostawione zgodnie z intencją autora.

## 5. Seria commitów i kotwica rollbacku

Zmiany podzielone tematycznie (dokumenty audytów i odbiorów, naprawa GLM, raport drilli,
produkty finalne, zrzuty razem z dokumentami, które się do nich odwołują). Ostatni commit
jest **kotwicą rollbacku** i dostaje tag `faza1-odbor`; komunikat skraca procedurę
wycofania z `docs/wycofanie.md`:

* **Poziom A** (~1 min, bez Gita): `docker compose --profile n8n up -d` — stary silnik
  obok nowego.
* **Poziom B** (~5 min): `docker compose --profile n8n stop` (bez `-v`!),
  `git switch n8n` albo `git checkout stan-zastany-n8n` (commit `931e6b3`),
  przywrócić `.env` sprzed Fazy 1 (tylko `N8N_MCP_TOKEN`), `docker compose up -d --build`.
  Wolumen `n8niframe_n8n_data` Faza 1 nietknięta, więc dane wracają bez odtwarzania.

Dokładne kroki, backup i odtworzenie z kopii — `docs/wycofanie.md`.
