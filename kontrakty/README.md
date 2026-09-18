# Kontrakty wyniku kroku

Katalog trzyma **zatwierdzone** schematy wyniku kroku, wersjonowane w Gicie. Podstawa:
`docs/decyzja-architektoniczna.md` wersja 3, §4.1 (K3) i §4.1a („Gdzie mieszkają kontrakty").

## Po co osobny katalog

Schemat wpisany wprost do definicji procesu nie jest kontraktem, tylko deklaracją autora tej
definicji — a autorem jest model. Przy następnej edycji może go osłabić i nikt tego nie
zauważy, bo dla silnika każdy schemat jest równie poprawny. Dlatego warstwa polityki wymaga,
żeby użyty `output_schema` **był** jednym ze schematów z tego katalogu, w zatwierdzonej
wersji. Zmiana kontraktu to **zmiana pliku tutaj**, widoczna w historii Gita — nie efekt
uboczny edycji YAML-a procesu.

## Układ

```
kontrakty/<id-kontraktu>/v<N>.json
```

`<id-kontraktu>` spełnia ten sam wzorzec co identyfikator procesu: `^[a-z0-9][a-z0-9-]{0,38}$`.

```json
{
  "kontrakt": "<musi być równe nazwie katalogu>",
  "wersja": 1,
  "opis": "Do czego ten wynik służy.",
  "zatwierdzony": "RRRR-MM-DD",
  "schemat": { "type": "object", "additionalProperties": false, "required": [], "properties": {} }
}
```

## Zasady

1. **Nowa wersja to nowy plik.** `v1.json` nigdy nie zmienia treści schematu — inaczej
   zmiana kontraktu zalegalizowałaby wstecznie wynik, który wcześniej był błędny.
2. **Dwie wersje nie mogą mieć identycznego schematu.** Rejestr odrzuca taki katalog przy
   wczytaniu: dopasowanie po odcisku byłoby niejednoznaczne.
3. **Każdy schemat jest obiektowy**, ma niepuste `required`, `additionalProperties: false`
   i typ przy każdej właściwości. Tego wymaga K3 i tego pilnuje polityka.
4. Zmiana czegokolwiek w tym katalogu **unieważnia wszystkie zezwolenia** na uruchomienie —
   procesy trzeba zapisać ponownie, żeby przeszły politykę wobec nowych kontraktów.

## Skąd biorą się pliki w tym katalogu

Kontrakty procesów odtworzonych z n8n zostały **wypromowane ze schematów, które T4 napisał
w `dags/*.yaml`**, narzędziem:

```sh
node chat-backend/polityka/narzedzia/zatwierdz-kontrakt.mjs dags/*.yaml            # podgląd
node chat-backend/polityka/narzedzia/zatwierdz-kontrakt.mjs --zapisz dags/*.yaml   # zapis
```

Narzędzie dedupuje po odcisku schematu — dwa kroki o identycznym schemacie dostają jeden
kontrakt — i nigdy nie nadpisuje istniejącej wersji, tylko dokłada kolejną. **Nie jest
częścią bramki i nie wywołuje się samo**: promocja kontraktu ma być świadomą decyzją
człowieka, widoczną w Gicie jako nowy plik.

Gdy T4 zmieni schemat w `dags/`, test `chat-backend/test/polityka/procesy-repozytorium.test.mjs`
zacznie padać i powie, co zrobić. To nie jest awaria testu — to jest ten mechanizm.

Kontrakty `status-procesu`, `pomiar-temperatury`, `srednia-temperatur` i `wartosc-zamowienia`
(v1, v2) służą **testom samej polityki** — nie opisują żadnego procesu z `dags/`.

## Jak proces odwołuje się do kontraktu

* **Forma A (zalecana).** Krok używa akcji własnej z pliku bazowego silnika:
  `action: <id-kontraktu>-v<N>`, bez powtarzania schematu. Blok `actions:` generuje
  `rejestr.akcjeBazowe()`.
* **Forma B.** Krok ma `output_schema` wpisany wprost; polityka sprawdza, że jego kanoniczna
  postać jest dokładnie jedną z zatwierdzonych wersji.

Szczegóły wywołań: `chat-backend/KONTRAKT.md`.
