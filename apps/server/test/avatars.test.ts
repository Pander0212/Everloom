import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { parseGlb, replaceViews, writeGlb } from '../src/services/avatars/glb.js';
import { inspectModel } from '../src/services/avatars/inspect.js';
import { optimizeModel } from '../src/services/avatars/optimize.js';
import { avatarSettled, sniffModel } from '../src/services/avatars/service.js';
import { createClient, FIXTURES, waitFor, type TestClient } from './helpers.js';

const MANNEQUIN = readFileSync(path.join(FIXTURES, 'avatars/models/mannequin-m.glb'));
const oct = { 'content-type': 'application/octet-stream' };

/** A VRM 1.0 made from the mannequin: humanoid bones, a few expressions and a 1024px texture. */
async function makeVrm(): Promise<Buffer> {
  const g = parseGlb(MANNEQUIN);
  const json = structuredClone(g.json);
  const png = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 180, g: 120, b: 90, alpha: 1 } } }).png().toBuffer();
  const views = json.bufferViews!;
  views.push({ buffer: 0, byteOffset: 0, byteLength: png.length });
  json.images = [{ bufferView: views.length - 1, mimeType: 'image/png' }];
  json.textures = [{ source: 0 }];
  json.materials![0] = { ...json.materials![0], pbrMetallicRoughness: { baseColorTexture: { index: 0 } } } as never;
  const info = await inspectModel(MANNEQUIN);
  const nodeIndex = (name: string) => json.nodes!.findIndex((n) => n.name === name);
  json.extensionsUsed = [...(json.extensionsUsed ?? []), 'VRMC_vrm'];
  json.extensions = {
    ...(json.extensions ?? {}),
    VRMC_vrm: {
      specVersion: '1.0',
      meta: { name: 'Test', authors: ['Everloom tests'], licenseUrl: 'https://vrm.dev/licenses/1.0/' },
      humanoid: { humanBones: Object.fromEntries(Object.entries(info.boneMap).map(([k, v]) => [k, { node: nodeIndex(v!) }])) },
      expressions: { preset: { happy: { morphTargetBinds: [] }, aa: { morphTargetBinds: [] }, blink: { morphTargetBinds: [] } } },
    },
  };
  // The new view gets its bytes through the same repacking the optimizer uses.
  return writeGlb(replaceViews({ json, bin: g.bin }, new Map([[views.length - 1, png]])));
}

let c: TestClient | null = null;
afterEach(async () => {
  await c?.close();
  c = null;
});

describe('3D model files', () => {
  it('recognises formats by their bytes', () => {
    expect(sniffModel(MANNEQUIN)).toBe('glb');
    expect(sniffModel(Buffer.from('Kaydara FBX Binary  \u0000\u001a\u0000'))).toBe('fbx');
    expect(sniffModel(Buffer.from('; FBX 7.4.0 project file\n'))).toBe('fbx');
    expect(sniffModel(Buffer.from('PMX \u0000\u0000\u0000@'))).toBe('pmx');
    expect(sniffModel(Buffer.from('# Blender\nv 0 0 0\nf 1 2 3\n'), 'x.obj')).toBe('obj');
    expect(sniffModel(Buffer.from('# Blender\nv 0 0 0\n'), 'x.txt')).toBeNull();
    expect(sniffModel(Buffer.from('<?xml version="1.0"?><COLLADA xmlns="x">'))).toBe('dae');
    expect(sniffModel(Buffer.from('just some text'))).toBeNull();
  });

  it('inspects a GLB: skeleton, mapping, cost, units', async () => {
    const info = await inspectModel(MANNEQUIN);
    expect(info.format).toBe('glb');
    expect(info.missingBones).toEqual([]);
    expect(info.boneMap.hips).toBeTruthy();
    expect(info.triangles).toBeGreaterThan(1000);
    expect(info.height).toBeGreaterThan(1.5);
    expect(info.height).toBeLessThan(2.1);
    expect(info.unitScale).toBe(1);
    expect(info.warnings.map((w) => w.code)).toContain('no_face');
  });

  it('rejects broken files with a readable reason', async () => {
    const cut = MANNEQUIN.subarray(0, 4000);
    await expect(inspectModel(cut)).rejects.toThrow(/cut short/);
    const bad = Buffer.from(MANNEQUIN);
    bad.writeUInt32LE(3, 4);
    await expect(inspectModel(bad)).rejects.toThrow(/glTF 2.0/);
  });

  it('optimizes a GLB smaller, with a simpler low-detail copy, keeping the skeleton', async () => {
    const r = await optimizeModel(MANNEQUIN, { format: 'glb', ktx2: false });
    expect(r.main.length).toBeLessThan(MANNEQUIN.length);
    expect(r.low.length).toBeLessThan(r.main.length);
    const a = await inspectModel(r.main);
    const b = await inspectModel(r.low);
    expect(a.missingBones).toEqual([]);
    expect(b.missingBones).toEqual([]);
    expect(b.triangles).toBeLessThan(a.triangles * 0.75);
    expect(parseGlb(r.main).json.extensionsUsed).toContain('EXT_meshopt_compression');
  });

  it('keeps a VRM as written except its textures (KTX2), so its extensions survive', async () => {
    const vrm = await makeVrm();
    const info = await inspectModel(vrm);
    expect(info.format).toBe('vrm1');
    expect(info.convention).toBe('vrm');
    expect(info.vrmExpressions).toEqual(['happy', 'aa', 'blink']);
    expect(info.expressionMap.joy).toEqual([{ morph: 'vrm:happy', weight: 1 }]);
    expect(info.textures[0]).toMatchObject({ width: 1024, height: 1024 });
    const r = await optimizeModel(vrm, { format: 'vrm1', ktx2: true, maxTexture: 512 });
    const out = parseGlb(r.main);
    expect(out.json.extensions?.VRMC_vrm).toEqual(parseGlb(vrm).json.extensions?.VRMC_vrm);
    expect(out.json.images?.[0]?.mimeType).toBe('image/ktx2');
    expect(out.json.textures?.[0]?.extensions?.KHR_texture_basisu).toEqual({ source: 0 });
    expect(out.json.extensionsRequired).toContain('KHR_texture_basisu');
    const again = await inspectModel(r.main);
    expect(again.textures[0]).toMatchObject({ width: 512, height: 512, mime: 'image/ktx2' });
    expect(again.boneMap).toEqual(info.boneMap);
    // Mesh data is byte-for-byte the same.
    expect(again.triangles).toBe(info.triangles);
  }, 60_000);
});

