/** The base-body pack (services/avatars/base-bodies.ts): generated bodies installed outside the repo. */
import { strToU8, zipSync } from 'fflate';
import { afterEach, expect, it } from 'vitest';
import { createClient, type TestClient } from './helpers.js';

let c: TestClient | null = null;
afterEach(async () => { await c?.close(); c = null; });

const glb = () => { const b = new Uint8Array(32); b.set(strToU8('glTF'), 0); return b; };
const pack = (manifest: unknown, files: Record<string, Uint8Array> = { 'f.glb': glb() }) =>
  Buffer.from(zipSync({ 'bodies.json': strToU8(JSON.stringify(manifest)), ...files }));
const ok = { format: 'everloom-base-bodies', version: 1, name: 'Wrapped bodies', license: 'Generated for the owner', underwearFixed: true, bases: { 'anime-f': 'f.glb' } };

it('installs, serves and removes the pack, and refuses broken ones', async () => {
  c = await createClient();
  expect((await c.req('GET', '/api/base-body-pack')).json).toEqual({ installed: false });
  const r = await c.req('POST', '/api/base-body-pack', pack(ok));
  expect(r.status, r.body).toBe(200);
  expect(r.json).toMatchObject({ installed: true, name: 'Wrapped bodies', underwearFixed: true });
  const body = await c.req('GET', r.json.bases['anime-f']);
  expect(body.status).toBe(200);
  expect(body.raw.subarray(0, 4).toString('latin1')).toBe('glTF');
  // Not a GLB, an unknown base, no manifest, not a zip: refused, and the installed pack stays.
  expect((await c.req('POST', '/api/base-body-pack', pack(ok, { 'f.glb': strToU8('nope') }))).status).toBe(400);
  expect((await c.req('POST', '/api/base-body-pack', pack({ ...ok, bases: { 'child-1': 'f.glb' } }))).status).toBe(400);
  expect((await c.req('POST', '/api/base-body-pack', Buffer.from(zipSync({ 'f.glb': glb() })))).status).toBe(400);
  expect((await c.req('POST', '/api/base-body-pack', Buffer.from('not a zip'))).status).toBe(400);
  expect((await c.req('GET', '/api/base-body-pack')).json.installed).toBe(true);
  expect((await c.req('DELETE', '/api/base-body-pack')).json).toEqual({ installed: false });
  expect((await c.req('GET', r.json.bases['anime-f'])).status).toBe(404);
}, 30000);
