# Kontrakt wywołań warstwy polityki (T2)

Dokument dla zadania **T3** (podpięcie backendu i ramki). Opisuje **całą** powierzchnię
wywołań `chat-backend/polityka/`. T3 nie musi czytać kodu warstwy, żeby jej użyć.

Podstawa: `docs/decyzja-architektoniczna.md` **wersja 3** — §4.1 (K1–K6), §4.1a (podział
egzekwowania), §4.2 (identyfikatory), §4.3 (kontrakt HTTP), §13.1, §13.2.

> **Czym ta warstwa nie jest.** Nie jest drugim silnikiem. Nie ma własnego schedulera,
> retry, wykonywania kroków ani własnej implementacji JSON Schema. Waliduje **definicje**
> (sparsowaną strukturę YAML), a nie dane w czasie wykonania — dane waliduje silnik przez
> natywne `output_schema`.

---

## 1. Zależności i instalacja

Warstwa ma **własny** `package.json` w `chat-backend/polityka/`. Jest to pakiet ESM,
`"type": "module"`.

| Zależność | Po co | Dlaczego nie własny kod |
| --- | --- | --- |
| `yaml` | parsowanie YAML do obiektu | zakaz wyrażeń regularnych na tekście definicji (§4.1a) |
| `ajv` + `ajv-formats` | **kompilacja** schematu JSON Schema (sprawdzenie, że jest poprawnym schematem) | zakaz własnej implementacji JSON Schema |

Instalacja (T3 dopisuje do `chat-backend/Dockerfile`, warstwa tego pliku nie rusza):

```dockerfile
COPY polityka/package.json polityka/package-lock.json /app/polityka/
RUN cd /app/polityka && npm ci --omit=dev
COPY polityka/ /app/polityka/
COPY ../kontrakty /app/kontrakty        # albo montaż wolumenem read-only
```

Rozwiązywanie modułów: pliki w `/app/polityka/*.mjs` widzą `/app/polityka/node_modules`,
więc `import 'yaml'` działa bez zmian w `/app/package.json` (którego nie ma).

---

## 2. Konfiguracja

Warstwa **nie czyta `process.env` sama**. Wszystko wchodzi argumentami — to celowe, żeby
dało się ją testować bez środowiska. T3 czyta zmienne i przekazuje je dalej.

| Zmienna (proponowana nazwa) | Znaczenie | Uwaga |
| --- | --- | --- |
| `DAGU_MCP_URL` | `http://proxy/dagu/mcp` | adres MCP silnika, **nigdy** nie trafia do `claude` |
| `DAGU_MCP_TOKEN` | klucz API Dagu, rola `developer`, `allowedSurfaces:["mcp"]` | **nie opuszcza backendu**; minimalną rolę ustalił `docs/audyt-dagu-bezpieczenstwo.md` P5 |
| `KONTRAKTY_DIR` | ścieżka do katalogu `kontrakty/` | domyślnie `/app/kontrakty` |
| `ZEZWOLENIA_PLIK` | plik dziennika zezwoleń | katalog musi być zapisywalny i **nie** współdzielony z wolumenem Dagu |
| `POLITYKA_MCP_PORT` | port naszego serwera MCP | domyślnie `8788`, nasłuch wyłącznie `127.0.0.1` |

---

## 3. Kształt wyniku i kształt odmowy

Każda funkcja polityki zwraca obiekt, **nie rzuca wyjątkiem przy odmowie**. Wyjątek oznacza
błąd programistyczny albo awarię transportu — nie naruszenie kontraktu.

```js
// zgoda
{ ok: true, /* pola zależne od funkcji */ }

// odmowa
{ ok: false, naruszenia: [ Naruszenie, ... ] }   // zawsze co najmniej jedno
```

```js
// Naruszenie
{
  kod: 'K3_SCHEMAT_OSLABIONY',            // stabilny kod maszynowy, patrz §7
  pole: 'steps[1].output_schema',          // ścieżka w sparsowanej strukturze
  komunikat: 'Krok "suma" ma schemat …'    // pełne zdanie po polsku, dla operatora
}
```

