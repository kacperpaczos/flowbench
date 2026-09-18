// Test stack lifecycle and engine access for the contract suite.
//
// Owns compose project `dagu-test` on 127.0.0.1:9401 and a work directory
// outside the repository. Nothing here touches the n8n stack (`n8niframe`, 8080)
// or the parallel stacks `dagu-sec` (91xx), `dagu-policy` (92xx), `n8n-fixture` (93xx).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const run = promisify(execFile);

// Pinned by digest per docs/decyzja-architektoniczna.md §3. Never a tag, never `latest`.
export const OBRAZ =
  'ghcr.io/dagucloud/dagu@sha256:b242dc7b605aa20d6db78ba192beb82135d390025a7d9c8dfd7f08e14464c69f';
export const PROJEKT = 'dagu-test';
export const KONTENER = 'dagu-test-kontrakt';
export const PORT = 9401;
export const KATALOG = path.join(tmpdir(), 'dagu-test-kontrakt');

const PLIK_COMPOSE = path.join(KATALOG, 'docker-compose.yml');
const KATALOG_DAGU = path.join(KATALOG, 'dagu');
const KATALOG_DAGS = path.join(KATALOG_DAGU, 'dags');
export const API = `http://127.0.0.1:${PORT}/dagu/api/v1`;
const MCP = `http://127.0.0.1:${PORT}/dagu/mcp`;

// Rootless Docker on this host: PUID/PGID 0 and no `user:`, or bind mounts fail
// with EACCES (decyzja §3). The Docker socket is deliberately NOT mounted.
const COMPOSE = `services:
  dagu:
    image: ${OBRAZ}
    container_name: ${KONTENER}
    environment:
      PUID: "0"
      PGID: "0"
      DAGU_HOST: 0.0.0.0
      DAGU_PORT: "8080"
      DAGU_BASE_PATH: /dagu
      DAGU_PUBLIC_URL: http://127.0.0.1:${PORT}/dagu
      # Loopback-only throwaway stack: no auth means no credential in the repo
      # and nothing to leak in test output. The product stack does NOT do this.
      DAGU_AUTH_MODE: none
    volumes:
      - ./dagu:/var/lib/dagu
    ports: ["127.0.0.1:${PORT}:8080"]
`;

// Custom action carrying its schemas outside the agent-written DAG (walidacja §3.5).
const BASE_YAML = `actions:
  emit_result:
    input_schema:
      type: object
      required: [script]
      properties: {script: {type: string}}
    output_schema:
      type: object
      additionalProperties: false
      required: [order_id, total]
      properties: {order_id: {type: string}, total: {type: number}}
    template:
      run: "{{ .input.script }}"
`;

async function compose(...args) {
  return run('docker', ['compose', '-p', PROJEKT, '-f', PLIK_COMPOSE, ...args], {
    maxBuffer: 32 * 1024 * 1024,
  });
}

async function apiZyje() {
  try {
    const r = await fetch(`${API}/dags`, { signal: AbortSignal.timeout(2000) });
    return r.status === 200;
  } catch {
    return false;
  }
}

export async function podnies() {
  await rm(KATALOG, { recursive: true, force: true });
  await mkdir(KATALOG_DAGS, { recursive: true });
  await writeFile(PLIK_COMPOSE, COMPOSE);
  await writeFile(path.join(KATALOG_DAGU, 'base.yaml'), BASE_YAML);
  await compose('up', '-d');

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await apiZyje()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`stack dagu-test nie odpowiedzial na ${API}/dags w 60 s`);
}

export async function zatrzymaj() {
  // `down` without -v: this stack has no named volumes, only a bind mount.
  // -v is forbidden project-wide and is never passed here.
  if (existsSync(PLIK_COMPOSE)) {
    await compose('down', '--remove-orphans').catch(() => {});
  }
  await rm(KATALOG, { recursive: true, force: true });
}

export async function zapiszDag(nazwa, yaml) {
  await writeFile(path.join(KATALOG_DAGS, `${nazwa}.yaml`), yaml);
}

// Runs `dagu start` inside the container. Returns the merged CLI transcript,
// the exit code and the run id parsed out of it (null when the DAG never loaded).
export async function startDag(nazwa, params = []) {
  const argv = ['exec', KONTENER, 'dagu', 'start', nazwa];
  if (params.length) argv.push('--', ...params);
  let stdout = '';
  let stderr = '';
  let kod = 0;
  try {
    ({ stdout, stderr } = await run('docker', argv, { maxBuffer: 32 * 1024 * 1024 }));
  } catch (e) {
    kod = typeof e.code === 'number' ? e.code : 1;
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? '';
  }
  const cli = `${stdout}${stderr}`;
  return { kod, cli, runId: cli.match(/run-id=([0-9A-Za-z]+)/)?.[1] ?? null };
}

// Reads the run back the way the application will read it: `statusLabel` from the
// engine, per decyzja §4.3. Never infers success from CLI prose.
export async function przebieg(nazwa, runId) {
  const r = await fetch(`${API}/dag-runs/${encodeURIComponent(nazwa)}/${runId}`);
  // A run whose execution plan never got built (a cycle, for instance) leaves no
  // readable record: the engine hands out a run id the API then answers 404 for.
  if (r.status === 404) return { status: null, kroki: {}, surowe: null, brakPrzebiegu: true };
  if (r.status !== 200) throw new Error(`API ${r.status} dla ${nazwa}/${runId}`);
  const d = (await r.json()).dagRunDetails;
  const kroki = {};
  for (const n of d.nodes ?? []) {
    kroki[n.step.id ?? n.step.name] = {
      status: n.statusLabel,
      blad: n.error ?? '',
      stdout: n.stdout ?? null,
    };
  }
  return { status: d.statusLabel, kroki, surowe: d };
}

// One call: start the DAG, then read its terminal state back from the engine.
export async function wykonaj(nazwa, params = []) {
  const s = await startDag(nazwa, params);
  if (!s.runId) return { ...s, status: null, kroki: {}, brakPrzebiegu: true };
  return { ...s, ...(await przebieg(nazwa, s.runId)) };
}

// Container-side log path -> host path through the bind mount.
export async function stdoutKroku(w, idKroku) {
  const p = w.kroki[idKroku]?.stdout;
  if (!p) throw new Error(`krok ${idKroku} nie ma pliku stdout`);
  return readFile(path.join(KATALOG_DAGU, p.replace(/^\/var\/lib\/dagu\//, '')), 'utf8');
}

// Minimal MCP client: this is the surface the model actually writes DAGs through,
// so name and lint checks have to go over it, not over the filesystem.
export async function mcp(narzedzie, argumenty) {
  const naglowki = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const init = await fetch(MCP, {
    method: 'POST',
    headers: naglowki,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'tests-kontrakt', version: '1' } },
    }),
  });
  const sesja = init.headers.get('mcp-session-id');
  const zSesja = { ...naglowki, 'Mcp-Session-Id': sesja };
  await fetch(MCP, { method: 'POST', headers: zSesja, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  const r = await fetch(MCP, {
    method: 'POST',
    headers: zSesja,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: narzedzie, arguments: argumenty } }),
  });
  const body = await r.json();
  if (body.error) throw new Error(`MCP ${narzedzie}: ${JSON.stringify(body.error)}`);
  return body.result.structuredContent ?? body.result;
}
