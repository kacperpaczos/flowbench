# Kontrakt bramy sesji `/api/*` (T1)

Wersja 2 — wersja 1 powstała **przed** implementacją (commit `e9943ba`), tak jak
`chat-backend/KONTRAKT.md` warstwy polityki. Wersja 2 dociąga dwie rzeczy uzgodnione
z koordynatorem już po tamtym commicie i widoczne w `chat-backend/brama-sesji.mjs`:
nazwy tras pod `/api/sesja/*` oraz punkt `weryfikacja` jako cel `forward_auth`.
Adresat: zadanie T3, które podpina ten moduł w `chat-backend/server.mjs`.

Podstawa: `docs/decyzja-architektoniczna.md` §5.1 R-A i §5.2 (decyzja operatora: **wdrożyć**),
mechanizm zweryfikowany wykonaniem w `docs/audyt-dagu-bezpieczenstwo.md` §P6.
Testy odbiorcze: §13.3 S1, S2, S3.

---

## 0. Dlaczego to nie jest opcja

Decyzja §5.2 wybrała dla R-B **wariant B2**: prawdziwy token Dagu żyje wyłącznie
w konfiguracji Caddy, a proxy samo dokłada nagłówek `Authorization` do `/dagu/*`.
Konsekwencja jest wypowiedziana wprost w §5.2 i w audycie §P4 zastrzeżenie 5:

> skoro proxy samo dokłada tożsamość Dagu, **każdy, kto dosięgnie originu, dostaje UI
> admina**. Origin musi być chroniony sesją.

Dlatego ta brama nie jest wygodą, tylko warunkiem. Z tego wynikają dwie decyzje
projektowe, które T3 powinien znać:

1. **Fail closed.** Brak hasła operatora w środowisku = brama odmawia **każdemu**
   żądaniu (401). Nie ma trybu „bez hasła wpuszczamy wszystkich".
2. **Brama stoi przed wszystkim pod `/api/`**, nie tylko przed `/api/chat`. `/api/proces`
   też czyta z silnika i też wymaga sesji.
3. **Brama stoi też przed `/dagu/*`.** Nie robi tego sama — robi to `proxy/Caddyfile`
   dyrektywą `forward_auth`, która pyta `GET /api/sesja/weryfikacja`, zanim cokolwiek
   trafi do silnika. Bez sesji proxy zwraca `401` i **nie wstrzykuje tokenu Dagu**.

---

## 1. Powierzchnia

Moduł to `chat-backend/sesja/index.mjs`. W obrazie ląduje pod `/app/sesja/index.mjs`
(`COPY sesja* /app/sesja/` w `chat-backend/Dockerfile`). Ładuje go adapter
`chat-backend/brama-sesji.mjs`, więc kontrakt jest dokładnie taki, jakiego ten adapter
oczekuje — nie wymyślamy drugiego.

```js
export function utworzBrameSesji(opcje) -> brama
```

`opcje` (wszystkie nieobowiązkowe; `server.mjs` przekazuje dziś `{ backend: 'chat' }`):

| Pole | Znaczenie | Domyślnie |
| --- | --- | --- |
| `backend` | etykieta do logów, nic więcej | `'chat'` |
| `srodowisko` | źródło konfiguracji, do testów | `process.env` |
| `teraz` | funkcja zegara, do testów | `Date.now` |

Zwracana `brama`:

```js
{
  async obsluz(req, res): boolean     // obsłużyła własną trasę i odpowiedź już poszła
  sprawdz(req): Wynik                  // synchroniczna; server.mjs i tak ją awaituje
}
```

### 1.1 `obsluz(req, res)`

Obsługuje **wyłącznie** własne trasy i zwraca `true`, gdy odpowiedź została wysłana.
Dla każdej innej ścieżki zwraca `false` i nie dotyka `res`.

| Trasa | Ciało | Odpowiedź |
| --- | --- | --- |
| `POST /api/sesja/logowanie` | `{"haslo":"…"}` | `200 {ok:true, wygasa}` + `Set-Cookie`, albo `401 {error}` |
| `POST /api/sesja/wylogowanie` | — | `200 {ok:true}` + ciasteczko `Max-Age=0`; **wpis serwerowy usuwany** |
| `GET /api/sesja` | — | `200 {zalogowany:boolean, wygasa:number|null}` — bez sesji też `200`, żeby frontend wiedział, czy pokazać formularz |
| `GET /api/sesja/weryfikacja` | — | `200 {ok:true}` z sesją, `401 {error}` bez niej. **Cel `forward_auth`** — tą trasą cały origin, także `/dagu/*`, staje za sesją |