Funkcja pomocnicza do pokazania odmowy człowiekowi:

```js
import { opiszNaruszenia } from './polityka/index.mjs'
opiszNaruszenia(naruszenia)   // -> string, po polsku, jedna linia na naruszenie
```

---

## 4. Moduły

Wszystko jest re-eksportowane z `chat-backend/polityka/index.mjs`. Ścieżki niżej podane dla
orientacji; importuj z `index.mjs`.

### 4.1 `identyfikatory.mjs` — polityka identyfikatorów (§4.2)

```js
import { sprawdzIdentyfikator, naIdentyfikator, nadajIdentyfikator, WZORZEC_IDENTYFIKATORA }
  from './polityka/index.mjs'
```

| Wywołanie | Zwraca | Uwagi |
| --- | --- | --- |
| `sprawdzIdentyfikator(nazwa)` | `{ok:true}` / `{ok:false,naruszenia}` | wzorzec `^[a-z0-9][a-z0-9-]{0,38}$` |
| `naIdentyfikator(nazwaWyswietlana)` | `string` | deterministyczna transliteracja; **nie** rozstrzyga kolizji |
| `nadajIdentyfikator(nazwaWyswietlana, zajete)` | `{ identyfikator, bazowy, kolizja }` | `zajete` to tablica/Set istniejących nazw; kolizja → sufiks `-2`, `-3`, … |
| `WZORZEC_IDENTYFIKATORA` | `RegExp` | do użycia w UI, żeby nie duplikować wzorca |

`nadajIdentyfikator` przydziela sufiks **po naszej stronie**, nigdy nie zostawia tego modelowi
(§4.2). Skracanie do 39 znaków tnie po granicy `-`.

```js
naIdentyfikator('Średnia temperatura z trzech miast')  // 'srednia-temperatura-z-trzech-miast'
nadajIdentyfikator('Średnia temperatura z trzech miast', ['srednia-temperatura-z-trzech-miast'])
// { identyfikator: 'srednia-temperatura-z-trzech-miast-2', bazowy: '…', kolizja: true }
```

### 4.2 `rejestr-kontraktow.mjs` — zatwierdzone schematy z `kontrakty/`

```js
import { wczytajRejestr } from './polityka/index.mjs'
const rejestr = await wczytajRejestr('/app/kontrakty')
```

Katalog `kontrakty/` jest **poza definicją, którą edytuje agent**. Jeden plik = jedna
zatwierdzona wersja jednego kontraktu:

```
kontrakty/<id-kontraktu>/v<N>.json
```

```json
{
  "kontrakt": "wartosc-zamowienia",
  "wersja": 1,
  "opis": "Wynik obliczenia wartości zamówienia.",
  "zatwierdzony": "2026-09-18",
  "schemat": {
    "type": "object",
    "additionalProperties": false,
    "required": ["order_id", "total"],
    "properties": { "order_id": {"type": "string"}, "total": {"type": "number"} }
  }
}
```

| Wywołanie | Zwraca |
| --- | --- |
| `wczytajRejestr(katalog)` | `Promise<Rejestr>`; rzuca `BladRejestru` gdy plik jest niepoprawny |
| `rejestr.odcisk` | `sha256:…` całego rejestru — **wchodzi do sumy kontrolnej zezwolenia** |
| `rejestr.lista()` | `[{kontrakt, wersja, opis, nazwaAkcji, odciskSchematu}]` |
| `rejestr.znajdz(kontrakt, wersja)` | wpis albo `null` |
| `rejestr.dopasujSchemat(schemat)` | wpis albo `null` — dopasowanie po **kanonicznym odcisku** |
| `rejestr.akcjeBazowe()` | blok `actions:` do `base.yaml` Dagu (dla T1) |

