import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { startMockLlm } from '../../../tests/mock-llm/server.js';
import { settleBackground } from '../src/services/chronicle.js';
import { runThreadSeeding } from '../src/services/worldsim.js';
import { createClient, parseSse, waitFor, type TestClient } from './helpers.js';

let mock: Awaited<ReturnType<typeof startMockLlm>>;
let c: TestClient;
const control = (b: object) => fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify(b) });
beforeAll(async () => {
  mock = await startMockLlm();
});
afterAll(async () => mock.close());
beforeEach(async () => {
  await control({ reset: true });
  c = await createClient();
  const conn = await c.req('POST', '/api/connections', { name: 'Mock', provider: 'openai', baseUrl: mock.url, model: 'mock-story', params: { max_tokens: 200, context_size: 8192 } });
  await c.req('PATCH', '/api/settings', { roles: { main: conn.json.id } });
  await c.req('POST', '/api/personas', { name: 'Anala', isDefault: true });
});
afterEach(async () => c?.close());

async function setup() {
  const ch = await c.req('POST', '/api/characters', { card: { name: 'Iris Thorne', first_mes: 'Iris wipes the counter.' } });
  const chat = (await c.req('POST', '/api/chats', { characterId: ch.json.id })).json;
  await c.req('POST', `/api/campaigns/${chat.campaignId}/ops`, {
    chatId: chat.id,
    ops: [
      { type: 'location.upsert', name: 'The Lantern', kind: 'building' },
      { type: 'location.upsert', name: 'Market Square', kind: 'district' },
      { type: 'location.upsert', name: 'Old Pier', kind: 'district' },
      { type: 'location.move', to: 'The Lantern' },
      { type: 'npc.upsert', name: 'Bram', location: 'Old Pier' },
      { type: 'npc.upsert', name: 'Tobias Moreno', location: 'Old Pier' },
    ],
  });
  return chat;
}
const state = async (chat: any) => (await c.req('GET', `/api/campaigns/${chat.campaignId}`)).json.state;
const say = async (chat: any, text: string) => parseSse((await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text })).body).find((e) => e.type === 'done');
const whereAmI = async (chat: any) => {
  const s = await state(chat);
  return s.locations[s.currentLocationId].name;
};

it('moves before the reply, keeps the move across swipes, and drops it when the message is edited', async () => {
  const chat = await setup();
  await control({ story: 'The market is loud and bright.' });
  const done = await say(chat, 'I head to Market Square.');
  expect(await whereAmI(chat)).toBe('Market Square');
  const scene = (await c.req('GET', `/api/chats/${chat.id}/scene`)).json.text as string;
  expect(scene.split('## LOCATION')[1]).toContain('Market Square');
  await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'swipe' });
  expect(await whereAmI(chat)).toBe('Market Square');
  // Editing my message to something else takes the move back.
  const msgs = (await c.req('GET', `/api/chats/${chat.id}/messages`)).json;
  const mine = msgs.filter((m: any) => m.role === 'user').at(-1);
  await c.req('PATCH', `/api/messages/${mine.id}`, { text: 'I stay and order tea.' });
  expect(await whereAmI(chat)).toBe('The Lantern');
  expect(done).toBeTruthy();
});

it('max immersion reads my message once; a swipe replays its check instead of asking again', async () => {
  await c.req('PATCH', '/api/settings', { world: { profile: 'max' } });
  const chat = await setup();
  await control({ story: 'You spin across the floor.' });
  await say(chat, 'I dance on the table.');
  const reads = async () => (await c.req('GET', `/api/calls?chatId=${chat.id}`)).json.filter((x: any) => x.purpose === 'pre-read');
  expect(await reads()).toHaveLength(1);
  expect((await reads())[0].role).toBe('utility');
  const dice = async () => ((await c.req('GET', `/api/chats/${chat.id}/scene`)).json.text as string).split('## THE DICE')[1]?.split('\n## ')[0];
  const first = await dice();
  expect(first).toContain('Agility check (hard');
  await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'swipe' });
  expect(await dice()).toBe(first);
  expect(await reads()).toHaveLength(1);
});

it('off-screen life: a background beat between two people elsewhere, undone by a swipe', async () => {
  await c.req('PATCH', '/api/settings', { world: { social: true, socialEvery: 1 } });
  const chat = await setup();
  await control({ story: 'Iris hums.' });
  const done = await say(chat, 'I sit down.');
  await waitFor(async () => ((await state(chat)).bonds && Object.keys((await state(chat)).bonds).length ? true : null));
  await settleBackground(chat.id);
  const calls = (await c.req('GET', `/api/calls?chatId=${chat.id}`)).json.filter((x: any) => x.purpose === 'off-screen life');
  expect(calls[0].role).toBe('background');
  const s = await state(chat);
  expect(Object.values(s.bonds).map((b: any) => b.affinity)).toEqual(expect.arrayContaining([3, 2]));
  const mem = (await c.req('GET', `/api/chats/${chat.id}/memory`)).json.items;
  const beat = mem.find((m: any) => m.source === 'sim');
  expect(beat.text).toMatch(/shared a quiet drink/);
  // Only the two of them saw it.
  expect(beat.witnesses.map((w: any) => w.name).sort()).toEqual(['Bram', 'Tobias Moreno']);
  await control({ story: 'Rain.' });
  await c.req('PATCH', '/api/settings', { world: { social: false } });
  await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'swipe' });
  expect(Object.keys((await state(chat)).bonds)).toEqual([]);
  await c.req('POST', `/api/messages/${done.messageId}/swipe`, { swipeId: 0 });
  expect(Object.keys((await state(chat)).bonds)).toHaveLength(2);
});

it('seeds a storyline in the background when fewer than two run', async () => {
  const chat = await setup();
  await say(chat, 'Hello.');
  const owner = (c.built.ctx.db.prepare('SELECT id FROM users').get() as { id: string }).id;
  expect(await runThreadSeeding(c.built.ctx, owner, chat.id, 15)).toBe(true);
  const s = await state(chat);
  const t = Object.values(s.threads)[0] as any;
  expect(t.text).toMatch(/Smugglers/);
  expect(t.bornTurn).toBe(15);
  expect(t.stages).toHaveLength(4);
});

it('imports a world from a lorebook: proposals first, then only what the owner keeps', async () => {
  const chat = await setup();
  const book = (await c.req('POST', '/api/lorebooks', { name: 'Northcrest', book: { entries: { 0: { uid: 0, key: ['Lantern'], content: 'The Lantern is a small bar on Market Row.', comment: 'The Lantern' } } } })).json;
  const r = (await c.req('POST', `/api/chats/${chat.id}/world-import`, { lorebookId: book.id, includeCard: true })).json;
  expect(r.proposals.map((p: any) => p.kind)).toEqual(expect.arrayContaining(['place', 'person', 'group', 'fact']));
  // Nothing applied yet.
  expect(Object.values((await state(chat)).orgs)).toEqual([]);
  const keep = r.proposals.filter((p: any) => p.kind !== 'person').map((p: any) => p.op);
  const a = (await c.req('POST', `/api/chats/${chat.id}/world-import/apply`, { ops: keep })).json;
  expect(a.applied).toBe(keep.length);
  const s = await state(chat);
  expect(Object.values(s.locations).map((l: any) => l.name)).toContain('Northcrest');
  expect(Object.values(s.orgs).map((o: any) => o.name)).toContain('The Ravens');
  const calls = (await c.req('GET', `/api/calls?chatId=${chat.id}`)).json;
  expect(calls.find((x: any) => x.purpose === 'world import').role).toBe('utility');
});
