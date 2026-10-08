import { describe, expect, it } from 'vitest';
import { AvatarConfigSchema, BUILTIN_PAIRED, baseKey, baseReport, buildMorphSliders, classifyMorph, mergeMorphSliders, morphWeights, normalizeAvatarOps, resolveWardrobe, stackOrder, visibleSliders, BUILTIN_EMOTES, type BaseFacts, type SkinLayer } from '../src/index.js';

describe('morph auto-grouping', () => {
  it('classifies body, face and other shapes, with side and direction', () => {
    expect(classifyMorph('Breast large')).toMatchObject({ group: 'body', kind: 'breastSize', direction: 1 });
    expect(classifyMorph('Breast small')).toMatchObject({ group: 'body', kind: 'breastSize', direction: -1 });
    expect(classifyMorph('measure-hips-circ-incr')).toMatchObject({ kind: 'hips', direction: 1 });
    expect(classifyMorph('Butt_Big')).toMatchObject({ kind: 'butt' });
    expect(classifyMorph('l-upperarm-fat-incr')).toMatchObject({ kind: 'arms', side: 'left', direction: 1 });
    expect(classifyMorph('Thigh_R')).toMatchObject({ kind: 'thighs', side: 'right' });
    expect(classifyMorph('eyeBlinkLeft')).toMatchObject({ group: 'face', side: 'left', expression: true });
    expect(classifyMorph('Fcl_MTH_A')).toMatchObject({ group: 'face', expression: true });
    expect(classifyMorph('Nose_Width')).toMatchObject({ group: 'face', expression: false });
    expect(classifyMorph('Pussy flat')).toMatchObject({ group: 'other', adult: true, kind: null });
    expect(classifyMorph('Chin')).toMatchObject({ group: 'face', stem: 'chin' });
  });

  it('merges grow/shrink pairs into one two-way slider and pairs left with right', () => {
    const sliders = buildMorphSliders(['Breast large', 'Breast small', 'Pussy flat', 'l-upperarm-fat-incr', 'l-upperarm-fat-decr', 'r-upperarm-fat-incr', 'r-upperarm-fat-decr', 'eyeBlinkLeft', 'Hips_Wide', 'EverloomBody_chest']);
    const breast = sliders.find((s) => s.kind === 'breastSize')!;
    expect(breast).toMatchObject({ label: 'Breast size', plus: ['Breast large'], minus: ['Breast small'], min: -1, max: 1, group: 'body' });
    const left = sliders.find((s) => s.plus[0] === 'l-upperarm-fat-incr')!;
    const right = sliders.find((s) => s.plus[0] === 'r-upperarm-fat-incr')!;
    expect(left.minus).toEqual(['l-upperarm-fat-decr']);
    expect(left.pair).toBe(right.id);
    expect(right.pair).toBe(left.id);
    expect(sliders.find((s) => s.plus[0] === 'eyeBlinkLeft')).toMatchObject({ hidden: true, expression: true });
    expect(sliders.find((s) => s.plus[0] === 'Pussy flat')).toMatchObject({ adult: true, group: 'other' });
    // Generated fallback morphs have their own controls.
    expect(sliders.some((s) => s.plus.includes('EverloomBody_chest'))).toBe(false);
    // Body first.
    expect(sliders[0]!.group).toBe('body');
    expect(new Set(sliders.map((s) => s.id)).size).toBe(sliders.length);
  });

  it('drives the right morphs in both directions and clamps to the range', () => {
    const sliders = buildMorphSliders(['Breast large', 'Breast small', 'Muscular']);
    const breast = sliders.find((s) => s.kind === 'breastSize')!;
    const muscle = sliders.find((s) => s.kind === 'muscle')!;
    expect(morphWeights(sliders, { [breast.id]: 0.6 })).toMatchObject({ 'Breast large': 0.6, 'Breast small': 0 });
    expect(morphWeights(sliders, { [breast.id]: -0.4 })).toMatchObject({ 'Breast large': 0, 'Breast small': 0.4 });
    expect(morphWeights(sliders, { [muscle.id]: 5 })).toMatchObject({ Muscular: 1 });
    expect(morphWeights(sliders, { [muscle.id]: -5 })).toMatchObject({ Muscular: 0 });
  });

  it('keeps the owner\'s edits when the model is read again', () => {
    const first = buildMorphSliders(['Breast large', 'Breast small', 'Belly_Out']);
    const edited = first.map((s) => (s.kind === 'belly' ? { ...s, label: 'Tummy', group: 'other' as const, max: 1.5 } : s));
    const merged = mergeMorphSliders(edited, ['Breast large', 'Breast small', 'Belly_Out', 'Waist_Thin']);
    expect(merged.find((s) => s.plus[0] === 'Belly_Out')).toMatchObject({ label: 'Tummy', group: 'other', max: 1.5 });
    expect(merged.some((s) => s.plus[0] === 'Waist_Thin')).toBe(true);
    expect(mergeMorphSliders(edited, ['Belly_Out']).some((s) => s.kind === 'breastSize')).toBe(false);
  });

  it('hides explicit sliders unless adult content is allowed', () => {
    const sliders = buildMorphSliders(['Breast large', 'Pussy flat']);
    expect(visibleSliders(sliders, { adultAllowed: false }).some((s) => s.adult)).toBe(false);
    expect(visibleSliders(sliders, { adultAllowed: true }).some((s) => s.adult)).toBe(true);
  });

  it('identifies a base by its morphs, bones and vertex count, in any order', () => {
    const a = baseKey({ morphs: ['b', 'a'], bones: ['Hips', 'Spine'], vertices: 10 });
    expect(baseKey({ morphs: ['a', 'b'], bones: ['Spine', 'Hips'], vertices: 10 })).toBe(a);
    expect(baseKey({ morphs: ['a', 'b'], bones: ['Spine', 'Hips'], vertices: 11 })).not.toBe(a);
  });
});

