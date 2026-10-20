/**
 * The Puppets v2 skeleton standard: one set of bone names for every character and every view, so
 * motions, clothing and physics transfer between characters (docs/puppets-v2/skeleton.md).
 *
 * Coordinates are the art's pixels (y down) and angles are degrees, clockwise positive, as in the
 * Rev2D format the rig is written in. "L" is the character's left: on screen right in a front view.
 */
import { z } from 'zod';

export const SIDES = ['L', 'R'] as const;
export type Side = (typeof SIDES)[number];

/** Bones every full-body character has, parents first. */
export const CORE_BONES = [
  'root', 'pelvis', 'spine', 'chest', 'neck', 'head',
  'shoulder_L', 'upperarm_L', 'forearm_L', 'hand_L',
  'shoulder_R', 'upperarm_R', 'forearm_R', 'hand_R',
  'thigh_L', 'shin_L', 'foot_L',
  'thigh_R', 'shin_R', 'foot_R',
] as const;
/** Adult body bones (breasts, buttocks): present when the body has those layers. */
export const BODY_BONES = ['breast_L', 'breast_R', 'butt_L', 'butt_R'] as const;
/** IK targets (children of the root): hands reach, feet lock. */
export const TARGET_BONES = ['handTarget_L', 'handTarget_R', 'footTarget_L', 'footTarget_R'] as const;
export type CoreBone = (typeof CORE_BONES)[number];
export type BodyBone = (typeof BODY_BONES)[number];
export type StandardBone = CoreBone | BodyBone | (typeof TARGET_BONES)[number];

export const PARENT: Record<CoreBone | BodyBone, CoreBone | null> = {
  root: null, pelvis: 'root', spine: 'pelvis', chest: 'spine', neck: 'chest', head: 'neck',
  shoulder_L: 'chest', upperarm_L: 'shoulder_L', forearm_L: 'upperarm_L', hand_L: 'forearm_L',
  shoulder_R: 'chest', upperarm_R: 'shoulder_R', forearm_R: 'upperarm_R', hand_R: 'forearm_R',
  thigh_L: 'pelvis', shin_L: 'thigh_L', foot_L: 'shin_L',
  thigh_R: 'pelvis', shin_R: 'thigh_R', foot_R: 'shin_R',
  breast_L: 'chest', breast_R: 'chest', butt_L: 'pelvis', butt_R: 'pelvis',
};

/** Swaps the side of a standard name (bone, part, parameter): upperarm_L ↔ upperarm_R. */
export const mirrorName = (id: string) => id.replace(/_(L|R)(?=$|[^A-Za-z])/g, (_, s: string) => (s === 'L' ? '_R' : '_L'));

const pt = z.tuple([z.number().finite(), z.number().finite()]);

/**
 * Body landmarks in the art's pixels, for one view. Front and three-quarter views have both sides;
 * a side view has the near side's limbs (the far ones may be missing and are then mirrored).
 */
export const KeypointsSchema = z.object({
  view: z.enum(['front', 'threeQuarter', 'side', 'back']).default('front'),
  headTop: pt, neck: pt, chest: pt, pelvis: pt,
  shoulder_L: pt, elbow_L: pt, wrist_L: pt, hip_L: pt, knee_L: pt, ankle_L: pt, toe_L: pt.optional(),
  shoulder_R: pt, elbow_R: pt, wrist_R: pt, hip_R: pt, knee_R: pt, ankle_R: pt, toe_R: pt.optional(),
  breast_L: pt.optional(), breast_R: pt.optional(), butt_L: pt.optional(), butt_R: pt.optional(),
});
export type Keypoints = z.infer<typeof KeypointsSchema>;

/** One bone of a built skeleton, in Rev2D's form (local to its parent). */
export interface BuiltBone { id: string; parent: string | null; x: number; y: number; rotation: number; length: number }

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;
const sub = (a: [number, number], b: [number, number]): [number, number] => [a[0] - b[0], a[1] - b[1]];
const len = (v: [number, number]) => Math.hypot(v[0], v[1]);

/**
 * Builds the standard skeleton from keypoints: each bone runs from its joint to the next one, local
 * transforms are derived from those world joints (rest pose = the art's pose).
 */
