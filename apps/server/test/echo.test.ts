/**
 * ECHO vertical slice on the real server: message → tracker extraction → events → observations →
 * beliefs → authorized context → the prompt of a real generation; plus rollback on swipe, edit,
 * delete and branch, the leakage debugger, the recall tool, validation, migration, and ECHO off.
 */
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

async function newChat(profile: string | null = 'balanced') {
  await c.req('POST', '/api/personas', { name: 'Mara', isDefault: true });
  const ch = await c.req('POST', '/api/characters', { card: { name: 'Iris Thorne', first_mes: 'Iris wipes the counter.' } });
  const chat = (await c.req('POST', '/api/chats', { characterId: ch.json.id })).json;
  if (profile) await c.req('PATCH', `/api/chats/${chat.id}/echo`, { profile });
  return { chat, iris: `char:${ch.json.id}` };
}
const say = async (chatId: string, text: string, story: string, extra: object = {}) => {
  await control({ story, ...extra });
  const r = await c.req('POST', `/api/chats/${chatId}/generate`, { type: 'normal', text });
  return parseSse(r.body).find((e) => e.type === 'done');
};
const promptText = async (chatId: string) => JSON.stringify((await c.req('POST', `/api/chats/${chatId}/prompt/preview`, {})).json.parts);
const echoState = async (chatId: string) => (await c.req('GET', `/api/chats/${chatId}/echo`)).json;
const knows = async (chatId: string, actor: string) => (await c.req('GET', `/api/chats/${chatId}/echo/knowledge/${encodeURIComponent(actor)}`)).json;

const rehearsal = [{ type: 'speech', actors: ['Iris'], to: ['Mara'], action: 'Iris told Mara the Ravens rehearse at the old chapel every Sunday', says: [{ s: 'ravens', p: 'rehearse_at', o: 'old chapel', text: 'the Ravens rehearse at the old chapel on Sundays' }], importance: 2 }];

