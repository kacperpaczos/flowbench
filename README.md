# n8nIframe — chat-driven workflow building around a process engine

This repository wraps workflow engines with a **chat layer that builds workflows for you**.
The product idea stays constant while the engine underneath changes:

* a React app embeds the engine's **full UI in an iframe** on a single origin (`http://127.0.0.1:8080`),
* a chat panel on the right drives an **LLM bot** (Claude Code CLI, GLM model) that authors, runs and
  reads back workflows through the engine's MCP/API,
* and the iframe jumps to whatever the bot just created or ran.

**n8n stays.** It is the original engine this prototype started with, and it remains on `main` as
the baseline and rollback reference — this project is not about throwing it away, it is about
wrapping it (and its alternatives) so that building a workflow is a conversation instead of
drag-and-drop.

![Prototype layout](docs/uklad.png)

## Branches — one engine per branch, all kept

| Branch | Engine | Status |
| --- | --- | --- |
| [`main`](https://github.com/kacperpaczos/n8niframe/tree/main) | **n8n** 2.38.7 | The original engine and baseline. Rollback reference for everything else. |
| [`faza-1-dagu`](https://github.com/kacperpaczos/n8niframe/tree/faza-1-dagu) | **Dagu** 2.16.6 (pinned by digest) | The most complete wrap: 18/18 regression scenarios passed against the n8n baseline, end-to-end bot demo (GLM), full docs. |
| `proba-bytechef` *(this branch)* | **ByteChef** (upstream image) + Postgres 16 | Third candidate. Engine runs in the iframe with three demo workflows. **Bot not yet adapted** — see below. |

## Run this branch (ByteChef)

```bash
cp .env.example .env
#   - SESJA_HASLO:              your operator password for the app
#   - BYTECHEF_DB_HASLO:        password for the ByteChef Postgres database
#   - BYTECHEF_REMEMBER_ME_KLUCZ: any long random string (persisted keys volume)
docker compose up -d
```

App: **http://127.0.0.1:8080/** — log in with `SESJA_HASLO`; the iframe then shows ByteChef
(served on a separate local port `127.0.0.1:8081` through the same Caddy, because ByteChef does
not support running under a URL sub-path — measured, see the Caddyfile comment). First visit asks
you to **Create account** inside ByteChef; that account is local to this instance.

Dagu stays available behind `docker compose --profile dagu up -d dagu` (volume untouched), n8n
behind `--profile n8n`.

Project **"Procesy migracji"** ships with three demo workflows (real HTTP + script steps:
EUR/PLN rate, order gross-value report, random quote).

## Bot on this branch: pending adapter

The chat backend currently speaks **Dagu's MCP** (contract policy layer + `dagu_read/change/execute`),
so with the Dagu profile off, `POST /api/chat` returns **503** — the iframe and app session work
fine without it. ByteChef ships a **native Management MCP server** (enabled by default,
`/api/management/<key>/mcp`), which is exactly the kind of surface our bot needs; the adapter
(swapping the policy layer's engine client from Dagu MCP to ByteChef MCP) is the next step on this
branch. Note: ByteChef's built-in **AI Copilot** is Enterprise-only and its provider list has no
GLM-compatible base-URL override, which is why we prefer wrapping it with our own bot.

## Repository layout

```
docker-compose.yml      stack: bytechef + postgres / frontend / chat-backend / poswiadczenia / proxy
                        (dagu and n8n behind profiles)
proxy/Caddyfile         routing; ByteChef block on 127.0.0.1:8081 (XFO stripped, CSP frame-ancestors)
frontend/               React + TypeScript (Vite) — menu, iframe panel, chat panel
chat-backend/           session gate, contract policy layer (Dagu MCP), LLM CLI wiring
docs/                   screenshots and documentation
```

## Security notes

`.env` and any credentials files are git-ignored and have never been committed. Demo passwords
that appear in the docs are intentionally public: this stack binds to `127.0.0.1` only and is a
local prototype, not a deployment.