export function buildSkeleton(kpIn: Keypoints): { bones: BuiltBone[]; world: Record<string, { x: number; y: number; a: number }> } {
  const kp = KeypointsSchema.parse(kpIn);
  const floor = Math.max(kp.ankle_L[1], kp.ankle_R[1]) + 0.04 * (Math.max(kp.ankle_L[1], kp.ankle_R[1]) - kp.headTop[1]);
  const neckBase = kp.neck;
  const headBase: [number, number] = [neckBase[0] + (kp.headTop[0] - neckBase[0]) * 0.15, neckBase[1] + (kp.headTop[1] - neckBase[1]) * 0.15];
  const toe = (s: Side): [number, number] => {
    const t = kp[`toe_${s}`];
    if (t) return t;
    const a = kp[`ankle_${s}`];
    const h = a[1] - kp.headTop[1];
    // Front view: the foot points down toward the viewer (short); side view: forward (screen left by convention).
    return kp.view === 'side' ? [a[0] - 0.09 * h, a[1] + 0.02 * h] : [a[0] + (s === 'L' ? 0.012 : -0.012) * h, a[1] + 0.035 * h];
  };
  // World joint → tip for each bone.
  const seg: Record<string, [[number, number], [number, number]]> = {
    root: [[kp.pelvis[0], floor], [kp.pelvis[0], floor]],
    pelvis: [kp.pelvis, kp.pelvis],
    spine: [kp.pelvis, kp.chest],
    chest: [kp.chest, neckBase],
    neck: [neckBase, headBase],
    head: [headBase, kp.headTop],
  };
  for (const s of SIDES) {
    const sh = kp[`shoulder_${s}`], el = kp[`elbow_${s}`], wr = kp[`wrist_${s}`];
    const fore = sub(wr, el), fl = len(fore) || 1;
    seg[`shoulder_${s}`] = [[neckBase[0] + (sh[0] - neckBase[0]) * 0.2, sh[1]], sh];
    seg[`upperarm_${s}`] = [sh, el];
    seg[`forearm_${s}`] = [el, wr];
    seg[`hand_${s}`] = [wr, [wr[0] + (fore[0] / fl) * fl * 0.38, wr[1] + (fore[1] / fl) * fl * 0.38]];
    seg[`thigh_${s}`] = [kp[`hip_${s}`], kp[`knee_${s}`]];
    seg[`shin_${s}`] = [kp[`knee_${s}`], kp[`ankle_${s}`]];
    seg[`foot_${s}`] = [kp[`ankle_${s}`], toe(s)];
    const b = kp[`breast_${s}`];
    if (b) seg[`breast_${s}`] = [b, [b[0], b[1] + 1]];
    const u = kp[`butt_${s}`];
    if (u) seg[`butt_${s}`] = [u, [u[0], u[1] + 1]];
  }
  const order = [...CORE_BONES, ...BODY_BONES].filter((id) => seg[id]);
  const world: Record<string, { x: number; y: number; a: number }> = {};
  const bones: BuiltBone[] = [];
  for (const id of order) {
    const [j, t] = seg[id]!;
    const d = sub(t, j);
    // Zero-length bones: the root is axis-aligned (so IK target offsets are screen offsets), the pelvis
    // points up like the spine, breasts and buttocks point down (their bounce runs along local x).
    const parent = PARENT[id as CoreBone];
    const pw = parent ? world[parent]! : { x: 0, y: 0, a: 0 };
    const a = len(d) > 1e-6 ? deg(Math.atan2(d[1], d[0])) : id === 'root' ? 0 : id === 'pelvis' ? -90 : 90;
    world[id] = { x: j[0], y: j[1], a };
    const dx = j[0] - pw.x, dy = j[1] - pw.y, c = Math.cos(rad(-pw.a)), s = Math.sin(rad(-pw.a));
    bones.push({ id, parent, x: dx * c - dy * s, y: dx * s + dy * c, rotation: normAngle(a - pw.a), length: len(d) });
  }
  // IK targets sit at the hands and feet, as children of the root (so a target stays put when the body moves).
  const rw = world.root!;
  const rootLocal = (p: [number, number]) => { const dx = p[0] - rw.x, dy = p[1] - rw.y, c = Math.cos(rad(-rw.a)), s = Math.sin(rad(-rw.a)); return { x: dx * c - dy * s, y: dx * s + dy * c }; };
  for (const s of SIDES) {
    bones.push({ id: `handTarget_${s}`, parent: 'root', ...rootLocal(kp[`wrist_${s}`]), rotation: 0, length: 0 });
    bones.push({ id: `footTarget_${s}`, parent: 'root', ...rootLocal(kp[`ankle_${s}`]), rotation: 0, length: 0 });
  }
  return { bones, world };
}

export const normAngle = (a: number) => { let x = ((a + 180) % 360 + 360) % 360 - 180; if (x === -180) x = 180; return x; };

/** Body proportions measured from a skeleton (used to retarget motions between characters). */
export function proportions(bones: BuiltBone[]) {
  const L = (id: string) => bones.find((b) => b.id === id)?.length ?? 0;
  const leg = (L('thigh_L') + L('shin_L') + L('thigh_R') + L('shin_R')) / 2;
  const arm = (L('upperarm_L') + L('forearm_L') + L('upperarm_R') + L('forearm_R')) / 2;
  const torso = L('spine') + L('chest');
  return { leg, arm, torso, height: leg + torso + L('neck') + L('head') };
}

/**
 * Height in heads from landmarks: (feet − head top) / head, the head taken as 0.9 × (head top → neck
 * base). Adults measure about 6.5–8; a body drawn with child proportions under 5.5. The server uses
 * it to keep 18+ packs and adult layers off child-proportioned bodies, whatever a pack claims.
 */
export function headsTall(kp: Pick<Keypoints, 'headTop' | 'neck' | 'ankle_L' | 'ankle_R'>): number {
  const head = Math.hypot(kp.neck[0] - kp.headTop[0], kp.neck[1] - kp.headTop[1]) * 0.9;
  const height = Math.max(kp.ankle_L[1], kp.ankle_R[1]) - kp.headTop[1];
  return head > 0 ? (height * 1.03) / head : 0;
}
export const ADULT_MIN_HEADS = 5.5;
