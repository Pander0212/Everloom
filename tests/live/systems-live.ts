/**
 * Live smoke of Everloom's other AI systems with a real model (NanoGPT subscription):
 * a few story turns (tracker → game state), then quickstart, story cards, studio, helper, phone,
 * diary, browser, social feed, cutscene, recipes, map expansion. Records ok/fail, time, a short
 * excerpt, and the resulting game state.
 *
 *   NANO_KEY=... tsx tests/live/systems-live.ts <card.png> <model>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient, parseSse } from '../../apps/server/test/helpers.js';

const BASE = 'https://nano-gpt.com/api/subscription/v1';
const [cardPath, model] = process.argv.slice(2);
const KEY = process.env.NANO_KEY;
if (!KEY || !cardPath || !model) throw new Error('usage: NANO_KEY=... tsx systems-live.ts <card.png> <model>');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const c = await createClient();
const results: Array<{ system: string; ok: boolean; ms: number; status?: number; excerpt: string }> = [];
const run = async (system: string, method: string, url: string, body?: unknown) => {
  const t0 = Date.now();
  const r = await c.req(method, url, body);
  const text = r.body.length > 600 ? `${r.body.slice(0, 600)}…` : r.body;
  results.push({ system, ok: r.status < 400, ms: Date.now() - t0, status: r.status, excerpt: text.replace(/\s+/g, ' ') });
  console.log(`${r.status < 400 ? 'ok  ' : 'FAIL'} ${system} ${r.status} ${Math.round((Date.now() - t0) / 1000)}s`);
  return r;
};
try {
  const conn = (await c.req('POST', '/api/connections', { name: 'Nano', provider: 'openai', baseUrl: BASE, model, apiKey: KEY, params: { max_tokens: 1500, context_size: 32768, temperature: 0.7 } })).json;
  await c.req('PATCH', '/api/settings', { roles: { main: conn.id, utility: conn.id } });
  await c.req('POST', '/api/personas', { name: 'Rin Ashford', description: 'Rin Ashford, 24, a lanky half-elf woman with silver hair. Reincarnated from Earth.', isDefault: true });
  const card = (await c.req('POST', '/api/characters/import', readFileSync(cardPath), { 'content-type': 'image/png' })).json;
  const chat = (await c.req('POST', '/api/chats', { characterId: card.id })).json;
  for (const text of ['I register at the guild as a Ranger and pay the 5 coin fee.', 'I buy a used shortbow and a quiver of arrows at the market for 12 coins.', 'I walk to the Whisperwood and make camp for the night.']) {
    const t0 = Date.now();
    const r = await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text });
    const done = parseSse(r.body).find((e) => e.type === 'done');
    results.push({ system: 'story reply + tracker', ok: !!done?.messageId && !done.error, ms: Date.now() - t0, excerpt: String(done?.message?.swipes?.[0]?.text ?? done?.error ?? '').slice(0, 200) });
    for (let i = 0; i < 90; i++) {
      const calls = (await c.req('GET', `/api/calls?chatId=${chat.id}&messageId=${done?.messageId}`)).json;
      if (calls.some((x: any) => x.purpose === 'tracker')) break;
      await sleep(1000);
    }
  }
  const camp = (await c.req('GET', `/api/chats/${chat.id}`)).json.campaignId;
  const state = c.built.ctx.db.prepare('SELECT state FROM campaigns WHERE id = ?').get(camp) as { state: string } | undefined;
  const s = state ? JSON.parse(state.state) : null;
  const gameState = s ? { time: s.time?.minutes, location: s.locations?.[s.currentLocationId]?.name ?? null, currency: s.player?.currency, inventory: Object.values(s.inventory ?? {}).map((i: any) => `${i.name}×${i.qty}`), npcs: Object.values(s.npcs ?? {}).map((n: any) => n.name), quests: Object.values(s.quests ?? {}).map((q: any) => q.title ?? q.name) } : null;
  console.log('game state', JSON.stringify(gameState));
  const npc = s ? Object.keys(s.npcs ?? {})[0] : null;
  await run('quickstart draft', 'POST', '/api/quickstart/draft', { idea: 'A cozy fantasy bakery run by a retired dragon', genre: 'fantasy', mode: 'story' });
  await run('story cards (lorebook AI)', 'POST', `/api/chats/${chat.id}/cards/generate`, { count: 3 });
  await run('character studio', 'POST', '/api/studio/run', { request: { mode: 'create', brief: 'A grumpy dwarven blacksmith in Helm who secretly writes poetry. Adult.' } });
  await run('helper', 'POST', '/api/helper/ask', { text: 'How do I level up faster as a Ranger?', chatId: chat.id });
  if (camp) {
    if (npc) await run('phone text', 'POST', `/api/campaigns/${camp}/phone/${npc}`, { chatId: chat.id, text: 'Hey, are you at the guild tomorrow?' });
    await run('diary draft', 'POST', `/api/campaigns/${camp}/diary/draft`, { chatId: chat.id });
    await run('in-world browser', 'POST', `/api/campaigns/${camp}/browser`, { chatId: chat.id, query: 'history of the Helm Adventurers Guild' });
    await run('social feed', 'POST', `/api/campaigns/${camp}/feed/refresh`, { chatId: chat.id });
    await run('cutscene', 'POST', `/api/campaigns/${camp}/cutscenes/generate`, { chatId: chat.id, idea: 'dawn over the Whisperwood' });
    await run('recipe suggestions', 'POST', `/api/campaigns/${camp}/recipes/suggest`, { discipline: 'cooking', idea: 'campfire food' });
    await run('map expansion', 'POST', `/api/campaigns/${camp}/map/expand`, { chatId: chat.id, parentId: null, count: 3 });
  }
  writeFileSync(`tests/live/out/systems-${model.replace(/[^a-z0-9.]+/gi, '_')}.json`, JSON.stringify({ model, gameState, results }, null, 1));
} finally {
  await c.close();
}