const facts = (over: Partial<BaseFacts> = {}): BaseFacts => ({
  mapped: { hips: 'Hips', spine: 'Spine', chest: 'Chest', head: 'Head', leftUpperArm: 'Arm_L', leftLowerArm: 'ForeArm_L', leftHand: 'Hand_L', rightUpperArm: 'Arm_R', rightLowerArm: 'ForeArm_R', rightHand: 'Hand_R', leftUpperLeg: 'Leg_L', leftLowerLeg: 'Knee_L', leftFoot: 'Foot_L', rightUpperLeg: 'Leg_R', rightLowerLeg: 'Knee_R', rightFoot: 'Foot_R' },
  boneCount: 65, extraBones: ['Breast_L', 'Breast_R', 'Booty_L'], morphs: ['Breast large', 'Breast small'], meshes: 1, skinnedMeshes: 1, unskinned: [], vertices: 111018, triangles: 37006,
  textures: [{ name: 'skin', width: 4096, height: 4096 }], hasUv: true, height: 1.49, autoFit: false, ...over,
});

describe('base model report', () => {
  it('reports what a base has, and turns features on', () => {
    const r = baseReport(facts());
    expect(r.features.animation.on).toBe(true);
    expect(r.features.bodySliders.on).toBe(true);
    expect(r.features.chestPhysics.on).toBe(true);
    expect(r.features.fingers.on).toBe(false);
    expect(r.bodyKinds).toEqual(['breastSize']);
    expect(r.missingBodyKinds).toEqual(['hips', 'waist', 'butt', 'thighs', 'shoulders']);
    const text = r.lines.map((l) => `${l.title} ${l.detail}`).join('\n');
    expect(text).toContain('65 bones');
    expect(text).toContain('Breast size');
    expect(text).toContain('scaled to 2048 px');
    expect(text).toContain('Generated adjusters can stand in');
  });

  it('explains what a base without morphs or bones lacks, and switches those features off', () => {
    const r = baseReport(facts({ morphs: [], mapped: { hips: 'Hips', head: 'Head' }, extraBones: [], skinnedMeshes: 0, unskinned: ['Body'], textures: [] }));
    expect(r.features.animation).toMatchObject({ on: false });
    expect(r.features.animation.why).toContain('leftUpperArm');
    expect(r.features.bodySliders.on).toBe(false);
    expect(r.features.fitting.on).toBe(false);
    const text = r.lines.map((l) => `${l.title} ${l.detail}`).join('\n');
    expect(text).toContain('No morph targets');
    expect(text).toContain('Generated adjusters');
    expect(text).toContain('No skinned mesh');
    expect(r.lines.some((l) => l.tone === 'off')).toBe(true);
  });

  it('flags explicit shapes as adults only', () => {
    const r = baseReport(facts({ morphs: ['Breast large', 'Pussy flat'] }));
    expect(r.lines.find((l) => l.title.includes('adults only'))?.detail).toContain('Pussy flat');
  });
});

