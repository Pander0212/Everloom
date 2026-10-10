import { readFileSync } from 'node:fs';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterEach, expect, it } from 'vitest';
import { clipFromLayers } from './clip-fixture.js';
import { createClient, type TestClient } from './helpers.js';

let c: TestClient | null = null;
afterEach(async () => { await c?.close(); c = null; });
const dir = path.resolve(import.meta.dirname, '../../web/public/puppets/placeholder');

it('imports a zip of finished puppets as they are, serves them, and refuses a puppet with a fake page', async () => {
  c = await createClient();
  const json = readFileSync(path.join(dir, 'puppet.json'));
  const page = readFileSync(path.join(dir, 'page0.png'));
  const adult = JSON.stringify({ ...JSON.parse(json.toString('utf8')), name: 'Second', rating: '18+' });
  const zip = Buffer.from(zipSync({ 'one/puppet.json': new Uint8Array(json), 'one/page0.png': new Uint8Array(page), 'two/puppet.json': strToU8(adult), 'two/page0.png': new Uint8Array(page) }));
  const r = await c.req('POST', '/api/puppets/import', zip);
  expect(r.status).toBe(200);
  expect(r.json.map((p: { name: string; rating: string }) => [p.name, p.rating]).sort()).toEqual([['Placeholder', 'all-ages'], ['Second', '18+']]);
  const list = (await c.req('GET', '/api/puppets')).json as Array<{ id: string; url: string }>;
  expect(list).toHaveLength(2);
  const served = await c.req('GET', list[0]!.url);
  expect(served.status).toBe(200);
  expect(JSON.parse(served.body).textures).toEqual(['page0.png']);
  expect((await c.req('GET', list[0]!.url.replace('puppet.json', 'page0.png'))).raw.subarray(0, 4).toString('hex')).toBe('89504e47');
  const fake = Buffer.from(zipSync({ 'puppet.json': new Uint8Array(json), 'page0.png': strToU8('<html>not a picture</html>') }));
  expect((await c.req('POST', '/api/puppets/import', fake)).status).toBe(400);
  expect((await c.req('GET', '/api/puppets')).json).toHaveLength(2);
}, 30000);

it('makes a puppet from a Clip Studio drawing whose layers are named by the artist', async () => {
  const W = 200, H = 400;
  const layer = (name: string, shapes: Array<[number, number, number, number]>, rgb: [number, number, number] = [200, 150, 120]) => {
    const a = new Uint8Array(W * H * 4);
    for (const [cx, cy, rx, ry] of shapes) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) { const i = (y * W + x) * 4; a[i] = rgb[0]; a[i + 1] = rgb[1]; a[i + 2] = rgb[2]; a[i + 3] = 255; }
    return { name, rgba: a };
  };
  const layers = [
    layer('Hair/Back', [[100, 80, 50, 70]], [240, 210, 90]),
    layer('Arms', [[45, 150, 12, 40], [155, 150, 12, 40]]),
    layer('Legs', [[80, 300, 15, 80], [120, 300, 15, 80]]),
    layer('Clothes/Shirt', [[100, 150, 40, 50]], [30, 30, 30]),
    layer('Clothes/Skirt', [[100, 215, 42, 25]], [40, 60, 160]),
    layer('顔', [[100, 60, 30, 36]]),
    layer('白目', [[88, 58, 6, 4], [112, 58, 6, 4]], [255, 255, 255]),
    layer('瞳', [[88, 58, 3, 3], [112, 58, 3, 3]], [40, 90, 200]),
    layer('まつげ', [[88, 54, 7, 2], [112, 54, 7, 2]], [20, 20, 20]),
    layer('眉', [[88, 46, 7, 1.5], [112, 46, 7, 1.5]], [120, 90, 40]),
    layer('口', [[100, 82, 5, 1.5]], [150, 60, 60]),
    layer('前髪', [[100, 40, 34, 20], [72, 110, 6, 40], [128, 110, 6, 40]], [240, 210, 90]),
  ];
  const clip = clipFromLayers(W, H, layers);
  c = await createClient();
  const r = await c.req('POST', '/api/puppets/import?name=Drawn', clip);
  expect(r.status, r.body).toBe(200);
  expect(r.json[0]).toMatchObject({ name: 'Drawn', source: 'import' });
  expect(r.json[0].parts).toBeGreaterThan(10);
  const puppet = JSON.parse((await c.req('GET', `/api/puppets/${r.json[0].id}/puppet.json`)).body);
  expect(puppet.parts.map((p: { slot: string }) => p.slot)).toEqual(expect.arrayContaining(['face', 'hair.back', 'hair.front', 'eye.l.iris', 'brow.r', 'arm.l', 'legwear', 'top', 'bottom']));
  // The same drawing as a layered Photoshop file (groups as folders).
  const { writePsd } = await import('ag-psd');
  const img = (l: { rgba: Uint8Array }) => ({ width: W, height: H, data: new Uint8ClampedArray(l.rgba), colorSpace: 'srgb' }) as unknown as ImageData;
  const named = layers.map((l) => ({ ...l, path: l.name.split('/') }));
  const groups = new Map<string, { name: string; children: unknown[] }>();
  const children: unknown[] = [];
  for (const l of named) {
    const leaf = { name: l.path.at(-1), left: 0, top: 0, imageData: img(l) };
    if (l.path.length === 1) { children.push(leaf); continue; }
    let g = groups.get(l.path[0]!);
    if (!g) { g = { name: l.path[0]!, children: [] }; groups.set(g.name, g); children.push(g); }
    g.children.push(leaf);
  }
  const psd = Buffer.from(writePsd({ width: W, height: H, children } as never, { generateThumbnail: false }));
  const p2 = await c.req('POST', '/api/puppets/import?name=Painted', psd);
  expect(p2.status, p2.body).toBe(200);
  const puppet2 = JSON.parse((await c.req('GET', `/api/puppets/${p2.json[0].id}/puppet.json`)).body);
  expect(puppet2.parts.map((p: { slot: string }) => p.slot)).toEqual(expect.arrayContaining(['face', 'hair.back', 'hair.front', 'top', 'bottom']));
  // Without a face layer the message says how to name the layers.
  const faceless = clipFromLayers(W, H, [layer('Layer 1', [[100, 60, 30, 36]])]);
  const bad = await c.req('POST', '/api/puppets/import', faceless);
  expect(bad.status).toBe(400);
  expect(bad.body).toMatch(/No face layer.*顔/);
}, 60000);
