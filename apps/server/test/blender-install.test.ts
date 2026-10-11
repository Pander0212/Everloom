import { afterEach, describe, expect, it } from 'vitest';
import { createClient, type TestClient } from './helpers.js';

let c: TestClient | null = null;
afterEach(async () => {
  await c?.close();
  c = null;
});

describe('the headless Blender converter', () => {
  it('says what this server can run before installing anything', async () => {
    c = await createClient();
    const r = (await c.req('GET', '/api/blender/install')).json;
    expect(r.version).toMatch(/^4\.2\./);
    expect(r.state.state).toBe('idle');
    expect(typeof r.check.freeDiskGb).toBe('number');
    expect(r.check.ok).toBe(r.check.reasons.length === 0);
  });
});

describe.skipIf(!process.env.EVERLOOM_TEST_BLENDER_INSTALL)('the real install (downloads Blender, EVERLOOM_TEST_BLENDER_INSTALL=1)', () => {
  it('downloads, checks, unpacks and finds Blender, then removes it', async () => {
    c = await createClient();
    const before = (await c.req('GET', '/api/blender/install')).json;
    if (!before.check.ok) return;
    expect((await c.req('POST', '/api/blender/install')).status).toBe(200);
    let s = before.state;
    for (let i = 0; i < 600 && !['done', 'failed'].includes(s.state); i++) {
      await new Promise((r) => setTimeout(r, 1000));
      s = (await c.req('GET', '/api/blender/install')).json.state;
    }
    expect(s, s.error ?? '').toMatchObject({ state: 'done' });
    const found = (await c.req('GET', '/api/blender?refresh=1')).json;
    expect(found).toMatchObject({ found: true, source: 'data' });
    expect(found.version).toMatch(/^4\.2/);
    expect((await c.req('DELETE', '/api/blender/install')).status).toBe(200);
  }, 700_000);
});
