/** Everloom Puppets: the format, deformation, the template rig, life, motions and physics. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { autoMesh, cellFor, checkPuppet, exportInochi, importInochi, parsePuppet, PuppetAnimator, PuppetRig, readInochi, rectMesh, writeInochi, type PuppetModel } from '../src/index.js';

const placeholder = () => parsePuppet(JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../../apps/web/public/puppets/placeholder/puppet.json'), 'utf8')));

/** A tiny puppet: one 100x100 card under a 1x1 warp, with a rotation deformer for a second card. */
function tiny(extra: Partial<PuppetModel> = {}): PuppetModel {
  return {
    format: 'everloom-puppet', version: 1, id: 't', name: 'Tiny', template: 'test', rating: 'all-ages',
    canvas: { width: 200, height: 200 }, anchors: {}, textures: ['p.png'],
    params: [{ id: 'A', min: -1, max: 1, default: 0 }, { id: 'B', min: 0, max: 1, default: 0 }],
    deformers: [
      { kind: 'warp', id: 'w', parent: null, rect: [0, 0, 100, 100], cols: 1, rows: 1 },
      { kind: 'rotate', id: 'r', parent: 'w', origin: [50, 50] },
    ],
    parts: [
      { id: 'card', slot: 'body', texture: 0, mesh: rectMesh(0, 0, 100, 100), parent: 'w', z: 0, opacity: 1, blend: 'normal', masks: [] },
      { id: 'arm', slot: 'arm.r', texture: 0, mesh: rectMesh(50, 50, 10, 10), parent: 'r', z: 1, opacity: 1, blend: 'normal', masks: [] },
    ],
    bindings: [
      // A shifts the whole warp right by 20 px at A=1, left at A=−1.
      { target: 'w', prop: 'grid', params: ['A'], keys: [[-1, 0, 1]], values: [[-20, 0, -20, 0, -20, 0, -20, 0], [0, 0, 0, 0, 0, 0, 0, 0], [20, 0, 20, 0, 20, 0, 20, 0]] },
      { target: 'r', prop: 'angle', params: ['B'], keys: [[0, 1]], values: [0, 90] },
    ],
    physics: [], expressions: {}, motions: {}, colors: {},
    ...extra,
  };
}

describe('deformation', () => {
  it('interpolates keyforms between keys and holds them past the ends', () => {
    const rig = new PuppetRig(tiny());
    rig.set('A', 0.5);
    rig.evaluate();
    expect(rig.frames[0]!.positions[0]).toBeCloseTo(10);
    rig.set('A', 1);
    rig.evaluate();
    expect(rig.frames[0]!.positions[2]).toBeCloseTo(120);
    // Clamped to the parameter's range.
    rig.set('A', 5);
    expect(rig.get('A')).toBe(1);
  });

  it('turns children of a rotation around its origin, which follows its parent warp', () => {
    const rig = new PuppetRig(tiny());
    rig.set('B', 1);
    rig.set('A', 1);
    rig.evaluate();
    // The arm card's corner at (60, 50) turns 90° around (50, 50) → (50, 60), then the warp moves it 20 right.
    const p = rig.frames[1]!.positions;
    expect(p[2]).toBeCloseTo(70, 3);
    expect(p[3]).toBeCloseTo(60, 3);
  });

  it('blends two-parameter keyforms bilinearly and adds bindings from different parameters', () => {
    const m = tiny();
    m.bindings.push({ target: 'card', prop: 'verts', params: ['A', 'B'], keys: [[0, 1], [0, 1]], values: [new Array(8).fill(0), new Array(8).fill(0), new Array(8).fill(0), [0, 10, 0, 10, 0, 10, 0, 10]] });
    const rig = new PuppetRig(m);
    rig.set('A', 0.5); rig.set('B', 0.5);
    rig.evaluate();
    // Vertex offsets: 10 * 0.25 = 2.5 down; the warp adds 10 right.
    expect(rig.frames[0]!.positions[0]).toBeCloseTo(10);
    expect(rig.frames[0]!.positions[1]).toBeCloseTo(2.5);
  });

  it('multiplies opacity and reorders by draw order', () => {
    const m = tiny();
    m.bindings.push({ target: 'card', prop: 'opacity', params: ['B'], keys: [[0, 1]], values: [1, 0.5] }, { target: 'card', prop: 'z', params: ['B'], keys: [[0, 1]], values: [0, 5] });
    const rig = new PuppetRig(m);
    rig.evaluate();
    expect(rig.order).toEqual([0, 1]);
    rig.set('B', 1);
    rig.evaluate();
    expect(rig.frames[0]!.opacity).toBeCloseTo(0.5);
    expect(rig.order).toEqual([1, 0]);
  });

  it('refuses a puppet whose references or keyform sizes are wrong', () => {
    const m = tiny();
    m.bindings.push({ target: 'w', prop: 'grid', params: ['A'], keys: [[0, 1]], values: [[0, 0], [1, 1]] });
    m.parts[0]!.parent = 'nope';
    const c = checkPuppet(m);
    expect(c.ok).toBe(false);
    expect(c.errors.join('\n')).toMatch(/no deformer "nope"/);
    expect(c.errors.join('\n')).toMatch(/needs 8 numbers/);
    expect(() => parsePuppet(m)).toThrow(/Not a valid puppet/);
  });
});

