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
| `n8n` *(this branch)* | **n8n** 2.38.7 | The **reference implementation**. Every candidate is measured against this behavior. | 100% by definition — it *is* the bar. |
| [`dagu`](https://github.com/kacperpaczos/flowbench/tree/dagu) | **Dagu** 2.16.6 (pinned by digest) | Chat wrapper around Dagu: contract-enforcing policy layer, YAML DAGs the bot writes into `dags/`. | **High.** 18/18 regression scenarios, data parity on real fixtures, end-to-end bot demo (GLM). |
| [`bytechef`](https://github.com/kacperpaczos/flowbench/tree/bytechef) | **ByteChef** (upstream) + Postgres 16 | Chat wrapper around ByteChef. | **Partial.** Engine embedded with 3 demo workflows; bot adapter (their Management MCP) pending. |

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

## Run this branch (n8n baseline)

```bash
cp .env.example .env   # if you have one; otherwise create .env with:
                       #   N8N_MCP_TOKEN=<n8n -> Settings -> Instance-level MCP -> API key>
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
(values, types, precision, ordering). The full method and results live in `docs/` on the `dagu`
branch.

## Repository layout

```
docker-compose.yml      stack definition (n8n + frontend + chat-backend + proxy)
proxy/Caddyfile         routing, iframe headers, prefix handling
frontend/               React + TypeScript (Vite) — menu, iframe panel, chat panel
chat-backend/           LLM CLI wiring + n8n MCP client
docs/                   screenshots and per-phase documentation
```

## Security notes

`.env` and any credentials files are git-ignored and have never been committed. Demo passwords
that appear in the docs are intentionally public: this stack binds to `127.0.0.1` only and is a
local prototype, not a deployment.
