# Testy

## `tests/kontrakt/` — testy kontraktu na poziomie silnika

Sprawdzają **zachowanie silnika Dagu** wobec kontraktu danych K1–K6
(`docs/decyzja-architektoniczna.md` §4.1) i polityki identyfikatorów (§4.2).
Nie dotykają naszego kodu — ani warstwy polityki, ani backendu, ani frontendu.
Każdy test stawia DAG na własnym stanowisku i sprawdza **dokładny status i dokładny
komunikat** odczytany z silnika, nigdy z prozy CLI.

### Uruchomienie

```
./tests/uruchom.sh
```

Jedna komenda, z czystego stanu. Skrypt sam stawia stanowisko i sam je sprząta —
także gdy test padnie, gdy `node` się wywali albo gdy przerwiesz przebieg Ctrl-C.
Wymagania: `node` ≥ 22.12 (globalny setup `node --test`), `docker`, `docker compose`.

Pojedynczy plik, na już podniesionym stanowisku:

```
node --test --test-global-setup=tests/kontrakt/przygotowanie.mjs 'tests/kontrakt/04-*.test.mjs'
```

### Stanowisko

| | |
| --- | --- |
| projekt compose | `dagu-test` |
| port | `127.0.0.1:9401` (nic poza pętlą zwrotną) |
| katalog roboczy | `$TMPDIR/dagu-test-kontrakt` — **poza repozytorium**, kasowany po przebiegu |
| obraz | przypięty po digeście `ghcr.io/dagucloud/dagu@sha256:b242dc7b…4c69f` |
| socket Dockera | **nie** montowany |
| uwierzytelnianie | `DAGU_AUTH_MODE: none` |

Stanowisko jest jednorazowe, na pętli zwrotnej i bez żadnych danych. `none` jest tu
wyborem świadomym: nie ma poświadczenia do trzymania w repozytorium ani do wycieku
w wyjściu testu. **Stack produktowy tak nie stoi** — tam obowiązuje §5 decyzji.

Testy nie dotykają stacku n8n (`n8niframe`, port 8080) ani stanowisk równoległych
(`dagu-sec` 91xx, `dagu-policy` 92xx, `n8n-fixture` 93xx). `docker compose down`
nigdy nie dostaje `-v`; stanowisko nie ma wolumenów nazwanych, tylko bind-mount.

### Co jest w którym pliku

| plik | zakres |
| --- | --- |
| `01-walidacja-wyniku.test.mjs` | K1–K4: czy naruszenie schematu naprawdę czerwieni przebieg; cytowanie danych; `depends` jako krawędź danych |
| `02-ksztalt-stdout.test.mjs` | K1: stdout musi być jednym czystym dokumentem JSON; K3: kształt samego schematu |
| `03-propagacja-i-akcje.test.mjs` | sub-DAG, `retry_policy`, akcje własne z pliku bazowego, rozgałęzienie + fan-in (użycie **poprawne**) |
| `04-luki-silnika.test.mjs` | **osiem luk** — testy zielone pokazujące, czego silnik nie łapie |
| `05-nazwy-i-lint.test.mjs` | nazwy DAG-ów i lint `dagu_change` na ścieżce zapisu |
| `06-preconditions.test.mjs` | `preconditions` jako bramka logiczna, nie walidacja; dwie korekty audytu §3.3 |

### Testy „luka:"

Osiem testów w `04-luki-silnika.test.mjs` ma prefiks **`luka:`** i **przechodzi na
zielono, pokazując brak**. Zielony wynik nie jest tam akceptacją zachowania —
każdy z tych przypadków łamie kontrakt, a silnik go przepuszcza. To jest lista
zakresu warstwy polityki (T2) i jej test regresji: gdy polityka zacznie te
przypadki blokować, blokada będzie widoczna po jej stronie, a tutaj ma nadal
być widoczne, że **sam silnik ich nie zatrzymuje**.

Nie zmieniaj tych testów na czerwone, gdy polityka ruszy. Napisz obok testy polityki.

### Czego te testy NIE obejmują

* Naszej warstwy polityki, backendu, frontendu i proxy — to jest zakres T1/T2/T3.
* Kroków kontenerowych (`container:`, `docker.run`, `k8s.run`) — socket Dockera nie
  jest montowany świadomie.
* Trybu rozproszonego (`coordinator` + `worker`).
* Przekroczenia `max_output_size` (1 MiB/krok) i K6 (artefakty + manifest).
* Słowników JSON Schema poza `type`, `required`, `properties`, `additionalProperties`
  i zagnieżdżeniem.
* Wydajności walidacji.
* Osiemnastu scenariuszy regresji R01–R18 — te są w `docs/odbior-faza-1.md`.
