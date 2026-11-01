/** Optional owner samples. Never copy these files or their generated models into the repository. */
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { UnityProject, summarize } from '@everloom/engine/unity';
import { avatarSettled } from '../src/services/avatars/service.js';
import { createClient, waitFor, type TestClient } from './helpers.js';
let c: TestClient | undefined;
afterEach(async () => { await c?.close(); c = undefined; });
async function importFile(file: string, mode: 'avatar' | 'library') {
  c = await createClient();
  const start = await c.req('POST', '/api/unity/uploads', { name: basename(file), size: (await stat(file)).size, fingerprint: 'e'.repeat(64) });
  expect(start.status).toBe(200);
  const id = start.json.id;
  let offset = 0;
  for await (const bytes of createReadStream(file, { highWaterMark: 4 * 1024 ** 2 })) {
    const res = await c.req('PUT', `/api/unity/uploads/${id}?offset=${offset}`, bytes);
    expect(res.status).toBe(200); offset += bytes.length;
  }
  expect((await c.req('POST', `/api/unity/uploads/${id}/process`, { mode })).status).toBe(200);
  const result = await waitFor(async () => {
    const r = await c!.req('GET', `/api/unity/uploads/${id}`);
    return r.json.state !== 'processing' ? r.json : null;
  }, 180_000, 200);
  expect(result.state, result.error).toBe('done');
  return result.result;
}
const zip = resolve('samples/3d/unity/ezyZip.zip');
it.skipIf(!existsSync(zip))('private Unity ZIP resolves one outfit with all four colour variants and dependencies', async () => {
  await importFile(zip, 'library');
  const assets = (await c!.req('GET', '/api/unity/library')).json;
  const p = new UnityProject();
  for (const { text, ...a } of assets) p.add({ ...a, data: text === undefined ? undefined : new TextEncoder().encode(text) });
  const item = summarize(p).outfits.find(a => /Milltina_microbikini/.test(a.name));
  expect(item?.variants).toHaveLength(4);
  expect(item?.dependencies).toEqual({ models: 1, materials: 4, textures: 5 });
}, 200_000);
for (const name of ['Female_Mewtwo_by_Annonguy.blend', 'gardevoirpublic_Ascnvok.blend', 'NIKKE_Bay_01.blend']) {
  const file = resolve('samples/3d/blend', name);
  it.skipIf(!existsSync(file) || !process.env.EVERLOOM_BLENDER)(`private Blender rig: ${name}`, async () => {
    const { avatar } = await importFile(file, 'avatar');
    await avatarSettled(avatar);
    const a = (await c!.req('GET', `/api/avatars/${avatar}`)).json;
    expect(a.status, a.error).toBe('ready');
    expect(a.info.missingBones).toEqual([]);
    for (const role of ['hips', 'spine', 'leftUpperArm', 'leftUpperLeg']) expect(a.info.boneMap[role]).not.toBe('Armature');
    expect(a.info.meshes).toBeGreaterThan(0);
    expect(a.info.conversion.blender).toMatch(/^5\.2\./);
    expect(a.info.conversion.validation).toBeTruthy();
  }, 240_000);
}
