/**
 * Auto-rig: builds a Puppets v2 character (a Rev2D model) from keypoints and layers. Every layer
 * becomes a textured grid mesh skinned to the standard bones its role names, the body gets IK for
 * arms and legs (feet locked by default), breast/butt/hair physics, draw-order switches for the
 * arms, and the motion library compiled for its proportions (motions.ts).
 */
import { z } from 'zod';
import type { Model, ModelInput } from './rev2d/types.js';
import { formatDiagnostics, validateModel } from './rev2d/validate.js';
import { buildSkeleton, KeypointsSchema, proportions, type BuiltBone, type Keypoints } from './skeleton.js';
import { compileMotions, MOTIONS } from './motions.js';

/** What a layer is: decides the bones its mesh is skinned to and where it is drawn. */
export const LAYER_ROLES = {
  // Body
  hair_back: { skin: ['head'], z: 5 },
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
  hair_front: { skin: ['head'], z: 40 },
  // Arms: drawn in front of the body by default; ArmBack_L/R moves an arm behind it.
  upperarm_L: { skin: ['shoulder_L', 'upperarm_L', 'forearm_L'], z: 50 }, upperarm_R: { skin: ['shoulder_R', 'upperarm_R', 'forearm_R'], z: 50 },
  forearm_L: { skin: ['upperarm_L', 'forearm_L', 'hand_L'], z: 51 }, forearm_R: { skin: ['upperarm_R', 'forearm_R', 'hand_R'], z: 51 },
  arm_L: { skin: ['shoulder_L', 'upperarm_L', 'forearm_L'], z: 51 }, arm_R: { skin: ['shoulder_R', 'upperarm_R', 'forearm_R'], z: 51 },
  hand_L: { skin: ['forearm_L', 'hand_L'], z: 52 }, hand_R: { skin: ['forearm_R', 'hand_R'], z: 52 },
  // Clothing: bound to the same bones as the body it covers, a little above it.
  bottomwear: { skin: ['pelvis', 'thigh_L', 'thigh_R'], z: 16 },
  legwear_L: { skin: ['pelvis', 'thigh_L', 'shin_L'], z: 13 }, legwear_R: { skin: ['pelvis', 'thigh_R', 'shin_R'], z: 13 },
  footwear_L: { skin: ['shin_L', 'foot_L'], z: 15 }, footwear_R: { skin: ['shin_R', 'foot_R'], z: 15 },
  topwear: { skin: ['pelvis', 'spine', 'chest'], z: 27 },
  sleeve_upper_L: { skin: ['shoulder_L', 'upperarm_L', 'forearm_L'], z: 53 }, sleeve_upper_R: { skin: ['shoulder_R', 'upperarm_R', 'forearm_R'], z: 53 },
  sleeve_lower_L: { skin: ['upperarm_L', 'forearm_L', 'hand_L'], z: 54 }, sleeve_lower_R: { skin: ['upperarm_R', 'forearm_R', 'hand_R'], z: 54 },
  handwear_L: { skin: ['forearm_L', 'hand_L'], z: 55 }, handwear_R: { skin: ['forearm_R', 'hand_R'], z: 55 },
  headwear: { skin: ['head'], z: 45 },
  other: { skin: ['chest'], z: 60 },
} as const satisfies Record<string, { skin: readonly string[]; z: number }>;
export type LayerRole = keyof typeof LAYER_ROLES;

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
  const { bones } = buildSkeleton(ch.keypoints as Keypoints);
  const view = ch.keypoints.view;
  const P = proportions(bones);
  const H = P.height;
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
  ];
  const parts: NonNullable<ModelInput['parts']> = ch.layers.map((l) => {
    const role = LAYER_ROLES[l.role];
    const skinBones = (l.skin ?? [...role.skin]).filter((b) => has(bones, b));
    const [x, y, w, h] = l.rect;
    const cols = l.cols ?? Math.max(2, Math.min(16, Math.round(w / Math.max(24, 0.02 * H))));
    const rows = l.rows ?? Math.max(2, Math.min(48, Math.round(h / Math.max(16, 0.015 * H))));
    const base = { id: l.id, z: l.z ?? role.z, shape: { type: 'image' as const, texture: l.texture, x, y, w, h, cols, rows } };
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
      bindings.push({ target: `bone:breast_${s}.x`, params: ['BustY'], keys: [{ at: [-1], value: b.x - 0.012 * H }, { at: [0], value: b.x }, { at: [1], value: b.x + 0.012 * H }] });
      bindings.push({ target: `bone:breast_${s}.y`, params: ['BustX'], keys: [{ at: [-1], value: b.y - 0.008 * H }, { at: [0], value: b.y }, { at: [1], value: b.y + 0.008 * H }] });
      bindings.push({ target: `bone:breast_${s}.scaleX`, params: ['BustY'], keys: [{ at: [-1], value: 0.94 }, { at: [0], value: 1 }, { at: [1], value: 1.05 }] });
    }
    if (has(bones, `butt_${s}`)) {
      const b = bone(`butt_${s}`);
      bindings.push({ target: `bone:butt_${s}.x`, params: ['ButtY'], keys: [{ at: [-1], value: b.x - 0.008 * H }, { at: [0], value: b.x }, { at: [1], value: b.x + 0.008 * H }] });
    }
  }
  const ik: NonNullable<ModelInput['ik']> = [];
  for (const s of ['L', 'R']) {
    ik.push({ id: `legIk_${s}`, bones: [`thigh_${s}`, `shin_${s}`], target: `footTarget_${s}`, mix: 1, bendPositive: view === 'side' ? SIDE_KNEE_BEND : s === 'L', stretch: true, softness: 0.01 * H });
    ik.push({ id: `armIk_${s}`, bones: [`upperarm_${s}`, `forearm_${s}`], target: `handTarget_${s}`, mix: 0, bendPositive: s === 'L', softness: 0.02 * H });
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
