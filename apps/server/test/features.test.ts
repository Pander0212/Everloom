/**
 * Feature switches: Classic chat makes exactly one model call per reply with a SillyTavern-style
 * prompt, a chat can override the global choice both ways, nothing is deleted when a module is off,
 * and the tracker only offers (and accepts) the enabled modules' ops.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startMockLlm } from '../../../tests/mock-llm/server.js';
import { settleBackground } from '../src/services/chronicle.js';
import { createClient, parseSse, type TestClient } from './helpers.js';

let mock: Awaited<ReturnType<typeof startMockLlm>>;
beforeAll(async () => {
  mock = await startMockLlm();
});
afterAll(async () => mock.close());

let c: TestClient;
beforeEach(async () => {
  c = await createClient();
  await fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify({ reset: true }) });
  const conn = await c.req('POST', '/api/connections', { name: 'Mock', provider: 'openai', baseUrl: mock.url, model: 'mock-story', params: { max_tokens: 200, context_size: 8192 } });
  const emb = await c.req('POST', '/api/connections', { name: 'Embed', provider: 'openai', baseUrl: mock.url, model: 'mock-embed', kind: 'embeddings' });
  await c.req('PATCH', '/api/settings', { roles: { main: conn.json.id, embeddings: emb.json.id }, world: { profile: 'max' } });
  await c.req('POST', '/api/personas', { name: 'Anala', description: 'A travelling archivist.', isDefault: true });
});
afterEach(async () => c?.close());

async function character() {
  const ch = await c.req('POST', '/api/characters', { card: { name: 'Iris Thorne', description: 'Iris runs the Lantern bar.', mes_example: '<START>\n{{char}}: "Rain again."', first_mes: 'Iris wipes the counter.' } });
  return ch.json.id as string;
}
async function play(chatId: string, turns: number) {
  for (let i = 1; i <= turns; i++) {
    const r = await c.req('POST', `/api/chats/${chatId}/generate`, { type: 'normal', text: `I ask about the rain (${i}).` });
    expect(parseSse(r.body).some((e) => e.type === 'done')).toBe(true);
    await settleBackground(chatId);
    await new Promise((res) => setTimeout(res, 30));
  }
}
const calls = (chatId: string) => c.built.ctx.db.prepare('SELECT purpose FROM llm_calls WHERE chat_id = ? OR chat_id IS NULL').all(chatId).map((r: any) => r.purpose as string);

describe('Classic chat', () => {
  it('one model call per reply, no game, and a SillyTavern-style prompt', async () => {
    const s = (await c.req('PATCH', '/api/settings', { features: { preset: 'classic' } })).json;
    expect(s.features).toMatchObject({ preset: 'classic', set: { memory: 'off', on: { game: false, trackers: false, stage: false, sources: true } } });
    const chat = (await c.req('POST', '/api/chats', { characterId: await character() })).json;
    expect(chat.campaignId).toBeNull();
    await c.req('PATCH', `/api/chats/${chat.id}`, { metadata: { authorsNote: { content: 'Keep it short.', depth: 2, role: 'system' } } });
    await play(chat.id, 12);
    const list = calls(chat.id);
    expect(list.filter((p) => p === 'reply')).toHaveLength(12);
    expect(list).toHaveLength(12); // nothing else: no tracker, memory, embeddings, pre-read or off-screen life
    const prompt = (await c.req('POST', `/api/chats/${chat.id}/prompt/preview`, {})).json;
    const text = JSON.stringify(prompt.parts);
    expect(text).toContain('Iris runs the Lantern bar.');
    expect(text).toContain('A travelling archivist.');
    expect(text).toContain('Rain again.');
    expect(text).toContain('Keep it short.');
    expect(text).not.toMatch(/World state rules|Game state|Story so far|<everloom>/);
    expect(prompt.scene).toBeNull();
  }, 60_000);

  it('a chat can be Classic under Full RPG, and Full RPG under Classic', async () => {
    const id = await character();
    const classic = (await c.req('POST', '/api/chats', { characterId: id, features: 'classic', campaign: 'new' })).json;
    expect(classic.metadata.features).toBe('classic');
    await play(classic.id, 3);
    expect(calls(classic.id)).toEqual(['reply', 'reply', 'reply']);

    await c.req('PATCH', '/api/settings', { features: { preset: 'classic' } });
    const full = (await c.req('POST', '/api/chats', { characterId: id, features: 'full' })).json;
    expect(full.campaignId).toBeTruthy();
    await play(full.id, 2);
    expect(calls(full.id)).toContain('tracker');
    expect(calls(full.id)).toContain('pre-read');
  }, 60_000);

  it("a character's default mode is used for its new chats", async () => {
    const id = await character();
    await c.req('PATCH', `/api/characters/${id}`, { game: { chatMode: 'classic' } });
    const chat = (await c.req('POST', '/api/chats', { characterId: id })).json;
    expect(chat.metadata.features).toBe('classic');
    expect(chat.campaignId).toBeNull();
  });
});

describe('switching modules', () => {
  it('turning the game off keeps its data; turning it on brings it back', async () => {
    const chat = (await c.req('POST', '/api/chats', { characterId: await character() })).json;
    await c.req('POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'item.add', name: 'Brass Key', qty: 1 }] });
    await c.req('PATCH', '/api/settings', { features: { set: { on: { game: false } } } });
    const off = (await c.req('GET', '/api/settings')).json.features;
    expect(off.preset).toBe('custom');
    expect(off.set.on).toMatchObject({ game: false, inventory: false, travel: false, battle: false, trackerPass: false });
    const prompt = (await c.req('POST', `/api/chats/${chat.id}/prompt/preview`, {})).json;
    expect(JSON.stringify(prompt.parts)).not.toContain('Brass Key');
    // The data is all still there.
    const camp = (await c.req('GET', `/api/campaigns/${chat.campaignId}`)).json;
    expect(Object.values(camp.state.inventory).map((i: any) => i.name)).toContain('Brass Key');
    await c.req('PATCH', '/api/settings', { features: { preset: 'full' } });
    const back = (await c.req('POST', `/api/chats/${chat.id}/prompt/preview`, {})).json;
    expect(JSON.stringify(back.parts)).toContain('Brass Key');
  });

  it('the tracker is offered and accepts only enabled modules', async () => {
    await c.req('PATCH', '/api/settings', { features: { set: { on: { inventory: false } } } });
    const chat = (await c.req('POST', '/api/chats', { characterId: await character() })).json;
    // The model proposes an item anyway; with inventory off it must be refused.
    await fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify({ trackerOps: [{ type: 'item.add', name: 'Brass Key', qty: 1 }, { type: 'time.advance', minutes: 15 }] }) });
    await play(chat.id, 1);
    const control = (await (await fetch(mock.url.replace('/v1', '/__control'))).json()) as { calls: Array<{ body: { messages?: Array<{ content: string }> } }> };
    const tracker = control.calls.map((x) => x.body?.messages?.[0]?.content ?? '').find((t) => t.startsWith('You are the bookkeeper'));
    expect(tracker).toBeTruthy();
    expect(tracker).not.toContain('"type":"item.add"');
    expect(tracker).toContain('"type":"time.advance"');
    const camp = (await c.req('GET', `/api/campaigns/${chat.campaignId}`)).json;
    expect(Object.values(camp.state.inventory).map((i: any) => i.name)).not.toContain('Brass Key');
    expect(camp.state.time.minutes).toBeGreaterThan(0);
  }, 30_000);
});
