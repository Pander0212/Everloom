import { newEntry } from '@everloom/engine';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startMockLlm } from '../../../tests/mock-llm/server.js';
import { createClient, type TestClient } from './helpers.js';

let mock: Awaited<ReturnType<typeof startMockLlm>>;
let c: TestClient;
beforeAll(async () => {
  mock = await startMockLlm();
});
afterAll(async () => mock.close());
beforeEach(async () => {
  c = await createClient();
});
afterEach(async () => c?.close());

async function book() {
  const b = (await c.req('POST', '/api/lorebooks', { name: 'Northcrest' })).json;
  const full = (await c.req('GET', `/api/lorebooks/${b.id}`)).json;
  full.book.entries = { '0': newEntry(0, { comment: 'The Ravens', key: ['ravens'], content: 'A band.' }) };
  await c.req('PUT', `/api/lorebooks/${b.id}`, { name: 'Northcrest', scope: 'global', scopeId: null, book: full.book });
  return b.id as string;
}

describe('lorebook AI', () => {
  it('proposes entries without saving them, skipping ones the book already has', async () => {
    const id = await book();
    expect((await c.req('POST', `/api/lorebooks/${id}/generate`, { topic: 'harbor factions', count: 3 })).status).toBe(400); // no connection
    await c.req('POST', '/api/connections', { name: 'Mock', provider: 'openai', baseUrl: mock.url, model: 'mock-story', params: { max_tokens: 300, context_size: 8192 } });
    const r = (await c.req('POST', `/api/lorebooks/${id}/generate`, { topic: 'harbor factions', count: 3 })).json;
    expect(r.entries.map((e: any) => e.title)).toEqual(['Harbor Guild', 'Night Market', 'The Tide Bell']);
    expect(r.entries[0].keys).toEqual(['guild', 'harbor guild']);
    expect(Object.keys((await c.req('GET', `/api/lorebooks/${id}`)).json.book.entries)).toHaveLength(1); // nothing saved
    expect((await c.req('POST', `/api/lorebooks/${id}/generate`, { topic: 'x', count: 3 })).status).toBe(400);
    expect((await c.req('POST', `/api/lorebooks/${id}/generate`, { topic: 'harbor', count: 40 })).status).toBe(400);
  });

  it('writes or improves one entry, and logs both kinds of call', async () => {
    const id = await book();
    await c.req('POST', '/api/connections', { name: 'Mock', provider: 'openai', baseUrl: mock.url, model: 'mock-story', params: { max_tokens: 300, context_size: 8192 } });
    const r = (await c.req('POST', `/api/lorebooks/${id}/write-entry`, { entry: { comment: 'The Tide Bell', key: [], content: '' }, instruction: 'mention fog' })).json;
    expect(r).toEqual({ keys: ['tide bell', 'bell'], content: 'The Tide Bell hangs above the harbor mouth and rings by itself when a ship is lost. (mention fog)' });
    expect((await c.req('POST', `/api/lorebooks/${id}/write-entry`, { entry: {} })).status).toBe(400);
    await c.req('POST', `/api/lorebooks/${id}/generate`, { topic: 'harbor factions', count: 2 });
    const calls = (await c.req('GET', '/api/calls?limit=10')).json;
    const purposes = (calls.items ?? calls).map((x: any) => x.purpose);
    expect(purposes).toContain('lorebook entry');
    expect(purposes).toContain('lorebook entries');
  });
});
