import { describe, expect, it } from 'vitest';
import { cageAt, cageDisplacement, deformPoints, gridDistortion, meanValueWeights, type P } from '../src/studio/cage.js';
import { colorDrift, gradientRamp, hexToRgb, luma, recolorPixels } from '../src/studio/color.js';
import { composeScene, composeSlot, compositeKey, effectiveTraits } from '../src/studio/compose.js';
import { fillPrompt, sheetFromAnswer } from '../src/studio/fill.js';
import { randomSheet } from '../src/studio/randomize.js';
import { canCoexist, migrateTemplate, TemplateSchema, validateTemplate, type Template } from '../src/studio/template.js';
import { migrateTraitSheet, resolvedSliders, TraitSheetSchema } from '../src/studio/traits.js';
import { applyOps } from '../src/game/reducer.js';
import { createInitialState } from '../src/game/state.js';

const sheet = (o: object = {}) => TraitSheetSchema.parse({ name: 'Mira', sex: 'female', age: 24, ...o });

/** A synthetic template: simple shapes only (no art), two hairstyles, an outfit, expressions, a cage. */
function fixture(): Template {
  const L = (id: string, part: string, z: number, extra: object = {}) => ({ id, part, file: `${id}.png`, rect: [0, 0, 100, 200], z, ...extra });
  return TemplateSchema.parse({
    format: 'everloom-studio-template', version: 1, id: 'stand-neutral', name: 'Standing', category: 'standing', rating: 'all-ages', width: 100, height: 200,
    supports: { hairBack: ['long_straight', 'bob'], hairFront: ['bangs'], expressions: ['neutral', 'smile'], wardrobe: { top: ['blouse'] } },
    slots: [{
      id: 'a', sex: ['female'],
      layers: [
        L('hair-back-long', 'hairBack', 5, { when: { 'hair.back': 'long_straight' }, recolor: [{ kind: 'hair', base: '#3b2a22' }] }),
        L('hair-back-bob', 'hairBack', 5, { when: { 'hair.back': 'bob' }, recolor: [{ kind: 'hair', base: '#3b2a22' }] }),
        L('body', 'body', 10, { recolor: [{ kind: 'skin', base: '#f3cfb6' }] }),
        L('blouse', 'clothing', 20, { when: { 'wardrobe.top': 'blouse' } }),
        L('smile', 'expression', 31, { when: { expression: 'smile' } }),
        L('hair-front', 'hairFront', 40, { when: { 'hair.front': 'bangs' }, zRules: [{ when: { 'wardrobe.top': 'blouse' }, z: 41 }], recolor: [{ kind: 'hair', base: '#3b2a22' }] }),
      ],
      cages: [{ id: 'bust', slider: 'breast', rest: [[40, 60], [60, 60], [60, 80], [40, 80]], min: [[42, 62], [58, 62], [58, 78], [42, 78]], max: [[37, 57], [63, 57], [63, 84], [37, 84]], margin: 10 }],
    }],
  });
}

describe('studio trait sheets', () => {
  it('only makes adults', () => {
    expect(() => TraitSheetSchema.parse({ name: 'X', sex: 'female', age: 17 })).toThrow();
    expect(() => TraitSheetSchema.parse({ name: 'X', sex: 'female' })).toThrow();
    expect(migrateTraitSheet({ name: 'X', sex: 'male', age: 30 }).version).toBe(1);
  });
  it('turns body type and sizes into slider values', () => {
    const s = resolvedSliders(sheet({ body: { type: 'curvy', breast: 'large', hips: 'large', sliders: { breast: 0.6 } } }));
    expect(s.breast).toBe(1); // clamped
    expect(s.hips).toBeCloseTo(1);
    expect(resolvedSliders(sheet({ body: { type: 'slim' } })).waist).toBeLessThan(0);
  });
});

describe('recolor', () => {
  it('keeps the shading and lands on the target colour at the painted base tone', () => {
    const ramp = gradientRamp('#2f5fa8', luma(hexToRgb('#3b2a22')));
    const i = Math.round(luma(hexToRgb('#3b2a22')) * 255) * 3;
    expect(Math.abs(ramp[i]! - 0x2f) + Math.abs(ramp[i + 1]! - 0x5f) + Math.abs(ramp[i + 2]! - 0xa8)).toBeLessThan(30);
    // Shadow darker than base, highlight lighter.
    expect(luma([ramp[30]!, ramp[31]!, ramp[32]!])).toBeLessThan(luma([ramp[i]!, ramp[i + 1]!, ramp[i + 2]!]));
    expect(luma([ramp[750]!, ramp[751]!, ramp[752]!])).toBeGreaterThan(luma([ramp[i]!, ramp[i + 1]!, ramp[i + 2]!]));
  });
  it('drifts nothing when recoloured to the same colour (skin shift) and respects the mask', () => {
    const px = new Uint8ClampedArray([243, 207, 182, 255, 200, 120, 120, 255, 10, 20, 30, 0]);
    const before = px.slice();
    recolorPixels(px, 'skin', '#f3cfb6', '#f3cfb6');
    expect(colorDrift(before, px)).toBeLessThan(0.5);
    const masked = before.slice();
    recolorPixels(masked, 'skin', '#f3cfb6', '#8a5a3c', new Uint8Array([0, 255, 0]));
    expect([...masked.slice(0, 4)]).toEqual([...before.slice(0, 4)]);
    expect(masked[4]).toBeLessThan(before[4]!);
  });
});