`GET /api/sesja` i `GET /api/sesja/weryfikacja` nie wymagają sesji, żeby na nią odpowiedzieć
(to byłoby błędne koło). Żadna nie zdradza nic poza tym, czy ciasteczko żądania jest ważne.

### 1.2 `sprawdz(req)`

```js
// wpuszczony
{ ok: true, sesja: Sesja }
// odrzucony
{ ok: false, status: 401 | 403, komunikat: string }
```

`server.mjs` używa `kontrola.status ?? 401` i `kontrola.komunikat`, więc oba pola są zawsze
obecne przy `ok:false`. Komunikat jest po polsku i **nie** zawiera wartości sekretów.

### 1.3 `Sesja` — wiązanie rozmowy z operatorem (§13.3 S3)

`/api/chat` przyjmuje `sessionId` **z ciała żądania** i podaje go do `claude --resume`.
Bez wiązania druga sesja operatora mogłaby wznowić cudzą rozmowę, podając jej identyfikator.
Dlatego obiekt `sesja` niesie dwie metody — to jedyna droga, bo adapter przekazuje `sprawdz`
w całości, a nic poza tym:

```js
kontrola.sesja.czyRozmowaNalezy(sessionId): boolean   // null/'' -> true (nowa rozmowa)
kontrola.sesja.zwiazRozmowe(sessionId): void          // zapamiętuje id przy tej sesji
```

**Czego oczekuję od T3 w `server.mjs`** (ten moduł nie może tego wymusić sam, bo nie widzi
ciała żądania):

```js
if (!kontrola.sesja.czyRozmowaNalezy(parsed.sessionId)) {
  return json(res, 403, { error: 'ta rozmowa nalezy do innej sesji' })
}
// … po powrocie z claude:
kontrola.sesja.zwiazRozmowe(odpowiedz.session_id)
```

Rejestr rozmów ginie razem z sesją: wylogowanie kasuje też przypisania.

---

## 2. Ciasteczko i kontrola `Origin`

| Właściwość | Wartość | Dlaczego |
| --- | --- | --- |
| nazwa | `sesja_operatora` | — |
| `HttpOnly` | zawsze | JavaScript strony nie czyta ciasteczka (XSS nie wynosi sesji) |
| `SameSite=Strict` | zawsze | ramka Dagu jest first-party (`frame-ancestors 'self'`), więc ciasteczko i tak leci |
| `Path` | `/` | wersja 1 miała `/api`. **`forward_auth` na `/dagu/*` tego nie dopuszcza:** przeglądarka wysyła ciasteczko tylko do ścieżek objętych `Path`, więc przy `/api` żądanie o `/dagu/*` przyszłoby bez ciasteczka i proxy odrzuciłoby zalogowanego operatora. Zawężenie zostaje na innych osiach (`HttpOnly`, `SameSite=Strict`); tak samo miało to stanowisko z audytu §P6 |
| `Secure` | gdy `SESJA_SECURE=1` | lokalnie po HTTP świadomie pominięte (audyt §P6) |
| `Max-Age` | z `SESJA_TTL_H`, domyślnie 8 h | — |

Wartość ciasteczka to 256 bitów z `crypto.randomBytes`, base64url. Rejestr sesji jest
**serwerowy** (`Map` w pamięci procesu), więc wylogowanie unieważnia natychmiast — nie
wystarczy skasować ciasteczko u klienta.

### 2.1 Reguła `Origin` (CSRF)

Kolejność jest istotna: **najpierw `Origin`, potem sesja.** Żądanie z obcym `Origin`
dostaje `403` nawet z ważnym ciasteczkiem; żądanie z dobrego originu bez sesji — `401`.

