FROM node:22-alpine

# Silnik czatu: Claude Code w trybie headless (claude -p).
# Uwierzytelnia sie poswiadczeniami OAuth uzytkownika, bez klucza API.
RUN apk add --no-cache bash git ripgrep \
 && npm i -g @anthropic-ai/claude-code@2.1.270 \
 && npm cache clean --force

ENV HOME=/home/node
WORKDIR /app

# Warstwa polityki kontraktu (T2) ma wlasny package.json i wlasne node_modules.
# Zaleznosci instalujemy przed skopiowaniem kodu, zeby zmiana kodu nie unewazniala
# cache'u. Pliki w /app/polityka/*.mjs widza /app/polityka/node_modules, wiec
# `import 'yaml'` dziala bez package.json w /app (chat-backend/KONTRAKT.md par. 1).
COPY polityka/package.json polityka/package-lock.json /app/polityka/
RUN cd /app/polityka && npm ci --omit=dev

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
# Reszta katalogu, bez node_modules (patrz .dockerignore). Kopiujemy calosc, a nie
# liste plikow, bo modul sesji (chat-backend/sesja/, wlasnosc T1) dochodzi osobno
# i nie chcemy, zeby jego pojawienie sie wymagalo zmiany tego pliku.
COPY . /app/
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && if [ -f /app/sesja/package.json ]; then cd /app/sesja && npm ci --omit=dev; fi

# Zatwierdzone kontrakty (katalog kontrakty/ w korzeniu repozytorium) NIE sa
# kopiowane do obrazu: kontekst budowania to ./chat-backend, wiec nie da sie ich
# stad zobaczyc. Compose montuje je read-only:
#   volumes: [ ./kontrakty:/app/kontrakty:ro ]
# Read-only jest celowe - rejestr kontraktow wchodzi do sumy kontrolnej zezwolen
# (KONTRAKT.md par. 4.4), wiec backend nie ma powodu go zapisywac.

EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "/app/server.mjs"]
