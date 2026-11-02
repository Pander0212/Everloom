/**
 * A/B on a secret probe: the same story state, ECHO on vs off, several writer models, several
 * swipes each. The story is replayed from a finished run (same text; only the tracker reads it),
 * then the probe is asked and swiped. Counts how often a character who never perceived the secret
 * reveals or "notices" it.
 *
 *   NANO_KEY=... tsx tests/live/probe-ab.ts <run.json> <card.png> <probeTag> <swipes> <echo:on|off> <model…>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient, parseSse } from '../../apps/server/test/helpers.js';
import { SCRIPTS } from './scripts.js';

const BASE = 'https://nano-gpt.com/api/subscription/v1';
const [runFile, cardPath, tag, swipesArg, echoArg, ...models] = process.argv.slice(2);
const KEY = process.env.NANO_KEY;
if (!KEY || !models.length) throw new Error('usage: probe-ab.ts <run.json> <card.png> <probeTag> <swipes> <on|off> <model…>');
const run = JSON.parse(readFileSync(runFile, 'utf8'));
const script = SCRIPTS[run.script];
const probe = script.probes.find((p) => p.tag === tag)!;
const idx = run.turns.findIndex((t: any) => t.tag === tag);
const c = await createClient();
const q = async (m: string, u: string, b?: unknown) => {
  const r = await c.req(m, u, b);
  if (r.status >= 400) throw new Error(`${m} ${u} → ${r.status} ${r.body.slice(0, 200)}`);
  return r.json;
};
const out: any = { run: run.runId, tag, echo: echoArg, samples: [] };
try {
  const conns: Record<string, string> = {};
  for (const m of [...new Set([run.utility, ...models])]) conns[m] = (await q('POST', '/api/connections', { name: m, provider: 'openai', baseUrl: BASE, model: m, apiKey: KEY, params: { max_tokens: 700, context_size: 32768, temperature: 0.8 } })).id;
  await q('PATCH', '/api/settings', { roles: { main: conns[models[0]], utility: conns[run.utility] } });
  await q('POST', '/api/personas', { name: script.persona.name, description: script.persona.description, isDefault: true });
  const card = (await c.req('POST', '/api/characters/import', readFileSync(cardPath), { 'content-type': 'image/png' })).json;
  const chat = await q('POST', '/api/chats', { characterId: card.id });
  await q('PATCH', `/api/chats/${chat.id}/echo`, { profile: echoArg === 'on' ? 'balanced' : 'off', narration: script.narration });
  for (const t of run.turns.slice(0, idx)) {
    await q('POST', `/api/chats/${chat.id}/messages`, { role: 'user', text: t.user });
    const m = await q('POST', `/api/chats/${chat.id}/messages`, { role: 'assistant', text: t.reply, characterId: card.id });
    await c.req('POST', `/api/messages/${m.id}/retrack`);
  }
  console.log(`replayed ${idx} turns`);
  let first = true;
  for (const model of models) {
    await q('PATCH', '/api/settings', { roles: { main: conns[model], utility: conns[run.utility] } });
    for (let i = 0; i < Number(swipesArg); i++) {
      const body = first ? { type: 'normal', text: run.turns[idx].user } : { type: 'swipe' };
      first = false;
      const done = parseSse((await c.req('POST', `/api/chats/${chat.id}/generate`, body)).body).find((e) => e.type === 'done');
      const text = String(done?.message?.swipes?.[done.message.swipeId]?.text ?? '');
      const low = text.toLowerCase();
      const leaked = (probe.replyAvoids ?? []).filter((w) => low.includes(w.toLowerCase()));
      const pk = done?.messageId ? (await q('GET', `/api/chats/${chat.id}/echo/packets?messageId=${done.messageId}`)).find((x: any) => x.swipeId === done.message.swipeId) : null;
      out.samples.push({ model, i, leaked, text, packetActor: pk?.actor ?? null, packetScope: pk?.scope ?? null });
      console.log(`${model} #${i + 1}: ${leaked.length ? `LEAK ${leaked.join(', ')}` : 'clean'} (packet: ${pk?.actor ?? '-'} / ${pk?.scope ?? '-'})`);
    }
  }
  const pkt = await q('GET', `/api/chats/${chat.id}/echo/packets`);
  out.packet = pkt[0]?.text ?? null;
} finally {
  await c.close();
}
writeFileSync(`tests/live/out/ab-${run.script}-${tag}-${echoArg}.json`, JSON.stringify(out, null, 1));
