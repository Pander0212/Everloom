/** The guard rails found necessary on live runs (docs/echo/LIVE.md), end to end on the server. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startMockLlm } from '../../../tests/mock-llm/server.js';
import { createClient, parseSse, waitFor, type TestClient } from './helpers.js';

let mock: Awaited<ReturnType<typeof startMockLlm>>;
let c: TestClient;
const control = (body: object) => fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify(body) });
const calls = async () => (await (await fetch(mock.url.replace('/v1', '/__control'))).json()).calls as any[];

beforeAll(async () => {
  mock = await startMockLlm();
});
afterAll(async () => mock.close());
beforeEach(async () => {
  await control({ reset: true });
  c = await createClient();
  const conn = await c.req('POST', '/api/connections', { name: 'Mock', provider: 'openai', baseUrl: mock.url, model: 'mock-story', params: { max_tokens: 300, context_size: 8192 } });
  await c.req('PATCH', '/api/settings', { roles: { main: conn.json.id } });
});
afterEach(async () => c?.close());

const here = (actor: string) => ({ actor, place: 'here', sight: true, hearing: 'clear', awake: true, impairment: 0, attention: 1 });
async function setup(echo: object = {}) {
  await c.req('POST', '/api/personas', { name: 'Mara', isDefault: true });
  const ch = await c.req('POST', '/api/characters', { card: { name: 'Narrator', first_mes: 'The guild hall is loud.' } });
  const chat = (await c.req('POST', '/api/chats', { characterId: ch.json.id })).json;
  await c.req('PATCH', `/api/chats/${chat.id}/echo`, { profile: 'balanced', narration: 'persona', ...echo });
  await control({ story: 'Gravitas Hail watches from the balcony.', trackerOps: [{ type: 'location.move', to: 'Guild Hall' }, { type: 'npc.upsert', name: 'Gravitas Hail', role: 'Guildmaster', appearance: 'A one-armed dwarf', location: 'Guild Hall' }], trackerMemories: [] });
  const r = parseSse((await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: 'I look around.' })).body).find((e) => e.type === 'done');
  await waitFor(async () => ((await c.req('GET', `/api/calls?chatId=${chat.id}`)).json.some((x: any) => x.purpose === 'tracker') ? true : null));
  await new Promise((res) => setTimeout(res, 200));
  // The secret: only Mara perceived it.
  await c.req('POST', `/api/chats/${chat.id}/echo/events`, { messageId: r.messageId, events: [{ type: 'action', actors: ['Mara'], action: 'Mara slipped the black iron key into her left boot', visibility: 'secret', observers: [here('player')], establishes: [{ s: 'key', p: 'location', o: 'boot' }] }] });
  await control({ trackerOps: [] });
  return { chat, secretMsg: r.messageId as string };
}

describe('ECHO guard rails on the server', () => {
  it('history notes mark the private moment where it happened', async () => {
    const { chat } = await setup();
    const parts = JSON.stringify((await c.req('POST', `/api/chats/${chat.id}/prompt/preview`, {})).json.parts);
    expect(parts).toContain('[Perspective: only Mara perceived');
    expect(parts).toContain('Gravitas Hail did not');
  });

  it('the guard catches a character knowing the secret and rewrites the reply once', async () => {
    const { chat } = await setup();
    await control({ story: '"Aye," says Gravitas. "Black iron key, slipped into your left boot. I noticed."', guardVerdicts: [[{ who: 'Gravitas Hail', fact: 1, quote: 'I noticed' }]] });
    const before = (await calls()).length;
    const ev = parseSse((await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: 'I ask the dwarf if he noticed what I put in my boot.' })).body);
    const done = ev.filter((e) => e.type === 'done');
    expect(done.length).toBe(2);
    const mine = (await calls()).slice(before);
    expect(mine.filter((x) => x.kind === 'guard')).toHaveLength(2);
    expect(mine.filter((x) => x.kind === 'story')).toHaveLength(2);
    const rewrite = mine.filter((x) => x.kind === 'story').pop();
    expect(JSON.stringify(rewrite.body)).toContain('Gravitas Hail cannot know');
    // Only one message (the same swipe was rewritten), and the guard's finding is on it.
    const msgs = (await c.req('GET', `/api/chats/${chat.id}/messages`)).json;
    expect(msgs[msgs.length - 1].swipes).toHaveLength(1);
  });

  it('flag mode records the finding without rewriting', async () => {
    const { chat } = await setup({ guard: 'flag' });
    await control({ story: '"Black iron key in your left boot," Gravitas says. "Saw it."', guardVerdicts: [[{ who: 'Gravitas Hail', fact: 1, quote: 'Saw it' }]] });
    const ev = parseSse((await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: 'I ask the dwarf what he saw.' })).body);
    expect(ev.filter((e) => e.type === 'done')).toHaveLength(1);
    const msgs = (await c.req('GET', `/api/chats/${chat.id}/messages`)).json;
    expect(msgs[msgs.length - 1].extra.echoGuard.violations[0].who).toBe('Gravitas Hail');
  });

  it('character-first: the addressed character answers from a history without the moment they missed', async () => {
    const { chat } = await setup({ characterFirst: true, guard: 'off' });
    const before = (await calls()).length;
    await control({ story: 'The dwarf scratches his beard.' });
    await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: 'I ask the dwarf whether he saw anything odd today.' });
    const mine = (await calls()).slice(before);
    const first = mine.find((x) => x.kind === 'charfirst');
    expect(first).toBeTruthy();
    expect(JSON.stringify(first.body)).not.toContain('black iron key');
    const story = mine.find((x) => x.kind === 'story');
    expect(JSON.stringify(story.body)).toContain("Gravitas Hail's response, decided from what Gravitas Hail knows");
    expect(JSON.stringify(story.body)).toContain("Didn't see a thing");
  });

  it('the ledger check asks for a payment the tracker missed', async () => {
    const { chat } = await setup({ guard: 'off' });
    const row = c.built.ctx.db.prepare('SELECT campaign_id FROM chats WHERE id = ?').get(chat.id) as { campaign_id: string };
    const money = () => JSON.parse((c.built.ctx.db.prepare('SELECT state FROM campaigns WHERE id = ?').get(row.campaign_id) as { state: string }).state).player.currency as number;
    const start = money();
    await control({ story: 'Mara buys the shortbow for 12 coins and slings it over her shoulder.', trackerOps: [{ type: 'item.add', name: 'Shortbow', qty: 1 }], ledgerOps: [{ type: 'currency.delta', amount: -12 }] });
    const done = parseSse((await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: 'I buy the bow.' })).body).find((e) => e.type === 'done');
    await waitFor(async () => ((await c.req('GET', `/api/calls?chatId=${chat.id}&messageId=${done.messageId}`)).json.some((x: any) => x.purpose === 'tracker (ledger)') ? true : null));
    await waitFor(async () => (money() === start - 12 ? true : null));
  });

  it('an unnamed person keeps what they were told, and it moves to the NPC once named', async () => {
    await c.req('POST', '/api/personas', { name: 'Mara', isDefault: true });
    const ch = await c.req('POST', '/api/characters', { card: { name: 'Narrator', first_mes: 'Hello.' } });
    const chat = (await c.req('POST', '/api/chats', { characterId: ch.json.id })).json;
    await c.req('PATCH', `/api/chats/${chat.id}/echo`, { profile: 'balanced', narration: 'persona', guard: 'off' });
    await control({ story: 'Mara whispers to the one-armed dwarf.', trackerOps: [{ type: 'location.move', to: 'Guild Hall' }], trackerEvents: [{ type: 'speech', actors: ['Mara'], to: ['the one-armed dwarf'], private: true, action: 'Mara whispered to the one-armed dwarf that she died on Earth' }], trackerMemories: [] });
    await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: 'I whisper to the dwarf.' });
    await waitFor(async () => ((await c.req('GET', `/api/chats/${chat.id}/echo`)).json.actors?.some((a: any) => a.id === 'anon:one_armed_dwarf') ? true : null));
    expect(JSON.stringify((await c.req('GET', `/api/chats/${chat.id}/echo/knowledge/anon:one_armed_dwarf`)).json.memories)).toContain('Earth');
    // Later he gets a name; his memory goes with him.
    await control({ story: 'The dwarf introduces himself as Gravitas Hail.', trackerOps: [{ type: 'npc.upsert', name: 'Gravitas Hail', appearance: 'A one-armed dwarf', location: 'Guild Hall' }], trackerEvents: [] });
    await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: 'Who are you?' });
    await waitFor(async () => ((await c.req('GET', `/api/chats/${chat.id}/echo`)).json.actors?.some((a: any) => a.name === 'Gravitas Hail') ? true : null));
    const st = (await c.req('GET', `/api/chats/${chat.id}/echo`)).json;
    const g = st.actors.find((a: any) => a.name === 'Gravitas Hail');
    expect(st.actors.some((a: any) => a.id === 'anon:one_armed_dwarf')).toBe(false);
    expect(JSON.stringify((await c.req('GET', `/api/chats/${chat.id}/echo/knowledge/${g.id}`)).json.memories)).toContain('Earth');
  });
});
