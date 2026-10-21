/**
 * Auto-rig: builds a Puppets v2 character (a Rev2D model) from keypoints and layers. Every layer
 * becomes a textured grid mesh skinned to the standard bones its role names, the body gets IK for
 * arms and legs (feet locked by default), breast/butt/hair physics, draw-order switches for the
 * arms, and the motion library compiled for its proportions (motions.ts).
 */
import { z } from 'zod';
import type { Model, ModelInput } from './rev2d/types.js';
import { formatDiagnostics, validateModel } from './rev2d/validate.js';
import { buildSkeleton, KeypointsSchema, normAngle, proportions, type BuiltBone, type Keypoints } from './skeleton.js';
import { compileMotions, MOTIONS } from './motions.js';

/** What a layer is: decides the bones its mesh is skinned to and where it is drawn. */
export const LAYER_ROLES = {
  // Body
  hair_back: { skin: ['head', 'hair'], z: 5 },
  leg_L: { skin: ['pelvis', 'thigh_L', 'shin_L'], z: 10 }, leg_R: { skin: ['pelvis', 'thigh_R', 'shin_R'], z: 10 },
  thigh_L: { skin: ['pelvis', 'thigh_L', 'shin_L'], z: 11 }, thigh_R: { skin: ['pelvis', 'thigh_R', 'shin_R'], z: 11 },
  shin_L: { skin: ['thigh_L', 'shin_L', 'foot_L'], z: 10 }, shin_R: { skin: ['thigh_R', 'shin_R', 'foot_R'], z: 10 },
  foot_L: { skin: ['shin_L', 'foot_L'], z: 12 }, foot_R: { skin: ['shin_R', 'foot_R'], z: 12 },
  butt_L: { skin: ['butt_L'], z: 14 }, butt_R: { skin: ['butt_R'], z: 14 },
  torso: { skin: ['pelvis', 'spine', 'chest'], z: 20 },
  neck: { skin: ['chest', 'neck'], z: 21 },
  breast_L: { skin: ['breast_L'], z: 24 }, breast_R: { skin: ['breast_R'], z: 24 },
  head: { skin: ['head'], z: 30 },
  face: { skin: ['head'], z: 31 },
  hair_front: { skin: ['head', 'hair'], z: 40 },
  // Arms: drawn in front of the body by default; ArmBack_L/R moves an arm behind it.
  upperarm_L: { skin: ['shoulder_L', 'upperarm_L', 'forearm_L'], z: 50 }, upperarm_R: { skin: ['shoulder_R', 'upperarm_R', 'forearm_R'], z: 50 },
  forearm_L: { skin: ['upperarm_L', 'forearm_L', 'hand_L'], z: 51 }, forearm_R: { skin: ['upperarm_R', 'forearm_R', 'hand_R'], z: 51 },
  arm_L: { skin: ['shoulder_L', 'upperarm_L', 'forearm_L'], z: 51 }, arm_R: { skin: ['shoulder_R', 'upperarm_R', 'forearm_R'], z: 51 },
  hand_L: { skin: ['forearm_L', 'hand_L'], z: 52 }, hand_R: { skin: ['forearm_R', 'hand_R'], z: 52 },
  // Clothing: bound to the same bones as the body it covers, a little above it.
  // Over the torso (whose picture holds the underwear), under the top.
  bottomwear: { skin: ['pelvis', 'thigh_L', 'thigh_R'], z: 22 },
  /** A skirt (or a dress's lower half): on the pelvis and its own swinging bone, not on the thighs. */
  skirt: { skin: ['pelvis', 'skirt'], z: 23 },
  legwear_L: { skin: ['pelvis', 'thigh_L', 'shin_L'], z: 13 }, legwear_R: { skin: ['pelvis', 'thigh_R', 'shin_R'], z: 13 },
  footwear_L: { skin: ['shin_L', 'foot_L'], z: 15 }, footwear_R: { skin: ['shin_R', 'foot_R'], z: 15 },
  topwear: { skin: ['pelvis', 'spine', 'chest'], z: 27 },
  /** The part of a top over each breast (a soft-edged copy), so the top moves with the bust. */
  chestwear_L: { skin: ['breast_L'], z: 28 }, chestwear_R: { skin: ['breast_R'], z: 28 },
  sleeve_upper_L: { skin: ['shoulder_L', 'upperarm_L', 'forearm_L'], z: 53 }, sleeve_upper_R: { skin: ['shoulder_R', 'upperarm_R', 'forearm_R'], z: 53 },
  sleeve_lower_L: { skin: ['upperarm_L', 'forearm_L', 'hand_L'], z: 54 }, sleeve_lower_R: { skin: ['upperarm_R', 'forearm_R', 'hand_R'], z: 54 },
  handwear_L: { skin: ['forearm_L', 'hand_L'], z: 55 }, handwear_R: { skin: ['forearm_R', 'hand_R'], z: 55 },
  headwear: { skin: ['head'], z: 45 },
  other: { skin: ['chest'], z: 60 },
} as const satisfies Record<string, { skin: readonly string[]; z: number }>;
export type LayerRole = keyof typeof LAYER_ROLES;

