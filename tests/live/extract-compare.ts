/**
 * Extraction comparison: the same fixed transcript (taken from a finished live run) is read by
 * the tracker with different utility models. Measures, per model, whether the planted moments
 * became the right ECHO structure: a commitment for the promise, a private event reaching only the
 * dwarf for the whisper, a lie (sincere: false), a hidden object nobody else perceived — plus JSON
 * failures, events per turn and tokens.
 *
 *   NANO_KEY=... tsx tests/live/extract-compare.ts <run.json> <card.png> <model> [model…]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '../../apps/server/test/helpers.js';

const BASE = 'https://nano-gpt.com/api/subscription/v1';
const [runFile, cardPath, ...models] = process.argv.slice(2);
const KEY = process.env.NANO_KEY;
if (!KEY || !runFile || !models.length) throw new Error('usage: NANO_KEY=... tsx extract-compare.ts <run.json> <card.png> <model…>');
const run = JSON.parse(readFileSync(runFile, 'utf8'));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: any[] = [];

for (const model of models) {
  const c = await createClient();
  const q = async (m: string, u: string, b?: unknown) => {
    const r = await c.req(m, u, b);
    if (r.status >= 400) throw new Error(`${m} ${u} → ${r.status} ${r.body.slice(0, 200)}`);
    return r.json;
  };
  try {
    const conn = await q('POST', '/api/connections', { name: 'u', provider: 'openai', baseUrl: BASE, model, apiKey: KEY, params: { max_tokens: 1200, context_size: 32768, temperature: 0.2 } });
    await q('PATCH', '/api/settings', { roles: { main: conn.id, utility: conn.id } });
    await q('POST', '/api/personas', { name: 'Rin Ashford', description: 'Rin Ashford, 24, a lanky half-elf woman.', isDefault: true });
    const card = (await c.req('POST', '/api/characters/import', readFileSync(cardPath), { 'content-type': 'image/png' })).json;
    const chat = await q('POST', '/api/chats', { characterId: card.id });
    await q('PATCH', `/api/chats/${chat.id}/echo`, { profile: 'balanced', narration: 'persona' });
    const t0 = Date.now();
    const tagged: Record<string, string> = {};
    for (const t of run.turns) {
      await q('POST', `/api/chats/${chat.id}/messages`, { role: 'user', text: t.user });
      const m = await q('POST', `/api/chats/${chat.id}/messages`, { role: 'assistant', text: t.reply });
      if (t.tag) tagged[t.tag] = m.id;
      for (let i = 0; i < 120; i++) {
        const calls = await q('GET', `/api/calls?chatId=${chat.id}&messageId=${m.id}`);
        if (calls.some((x: any) => x.purpose === 'tracker' || x.purpose === 'tracker (repair)')) break;
        await sleep(1000);
      }
      await sleep(300);
    }
    await sleep(2000);
    const rows = c.built.ctx.db.prepare('SELECT message_id, data FROM echo_events WHERE chat_id = ?').all(chat.id) as Array<{ message_id: string; data: string }>;
    const events = rows.map((r) => ({ msg: r.message_id, e: JSON.parse(r.data) }));
    const of = (tag: string) => events.filter((x) => x.msg === tagged[tag]).map((x) => x.e);
    const st = await q('GET', `/api/chats/${chat.id}/echo`);
    const know = async (id: string) => JSON.stringify(await q('GET', `/api/chats/${chat.id}/echo/knowledge/${encodeURIComponent(id)}`)).toLowerCase();
    const actors = st.actors ?? [];
    const idOf = (re: RegExp) => actors.find((a: any) => re.test(a.name))?.id;
    const miki = idOf(/miki/i);
    const dwarf = idOf(/gravitas|dwarf|guildmaster/i);
    const checks = {
      promise: of('promise').some((e) => !!e.commitment),
      secretPrivate: of('secret').some((e) => e.visibility !== 'public'),
      lieMarked: of('lie').some((e) => e.sincere === false),
      hideNotPublic: of('hide').some((e) => e.visibility !== 'public' || (e.cues ?? []).length > 0),
      mikiNoEarth: miki ? !(await know(miki)).includes('earth') : null,
      mikiBelievesLie: miki ? (await know(miki)).includes('lowmere') : null,
      dwarfKnowsEarth: dwarf ? (await know(dwarf)).includes('earth') : null,
      mikiNoKey: miki ? !(await know(miki)).includes('boot') : null,
    };
    const calls = await q('GET', `/api/calls?chatId=${chat.id}&limit=1000`);
    const tr = calls.filter((x: any) => x.purpose.startsWith('tracker'));
    const r = { model, events: events.length, perTurn: Math.round((events.length / run.turns.length) * 10) / 10, rejected: null, repairs: tr.filter((x: any) => x.purpose === 'tracker (repair)').length, failed: tr.filter((x: any) => !x.ok).length, tokensIn: tr.reduce((a: number, x: any) => a + (x.tokensIn ?? 0), 0), tokensOut: tr.reduce((a: number, x: any) => a + (x.tokensOut ?? 0), 0), msPerTurn: Math.round((Date.now() - t0) / run.turns.length), npcs: actors.length, checks, score: Object.values(checks).filter((v) => v === true).length + '/' + Object.values(checks).filter((v) => v !== null).length };
    console.log(JSON.stringify(r));
    results.push(r);
  } catch (e) {
    console.log(JSON.stringify({ model, error: (e as Error).message }));
    results.push({ model, error: (e as Error).message });
  } finally {
    await c.close();
  }
}
writeFileSync('tests/live/out/extract-compare.json', JSON.stringify(results, null, 1));