describe('automatic meshes', () => {
  it('covers the visible pixels of a part with a margin, finer for eyes than for clothes', () => {
    const W = 120, H = 80, alpha = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - 60) ** 2 / 50 ** 2 + (y - 40) ** 2 / 30 ** 2 < 1) alpha[y * W + x] = 255;
    const coarse = autoMesh({ width: W, height: H, alpha }, { cell: cellFor('top'), offset: [10, 20] });
    const fine = autoMesh({ width: W, height: H, alpha }, { cell: cellFor('eye.l.white') });
    expect(fine.positions.length).toBeGreaterThan(coarse.positions.length * 3);
    // Every visible pixel is inside some triangle's cell (the mesh's box covers the ellipse).
    const xs = coarse.positions.filter((_, i) => i % 2 === 0), ys = coarse.positions.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeLessThanOrEqual(10 + 10);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(10 + 110);
    expect(Math.min(...ys)).toBeLessThanOrEqual(20 + 10);
    expect(coarse.uvs.every((u) => u >= 0 && u <= 1)).toBe(true);
    expect(coarse.indices.length % 3).toBe(0);
  });
});

const centroid = (p: Float32Array) => { let x = 0, y = 0; for (let i = 0; i < p.length; i += 2) { x += p[i]!; y += p[i + 1]!; } return [(x * 2) / p.length, (y * 2) / p.length]; };
/** A seeded random source. */
const seeded = (s = 7) => () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;

describe('the template rig (on the placeholder puppet)', () => {
  it('is a valid puppet with every slot the placeholder fills', () => {
    const m = placeholder();
    expect(checkPuppet(m)).toEqual({ ok: true, errors: [] });
    expect(m.parts.length).toBeGreaterThan(30);
    expect(m.params.map((p) => p.id)).toEqual(expect.arrayContaining(['AngleX', 'AngleY', 'AngleZ', 'EyeLOpen', 'MouthOpen', 'Breath', 'Bust', 'Waist', 'Hips']));
  });

  it('turns the head with parallax: the fringe moves more than the face, back hair the other way', () => {
    const rig = new PuppetRig(placeholder());
    const at = (id: string) => rig.model.parts.findIndex((p) => p.id === id);
    rig.evaluate();
    const rest = Object.fromEntries(['face-skin', 'hair-front', 'hair-back', 'body-skin'].map((id) => [id, centroid(rig.frames[at(id)]!.positions)]));
    rig.set('AngleX', 30);
    rig.evaluate();
    const dx = (id: string) => centroid(rig.frames[at(id)]!.positions)[0]! - rest[id]![0]!;
    expect(dx('face-skin')).toBeGreaterThan(5);
    expect(dx('hair-front')).toBeGreaterThan(dx('face-skin'));
    expect(dx('hair-back')).toBeLessThan(dx('face-skin'));
    // The body stays put when only the head turns.
    expect(Math.abs(dx('body-skin'))).toBeLessThan(1);
  });

  it('reshapes the body and the outfit on it together', () => {
    const rig = new PuppetRig(placeholder());
    const width = (id: string) => { const p = rig.frames[rig.model.parts.findIndex((x) => x.id === id)]!.positions; let a = Infinity, b = -Infinity; for (let i = 0; i < p.length; i += 2) if (Math.abs(p[i + 1]! - 560) < 25) { a = Math.min(a, p[i]!); b = Math.max(b, p[i]!); } return b - a; };
    rig.evaluate();
    const [body0, top0] = [width('body-skin'), width('top')];
    rig.set('Waist', 1);
    rig.evaluate();
    expect(width('body-skin')).toBeGreaterThan(body0 * 1.04);
    expect(width('top') / top0).toBeCloseTo(width('body-skin') / body0, 1);
  });

  it('crossfades the eye drawings as the eye closes, and the mouth drawings as it opens', () => {
    const rig = new PuppetRig(placeholder());
    const op = (id: string) => rig.frames[rig.model.parts.findIndex((p) => p.id === id)]!.opacity;
    rig.evaluate();
    expect([op('eye-l-lash'), op('eye-l-half'), op('eye-l-closed')]).toEqual([1, 0, 0]);
    rig.set('EyeLOpen', 0.42); rig.evaluate();
    expect(op('eye-l-half')).toBeCloseTo(1);
    rig.set('EyeLOpen', 0); rig.evaluate();
    expect([op('eye-l-lash'), op('eye-l-closed')]).toEqual([0, 1]);
    expect(op('mouth-wide')).toBe(0);
    rig.set('MouthOpen', 1); rig.evaluate();
    expect(op('mouth-wide')).toBeCloseTo(1);
  });
});