/**
 * Sprite swaps: a layer with a `variant` is an overlay shown only when its parameter says so (the
 * picture's changed pixels: closed eyes, a mouth shape, a smile, a waving hand). Faces are not
 * deformed; they swap, which is what 2D art does best.
 */
export const VARIANTS = {
  eyes_closed: { param: 'EyeClose', index: 1 },
  mouth_a: { param: 'Mouth', index: 1 }, mouth_i: { param: 'Mouth', index: 2 }, mouth_u: { param: 'Mouth', index: 3 }, mouth_e: { param: 'Mouth', index: 4 }, mouth_o: { param: 'Mouth', index: 5 },
  smile: { param: 'Expression', index: 1 }, angry: { param: 'Expression', index: 2 }, sad: { param: 'Expression', index: 3 }, surprised: { param: 'Expression', index: 4 }, blush: { param: 'Expression', index: 5 }, cry: { param: 'Expression', index: 6 },
  laugh: { param: 'Expression', index: 7 }, smug: { param: 'Expression', index: 8 }, pouting: { param: 'Expression', index: 9 }, wink: { param: 'Expression', index: 10 }, sleepy: { param: 'Expression', index: 11 },
  scared: { param: 'Expression', index: 12 }, determined: { param: 'Expression', index: 13 }, lovestruck: { param: 'Expression', index: 14 }, embarrassed: { param: 'Expression', index: 15 }, disgusted: { param: 'Expression', index: 16 },
  open: { param: 'HandPose', index: 1 }, wave: { param: 'HandPose', index: 2 }, fist: { param: 'HandPose', index: 3 }, point: { param: 'HandPose', index: 4 },
} as const;
export type Variant = keyof typeof VARIANTS;
/** Expression names (the story's emotions map onto these indices of the Expression parameter). */
export const EXPRESSIONS = ['neutral', 'smile', 'angry', 'sad', 'surprised', 'blush', 'cry', 'laugh', 'smug', 'pouting', 'wink', 'sleepy', 'scared', 'determined', 'lovestruck', 'embarrassed', 'disgusted'] as const;

export const LayerSchema = z.object({
  id: z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]*$/),
  role: z.enum(Object.keys(LAYER_ROLES) as [LayerRole, ...LayerRole[]]),
  /** Texture id (a PNG next to the model, or a data URI) and the layer's rectangle in canvas pixels. */
  texture: z.string(),
  rect: z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]),
  /** Mesh resolution: more cells bend more smoothly at joints. */
  cols: z.number().int().min(1).max(32).optional(),
  rows: z.number().int().min(1).max(64).optional(),
  z: z.number().optional(),
  /** Overrides the role's bones. */
  skin: z.array(z.string()).optional(),
  /** Clothing items belong to an outfit set (wardrobe), body layers don't. */
  outfit: z.string().optional(),
  /** Only drawn in the 18+ state (nude base layers): the server's minor guard decides whether it may be shown. */
  adult: z.boolean().optional(),
  /** A sprite swap (VARIANTS): hidden unless its parameter selects it. */
  variant: z.enum(Object.keys(VARIANTS) as [Variant, ...Variant[]]).optional(),
});
export type Layer = z.infer<typeof LayerSchema>;