describe('skin layers in the wardrobe', () => {
  const layer = (id: string, kind: SkinLayer['kind'], extra: Partial<SkinLayer> = {}): SkinLayer => ({ id, name: id, kind, image: null, normal: null, roughness: null, tint: null, opacity: 1, decal: null, on: true, slot: null, items: [], adult: false, ...extra });
  const cfg = AvatarConfigSchema.parse({
    skinLayers: [layer('tattoo1', 'tattoo'), layer('briefs', 'underwear', { slot: 'underwear' }), layer('swim', 'swimwear', { on: false, items: ['Swimsuit'] }), layer('scar', 'scar')],
    outfits: [{ id: 'beach', name: 'Beach', layers: ['swim'] }],
  });

  it('paints decoration as set and clothing layers by outfit and items', () => {
    expect(resolveWardrobe(cfg).layers.map((l) => l.id)).toEqual(['tattoo1', 'briefs', 'scar']);
    // The beach outfit swaps the underwear for the swimsuit; tattoos stay.
    expect(resolveWardrobe(cfg, { story: 'Beach' }).layers.map((l) => l.id)).toEqual(['tattoo1', 'swim', 'scar']);
    expect(resolveWardrobe(cfg, { equipped: ['swimsuit'] }).layers.map((l) => l.id)).toContain('swim');
  });

  it('stacks layers in painting order', () => {
    expect(stackOrder([layer('a', 'scar'), layer('b', 'makeup'), layer('c', 'tattoo'), layer('d', 'makeup')]).map((l) => l.id)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('reads old saved settings unchanged', () => {
    const old = AvatarConfigSchema.parse({ physics: { enabled: false, stiffness: 2, gravity: 0.5 } });
    expect(old.physics).toMatchObject({ enabled: false, stiffness: 2, gravity: 0.5, chest: { enabled: true, strength: 1 }, chains: [] });
    expect(old.skinLayers).toEqual([]);
    expect(old.morphs).toBeUndefined();
  });
});

describe('paired animation ops', () => {
  it('resolves installed paired clips by name and checks the number of characters', () => {
    const r = normalizeAvatarOps([
      { type: 'avatar.paired', clip: 'shake hands', who: ['Mara', 'Theo'] },
      { type: 'avatar.paired', clip: 'handshake', who: ['Mara', 'Theo', 'Pip'] },
      { type: 'avatar.paired', clip: 'tango', who: ['Mara', 'Theo'] },
    ] as Array<{ type: string; clip: string; who: string[] }>, BUILTIN_EMOTES, BUILTIN_PAIRED);
    expect(r.ok).toEqual([{ type: 'avatar.paired', clip: 'handshake', who: ['Mara', 'Theo'] }]);
    expect(r.rejected.map((x) => x.reason)).toEqual(['Handshake needs 2 characters', 'No paired animation called "tango"']);
  });
});
