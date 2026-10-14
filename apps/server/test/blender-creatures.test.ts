/**
 * The Blender conversion against every failure cause found in real files, and every skeleton
 * family (docs/3d-import/blender-diagnosis.md): synthetic .blend files made by
 * tools/avatars/creature-fixtures.py, converted exactly as the server converts them (worker.py,
 * `convert`), then read the way the app reads them (inspectModel). The owner's own samples run too
 * when samples/3d exists.
 *
 * Needs Blender: EVERLOOM_BLENDER=/path/to/blender (skipped otherwise).
 */
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseGlb } from '../src/services/avatars/glb.js';
import { inspectModel } from '../src/services/avatars/inspect.js';

const run = promisify(execFile);
const blender = process.env.EVERLOOM_BLENDER;
const root = path.resolve(__dirname, '../../..');
const worker = path.join(root, 'apps/server/src/blender/worker.py');
const has = !!blender && existsSync(blender);
let dir = '';

async function convert(file: string) {
  const job = mkdtempSync(path.join(dir, 'job-'));
  copyFileSync(file, path.join(job, 'input.blend'));
  writeFileSync(path.join(job, 'job.json'), JSON.stringify({ op: 'convert', input: 'input.blend', output: 'output.glb' }));
  await run(blender!, ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '3', '--python', worker, '--', path.join(job, 'job.json')], { cwd: job, timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024 }).catch(() => undefined);
  const result = JSON.parse(readFileSync(path.join(job, 'result.json'), 'utf8'));
  const glb = result.ok ? readFileSync(path.join(job, 'output.glb')) : null;
  return { result, glb };
}

