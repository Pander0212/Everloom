import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startMockLlm } from '../../../tests/mock-llm/server.js';
import { createClient, type TestClient } from './helpers.js';

let c: TestClient | null = null;
let mock: Awaited<ReturnType<typeof startMockLlm>>;

beforeAll(async () => {
  mock = await startMockLlm();
});
afterAll(async () => mock.close());
beforeEach(async () => {
  await fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify({ reset: true }) });
});
afterEach(async () => {
  await c?.close();
  c = null;
});

async function setup() {
  c = await createClient();
  const llm = await c.req('POST', '/api/connections', { name: 'Mock', provider: 'openai', baseUrl: mock.url, model: 'mock-story' });
  const img = await c.req('POST', '/api/connections', { name: 'Img', provider: 'img-openai', baseUrl: mock.url, model: 'mock-image' });
  const tts = await c.req('POST', '/api/connections', { name: 'Voice', provider: 'tts-openai', baseUrl: mock.url, model: 'mock-tts', params: { voice: 'alloy' } });
  await c.req('PATCH', '/api/settings', { roles: { main: llm.json.id, image: img.json.id, tts: tts.json.id } });
  const ch = await c.req('POST', '/api/characters', { card: { name: 'Iris', description: 'A bartender with silver hair.' } });
  const chat = (await c.req('POST', '/api/chats', { characterId: ch.json.id })).json;
  return { client: c, chat, characterId: ch.json.id as string, imgConn: img.json.id as string };
}

