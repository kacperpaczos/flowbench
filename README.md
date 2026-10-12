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
| [`n8n`](https://github.com/kacperpaczos/n8niframe/tree/n8n) | **n8n** 2.38.7 | The **reference implementation**. Every candidate is measured against this behavior. | 100% by definition — it *is* the bar. |
| `dagu` *(this branch)* | **Dagu** 2.16.6 (pinned by digest) | Chat wrapper around Dagu: contract-enforcing policy layer, YAML DAGs the bot writes into `dags/`. | **High.** 18/18 regression scenarios, data parity on real fixtures, end-to-end bot demo (GLM). |
| [`bytechef`](https://github.com/kacperpaczos/n8niframe/tree/bytechef) | **ByteChef** (upstream) + Postgres 16 | Chat wrapper around ByteChef. | **Partial.** Engine embedded with 3 demo workflows; bot adapter (their Management MCP) pending. |

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

## Run this branch (Dagu)

```bash
cp .env.example .env
#   - DAGU_AUTH_TOKEN_SECRET:  openssl rand -hex 32
#   - SESJA_HASLO:             your operator password for the app
#   - the two Dagu API keys:   bootstrap procedure documented step-by-step
#                              in .env.example (Dagu Community allows max 2 keys)
docker compose up -d
```

App: **http://127.0.0.1:8080/** — log in with `SESJA_HASLO`; the iframe then shows the Dagu UI
(no second login; the proxy injects the engine token). n8n stays available behind
`docker compose --profile n8n up -d n8n` with its volume untouched.

Chat: type e.g. *"create a process that loads a JSON file, computes gross values per line and
returns the total"* — the bot writes the DAG through a contract-enforcing policy layer, runs it,
and the iframe follows the run.

## What was verified on this branch

* **18/18 regression scenarios** from the n8n baseline (iframe login, chat authoring + run +
  result readback, deep links, SSE live updates, restart persistence, port bound to `127.0.0.1`, …)
  — see `docs/odbior-faza-1.md`.
* **Data parity** on real fixtures extracted from n8n executions: values, types, precision,
  ordering — `docs/rejestr-workflow.md` §8.
* **All 15 n8n knowledge objects** (workflows, executions, account, keys) — accounted, nothing
  disappeared silently.

Key docs: `docs/raport-finalny-faza-1.md`, `docs/decyzja-architektoniczna.md`,
`docs/wycofanie.md` (rollback to n8n, drilled on a copy), `docs/audyt-dagu-bezpieczenstwo.md`.

## Repository layout

```
docker-compose.yml      dagu / frontend / chat-backend / poswiadczenia / proxy (+ n8n behind a profile)
proxy/Caddyfile         routing, iframe headers, engine-token injection (variant B2)
frontend/               React + TypeScript (Vite) — menu, iframe panel, chat panel
chat-backend/           session gate, contract policy layer, Dagu MCP client, LLM CLI wiring
dags/                   process definitions (YAML + step scripts) — the chat writes here
fixtures/               data extracted from n8n executions, used for parity checks
docs/                   screenshots and documentation
```

## Security notes

`.env` and any credentials files are git-ignored and have never been committed. Demo passwords
that appear in the docs are intentionally public: this stack binds to `127.0.0.1` only and is a
local prototype, not a deployment.
