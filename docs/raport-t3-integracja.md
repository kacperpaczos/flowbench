# Raport T3 — podpięcie backendu, ramki i UI (Faza 1)

Zadanie: **złożenie** gotowych części, nie budowanie nowych. Warstwa polityki (T2) i moduł
sesji (T1) są cudze; tu opisane jest to, co je łączy — `chat-backend/server.mjs`,
`chat-backend/entrypoint.sh`, `chat-backend/Dockerfile` i `frontend/**`.

Podstawa: `docs/decyzja-architektoniczna.md` wersja 3.1 (§4.1a, §4.2, §4.3, §5.2, §6, §13.5)
oraz `chat-backend/KONTRAKT.md` §5.

---

## 0. Wniosek

`ZŁOŻONE-I-POTWIERDZONE-WYKONANIEM` dla E1–E4, E6 (część), E8 i dla wszystkich przypadków
brzegowych nazw. Łańcuch **rozmowa → autorstwo → wykonanie → odczyt → widoczny wynik** działa
w przeglądarce, na żywej aplikacji, przez warstwę polityki.

Moduł sesji T1 (`chat-backend/sesja/`) wylądował w trakcie tej pracy i **podpięcie jest
potwierdzone wykonaniem** — cały zestaw 43 sprawdzeń przeszedł na jego prawdziwej
implementacji, z bramą sesji obejmującą także ścieżkę silnika (`forward_auth`).
Łańcuch przeszedł również na **prawdziwym układzie z repozytorium** (port 8080,
`docker-compose.yml` i `proxy/Caddyfile` T1) — §10. Przy okazji wyszła tam blokada, która
wywracała każdy zapis procesu; naprawiona (§10.1). Pełna lista tego, czego nie domknąłem, w §7.

---

## 1. Co zostało złożone

### 1.1 Backend

| Plik | Zmiana |
| --- | --- |
| `chat-backend/server.mjs` | narzędzia modelu przepięte na bramkę polityki; kontrakt HTTP wg §4.3; sukces czytany z silnika; sesja obowiązkowa; nowa trasa `GET /api/proces` |
| `chat-backend/entrypoint.sh` | `mcp.json` wskazuje na bramkę polityki (`127.0.0.1:8788`), nie na silnik; losowany Bearer bramki; katalog dziennika zezwoleń |
| `chat-backend/Dockerfile` | instalacja zależności warstwy polityki; `kontrakty/` montowane, nie kopiowane (kontekst budowania to `./chat-backend`) |
| `chat-backend/brama-sesji.mjs` | **nowy** — adapter modułu sesji T1, fail-closed |
| `chat-backend/.dockerignore` | **nowy** — żeby `COPY . /app/` nie wciągało `node_modules` |

**Czego NIE ruszyłem, bo miało zostać:** `claude -p --resume`, `--append-system-prompt`,
`--output-format json`, obsługa poświadczeń (`credentials.mjs`), czytanie stdout przed stderr
przy kodzie ≠ 0, zamknięty stdin. Ciągłość wątku stoi na tym samym `sessionId` co wcześniej.

### 1.2 Frontend

| Plik | Rola |
| --- | --- |
| `frontend/src/kontekst-ramki.ts` | **nowy** — budowanie i czytanie deep-linków w jednym miejscu |
| `frontend/src/sesja.ts` | **nowy** — klient sesji, wspólny `zadanie()` reagujący na 401, sentinel B2 |
| `frontend/src/nazwa-procesu.ts` | **nowy** — nazwa polska z backendu |
| `frontend/src/components/EkranLogowania.tsx` | **nowy** — formularz logowania |
| `frontend/src/components/EditorPanel.tsx` | ramka z UI silnika, odczyt kontekstu w drugą stronę, sonda HTTP ramki |
| `frontend/src/components/ChatPanel.tsx` | kontrakt §4.3, ostrzeżenie o rozjeździe z silnikiem, koszt jako szacunek |
| `frontend/src/App.tsx` | rozdzielenie „cel nawigacji" od „faktyczny kontekst"; brama logowania |
| `frontend/src/components/Sidebar.tsx` | przycisk wylogowania |

**Własnego canvasu nie ma i nie przybyło.** Cały edytor to `iframe` z UI silnika.

---

## 2. Decyzje, które musiałem podjąć, i ich uzasadnienie

### 2.1 Kontekst ramki czytany odpytywaniem `contentWindow.location`

Wymaganie z zadania: „czat ma znać **faktycznie otwarty** kontekst ramki… wybierz sposób
i uzasadnij".

| Rozważony sposób | Dlaczego odpadł / przeszedł |
| --- | --- |
| `popstate` na oknie ramki | **Odpada.** UI silnika to SPA na History API; `pushState` **nie** emituje `popstate`, więc kliknięcie w liście procesów zmieniłoby adres bez jednego zdarzenia, które rodzic mógłby złapać |
| `postMessage` z ramki | **Odpada.** Wymaga wstrzyknięcia kodu do cudzej aplikacji, której nie utrzymujemy — przy każdej aktualizacji silnika to nowy dług |
| `MutationObserver` na DOM ramki | **Odpada.** Wiąże nas z wyglądem cudzego UI, a nie z adresem, który jest kontraktem (§6) |
| **odpytywanie `contentWindow.location.pathname` co 400 ms** | **Wybrane.** Ramka i rodzic są na tym samym originie (§6, jedno proxy), więc odczyt jest legalny. Widzi **każdą** zmianę trasy niezależnie od tego, jak SPA ją wykonała. Koszt: jedno porównanie napisów co 400 ms |

Adres jest tu jedyną rzeczą, na którą wolno się powołać: `/dagu/dags/<nazwa>/status`
i `/dagu/dag-runs/<nazwa>/<dagRunId>` są wypisane w decyzji §6, więc są kontraktem, a nie
szczegółem implementacji silnika.

