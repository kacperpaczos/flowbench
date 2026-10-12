# n8nIframe — a search for an n8n replacement

This repository is a **search for a drop-in replacement for n8n** in one specific use case:

* a React app embeds the engine's **full UI in an iframe** on a single origin (`http://127.0.0.1:8080`),
* a chat panel on the right drives an **LLM bot** (Claude Code CLI, GLM model) that authors and runs
  workflows through the engine's MCP/API,
* and the iframe jumps to whatever the bot just created or ran.

The prototype **started on n8n** — that is what this branch (`main`) contains, untouched: the
baseline every candidate engine is measured against. Candidate engines live on separate branches
(see the table below); each one keeps the same frontend, the same `/api/chat` contract and the same
idea: swap the engine, keep the product.

![Prototype layout](docs/uklad.png)

## Branches — the candidates

| Branch | Engine | Status |
| --- | --- | --- |
| `main` *(this branch)* | **n8n 2.38.7** | The baseline. Original working prototype; also the rollback reference for every other branch. |
| [`faza-1-dagu`](https://github.com/kacperpaczos/n8niframe/tree/faza-1-dagu) | **Dagu** 2.16.6 (pinned by digest) | The most complete candidate: 18/18 regression scenarios passed against this baseline, end-to-end bot demo, full knowledge register and acceptance docs. |
| [`proba-bytechef`](https://github.com/kacperpaczos/n8niframe/tree/proba-bytechef) | **ByteChef** (upstream image) + Postgres 16 | Engine runs in the iframe with three demo workflows. Bot not yet adapted: it speaks Dagu's MCP; ByteChef ships a native Management MCP — adapter is pending. |

## Run this branch (n8n baseline)

```bash
cp .env.example .env   # if you have one; otherwise create .env with:
                       #   N8N_MCP_TOKEN=<n8n → Settings → Instance-level MCP → API key>
docker compose up -d --build
```

App: **http://127.0.0.1:8080/** — engine login is created automatically at first boot:
`admin@admin.com` / `Admin123` (documented demo credentials, localhost-only).

Stop with `docker compose stop`; never `docker compose down -v` — that would delete the volume
holding the 15 reference workflows.

## What this use case demands from an engine

The baseline defined 18 regression scenarios that any replacement must survive — engine login
inside the iframe, chat authoring + run + result readback, deep links to a process and to a run,
session behind a reverse proxy, live-update channel, persistence across restarts, port bound to
`127.0.0.1` only, and more. Data parity is checked on real fixtures extracted from n8n executions
(values, types, precision, ordering). The full method and results live in `docs/` on the
`faza-1-dagu` branch.

## Repository layout

```
docker-compose.yml      per-branch stack definition
proxy/Caddyfile         routing, iframe headers, engine auth injection
frontend/               React + TypeScript (Vite) — menu, iframe panel, chat panel
chat-backend/           session gate + policy layer + LLM CLI wiring
docs/                   screenshots and per-phase documentation
```

## Security notes

`.env` and any credentials files are git-ignored and have never been committed. Demo passwords
that appear in the docs are intentionally public: this stack binds to `127.0.0.1` only and is a
local prototype, not a deployment.
