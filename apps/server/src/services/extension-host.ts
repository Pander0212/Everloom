/**
 * Server extensions run in their own Node process. The parent sends the extension's (single,
 * bundled) main module over IPC, so nothing is unpacked to disk; the child imports it and the
 * module registers routes and timed jobs through a tiny API. Requests to /api/ext/<id>/… are passed
 * over IPC and answered the same way. A crash restarts it with a back-off; three crashes in ten
 * minutes stop it until the owner turns it on again. The child gets no database handle, no keys and
 * no session: only the requests routed to it.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { readContentFile } from '../vault/vault.js';

const RUNNER = `
const routes = [];
const jobs = [];
const send = (m) => { try { process.send(m); } catch {} };
const log = (level, ...a) => send({ t: 'log', level, msg: a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ').slice(0, 2000) });
console.log = (...a) => log('info', ...a);
console.error = (...a) => log('error', ...a);
const api = {
  id: process.env.EXT_ID,
  route(method, p, handler) { routes.push({ method: String(method).toUpperCase(), parts: String(p).split('/').filter(Boolean), handler }); },
  every(ms, fn) { const t = setInterval(() => Promise.resolve().then(fn).catch((e) => log('error', 'job', e && e.message)), Math.max(10000, ms)); jobs.push(t); },
  log: (...a) => log('info', ...a),
};
function match(r, method, parts) {
  if (r.method !== method || r.parts.length !== parts.length) return null;
  const params = {};
  for (let i = 0; i < parts.length; i++) {
    if (r.parts[i].startsWith(':')) params[r.parts[i].slice(1)] = decodeURIComponent(parts[i]);
    else if (r.parts[i] !== parts[i]) return null;
  }
  return params;
}
process.on('message', async (m) => {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'load') {
    try {
      const mod = await import('data:text/javascript;base64,' + m.code);
      const init = mod.default || mod.register;
      if (typeof init !== 'function') throw new Error('The main module must export a default function(api)');
      await init(api);
      send({ t: 'ready' });
    } catch (e) { send({ t: 'fatal', msg: String(e && e.stack || e).slice(0, 2000) }); process.exit(1); }
    return;
  }
  if (m.t === 'req') {
    const parts = String(m.path).split('/').filter(Boolean);
    for (const r of routes) {
      const params = match(r, m.method, parts);
      if (!params) continue;
      try {
        const out = await r.handler({ params, query: m.query || {}, body: m.body });
        const res = out && typeof out === 'object' && 'status' in out && 'body' in out ? out : { status: 200, body: out === undefined ? null : out };
        send({ t: 'res', id: m.id, status: res.status, body: res.body });
      } catch (e) { send({ t: 'res', id: m.id, status: 500, body: { error: String(e && e.message || e).slice(0, 500) } }); }
      return;
    }
    send({ t: 'res', id: m.id, status: 404, body: { error: 'No such route in this extension' } });
  }
});
`;

interface Part {
  ctx: AppContext;
  owner: string;
  id: string;
  child: ChildProcess | null;
  state: 'running' | 'stopped' | 'crashed';
  detail?: string;
  crashes: number[];
  pending: Map<number, (r: { status: number; body: unknown }) => void>;
  seq: number;
  dir: string;
  main: string;
  dev: boolean;
  restartTimer?: NodeJS.Timeout;
}

const parts = new Map<string, Part>();
const k = (owner: string, id: string) => `${owner}:${id}`;

function mainCode(p: Part): string {
  const f = path.join(p.dir, p.main);
  return (p.dev ? readFileSync(f) : readContentFile(p.ctx.vault, f)).toString('base64');
}

function launch(p: Part) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', RUNNER], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    // Inside the desktop app, the same binary runs as plain Node; the child gets no secrets.
    env: { PATH: process.env.PATH ?? '', EXT_ID: p.id, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--max-old-space-size=256' },
  });
  p.child = child;
  p.state = 'running';
  p.detail = undefined;
  child.on('message', (m: any) => {
    if (m?.t === 'res') {
      p.pending.get(m.id)?.({ status: Number(m.status) || 200, body: m.body });
      p.pending.delete(m.id);
    } else if (m?.t === 'log' && m.level === 'error') record(p, 'server', String(m.msg));
    else if (m?.t === 'fatal') {
      p.detail = String(m.msg).split('\n')[0];
      record(p, 'server', String(m.msg));
    }
  });
  child.on('exit', (code) => {
    if (p.child !== child) return;
    p.child = null;
    for (const [, res] of p.pending) res({ status: 503, body: { error: 'The extension stopped' } });
    p.pending.clear();
    if (p.state === 'stopped') return;
    const now = Date.now();
    p.crashes = [...p.crashes.filter((t) => now - t < 10 * 60_000), now];
    if (p.crashes.length >= 3) {
      p.state = 'crashed';
      p.detail = p.detail ?? `Stopped after crashing 3 times (exit ${code})`;
      return;
    }
    p.restartTimer = setTimeout(() => launch(p), [1000, 5000, 30_000][p.crashes.length - 1] ?? 30_000);
    p.restartTimer.unref?.();
  });
  try {
    child.send({ t: 'load', code: mainCode(p) });
  } catch (e) {
    p.detail = (e as Error).message;
  }
}

function record(p: Part, where: string, message: string) {
  try {
    // Imported lazily to avoid an import cycle with extensions.ts.
    void import('./extensions.js').then((m) => m.recordExtensionError(p.ctx, p.owner, p.id, where, message));
  } catch {
    /* best effort */
  }
}

export function startServerPart(ctx: AppContext, owner: string, id: string, dir: string, main: string, dev: boolean) {
  const existing = parts.get(k(owner, id));
  if (existing?.child) stopServerPart(owner, id);
  const p: Part = { ctx, owner, id, child: null, state: 'running', crashes: [], pending: new Map(), seq: 0, dir, main, dev };
  parts.set(k(owner, id), p);
  launch(p);
}

export function stopServerPart(owner: string, id: string) {
  const p = parts.get(k(owner, id));
  if (!p) return;
  p.state = 'stopped';
  if (p.restartTimer) clearTimeout(p.restartTimer);
  p.child?.kill();
  p.child = null;
  parts.delete(k(owner, id));
}

export function serverState(owner: string, id: string, enabled: boolean): { state: 'off' | 'running' | 'stopped' | 'crashed' | 'not-allowed'; detail?: string } {
  if (process.env.EVERLOOM_SERVER_EXTENSIONS !== '1') return { state: 'not-allowed', detail: 'Server extensions are off on this server' };
  if (!enabled) return { state: 'off' };
  const p = parts.get(k(owner, id));
  if (!p) return { state: 'stopped' };
  return { state: p.state, detail: p.detail };
}

/** Pass a request to the extension's process (30 s limit). */
export function callServerPart(owner: string, id: string, req: { method: string; path: string; query: Record<string, unknown>; body: unknown }): Promise<{ status: number; body: unknown }> {
  const p = parts.get(k(owner, id));
  if (!p?.child) return Promise.resolve({ status: 503, body: { error: 'This extension’s server part isn’t running' } });
  const msgId = ++p.seq;
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      p.pending.delete(msgId);
      resolve({ status: 504, body: { error: 'The extension took too long' } });
    }, 30_000);
    p.pending.set(msgId, (r) => {
      clearTimeout(t);
      resolve(r);
    });
    p.child!.send({ t: 'req', id: msgId, ...req });
  });
}

export function stopAllServerParts() {
  for (const p of [...parts.values()]) stopServerPart(p.owner, p.id);
}