describe('the animator', () => {
  it('blinks on its own every few seconds and breathes', () => {
    const a = new PuppetAnimator(placeholder(), seeded());
    let blinks = 0, wasOpen = true, minBreath = 1, maxBreath = 0;
    for (let i = 0; i < 60 * 20; i++) {
      a.update(1 / 60);
      const shut = a.rig.get('EyeLOpen') < 0.1;
      if (shut && wasOpen) blinks++;
      wasOpen = !shut;
      minBreath = Math.min(minBreath, a.rig.get('Breath')); maxBreath = Math.max(maxBreath, a.rig.get('Breath'));
    }
    expect(blinks).toBeGreaterThanOrEqual(3);
    expect(blinks).toBeLessThanOrEqual(12);
    expect(maxBreath - minBreath).toBeGreaterThan(0.9);
  });

  it('blends to an expression, plays a nod and comes back, and opens the mouth with the voice', () => {
    const a = new PuppetAnimator(placeholder(), seeded());
    a.life = { blink: false, breath: false, sway: false };
    a.setExpression('joy');
    for (let i = 0; i < 60; i++) a.update(1 / 60);
    expect(a.rig.get('EyeSmile')).toBeGreaterThan(0.7);
    a.setExpression('neutral');
    for (let i = 0; i < 90; i++) a.update(1 / 60);
    expect(a.rig.get('EyeSmile')).toBeLessThan(0.02);
    expect(a.play('nod')).toBe(true);
    let lowest = 0;
    for (let i = 0; i < 60; i++) { a.update(1 / 60); lowest = Math.min(lowest, a.rig.get('AngleY')); }
    expect(lowest).toBeLessThan(-8);
    for (let i = 0; i < 60; i++) a.update(1 / 60);
    expect(Math.abs(a.rig.get('AngleY'))).toBeLessThan(0.5);
    expect(a.busy).toBe(false);
    a.speech = 0.8;
    for (let i = 0; i < 10; i++) a.update(1 / 60);
    expect(a.rig.get('MouthOpen')).toBeGreaterThan(0.6);
  });

  it('swings hair after the head turns and settles again', () => {
    const a = new PuppetAnimator(placeholder(), seeded());
    a.life = { blink: false, breath: false, sway: false };
    for (let i = 0; i < 30; i++) a.update(1 / 60);
    a.base.set('AngleX', 30);
    let peak = 0;
    for (let i = 0; i < 40; i++) { a.update(1 / 60); peak = Math.max(peak, Math.abs(a.rig.get('HairBack'))); }
    expect(peak).toBeGreaterThan(0.1);
    for (let i = 0; i < 60 * 8; i++) a.update(1 / 60);
    expect(Math.abs(a.rig.get('HairBack'))).toBeLessThan(0.08);
    a.physics.enabled = false;
    a.update(1 / 60);
    expect(a.rig.get('HairBack')).toBe(0);
  });

  it('follows a look target with the eyes and the head', () => {
    const a = new PuppetAnimator(placeholder(), seeded());
    a.life = { blink: false, breath: false, sway: false };
    a.look = { x: 1, y: 0 };
    for (let i = 0; i < 90; i++) a.update(1 / 60);
    expect(a.rig.get('EyeBallX')).toBeGreaterThan(0.9);
    expect(a.rig.get('AngleX')).toBeGreaterThan(8);
  });
});

