/**
 * Diagnostics: what's running, how the data looks, recent model calls and server errors, and a
 * debug bundle to attach to a bug report. The bundle never contains API keys, tokens, passwords or
 * message text: secrets are removed by field name and by pattern, and connection URLs keep only
 * their origin.
 */
import { statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { listCalls } from './calls.js';
import { listConnections } from './connections.js';
import { getSettings } from './settings.js';

const errors: Array<{ at: number; method: string; url: string; message: string }> = [];
export function recordError(method: string, url: string, e: unknown) {
  errors.push({ at: Date.now(), method, url: url.split('?')[0]!.slice(0, 200), message: String((e as Error)?.message ?? e).slice(0, 400) });
  if (errors.length > 100) errors.splice(0, errors.length - 100);
}
export const recentErrors = () => [...errors];

const SECRET_KEY = /(api[-_]?key|apikey|token|secret|password|pass_hash|authorization|cookie|csrf|totp|private[-_]?key|credential)/i;
const SECRET_VALUE = [/\bsk-[A-Za-z0-9_-]{8,}/g, /\bevb_[A-Za-z0-9_-]{8,}/g, /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, /\bAIza[0-9A-Za-z_-]{20,}/g, /\bxox[baprs]-[A-Za-z0-9-]{8,}/g, /\bghp_[A-Za-z0-9]{20,}/g];

/** Remove anything that looks like a secret, recursively. */
export function scrub(v: unknown, depth = 0): unknown {
  if (depth > 12) return '[…]';
  if (typeof v === 'string') return SECRET_VALUE.reduce((s, re) => s.replace(re, '[removed]'), v);
  if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = SECRET_KEY.test(k) && typeof x !== 'boolean' ? '[removed]' : scrub(x, depth + 1);
    return out;
  }
  return v;
}

const origin = (u: string) => {
  try {
    return new URL(u).origin;
  } catch {
    return u ? '[custom]' : '';
  }
};

function fileSize(p: string) {
  try {
    return statSync(p).size;
  } catch {
    return null;
  }
}

export function diagnostics(ctx: AppContext, owner: string, version: string) {
  const count = (table: string, where = 'owner_id = ?') => {
    try {
      return (ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(owner) as { n: number }).n;
    } catch {
      return null;
    }
  };
  const settings = getSettings(ctx, owner);
  const calls = listCalls(ctx, owner, { limit: 200 });
  const failed = calls.filter((c) => !c.ok);
  return {
    app: {
      version,
      build: process.env.EVERLOOM_COMMIT || null,
      node: process.version,
      platform: `${os.platform()} ${os.release()} (${os.arch()})`,
      uptimeMinutes: Math.round(process.uptime() / 60),
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    },
    database: {
      migration: (ctx.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v,
      sizeBytes: fileSize(path.join(ctx.cfg.dataDir, 'everloom.db')),
      characters: count('characters'),
      chats: count('chats', 'owner_id = ? AND slot = 0'),
      saves: count('save_slots'),
      messages: count('messages'),
      campaigns: count('campaigns'),
      media: count('media'),
    },
    connections: listConnections(ctx, owner).map((c) => ({ id: c.id, name: c.name, provider: c.provider, model: c.model, endpoint: origin(c.baseUrl), hasKey: c.hasKey, roles: Object.entries(settings.roles ?? {}).filter(([, id]) => id === c.id).map(([r]) => r) })),
    calls: {
      recent: calls.length,
      failed: failed.length,
      avgMs: calls.length ? Math.round(calls.reduce((n, c) => n + c.ms, 0) / calls.length) : null,
      lastErrors: failed.slice(0, 10).map((c) => ({ at: c.createdAt, role: c.role, purpose: c.purpose, model: c.model, error: c.error })),
    },
    serverErrors: recentErrors().slice(-20),
  };
}

/** Everything above plus settings and the call log (no message text), scrubbed. */
export function debugBundle(ctx: AppContext, owner: string, version: string, client: unknown) {
  const d = diagnostics(ctx, owner, version);
  const settings = getSettings(ctx, owner) as unknown as Record<string, unknown>;
  const calls = listCalls(ctx, owner, { limit: 200 }).map((c) => ({ at: c.createdAt, role: c.role, purpose: c.purpose, provider: c.provider, model: c.model, ms: c.ms, tokensIn: c.tokensIn, tokensOut: c.tokensOut, ok: c.ok, error: c.error }));
  return scrub({ kind: 'everloom-debug-bundle', generatedAt: new Date().toISOString(), ...d, settings, calls, client, note: 'API keys, tokens, passwords and story text are not included.' });
}
