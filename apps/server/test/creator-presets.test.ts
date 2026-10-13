import { afterEach, expect, it } from 'vitest';
import { createClient, type TestClient } from './helpers.js';
let c: TestClient | undefined;
afterEach(async () => { await c?.close(); });
it('stores typed presets without transient image references and removes them', async () => {
  c = await createClient();
  const result = await c.req('POST', '/api/creator-presets', { name: 'Blue outfit', kind: 'outfit', spec: { clothes: [{ template: 'tshirt', color: '#123456', texture: 'local-picture' }] } });
  expect(result.status).toBe(200);
  expect(result.json.spec.clothes[0]).toMatchObject({ color: '#123456', texture: null });
  expect((await c.req('GET', '/api/creator-presets')).json).toHaveLength(1);
  expect((await c.req('POST', '/api/creator-presets', { name: 'Bad', kind: 'outfit', spec: { body: { age: 5 } } })).status).toBe(400);
  await c.req('DELETE', `/api/creator-presets/${result.json.id}`);
  expect((await c.req('GET', '/api/creator-presets')).json).toEqual([]);
});
