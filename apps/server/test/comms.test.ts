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

async function setup(style: 'fantasy' | 'modern' = 'modern') {
  c = await createClient();
  const llm = await c.req('POST', '/api/connections', { name: 'Mock', provider: 'openai', baseUrl: mock.url, model: 'mock-story' });
  await c.req('PATCH', '/api/settings', { roles: { main: llm.json.id } });
  const ch = await c.req('POST', '/api/characters', { card: { name: 'Iris' } });
  const chat = (await c.req('POST', '/api/chats', { characterId: ch.json.id, greeting: false })).json;
  const ops = (list: object[]) => c!.req('POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: list });
  await ops([{ type: 'meta.update', style }, { type: 'player.update', name: 'Anala' }, { type: 'npc.upsert', name: 'Mara Quill' }, { type: 'npc.upsert', name: 'Tobias' }]);
  const state = async () => (await c!.req('GET', `/api/campaigns/${chat.campaignId}`)).json.state;
  const purposes = async () => (await c!.req('GET', '/api/calls')).json.map((x: any) => x.purpose);
  return { client: c, chat, ops, state, purposes };
}

describe('letters and email', () => {
  it('a reply is queued by code and written in the sender’s voice when opened; the call is logged', async () => {
    const { client, chat, ops, state, purposes } = await setup();
    expect((await ops([{ type: 'mail.send', kind: 'email', to: 'Mara Quill', subject: 'The mill', body: 'Is it fixed?' }])).json.errors).toEqual([]);
    const sent = Object.values((await state()).mail)[0] as any;
    await ops([{ type: 'time.advance', minutes: sent.replyDue - (await state()).time.minutes }]);
    const reply = Object.values((await state()).mail).find((m: any) => m.direction === 'in') as any;
    expect(reply).toMatchObject({ subject: 'Re: The mill', pending: true, body: '' });
    const r = await client.req('POST', `/api/campaigns/${chat.campaignId}/mail/${reply.id}/open`, { chatId: chat.id });
    expect(r.json.error).toBeNull();
    expect(r.json.state.mail[reply.id]).toMatchObject({ pending: false, read: true });
    expect(r.json.state.mail[reply.id].body).toContain('The mill wheel turns again');
    expect(await purposes()).toContain('email');
    // Opening again doesn't call the model twice.
    const n = (await purposes()).length;
    await client.req('POST', `/api/campaigns/${chat.campaignId}/mail/${reply.id}/open`, { chatId: chat.id });
    expect((await purposes()).length).toBe(n);
  });

  it("can't open a letter before it arrives", async () => {
    const { client, chat, ops, state } = await setup('fantasy');
    await ops([{ type: 'mail.receive', from: 'Tobias', subject: 'Later' }]);
    const m = Object.values((await state()).mail)[0] as any;
    expect(m.deliverAt).toBeGreaterThan((await state()).time.minutes);
    expect((await client.req('POST', `/api/campaigns/${chat.campaignId}/mail/${m.id}/open`, { chatId: chat.id })).status).toBe(400);
  });
});

describe('groups, calls, feed, browser and apps', () => {
  it('group texts: the named member answers, the speaker is kept', async () => {
    const { client, chat, ops, state } = await setup();
    await ops([{ type: 'phone.group', name: 'Band', members: ['Mara Quill', 'Tobias'] }]);
    const gid = Object.keys((await state()).phone.groups)[0];
    const r = await client.req('POST', `/api/campaigns/${chat.campaignId}/phone-groups/${gid}`, { chatId: chat.id, text: 'Tobias, are we on tonight?' });
    const tobias = Object.values((await state()).npcs).find((n: any) => n.name === 'Tobias') as any;
    expect(r.json.reply.speakerId).toBe(tobias.id);
    const list = await client.req('GET', `/api/campaigns/${chat.campaignId}/phone`);
    expect(list.json.groups[0]).toMatchObject({ name: 'Band', members: ['Mara Quill', 'Tobias'] });
    expect(list.json.groups[0].last.speakerId).toBe(tobias.id);
  });

  it('a call runs turn by turn and hanging up spends game time', async () => {
    const { client, chat, state, purposes } = await setup();
    const npc = Object.values((await state()).npcs).find((n: any) => n.name === 'Mara Quill') as any;
    const first = await client.req('POST', `/api/campaigns/${chat.campaignId}/phone/${npc.id}/call`, { chatId: chat.id });
    expect(first.json.reply.text).toBe('Hey! Good to hear from you.');
    const next = await client.req('POST', `/api/campaigns/${chat.campaignId}/phone/${npc.id}/call`, { chatId: chat.id, text: 'Can you meet at noon?' });
    expect(next.json.said.kind).toBe('call');
    const t0 = (await state()).time.minutes;
    const end = await client.req('POST', `/api/campaigns/${chat.campaignId}/phone/${npc.id}/call/end`, { chatId: chat.id, exchanges: 2 });
    expect(end.json.state.time.minutes - t0).toBe(4);
    expect(await purposes()).toContain('phone call');
    // The call is remembered by the two people on it.
    const mem = (await client.req('GET', `/api/chats/${chat.id}/memory`)).json;
    const call = mem.items.find((m: any) => m.text.includes('talked on the phone'));
    expect(call.text).toContain('Can you meet at noon?');
    expect(call.witnesses.map((w: any) => w.id).sort()).toEqual([npc.id, 'player'].sort());
    // Hanging up again with nothing said adds no second memory.
    await client.req('POST', `/api/campaigns/${chat.campaignId}/phone/${npc.id}/call/end`, { chatId: chat.id, exchanges: 0 });
    expect((await client.req('GET', `/api/chats/${chat.id}/memory`)).json.items.filter((m: any) => m.text.includes('talked on the phone'))).toHaveLength(1);
  });

  it('feed refresh only accepts known authors; browser pages are cached; apps run', async () => {
    const { client, chat, ops, state, purposes } = await setup('fantasy');
    const r = await client.req('POST', `/api/campaigns/${chat.campaignId}/feed/refresh`, { chatId: chat.id });
    expect(r.json.added).toBe(1);
    expect((await state()).feed[0]).toMatchObject({ author: 'Mara Quill', text: 'Fresh bread at dawn, first come first served.' });
    const a = await client.req('POST', `/api/campaigns/${chat.campaignId}/browser`, { chatId: chat.id, query: 'the old mill' });
    expect(a.json).toMatchObject({ title: 'The Old Mill', sections: [{ heading: 'History' }, { heading: 'Today' }] });
    const n = (await purposes()).filter((p: string) => p === 'archive lookup').length;
    await client.req('POST', `/api/campaigns/${chat.campaignId}/browser`, { chatId: chat.id, query: 'The Old Mill' });
    expect((await purposes()).filter((p: string) => p === 'archive lookup').length).toBe(n);
    await ops([{ type: 'phone.app', name: 'Weather', prompt: 'A short forecast.' }]);
    const appId = Object.keys((await state()).phone.apps)[0];
    const run = await client.req('POST', `/api/campaigns/${chat.campaignId}/apps/${appId}/run`, { chatId: chat.id });
    expect(run.json.text).toMatch(/light rain/);
    expect(await purposes()).toEqual(expect.arrayContaining(['feed posts', 'archive lookup', 'app: Weather']));
  });
});
