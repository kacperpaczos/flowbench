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

# Konfiguracja MCP budowana ze zmiennej srodowiskowej, zeby token nie siedzial w obrazie.
cat > /app/mcp.json <<JSON
{
  "mcpServers": {
    "n8n": {
      "type": "http",
      "url": "${N8N_MCP_URL}",
      "headers": { "Authorization": "Bearer ${N8N_MCP_TOKEN}" }
    }
  }
}
JSON
chmod 600 /app/mcp.json

exec "$@"