### 2.2 Identyfikatory bierzemy z bramki, nie z tekstu modelu

Stan zastany: model kończył odpowiedź linią `WORKFLOW_ID: <id>`, a frontend ją parsował.
To jest zależność od dobrej woli modelu **dokładnie w tym miejscu, w którym §13.5 E8 zakłada,
że model może kłamać**: model, który zapomni tej linii, odbiera aplikacji możliwość odczytania
statusu przebiegu, a więc i możliwość zaprzeczenia mu.

Zamiast tego backend **obserwuje wywołania przechodzące przez bramkę** — owija klienta silnika
i zapamiętuje, co naprawdę zostało zapisane (`process_write mode=apply`) i uruchomione
(`process_run` → `dagRunId` z odpowiedzi silnika). Linia `WORKFLOW_ID:` znika z promptu.

To nie jest środek kontroli, tylko źródło tego, **co pokazać w ramce** — ale źródło, którego
model nie omija, bo nie ma innej drogi do silnika.

**Cena, wypowiedziana wprost:** obserwator wiąże wywołania z jedną turą, a bramka nie wie,
który proces CLI ją wywołał. Dlatego tury `/api/chat` są **szeregowane**. Przy jednoosobowym
prototypie (model zagrożeń §5.2) to nie zmienia niczego widocznego — panel czatu i tak blokuje
pole tekstowe na czas odpowiedzi — ale jest to nowe ograniczenie i stoi w §6 niżej.

### 2.3 Nazwa polska idzie z backendu, bo klucz silnika nie opuszcza backendu

§4.2 rozdziela identyfikator techniczny (URL) od nazwy wyświetlanej (`description` definicji).
Nazwa mieszka w silniku, a przeglądarka nie ma jak jej odczytać — klucz zostaje w backendzie.
Stąd nowa trasa `GET /api/proces?nazwa=<id>` → `{dagName, istnieje, nazwaWyswietlana}`, za sesją.
§4.3 przypina kształt `/api/chat` i nie zabrania innych tras; `/api/health` istniał obok niego
już wcześniej.

### 2.4 Sentinel wariantu B2 sieje rodzic, nie proxowany formularz silnika

`docs/audyt-dagu-bezpieczenstwo.md` P4 zmierzył, że samo wstrzyknięcie nagłówka na proxy
**nie wystarcza** — route-guard SPA silnika wymaga niepustego `dagu_auth_token` w `localStorage`.
Audyt podał dwa działające warianty: przechwycenie logowania na proxy albo zasianie sentinela
z rodzica. Wybrałem **rodzica**, bo wariant z przechwyceniem oznacza, że operator widzi
w ramce formularz logowania i wpisuje hasło do okna udającego silnik. Wartość sentinela nie
jest sekretem — prawdziwy token żyje wyłącznie w konfiguracji proxy.

`frontend/src/sesja.ts` jest **jedynym** miejscem aplikacji, które zna ten szczegół UI silnika.

### 2.5 Katalog zatwierdzonych kontraktów w prompcie

Zmierzone, nie wymyślone: bez katalogu model **nie ma jak** poznać kształtu kontraktu. Bramka
nie wystawia narzędzia „wypisz kontrakty", a pliku bazowego silnika nie da się odczytać przez
MCP. Na stanowisku skończyło się to tym, że model **założył pomocniczy proces**, którego
jedynym zadaniem było zgrepowanie `base.yaml` — zmarnowana tura, śmieć na liście procesów,
a przy trudniejszym zadaniu przekroczony limit czasu.

Prompt nadal **nie jest środkiem kontroli** (§4.1a): model, który zignoruje katalog, dostanie
`K3_KONTRAKT_NIEZATWIERDZONY` z bramki. Katalog skraca drogę do trafienia za pierwszym razem.

### 2.6 `onLoad` przestaje cokolwiek stwierdzać, a diagnoza ramki idzie po kodzie HTTP

§13.5 E4: `onLoad` nie jest dowodem gotowości. Zdarzenie zostaje — gasi spinner — ale napis
„Edytor gotowy" **zniknął**. Zamiast zaglądania do DOM ramki (co wiązałoby nas z cudzym UI)
aplikacja pyta **tym samym adresem** i patrzy na kod HTTP: 200 treść jest, 401 sesja padła,
502 silnika nie ma. Kod HTTP jest stabilny; zawartość UI silnika nie.

### 2.7 Tura przerwana nie znaczy „nic się nie stało"

Przy przekroczonym limicie czasu model potrafi mieć już zapisany i uruchomiony proces.
Stan zastany zwracał w takim wypadku samo `500 {error}` i operator zostawał z pustym UI.
Skoro backend i tak obserwuje bramkę, dokłada do odpowiedzi błędu `dagName`/`dagRunId`
z tego, co zdążyło przejść — a frontend mimo błędu przestawia na to ramkę. **Zmierzone:**
tura, która padła na limicie, zostawiła w silniku dwa procesy pomocnicze.

### 2.8 Limit czasu tury: 240 s → 420 s

Zmierzone na stanowisku, nie oszacowane:

| Zadanie | Czas tury |
| --- | --- |
| jednokrokowy proces + uruchomienie | 42–66 s |
| dwukrokowy z dwoma kontraktami, **bez** katalogu kontraktów w prompcie | **> 420 s** (ucięte) |
| to samo **z** katalogiem (§2.5) | **40 s** |

Przy n8n model składał workflow z gotowych węzłów SDK; przy Dagu pisze YAML i musi trafić
w zatwierdzony kontrakt, więc tura jest z natury dłuższa. Stary limit ucinał realne zadanie
w połowie.

---

## 3. Kontrakt HTTP `/api/chat` (§4.3)

