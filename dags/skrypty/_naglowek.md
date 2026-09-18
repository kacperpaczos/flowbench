# Skrypty kroków

Logika deterministyczna mieszka tutaj, poza definicją DAG-a (decyzja §2: „definicja YAML
opisuje orkiestrację, nie reguły biznesowe").

Każdy skrypt trzyma się kontraktu K1–K4 z decyzji §4.1:

* na **stdout** idzie dokładnie jeden dokument JSON i nic więcej,
* diagnostyka idzie na **stderr**,
* wejście przychodzi **zmienną środowiskową czytaną w cudzysłowie** (`"$NAZWA"`),
  nigdy podstawieniem `${steps.*.outputs.*}` do wiersza poleceń,
* parsowanie wyłącznie przez `jq`, nigdy ad hoc.

Kontrakt dokumentu jest jeden dla wszystkich czterech procesów:

```json
{"elementy": [ ... ]}
```

`elementy` odpowiada strumieniowi elementów n8n, który w Dagu nie istnieje — trzy pozycje
jadą jako jedna tablica w jednym dokumencie, a każdy krok robi jawny `map()`. Opakowanie
w obiekt jest wymuszone przez silnik: `output_schema` odrzuca schemat tablicowy przy
ładowaniu definicji (`output_schema must resolve to an object schema`).

**`includeOtherFields: true` z n8n nie ma tu odpowiednika.** Każdy skrypt sam wypisuje
**cały** dokument; `map(. + {...})` zachowuje pola, które przyszły. Pominięcie tego znika
po cichu, bez błędu — dlatego `output_schema` każdego kroku wymienia **wszystkie**
oczekiwane pola i ma `additionalProperties: false`.