**Dlaczego to jest wymaganie, a nie ozdoba.** Samo istnienie `output_schema:` w DAG-u niczego
nie dowodzi — agent może go osłabić przy następnej edycji. Polityka wymaga, żeby użyty schemat
**był** zatwierdzonym schematem w zatwierdzonej wersji. Zmiana kontraktu to zmiana pliku
w `kontrakty/`, widoczna w Gicie; edycja DAG-a nie legalizuje po cichu nowego wyniku — daje
odmowę `K3_KONTRAKT_NIEZATWIERDZONY`.

**Dwie dopuszczone formy odwołania do kontraktu w definicji DAG-a:**

* **Forma A (zalecana, natywna).** Krok używa akcji własnej z pliku bazowego:
  `action: <nazwaAkcji>` i **nie powtarza schematu**. `nazwaAkcji` to `<id-kontraktu>-v<N>`.
  Akcji z pliku bazowego nie da się przesłonić lokalnie (`audyt-dagu-walidacja.md` §3.5).
* **Forma B (inline).** Krok ma `output_schema:` wpisany wprost. Polityka liczy kanoniczny
  odcisk i wymaga trafienia w zatwierdzoną wersję. Każde odstępstwo (inny typ, brak pola,
  dodane pole) → odmowa z opisem różnicy.

### 4.3 `walidacja-definicji.mjs` — bramka kontraktu na definicji

```js
import { sprawdzDefinicje } from './polityka/index.mjs'

const wynik = sprawdzDefinicje({
  nazwa: 'wartosc-zamowienia',   // identyfikator DAG-a (§4.2)
  yaml: '<treść YAML>',          // dokładnie ta, która ma trafić do silnika
  rejestr,                       // z wczytajRejestr()
  plikBazowy: '<treść base.yaml>',   // opcjonalnie; string albo obiekt
  poddagi: { 'nazwa-dziecka': '<YAML dziecka>' },  // opcjonalnie
})
```

Zwraca:

```js
{ ok: true, raport: {
    nazwa, sumaKontrolna,               // 'sha256:…' — treść, która ma być wykonana
    kroki: [{ id, publikuje: true|false, kontrakt, wersja, forma: 'A'|'B'|null }],
    uzyteKontrakty: [{ kontrakt, wersja }],
} }
// albo
{ ok: false, naruszenia: [ Naruszenie, … ] }
```

**Co sprawdza** (pełna lista w §7; tu zakres):

1. Identyfikator DAG-a wg §4.2.
2. DAG ma co najmniej jeden krok.
3. Graf jest acykliczny (silnik przepuszcza cykl przez lint — `audyt-dagu-walidacja.md` §3.1).
4. Każdy krok **publikujący wynik** (`output:`) ma `output_schema` i ten schemat jest
   zatwierdzonym kontraktem (forma A albo B).
5. Schemat nie jest osłabiony: `type: object`, `required` niepuste, `additionalProperties: false`.
6. Zakaz drugiego kanału (K5): `$DAGU_OUTPUT_FILE`, `outputs:`, `${steps.*.outputs.*}`,
   `action: outputs.write`, `call:`+`outputs`.
7. `continue_on` z `failure: true` albo `mark_success: true` na kroku objętym kontraktem — odmowa.
   `continue_on: skipped` na gałęzi warunkowej — **dozwolone**, fan-in go wymaga [D13].
8. Krok czytający cudzy wynik ma ten krok w `depends` (krawędź zależności = krawędź danych).
9. To samo **po rozwinięciu**: `defaults:`, akcje własne z DAG-a i z pliku bazowego,
   definicje sub-DAG-ów (`action: dag.run`, `call:`), ciała `foreach`.

Sprawdzanie działa na **sparsowanej strukturze**. Wyrażenia regularne stosujemy wyłącznie do
treści pojedynczego polecenia powłoki (`run:`), bo to jest tekst z definicji, nie struktura.

### 4.4 `zezwolenia.mjs` — wykonywana wersja = wersja zwalidowana (§13.3 S7)