describe.skipIf(!has)('Blender conversion: causes and families', () => {
  const fixtures = new Map<string, { result: any; glb: Buffer | null; expect: any }>();
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'everloom-creatures-'));
    const out = path.join(dir, 'fixtures');
    mkdirSync(out);
    await run(blender!, ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '3', '--python', path.join(root, 'tools/avatars/creature-fixtures.py'), '--', out], { timeout: 10 * 60_000, maxBuffer: 64 * 1024 * 1024 });
    for (const f of readdirSync(out).filter((x) => x.endsWith('.blend'))) {
      const name = f.replace(/\.blend$/, '');
      fixtures.set(name, { ...(await convert(path.join(out, f))), expect: JSON.parse(readFileSync(path.join(out, `${name}.json`), 'utf8')) });
    }
  }, 60 * 60_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  const get = (name: string) => {
    const f = fixtures.get(name);
    if (!f) throw new Error(`fixture ${name} was not made`);
    expect(f.result.ok, f.result.error).toBe(true);
    return f;
  };

  it('every fixture converts and passes the read-back check', () => {
    expect(fixtures.size).toBeGreaterThanOrEqual(17);
    for (const [name, f] of fixtures) {
      expect(f.result.ok, `${name}: ${f.result.error}`).toBe(true);
      expect(f.result.validation.check.ok, `${name}: ${JSON.stringify(f.result.validation.check)}`).toBe(true);
    }
  });

  it('finds each skeleton family', async () => {
    for (const [name, f] of fixtures) {
      if (!f.expect.family) continue;
      const info = await inspectModel(f.glb!);
      expect(info.rig.family, name).toBe(f.expect.family);
      // A pony isn't asked for arms; a humanoid (even with meaningless names) gets its core.
      if (f.expect.family === 'humanoid') expect(info.warnings.map((w) => w.code), name).not.toContain('bones_missing');
      else expect(info.warnings.map((w) => w.code), name).not.toContain('bones_missing');
    }
    const quad = await inspectModel(get('family-quadruped-unnamed').glb!);
    const roles = new Set(quad.rig.roles.map((r) => r.role));
    for (const r of ['frontLeg', 'hindLeg', 'tail', 'head', 'pelvis'] as const) expect(roles.has(r) || quad.rig.roles.some((x) => x.role === r), r).toBe(true);
    const winged = await inspectModel(get('family-winged-quadruped').glb!);
    expect(winged.rig.roles.filter((r) => r.role === 'wings').map((r) => r.side).sort()).toEqual(['L', 'R']);
    const unnamed = await inspectModel(get('family-humanoid-unnamed').glb!);
    expect(unnamed.missingBones).toEqual([]);
  });

  it('control rigs: deform bones chained through their constraints, controls dropped', () => {
    const f = get('cause-control-rig');
    expect(f.result.validation.exportedJoints).toBe(f.expect.joints);
    const { json } = parseGlb(f.glb!);
    const parent = new Map<string, string>();
    json.nodes!.forEach((n) => n.children?.forEach((c) => parent.set(json.nodes![c]!.name!, n.name!)));
    for (const [child, want] of Object.entries(f.expect.parents as Record<string, string>)) expect(parent.get(child), child).toBe(want);
  });

  it('bone-parented and unweighted rigid parts are skinned to their bone', () => {
    const f = get('cause-rigid-parts');
    const rigid = (f.result.validation.rigidSkinned as string[]).map((s) => s.split(' → ')[0]);
    expect(rigid.sort()).toEqual([...f.expect.rigid].sort());
    expect(f.result.validation.check.unweightedVertices).toBe(0);
  });

  it('modifiers are applied with shape keys kept; hidden cutters stay out', () => {
    const f = get('cause-modifiers-keys');
    const applied = (f.result.validation.modifiersApplied as string[]).join(' ');
    for (const o of f.expect.applied) expect(applied).toContain(o);
    const { json } = parseGlb(f.glb!);
    const morphs = new Set(json.meshes!.flatMap((m) => ((m as { extras?: { targetNames?: string[] } }).extras?.targetNames ?? [])));
    for (const k of f.expect.morphs) expect(morphs.has(k), k).toBe(true);
    const names = json.nodes!.map((n) => n.name);
    for (const n of f.expect.notIn) expect(names).not.toContain(n);
  });

  it('parts hidden by toggles, collections or "disable selection" are exported', () => {
    const f = get('cause-hidden-parts');
    expect(f.result.validation.objects).toEqual(f.expect.objects);
  });

  it('rotated, centimetre-scale armatures keep the real size', () => {
    const f = get('cause-transforms');
    const h = f.result.validation.check.height;
    expect(h).toBeGreaterThan(f.expect.height[0]);
    expect(h).toBeLessThan(f.expect.height[1]);
  });

  it('toon and non-Principled materials keep their texture or colour', () => {
    const f = get('cause-materials');
    expect((f.result.validation.materialsSimplified as string[]).map((s) => s.split(' (')[0]).sort()).toEqual([...f.expect.simplified].sort());
    const { json } = parseGlb(f.glb!);
    const mats = (json as { materials?: Array<{ name: string; pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: unknown } }> }).materials ?? [];
    const red = mats.find((m) => m.name === f.expect.red)!;
    expect(red.pbrMetallicRoughness?.baseColorFactor?.[0]).toBeGreaterThan(0.8);
    expect(red.pbrMetallicRoughness?.baseColorFactor?.[1]).toBeLessThan(0.2);
    expect(mats.find((m) => m.name === f.expect.textured)!.pbrMetallicRoughness?.baseColorTexture).toBeTruthy();
  });

  it('curves and particle hair become weighted meshes', () => {
    const f = get('cause-geometry');
    const converted = (f.result.validation.converted as string[]).join(' ');
    for (const o of f.expect.converted) expect(converted).toContain(o);
  });

  it('weights: at most four per vertex, none missing', () => {
    const f = get('cause-weights');
    expect(f.result.validation.weights.trimmed).toBe(f.expect.trimmed);
    expect(f.result.validation.weights.filled).toBe(f.expect.filled);
    expect(f.result.validation.check.maxInfluences).toBeLessThanOrEqual(4);
  });

  it("the file's clips are baked; a rig's internal action-constraint poses are not", () => {
    const f = get('cause-clip');
    expect(f.result.validation.skeleton.clips).toEqual(f.expect.clips);
    const { json } = parseGlb(f.glb!);
    expect((json as { animations?: Array<{ name: string }> }).animations?.map((a) => a.name)).toEqual(f.expect.clips);
  });
});

// The owner's samples: present only on the owner's machine (git-ignored).
const SAMPLES = path.join(root, 'samples/3d');
const EXPECTED: Record<string, string> = {
  'Raibow_Dash.blend': 'wingedQuadruped',
  'CharizardAnthroExportv1.1_nHl3DSY.blend': 'bipedCreature',
  "Lana's Mom - Annue.blend": 'humanoid',
  'gardevoirpublic_Ascnvok.blend': 'humanoid',
  'NIKKE_Bay_01.blend': 'humanoid',
  'Brenda SMD.blend': 'humanoid',
  'Cilia Base by 23Mink_Update9-8-26.blend': 'humanoid',
  'Nexavali 4.0 NSFW Shareable.blend': 'bipedCreature',
};
describe.skipIf(!has || !existsSync(SAMPLES))("the owner's .blend samples", () => {
  beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'everloom-samples-')); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  for (const [file, family] of Object.entries(EXPECTED)) {
    it.skipIf(!existsSync(path.join(SAMPLES, file)))(`${file}: converts, passes the check, is a ${family}`, async () => {
      const { result, glb } = await convert(path.join(SAMPLES, file));
      expect(result.ok, result.error).toBe(true);
      expect(result.validation.check.ok, JSON.stringify(result.validation.check)).toBe(true);
      const info = await inspectModel(glb!);
      expect(info.rig.family).toBe(family);
      expect(info.warnings.map((w) => w.code)).not.toContain('bones_missing');
    }, 20 * 60_000);
  }
});
