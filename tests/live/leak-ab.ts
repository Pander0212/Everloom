/**
 * Leak A/B on one shared story state (replayed once), switching only ECHO settings between batches:
 *   off · notes (history notes only) · guard (notes + reply guard with repair) · strict (+ character-first)
 * Each sample is judged by a separate model (did the asked character show they know the secret?),
 * plus the old word check. NANO_KEY=... tsx tests/live/leak-ab.ts <run.json> <card.png> <probeTag> <n> <model…>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient, parseSse } from '../../apps/server/test/helpers.js';
import { SCRIPTS } from './scripts.js';

const BASE = 'https://nano-gpt.com/api/subscription/v1';
const JUDGE = 'z-ai/glm-5.3';
const [runFile, cardPath, tag, nArg, ...models] = process.argv.slice(2);
const KEY = process.env.NANO_KEY!;
const run = JSON.parse(readFileSync(runFile, 'utf8'));
const script = SCRIPTS[run.script];
const probe = script.probes.find((p) => p.tag === tag)!;
const idx = run.turns.findIndex((t: any) => t.tag === tag);
const SECRETS: Record<string, { who: string; secret: string }> = {
  'guildbound:probe-hidden': { who: 'the one-armed dwarf (Gravitas / the guildmaster)', secret: 'Rin secretly slipped a black iron key into her left boot while nobody was looking' },
  'korra:probe-secret': { who: 'Bolin', secret: 'Tamsin overheard masked Equalists planning to sabotage the arena lights during Saturday\'s match' },
};
const sec = SECRETS[`${run.script}:${tag}`];
const VARIANTS: Array<{ name: string; echo: Record<string, unknown> }> = [
  { name: 'off', echo: { profile: 'off' } },
  { name: 'notes', echo: { profile: 'balanced', historyNotes: true, guard: 'off', characterFirst: false } },
  { name: 'guard', echo: { profile: 'balanced', historyNotes: true, guard: 'repair', characterFirst: false } },
  { name: 'strict', echo: { profile: 'strict', historyNotes: true, guard: 'repair', characterFirst: true } },
];

async function judge(reply: string): Promise<boolean | null> {
  const body = {
    model: JUDGE,
    temperature: 0,
    max_tokens: 400,
    messages: [
      { role: 'system', content: 'You judge roleplay replies. Answer with exactly one word: YES or NO.' },
      { role: 'user', content: `Secret: ${sec.secret}.\nCharacter: ${sec.who} — they never saw this and nobody told them.\n\nDoes the reply below show this character knowing, having noticed, or correctly guessing the secret (or its specific details)? The player's own question doesn't count; only what the character says or does.\n\nReply:\n${reply.slice(0, 5000)}` },
    ],
  };
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${BASE}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
      const j: any = await r.json();
      const t = String(j.choices?.[0]?.message?.content ?? '').trim().toUpperCase();
      if (t.startsWith('YES')) return true;
      if (t.startsWith('NO')) return false;
    } catch {
      /* retry */
    }
  }
  return null;
}

const c = await createClient();
const q = async (m: string, u: string, b?: unknown) => {
  const r = await c.req(m, u, b);
  if (r.status >= 400) throw new Error(`${m} ${u} → ${r.status} ${r.body.slice(0, 200)}`);
  return r.json;
};
const out: any = { run: run.runId, tag, n: Number(nArg), models, samples: [], present: null };
const file = `tests/live/out/leak-${run.script}-${tag}.json`;
try {
  const conns: Record<string, string> = {};
  for (const m of [...new Set([run.utility, ...models])]) conns[m] = (await q('POST', '/api/connections', { name: m, provider: 'openai', baseUrl: BASE, model: m, apiKey: KEY, params: { max_tokens: 700, context_size: 32768, temperature: 0.8 } })).id;
  await q('PATCH', '/api/settings', { roles: { main: conns[models[0]], utility: conns[run.utility] } });
  await q('POST', '/api/personas', { name: script.persona.name, description: script.persona.description, isDefault: true });
  const card = (await c.req('POST', '/api/characters/import', readFileSync(cardPath), { 'content-type': 'image/png' })).json;
  const chat = await q('POST', '/api/chats', { characterId: card.id });
  await q('PATCH', `/api/chats/${chat.id}/echo`, { profile: 'balanced', narration: script.narration });
  for (const t of run.turns.slice(0, idx)) {
    await q('POST', `/api/chats/${chat.id}/messages`, { role: 'user', text: t.user });
    const m = await q('POST', `/api/chats/${chat.id}/messages`, { role: 'assistant', text: t.reply, characterId: card.id });
    await c.req('POST', `/api/messages/${m.id}/retrack`);
  }
  const st = await q('GET', `/api/chats/${chat.id}/echo`);
  out.present = st.actors;
  console.log(`replayed ${idx} turns; actors: ${st.actors.map((a: any) => a.name).join(', ')}`);
  // The probe message, then all samples as swipes of one reply.
  let first = true;
  for (const v of VARIANTS) {
    await q('PATCH', `/api/chats/${chat.id}/echo`, { ...v.echo, narration: script.narration });
    for (const model of models) {
      await q('PATCH', '/api/settings', { roles: { main: conns[model], utility: conns[run.utility] } });
      for (let i = 0; i < Number(nArg); i++) {
        const body = first ? { type: 'normal', text: run.turns[idx].user } : { type: 'swipe' };
        first = false;
        const ev = parseSse((await c.req('POST', `/api/chats/${chat.id}/generate`, body)).body);
        const dones = ev.filter((e) => e.type === 'done');
        const done = dones[dones.length - 1];
        const text = String(done?.message?.swipes?.[done.message.swipeId]?.text ?? '');
        const low = text.toLowerCase();
        const words = (probe.replyAvoids ?? []).filter((w) => low.includes(w.toLowerCase()));
        const leak = text ? await judge(text) : null;
        const msg = done?.messageId ? (await q('GET', `/api/chats/${chat.id}/messages`)).find((m: any) => m.id === done.messageId) : null;
        out.samples.push({ variant: v.name, model, i, judge: leak, words, repaired: dones.length > 1, flagged: !!msg?.extra?.echoGuard, text });
        console.log(`${v.name} ${model} #${i + 1}: judge ${leak === null ? '?' : leak ? 'LEAK' : 'clean'}${dones.length > 1 ? ' (repaired)' : ''}`);
        writeFileSync(file, JSON.stringify(out, null, 1));
      }
    }
  }
} finally {
  await c.close();
}
writeFileSync(file, JSON.stringify(out, null, 1));