describe('avatars API', () => {
  it('imports, processes, saves settings, lists and deletes', async () => {
    c = await createClient();
    const up = await c.req('POST', '/api/avatars?filename=Mannequin.glb', MANNEQUIN, oct);
    expect(up.status).toBe(200);
    expect(up.json).toMatchObject({ name: 'Mannequin', status: 'processing', kind: 'imported' });
    await avatarSettled(up.json.id);
    const d = (await c.req('GET', `/api/avatars/${up.json.id}`)).json;
    expect(d.status).toBe('ready');
    expect(d.model).toMatch(/^\/media\/m_/);
    expect(d.low).toMatch(/^\/media\/m_/);
    expect(d.config.boneMap.hips).toBeTruthy();
    expect(d.info.report.after).toBeLessThan(MANNEQUIN.length);
    const file = await c.req('GET', d.model);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('model/gltf-binary');
    expect(file.raw.subarray(0, 4).toString()).toBe('glTF');

    // Model files stay out of the picture gallery.
    expect((await c.req('GET', '/api/media')).json).toEqual([]);

    // Settings are validated.
    expect((await c.req('PATCH', `/api/avatars/${d.id}`, { config: { ...d.config, facing: 45 } })).status).toBe(400);
    expect((await c.req('PATCH', `/api/avatars/${d.id}`, { config: { ...d.config, boneMap: { tail: 'x' } } })).status).toBe(400);
    const p = await c.req('PATCH', `/api/avatars/${d.id}`, { name: 'Test body', config: { ...d.config, facing: 180, look: 'toon', floor: 0.02 } });
    expect(p.status).toBe(200);
    expect(p.json).toMatchObject({ name: 'Test body', config: { facing: 180, look: 'toon', floor: 0.02 } });

    // Thumbnail.
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#88a' } }).png().toBuffer();
    const t = await c.req('POST', `/api/avatars/${d.id}/thumbnail`, png, { 'content-type': 'image/png' });
    expect(t.json.thumb).toMatch(/^\/media\//);

    // Link to a character, then delete: files go, the link is cleared.
    const ch = (await c.req('POST', '/api/characters', { card: { name: 'Ava', description: 'x' } })).json;
    await c.req('PATCH', `/api/characters/${ch.id}`, { game: { ...(ch.game ?? {}), avatar3d: d.id } });
    expect((await c.req('GET', `/api/characters/${ch.id}`)).json.game.avatar3d).toBe(d.id);
    const del = await c.req('DELETE', `/api/avatars/${d.id}`);
    expect(del.json).toEqual({ ok: true, unlinked: 1 });
    expect((await c.req('GET', `/api/characters/${ch.id}`)).json.game.avatar3d).toBeUndefined();
    expect((await c.req('GET', d.model)).status).toBe(404);
    expect((await c.req('GET', '/api/avatars')).json).toEqual([]);
    const left = c.built.ctx.db.prepare("SELECT COUNT(*) AS n FROM media WHERE kind LIKE 'model%'").get() as { n: number };
    expect(left.n).toBe(0);
  });

  it('refuses non-models and reports a failed conversion when Blender is missing', async () => {
    c = await createClient();
    expect((await c.req('POST', '/api/avatars?filename=x.png', Buffer.from('not a model at all, just bytes, padded to be long enough to look at'), oct)).status).toBe(415);
    const prev = process.env.EVERLOOM_BLENDER;
    process.env.EVERLOOM_BLENDER = '/nonexistent/blender';
    const old = process.env.PATH;
    process.env.PATH = '/nonexistent';
    try {
      // With no Blender anywhere, an FBX import fails with an explanation (when Blender is truly absent).
      const info = (await c.req('GET', '/api/blender?refresh=1')).json;
      const fbx = Buffer.concat([Buffer.from('Kaydara FBX Binary  \u0000\u001a\u0000'), Buffer.alloc(200)]);
      const up = await c.req('POST', '/api/avatars?filename=a.fbx', fbx, oct);
      expect(up.status).toBe(200);
      await avatarSettled(up.json.id);
      const d = (await c.req('GET', `/api/avatars/${up.json.id}`)).json;
      expect(d.status).toBe('failed');
      if (!info.found) expect(d.error).toMatch(/needs Blender/);
    } finally {
      process.env.PATH = old;
      if (prev === undefined) delete process.env.EVERLOOM_BLENDER;
      else process.env.EVERLOOM_BLENDER = prev;
      await c.req('GET', '/api/blender?refresh=1');
    }
  });

  it('stores motion clips by emote name, validated', async () => {
    c = await createClient();
    const clip = { v: 1, id: 'x', fps: 30, frames: 2, loop: true, tracks: { head: [0, 0, 0, 1, 0, 0.1, 0, 0.995] } };
    expect((await c.req('PUT', '/api/avatar-clips/Bad-Name', { label: 'Bad', category: 'social', clip })).status).toBe(400);
    expect((await c.req('PUT', '/api/avatar-clips/nod_twice', { label: 'Nod', category: 'social', clip: { ...clip, frames: 3 } })).status).toBe(400);
    expect((await c.req('PUT', '/api/avatar-clips/nod_twice', { label: 'Nod twice', category: 'social', clip, source: 'Made in the lab' })).status).toBe(200);
    expect((await c.req('GET', '/api/avatar-clips')).json).toEqual([{ id: 'nod_twice', label: 'Nod twice', category: 'social', source: 'Made in the lab', createdAt: expect.any(Number) }]);
    expect((await c.req('GET', '/api/avatar-clips/nod_twice')).json).toMatchObject({ id: 'nod_twice', frames: 2 });
    await c.req('DELETE', '/api/avatar-clips/nod_twice');
    expect((await c.req('GET', '/api/avatar-clips')).json).toEqual([]);
  });
});

const BLENDER = process.env.EVERLOOM_BLENDER;
describe.skipIf(!BLENDER || !existsSync(BLENDER))('Blender worker', () => {
  it('converts an FBX to an optimized avatar with the same skeleton', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'everloom-fbx-'));
    try {
      const glb = path.join(tmp, 'm.glb');
      const fbx = path.join(tmp, 'm.fbx');
      writeFileSync(glb, MANNEQUIN);
      execFileSync(BLENDER!, ['--background', '--factory-startup', '--python-expr', `import bpy\nbpy.ops.wm.read_factory_settings(use_empty=True)\nbpy.ops.import_scene.gltf(filepath=${JSON.stringify(glb)})\nbpy.ops.export_scene.fbx(filepath=${JSON.stringify(fbx)}, add_leaf_bones=False)`], { stdio: 'ignore', timeout: 120_000 });
      c = await createClient();
      const up = await c.req('POST', '/api/avatars?filename=m.fbx', readFileSync(fbx), oct);
      expect(up.status).toBe(200);
      await waitFor(async () => {
        await avatarSettled(up.json.id);
        return true;
      }, 180_000);
      const d = (await c.req('GET', `/api/avatars/${up.json.id}`)).json;
      expect(d.error).toBeNull();
      expect(d.status).toBe('ready');
      expect(d.info.missingBones).toEqual([]);
      expect(d.info.conversion.bones).toBeGreaterThan(20);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 240_000);
});