describe('images and voice', () => {
  it('generates a portrait, an expression and a background and applies them', async () => {
    const { client, chat, characterId, imgConn } = await setup();
    const test = await client.req('POST', `/api/connections/${imgConn}/test`, {});
    expect(test.json.ok).toBe(true);
    const p = await client.req('POST', '/api/images/generate', { kind: 'portrait', characterId, apply: true });
    expect(p.status).toBe(200);
    expect(p.json.prompt).toContain('Iris');
    expect(p.json.prompt).toContain('silver hair');
    expect((await client.req('GET', `/api/characters/${characterId}`)).json.avatar).toContain(p.json.id);
    const e = await client.req('POST', '/api/images/generate', { kind: 'expression', characterId, emotion: 'joy', apply: true });
    expect(e.json.applied).toBe('expression:joy');
    expect((await client.req('GET', `/api/characters/${characterId}`)).json.game.expressions.joy).toBe(e.json.id);
    const bg = await client.req('POST', '/api/images/generate', { kind: 'background', chatId: chat.id, apply: true });
    expect(bg.json.prompt).toMatch(/weather/);
    expect((await client.req('GET', `/api/chats/${chat.id}`)).json.metadata.background).toBe(bg.json.id);
    const img = await client.req('GET', `/media/${bg.json.id}`);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toMatch(/^image\//);
  });

  it('refuses without an image connection and validates input', async () => {
    c = await createClient();
    expect((await c.req('POST', '/api/images/generate', { kind: 'portrait', prompt: 'x' })).status).toBe(400);
    expect((await c.req('POST', '/api/images/generate', { kind: 'nope' })).status).toBe(400);
  });

  it('speaks through the voice connection and lists voices', async () => {
    const { client } = await setup();
    const r = await client.req('POST', '/api/tts', { text: 'Hello there.' });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/^audio\//);
    const v = await client.req('GET', '/api/tts/voices');
    expect(v.json.voices.length).toBeGreaterThan(0);
  });
});

describe('phone, helper and diary', () => {
  it('writes waiting texts on open, replies to the player and feeds recent texts into the prompt', async () => {
    const { client, chat } = await setup();
    await client.req('POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'npc.upsert', name: 'Tobias' }, { type: 'phone.notify', npc: 'Tobias', reason: 'rehearsal news' }] });
    const st = (await client.req('GET', `/api/campaigns/${chat.campaignId}`)).json.state;
    const tobias = Object.values(st.npcs).find((n: any) => n.name === 'Tobias') as any;
    const threads = (await client.req('GET', `/api/campaigns/${chat.campaignId}/phone`)).json.threads;
    expect(threads[0]).toMatchObject({ npcId: tobias.id, unread: 1 });
    const open = await client.req('POST', `/api/campaigns/${chat.campaignId}/phone/${tobias.id}/open`, { chatId: chat.id });
    expect(open.json.messages).toHaveLength(1);
    expect(open.json.messages[0].fromPlayer).toBe(false);
    expect(open.json.state.phone.unread[tobias.id]).toBeUndefined();
    const sent = await client.req('POST', `/api/campaigns/${chat.campaignId}/phone/${tobias.id}`, { chatId: chat.id, text: 'Want to meet at the bar?' });
    expect(sent.json.reply.text).toContain('rehearsal');
    const prompt = await client.req('POST', `/api/chats/${chat.id}/prompt/preview`, {});
    expect(JSON.stringify(prompt.json)).toContain('Want to meet at the bar?');
  });

  it('helper proposes ops that apply only when accepted', async () => {
    const { client, chat } = await setup();
    const a = await client.req('POST', '/api/helper/ask', { chatId: chat.id, text: 'Can I have a potion?' });
    expect(a.json.status).toBe('pending');
    expect(a.json.proposal[0].type).toBe('item.add');
    let st = (await client.req('GET', `/api/campaigns/${chat.campaignId}`)).json.state;
    expect(Object.values(st.inventory)).toHaveLength(0);
    const ok = await client.req('POST', `/api/helper/${a.json.id}/accept`, { chatId: chat.id });
    expect(ok.json.status).toBe('accepted');
    st = (await client.req('GET', `/api/campaigns/${chat.campaignId}`)).json.state;
    expect(Object.values(st.inventory).map((i: any) => i.name)).toEqual(['Minor Healing Potion']);
    expect((await client.req('POST', `/api/helper/${a.json.id}/accept`, { chatId: chat.id })).status).toBe(409);
    const list = (await client.req('GET', '/api/helper')).json;
    expect(Array.isArray(list)).toBe(true);
  });

  it('drafts, saves, edits and searches diary entries', async () => {
    const { client, chat } = await setup();
    const d = await client.req('POST', `/api/campaigns/${chat.campaignId}/diary/draft`, { chatId: chat.id });
    expect(d.json.title).toBe('Rain and lanterns');
    const photo = await client.req('POST', '/api/images/generate', { kind: 'photo', prompt: 'A lantern-lit street at night' });
    const saved = await client.req('POST', `/api/campaigns/${chat.campaignId}/diary`, { title: d.json.title, content: { text: d.json.text, mood: d.json.mood, photos: [{ mediaId: photo.json.id, caption: 'Night walk' }], stickers: [{ icon: 'star', x: 10, y: 20 }] } });
    expect(saved.json.number).toBe(1);
    const upd = await client.req('PUT', `/api/diary/${saved.json.id}`, { title: 'Lanterns', content: { ...saved.json.content, text: 'Edited: I will sing.' } });
    expect(upd.json.title).toBe('Lanterns');
    const list = (await client.req('GET', `/api/campaigns/${chat.campaignId}/diary`)).json;
    expect(list).toHaveLength(1);
    expect((await client.req('PUT', `/api/diary/${saved.json.id}`, { title: 'x', content: { text: 'y', stickers: [{ icon: 'a', x: 500, y: 0 }] } })).status).toBe(400);
    expect((await client.req('DELETE', `/api/diary/${saved.json.id}`)).status).toBe(200);
  });
});

describe('media references', () => {
  it('deleting a picture clears the avatar, sprite and background that used it', async () => {
    const { client, chat, characterId } = await setup();
    const p = await client.req('POST', '/api/images/generate', { kind: 'portrait', characterId, apply: true });
    const e = await client.req('POST', '/api/images/generate', { kind: 'expression', characterId, emotion: 'joy', apply: true });
    await client.req('PATCH', `/api/chats/${chat.id}`, { metadata: { background: p.json.id } });
    await client.req('DELETE', `/api/media/${p.json.id}`);
    await client.req('DELETE', `/api/media/${e.json.id}`);
    const ch = (await client.req('GET', `/api/characters/${characterId}`)).json;
    expect(ch.avatar).toBeNull();
    expect(ch.game.expressions?.joy).toBeUndefined();
    expect((await client.req('GET', `/api/chats/${chat.id}`)).json.metadata.background).toBeUndefined();
    expect((await client.req('GET', `/media/${p.json.id}`)).status).toBe(404);
  });
});

describe('op ordering', () => {
  it("the player's edit on a message beats the model's bookkeeping that lands later", async () => {
    const { client } = await setup();
    const ch = await client.req('POST', '/api/characters', { card: { name: 'Tess', first_mes: 'Tess waves.' } });
    const chat = (await client.req('POST', '/api/chats', { characterId: ch.json.id })).json;
    const { appendOps, rebuildCampaign } = await import('../src/services/campaigns.js');
    const msgs = (await client.req('GET', `/api/chats/${chat.id}/messages`)).json;
    const last = msgs[msgs.length - 1];
    const owner = (client.built.ctx.db.prepare('SELECT id FROM users').get() as { id: string }).id;
    await client.req('POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'npc.upsert', name: 'Tobias', title: 'Drummer' }] });
    appendOps(client.built.ctx, owner, chat.campaignId, { chatId: chat.id, messageId: last.id, swipeId: last.swipeId, source: 'ai', ops: [{ type: 'npc.upsert', name: 'Tobias', title: 'Band leader' } as any] });
    const title = () => (Object.values(rebuildCampaign(client.built.ctx, owner, chat.campaignId).npcs)[0] as any).title;
    const live = (await client.req('GET', `/api/campaigns/${chat.campaignId}`)).json.state;
    expect((Object.values(live.npcs)[0] as any).title).toBe('Drummer');
    expect(title()).toBe('Drummer');
  });
});