Zamyka okno podmiany między walidacją a startem.

```js
import { utworzRejestrZezwolen } from './polityka/index.mjs'
const zezwolenia = await utworzRejestrZezwolen({ plik: '/app/dane/zezwolenia.json' })
```

| Wywołanie | Zwraca | Kiedy |
| --- | --- | --- |
| `zezwolenia.zatwierdz({ nazwa, yaml, raport, odciskRejestru })` | `{ ok:true, zezwolenie }` | po **udanej** walidacji, przed zapisem do silnika |
| `zezwolenia.sprawdzPrzedStartem({ nazwa, yamlZSilnika, odciskRejestru })` | `{ok:true,zezwolenie}` / `{ok:false,naruszenia}` | **tuż przed** `start`/`retry`/trigger |
| `zezwolenia.znajdz(nazwa)` | zezwolenie albo `null` | |
| `zezwolenia.uniewaznij(nazwa)` | `{ ok:true }` | po `delete_dag`, po ręcznej edycji |

`sumaKontrolna` liczona jest z **kanonicznej postaci definicji** (YAML → obiekt → kanoniczny
JSON), a nie z bajtów pliku — dzięki temu przeformatowanie przez silnik przy zapisie nie daje
fałszywej odmowy, a zmiana **treści** daje odmowę zawsze. W sumie kontrolnej jest też odcisk
rejestru kontraktów: podmiana `kontrakty/` unieważnia wszystkie zezwolenia.

### 4.5 `klient-dagu.mjs` — jedyne miejsce, które zna klucz Dagu

```js
import { utworzKlienta } from './polityka/index.mjs'
const klient = utworzKlienta({ url: process.env.DAGU_MCP_URL, klucz: process.env.DAGU_MCP_TOKEN })
```

| Wywołanie | Odpowiednik w MCP Dagu |
| --- | --- |
| `klient.odczytaj(args)` | `dagu_read` |
| `klient.zmien(args)` | `dagu_change` |
| `klient.wykonaj(args)` | `dagu_execute` |
| `klient.pobierzSpec(nazwa)` | `dagu_read target=dag_spec` → `string` z YAML-em |
| `klient.zamknij()` | zwalnia sesję MCP |

Klucz jest trzymany w domknięciu i **nie jest zwracany żadnym wywołaniem**. Klient nie loguje
nagłówków.

### 4.6 `wynik.mjs` — sukces czytany z silnika, nie z tekstu modelu (§4.3, §13.5 E8)

```js
import { ustalWynik, pogodzOdpowiedzModelu } from './polityka/index.mjs'

const wynik = await ustalWynik({ klient, dagName, dagRunId })
// { ok:true, statusLabel:'failed', sukces:false, kroki:[{name,status}], dagRunId }

const werdykt = pogodzOdpowiedzModelu({ tekstModelu: r.result, wynik })
// { ok:false, statusLabel:'failed', komunikat:'Model napisał, że gotowe, …' }
```

`ustalWynik` woła `dagu_read target=run` i czyta `statusLabel`. `pogodzOdpowiedzModelu`
porównuje to z treścią odpowiedzi modelu: jeśli model twierdzi, że gotowe, a przebieg jest
czerwony — zwraca `ok: false` z komunikatem dla operatora. **To jest jedyne dopuszczone
źródło prawdy o sukcesie.**

### 4.7 `serwer-mcp.mjs` — bramka, której model nie omija

Model nie dostaje adresu ani klucza MCP Dagu. Dostaje **nasz** serwer MCP.

```js
import { uruchomSerwerMcp } from './polityka/index.mjs'

const serwer = await uruchomSerwerMcp({
  host: '127.0.0.1', port: 8788,
  klient, rejestr, zezwolenia,
  logger: console,
})
// serwer.url  -> 'http://127.0.0.1:8788/mcp'
// serwer.zamknij()
```

Narzędzia widziane przez model (nazwy po angielsku, opisy po polsku):

