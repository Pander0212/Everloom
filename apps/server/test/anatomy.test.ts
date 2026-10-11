/** The anatomy pack (services/avatars/anatomy.ts): installed from a zip like any pack, no unlock. */
import { strToU8, zipSync } from 'fflate';
import sharp from 'sharp';
import { afterEach, expect, it } from 'vitest';
import { createClient, type TestClient } from './helpers.js';

let c: TestClient | null = null;
afterEach(async () => { await c?.close(); c = null; });

async function pack(vertices: number, extra: Record<string, Uint8Array> = {}, manifest?: unknown) {
  const png = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 4, background: '#808080' } }).png().toBuffer());
  return Buffer.from(zipSync({
    'anatomy.json': strToU8(JSON.stringify(manifest ?? { format: 'everloom-anatomy', version: 1, name: 'Test pack', license: 'CC0', bases: { 'anime-f': { vertices, shapeKeys: { Nipples: 'n.bin' }, layers: { areolaDistance: 'a.png' } } } })),
    'n.bin': new Uint8Array(vertices * 12),
    'a.png': png,
    ...extra,
  }));
}

it('installs, serves and removes the pack, and refuses broken ones', async () => {
  c = await createClient();
  expect((await c.req('GET', '/api/anatomy-pack')).json).toEqual({ installed: false });
  const r = await c.req('POST', '/api/anatomy-pack', await pack(10));
  expect(r.status, r.body).toBe(200);
  expect(r.json).toMatchObject({ installed: true, name: 'Test pack', bases: { 'anime-f': { vertices: 10 } } });
  const key = await c.req('GET', r.json.bases['anime-f'].shapeKeys.Nipples);
  expect(key.status).toBe(200);
  expect(key.raw.length).toBe(120);
  // Wrong sizes, unknown formats and non-zips are refused; the installed pack stays.
  const bad = await pack(10, { 'n.bin': new Uint8Array(7) });
  expect((await c.req('POST', '/api/anatomy-pack', bad)).status).toBe(400);
  expect((await c.req('POST', '/api/anatomy-pack', await pack(10, {}, { format: 'something-else' }))).status).toBe(400);
  expect((await c.req('POST', '/api/anatomy-pack', Buffer.from('not a zip'))).status).toBe(400);
  expect((await c.req('GET', '/api/anatomy-pack')).json.installed).toBe(true);
  expect((await c.req('DELETE', '/api/anatomy-pack')).json).toEqual({ installed: false });
  expect((await c.req('GET', r.json.bases['anime-f'].shapeKeys.Nipples)).status).toBe(404);
}, 30000);
