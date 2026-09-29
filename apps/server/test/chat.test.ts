import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startMockLlm } from '../../../tests/mock-llm/server.js';
import { createClient, parseSse, waitFor, type TestClient } from './helpers.js';

let mock: Awaited<ReturnType<typeof startMockLlm>>;
let c: TestClient;
beforeAll(async () => {
  mock = await startMockLlm();
});
afterAll(async () => mock.close());
beforeEach(async () => {
  await fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify({ reset: true }) });
  c = await createClient();
  const conn = await c.req('POST', '/api/connections', { name: 'Mock', provider: 'openai', baseUrl: mock.url, model: 'mock-story', params: { max_tokens: 300, context_size: 8192 } });
  await c.req('PATCH', '/api/settings', { roles: { main: conn.json.id } });
});
afterEach(async () => c?.close());

async function setupChat() {
  const png = readFileSync(path.resolve(__dirname, '../../../tests/fixtures/st/Seraphina.png'));
  const ch = await c.req('POST', '/api/characters/import', png, { 'content-type': 'image/png' });
  await c.req('POST', '/api/personas', { name: 'Anala', description: 'A traveling singer.' });
  const chat = await c.req('POST', '/api/chats', { characterId: ch.json.id });
  return { character: ch.json, chat: chat.json };
}

const state = async (campaignId: string) => (await c.req('GET', `/api/campaigns/${campaignId}`)).json.state;
const items = (s: any) => Object.values(s.inventory).map((i: any) => `${i.name}:${i.qty}`).sort();

