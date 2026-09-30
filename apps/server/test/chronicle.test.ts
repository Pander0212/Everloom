import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startMockLlm } from '../../../tests/mock-llm/server.js';
import { runChronicler, runConsolidation, chronicleStatus } from '../src/services/chronicle.js';
import { insertMemory, loadMemoryState, scopeOf } from '../src/services/mem.js';
import { createClient, parseSse, waitFor, type TestClient } from './helpers.js';

let mock: Awaited<ReturnType<typeof startMockLlm>>;
let c: TestClient;
const control = (body: object) => fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify(body) });

beforeAll(async () => {
  mock = await startMockLlm();
});
afterAll(async () => mock.close());
beforeEach(async () => {
  await control({ reset: true });
  c = await createClient();
  const conn = await c.req('POST', '/api/connections', { name: 'Mock', provider: 'openai', baseUrl: mock.url, model: 'mock-story', params: { max_tokens: 300, context_size: 8192 } });
  await c.req('PATCH', '/api/settings', { roles: { main: conn.json.id } });
  await c.req('POST', '/api/personas', { name: 'Anala', isDefault: true });
});
afterEach(async () => c?.close());

const owner = () => (c.built.ctx.db.prepare('SELECT id FROM users').get() as { id: string }).id;
const memory = async (chatId: string) => (await c.req('GET', `/api/chats/${chatId}/memory`)).json;
async function plainChat() {
  const ch = await c.req('POST', '/api/characters', { card: { name: 'Iris Thorne', first_mes: 'Iris wipes the counter.' } });
  const chat = (await c.req('POST', '/api/chats', { characterId: ch.json.id, campaign: 'none' })).json;
  expect(chat.campaignId).toBeFalsy();
  return chat;
}
async function turns(chatId: string, n: number, story = 'Iris polishes a glass.') {
  await control({ story });
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await c.req('POST', `/api/chats/${chatId}/generate`, { type: 'normal', text: `Line ${i}` });
    const done = parseSse(r.body).find((e) => e.type === 'done');
    if (!done) throw new Error('no done: ' + r.body.slice(0, 300));
    ids.push(done.messageId);
  }
  return ids;
}

describe('chronicler', () => {
  it('reads plain chats in batches, never twice, and holds its place through failures and swipes', async () => {
    const chat = await plainChat();
    await turns(chat.id, 5);
    const ctx = c.built.ctx;
    // A failed call writes nothing and does not move the watermark.
    await control({ failNext: 10 });
    expect((await runChronicler(ctx, owner(), chat.id)).ok).toBe(false);
    expect(chronicleStatus(ctx, owner(), chat.id).watermark).toBe(0);
    // Garbage output is a failure too.
    await control({ failNext: 0, chronicle: 'I would rather not.' });
    expect((await runChronicler(ctx, owner(), chat.id)).ok).toBe(false);
    expect(chronicleStatus(ctx, owner(), chat.id).watermark).toBe(0);
    await control({ chronicle: null });
    const r = await runChronicler(ctx, owner(), chat.id);
    expect(r).toMatchObject({ ok: true, memories: 1 });
    const w = chronicleStatus(ctx, owner(), chat.id).watermark;
    expect(w).toBe(7); // 11 messages, newest four left for later
    let m = await memory(chat.id);
    expect(m.items.map((x: any) => [x.text, x.source])).toEqual([['Anala and Iris talked quietly at the bar.', 'chronicle']]);
    expect(m.summaries.map((s: any) => s.text)).toEqual(['Anala spent the evening at the bar with Iris.']);
    // Nothing new: no call.
    const calls = () => (ctx.db.prepare("SELECT COUNT(*) AS n FROM llm_calls WHERE purpose = 'chronicler'").get() as { n: number }).n;
    const before = calls();
    expect((await runChronicler(ctx, owner(), chat.id)).ok).toBe(false);
    expect(calls()).toBe(before);
    // The prompt for the next run starts after the watermark.
    await turns(chat.id, 3, 'Tobias Moreno walks in.');
    await control({ calls: [] });
    expect((await runChronicler(ctx, owner(), chat.id)).ok).toBe(true);
    const sent = ((await (await fetch(mock.url.replace('/v1', '/__control'))).json()) as any).calls.find((x: any) => x.kind === 'chronicle');
    const userMsg = sent.body.messages.find((x: any) => x.role === 'user').content as string;
    expect(userMsg).not.toContain('Line 2'); // already read
    expect(userMsg).toContain('Line 4');
    m = await memory(chat.id);
    expect(m.items.map((x: any) => x.text)).toContain('Tobias asked Anala to sing for the Ravens.');
    // Deleting the message the second run ended on takes its memories back and rewinds the watermark.
    const run2 = JSON.parse((ctx.db.prepare('SELECT runs FROM chronicle_state WHERE chat_id = ?').get(chat.id) as any).runs).at(-1);
    await c.req('DELETE', `/api/messages/${run2.messageId}`);
    expect(chronicleStatus(ctx, owner(), chat.id).watermark).toBe(w);
    m = await memory(chat.id);
    expect(m.items.map((x: any) => x.text)).toEqual(['Anala and Iris talked quietly at the bar.']);
  });

  it('runs on the turn number set in settings and logs a background call', async () => {
    await c.req('PATCH', '/api/settings', { world: { chronicleEvery: 3 } });
    expect((await c.req('GET', '/api/settings')).json.world.profile).toBe('custom');
    const chat = await plainChat();
    await turns(chat.id, 6);
    const calls = await waitFor(async () => {
      const x = (await c.req('GET', `/api/calls?chatId=${chat.id}`)).json.filter((k: any) => k.purpose === 'chronicler');
      return x.length ? x : null;
    });
    expect(calls[0].role).toBe('background');
    expect((await memory(chat.id)).items.length).toBeGreaterThan(0);
  });

  it('"update memory now" reads everything, even the newest messages', async () => {
    const chat = await plainChat();
    await turns(chat.id, 2);
    const r = (await c.req('POST', `/api/chats/${chat.id}/summarize`, { force: true })).json;
    expect(r.ok).toBe(true);
    expect(chronicleStatus(c.built.ctx, owner(), chat.id).watermark).toBe(5);
  });
});

