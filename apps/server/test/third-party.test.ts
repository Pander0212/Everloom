import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { createClient, type TestClient } from './helpers.js';

let c: TestClient | null = null;
afterEach(async () => {
  await c?.close();
  c = null;
});

const report = { source: 'Unity package', imported: [], approximated: [], skipped: [], license: [], thirdParty: true, guessed: [] };

describe('third-party avatars', () => {
  it('stay out of library exports until the owner confirms the right to share', async () => {
    c = await createClient();
    const own = (await c.req('POST', '/api/avatars/code', { name: 'Own', recipe: {} })).json;
    const bought = (await c.req('POST', '/api/avatars/code', { name: 'Bought', recipe: {} })).json;
    const cfg = (await c.req('GET', `/api/avatars/${bought.id}`)).json.config;
    expect((await c.req('PATCH', `/api/avatars/${bought.id}`, { config: { ...cfg, importReport: report } })).status).toBe(200);
    const files = async () => Object.keys(unzipSync(new Uint8Array((await c!.req('POST', '/api/assets3d/export', { keys: [`model:${own.id}`, `model:${bought.id}`] })).raw)));
    expect(await files()).toContain('avatars/Own/avatar.json');
    expect(await files()).not.toContain('avatars/Bought/avatar.json');
    // Confirmed: it goes along.
    await c.req('PATCH', `/api/avatars/${bought.id}`, { config: { ...cfg, importReport: { ...report, rightsConfirmed: true } } });
    expect(await files()).toContain('avatars/Bought/avatar.json');
  });
});