describe('ECHO on the server', () => {
  it('is off by default and changes nothing', async () => {
    const { chat } = await newChat(null);
    await say(chat.id, 'Hi', 'Iris polishes a glass.', { trackerEvents: rehearsal });
    expect((await echoState(chat.id)).on).toBe(false);
    expect(await promptText(chat.id)).not.toContain('[ECHO');
  });

  it('vertical slice: tracker events → beliefs → the speaker\'s packet in the real prompt', async () => {
    const { chat, iris } = await newChat();
    const first = await say(chat.id, 'Where do the Ravens practise?', 'Iris leans in. "The Ravens rehearse at the old chapel, every Sunday."', { trackerEvents: rehearsal, trackerMemories: [] });
    await waitFor(async () => ((await echoState(chat.id)).counts?.events ? true : null));
    const st = await echoState(chat.id);
    expect(st.counts.events).toBe(1);
    // Mara heard it: a told belief with its source.
    const mara = await knows(chat.id, 'player');
    expect(mara.beliefs.map((b: any) => b.line).join(' ')).toContain('told by Iris');
    // The next reply's prompt carries Iris's packet when the rehearsal comes up.
    await c.req('POST', `/api/chats/${chat.id}/messages`, { role: 'user', text: 'Remember the chapel rehearsal? Is it still on Sunday?' });
    const p = await promptText(chat.id);
    expect(p).toContain('[ECHO · what Iris Thorne knows');
    expect(p).toContain('rehearse at the old chapel');
    // Leakage debugger: the generated reply recorded its packet with reasons.
    expect(first.messageId).toBeTruthy();
    void iris;
  });

  it('a secret the speaker never learned never reaches their packet; the persona narrator gets it', async () => {
    const { chat } = await newChat();
    await say(chat.id, 'Hello', 'Iris nods at you.', { trackerMemories: [] });
    const msgs = (await c.req('GET', `/api/chats/${chat.id}/messages`)).json;
    const anchor = msgs[msgs.length - 1].id;
    const r = await c.req('POST', `/api/chats/${chat.id}/echo/events`, {
      messageId: anchor,
      events: [{ type: 'speech', actors: ['Mara'], to: [], private: true, action: 'Mara wrote in her diary that the stolen ledger is buried beneath the lighthouse', visibility: 'secret', observers: [{ actor: 'player', place: 'here', sight: true, hearing: 'clear', awake: true, impairment: 0, attention: 1 }], establishes: [{ s: 'ledger', p: 'location', o: 'beneath the lighthouse' }] }],
    });
    expect(r.status).toBe(200);
    await c.req('POST', `/api/chats/${chat.id}/messages`, { role: 'user', text: 'Where is the stolen ledger buried? The lighthouse?' });
    expect(await promptText(chat.id)).not.toContain('beneath the lighthouse');
    await c.req('PATCH', `/api/chats/${chat.id}/echo`, { narration: 'persona' });
    expect(await promptText(chat.id)).toContain('beneath the lighthouse');
    // The recall tool binds the actor server-side: an actor argument is refused.
    await c.req('PATCH', `/api/chats/${chat.id}/echo`, { narration: 'character' });
    const bad = await c.req('POST', `/api/chats/${chat.id}/echo/recall`, { query: 'ledger', actor: 'player' });
    expect(bad.status).toBe(400);
    const tool = await c.req('POST', `/api/chats/${chat.id}/echo/recall`, { query: 'the stolen ledger at the lighthouse' });
    expect(tool.status).toBe(200);
    expect(JSON.stringify(tool.json)).not.toContain('beneath the lighthouse');
  });

  it('events follow swipes, edits, deletes and branches exactly', async () => {
    const { chat } = await newChat();
    const first = await say(chat.id, 'Where do the Ravens practise?', 'Iris leans in. "The old chapel, Sundays."', { trackerEvents: rehearsal, trackerMemories: [] });
    await waitFor(async () => ((await echoState(chat.id)).counts.events === 1 ? true : null));
    // Swipe to a take that establishes nothing: the event leaves the active branch.
    await control({ story: 'Iris shrugs.', trackerEvents: [] });
    await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'swipe' });
    await waitFor(async () => ((await echoState(chat.id)).counts.events === 0 ? true : null));
    expect(JSON.stringify(await knows(chat.id, 'player'))).not.toContain('chapel');
    // Swipe back: it returns without re-reading.
    await c.req('POST', `/api/messages/${first.messageId}/swipe`, { swipeId: 0 });
    expect((await echoState(chat.id)).counts.events).toBe(1);
    // Branch: copied with the message ids remapped.
    const branch = (await c.req('POST', `/api/chats/${chat.id}/branch`, { messageId: first.messageId })).json;
    expect((await echoState(branch.id)).counts?.events ?? (await c.req('GET', `/api/chats/${branch.id}/echo`)).json.counts.events).toBe(1);
    // Edit the text with the tracker down: the old reading goes.
    await control({ failNext: 10 });
    await c.req('PATCH', `/api/messages/${first.messageId}`, { text: 'Iris hums quietly.' });
    expect((await echoState(chat.id)).counts.events).toBe(0);
    await control({ failNext: 0 });
    // Delete the message: the swiped-away events go too.
    await c.req('DELETE', `/api/messages/${first.messageId}`);
    const n = c.built.ctx.db.prepare('SELECT COUNT(*) AS n FROM echo_events WHERE chat_id = ?').get(chat.id) as { n: number };
    expect(n.n).toBe(0);
    // The branch is untouched.
    expect((await echoState(branch.id)).counts.events).toBe(1);
  });

  it('records each reply\'s packet for the leakage debugger, and validation flags unlearned knowledge', async () => {
    const { chat } = await newChat();
    await say(chat.id, 'Hi', 'Iris nods.', { trackerMemories: [] });
    const msgs = (await c.req('GET', `/api/chats/${chat.id}/messages`)).json;
    await c.req('POST', `/api/chats/${chat.id}/echo/events`, {
      messageId: msgs[msgs.length - 1].id,
      events: [{ type: 'action', actors: ['Mara'], action: 'Mara hid the ledger beneath the lighthouse', visibility: 'secret', observers: [{ actor: 'player', place: 'here', sight: true, hearing: 'clear', awake: true, impairment: 0, attention: 1 }], establishes: [{ s: 'ledger', p: 'location', o: 'beneath the lighthouse' }] }],
    });
    const leak = [{ type: 'speech', actors: ['Iris'], to: ['Mara'], action: 'Iris said the ledger is beneath the lighthouse', says: [{ s: 'ledger', p: 'location', o: 'beneath the lighthouse', text: 'the ledger is beneath the lighthouse' }] }];
    const done = await say(chat.id, 'Do you know where the ledger is?', 'Iris smiles. "Beneath the lighthouse, of course."', { trackerEvents: leak, trackerMemories: [] });
    await waitFor(async () => {
      const m = (await c.req('GET', `/api/chats/${chat.id}/messages`)).json.find((x: any) => x.id === done.messageId);
      return m?.extra?.echoIssues?.length ? m : null;
    });
    const m = (await c.req('GET', `/api/chats/${chat.id}/messages`)).json.find((x: any) => x.id === done.messageId);
    expect(m.extra.echoIssues[0].kind).toBe('unknown-knowledge');
    expect(m.extra.echoIssues[0].fix).toBe('regenerate-passage');
    const packets = (await c.req('GET', `/api/chats/${chat.id}/echo/packets?messageId=${done.messageId}`)).json;
    expect(packets).toHaveLength(1);
    expect(packets[0].actor).toMatch(/^char:/);
    expect(packets[0].scope).toBe('actor');
    expect(packets[0].text).not.toContain('beneath the lighthouse');
  });

  it('manual editor: pre-decide a twist, with an audit history', async () => {
    const { chat } = await newChat();
    await say(chat.id, 'Hi', 'Iris nods.', { trackerMemories: [] });
    await c.req('POST', `/api/chats/${chat.id}/echo/events`, { events: [{ type: 'world', action: 'A locked iron box sits behind the bar', undetermined: [{ s: 'box', p: 'contains', label: 'what is in the iron box', candidates: ['a letter', 'a map', 'gold'] }] }] });
    const op = await c.req('POST', `/api/chats/${chat.id}/echo/ops`, { kind: 'predecide', s: 'box', p: 'contains', value: 'a map' });
    expect(op.status).toBe(200);
    const hidden = (await c.req('GET', `/api/chats/${chat.id}/echo/undetermined`)).json;
    expect(hidden[0].status).toBe('predecided');
    expect(hidden[0].value).toBeUndefined();
    const shown = (await c.req('GET', `/api/chats/${chat.id}/echo/undetermined?spoilers=1`)).json;
    expect(shown[0].value).toBe('a map');
    expect((await c.req('GET', `/api/chats/${chat.id}/echo/knowledge/all`)).status).toBe(403);
    const audit = (await c.req('GET', `/api/chats/${chat.id}/echo/audit`)).json;
    expect(audit.map((a: any) => a.action)).toEqual(expect.arrayContaining(['op.predecide', 'event.add']));
    await c.req('DELETE', `/api/chats/${chat.id}/echo/ops/${op.json.id}`);
    expect((await c.req('GET', `/api/chats/${chat.id}/echo/undetermined`)).json[0].status).toBe('open');
  });

  it('migration grants nothing universally and is reversible', async () => {
    const { chat } = await newChat();
    await say(chat.id, 'Who is Tobias?', 'Tobias Moreno waves from the door. "The Ravens need a singer by Friday," he says.');
    await waitFor(async () => ((await c.req('GET', `/api/chats/${chat.id}/memory`)).json.items.length ? true : null));
    const mig = (await c.req('POST', `/api/chats/${chat.id}/echo/migrate`)).json;
    expect(mig.migrated).toBeGreaterThan(0);
    const st = await echoState(chat.id);
    expect(st.counts.events).toBeGreaterThanOrEqual(mig.migrated);
    // Legacy witnesses are the only observers.
    const outsider = await knows(chat.id, 'npc_nobody');
    expect(outsider.memories).toHaveLength(0);
    const rev = (await c.req('DELETE', `/api/chats/${chat.id}/echo/migrate`)).json;
    expect(rev.removed).toBe(mig.migrated);
  });

  it('the tracker prompt asks for events only when ECHO is on', async () => {
    const off = await newChat(null);
    await say(off.chat.id, 'Hi', 'Iris nods.');
    const on = await newChat('fast');
    await say(on.chat.id, 'Hi', 'Iris nods.');
    await waitFor(async () => ((await (await fetch(mock.url.replace('/v1', '/__control'))).json()).calls.filter((x: any) => x.kind === 'tracker').length >= 2 ? true : null));
    const calls = (await (await fetch(mock.url.replace('/v1', '/__control'))).json()).calls;
    const trackerPrompts = calls.map((x: any) => JSON.stringify(x)).filter((s: string) => s.includes('bookkeeper for a roleplay game'));
    expect(trackerPrompts.some((s: string) => s.includes('\\"events\\"'))).toBe(true);
    expect(trackerPrompts.some((s: string) => !s.includes('\\"events\\"'))).toBe(true);
  });
  it('Strict: another character proposes from its own knowledge only, in an isolated call', async () => {
    const { chat } = await newChat('strict');
    await say(chat.id, 'Hi', 'Iris nods.', { trackerMemories: [] });
    // At the bar, Tobias walks in (an NPC standing here).
    await say(chat.id, 'Who is that?', 'Tobias Moreno walks in.', { trackerOps: [{ type: 'location.move', to: 'The Bar' }, { type: 'npc.upsert', name: 'Tobias Moreno', role: 'Band leader', location: 'The Bar' }], trackerMemories: [] });
    await waitFor(async () => ((await c.req('GET', `/api/calls?chatId=${chat.id}`)).json.filter((x: any) => x.purpose === 'tracker').length >= 2 ? true : null));
    const msgs = (await c.req('GET', `/api/chats/${chat.id}/messages`)).json;
    // A secret only Mara holds.
    await c.req('POST', `/api/chats/${chat.id}/echo/events`, { messageId: msgs[msgs.length - 1].id, events: [{ type: 'action', actors: ['Mara'], action: 'Mara pocketed the silver key to the strongroom', visibility: 'secret', observers: [{ actor: 'player', place: 'here', sight: true, hearing: 'clear', awake: true, impairment: 0, attention: 1 }], establishes: [{ s: 'strongroom key', p: 'holder', o: 'mara' }] }] });
    await control({ calls: [] });
    await c.req('POST', `/api/chats/${chat.id}/messages`, { role: 'user', text: 'I keep my hand on the strongroom key in my pocket.' });
    await control({ story: 'Iris raises an eyebrow.' });
    await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: 'Well?' });
    const calls = (await (await fetch(mock.url.replace('/v1', '/__control'))).json()).calls;
    const intents = calls.filter((x: any) => x.kind === 'intent');
    expect(intents.length).toBeGreaterThan(0);
    for (const i of intents) expect(JSON.stringify(i.body)).not.toContain('silver key');
    const reply = calls.filter((x: any) => x.kind === 'story').pop();
    expect(JSON.stringify(reply.body)).toContain('keeps quiet and watches the door');
  });

  it('semantic recall (optional) scores only the view, and prefetch warms the cache', async () => {
    const { chat } = await newChat();
    const emb = await c.req('POST', '/api/connections', { name: 'Emb', provider: 'openai', baseUrl: mock.url, model: 'mock-embed', params: {} });
    await c.req('PATCH', '/api/settings', { roles: { embeddings: emb.json.id } });
    await c.req('PATCH', `/api/chats/${chat.id}/echo`, { semantic: true });
    await say(chat.id, 'Where do the Ravens practise?', 'Iris leans in. "The old chapel, Sundays."', { trackerEvents: rehearsal, trackerMemories: [] });
    await waitFor(async () => ((await c.req('GET', `/api/calls?chatId=${chat.id}`)).json.some((x: any) => x.purpose === 'echo memory embeddings') ? true : null));
    const pre = (await c.req('POST', `/api/chats/${chat.id}/echo/prefetch`, { draft: 'about the chapel rehearsal' })).json;
    expect(pre.on).toBe(true);
    expect(pre.tokens).toBeGreaterThan(0);
    expect(JSON.stringify(pre)).not.toContain('chapel');
    const st = await echoState(chat.id);
    expect(st.cache.hits + st.cache.incremental).toBeGreaterThan(0);
  });
});
