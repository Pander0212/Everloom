/**
 * Scripts: the owner's library, reviews and approvals, variables, and the calls a script makes
 * through the server. The app's bridge checks every call against the script's permissions; the
 * calls here that cost money, reach the network or keep data check again on their own (the script's
 * key must be approved as it is now, with that permission).
 */
import {
  AI_OP_TYPES,
  allowedOpTypes,
  regexFingerprint,
  SCRIPT_PERMISSIONS,
  scriptFingerprint,
  scriptKey,
  type RegexScript,
  type Script,
  validateOps,
  type MessageDTO,
  type VarMap,
} from '@everloom/engine';
import type { FastifyInstance } from 'fastify';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { completeChat, streamChat } from '../llm/providers.js';
import { appendOps } from '../services/campaigns.js';
import { logged, promptTokens, recordCall } from '../services/calls.js';
import { getChat, getMessage, writeSwipes } from '../services/chats.js';
import { connectionForRole } from '../services/connections.js';
import { settingsFor } from '../services/features.js';
import { buildPrompt, loadPromptContext } from '../services/prompt.js';
import * as scripts from '../services/scripts.js';
import { getSettings } from '../services/settings.js';
import { countTokens } from '../services/tokens.js';
import { safeFetch } from '../util/fetch.js';
import { parse } from '../util/validate.js';
import { withoutRetired } from './chats.js';

const kind = z.enum(['script', 'regex', 'qr']);
const varValue: z.ZodType<unknown> = z.unknown();
const target = z.object({ kind: z.enum(['character', 'preset', 'lorebook']), id: z.string().min(1) });

/** The sandbox document's own policy: inline code may run; nothing may be fetched or framed. */
export const FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join('; ');

let runtimeCache: string | null = null;
/** The in-frame runtime (plain JavaScript, inlined into the frame document). */
function frameRuntime(): string {
  if (runtimeCache && process.env.NODE_ENV === 'production') return runtimeCache;
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const f of [path.join(here, 'frame-runtime.js'), path.join(here, '../sandbox/frame-runtime.js'), path.join(here, 'sandbox/frame-runtime.js')]) {
    if (existsSync(f)) return (runtimeCache = readFileSync(f, 'utf8'));
  }
  throw new HttpError(500, 'The script runtime is missing from this build');
}