describe('chat flow with streaming, tracker and rollback', () => {
  it('generates, tracks, swipes, edits, deletes and branches with correct state', async () => {
    const { chat } = await setupChat();
    expect(chat.messageCount).toBe(1);
    const t0 = (await state(chat.campaignId)).time.minutes;

    // 1. Send a message → streamed reply → tracker adds tea and advances time.
    const gen = await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: 'Hello! Could I get something cold?' });
    const events = parseSse(gen.body);
    expect(events.map((e) => e.type)).toContain('user');
    expect(events.filter((e) => e.type === 'delta').length).toBeGreaterThan(5);
    const done = events.find((e) => e.type === 'done');
    expect(done.message.swipes[0].text).toContain('Iced lemon tea');
    const replyId = done.messageId;
    const s1 = await waitFor(async () => {
      const s = await state(chat.campaignId);
      return Object.keys(s.inventory).length ? s : null;
    });
    expect(items(s1)).toEqual(['Iced Lemon Tea:1']);
    expect(s1.time.minutes).toBe(t0 + 20);
    const msgs1 = (await c.req('GET', `/api/chats/${chat.id}/messages`)).json;
    expect(msgs1.at(-1).swipes[0].changes).toContain('+1 Iced Lemon Tea');

    // 2. Swipe: new take mentions Tobias instead of tea → tea is rolled back, NPC appears.
    await fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify({ story: 'Tobias Moreno waves from the door. "Evening!"' }) });
    const sw = await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'swipe' });
    expect(parseSse(sw.body).find((e) => e.type === 'done').swipeId).toBe(1);
    const s2 = await waitFor(async () => {
      const s = await state(chat.campaignId);
      return Object.keys(s.npcs).length ? s : null;
    });
    expect(items(s2)).toEqual([]);
    expect(Object.values(s2.npcs).map((n: any) => n.name)).toEqual(['Tobias Moreno']);
    expect(s2.time.minutes).toBe(t0 + 20);

    // 3. Swipe back to the first take → tea returns, NPC gone.
    await c.req('POST', `/api/messages/${replyId}/swipe`, { swipeId: 0 });
    const s3 = await state(chat.campaignId);
    expect(items(s3)).toEqual(['Iced Lemon Tea:1']);
    // The first take mentions "Tobias" too, so that NPC exists — but not the full-name upgrade from take 2.
    expect(Object.values(s3.npcs).map((n: any) => n.name)).toEqual(['Tobias']);

    // 4. A manual (user) op survives swipes.
    const opRes = await c.req('POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'item.use', name: 'Iced Lemon Tea' }] });
    expect(opRes.status).toBe(200);
    expect(opRes.json.summary).toContain('−1 Iced Lemon Tea');

    // 5. Edit the reply: its AI ops are replaced by a fresh tracker pass on the new text.
    await fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify({ story: null }) });
    await c.req('PATCH', `/api/messages/${replyId}`, { text: 'Iris hands you a plate. Nothing else happens.' });
    const s5 = await waitFor(async () => {
      const s = await state(chat.campaignId);
      return Object.keys(s.relationships).length ? s : null;
    });
    // The tea from the original take is gone; the user's "use tea" op now fails on replay and does nothing.
    expect(items(s5)).toEqual([]);

    // 6. Branch from the greeting → fresh campaign state without later changes.
    const msgs = (await c.req('GET', `/api/chats/${chat.id}/messages`)).json;
    const branch = await c.req('POST', `/api/chats/${chat.id}/branch`, { messageId: msgs[0].id });
    expect(branch.status).toBe(200);
    expect(branch.json.messageCount).toBe(1);
    expect(branch.json.campaignId).not.toBe(chat.campaignId);
    const sb = await state(branch.json.campaignId);
    expect(sb.time.minutes).toBe(t0);
    expect(items(sb)).toEqual([]);

    // 7. Delete the reply → its ops disappear, the user's op re-anchors to the previous message.
    await c.req('DELETE', `/api/messages/${replyId}`);
    const s7 = await state(chat.campaignId);
    expect(s7.time.minutes).toBe(t0);
    expect(Object.keys(s7.relationships)).toEqual([]);
    const log = (await c.req('GET', `/api/campaigns/${chat.campaignId}/log`)).json;
    expect(log.some((e: any) => e.source === 'user')).toBe(true);
    expect(log.some((e: any) => e.source === 'ai')).toBe(false);
  });

  it('handles messy and broken tracker JSON', async () => {
    const { chat } = await setupChat();
    await fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify({ trackerMode: 'messy' }) });
    await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: 'Hi' });
    await waitFor(async () => Object.keys((await state(chat.campaignId)).inventory).length > 0);
    await fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify({ trackerMode: 'broken-once' }) });
    const t = (await state(chat.campaignId)).time.minutes;
    await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: 'Another?' });
    const s = await waitFor(async () => {
      const st = await state(chat.campaignId);
      return st.time.minutes > t ? st : null;
    });
    expect(items(s)).toEqual(['Iced Lemon Tea:2']);
    await fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify({ trackerMode: 'garbage' }) });
    const r = await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: 'And now?' });
    expect(parseSse(r.body).find((e) => e.type === 'done')).toBeTruthy();
  });

  it('surfaces upstream errors and keeps data intact', async () => {
    const { chat } = await setupChat();
    await fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify({ failNext: 1 }) });
    const r = await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: 'Hello?' });
    const ev = parseSse(r.body);
    expect(ev.find((e) => e.type === 'error').error).toMatch(/Mock upstream failure/);
    const msgs = (await c.req('GET', `/api/chats/${chat.id}/messages`)).json;
    expect(msgs.map((m: any) => m.role)).toEqual(['assistant', 'user']);
  });

  it('continue appends, impersonate does not save, inspector shows blocks', async () => {
    const { chat } = await setupChat();
    await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: 'Hi' });
    const before = (await c.req('GET', `/api/chats/${chat.id}/messages`)).json.at(-1).swipes[0].text;
    await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'continue' });
    const after = (await c.req('GET', `/api/chats/${chat.id}/messages`)).json.at(-1).swipes[0].text;
    expect(after.startsWith(before)).toBe(true);
    expect(after.length).toBeGreaterThan(before.length);
    const count = (await c.req('GET', `/api/chats/${chat.id}/messages`)).json.length;
    const imp = await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'impersonate' });
    expect(parseSse(imp.body).find((e) => e.type === 'done').text.length).toBeGreaterThan(5);
    expect((await c.req('GET', `/api/chats/${chat.id}/messages`)).json.length).toBe(count);
    const last = await c.req('GET', `/api/chats/${chat.id}/prompt`);
    expect(last.json.parts.some((p: any) => p.blockId === 'charDescription')).toBe(true);
    const preview = await c.req('POST', `/api/chats/${chat.id}/prompt/preview`, {});
    expect(preview.json.parts.some((p: any) => p.blockId === 'gameState')).toBe(true);
    expect(preview.json.totalTokens).toBeGreaterThan(50);
  });

  it('exports and re-imports SillyTavern JSONL with swipes', async () => {
    const { chat, character } = await setupChat();
    await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: 'Hi' });
    await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'swipe' });
    const exp = await c.req('GET', `/api/chats/${chat.id}/export`);
    const lines = exp.body.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).toHaveProperty('user_name', 'Anala');
    expect(lines[0]).toHaveProperty('character_name', 'Seraphina');
    expect(lines.at(-1).swipes).toHaveLength(2);
    expect(lines.at(-1).swipe_id).toBe(1);
    const imp = await c.req('POST', `/api/chats/import?characterId=${character.id}`, Buffer.from(exp.body), { 'content-type': 'application/jsonl' });
    expect(imp.status).toBe(200);
    const msgs = (await c.req('GET', `/api/chats/${imp.json.id}/messages`)).json;
    expect(msgs).toHaveLength(lines.length - 1);
    expect(msgs.at(-1).swipes).toHaveLength(2);
    expect(msgs.at(-1).swipeId).toBe(1);
  });

  it('stop aborts a slow stream and keeps partial text', async () => {
    const { chat } = await setupChat();
    await fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify({ delayMs: 60 }) });
    const p = c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: 'Tell me a long story' });
    await new Promise((r) => setTimeout(r, 400));
    const stop = await c.req('POST', `/api/chats/${chat.id}/stop`, {});
    expect(stop.json.stopped).toBe(true);
    const r = await p;
    const done = parseSse(r.body).find((e) => e.type === 'done');
    expect(done.message.swipes[0].text.length).toBeGreaterThan(0);
    expect(done.message.swipes[0].text.length).toBeLessThan(200);
  });
});