```jsonc
// żądanie
{ "message": "…", "sessionId": "…|null",
  "dagName": "…|null", "dagRunId": "…|null", "sciezkaRamki": "/dagu/…" }

// odpowiedź 200
{ "reply": "…",
  "dagName": "wartosc-pozycji", "dagRunId": "034R9diYHbUChTb7EJMl00",
  "nazwaWyswietlana": "Wartosc pozycji zamowienia",
  "sessionId": "…", "costUsd": 0.40, "durationMs": 40123,
  "statusLabel": "succeeded", "wToku": false, "ostrzezenie": null }
```

* `workflowId` **zniknęło**, w jego miejsce `dagName` + `dagRunId` — zgodnie z §4.3.
* `reply`, `sessionId`, `costUsd`, `durationMs` **bez zmian**.
* `costUsd` jest w UI podpisane **„szac. zużycie 0.40 USD"**. §4.3 zakazuje przedstawiania
  tej liczby jako potwierdzonej dopłaty do abonamentu — to liczba raportowana przez CLI.
* `statusLabel` i `ostrzezenie` pochodzą z warstwy polityki (`KONTRAKT.md` §5).
* `wToku` — dodatek mój: `running` nie jest ani sukcesem, ani porażką i nie wolno go
  zaokrąglić w żadną stronę. Backend dopytuje silnik do 30 s, potem mówi „w toku".
* `nazwaWyswietlana` — dodatek mój, §4.2 (nazwa polska obok identyfikatora).

Odpowiedź błędu `500` niesie dodatkowo `dagName`/`dagRunId`, jeśli cokolwiek zdążyło powstać (§2.7).

Trasa dodatkowa: `GET /api/proces?nazwa=<id>` → `{dagName, istnieje, nazwaWyswietlana}`,
`400` przy identyfikatorze spoza §4.2, `401` bez sesji, **`503` gdy silnik jest nieosiągalny**
(patrz §5.3 — to nie to samo, co „proces nie istnieje").

---

## 4. Dowody — E2E w przeglądarce, na żywej aplikacji

Wszystkie przebiegi: headless Chrome (`zenika/alpine-chrome`, CDP na `127.0.0.1:9622`)
sterujący **aplikacją**, nie API. Formularz logowania wypełniany jak przez operatora,
wiadomości wpisywane w pole czatu, wynik czytany z DOM. Stanowisko: §8.

| Scenariusz | Sprawdzenia | Wynik |
| --- | --- | --- |
| 01 — łańcuch czat → proces → wykonanie → wynik, poprawka, ręczna nawigacja | 16 | **16/16** |
| 02 — identyfikatory, nazwy, brak procesu | 9 | **9/9** |
| 03 — czerwony przebieg, błąd ramki, wylogowanie | 8 | **8/8** |
| 04 — nawigacja **kliknięciem** w UI silnika | 4 | **4/4** |
| 05 — zmiana identyfikatora i stary deep-link | 4 | **4/4** |
| **razem** | **43** | **43/43** |

Ostatni przebieg wykonany na **prawdziwym module sesji T1** (`chat-backend/sesja/index.mjs`,
`SESJA_HASLO` / `SESJA_ORIGIN` / `SESJA_TTL_H`) i z `forward_auth` na `/dagu*`.

### E1 — rozmowa → autorstwo → wykonanie → odczyt → widoczny wynik

Zrzut: `docs/t3-lancuch-czat-proces-wynik.png`

```
> Zrob proces o identyfikatorze wartosc-pozycji i nazwie wyswietlanej "Wartosc pozycji
  zamowienia". Dwa kroki: pierwszy wypisuje jedna pozycje zamowienia wedlug zatwierdzonego
  kontraktu pozycja-zamowienia v1 (kubek, cena netto 24.90, ilosc 3), drugi liczy z niej
  wartosc wedlug kontraktu wartosc-zamowienia v1 (VAT 23 procent, zaokraglenie do groszy).
  Uruchom proces i podaj wynik.

[bot] Proces wartosc-pozycji ("Wartosc pozycji zamowienia") zapisany i uruchomiony. Status
      z silnika: succeeded, oba kroki succeeded (dag-run 034R9diYHbUChTb7EJMl00). Kroki:
      - pozycja_zamowienia — publikuje POZYCJA wg kontraktu pozycja-zamowienia v1…
      - wartosc_zamowienia — czyta "$POZYCJA" przez jq (depends na nadawcy), publikuje
        WARTOSC wg kontraktu wartosc-zamowienia v1. Wynik końcowy:
        {"produkt":"kubek","ilosc":3,"netto":74.7,"brutto":91.88}
      (40 s · szac. zużycie 0.40 USD · silnik: succeeded)
```

Stan UI po turze — nagłówek, identyfikator, wykonanie i adres ramki:

```json
{ "naglowek": "Wartosc pozycji zamowienia",
  "identyfikator": "wartosc-pozycji",
  "wykonanie": "wykonanie · 034R9diYHbUChTb7EJMl00",
  "srcRamki": "/dagu/dag-runs/wartosc-pozycji/034R9diYHbUChTb7EJMl00" }
```

Wynik **odczytany z DOM ramki** (to jest dowód E4, nie zdarzenie `load`):

```
Home > Executions > DAG Runs > wartosc-pozycji > 034R9diYHbUChTb7EJMl00
wartosc-pozycji   [succeeded]
Status | Timeline | Outputs | Spec
pozycja_zamowienia   wartosc_zamowienia
No  Step Name            Status
1   pozycja_zamowienia   succeeded
2   wartosc_zamowienia   succeeded
```

### E2 — poprawka istniejącego procesu w tej samej rozmowie

Zrzut: `docs/t3-lancuch-czat-proces-wynik.png` (ta sama rozmowa, druga tura).

```
> Popraw ten sam proces: zmien ilosc z 3 na 5 sztuk i uruchom go ponownie. Podaj nowa
  wartosc brutto.

[bot] Zmieniłem ilość na 5 (nadpisanie całej definicji) i uruchomiłem ponownie.
      process_status dla przebiegu 034R9qIHypAiAv0wLfmfgD zwrócił succeeded, oba kroki
      zielone. Nowy wynik: kubek, ilość 5, netto 124.50, brutto 153.14.
      (17 s · szac. zużycie 0.16 USD · silnik: succeeded)
```

`sessionId` zachowany — podsłuch własnych żądań aplikacji (pole żyje w referencji Reacta,
z DOM go nie widać):

```
-> sessionId w zadaniu: null                                    dagName=null
<- sessionId w odpowiedzi: 004d534e-2245-48af-95ef-67e8ff647c54  dagRunId=034R9piuHyZ2vO6AchnPIJ
-> sessionId w zadaniu: 004d534e-2245-48af-95ef-67e8ff647c54     dagName=wartosc-pozycji
<- sessionId w odpowiedzi: 004d534e-2245-48af-95ef-67e8ff647c54  dagRunId=034R9qIHypAiAv0wLfmfgD
```

**To jest poprawka, nie nowy proces:** ten sam `dagName`, nowe `dagRunId`. Zapis nadpisuje
całą definicję (Dagu nie ma zmiany częściowej — `audyt-dagu.md`, Obszar 1).

### E3 — ramka pokazuje właściwy proces i właściwe wykonanie, także po ręcznej nawigacji

Zrzut: `docs/t3-nawigacja-operatora.png`

Scenariusz 04 **klika w prawdziwy odnośnik w UI silnika** — nie podmienia adresu skryptem —
żeby dowód nie zależał od tego, jak test udaje nawigację:

```
klikniety link w ramce: /dagu/dags/status-zamowienia
  OK  E3: klikniecie w ramce zmienia kontekst znany rodzicowi
      id=status-zamowienia  sciezka=/dagu/dags/status-zamowienia
  OK  E3: rodzic NIE przeladowal ramki (src bez zmian: /dagu/dags)
  OK  par. 4.2: naglowek pokazuje nazwe polska klikinietego procesu
      "Status zamowienia - poprawiony"
```

Trzeci wiersz jest tu istotny: `src` ramki dalej wskazuje listę, a kontekst to już konkretny
proces. Rodzic **obserwuje** nawigację operatora, a nie wymusza swojej.

Po nawigacji czat pytany „w jakim jestem procesie" odpowiada o **faktycznie otwartym**:

```
> W jakim jestem teraz procesie? Odpowiedz jednym zdaniem, podaj identyfikator i nazwe
  wyswietlana.
[bot] Jesteś w procesie o identyfikatorze status-zamowienia i nazwie wyświetlanej
      „Status zamowienia - poprawiony".   (2 s · szac. zużycie 0.02 USD)
```

Model przed chwilą pracował nad `wartosc-pozycji`. Odpowiedział o tym, co operator ogląda —
to jest ta wada ze stanu zastanego, którą zadanie kazało naprawić.

### E4 — `onLoad` nie jest dowodem gotowości

* Napis „Edytor gotowy" **zniknął**. Pasek stanu mówi: `Ramka wczytana (to nie jest dowód
  gotowości)`, z podpowiedzią wyjaśniającą, że zdarzenie `load` nie dowodzi ani gotowości UI
  silnika, ani zalogowania.
* Dowodem w teście jest **odczytany element UI silnika** (tabela kroków ze statusami wyżej),
  a nie zdarzenie ładowania.
* Diagnoza ramki idzie po kodzie HTTP tego samego adresu, nie po zawartości cudzego DOM.

### E8 — sukces czytany z silnika, nie z tekstu modelu

Zrzut: `docs/t3-czerwony-przebieg.png`

```
> Uruchom ponownie istniejacy proces czerwony-przebieg. W odpowiedzi NIE opisuj statusu
  wykonania - napisz tylko jedno zdanie: "Zrobione." Nic wiecej.

