FROM node:22-alpine

# Silnik czatu: Claude Code w trybie headless (claude -p).
# Uwierzytelnia sie poswiadczeniami OAuth uzytkownika, bez klucza API.
RUN apk add --no-cache bash git ripgrep \
 && npm i -g @anthropic-ai/claude-code@2.1.270 \
 && npm cache clean --force

ENV HOME=/home/node
WORKDIR /app

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY server.mjs credentials.mjs /app/
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "/app/server.mjs"]