| Narzędzie | Opakowuje | Co robi polityka |
| --- | --- | --- |
| `process_read` | `dagu_read` | przepuszcza (tylko odczyt); ogranicza `target` do listy dozwolonych |
| `process_write` | `dagu_change` | **waliduje definicję**; przy odmowie nie woła silnika i zwraca kody + komunikat po polsku; przy zgodzie zapisuje i zatwierdza zezwolenie |
| `process_run` | `dagu_execute` | **odczytuje spec z silnika i porównuje sumę kontrolną z zezwoleniem**; niezgodność → odmowa, brak `start` |
| `process_status` | `dagu_read target=run` | zwraca `statusLabel` z silnika |

Konfiguracja dla `claude -p` — T3 generuje ją w `entrypoint.sh` **zamiast** dzisiejszego
wpisu `n8n`:

```json
{ "mcpServers": { "proces": { "type": "http", "url": "http://127.0.0.1:8788/mcp" } } }
```

i uruchamia CLI z `--strict-mcp-config --allowedTools "mcp__proces"`.
**`--strict-mcp-config` jest obowiązkowe** — bez niego CLI dociągnie konfiguracje MCP
użytkownika i model może odzyskać bezpośrednie połączenie z Dagu.

---

## 5. Jak T3 to składa

```js
import {
  wczytajRejestr, utworzRejestrZezwolen, utworzKlienta, uruchomSerwerMcp,
  ustalWynik, pogodzOdpowiedzModelu, sprawdzIdentyfikator,
} from './polityka/index.mjs'

// 1) raz, przy starcie serwera
const rejestr    = await wczytajRejestr(process.env.KONTRAKTY_DIR ?? '/app/kontrakty')
const zezwolenia = await utworzRejestrZezwolen({ plik: process.env.ZEZWOLENIA_PLIK })
const klient     = utworzKlienta({ url: process.env.DAGU_MCP_URL, klucz: process.env.DAGU_MCP_TOKEN })
const mcp        = await uruchomSerwerMcp({ host:'127.0.0.1', port:8788, klient, rejestr, zezwolenia })

// 2) w obsłudze /api/chat, po powrocie z `claude -p`
//    (dagName / dagRunId model zwraca ostatnią linią, jak dziś WORKFLOW_ID)
if (dagRunId) {
  const wynik   = await ustalWynik({ klient, dagName, dagRunId })
  const werdykt = pogodzOdpowiedzModelu({ tekstModelu: text, wynik })
  json(res, 200, {
    reply: text, dagName, dagRunId,
    sessionId, costUsd, durationMs,
    statusLabel: wynik.statusLabel,
    ostrzezenie: werdykt.ok ? null : werdykt.komunikat,   // §4.3: sukces z silnika, nie z tekstu
  })
}
```

Pola odpowiedzi `/api/chat` wg §4.3: `reply`, `sessionId`, `costUsd`, `durationMs` bez zmian;
`workflowId` rozpada się na `dagName` + `dagRunId`. `statusLabel` i `ostrzezenie` to dodatki
tej warstwy — frontend ma pokazać `ostrzezenie`, jeśli nie jest `null`.

---

## 6. Czego ta warstwa NIE gwarantuje

Powiedziane wprost, bo `docs/audyt-dagu-bezpieczenstwo.md` P3 rozstrzygnął to wykonaniem.

* **Bramka polityki nie jest granicą bezpieczeństwa.** Krok DAG-a biegnie jako root i ma
  zapis do `/var/lib/dagu`, więc może nadpisać `base.yaml` i pliki w `dags/` **z pominięciem
  MCP**. Polityka wykrywa skutek przy uruchomieniu (suma kontrolna, §4.4), ale nie zapobiega
  zapisowi.
* **Nie waliduje danych w czasie wykonania.** To robi silnik natywnym `output_schema`.
* **Nie zastępuje sesji `/api/chat`** (R-A) ani decyzji o tokenie silnika (R-B). To T1/T3.
* **Prompt systemowy nie jest środkiem kontroli** i nie wolno go tak przedstawiać (§4.1a).