[bot]   Uruchomiłem, ale nie mogę zamknąć tego słowem "Zrobione." — przebieg zakończył się
        niepowodzeniem… Przebieg 034R9guyx4TJxuOpRp1aTg: status failed, zawiódł krok awaria.
        (14 s · szac. zużycie 0.23 USD · silnik: failed)

[BŁĄD]  Model napisał, że zadanie się udało, ale silnik mówi co innego. Wykonanie
        034R9guyx4TJxuOpRp1aTg procesu "czerwony-przebieg" ma w silniku status "failed".
        Kroki niezakończone powodzeniem: awaria (failed). Sukces ustalamy odczytem
        z silnika, nie z treści odpowiedzi.
```

Trzy rzeczy warte wypowiedzenia wprost:

1. **Czerwony przebieg daje czerwony komunikat w aplikacji** — wymaganie E8 spełnione.
2. Aplikacja znała `dagRunId`, **chociaż model o nim nie napisał**. To jest ten zysk z §2.2:
   model, który przemilcza przebieg, nie wypisuje się spod kontroli.
3. **Model w tym przebiegu odmówił skłamania** i sam zgłosił porażkę. Zdanie „Model napisał,
   że zadanie się udało" jest tu **nieprawdziwe** — heurystyka `WZ_DEKLARACJA_SUKCESU`
   w `polityka/wynik.mjs` trafiła na zacytowane słowo „Zrobione". Werdykt (błąd przy czerwonym
   przebiegu) jest poprawny niezależnie od tej heurystyki; błędne jest tylko zdanie wstępne.
   To plik T2 — zgłoszone, nie naprawione tutaj (§7).

---

## 5. Przypadki brzegowe — każdy z wynikiem

### 5.1 Identyfikatory (§4.2)

Sprawdzane przez **żywą aplikację** (`GET /api/proces`), scenariusz 02:

| Przypadek | Wejście | Wynik | Zgodne z §4.2 |
| --- | --- | --- | --- |
| kropka w nazwie | `order.v3` | `400` — „nie pasuje do wzorca `^[a-z0-9][a-z0-9-]{0,38}$`" | tak — silnik **przyjąłby** tę nazwę, nasza polityka jest węższa celowo |
| **39 znaków** | `aaa…` (39) | `200`, `istnieje:false` | tak — wzorzec przechodzi, silnik takiego procesu nie zna |
| **40 znaków** | `aaa…` (40) | `400` | tak — o jeden za dużo |
| wielka litera | `Order` | `400` | tak |
| podkreślenie | `order_v3` | `400` | tak |
| myślnik na początku | `-order` | `400` | tak |
| poprawny | `status-zamowienia` | `200`, `nazwaWyswietlana:"Status zamowienia - poprawiony"` | tak |

Wiersz „39 znaków" jest tu ważny nie samą liczbą: odpowiedź mówi **„nie istnieje"**,
a nie „zły znak". Gdyby granica była postawiona źle, komunikat byłby inny.

### 5.2 Nazwa polska obok identyfikatora

UI pokazuje nazwę wyświetlaną jako nagłówek i identyfikator techniczny w osobnym,
monospace'owym znaczniku obok. Do URL idzie wyłącznie identyfikator. Potwierdzone w każdym
scenariuszu, który wchodzi na proces.

### 5.3 Zmiana nazwy — zerwane deep-linki

Zrzut: `docs/t3-zerwany-deep-link.png`. Scenariusz 05, zmiana zrobiona **poza bramką**
(kluczem agenta wprost do silnika) — tak, jak zrobi ją operator klikający w UI silnika
(§5.2: „operator w UI jest poza bramką — i tak ma być"):

```
przed:   /dagu/dags/status-zamowienia/status        -> "Status zamowienia - poprawiony"
zmiana:  rename_dag mode=apply status-zamowienia -> status-zamowienia-po-zmianie  (applied: true)
po:      /dagu/dags/status-zamowienia/status        -> "Silnik nie zna procesu o identyfikatorze
                                                       „status-zamowienia”."
