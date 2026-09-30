import { afterEach, describe, expect, it } from 'vitest';
import { createClient, type TestClient } from './helpers.js';

let c: TestClient | null = null;
afterEach(async () => {
  await c?.close();
  c = null;
});

async function story() {
  c = await createClient();
  const ch = (await c.req('POST', '/api/characters', { card: { name: 'Iris', first_mes: 'Welcome to the Lantern.' } })).json;
  const chat = (await c.req('POST', '/api/chats', { characterId: ch.id })).json;
  await c.req('POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'location.upsert', name: 'Lantern Row', level: 'local', kind: 'district' }, { type: 'location.move', to: 'Lantern Row' }, { type: 'item.add', name: 'Brass Key' }] });
  return { client: c, chat };
}

describe('save slots', () => {
  it('saves a snapshot, stays hidden from the chat list, and loading forks it (the save never changes)', async () => {
    const { client, chat } = await story();
    const slot = (await client.req('POST', `/api/chats/${chat.id}/slots`, { name: 'Before the vault' })).json;
    expect(slot).toMatchObject({ name: 'Before the vault', summary: { location: 'Lantern Row', messages: 1, last: 'Welcome to the Lantern.' } });
    expect((await client.req('GET', '/api/chats')).json.map((x: any) => x.id)).toEqual([chat.id]);

    // The story moves on: the key is lost.
    await client.req('POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'item.remove', name: 'Brass Key' }] });
    const loaded = (await client.req('POST', `/api/slots/${slot.id}/load`)).json;
    expect(loaded.id).not.toBe(chat.id);
    expect(loaded.title).toContain('from Before the vault');
    const state = (await client.req('GET', `/api/campaigns/${loaded.campaignId}`)).json.state;
    expect(Object.values(state.inventory).map((i: any) => i.name)).toContain('Brass Key');
    // Playing on in the loaded game doesn't touch the save; loading again gives the key back again.
    await client.req('POST', `/api/campaigns/${loaded.campaignId}/ops`, { chatId: loaded.id, ops: [{ type: 'item.remove', name: 'Brass Key' }] });
    const again = (await client.req('POST', `/api/slots/${slot.id}/load`)).json;
    expect(Object.values((await client.req('GET', `/api/campaigns/${again.campaignId}`)).json.state.inventory).map((i: any) => i.name)).toContain('Brass Key');
    // All of them are the same story: the save shows from every branch.
    expect((await client.req('GET', `/api/chats/${again.id}/slots`)).json.map((s: any) => s.id)).toEqual([slot.id]);
    expect((await client.req('GET', '/api/chats')).json).toHaveLength(3);
  });

  it('rename and delete', async () => {
    const { client, chat } = await story();
    const slot = (await client.req('POST', `/api/chats/${chat.id}/slots`, {})).json;
    expect(slot.name).toBe('Save 1');
    expect((await client.req('PATCH', `/api/slots/${slot.id}`, { name: 'Quick' })).json.name).toBe('Quick');
    await client.req('DELETE', `/api/slots/${slot.id}`);
    expect((await client.req('GET', `/api/chats/${chat.id}/slots`)).json).toEqual([]);
    expect((await client.req('POST', `/api/slots/${slot.id}/load`)).status).toBe(404);
  });
});

describe('diagnostics', () => {
  it('reports the app and data, and the debug bundle has no keys, tokens or story text', async () => {
    const { client } = await story();
    await client.req('POST', '/api/connections', { name: 'Main', provider: 'openai', baseUrl: 'https://api.example.com/v1?key=sk-abcdefghijklmnop', model: 'm', apiKey: 'sk-supersecretvalue123456', params: { headers: { Authorization: 'Bearer abcdefghijklmnopqrstuvwxyz' } } });
    await client.req('PUT', '/api/sources/chub/token', { token: 'chub-secret-token-xyz' });
    await client.req('POST', '/api/bridge/devices', { label: 'Laptop' });
    const d = (await client.req('GET', '/api/diagnostics')).json;
    expect(d.app.version).toBeTruthy();
    expect(d.database).toMatchObject({ characters: 1, chats: 1 });
    expect(d.connections[0]).toMatchObject({ name: 'Main', endpoint: 'https://api.example.com', hasKey: true });
    const r = await client.req('POST', '/api/diagnostics/bundle', { client: { userAgent: 'test', note: 'my key is sk-leakedleakedleaked' } });
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="everloom-debug-/);
    const text = r.body;
    for (const secret of ['sk-supersecretvalue123456', 'sk-abcdefghijklmnop', 'abcdefghijklmnopqrstuvwxyz', 'chub-secret-token-xyz', 'sk-leakedleakedleaked', 'evb_', 'Welcome to the Lantern']) expect(text).not.toContain(secret);
    const j = JSON.parse(text);
    expect(j.kind).toBe('everloom-debug-bundle');
    expect(j.client.userAgent).toBe('test');
  });
});