describe('cage deformation (mean-value coordinates)', () => {
  const sq: P[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  it('weights reproduce the point (linear precision) and sum to one', () => {
    for (const x of [[5, 5], [2, 7], [9, 1]] as P[]) {
      const w = meanValueWeights(x, sq);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
      expect(w.reduce((a, wi, i) => a + wi * sq[i]![0], 0)).toBeCloseTo(x[0]);
      expect(w.reduce((a, wi, i) => a + wi * sq[i]![1], 0)).toBeCloseTo(x[1]);
    }
    // Concave (an L shape): still reproduces the point.
    const L: P[] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
    const w = meanValueWeights([2, 8], L);
    expect(w.reduce((a, wi, i) => a + wi * L[i]![0], 0)).toBeCloseTo(2);
  });
  it('moves inside points with the cage, fades outside within the margin, and never tears', () => {
    const c = { rest: sq, min: sq, max: sq.map(([x, y]) => [x * 1.3 - 1.5, y * 1.3 - 1.5] as P), margin: 6, slider: 'breast' as const };
    expect(cageAt(c, 1)[2]).toEqual([11.5, 11.5]);
    const inner = cageDisplacement([10, 10], c, 1);
    expect(inner[0]).toBeCloseTo(1.5);
    expect(cageDisplacement([20, 20], c, 1)).toEqual([0, 0]);
    const near = cageDisplacement([12, 5], c, 1);
    expect(near[0]).toBeGreaterThan(0);
    expect(near[0]).toBeLessThan(1.5);
    for (const t of [-1, 1]) {
      const d = gridDistortion([-8, -8, 26, 26], [c], { breast: t }, 2);
      expect(d.min).toBeGreaterThan(0.2);
      expect(d.max).toBeLessThan(3);
    }
    const pts = new Float32Array([5, 5, 30, 30]);
    deformPoints(pts, [c], { breast: 1 });
    expect(pts[2]).toBe(30);
  });
});

describe('templates and composition', () => {
  it('validates ids, z conflicts and adult layers', () => {
    const t = fixture();
    expect(validateTemplate(t)).toEqual([]);
    const bad = structuredClone(t);
    bad.slots[0]!.layers.push({ ...bad.slots[0]!.layers[2]!, id: 'body2' });
    bad.slots[0]!.layers.push({ ...bad.slots[0]!.layers[2]!, id: 'nude', adult: true, z: 11 });
    const errs = validateTemplate(bad).join('\n');
    expect(errs).toMatch(/body and body2 share z 10/);
    expect(errs).toMatch(/nude is adult in an all-ages/);
    // The two hair layers share z but never coexist.
    expect(canCoexist({ 'hair.back': 'bob' }, { 'hair.back': 'long_straight' })).toBe(false);
    expect(() => migrateTemplate({ ...t, version: 2 })).toThrow(/version/);
  });
  it('draws the layers a sheet asks for, in z order, with z rules, recolour targets and fallbacks', () => {
    const t = fixture();
    const s = sheet({ hair: { back: 'twin_tails', front: 'bangs', color: '#c9c9cf' }, wardrobe: { top: 'blouse', bottom: 'jeans' } });
    const plan = composeSlot(t, t.slots[0]!, s, { expression: 'smile' });
    expect(plan.layers.map((l) => l.layer.id)).toEqual(['hair-back-long', 'body', 'blouse', 'smile', 'hair-front']);
    expect(plan.layers.at(-1)!.z).toBe(41);
    expect(plan.layers[0]!.recolor[0]!.target).toBe('#c9c9cf');
    expect(plan.fallbacks.join(';')).toMatch(/twin_tails → long_straight.*bottom jeans/);
    expect(effectiveTraits(t, s).values['wardrobe.bottom']).toBe('none');
    // The cache key changes with what changes pixels, not with anything else.
    const k1 = compositeKey(t, plan);
    expect(compositeKey(t, composeSlot(t, t.slots[0]!, { ...s, name: 'Other' }, { expression: 'smile' }))).toBe(k1);
    expect(compositeKey(t, composeSlot(t, t.slots[0]!, { ...s, hair: { ...s.hair, color: '#1b1b1f' } }, { expression: 'smile' }))).not.toBe(k1);
  });
  it('the same sheet resolves to the same choices in every template that has them (consistency)', () => {
    const a = fixture(), b = { ...fixture(), id: 'stand-wave' };
    const s = randomSheet({ seed: 7, sex: 'female' });
    expect(composeSlot(a, a.slots[0]!, s).layers.map((l) => l.layer.id)).toEqual(composeSlot(b, b.slots[0]!, s).layers.map((l) => l.layer.id));
    // A male sheet doesn't take a female-only slot.
    expect(composeScene(a, [randomSheet({ seed: 3, sex: 'male' })]).slots).toHaveLength(0);
  });
});

describe('random NPCs', () => {
  it('rolls coherent adults, reproducibly, keeping locked traits', () => {
    for (let i = 0; i < 200; i++) {
      const s = randomSheet({ seed: i });
      expect(s.age).toBeGreaterThanOrEqual(20);
      if (s.sex === 'male') expect(s.wardrobe.bra).toBeNull();
      if (s.body.type === 'curvy' || s.body.type === 'plus') expect(s.body.hips).not.toBe('small');
    }
    expect(randomSheet({ seed: 42 })).toEqual(randomSheet({ seed: 42 }));
    const base = randomSheet({ seed: 1, sex: 'female' });
    const re = randomSheet({ seed: 99, base, locks: ['hair', 'sex', 'name'] });
    expect(re.hair).toEqual(base.hair);
    expect(re.name).toBe(base.name);
    const outfits = [{ id: 'dress', items: { top: 'dress', bottom: null } }, { id: 'casual', items: { top: 'tee', bottom: 'jeans' } }];
    const dressed = randomSheet({ seed: 5, outfits });
    expect(['dress', 'tee']).toContain(dressed.wardrobe.top);
  });
});

describe('fill from description', () => {
  it('builds a prompt with the catalogs and maps a model answer onto a valid sheet', () => {
    const p = fillPrompt({ name: 'Mira', description: 'A tall woman with long silver hair and emerald eyes.' });
    expect(p).toMatch(/long_straight \| long_wavy/);
    const { sheet: s } = sheetFromAnswer('Mira', 'Here: {"sex":"woman","age":27,"body":{"type":"voluptuous","breast":"big","hips":"wide","skin":"pale"},"face":{"preset":"cool","eyeColor":"emerald"},"hair":{"back":"long wavy","front":"fringe","color":"silver"},"expressions":["smile","shy","nonsense"]}');
    expect(s).toMatchObject({ sex: 'female', age: 27, body: { type: 'curvy', breast: 'large', hips: 'large', skin: '#fbe3d3' }, face: { preset: 'cool', eyeColor: '#3d7a3a' }, hair: { back: 'long_wavy', front: 'bangs', color: '#c9c9cf' } });
    expect(s!.expressions).toEqual(['smile', 'shy', 'neutral']);
    expect(sheetFromAnswer('X', 'garbage').sheet!.age).toBe(25);
  });
  it('gives no sheet for a character described as under 18', () => {
    expect(sheetFromAnswer('Kid', '{"sex":"female","age":15}').sheet).toBeNull();
  });
});

describe('studio story ops', () => {
  it('sets poses and a scene with options as state (so a rollback restores them)', () => {
    const s0 = createInitialState();
    const r = applyOps(s0, [
      { type: 'studio.pose', who: 'Mira', template: 'stand-wave', expression: 'smile' },
      { type: 'studio.scene', template: 'bed-cuddle', who: ['Mira'], options: { camera: 'close' } },
      { type: 'studio.option', option: 'camera', value: 'wide' },
    ] as never);
    expect(r.errors).toEqual([]);
    expect(r.state.stage!.studio!.poses.mira).toMatchObject({ template: 'stand-wave', expression: 'smile' });
    expect(r.state.stage!.studio!.scene).toMatchObject({ template: 'bed-cuddle', options: { camera: 'wide' } });
    expect(s0.stage?.studio).toBeUndefined();
    const ended = applyOps(r.state, [{ type: 'studio.scene', template: null }, { type: 'studio.pose', who: 'Mira', template: null }] as never);
    expect(ended.state.stage!.studio).toEqual({ poses: {}, scene: null });
    expect(applyOps(createInitialState(), [{ type: 'studio.option', option: 'camera', value: 'wide' }] as never).errors).toHaveLength(1);
  });
});