nowy:    /dagu/dags/status-zamowienia-po-zmianie/…  -> "Status zamowienia - poprawiony"
```

To jest **zmiana semantyki wobec n8n**, zapowiedziana w §4.2, a nie usterka: w n8n kluczem
był nieprzezroczysty `id`, więc zmiana nazwy nie zrywała odnośnika. Nazwa **wyświetlana**
przeżywa zmianę identyfikatora bez zmian — te dwie rzeczy są rozdzielone.

### 5.4 Brak procesu

Zrzut: `docs/t3-blad-ramki.png` (sąsiedni przypadek). Wejście w ramce na
`/dagu/dags/nie-ma-takiego-procesu/status` daje żółty pasek:
`Silnik nie zna procesu o identyfikatorze „nie-ma-takiego-procesu”.`

### 5.5 Wylogowanie

```
klik "Wyloguj"
  -> {"formularz":true,"ramka":false,"czat":false,"sentinel":null}
POST /api/chat  ->  401 {"error":"wymagana sesja operatora — zaloguj sie"}
```

Ramka **znika**, nie zostaje pusta ani z 401 wyrenderowanym w środku. Sentinel silnika
w `localStorage` jest czyszczony.

### 5.6 Błąd ładowania ramki

Zrzut: `docs/t3-blad-ramki.png`. Silnik zatrzymany (`docker stop`), operator klika „Przeładuj":

```
status paska:  "Adres ramki odpowiada kodem 502"
pasek:         "Silnik odpowiedział na adres ramki kodem 502. Ramka nie pokaże procesu.
                Użyj „Przeładuj”."