describe('Inochi2D interchange', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

  it('writes a container Inochi2D reads: magic, JSON, PNG textures and the extension section', () => {
    const bytes = exportInochi(placeholder(), [png]);
    expect(new TextDecoder().decode(bytes.subarray(0, 8))).toBe('TRNSRTS\0');
    const f = readInochi(bytes);
    expect(f.textures).toEqual([{ encoding: 0, data: png }]);
    expect(f.json.nodes.type).toBe('Node');
    const parts = f.json.nodes.children!;
    expect(parts.every((p) => p.type === 'Part' && p.mesh!.verts.length === p.mesh!.uvs!.length)).toBe(true);
    // Front parts sort lower (Inochi2D draws higher zsort first).
    const z = (name: string) => parts.find((p) => p.name === name)!.zsort!;
    expect(z('hair-front')).toBeLessThan(z('face-skin'));
    expect(parts.find((p) => p.name === 'eye-l-iris')!.masks).toEqual([{ source: parts.find((p) => p.name === 'eye-l-white')!.uuid, mode: 'Mask' }]);
    const angle = f.json.param.find((p) => p.name === 'AngleX')!;
    expect(angle.axis_points[0]).toEqual([0, 0.5, 1]);
    expect(angle.bindings.some((b) => b.param_name === 'deform')).toBe(true);
    expect(Object.keys(f.ext)).toEqual(['everloom.puppet']);
  });

  it('round-trips an Everloom puppet unchanged, and brings back what was moved in Creator', () => {
    const m = placeholder();
    const back = importInochi(exportInochi(m, [png]));
    expect(back.restored).toBe(true);
    expect(back.model).toEqual(m);
    // "In Creator": nudge the fringe's first vertex 3 px right at rest, and its AngleX=30 key 5 px down.
    const f = readInochi(exportInochi(m, [png]));
    const fringe = f.json.nodes.children!.find((p) => p.name === 'hair-front')!;
    fringe.mesh!.verts[0]! += 3;
    const b = f.json.param.find((p) => p.name === 'AngleX')!.bindings.find((x) => x.node === fringe.uuid && x.param_name === 'deform')!;
    (b.values[2]![0] as number[][])[0]![1]! += 5;
    const edited = importInochi(writeInochi(f)).model;
    const i = edited.parts.findIndex((p) => p.id === 'hair-front');
    expect(edited.parts[i]!.mesh.positions[0]).toBeCloseTo(m.parts[i]!.mesh.positions[0]! + 3, 2);
    const a = new PuppetRig(edited), o = new PuppetRig(m);
    a.set('AngleX', 30); o.set('AngleX', 30); a.evaluate(); o.evaluate();
    expect(a.frames[i]!.positions[1]! - o.frames[i]!.positions[1]!).toBeCloseTo(5, 1);
  });

  it('imports a puppet made in Creator (no Everloom payload): parts, deforms and opacity', () => {
    const m = placeholder();
    const f = readInochi(exportInochi(m, [png]));
    const plain = importInochi(writeInochi({ ...f, ext: {} }), 'from-creator');
    expect(plain.restored).toBe(false);
    expect(plain.model.parts.length).toBe(m.parts.length);
    // A one-parameter pose comes out where ours puts it (up to the import's own origin).
    const ours = new PuppetRig(m), theirs = new PuppetRig(plain.model);
    const i = m.parts.findIndex((p) => p.id === 'hair-back');
    ours.evaluate(); theirs.evaluate();
    const off = [ours.frames[i]!.positions[0]! - theirs.frames[i]!.positions[0]!, ours.frames[i]!.positions[1]! - theirs.frames[i]!.positions[1]!];
    ours.set('AngleX', 30); theirs.set('AngleX', 30); ours.evaluate(); theirs.evaluate();
    expect(theirs.frames[i]!.positions[0]! + off[0]!).toBeCloseTo(ours.frames[i]!.positions[0]!, 1);
    ours.reset(); theirs.reset(); ours.set('EyeLOpen', 0); theirs.set('EyeLOpen', 0); ours.evaluate(); theirs.evaluate();
    const j = m.parts.findIndex((p) => p.id === 'eye-l-closed');
    expect(theirs.frames[j]!.opacity).toBeCloseTo(ours.frames[j]!.opacity, 3);
    expect(() => importInochi(Uint8Array.from([1, 2, 3]))).toThrow(/Not an Inochi2D file/);
  });
});
