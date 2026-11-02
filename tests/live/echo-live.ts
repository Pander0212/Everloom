/**
 * Live ECHO test with real models (NanoGPT subscription). Never run in CI; the key comes only from
 * the environment:  NANO_KEY=... npx tsx tests/live/echo-live.ts <card.png> <script> <model> [profile] [utilityModel]
 *
 * Plays a scripted session through the real server (in-process, temporary data folder), then
 * writes everything measurable to tests/live/out/<run>.json: each reply, latency, tokens, every
 * model call, the ECHO packet each reply was given, what each character knows at the end, the
 * checks (probes) and a swipe rollback check.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient, parseSse } from '../../apps/server/test/helpers.js';
import { SCRIPTS, type Script } from './scripts.js';

const BASE = 'https://nano-gpt.com/api/subscription/v1';
const [cardPath, scriptName, model, profile = 'balanced', utility = 'deepseek/deepseek-v4.1-flash-1017'] = process.argv.slice(2);
const KEY = process.env.NANO_KEY;
if (!KEY || !cardPath || !scriptName || !model) {
  console.error('usage: NANO_KEY=... tsx tests/live/echo-live.ts <card.png> <script> <model> [profile] [utility]');
  process.exit(2);
}
const script: Script = SCRIPTS[scriptName];
if (!script) throw new Error(`no script ${scriptName}`);
const runId = `${scriptName}-${model.replace(/[^a-z0-9.]+/gi, '_')}-${profile}`;
const log = (s: string) => console.log(`[${runId}] ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const c = await createClient();
const q = async (method: string, url: string, body?: unknown) => {
  const r = await c.req(method, url, body);
  if (r.status >= 400) throw new Error(`${method} ${url} → ${r.status} ${r.body.slice(0, 300)}`);
  return r.json;
};
try {
  const params = { max_tokens: 700, context_size: 32768, temperature: 0.8 };
  const main = await q('POST', '/api/connections', { name: 'Nano main', provider: 'openai', baseUrl: BASE, model, apiKey: KEY, params });
  const util = await q('POST', '/api/connections', { name: 'Nano utility', provider: 'openai', baseUrl: BASE, model: utility, apiKey: KEY, params: { ...params, temperature: 0.2 } });
  await q('PATCH', '/api/settings', { roles: { main: main.id, utility: util.id } });
  await q('POST', '/api/personas', { name: script.persona.name, description: script.persona.description, isDefault: true });
  const imported = await c.req('POST', '/api/characters/import', readFileSync(cardPath), { 'content-type': 'image/png' });
  if (imported.status >= 400) throw new Error(`import failed: ${imported.body}`);
  const card = imported.json;
  const chat = await q('POST', '/api/chats', { characterId: card.id });
  if (profile !== 'off') await q('PATCH', `/api/chats/${chat.id}/echo`, { profile, narration: script.narration });
  log(`chat ${chat.id}, card "${card.name}", main ${model}, utility ${utility}, ECHO ${profile}`);

  const turns: any[] = [];
  const waitTracker = async (messageId: string) => {
    for (let i = 0; i < 120; i++) {
      const calls = await q('GET', `/api/calls?chatId=${chat.id}`);
      const t = calls.find((x: any) => x.messageId === messageId && x.purpose.startsWith('tracker'));
      if (t && !calls.some((x: any) => x.messageId === messageId && x.purpose === 'tracker (repair)' && !x.ms)) return t;
      await sleep(1000);
    }
    return null;
  };
  const say = async (text: string, tag?: string) => {
    const t0 = Date.now();
    const r = await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text });
    const ev = parseSse(r.body);
    const done = ev.find((e) => e.type === 'done');
    const err = ev.find((e) => e.type === 'error');
    const reply = done?.message?.swipes?.[done.message.swipeId]?.text ?? '';
    const tracker = done?.messageId ? await waitTracker(done.messageId) : null;
    await sleep(400);
    const packet = done?.messageId ? (await q('GET', `/api/chats/${chat.id}/echo/packets?messageId=${done.messageId}`))[0] ?? null : null;
    const turn = { n: turns.length + 1, tag: tag ?? null, user: text, reply, messageId: done?.messageId, ms: Date.now() - t0, error: err?.error ?? done?.error ?? null, tracker: tracker ? { ok: tracker.ok, ms: tracker.ms, error: tracker.error } : null, packet: packet ? { actor: packet.actor, scope: packet.scope, tokens: packet.tokens, text: packet.text, recall: packet.recall } : null };
    turns.push(turn);
    log(`turn ${turn.n}${tag ? ` [${tag}]` : ''}: ${Math.round(turn.ms / 1000)}s, reply ${reply.length} chars, packet ${packet?.tokens ?? 0} tok${turn.error ? `, ERROR ${turn.error}` : ''}`);
    return turn;
  };

  for (const step of script.turns) await say(step.text, step.tag);

  // Swipe rollback: an alternative take of the last reply, then back.
  const last = turns[turns.length - 1];
  const before = (await q('GET', `/api/chats/${chat.id}/echo`)).counts;
  const sw = parseSse((await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'swipe' })).body).find((e) => e.type === 'done');
  if (sw?.messageId) await waitTracker(sw.messageId);
  await sleep(1500);
  const during = (await q('GET', `/api/chats/${chat.id}/echo`)).counts;
  await q('POST', `/api/messages/${last.messageId}/swipe`, { swipeId: 0 });
  const after = (await q('GET', `/api/chats/${chat.id}/echo`)).counts;
  const swipe = { before, during, after, restored: JSON.stringify(before) === JSON.stringify(after) };
  log(`swipe: events ${before?.events} → ${during?.events} → ${after?.events} (restored: ${swipe.restored})`);

  // What everyone knows at the end, and the probes.
  const st = await q('GET', `/api/chats/${chat.id}/echo`);
  const knowledge: Record<string, any> = {};
  for (const a of st.actors ?? []) knowledge[a.id] = { name: a.name, ...(await q('GET', `/api/chats/${chat.id}/echo/knowledge/${encodeURIComponent(a.id)}`)) };
  const npcs = (await q('GET', `/api/chats/${chat.id}/memory`)).people;
  const calls = await q('GET', `/api/calls?chatId=${chat.id}&limit=1000`);
  const probes = script.probes.map((p) => {
    const t = turns.find((x) => x.tag === p.tag);
    const reply = (t?.reply ?? '').toLowerCase();
    const pkt = (t?.packet?.text ?? '').toLowerCase();
    const r: any = { tag: p.tag, kind: p.kind, note: p.note };
    if (p.replyMentions) r.replyMentions = p.replyMentions.map((w) => ({ w, hit: reply.includes(w.toLowerCase()) }));
    if (p.replyAvoids) r.replyAvoids = p.replyAvoids.map((w) => ({ w, hit: reply.includes(w.toLowerCase()) }));
    if (p.packetMentions) r.packetMentions = p.packetMentions.map((w) => ({ w, hit: pkt.includes(w.toLowerCase()) }));
    if (p.packetAvoids) r.packetAvoids = p.packetAvoids.map((w) => ({ w, hit: pkt.includes(w.toLowerCase()) }));
    return r;
  });
  const sum = (purpose?: string) => calls.filter((x: any) => !purpose || x.purpose === purpose).reduce((a: any, x: any) => ({ n: a.n + 1, in: a.in + (x.tokensIn ?? 0), out: a.out + (x.tokensOut ?? 0), failed: a.failed + (x.ok ? 0 : 1) }), { n: 0, in: 0, out: 0, failed: 0 });
  const usage = { all: sum(), reply: sum('reply'), tracker: sum('tracker'), repair: sum('tracker (repair)'), proposals: sum('echo strict proposal'), chronicle: sum('chronicle') };
  const out = { runId, model, utility, profile, card: card.name, script: scriptName, at: new Date().toISOString(), turns, swipe, echo: { counts: st.counts, violations: st.violations, issues: st.issues, actors: st.actors }, knowledge, npcs, probes, usage, calls };
  mkdirSync(path.resolve('tests/live/out'), { recursive: true });
  writeFileSync(path.resolve('tests/live/out', `${runId}.json`), JSON.stringify(out, null, 1));
  log(`done: ${turns.length} turns, ${usage.all.n} calls, ${usage.all.in + usage.all.out} tokens, events ${st.counts?.events}`);
} finally {
  await c.close();
}