| Sytuacja | Werdykt |
| --- | --- |
| `Origin` obecny i równy `SESJA_ORIGIN` | przechodzi dalej |
| `Origin` obecny i inny | **403** |
| brak `Origin`, metoda zmieniająca stan (POST/PUT/PATCH/DELETE), `Sec-Fetch-Site: same-origin` | przechodzi dalej |
| brak `Origin`, metoda zmieniająca stan, brak `Sec-Fetch-Site` albo inna wartość | **403** |
| brak `Origin`, metoda czytająca (GET/HEAD) | przechodzi dalej (przeglądarka nie wysyła `Origin` przy zwykłym GET) |

Rozluźnienie dla GET jest świadome i wąskie: `/api/proces` jest tylko do odczytu, a `403`
na nim zepsułoby ramkę. Wszystko, co zmienia stan albo kosztuje pieniądze (`/api/chat`),
idzie POST-em i podlega pełnej regule.

---

## 3. Konfiguracja

Moduł czyta środowisko **tylko** w `utworzBrameSesji` (albo `opcje.srodowisko`), raz.

| Zmienna | Znaczenie | Domyślnie |
| --- | --- | --- |
| `SESJA_HASLO` | wspólne hasło operatora | **brak = brama odmawia wszystkim** |
| `SESJA_ORIGIN` | dozwolony origin | `http://localhost:8080` |
| `SESJA_TTL_H` | życie sesji w godzinach | `8` |
| `SESJA_SECURE` | `1` dodaje `Secure` do ciasteczka | wyłączone |

Hasło porównywane jest `crypto.timingSafeEqual` po SHA-256 obu stron (stała długość
niezależnie od długości wejścia). Hasła **nie ma** w repozytorium — siedzi w `.env`,
który `.gitignore` wyklucza; wzór w `.env.example`.

---

## 4. Kody odmowy

| Kod | Kiedy |
| --- | --- |
| `401` | brak ciasteczka, ciasteczko nieznane, wygasłe albo unieważnione wylogowaniem |
| `401` | `SESJA_HASLO` nieustawione (fail closed) |
| `401` | `POST /api/sesja/logowanie` ze złym hasłem |
| `401` | `GET /api/sesja/weryfikacja` bez ważnej sesji — proxy przepisuje to na odpowiedź dla `/dagu/*` |
| `403` | obcy `Origin`, albo POST bez `Origin` i bez `Sec-Fetch-Site: same-origin` |
| `400` | `POST /api/sesja/logowanie` bez pola `haslo` albo z niepoprawnym JSON-em |

---

## 5. Czego ta brama NIE gwarantuje

Spisane wprost, żeby nikt nie policzył jej za więcej, niż daje (audyt §P6, zastrzeżenia):

1. **Nie rozróżnia osób.** Jedno wspólne hasło operatora. Prototyp jest jednoosobowy
   (§5.2), a Dagu Community i tak nie ma kont per-osoba.
2. **Nie broni przed XSS w już zalogowanej przeglądarce.** Skrypt wstrzyknięty do naszej
   strony działa **wewnątrz** sesji, więc przechodzi przez bramę, nie obok niej. Dlatego
   B2 (przeglądarka bez prawdziwego tokenu Dagu) jest **osobną** warstwą, nie zamiennikiem.
3. **Nie przeżywa restartu backendu.** Rejestr jest w pamięci jednego procesu — operator
   loguje się ponownie. Trwały magazyn to decyzja Fazy 2.
4. **Nie chroni `/dagu/*` sama z siebie.** Dostarcza tylko werdykt pod
   `/api/sesja/weryfikacja`; egzekwuje go `forward_auth` w `proxy/Caddyfile`. Jeśli ktoś
   wytnie tę dyrektywę z konfiguracji proxy, UI Dagu stanie otworem, a ten moduł się
   o tym nie dowie.
5. **Nie jest granicą wobec kroku DAG-a.** R-C jest przyjęte świadomie (§5.2): krok biegnie
   jako root w kontenerze silnika. Ta brama stoi na wejściu do originu, nie w silniku.

---

## 6. Testy

```sh
node --test chat-backend/test/sesja/       # jednostkowe, bez sieci
```

Dowód end-to-end wobec żywego stacku (wymagania §13.3 S1, S2): `/api/chat` bez sesji → 401,
z sesją → 200, obcy `Origin` → 403, po wylogowaniu → 401. Wyniki w raporcie T1.