export function frameDocument(): string {
  // Nothing user-provided is in here: the code and HTML arrive by message after it loads.
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;padding:0;background:transparent}</style><script>${frameRuntime().replace(/<\/script/gi, '<\\/script')}</script></head><body></body></html>`;
}

// ------------------------------------------------------------------ rate limits

const recent = new Map<string, number[]>();
function rateLimit(ownerId: string, key: string, perMinute: number) {
  const now = Date.now();
  const k = `${ownerId}|${key}`;
  const list = (recent.get(k) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= perMinute) throw new HttpError(429, `This script is making model calls too fast (${perMinute} a minute at most)`, 'script_rate');
  const day = `${ownerId}|day`;
  const dl = (recent.get(day) ?? []).filter((t) => now - t < 86_400_000);
  if (dl.length >= 500) throw new HttpError(429, 'Scripts reached today’s limit of 500 model calls', 'script_rate');
  list.push(now);
  dl.push(now);
  recent.set(k, list);
  recent.set(day, dl);
}

function domainAllowed(host: string, domains: string[]): boolean {
  const h = host.toLowerCase();
  return domains.some((d) => (d.startsWith('*.') ? h === d.slice(2) || h.endsWith(d.slice(1)) : h === d));
}

export function registerScripts(app: FastifyInstance, ctx: AppContext) {
  // The sandbox document (no session needed: it holds no data).
  app.get('/api/sandbox/frame', async (_req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    reply.header('x-everloom-frame', '1');
    return reply.send(frameDocument());
  });

  // ---------------- what applies here
  app.get('/api/scripts/active', async (req) => {
    const q = req.query as { chatId?: string };
    return scripts.activeFor(ctx, owner(req), q.chatId || null);
  });

  // ---------------- the owner's library
  app.get('/api/scripts/library', async (req) => {
    const q = parse(z.object({ kind, scope: z.enum(['global', 'chat']).optional(), scopeId: z.string().optional() }), req.query);
    const items = scripts.listUserItems(ctx, owner(req), q.kind, q.scope ? { scope: q.scope, scopeId: q.scopeId } : undefined);
    if (q.kind === 'qr') return items;
    // Scripts and rules come with whether they're approved as they are.
    return items.map((it) => {
      const g = scripts.getGrant(ctx, owner(req), q.kind === 'script' ? scriptKey({ scope: 'global', scopeId: '', scriptId: it.id }) : `global::${it.id}`);
      const fp = q.kind === 'script' ? scriptFingerprint(it.data as Script) : regexFingerprint([it.data as RegexScript]);
      return { ...it, approved: g?.fingerprint === fp };
    });
  });
  app.post('/api/scripts/library', async (req) => {
    const b = parse(z.object({ kind, data: z.unknown(), scope: z.enum(['global', 'chat']).default('global'), scopeId: z.string().default(''), imported: z.boolean().default(false) }), req.body);
    if (b.scope === 'chat') getChat(ctx, owner(req), b.scopeId);
    return scripts.saveUserItem(ctx, owner(req), b.kind, b.data, { scope: b.scope, scopeId: b.scopeId, imported: b.imported });
  });
  app.put('/api/scripts/library/:id', async (req) => {
    const b = parse(z.object({ kind, data: z.unknown() }), req.body);
    return scripts.saveUserItem(ctx, owner(req), b.kind, b.data, { id: (req.params as any).id });
  });
  app.delete('/api/scripts/library/:id', async (req) => {
    const q = parse(z.object({ kind }), req.query);
    scripts.deleteUserItem(ctx, owner(req), q.kind, (req.params as any).id);
    return { ok: true };
  });
  app.post('/api/scripts/library/reorder', async (req) => {
    const b = parse(z.object({ kind, ids: z.array(z.string()).max(500) }), req.body);
    scripts.reorderUserItems(ctx, owner(req), b.kind, b.ids);
    return { ok: true };
  });
  /** Approve an imported global script or rule as it is now. */
  app.post('/api/scripts/library/:id/approve', async (req) => {
    const b = parse(z.object({ kind: z.enum(['script', 'regex']) }), req.body);
    const it = scripts.listUserItems(ctx, owner(req), b.kind).find((x) => x.id === (req.params as any).id);
    if (!it) throw new HttpError(404, 'Not found');
    return scripts.saveUserItem(ctx, owner(req), b.kind, it.data, { id: it.id });
  });

  // ---------------- review and approvals
  app.get('/api/scripts/review', async (req) => {
    const t = parse(target, req.query);
    return scripts.reviewItems(ctx, owner(req), t);
  });
  app.post('/api/scripts/review', async (req) => {
    const b = parse(target.extend({ approve: z.array(z.string()).max(200).default([]), revoke: z.array(z.string()).max(200).default([]), trustCreator: z.boolean().default(false), once: z.boolean().default(false) }), req.body);
    return scripts.approveItems(ctx, owner(req), { kind: b.kind, id: b.id }, b.approve, { revoke: b.revoke, trustCreator: b.trustCreator, once: b.once });
  });
  app.get('/api/scripts/trust', async (req) => scripts.listTrust(ctx, owner(req)));
  app.post('/api/scripts/trust', async (req) => {
    const b = parse(z.object({ kind: z.enum(['creator', 'source']), value: z.string().min(1).max(120), on: z.boolean() }), req.body);
    scripts.setTrust(ctx, owner(req), b.kind, b.value, b.on);
    return scripts.listTrust(ctx, owner(req));
  });
  app.put('/api/scripts/character/:id', async (req) => {
    const b = parse(z.object({ scripts: z.array(z.unknown()).max(50), messagePermissions: z.array(z.enum(SCRIPT_PERMISSIONS)).optional() }), req.body);
    const id = (req.params as any).id;
    const items = scripts.saveCharacterScripts(ctx, owner(req), id, b.scripts, b.messagePermissions);
    ctx.bus.publish(owner(req), 'character.updated', { id }, req.clientId);
    return items;
  });

  // ---------------- variables
  app.get('/api/scripts/vars', async (req) => {
    const q = parse(z.object({ scope: z.enum(['global', 'character']), scopeId: z.string().default('') }), req.query);
    return scripts.getVars(ctx, owner(req), q.scope, q.scopeId);
  });
  app.patch('/api/scripts/vars', async (req) => {
    const b = parse(z.object({ scope: z.enum(['global', 'character']), scopeId: z.string().default(''), set: z.record(z.string().max(200), varValue), replace: z.boolean().default(false) }), req.body);
    return scripts.setVars(ctx, owner(req), b.scope, b.scopeId, b.set as VarMap, b.replace);
  });
  /** Message variables live on the message's current swipe, so they follow swipes and edits. */
  app.patch('/api/messages/:id/vars', async (req) => {
    const b = parse(z.object({ set: z.record(z.string().max(200), varValue), replace: z.boolean().default(false), swipeId: z.number().int().min(0).optional() }), req.body);
    const m = getMessage(ctx, owner(req), (req.params as any).id);
    const idx = b.swipeId ?? m.swipeId;
    if (!m.swipes[idx]) throw new HttpError(400, 'No such swipe');
    const swipes = m.swipes.slice();
    const cur: VarMap = b.replace ? {} : { ...(swipes[idx]!.vars ?? {}) };
    for (const [k, v] of Object.entries(b.set)) if (v === undefined) delete cur[k];
      else cur[k] = v as VarMap[string];
    if (JSON.stringify(cur).length > 64 * 1024) throw new HttpError(413, 'Too much data on one message (64 KB at most)');
    swipes[idx] = { ...swipes[idx]!, vars: cur };
    writeSwipes(ctx, m.id, swipes, m.swipeId);
    const next = getMessage(ctx, owner(req), m.id);
    ctx.bus.publish(owner(req), 'message.updated', { chatId: m.chatId, message: next }, req.clientId);
    return next;
  });

  /** /gen typed by the owner: a quick model call (logged like any other). */
  app.post('/api/scripts/user-generate', async (req) => {
    const b = parse(z.object({ prompt: z.string().min(1).max(20_000), model: z.enum(['main', 'utility']).default('utility'), maxTokens: z.number().int().min(1).max(2000).default(400) }), req.body);
    const o = owner(req);
    const conn = connectionForRole(ctx, o, b.model);
    if (!conn) throw new HttpError(400, 'Add a connection first');
    const messages = [{ role: 'user' as const, content: b.prompt }];
    const r = await logged(ctx, o, conn, { purpose: 'slash /gen', role: b.model }, promptTokens(messages), () => completeChat(conn, { messages, overrides: { max_tokens: b.maxTokens, reasoning: false, stop: [] }, signal: AbortSignal.timeout(120_000) }));
    return { text: r.text.trim() };
  });

  // ---------------- calls scripts make through the server
  const keyed = z.object({ key: z.string().min(3).max(300) });

  app.post('/api/scripts/run/generate', async (req, reply) => {
    const b = parse(
      keyed.extend({
        chatId: z.string().optional(),
        /** Raw messages, sent as they are. */
        messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().max(200_000) })).max(200).optional(),
        /** Or: the chat's own prompt (as for a reply), with this as the player's turn. */
        userInput: z.string().max(50_000).optional(),
        /** Replaces the system prompt at the top when using the chat's prompt. */
        systemOverride: z.string().max(50_000).optional(),
        model: z.enum(['main', 'utility']).default('main'),
        maxTokens: z.number().int().min(1).max(4000).default(600),
        temperature: z.number().min(0).max(2).optional(),
        stream: z.boolean().default(false),
      }),
      req.body,
    );
    const o = owner(req);
    const s = scripts.requireScript(ctx, o, b.key, 'generate');
    rateLimit(o, b.key, getSettings(ctx, o).scripts.generatePerMinute);
    let messages = b.messages;
    if (!messages) {
      if (!b.chatId) throw new HttpError(400, 'Give messages, or a chat to build the prompt from');
      const pc = loadPromptContext(ctx, o, b.chatId);
      const history: MessageDTO[] = b.userInput
        ? [...pc.history, { id: 'script-input', chatId: b.chatId, seq: 1e9, role: 'user', name: pc.userName, characterId: null, swipeId: 0, swipes: [{ text: b.userInput, createdAt: Date.now() }], hidden: false, bookmarked: false, extra: {}, createdAt: Date.now(), updatedAt: Date.now() }]
        : pc.history;
      const built = await buildPrompt(ctx, o, pc, { type: 'quiet', history, maxContext: 16384, maxResponse: b.maxTokens });
      messages = built.assembled.messages.map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content }));
      if (b.systemOverride && messages[0]?.role === 'system') messages[0] = { role: 'system', content: b.systemOverride };
    }
    const conn = connectionForRole(ctx, o, b.model === 'utility' ? 'utility' : 'main');
    if (!conn) throw new HttpError(400, 'Add a connection first');
    const meta = { purpose: `script: ${s.name}`.slice(0, 80), role: b.model === 'utility' ? ('utility' as const) : ('main' as const), chatId: b.chatId ?? null };
    const overrides = { max_tokens: b.maxTokens, ...(b.temperature !== undefined ? { temperature: b.temperature } : {}), reasoning: false, stop: [] as string[] };
    if (!b.stream) {
      const r = await logged(ctx, o, conn, meta, promptTokens(messages), () => completeChat(conn, { messages: messages!, overrides, signal: AbortSignal.timeout(120_000) }));
      return { text: r.text };
    }
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' });
    const ctrl = new AbortController();
    raw.on('close', () => ctrl.abort());
    const t0 = performance.now();
    let text = '';
    let error: string | null = null;
    try {
      for await (const ch of streamChat(conn, { messages, overrides, signal: ctrl.signal })) {
        if (ch.text) {
          text += ch.text;
          raw.write(`data: ${JSON.stringify({ type: 'delta', text: ch.text })}\n\n`);
        }
      }
    } catch (e) {
      error = (e as Error).message;
    }
    recordCall(ctx, o, conn, meta, { ms: performance.now() - t0, tokensIn: promptTokens(messages), tokensOut: countTokens(text), ok: !error, error });
    if (!ctrl.signal.aborted) {
      raw.write(`data: ${JSON.stringify(error ? { type: 'error', error } : { type: 'done', text })}\n\n`);
      raw.end();
    }
  });

  app.post('/api/scripts/run/fetch', async (req) => {
    const b = parse(
      keyed.extend({
        url: z.string().url().max(2000),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
        headers: z.record(z.string().max(100), z.string().max(2000)).default({}),
        body: z.string().max(1_000_000).optional(),
      }),
      req.body,
    );
    const s = scripts.requireScript(ctx, owner(req), b.key, 'network');
    const u = new URL(b.url);
    if (u.protocol !== 'https:') throw new HttpError(400, 'Only https addresses');
    if (!domainAllowed(u.hostname, s.domains)) throw new HttpError(403, `${s.name} may not reach ${u.hostname}`, 'script_domain');
    const headers = Object.fromEntries(Object.entries(b.headers).filter(([k]) => !/^(cookie|host|origin|referer|x-forwarded-.*|proxy-.*)$/i.test(k)));
    const res = await safeFetch(b.url, { method: b.method, headers, body: b.body, timeoutMs: 20_000 });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 1024 * 1024) throw new HttpError(413, 'The response is larger than 1 MB');
    return { status: res.status, contentType: res.headers.get('content-type') ?? '', text: buf.toString('utf8') };
  });

  app.get('/api/scripts/run/storage', async (req) => {
    const q = parse(keyed.extend({ k: z.string().max(200).optional() }), req.query);
    scripts.requireScript(ctx, owner(req), q.key, 'storage');
    return { value: scripts.storageGet(ctx, owner(req), q.key, q.k) };
  });
  app.put('/api/scripts/run/storage', async (req) => {
    const b = parse(keyed.extend({ k: z.string().min(1).max(200), value: z.unknown() }), req.body);
    scripts.requireScript(ctx, owner(req), b.key, 'storage');
    scripts.storageSet(ctx, owner(req), b.key, b.k, b.value);
    return { ok: true };
  });

  /** Game changes from a script: the same checks as the AI's, anchored to the newest message (so they roll back with it). */
  app.post('/api/scripts/run/ops', async (req) => {
    const b = parse(keyed.extend({ chatId: z.string(), ops: z.array(z.unknown()).min(1).max(32) }), req.body);
    const o = owner(req);
    scripts.requireScript(ctx, o, b.key, 'state.ops');
    const chat = getChat(ctx, o, b.chatId);
    if (!chat.campaignId) throw new HttpError(400, 'This chat has no game');
    const { features } = settingsFor(ctx, o, chat);
    const v = withoutRetired(validateOps(b.ops, allowedOpTypes(AI_OP_TYPES, features) as typeof AI_OP_TYPES));
    if (!v.ok.length) return { applied: 0, errors: v.rejected.map((r) => r.error) };
    const last = ctx.db.prepare('SELECT id, swipe_id FROM messages WHERE chat_id = ? ORDER BY seq DESC LIMIT 1').get(b.chatId) as { id: string; swipe_id: number } | undefined;
    const r = appendOps(ctx, o, chat.campaignId, { chatId: b.chatId, messageId: last?.id ?? null, swipeId: last?.swipe_id ?? null, source: 'script', ops: v.ok, origin: req.clientId });
    return { applied: v.ok.length - r.errors.length, summary: r.summary, errors: [...v.rejected.map((x) => x.error), ...r.errors.map((e) => e.error)] };
  });
}
