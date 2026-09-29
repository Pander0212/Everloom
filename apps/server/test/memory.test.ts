import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startMockLlm } from '../../../tests/mock-llm/server.js';
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
});
afterEach(async () => c?.close());

async function newChat() {
  await c.req('POST', '/api/personas', { name: 'Anala', isDefault: true });
  const ch = await c.req('POST', '/api/characters', { card: { name: 'Iris Thorne', first_mes: 'Iris wipes the counter.' } });
  return (await c.req('POST', '/api/chats', { characterId: ch.json.id })).json;
}
const memory = async (chatId: string) => (await c.req('GET', `/api/chats/${chatId}/memory`)).json;
const texts = async (chatId: string) => (await memory(chatId)).items.map((m: any) => m.text);
const say = async (chatId: string, text: string, story: string, extra: object = {}) => {
  await control({ story, ...extra });
  const r = await c.req('POST', `/api/chats/${chatId}/generate`, { type: 'normal', text });
  return parseSse(r.body).find((e) => e.type === 'done');
};

describe('memory v2', () => {
  it('writes memories from the tracker pass and recalls them into the scene block', async () => {
    const chat = await newChat();
    await say(chat.id, 'Who is Tobias?', 'Tobias Moreno waves from the door. "The Ravens need a singer by Friday," he says.');
    await waitFor(async () => ((await texts(chat.id)).length ? true : null));
    expect(await texts(chat.id)).toEqual(['Tobias said the Ravens need a singer by Friday.']);
    // Talking about the band again recalls it.
    await c.req('POST', `/api/chats/${chat.id}/messages`, { role: 'user', text: 'So about the Ravens and that singer...' });
    const scene = (await c.req('GET', `/api/chats/${chat.id}/scene?fresh=1`)).json;
    expect(scene.text).toContain('## STORY SO FAR');
    expect(scene.text).toContain('Tobias said the Ravens need a singer by Friday.');
    // The narrator contract rides along with the block.
    const prompt = (await c.req('POST', `/api/chats/${chat.id}/prompt/preview`, {})).json;
    expect(JSON.stringify(prompt.parts)).toContain('How to use the WORLD STATE block');
    // Every model call is logged with its purpose.
    const calls = (await c.req('GET', `/api/calls?chatId=${chat.id}`)).json;
    expect(calls.map((x: any) => x.purpose)).toEqual(expect.arrayContaining(['reply', 'tracker']));
    const reply = calls.find((x: any) => x.purpose === 'reply');
    expect(reply.firstTokenMs).toBeGreaterThanOrEqual(0);
  });

  it('memory follows swipes, edits and deletes exactly', async () => {
    const chat = await newChat();
    const first = await say(chat.id, 'Hi', 'Tobias Moreno waves from the door.');
    await waitFor(async () => ((await texts(chat.id)).length ? true : null));
    // Swipe to a take without Tobias: his memory goes.
    await control({ story: 'Iris polishes a glass in silence.' });
    await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'swipe' });
    await waitFor(async () => ((await memory(chat.id)).items.length === 0 ? true : null));
    // Swipe back: it returns, without re-tracking.
    await c.req('POST', `/api/messages/${first.messageId}/swipe`, { swipeId: 0 });
    expect(await texts(chat.id)).toEqual(['Tobias said the Ravens need a singer by Friday.']);
    // Edit the text while the tracker is down: the old reading must still be gone.
    await control({ failNext: 10 });
    await c.req('PATCH', `/api/messages/${first.messageId}`, { text: 'Iris hums quietly.' });
    await new Promise((r) => setTimeout(r, 300));
    expect(await texts(chat.id)).toEqual([]);
    // Edit again with a working tracker: the new text is tracked.
    await control({ failNext: 0, trackerMemories: [{ text: 'Iris admitted she used to sing with the Ravens.', about: ['Iris'], importance: 3 }] });
    await c.req('PATCH', `/api/messages/${first.messageId}`, { text: 'Iris sighs. "I used to sing with the Ravens, you know."' });
    await waitFor(async () => ((await texts(chat.id)).includes('Iris admitted she used to sing with the Ravens.') ? true : null));
    expect(await texts(chat.id)).toEqual(['Iris admitted she used to sing with the Ravens.']);
    // Branch: the memory is copied into the branch; deleting the message clears the original.
    const branch = (await c.req('POST', `/api/chats/${chat.id}/branch`, { messageId: first.messageId })).json;
    expect(await texts(branch.id)).toEqual(['Iris admitted she used to sing with the Ravens.']);
    await c.req('DELETE', `/api/messages/${first.messageId}`);
    expect(await texts(chat.id)).toEqual([]);
    expect(await texts(branch.id)).toEqual(['Iris admitted she used to sing with the Ravens.']);
    const left = c.built.ctx.db.prepare('SELECT COUNT(*) AS n FROM mem_items WHERE message_id = ?').get(first.messageId) as { n: number };
    expect(left.n).toBe(0);
  });

  it('versions facts: supersedes on a shown change, raises conflicts, and rejects ungrounded ones', async () => {
    const chat = await newChat();
    const fact = (value: string, changed: boolean, about = 'Tobias') => ({ trackerMemories: [], trackerFacts: [{ about, key: 'rank', value, text: `Tobias is a ${value}`, changed }] });
    await say(chat.id, 'Tell me about Tobias', 'Tobias Moreno is a squire of the river guard.', fact('squire', false));
    await waitFor(async () => ((await memory(chat.id)).facts.length ? true : null));
    await say(chat.id, 'And now?', 'At dawn Tobias Moreno was knighted on the bridge.', fact('knight', true));
    await waitFor(async () => ((await memory(chat.id)).facts.length === 2 ? true : null));
    let m = await memory(chat.id);
    expect(m.facts.find((f: any) => f.value === 'knight').status).toBe('active');
    expect(m.facts.find((f: any) => f.value === 'squire').status).toBe('superseded');
    // A different claim with no change shown: a conflict for the player, not a silent overwrite.
    await say(chat.id, 'Really?', 'Someone says Tobias Moreno is a baron.', fact('baron', false));
    m = await waitFor(async () => {
      const x = await memory(chat.id);
      return x.conflicts.length ? x : null;
    });
    expect(m.conflicts[0].claim.value).toBe('baron');
    expect(m.conflicts[0].against.value).toBe('knight');
    // The scene block only states current facts.
    const scene = (await c.req('GET', `/api/chats/${chat.id}/scene?fresh=1`)).json.text;
    expect(scene).not.toContain('squire');
    await c.req('POST', `/api/memory/facts/${m.conflicts[0].claim.id}/resolve`, { choice: 'keep-old' });
    m = await memory(chat.id);
    expect(m.conflicts).toEqual([]);
    expect(m.facts.find((f: any) => f.value === 'baron').status).toBe('retracted');
    // Firewall: a world fact the turn never mentions is rejected.
    await say(chat.id, 'Hm', 'Iris pours more tea.', { trackerMemories: [], trackerFacts: [{ about: 'world', key: 'war', value: 'the northern empire invaded', text: 'The northern empire invaded', changed: false }] });
    await new Promise((r) => setTimeout(r, 400));
    expect((await memory(chat.id)).facts.map((f: any) => f.value)).not.toContain('the northern empire invaded');
  });

  it('scopes knowledge per character in the scene block', async () => {
    const chat = await newChat();
    await c.req('POST', `/api/campaigns/${chat.campaignId}/ops`, {
      chatId: chat.id,
      ops: [
        { type: 'location.upsert', name: 'The Lantern', kind: 'shop' },
        { type: 'location.move', to: 'The Lantern' },
        { type: 'npc.upsert', name: 'Tobias Moreno', location: 'The Lantern' },
        { type: 'npc.upsert', name: 'Bram', role: 'Innkeeper', location: 'The Lantern' },
      ],
    });
    const st = (await c.req('GET', `/api/campaigns/${chat.campaignId}`)).json.state;
    const tobias = Object.values(st.npcs).find((n: any) => n.name === 'Tobias Moreno') as any;
    await c.req('POST', `/api/chats/${chat.id}/memory`, { text: 'Kael stole the brass key from the cellar.', about: [], witnesses: ['player', tobias.id], importance: 2 });
    await c.req('POST', `/api/chats/${chat.id}/messages`, { role: 'user', text: 'Does anyone know where the brass key went?' });
    const scene = (await c.req('GET', `/api/chats/${chat.id}/scene?fresh=1`)).json.text as string;
    const present = scene.split('## PRESENT')[1].split('\n## ')[0];
    const tobiasPart = present.split('- Tobias Moreno')[1].split('\n- ')[0];
    const bramPart = present.split('- Bram')[1].split('\n- ')[0];
    expect(tobiasPart).toContain('KNOWS (was there): Kael stole the brass key');
    expect(bramPart).not.toContain('KNOWS (was there): Kael');
    expect(bramPart).toContain('DOES NOT KNOW: Kael stole the brass key');
    // "Why was this recalled?"
    const item = (await memory(chat.id)).items[0];
    const why = (await c.req('GET', `/api/chats/${chat.id}/memory/why/${item.id}`)).json;
    expect(why.score.lexical).toBeGreaterThan(0);
    expect(why.knownBy.find((k: any) => k.name === 'Bram').knowledge).toBeNull();
    expect(why.knownBy.find((k: any) => k.name === 'Tobias Moreno').knowledge).toBe('witnessed');
  });
});
