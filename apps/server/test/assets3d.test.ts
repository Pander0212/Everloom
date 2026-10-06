import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { createClient, type TestClient } from './helpers.js';

let c: TestClient | null = null;
let d: TestClient | null = null;
afterEach(async () => {
  await c?.close();
  await d?.close();
  c = d = null;
});

const clip = { v: 1, id: 'x', fps: 30, frames: 2, loop: true, tracks: { head: [0, 0, 0, 1, 0, 0.1, 0, 0.995] } };

describe('3D in the asset library', () => {
  it('lists models, garments and animations with tags and search; exports and imports a zip', async () => {
    c = await createClient();
    const kit = (await c.req('POST', '/api/avatars/code', { name: 'Kit', recipe: {} })).json;
    await c.req('PUT', '/api/avatar-clips/nod_twice', { label: 'Nod twice', category: 'social', clip });
    let lib = (await c.req('GET', '/api/assets3d')).json;
    expect(lib.items.map((i: any) => i.key)).toEqual(expect.arrayContaining([`model:${kit.id}`, 'animation:nod_twice']));
    expect((await c.req('PUT', '/api/assets3d/tags', { key: `model:${kit.id}`, tags: ['Hero', 'hero', 'blue'] })).json.tags).toEqual(['hero', 'blue']);
    expect((await c.req('PUT', '/api/assets3d/tags', { key: 'nope', tags: [] })).status).toBe(400);
    lib = (await c.req('GET', '/api/assets3d?tag=hero')).json;
    expect(lib.items.map((i: any) => i.key)).toEqual([`model:${kit.id}`]);
    expect(lib.tags).toEqual(['blue', 'hero']);
    expect((await c.req('GET', '/api/assets3d?q=nod&type=animation')).json.items).toHaveLength(1);

    const zip = (await c.req('POST', '/api/assets3d/export', { keys: [`model:${kit.id}`, 'animation:nod_twice'] })).raw;
    expect(Object.keys(unzipSync(new Uint8Array(zip)))).toEqual(expect.arrayContaining(['assets3d.json', 'avatars/Kit/avatar.json', 'animations/nod_twice.json']));
    expect((await c.req('POST', '/api/assets3d/export', { keys: ['model:av_missing'] })).status).toBe(400);

    d = await createClient();
    const r = (await d.req('POST', '/api/assets3d/import', zip, { 'content-type': 'application/zip' })).json;
    expect(r).toMatchObject({ animations: ['nod_twice'], skipped: 0 });
    expect(r.avatars).toHaveLength(1);
    const got = (await d.req('GET', '/api/assets3d')).json;
    expect(got.items.find((i: any) => i.type === 'model')).toMatchObject({ name: 'Kit', tags: ['hero', 'blue'], detail: 'Code-made' });
    // Again: the animation name is taken, so it's skipped; the avatar comes as a second copy.
    const again = (await d.req('POST', '/api/assets3d/import', zip, { 'content-type': 'application/zip' })).json;
    expect(again.skipped).toBe(1);
    expect((await d.req('POST', '/api/assets3d/import', Buffer.from('nope'), { 'content-type': 'application/zip' })).status).toBe(400);
  });
});