---

## 7. Kody odmowy

| Kod | Znaczenie | Źródło wymagania |
| --- | --- | --- |
| `ID_ZLY_ZNAK` | identyfikator spoza `^[a-z0-9][a-z0-9-]{0,38}$` | §4.2 |
| `ID_ZA_DLUGI` | dłuższy niż 39 znaków | §4.2 |
| `ID_PUSTY` | pusty albo brak nazwy | §4.2 |
| `YAML_NIEPOPRAWNY` | definicja nie parsuje się do obiektu | §4.1a |
| `DAG_BEZ_KROKOW` | brak `steps:` albo pusta lista | §4.1a |
| `GRAF_CYKL` | cykl w `depends` | §4.1a |
| `GRAF_ZALEZNOSC_NIEISTNIEJACA` | `depends` na nieznany krok | §4.1a |
| `K2_BRAK_OUTPUT` | krok ma `output_schema`, ale nie ma `output:` | K2 |
| `K2_OUTPUT_NIEPLASKI` | `output:` w postaci obiektowej (kanał `${step.output.*}`) zamiast nazwy zmiennej | K2 |
| `K3_BRAK_SCHEMATU` | krok publikuje wynik bez `output_schema` | K3, §4.1a |
| `K3_SCHEMAT_PUSTY` | `output_schema: {}` | K3 |
| `K3_SCHEMAT_NIEOBIEKTOWY` | `type` inny niż `object` | K3 |
| `K3_BRAK_REQUIRED` | brak albo puste `required` | K3 |
| `K3_BRAK_ADDITIONAL_PROPERTIES` | brak `additionalProperties: false` | K3 |
| `K3_WLASCIWOSC_BEZ_TYPU` | właściwość w `properties` bez `type` | K3 |
| `K3_SCHEMAT_NIEPOPRAWNY` | nie kompiluje się jako JSON Schema (Ajv) | K3 |
| `K3_KONTRAKT_NIEZATWIERDZONY` | schemat nie jest zatwierdzoną wersją z `kontrakty/` | §4.1a |
| `K3_KONTRAKT_ROZNICA_TYPU` | trafiony kontrakt po nazwach pól, ale inny typ właściwości | §4.1a |
| `K4_BRAK_DEPENDS` | krok czyta `"$NAZWA"` cudzego wyniku bez `depends` na jego krok | K4 |
| `K5_OUTPUT_FILE` | zapis do `$DAGU_OUTPUT_FILE` | K5 |
| `K5_OUTPUTS` | deklaracja `outputs:` albo `action: outputs.write` | K5 |
| `K5_ODWOLANIE_OUTPUTS` | odwołanie `${steps.*.outputs.*}` | K5 |
| `CONTINUE_ON_MASKUJE` | `continue_on.failure` albo `continue_on.mark_success` na kroku objętym kontraktem | §4.1a |
| `CONTINUE_ON_DEFAULTS` | to samo ustawione globalnie w `defaults:` | §4.1a |
| `SUBDAG_NIEZNANY` | `action: dag.run` na definicję, której polityka nie dostała do wglądu | §4.1a |
| `ZEZWOLENIE_BRAK` | start procesu, który nigdy nie przeszedł polityki | §13.3 S7 |
| `ZEZWOLENIE_SUMA` | definicja w silniku różni się od zwalidowanej | §13.3 S7 |
| `ZEZWOLENIE_REJESTR` | zmienił się rejestr kontraktów od czasu zatwierdzenia | §13.3 S7 |
| `WYNIK_CZERWONY` | `statusLabel` nie jest sukcesem | §4.3, §13.5 E8 |
| `WYNIK_NIEZNANY` | brak `dagRunId` albo silnik nie zna przebiegu | §4.3 |

Kody są stabilne. Komunikat po polsku może się zmieniać; kod — nie.
