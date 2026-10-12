# n8nIframe — chat-driven workflow building around a process engine

This repository wraps workflow engines with a **chat layer that builds workflows for you**.
The product idea stays constant while the engine underneath changes:

* a React app embeds the engine's **full UI in an iframe** on a single origin (`http://127.0.0.1:8080`),
* a chat panel on the right drives an **LLM bot** (Claude Code CLI, GLM model) that authors, runs and
  reads back workflows through the engine's MCP/API,
* and the iframe jumps to whatever the bot just created or ran.

**n8n stays.** It is the engine this prototype started with and it remains the **reference
implementation** — the bar every alternative is measured against. The project is not about throwing
it away; it is about wrapping it (and its alternatives) so that building a workflow is a
conversation instead of drag-and-drop.

![Prototype layout](docs/uklad.png)

## Branches — one engine per branch

| Branch | Engine | Role | Alignment with the n8n bar |
| --- | --- | --- | --- |
| [`n8n`](https://github.com/kacperpaczos/flowbench/tree/n8n) | **n8n** 2.38.7 | The **reference implementation**. Every candidate is measured against this behavior. | 100% by definition — it *is* the bar. |
| [`dagu`](https://github.com/kacperpaczos/flowbench/tree/dagu) | **Dagu** 2.16.6 (pinned by digest) | Chat wrapper around Dagu: contract-enforcing policy layer, YAML DAGs the bot writes into `dags/`. | **High.** 18/18 regression scenarios, data parity on real fixtures, end-to-end bot demo (GLM). |
| `bytechef` *(this branch)* | **ByteChef** (upstream) + Postgres 16 | Chat wrapper around ByteChef. | **Partial.** Engine embedded with 3 demo workflows; bot adapter (their Management MCP) pending. |

## Roadmap — one engine per branch

A candidate earns a branch by reproducing the reference behavior (the 18 regression scenarios from
the n8n baseline) **and** exposing an authoring surface our bot can drive (MCP or a machine API).
Shortlist:

| Planned branch | Engine | License | Why it is on the shortlist | Status |
| --- | --- | --- | --- | --- |
| `kestra` | Kestra 2.0.x | Apache-2.0 | Flows as YAML; since 2.0 any flow can register as an **MCP tool** — exactly the bot-first architecture we already run. First LTS release. Image already on the host (2.0.2), not yet integrated. | next up |
| `node-red` | Node-RED | Apache-2.0 | The most mature flow editor; a whole flow deploys as JSON over the Admin HTTP API — arguably the easiest bot-authoring surface of all. Embeddable via `httpAdminRoot`/`httpNodeRoot`. | planned |
| `windmill` | Windmill | AGPL-3.0 | Scripts-first (TypeScript/Python/Go), fast UI, everything-is-code — bot-friendly by construction; the license needs the same embedding review Dagu got. | planned |
| `activepieces` | Activepieces CE | MIT | TypeScript, large piece library, AI-first roadmap. | shortlist |
| `automatisch` | Automatisch | AGPL-3.0 | Zapier-like model, simple to reason about. | optional |
| `temporal` | Temporal (or Netflix Conductor) | MIT / Apache-2.0 | Code-first orchestration — no visual canvas, which inverts the usual pitch: bot-first by design. | later |

Out of scope: Airflow / Prefect / Dagster (batch-data paradigm, not an embedded app-workflow UI) and
Zapier / Make / n8n Cloud (SaaS — the UI cannot be self-hosted into the iframe).

## Run this branch (ByteChef)

```bash
cp .env.example .env
#   - SESJA_HASLO:                your operator password for the app
#   - BYTECHEF_DB_HASLO:          password for the ByteChef Postgres database
#   - BYTECHEF_REMEMBER_ME_KLUCZ: any long random string (persisted-keys volume)
docker compose up -d
```

App: **http://127.0.0.1:8080/** — log in with `SESJA_HASLO`; the iframe then shows ByteChef
(served on a separate local port `127.0.0.1:8081` through the same Caddy, because ByteChef does
not support running under a URL sub-path — measured; see the Caddyfile comment). First visit asks
you to **Create account** inside ByteChef; that account is local to this instance.

Dagu stays available behind `docker compose --profile dagu up -d dagu` (volume untouched), n8n
behind `--profile n8n`.

Project **"Procesy migracji"** ships with three demo workflows (real HTTP + script steps:
EUR/PLN rate, order gross-value report, random quote).

## Bot on this branch: pending adapter

The chat backend currently speaks **Dagu's MCP** (contract policy layer + `dagu_read/change/execute`),
so with the Dagu profile off, `POST /api/chat` returns **503** — the iframe and app session work
fine without it. ByteChef ships a **native Management MCP server** (enabled by default,
`/api/management/<key>/mcp`), which is exactly the surface our bot needs; swapping the policy
layer's engine client is the next step on this branch. Note: ByteChef's built-in **AI Copilot** is
Enterprise-only and its provider list has no GLM-compatible base-URL override, which is why we
prefer wrapping it with our own bot.

## Repository layout

```
docker-compose.yml      bytechef + postgres / frontend / chat-backend / poswiadczenia / proxy
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