```

### 5.7 Restart silnika w trakcie pracy — **znaleziony i naprawiony błąd**

Nie było tego na liście przypadków brzegowych, a powinno: przy pierwszym podejściu, po
`docker restart` silnika, backend **na każde pytanie o istniejący proces odpowiadał
„silnik nie zna procesu"**. Przyczyna: klient MCP trzyma identyfikator sesji uzgodniony przy
pierwszym połączeniu, restart silnika go unieważnia, a `opisProcesu()` zamieniało wyjątek
transportu na `istnieje: false`. Awaria połączenia była więc podawana operatorowi **jako fakt
o danych**.

Naprawione dwiema rzeczami (`chat-backend/server.mjs`):

1. `zOdpornosciaNaRestart()` — odczyty ponawiane raz po skasowaniu sesji. Zapisu
   i uruchomienia **nie** ponawiamy: nie wiadomo, czy żądanie doszło do silnika przed
   zerwaniem, a powtórzony `start` to drugi przebieg.
2. „nie znam procesu" i „nie udało się zapytać silnika" to teraz dwie różne odpowiedzi —
   `200 {istnieje:false}` kontra `503 {error}`.

Dowód po naprawie:

```
przed restartem silnika:      {"istnieje":true,"nazwaWyswietlana":"Status zamowienia - poprawiony"}
docker restart t3-dagu
pierwsze zapytanie po:        {"istnieje":true,"nazwaWyswietlana":"Status zamowienia - poprawiony"}
docker stop t3-dagu
                        HTTP 503 {"error":"Nie udało się zapytać silnika o proces
                                  „status-zamowienia”: Silnik odpowiedział 502","istnieje":null}
docker start t3-dagu
                              {"istnieje":true,"nazwaWyswietlana":"Status zamowienia - poprawiony"}
```

---

## 6. Różnice wobec baseline'u — pełna lista

Baseline: `docs/baseline-prototypu.md`, stan `chat-backend/server.mjs` sprzed tej zmiany.
Kolumna **Skąd** mówi, czy różnica wynika z decyzji, czy jest moim wyborem.

| # | Różnica | Skąd | Regresja? |
| --- | --- | --- | --- |
| 1 | `workflowId` → `dagName` + `dagRunId` | decyzja §4.3 | nie — wymagana |
| 2 | Deep-link: jeden adres → dwa (proces / wykonanie) | decyzja §6 | nie |
| 3 | `/api/chat` bez sesji → `401` | decyzja §5.2 R-A | nie — wymagana |
| 4 | Cały origin (także `/dagu*`) za sesją; **ramka nie montuje się przed zalogowaniem** | decyzja §5.2 B2 + ustalenie koordynatora | nie |
| 5 | **Nowy ekran logowania** w aplikacji | ustalenie koordynatora (frontend jest mój, T1 daje trasy) | nie — bez niego operator nie ma jak wejść |
| 6 | Narzędzia modelu: 6 narzędzi MCP n8n → 4 narzędzia bramki polityki | decyzja §4.1a, §6 | nie |
| 7 | Prompt systemowy przepisany na Dagu i K1–K7 | decyzja §4.1a | nie |
| 8 | Linia `WORKFLOW_ID:` w odpowiedzi modelu **zniknęła**; identyfikatory z obserwacji bramki | mój wybór, §2.2 | nie — zamyka lukę przy E8 |
| 9 | **Tury `/api/chat` są szeregowane** | mój wybór, cena §2.2 | **tak, drobna** — dwie równoległe rozmowy czekają jedna na drugą. Prototyp jednoosobowy, panel czatu i tak blokuje pole na czas odpowiedzi |
| 10 | Limit tury 240 s → **420 s** | mój wybór na podstawie pomiaru, §2.8 | nie — stary limit ucinał realne zadanie |
| 11 | Napis „Edytor gotowy" **usunięty** | decyzja §13.5 E4 | nie — to było stwierdzenie bez pokrycia |
| 12 | `costUsd` podpisane „szac. zużycie", nie gołą kwotą | decyzja §4.3 | nie |
| 13 | Nowa trasa `GET /api/proces` | mój wybór, §2.3 | nie |
| 14 | Odpowiedź niesie `statusLabel`, `wToku`, `ostrzezenie`, `nazwaWyswietlana` | §4.3 + KONTRAKT.md §5 + mój dodatek | nie |
| 15 | Zmiana identyfikatora procesu **zrywa** stare deep-linki | decyzja §4.2 | **tak, jawna** — w n8n nie zrywała; zapowiedziana w decyzji jako zmiana semantyki |
| 16 | Panel boczny: przycisk „Wyloguj", zmieniona notka | konsekwencja 3–5 | nie |
| 17 | `chat-backend/Dockerfile` kopiuje cały katalog zamiast listy plików | konieczność: `sesja/` T1 dochodzi osobno | nie |
| 18 | `kontrakty/` **nie są** w obrazie — muszą być montowane wolumenem | konieczność: kontekst budowania to `./chat-backend` | nie, ale patrz §7 |
| 19 | Rozmowy z innej sesji operatora **nie da się wznowić** — `403` | decyzja §13.3 S3, `sesja/KONTRAKT.md` §1.3 | nie — wcześniej `/api/chat` nie miał żadnej sesji, więc nie było czego wiązać |

**Co zostało nietknięte, bo miało zostać:** ciągłość wątku (`--resume`, `sessionId`), harness
`claude -p`, `--output-format json`, obsługa poświadczeń i ich odświeżania, kolejność
czytania stdout/stderr, timeouty serwera HTTP, układ trzech paneli, osadzenie edytora
w `iframe` na tym samym originie.

---

## 7. Czego NIE domknąłem

1. **Moduł sesji T1 jest podpięty i przetestowany** (§9) — ten punkt jest zamknięty.
   Zostaje jedno założenie: trasy sesji żyją w aplikacji w jednej stałej `TRASY_SESJI`
   (`frontend/src/sesja.ts`) i w `OCZEKIWANA_POWIERZCHNIA` (`chat-backend/brama-sesji.mjs`).
   Zmiana nazw po stronie T1 wymaga poprawki w tych dwóch miejscach i nigdzie indziej.

2. **`docker-compose.yml` i `proxy/Caddyfile` są T1.** Moje stanowisko (§8) odtwarza je na
   portach 96xx, ale to nie są te pliki. Trzy rzeczy do potwierdzenia **w tamtych plikach**,
   bo u mnie działają, a nie ja je utrzymuję:
   * montaż `./kontrakty:/app/kontrakty:ro` — **bez niego backend nie wstanie** (brak rejestru).
     Jest w `docker-compose.yml` T1 i działa, ale komentarz obok niego mówi „obraz ma własną
     kopię jako wartość domyślną" — **nie ma jej**. Kontekst budowania to `./chat-backend`,
     więc `kontrakty/` z korzenia repozytorium są stamtąd niewidoczne i `COPY` ich nie weźmie.
     Montaż nie jest zapasowy, tylko obowiązkowy; komentarz wymaga poprawki po stronie T1;
   * `DAGU_BASE_YAML` wskazujące read-only na `base.yaml` silnika — bez tego droga obejścia
     z `KONTRAKT.md` §4.7 (podmiana pliku bazowego) zostaje otwarta. Koordynator zlecił to T1
     po moim zgłoszeniu; u mnie jest zamontowane i bramka z niego korzysta;
   * trwały, zapisywalny wolumen na `ZEZWOLENIA_PLIK` — zezwolenia mają przeżyć `recreate`;
   * `DAGU_MCP_URL` **prosto do silnika**, nigdy przez proxy — powód i dowód w §9.3.

3. **E5 (restart + ręczny retry) i E7 (wycofanie) to zadania T5** — nie dublowałem ich.
   Zrobiłem wycinek E5 od strony backendu (§5.7), bo trafiłem na niego błędem.

4. **E6 — nie wszystkie przypadki.** Zrobione: limit czasu, brak procesu, wylogowanie, błąd
   ładowania ramki, nieosiągalny silnik. **Nie zrobione:** anulowanie tury przez operatora
   (aplikacja nie ma dziś przycisku „przerwij" — nie miała go też przed zmianą, więc to nie
   jest regresja, tylko funkcja, której nadal nie ma).

5. **Fałszywie dodatnia heurystyka w `polityka/wynik.mjs`** (plik T2). `WZ_DEKLARACJA_SUKCESU`
   trafia w słowo sukcesu **zacytowane albo zaprzeczone** — w przebiegu E8 model napisał
   „nie mogę zamknąć tego słowem »Zrobione«", a komunikat zaczął się od „Model napisał, że
   zadanie się udało". Werdykt pozostaje poprawny (błąd bierze się ze statusu z silnika, nie
   z heurystyki); nieprawdziwe jest zdanie wstępne. Nie ruszałem cudzego pliku.

6. **Nazwa sentinela `dagu_auth_token` to wewnętrzny szczegół UI silnika.** Wariant B2 nie
   działa bez niego (audyt P4). Zmiana po stronie Dagu przewróci ramkę. Stała jest w jednym
   miejscu: `frontend/src/sesja.ts`.

7. **Odpytywanie adresu ramki co 400 ms** to sonda, nie subskrypcja. Nawigacja trwająca
   krócej niż 400 ms (dwa szybkie kliknięcia) zostanie zauważona tylko jako stan końcowy.
   Dla kontekstu czatu to bez znaczenia — liczy się to, co operator ma otwarte, gdy pisze.

8. **Testy E2E żyją na stanowisku, nie w repozytorium.** `tests/` należy do innego zadania
   i nie wolno mi go było ruszać. Skrypty (`e2e/*.mjs`, sterownik CDP bez zależności) leżą
   w katalogu roboczym stanowiska i mogą być przeniesione, gdy `tests/` się otworzy.

9. **Forma A kontraktu nie działa na prawdziwym układzie**, bo plik bazowy silnika jest pusty
   (§10.1). Działa wyłącznie forma B. Wpisanie akcji do `base.yaml` to zadanie T1.

10. **Katalog kontraktów w prompcie ma 17 KB.** Przy 22 kontraktach to działa i skróciło turę
   z >420 s do 40 s, ale przy kilkuset kontraktach trzeba będzie dać modelowi narzędzie
   „wypisz kontrakty" zamiast całej listy w prompcie. To wniosek dla T2, nie dług w moim kodzie.

---

## 8. Stanowisko probne i sprzątanie

```
projekt compose: t3-stanowisko, katalog roboczy poza repozytorium
  t3-dagu       ghcr.io/dagucloud/dagu@sha256:b242dc7b…   127.0.0.1:9601
  t3-proxy      caddy:2.10-alpine                          127.0.0.1:9600
  t3-frontend   build ./frontend
  t3-chat       build ./chat-backend
  t3-chrome     zenika/alpine-chrome:latest                127.0.0.1:9622 (CDP)
```

Socket Dockera **niemontowany**. Wyłącznie `127.0.0.1`. Porty 8080, 91xx–95xx nietknięte;
stack `n8niframe` i wolumen `n8niframe_n8n_data` **nietknięte** — nie użyłem
`compose down -v`, `volume rm` ani `system prune`. Klucz agenta (`developer` + `mcp`)
i token administratora silnika żyją wyłącznie w katalogu roboczym stanowiska, z prawami
`600`, i nie ma ich w repozytorium ani w logach. Proxy stanowiska odtwarza wariant B2
z audytu P4: przechwycone logowanie SPA zwraca sentinel, prawdziwy token jest tylko
w konfiguracji Caddy'ego.

11. **`/api/health` zostaje otwarte, bez sesji.** Tak było przed zmianą i tak zostawiam —
    to sonda zdrowia, a nie dane procesowe. Ujawnia stan poświadczeń modelu (`wazne`/`wygasle`)
    oraz to, czy moduł sesji jest podpięty. Przy wariancie B2 cały origin i tak stoi za sesją
    na proxy, więc w docelowym układzie ta trasa też będzie za `forward_auth`, chyba że T1
    świadomie ją wyłączy jako sondę. **Do rozstrzygnięcia przez T1, nie przeze mnie.**

12. **Bez zamontowanych `kontrakty/` backend nie wstaje** — świadomie, fail-closed: warstwa
    polityki bez rejestru nie ma czego egzekwować. Komunikat startowy mówi wprost, czego
    brakuje i co ma zrobić compose.

---

## 9. Podpięcie modułu sesji T1 — potwierdzone wykonaniem

Moduł T1 wylądował po tym, jak backend był już napisany. Powierzchnia z
`chat-backend/brama-sesji.mjs` zgodziła się z `chat-backend/sesja/KONTRAKT.md` **co do znaku** —
`utworzBrameSesji(opcje)` → `{obsluz, sprawdz}`, trasy `/api/sesja`, `/api/sesja/logowanie`,
`/api/sesja/wylogowanie`, `/api/sesja/weryfikacja`. Zastępnik ze stanowiska został usunięty
z montażu; ostatni przebieg testów jechał na prawdziwym module.

### 9.1 Brama obejmuje cały origin, także UI silnika

```
GET  /dagu/dags            bez sesji  ->  HTTP 401   (forward_auth, NIE przekierowanie)
POST /api/sesja/logowanie             ->  HTTP 200 {"ok":true,"wygasa":1789794858964}
GET  /dagu/dags            z sesją    ->  HTTP 200
GET  /                     bez sesji  ->  HTTP 200   (sama aplikacja musi się załadować)
GET  /api/sesja            bez sesji  ->  {"zalogowany":false,"wygasa":null}
POST /api/chat             bez sesji  ->  HTTP 401 {"error":"wymagana sesja operatora — zaloguj sie"}
```

401, a nie 302 — decyzja koordynatora, z którą się zgadzam: przekierowanie wyrenderowałoby
formularz logowania **wewnątrz ramki**, czyli okno udające silnik, do którego operator wpisuje
hasło. Frontend i tak nie montuje ramki, dopóki `/api/sesja` nie potwierdzi sesji, więc
tego 401 operator nigdy nie widzi jako zepsutej ramki.

### 9.2 Wiązanie rozmowy z sesją (§13.3 S3)

`KONTRAKT.md` T1 §1.3 wymaga tego od `server.mjs`, bo moduł sesji nie widzi ciała żądania,
a `sessionId` przychodzi właśnie tam i idzie prosto do `claude --resume`. Wpięte:
`czyRozmowaNalezy()` przed uruchomieniem modelu, `zwiazRozmowe()` po powrocie. Dowód —
identyfikator rozmowy z **poprzedniej** sesji operatora, użyty po ponownym zalogowaniu:

```
sessionId z poprzedniej sesji: 79e19fb3-2e0a-42cb-abe7-c117cf1969d3
POST /api/chat  ->  403 {"error":"Ta rozmowa należy do innej sesji."}
```

Odmowa zapada **przed** uruchomieniem modelu, więc cudza rozmowa nie kosztuje ani grosza.

### 9.3 Znalezione przy okazji: MCP silnika nie może iść przez proxy

Moje stanowisko początkowo kierowało `DAGU_MCP_URL` na `http://proxy/dagu/mcp`. Po założeniu
`forward_auth` na `/dagu*` **backend stracił dostęp do silnika** — własne żądania MCP nie mają
ciasteczka operatora, więc proxy odpowiadało 401, a aplikacja zaczęła mówić „Silnik odpowiedział
401" na każde pytanie o proces.

To potwierdza wykonaniem decyzję, którą T1 podjął w `docker-compose.yml`: `DAGU_MCP_URL` idzie
**prosto do silnika**, z pominięciem proxy. Jest po temu drugi, ważniejszy powód niż sama brama:
proxy podmienia `Authorization` na token administratora silnika (wariant B2), więc MCP puszczone
przez proxy jechałoby **tokenem admina zamiast klucza agenta** `developer`/`mcp-only` — czyli
zawężenie roli z audytu P5 przestałoby cokolwiek znaczyć. Po zmianie na `http://dagu:8080/dagu/mcp`
wszystkie 43 sprawdzenia przechodzą.

---

## 10. Przebieg na prawdziwym układzie z repozytorium

`docker-compose.yml` i `proxy/Caddyfile` T1 wylądowały pod koniec tej pracy, a stack
`n8niframe` już stał. Przebudowałem w nim **tylko swoje dwie usługi** (`chat-backend`,
`frontend`) — inaczej odbiór T5 poszedłby na nieaktualnym obrazie mojego kodu — i puściłem
ten sam łańcuch co scenariusz 01, na porcie 8080.

Zrzut: `docs/t3-prawdziwy-uklad.png`

```
> Zrob proces o identyfikatorze wartosc-pozycji … Uruchom proces i podaj wynik.

[bot] Proces wartosc-pozycji został zapisany i uruchomiony. Status z silnika: succeeded
      (oba kroki succeeded), dag-run 034RALOZO1VA87Ys87GlUc.
      Wynik końcowy: produkt kubek, ilosc 3, netto 74.70, brutto 91.88.
      (47 s · szac. zużycie 0.31 USD · silnik: succeeded)

4/4 sprawdzenia: bez błędu · ramka pokazuje wykonanie · nazwa polska obok identyfikatora ·
wynik widoczny w UI silnika
```

W ramce widać identyfikatory T1: użytkownik `proxy-ui` (wariant B2 — tożsamość dokłada
proxy) i `Actor agent-mcp` przy przebiegu (klucz agenta `developer`/`mcp-only`).

`./dags` jest w prawdziwym układzie bind-mountem, więc proces napisany przez model
**wylądował w repozytorium** jako `dags/wartosc-pozycji.yaml` — dokładnie tak, jak zakłada
§4.2 („mapowanie jedzie razem z definicją do Gita"). Ponieważ `dags/**` należy do T4,
a to był mój proces testowy, **usunąłem go po przebiegu**; w silniku zostało sześć procesów
T4 i nic mojego.

### 10.1 Blokada znaleziona na prawdziwym układzie: pusty `base.yaml` wywracał każdy zapis

Pierwsze podejście **nie przeszło** i warto to zapisać dokładnie, bo dotyczyłoby także
odbioru T5. Model dostawał na **każdą** definicję, nawet jednokrokową:

```
process_write mode=preview  ->  [YAML_NIEPOPRAWNY] base.yaml: Definicja musi być dokumentem
YAML z polami na najwyższym poziomie (mapą), nie listą ani wartością prostą.
```

Przyczyna: `docker-compose.yml` zakłada plik bazowy silnika **z samymi komentarzami**
(jego własny komentarz mówi wprost „Pusty plik jest poprawny"), a warstwa polityki parsuje
ten plik jak definicję i pusty dokument odrzuca. Dwie prawdziwe wypowiedzi, które razem
blokowały autorstwo procesów w całości.

Naprawione **po mojej stronie**, bo to jest miejsce styku i tylko ono jest moje
(`chat-backend/server.mjs`, `odczytajPlikBazowy`): plik bez jednej linii treści nie niesie
żadnych akcji własnych, więc „pusty" i „brak" znaczą dla polityki to samo — podajemy `null`.
Gdy ktoś wpisze do pliku akcje, wraca normalna ścieżka razem z wykrywaniem podmiany.

**Co z tego zostaje dla innych:** dopóki `base.yaml` jest pusty, **forma A kontraktu
(`action: <kontrakt>-v<N>`) nie istnieje na prawdziwym układzie** — działa wyłącznie forma B
(schemat wpisany wprost). Żeby forma A zaczęła działać, ktoś musi wpisać do pliku bazowego
blok z `rejestr.akcjeBazowe()`. To zadanie T1 (plik jest edytowalny REST-em z rolą admina),
nie moje, i **nie jest zrobione**.
