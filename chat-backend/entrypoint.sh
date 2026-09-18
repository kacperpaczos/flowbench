#!/bin/bash
set -e

# Poswiadczenia montujemy read-only i kopiujemy do zapisywalnego miejsca.
# Dzieki temu odswiezenie tokenu przez CLI nie dotyka pliku uzytkownika na hoscie.
# Kopia powstaje przed KAZDYM zapytaniem (server.mjs), nie tutaj - token dostepowy
# zyje kilka godzin, a host odswieza go w tle. Tu tylko katalog.
mkdir -p "$HOME/.claude"
if [ ! -f /seed/.credentials.json ]; then
  echo "UWAGA: brak /seed/.credentials.json - czat nie bedzie mogl sie uwierzytelnic" >&2
fi

# Dziennik zezwolen warstwy polityki. Katalog musi byc zapisywalny i NIE moze byc
# wspoldzielony z wolumenem silnika - inaczej krok DAG-a (biegnacy jako root,
# decyzja par. 5.2 R-C) mogl by podmienic wlasne zezwolenie.
POLITYKA_DANE="$(dirname "${ZEZWOLENIA_PLIK:-/app/dane/zezwolenia.json}")"
mkdir -p "$POLITYKA_DANE"

# Sekret naszego serwera MCP. Bramka nasluchuje wylacznie na 127.0.0.1 wewnatrz
# kontenera, ale Bearer kosztuje nic i odcina przypadkowego klienta z tego samego
# kontenera. Losowany przy starcie - nie ma go ani w obrazie, ani w repozytorium.
if [ -z "${POLITYKA_MCP_SEKRET:-}" ]; then
  POLITYKA_MCP_SEKRET="$(head -c 32 /dev/urandom | base64 | tr -d '=+/' | cut -c1-40)"
fi
export POLITYKA_MCP_SEKRET
POLITYKA_MCP_PORT="${POLITYKA_MCP_PORT:-8788}"
export POLITYKA_MCP_PORT

# Konfiguracja MCP dla `claude -p`.
#
# Wskazuje na BRAMKE POLITYKI, nie na silnik. To jest sedno podzialu z par. 4.1a:
# adres i klucz API Dagu nie opuszczaja backendu, a model widzi tylko cztery nasze
# narzedzia (process_read / process_write / process_run / process_status).
# Wpis "n8n" znika razem z silnikiem n8n.
#
# Sam ten plik nie jest srodkiem kontroli - kontrola siedzi w bramce po drugiej
# stronie adresu. Plik decyduje tylko o tym, DOKAD model dzwoni.
cat > /app/mcp.json <<JSON
{
  "mcpServers": {
    "proces": {
      "type": "http",
      "url": "http://127.0.0.1:${POLITYKA_MCP_PORT}/mcp",
      "headers": { "Authorization": "Bearer ${POLITYKA_MCP_SEKRET}" }
    }
  }
}
JSON
chmod 600 /app/mcp.json

exec "$@"