export const CharacterInputSchema = z.object({
  name: z.string().max(80),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  keypoints: KeypointsSchema,
  layers: z.array(LayerSchema).min(1),
  textures: z.array(z.object({ id: z.string(), path: z.string(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional() })),
  physics: z.object({ bust: z.number().min(0).max(2).default(1), butt: z.number().min(0).max(2).default(1), hair: z.number().min(0).max(2).default(1) }).default({ bust: 1, butt: 1, hair: 1 }),
});
export type CharacterInput = z.input<typeof CharacterInputSchema>;

/** In profile (facing left) both knees bend forward. */
const SIDE_KNEE_BEND = false;

const has = (bones: BuiltBone[], id: string) => bones.some((b) => b.id === id);

export function buildCharacter(input: CharacterInput): Model {
  const ch = CharacterInputSchema.parse(input);
  const { bones, world } = buildSkeleton(ch.keypoints as Keypoints);
  const view = ch.keypoints.view;
  const P = proportions(bones);
  const H = P.height;
  // Swinging bones the keypoints don't give: hair from the top of the head, a skirt from the pelvis.
  const child = (id: string, parent: string, at: [number, number], angle: number, length: number) => {
    const pw = world[parent]!, r = (-pw.a * Math.PI) / 180, dx = at[0] - pw.x, dy = at[1] - pw.y;
    bones.push({ id, parent, x: dx * Math.cos(r) - dy * Math.sin(r), y: dx * Math.sin(r) + dy * Math.cos(r), rotation: normAngle(angle - pw.a), length });
  };
  const kp = ch.keypoints;
  child('hair', 'head', [kp.headTop[0], kp.headTop[1]], 90, 0.12 * H);
  child('skirt', 'pelvis', [kp.pelvis[0], (kp.hip_L[1] + kp.hip_R[1]) / 2], 90, 0.6 * (bones.find((b) => b.id === 'thigh_L')?.length ?? 0.2 * H));
  const parameters: NonNullable<ModelInput['parameters']> = [
    { id: 'BodyX', min: -1, max: 1, default: 0, group: 'Body', description: 'Body sideways: ±0.1 × height' },
    { id: 'BodyY', min: -1, max: 1, default: 0, group: 'Body', description: 'Body up (+) / down (−): ±0.06 × height' },
    { id: 'BodyAngleZ', min: -10, max: 10, default: 0, group: 'Body', description: 'Upper body lean (degrees)' },
    { id: 'Breath', min: 0, max: 1, default: 0, group: 'Body' },
    { id: 'ArmBack_L', min: 0, max: 1, default: 0, group: 'Draw order', description: '1 = the left arm behind the body' },
    { id: 'ArmBack_R', min: 0, max: 1, default: 0, group: 'Draw order', description: '1 = the right arm behind the body' },
    { id: 'ArmOver_R', min: 0, max: 1, default: 0, group: 'Draw order', description: '1 = the right arm over the left (crossing)' },
    { id: 'LegIk_L', min: 0, max: 1, default: 1, group: 'IK', description: 'Left foot locked to its target' },
    { id: 'LegIk_R', min: 0, max: 1, default: 1, group: 'IK' },
    { id: 'ArmIk_L', min: 0, max: 1, default: 0, group: 'IK', description: 'Left hand reaches its target' },
    { id: 'ArmIk_R', min: 0, max: 1, default: 0, group: 'IK' },
    { id: 'BustY', min: -1, max: 1, default: 0, group: 'Physics' }, { id: 'BustX', min: -1, max: 1, default: 0, group: 'Physics' },
    { id: 'ButtY', min: -1, max: 1, default: 0, group: 'Physics' },
    { id: 'HairX', min: -1, max: 1, default: 0, group: 'Physics' },
    { id: 'SkirtX', min: -1, max: 1, default: 0, group: 'Physics' }, { id: 'SkirtY', min: -1, max: 1, default: 0, group: 'Physics' },
    { id: 'EyeClose', min: 0, max: 1, default: 0, group: 'Face', description: 'Blink (1 = eyes closed)' },
    { id: 'Mouth', min: 0, max: 5, default: 0, group: 'Face', description: 'Mouth shape: 0 closed, 1 A, 2 I, 3 U, 4 E, 5 O' },
    { id: 'Expression', min: 0, max: EXPRESSIONS.length - 1, default: 0, group: 'Face', description: EXPRESSIONS.map((e, i) => `${i} ${e}`).join(', ') },
    { id: 'HandPose_L', min: 0, max: 4, default: 0, group: 'Hands', description: '0 as drawn, 1 open, 2 wave, 3 fist, 4 point' },
    { id: 'HandPose_R', min: 0, max: 4, default: 0, group: 'Hands' },
  ];
  const parts: NonNullable<ModelInput['parts']> = ch.layers.map((l) => {
    const role = LAYER_ROLES[l.role];
    const skinBones = (l.skin ?? [...role.skin]).filter((b) => has(bones, b));
    const [x, y, w, h] = l.rect;
    const cols = l.cols ?? Math.max(2, Math.min(16, Math.round(w / Math.max(24, 0.02 * H))));
    const rows = l.rows ?? Math.max(2, Math.min(48, Math.round(h / Math.max(16, 0.015 * H))));
    const base = { id: l.id, z: l.z ?? role.z + (l.variant ? 3 : 0), ...(l.variant ? { opacity: 0 } : {}), shape: { type: 'image' as const, texture: l.texture, x, y, w, h, cols, rows } };
    if (skinBones.length <= 1) return { ...base, parent: skinBones[0] ?? 'chest' };
    return { ...base, skin: { bones: skinBones, weights: 'auto' as const, falloff: 3 } };
  });
  // Draw order: arms behind the body, or the right arm over the left.
  const bindings: NonNullable<ModelInput['bindings']> = [];
  for (const l of ch.layers) {
    const side = /_(L|R)$/.exec(l.role)?.[1];
    if (!side || !/^(upperarm|forearm|arm|hand|sleeve_upper|sleeve_lower|handwear)_/.test(l.role)) continue;
    const z0 = l.z ?? LAYER_ROLES[l.role].z;
    bindings.push({ target: `part:${l.id}.z`, params: [`ArmBack_${side}`], keys: [{ at: [0], value: z0 }, { at: [1], value: z0 - 45 }] });
    if (side === 'R') bindings.push({ target: `part:${l.id}.z`, params: ['ArmOver_R'], keys: [{ at: [0], value: z0 }, { at: [1], value: z0 + 10 }] });
  }
  const bone = (id: string) => bones.find((b) => b.id === id)!;
  const pel = bone('pelvis');
  bindings.push({ target: 'bone:pelvis.y', params: ['BodyY'], keys: [{ at: [-1], value: pel.y + 0.06 * H }, { at: [0], value: pel.y }, { at: [1], value: pel.y - 0.06 * H }] });
  bindings.push({ target: 'bone:pelvis.x', params: ['BodyX'], keys: [{ at: [-1], value: pel.x - 0.1 * H }, { at: [0], value: pel.x }, { at: [1], value: pel.x + 0.1 * H }] });
  const sp = bone('spine');
  bindings.push({ target: 'bone:spine.rotation', params: ['BodyAngleZ'], keys: [{ at: [-10], value: sp.rotation - 10 }, { at: [0], value: sp.rotation }, { at: [10], value: sp.rotation + 10 }] });
  bindings.push({ target: 'bone:chest.scaleX', params: ['Breath'], keys: [{ at: [0], value: 1 }, { at: [1], value: 1.012 }] });
  for (const s of ['L', 'R']) {
    bindings.push({ target: `ik:legIk_${s}.mix`, params: [`LegIk_${s}`], keys: [{ at: [0], value: 0 }, { at: [1], value: 1 }] });
    bindings.push({ target: `ik:armIk_${s}.mix`, params: [`ArmIk_${s}`], keys: [{ at: [0], value: 0 }, { at: [1], value: 1 }] });
    if (has(bones, `breast_${s}`)) {
      const b = bone(`breast_${s}`);
      // The bone points down: its local +x is down, +y sideways. Bounce = along x, sway = along y.
      bindings.push({ target: `bone:breast_${s}.x`, params: ['BustY'], keys: [{ at: [-1], value: b.x - 0.022 * H }, { at: [0], value: b.x }, { at: [1], value: b.x + 0.022 * H }] });
      bindings.push({ target: `bone:breast_${s}.y`, params: ['BustX'], keys: [{ at: [-1], value: b.y - 0.012 * H }, { at: [0], value: b.y }, { at: [1], value: b.y + 0.012 * H }] });
      bindings.push({ target: `bone:breast_${s}.scaleX`, params: ['BustY'], keys: [{ at: [-1], value: 0.9 }, { at: [0], value: 1 }, { at: [1], value: 1.08 }] });
    }
    if (has(bones, `butt_${s}`)) {
      const b = bone(`butt_${s}`);
      bindings.push({ target: `bone:butt_${s}.x`, params: ['ButtY'], keys: [{ at: [-1], value: b.x - 0.018 * H }, { at: [0], value: b.x }, { at: [1], value: b.x + 0.018 * H }] });
      bindings.push({ target: `bone:butt_${s}.scaleX`, params: ['ButtY'], keys: [{ at: [-1], value: 0.93 }, { at: [0], value: 1 }, { at: [1], value: 1.06 }] });
    }
  }
  // Sprite swaps: a variant shows at its index of its parameter (step: no half-blended faces). A hand
  // with variants hides the drawn hand while one of them is on.
  const sideOf = (role: string) => /_(L|R)$/.exec(role)?.[1];
  for (const l of ch.layers) {
    if (!l.variant) continue;
    const v = VARIANTS[l.variant];
    const param = v.param === 'HandPose' ? `HandPose_${sideOf(l.role) ?? 'L'}` : v.param;
    const max = parameters.find((p) => p.id === param)!.max!;
    const keys = Array.from({ length: max + 1 }, (_, i) => ({ at: [i], value: i === v.index ? 1 : 0 }));
    bindings.push({ target: `part:${l.id}.opacity`, params: [param], keys, interpolation: param === 'EyeClose' ? 'linear' : 'step' });
  }
  for (const s of ['L', 'R']) {
    if (!ch.layers.some((l) => l.variant && VARIANTS[l.variant].param === 'HandPose' && sideOf(l.role) === s)) continue;
    for (const l of ch.layers) {
      if (l.variant || l.role !== `hand_${s}`) continue;
      bindings.push({ target: `part:${l.id}.opacity`, params: [`HandPose_${s}`], keys: [0, 1, 2, 3, 4].map((i) => ({ at: [i], value: i === 0 ? 1 : 0 })), interpolation: 'step' });
    }
  }
  const hair = bone('hair'), skirt = bone('skirt');
  bindings.push({ target: 'bone:hair.rotation', params: ['HairX'], keys: [{ at: [-1], value: hair.rotation - 9 }, { at: [0], value: hair.rotation }, { at: [1], value: hair.rotation + 9 }] });
  bindings.push({ target: 'bone:skirt.rotation', params: ['SkirtX'], keys: [{ at: [-1], value: skirt.rotation - 7 }, { at: [0], value: skirt.rotation }, { at: [1], value: skirt.rotation + 7 }] });
  bindings.push({ target: 'bone:skirt.scaleX', params: ['SkirtY'], keys: [{ at: [-1], value: 0.95 }, { at: [0], value: 1 }, { at: [1], value: 1.05 }] });

  const ik: NonNullable<ModelInput['ik']> = [];
  // The bend side follows the drawing (bendPositive = the lower bone turns clockwise from the upper
  // one), so the rest pose is exactly the picture; a straight limb takes the preferred side
  // (knees and elbows outward in front views, knees forward in profile).
  // In profile a standing leg is often drawn a few degrees overstretched (the knee a little back):
  // only a clearly bent knee is followed there, or the walk would fold the knees backwards.
  const bendSide = (lower: string, preferred: boolean, straight = 1) => { const r = bone(lower).rotation; return Math.abs(r) < straight ? preferred : r > 0; };
  for (const s of ['L', 'R']) {
    ik.push({ id: `legIk_${s}`, bones: [`thigh_${s}`, `shin_${s}`], target: `footTarget_${s}`, mix: 1, bendPositive: bendSide(`shin_${s}`, view === 'side' ? SIDE_KNEE_BEND : s === 'L', view === 'side' ? 15 : 1), stretch: true, softness: 0 });
    ik.push({ id: `armIk_${s}`, bones: [`upperarm_${s}`, `forearm_${s}`], target: `handTarget_${s}`, mix: 0, bendPositive: bendSide(`forearm_${s}`, s === 'L'), softness: 0.02 * H });
  }
  // Physics: pendulums moved by the body's motion, whose swing drives the bounce parameters. Rev2D's
  // pendulum segments are rigid, so a vertical bob would not swing a hanging one: the bounce pendulums
  // take the body's vertical motion sideways instead (the same damped spring, on a free axis).
  const physics: NonNullable<ModelInput['physics']> = [];
  type In = NonNullable<ModelInput['physics']>[number]['inputs'][number];
  const bob: In = { param: 'BodyY', type: 'x', weight: -0.06 * H };
  const sway: In[] = [{ param: 'BodyX', type: 'x', weight: 0.1 * H }, { param: 'BodyAngleZ', type: 'angle', weight: 1 }];
  const pend = (id: string, out: string, inputs: In[], strength: number, length: number, stiffness: number, damping: number) => {
    if (strength <= 0) return;
    physics.push({ id, inputs, outputs: [{ param: out, type: 'x', scale: (strength * 1.4) / length }], segments: [{ length, mass: 1 }], gravity: 980, damping, stiffness });
  };
  if (has(bones, 'breast_L')) { pend('bust', 'BustY', [bob], ch.physics.bust, 0.05 * H, 60, 0.1); pend('bustSway', 'BustX', sway, ch.physics.bust, 0.05 * H, 50, 0.12); }
  if (has(bones, 'butt_L')) pend('butt', 'ButtY', [bob], ch.physics.butt, 0.05 * H, 70, 0.12);
  pend('hair', 'HairX', sway, ch.physics.hair, 0.08 * H, 10, 0.06);
  if (ch.layers.some((l) => l.role === 'skirt')) { pend('skirt', 'SkirtX', sway, ch.physics.hair, 0.07 * H, 30, 0.1); pend('skirtBob', 'SkirtY', [bob], ch.physics.hair, 0.06 * H, 50, 0.12); }
  const model: ModelInput = {
    format: 'rev2d', version: 1,
    meta: { name: ch.name, width: ch.width, height: ch.height, background: 'transparent', fps: 30 },
    parameters, textures: ch.textures, bones: bones.map((b) => ({ id: b.id, parent: b.parent, x: b.x, y: b.y, rotation: b.rotation, length: b.length })),
    warps: [], parts, bindings, ik, physics,
    animations: compileMotions(MOTIONS, bones, P, view),
  };
  const r = validateModel(model);
  if (!r.model) throw new Error(`auto-rig produced an invalid model:\n${formatDiagnostics(r.diagnostics)}`);
  return r.model;
}
