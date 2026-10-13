import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { afterEach, expect, it } from 'vitest';
import { createClient, FIXTURES, waitFor, type TestClient } from './helpers.js';
let c: TestClient | undefined;
afterEach(async () => { await c?.close(); c = undefined; });
async function index(name: string, bytes: Buffer) {
  const start = await c!.req('POST', '/api/unity/uploads', { name, size: bytes.length, fingerprint: createHash('sha256').update(bytes).digest('hex') });
  expect(start.status).toBe(200);
  const id = start.json.id;
  for (let offset = 0; offset < bytes.length; offset += 4 * 1024 ** 2) expect((await c!.req('PUT', `/api/unity/uploads/${id}?offset=${offset}`, bytes.subarray(offset, offset + 4 * 1024 ** 2))).status).toBe(200);
  expect((await c!.req('POST', `/api/unity/uploads/${id}/process`, {})).status).toBe(200);
  const job = await waitFor(async () => { const r = await c!.req('GET', `/api/unity/uploads/${id}`); return r.json.state !== 'processing' ? r.json : null; });
  expect(job.error).toBeUndefined(); expect(job.state).toBe('done');
  expect((await c!.req('DELETE', `/api/unity/uploads/${id}`)).status).toBe(200);
  return (await c!.req('GET', '/api/unity/library')).json as any[];
}
it('indexes multiple packages from ZIP and keeps assets after deleting transport chunks', async () => {
  c = await createClient();
  const avatar = readFileSync(join(FIXTURES, 'unity/Ava.unitypackage')), shirt = readFileSync(join(FIXTURES, 'unity/AvaShirt.unitypackage'));
  const assets = await index('bundle.zip', Buffer.from(zipSync({ 'avatar.unitypackage': avatar, 'clothes.unitypackage': shirt })));
  expect(assets.some(a => a.path.endsWith('Ava.prefab'))).toBe(true);
  expect(assets.some(a => a.path.endsWith('Shirt.prefab'))).toBe(true);
  const model = assets.find(a => a.path.endsWith('Ava.fbx'));
  expect(model.text).toBeUndefined(); expect(model.blob).toBeUndefined();
  expect((await c.req('GET', `/api/unity/library/${model.guid}`)).raw.length).toBe(model.size);
});
it('rekeys a model when its meta arrives later, then resolves a split package reference', async () => {
  c = await createClient();
  await index('Assets/Split.fbx', Buffer.from('model bytes'));
  const guid = '1234567890abcdef1234567890abcdef';
  const assets = await index('Assets/Split.fbx.meta', Buffer.from(`fileFormatVersion: 2\nguid: ${guid}\nModelImporter:\n  animationType: 3\n`));
  expect(assets.filter(a => a.path === 'Assets/Split.fbx')).toHaveLength(1);
  expect(assets.find(a => a.path === 'Assets/Split.fbx')).toMatchObject({ guid, guessed: false, meta: { ModelImporter: { animationType: 3 } } });
});
it('resumes at the acknowledged offset and rejects changed retry bytes', async () => {
  c = await createClient();
  const opts = { name: 'large.unitypackage', size: 4 * 1024 ** 2 + 3, fingerprint: 'a'.repeat(64) };
  const start = await c.req('POST', '/api/unity/uploads', opts), id = start.json.id;
  const chunk = Buffer.alloc(4 * 1024 ** 2, 7);
  expect((await c.req('PUT', `/api/unity/uploads/${id}?offset=0`, chunk)).json.offset).toBe(chunk.length);
  expect((await c.req('POST', '/api/unity/uploads', opts)).json).toMatchObject({ id, offset: chunk.length });
  expect((await c.req('PUT', `/api/unity/uploads/${id}?offset=0`, chunk)).status).toBe(200);
  expect((await c.req('PUT', `/api/unity/uploads/${id}?offset=0`, Buffer.alloc(chunk.length, 8))).status).toBe(409);
  expect((await c.req('POST', `/api/unity/uploads/${id}/process`, {})).status).toBe(409);
  expect((await c.req('DELETE', `/api/unity/uploads/${id}`)).status).toBe(200);
  expect((await c.req('GET', `/api/unity/uploads/${id}`)).status).toBe(404);
});