describe('consolidation', () => {
  it('folds cold scenes safely, writes day summaries, keeps milestones, and unfolds when a beat goes', async () => {
    const ch = await c.req('POST', '/api/characters', { card: { name: 'Iris Thorne', first_mes: 'Iris wipes the counter.' } });
    const chat = (await c.req('POST', '/api/chats', { characterId: ch.json.id })).json;
    const ctx = c.built.ctx;
    const o = owner();
    const scope = scopeOf(chat);
    await c.req('POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'location.upsert', name: 'The Lantern', kind: 'shop' }, { type: 'location.upsert', name: 'Market', kind: 'market' }, { type: 'location.move', to: 'The Lantern' }] });
    const st = (await c.req('GET', `/api/campaigns/${chat.campaignId}`)).json.state;
    const lantern = Object.values(st.locations).find((l: any) => l.name === 'The Lantern') as any;
    const ids = await turns(chat.id, 1);
    await new Promise((r) => setTimeout(r, 300)); // let the turn's tracker pass finish
    const beat = (text: string, t: number, extra: object = {}) =>
      insertMemory(ctx, o, scope, { chatId: chat.id, messageId: ids[0], swipeId: 0 }, 'chronicle', { text, participants: [], witnesses: ['player', 'char:x'], locationId: lantern.id, gameTime: t, importance: 1, secret: false, ...extra });
    beat('Iris poured iced lemon tea', 60);
    beat('Tobias arrived late from rehearsal', 70);
    beat('Bram died defending the gate', 80, { importance: 3 });
    beat('Iris told Anala where the key is', 90, { secret: true, witnesses: ['player'] });
    // Move on: next day at the market, so the Lantern scene and day one are finished.
    await c.req('POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'location.move', to: 'Market' }, { type: 'time.advance', minutes: 1500 }] });
    const r = await runConsolidation(ctx, o, chat.id, { useModel: true });
    expect(r).toMatchObject({ ok: true, scenes: 1, days: 1, usedModel: true });
    let mem = loadMemoryState(ctx, o, scope);
    expect(mem.scenes).toHaveLength(1);
    const scene = mem.scenes[0];
    expect(scene.text).toContain('In short: Iris poured iced lemon tea');
    expect(scene.text).toContain('Bram died defending the gate'); // the milestone is carried
    expect(scene.importance).toBe(3);
    // The secret beat (different witnesses) is not folded in; the folded beats stay recallable.
    expect(mem.all.filter((m) => m.foldedInto === scene.id).map((m) => m.text).sort()).toEqual(['Bram died defending the gate', 'Iris poured iced lemon tea', 'Tobias arrived late from rehearsal']);
    expect(mem.items.map((m) => m.text)).toContain('Tobias arrived late from rehearsal');
    // The day summary covers the day's beats and the scene, so the recap shows the day alone.
    expect(mem.summaries.map((s) => s.level)).toEqual(['day']);
    expect(mem.summaries[0].covers).toContain(scene.id);
    // Consolidation is idempotent.
    expect(await runConsolidation(ctx, o, chat.id, { useModel: true })).toMatchObject({ scenes: 0, days: 0 });
    // Permanently losing a folded beat drops the scene and its day summary; the rest unfold.
    const tobias = mem.all.find((m) => m.text.startsWith('Tobias'))!;
    await c.req('DELETE', `/api/memory/items/${tobias.id}`);
    mem = loadMemoryState(ctx, o, scope);
    expect(mem.scenes).toEqual([]);
    expect(mem.items.map((m) => m.text)).toEqual(expect.arrayContaining(['Iris poured iced lemon tea', 'Bram died defending the gate']));
    expect(mem.summaries).toEqual([]);
    // Two beats left is too few for a scene, but the day is still summarized, in plain text without the model.
    const r2 = await runConsolidation(ctx, o, chat.id, { useModel: false });
    expect(r2).toMatchObject({ scenes: 0, days: 1, usedModel: false });
    expect(loadMemoryState(ctx, o, scope).summaries[0].text).toContain('Bram died defending the gate');
  });
});
