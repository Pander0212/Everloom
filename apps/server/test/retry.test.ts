/** Rate limits are retried before anything arrives (live: NanoGPT allows 60 requests a minute). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockLlm } from '../../../tests/mock-llm/server.js';
import { retryDelay } from '../src/llm/providers.js';
import { createClient, parseSse } from './helpers.js';

let mock: Awaited<ReturnType<typeof startMockLlm>>;
beforeAll(async () => {
  mock = await startMockLlm();
});
afterAll(async () => mock.close());

describe('provider retries', () => {
  it('which errors wait and for how long', () => {
    expect(retryDelay(new Error('Upstream 429: Too many requests. Please slow down'), 0)).toBeGreaterThanOrEqual(2000);
    expect(retryDelay(new Error('Upstream 429: Rate limit exceeded. Try again in 12 seconds.'), 0)).toBeGreaterThanOrEqual(12000);
    expect(retryDelay(new Error('Upstream 429: Subscription text requests are limited to 60 per minute.'), 1)).toBeGreaterThanOrEqual(4000);
    expect(retryDelay(new Error('Upstream 429: This API key is set to subscription-only billing and cannot spend'), 0)).toBeNull();
    expect(retryDelay(new Error('Upstream 400: Your prompt exceeds the maximum context length'), 0)).toBeNull();
    expect(retryDelay(new Error('Upstream 429: Too many requests'), 4)).toBeNull();
  });

  it('a reply survives a rate limit', async () => {
    const c = await createClient();
    try {
      const conn = await c.req('POST', '/api/connections', { name: 'Mock', provider: 'openai', baseUrl: mock.url, model: 'mock-story', params: { max_tokens: 100, context_size: 4096 } });
      await c.req('PATCH', '/api/settings', { roles: { main: conn.json.id } });
      const ch = await c.req('POST', '/api/characters', { card: { name: 'Iris', first_mes: 'Hi.' } });
      const chat = (await c.req('POST', '/api/chats', { characterId: ch.json.id })).json;
      await fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify({ reset: true }) });
      await fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify({ rateLimitNext: 1, story: 'Iris smiles.' }) });
      const ev = parseSse((await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: 'Hello' })).body);
      expect(ev.find((e) => e.type === 'error')).toBeUndefined();
      expect(ev.find((e) => e.type === 'done')?.message?.swipes?.[0]?.text).toContain('Iris smiles');
    } finally {
      await c.close();
    }
  }, 20_000);
});
