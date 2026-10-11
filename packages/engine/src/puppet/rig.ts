/**
 * Builds a template's rig from its landmarks and the parts a character wears: the deformer tree,
 * every keyform, the physics and the standard parameters. The same function rigs the placeholder
 * puppet and both art templates, so a hairstyle or outfit made for a template fits any character
 * on it.
 *
 * Head turns project each layer onto a sphere around the skull with its own depth: the face moves
 * with the sphere, the fringe sits in front of it and moves more, back hair sits behind and moves
 * the other way. Eyes, brows and mouth ride on the face through their own deformers. Breathing lifts
 * the shoulders and widens the chest; body-shape parameters reshape the body's grid, and clothing on
 * the same grid follows.
 */
import { PUPPET_FORMAT, PUPPET_VERSION, STANDARD_PARAMS, type PuppetBinding, type PuppetDeformer, type PuppetMesh, type PuppetModel, type PuppetPart, type PuppetPhysics } from './format.js';
import { SLOTS, slotOf, type TemplateLandmarks } from './schema.js';

export interface RigPart {
  id: string;
  /** Slot, optionally with an option after a colon (`arm.r:raised`). */
  slot: string;
  texture: number;
  mesh: PuppetMesh;
  name?: string;
  color?: string;
  /** Draw order instead of the slot's: a layered picture knows its own (arms behind the top, the
   * waistband over the shirt). Keep body parts within 10–29 so they stay between the back hair and
   * the face. */
  z?: number;
}

export interface RigOptions {
  id: string;
  name: string;
  template: string;
  rating?: 'all-ages' | '18+';
  textures: string[];
  colors?: Record<string, string>;
  /** How far the chest moves with its physics (1 = the default; the 18+ body may use more). */
  bounce?: number;
  /** Largest head turn the art holds up to, degrees (the parameters' ±30 maps onto these). */
  yaw?: number;
  pitch?: number;
}

/** Template parameters on top of the standard set. */
const EXTRA_PARAMS: Array<[string, number, number, number, boolean?]> = [
  ['HairFront', -1, 1, 0, true], ['HairSide', -1, 1, 0, true], ['HairBack', -1, 1, 0, true], ['BustY', -1, 1, 0, true], ['BustX', -1, 1, 0, true], ['BustTipY', -1, 1, 0, true], ['BustTipX', -1, 1, 0, true],
  // A small hop or bob (laughing, bouncing): the upper body rises, the feet stay on the floor.
  ['BodyY', -1, 1, 0],
  ['ArmLSwing', -1, 1, 0, true], ['ArmRSwing', -1, 1, 0, true],
  ['ArmLPose', 0, 1, 0], ['ArmRPose', 0, 1, 0], ['ArmWave', -1, 1, 0],
];

const DEG = Math.PI / 180;

/** Where a point lands when the head turns by yaw/pitch (radians), for a layer at `depth`. */
export function projectHead(x: number, y: number, head: TemplateLandmarks['head'], depth: number, yaw: number, pitch: number): [number, number] {
  const R = head.r * 1.12;
  const X = (x - head.cx) / R, Y = (y - head.cy) / R;
  const zs = Math.sqrt(Math.max(0, 1 - X * X - Y * Y));
  const Z = zs + depth;
  // Below the jaw (long hair, the neck) the head's pitch fades out.
  const fade = Y > 1 ? Math.max(0, 1 - (Y - 1) / 1.5) : 1;
  const p = pitch * fade;
  const X1 = X * Math.cos(yaw) + Z * Math.sin(yaw);
  const Z1 = -X * Math.sin(yaw) + Z * Math.cos(yaw);
  const Y1 = Y * Math.cos(p) - Z1 * Math.sin(p);
  return [head.cx + X1 * R, head.cy + Y1 * R];
}

function gridPoints(rect: [number, number, number, number], cols: number, rows: number) {
  const pts: Array<[number, number]> = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) pts.push([rect[0] + (rect[2] * c) / cols, rect[1] + (rect[3] * r) / rows]);
  return pts;
}

/** A grid keyform: each point's offset from rest given by `f`. */
const gridOffsets = (pts: Array<[number, number]>, f: (x: number, y: number) => [number, number]) => pts.flatMap(([x, y]) => { const [nx, ny] = f(x, y); return [nx - x, ny - y]; });
const zeros = (n: number) => new Array<number>(n).fill(0);
const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
/** A soft band around y0 of half-height h (1 at the centre, 0 outside). */
const band = (y: number, y0: number, h: number) => { const t = Math.abs(y - y0) / h; return t >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * t); };

function meshBox(meshes: PuppetMesh[]): [number, number, number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const m of meshes) for (let i = 0; i < m.positions.length; i += 2) { const x = m.positions[i]!, y = m.positions[i + 1]!; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return x0 === Infinity ? null : [x0, y0, x1 - x0, y1 - y0];
}

export function buildTemplateRig(L: TemplateLandmarks, parts: RigPart[], o: RigOptions): PuppetModel {
  const yaw = (o.yaw ?? 20) * DEG, pitch = (o.pitch ?? 14) * DEG;
  const [W, H] = L.canvas;
  const h = L.head, R = h.r;
  const deformers: PuppetDeformer[] = [];
  const bindings: PuppetBinding[] = [];
  const physics: PuppetPhysics[] = [];

  // ---- the body: one warp from above the shoulders down to the bottom of the art
  const bodyTop = Math.min(L.shoulderL[1], L.shoulderR[1], L.neck.cy) - R * 0.5;
  const bodyHalf = Math.max(Math.abs(L.shoulderL[0] - L.neck.cx), Math.abs(L.shoulderR[0] - L.neck.cx), L.hips.w / 2) * 1.6 + R * 0.4;
  const bodyRect: [number, number, number, number] = [L.neck.cx - bodyHalf, bodyTop, bodyHalf * 2, Math.max(R, L.bottom - bodyTop + R * 0.2)];
  const BC = 8, BR = 12;
  deformers.push({ kind: 'warp', id: 'body', parent: null, rect: bodyRect, cols: BC, rows: BR });
  const bodyPts = gridPoints(bodyRect, BC, BR);
  const bodyH = bodyRect[3];
  // How much a point follows the upper body (1 at the shoulders, 0 at the hips and below).
  const upper = (y: number) => 1 - smooth((y - bodyTop) / Math.max(1, L.hips.cy - bodyTop));
  const cx = L.neck.cx;
  // Turning the body: the top slides and the far side narrows.
  bindings.push({ target: 'body', prop: 'grid', params: ['BodyAngleX'], keys: [[-10, 0, 10]], values: [-1, 0, 1].map((s) => s === 0 ? zeros(bodyPts.length * 2) : gridOffsets(bodyPts, (x, y) => { const u = upper(y); const side = (x - cx) / bodyHalf; return [x + s * u * R * 0.22 - s * side * Math.abs(side) * u * R * 0.06, y]; })) });
  // Leaning: the upper body turns around the hips.
  bindings.push({ target: 'body', prop: 'grid', params: ['BodyAngleZ'], keys: [[-10, 0, 10]], values: [-1, 0, 1].map((s) => s === 0 ? zeros(bodyPts.length * 2) : gridOffsets(bodyPts, (x, y) => { const u = upper(y); const a = s * 6 * DEG * u; const dx = x - cx, dy = y - L.hips.cy; return [cx + dx * Math.cos(a) - dy * Math.sin(a), L.hips.cy + dx * Math.sin(a) + dy * Math.cos(a)]; })) });
  // Breathing: shoulders rise, the chest widens a little, the belly barely moves.
  bindings.push({ target: 'body', prop: 'grid', params: ['Breath'], keys: [[0, 1]], values: [zeros(bodyPts.length * 2), gridOffsets(bodyPts, (x, y) => {
    const sh = band(y, (L.shoulderL[1] + L.shoulderR[1]) / 2, (L.chest.cy - bodyTop) * 1.2);
    const ch = band(y, L.chest.cy, (L.waist.cy - L.shoulderL[1]) * 0.7);
    return [x + (x - cx) * 0.012 * ch, y - R * 0.045 * sh - R * 0.015 * ch];
  })] });
  // Body shape: widen or narrow around each region (outfits on the same grid follow).
  const shape = (param: string, y0: number, hh: number, amount: number, extraY = 0) => bindings.push({ target: 'body', prop: 'grid', params: [param], keys: [[-1, 0, 1]], values: [-1, 0, 1].map((s) => s === 0 ? zeros(bodyPts.length * 2) : gridOffsets(bodyPts, (x, y) => { const b = band(y, y0, hh); return [x + (x - cx) * amount * s * b, y + extraY * s * b * R]; })) });
  const torso = L.hips.cy - L.shoulderL[1];
  shape('Bust', L.chest.cy, torso * 0.28, 0.07, 0.04);
  shape('Waist', L.waist.cy, torso * 0.25, 0.1);
  shape('Hips', L.hips.cy, torso * 0.3, 0.09);
  shape('Thighs', L.hips.cy + torso * 0.45, torso * 0.4, 0.08);
  shape('Shoulders', L.shoulderL[1], torso * 0.3, 0.07);
  bindings.push({ target: 'body', prop: 'grid', params: ['Build'], keys: [[-1, 0, 1]], values: [-1, 0, 1].map((s) => s === 0 ? zeros(bodyPts.length * 2) : gridOffsets(bodyPts, (x, y) => [x + (x - cx) * 0.05 * s * (y > bodyTop + R * 0.3 ? 1 : 0.4), y])) });
  // A hop: everything above the hips rises, the legs stretch to keep the feet down.
  bindings.push({ target: 'body', prop: 'grid', params: ['BodyY'], keys: [[-1, 0, 1]], values: [-1, 0, 1].map((s) => s === 0 ? zeros(bodyPts.length * 2) : gridOffsets(bodyPts, (x, y) => [x, y - s * R * 0.3 * (y <= L.hips.cy ? 1 : Math.max(0, 1 - (y - L.hips.cy) / Math.max(1, L.bottom - L.hips.cy)))])) });

  // ---- the chest: its own fine warp (under the body's) for the bounce, so only the breasts move.
  // It holds the parts of the upper body (top, underwear, the body's skin above the hips) and is
  // sized to contain them, so nothing is ever extrapolated outside it.
  const chestSlots = new Set(['body', 'underwear', 'top', 'outer']);
  const chestParts = parts.filter((p) => chestSlots.has(slotOf(p.slot)) && (() => { const b = meshBox([p.mesh]); return !!b && b[1] + b[3] / 2 < L.hips.cy; })());
  // Each breast: measured (bustL/R, from depth) or placed from the chest's width and height.
  const guess = (sx: number) => { const rx = L.chest.w * 0.32, ry = torso * 0.2, bx = cx + sx * L.chest.w * 0.23, by = L.chest.cy + torso * 0.02; return { cx: bx, cy: by, rx, ry, tip: [bx, by + ry * 0.15] as [number, number] }; };
  const busts = [L.bustR ?? guess(-1), L.bustL ?? guess(1)];
  const bounce = o.bounce ?? 1;
  const chestIds = new Set<string>();
  if (chestParts.length) {
    const boxes = chestParts.map((p) => meshBox([p.mesh])!);
    const x0 = Math.min(...busts.map((b) => b.cx - b.rx * 1.3), ...boxes.map((b) => b[0])) - 4, y0 = Math.min(...busts.map((b) => b.cy - b.ry * 1.3), ...boxes.map((b) => b[1])) - 4;
    const x1 = Math.max(...busts.map((b) => b.cx + b.rx * 1.3), ...boxes.map((b) => b[0] + b[2])) + 4, y1 = Math.max(...busts.map((b) => b.cy + b.ry * 1.3), ...boxes.map((b) => b[1] + b[3])) + 4;
    const rect: [number, number, number, number] = [x0, y0, x1 - x0, y1 - y0];
    const cell = Math.max(8, Math.min(...busts.map((b) => b.ry)) * 0.35);
    const cols = Math.max(4, Math.min(16, Math.round(rect[2] / cell))), rows = Math.max(4, Math.min(16, Math.round(rect[3] / cell)));
    deformers.push({ kind: 'warp', id: 'chest', parent: 'body', rect, cols, rows });
    const pts = gridPoints(rect, cols, rows);
    const soft = (r: number) => (r >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * r));
    // How much a point belongs to a breast (a soft oval a little larger than its outline, so the
    // edge stretches instead of tearing), and to its tip (a smaller oval around the nipple).
    const bump = (x: number, y: number) => Math.max(...busts.map((b) => soft(Math.hypot((x - b.cx) / (b.rx * 1.25), (y - b.cy) / (b.ry * 1.25)))));
    const tip = (x: number, y: number) => Math.max(...busts.map((b) => soft(Math.hypot((x - b.tip[0]) / (b.rx * 0.6), (y - b.tip[1]) / (b.ry * 0.6))) * soft(Math.hypot((x - b.cx) / (b.rx * 1.25), (y - b.cy) / (b.ry * 1.25)))));
    const ry = (busts[0]!.ry + busts[1]!.ry) / 2;
    const grid = (param: string, f: (x: number, y: number, s: number) => [number, number]) => bindings.push({ target: 'chest', prop: 'grid', params: [param], keys: [[-1, 0, 1]], values: [-1, 0, 1].map((s) => s === 0 ? zeros(pts.length * 2) : gridOffsets(pts, (x, y) => f(x, y, s))) });
    // The whole breast up and down (positive lifts) and sideways; the tip on top of that, a beat
    // later and further (its own looser spring), as soft tissue does. Physics writes all four.
    grid('BustY', (x, y, s) => [x, y - s * ry * 0.4 * bounce * bump(x, y)]);
    grid('BustX', (x, y, s) => [x + s * ry * 0.24 * bounce * bump(x, y), y]);
    grid('BustTipY', (x, y, s) => { const t = tip(x, y); return [x, y - s * ry * 0.22 * bounce * t]; });
    grid('BustTipX', (x, y, s) => [x + s * ry * 0.14 * bounce * tip(x, y), y]);
    for (const p of chestParts) chestIds.add(p.id);
  }

  // ---- the head: a rotation at the neck (tilt), then one warp per depth layer
  deformers.push({ kind: 'rotate', id: 'neck', parent: 'body', origin: [L.neck.cx, L.neck.cy] });
  bindings.push({ target: 'neck', prop: 'angle', params: ['AngleZ'], keys: [[-30, 30]], values: [-12, 12] });
  // The head moves a little with a turn (the neck isn't a pivot at the jaw).
  bindings.push({ target: 'neck', prop: 'offset', params: ['AngleX'], keys: [[-30, 0, 30]], values: [[-R * 0.06, 0], [0, 0], [R * 0.06, 0]] });
  const headRect = (scaleX: number, top: number, bottom: number): [number, number, number, number] => [h.cx - R * scaleX, top, R * scaleX * 2, bottom - top];
  const layer = (id: string, rect: [number, number, number, number], depth: number, cols = 6, rows = 6, parent = 'neck') => {
    deformers.push({ kind: 'warp', id, parent, rect, cols, rows });
    const pts = gridPoints(rect, cols, rows);
    const keysX = [-30, 0, 30], keysY = [-30, 0, 30];
    const values: number[][] = [];
    for (const ay of keysY) for (const ax of keysX) values.push(gridOffsets(pts, (x, y) => projectHead(x, y, h, depth, (ax / 30) * yaw, (-ay / 30) * pitch)));
    bindings.push({ target: id, prop: 'grid', params: ['AngleX', 'AngleY'], keys: [keysX, keysY], values });
    return pts;
  };
  layer('face', headRect(1.35, h.top - R * 0.2, h.chin + R * 0.45), 0);
  const front = layer('hairFront', headRect(1.7, h.top - R * 0.6, h.chin + R * 0.3), 0.42);
  const sideTop = h.cy - R * 0.4;
  const side = layer('hairSide', headRect(2.0, sideTop, Math.min(H, L.hips.cy + R)), 0.22, 6, 8);
  const back = layer('hairBack', headRect(2.4, h.top - R * 0.7, Math.min(H, L.bottom)), -0.5, 6, 10);
  // Hair sway (written by physics): lower rows swing further.
  const sway = (target: string, pts: Array<[number, number]>, rect: [number, number, number, number], param: string, amount: number) => bindings.push({ target, prop: 'grid', params: [param], keys: [[-1, 0, 1]], values: [-1, 0, 1].map((s) => s === 0 ? zeros(pts.length * 2) : gridOffsets(pts, (x, y) => { const t = Math.max(0, (y - h.cy) / rect[3]); return [x + s * amount * R * t * t * 2.2, y - Math.abs(s) * amount * R * t * t * 0.4]; })) });
  sway('hairFront', front, headRect(1.7, h.top, h.chin), 'HairFront', 0.12);
  sway('hairSide', side, headRect(2, sideTop, L.hips.cy), 'HairSide', 0.25);
  sway('hairBack', back, headRect(2.4, h.top, L.bottom), 'HairBack', 0.22);

  // ---- eyes, brows and mouth, riding on the face
  for (const [side, e] of [['L', L.eyeL], ['R', L.eyeR]] as const) {
    deformers.push({ kind: 'warp', id: `eye${side}`, parent: 'face', rect: [e.cx - e.w, e.cy - e.h * 1.2, e.w * 2, e.h * 2.4], cols: 2, rows: 2 });
    const pts = gridPoints([e.cx - e.w, e.cy - e.h * 1.2, e.w * 2, e.h * 2.4], 2, 2);
    // Smiling eyes push up from below a little.
    bindings.push({ target: `eye${side}`, prop: 'grid', params: ['EyeSmile'], keys: [[0, 1]], values: [zeros(pts.length * 2), gridOffsets(pts, (x, y) => [x, y - (y > e.cy ? e.h * 0.12 : e.h * 0.05)])] });
  }
  for (const [side, b] of [['L', L.browL], ['R', L.browR]] as const) {
    deformers.push({ kind: 'rotate', id: `brow${side}`, parent: 'face', origin: [b.cx, b.cy] });
    const eh = (side === 'L' ? L.eyeL.h : L.eyeR.h);
    bindings.push({ target: `brow${side}`, prop: 'offset', params: ['BrowY'], keys: [[-1, 0, 1]], values: [[0, eh * 0.35], [0, 0], [0, -eh * 0.45]] });
    // Positive: inner ends up (worried); negative: inner ends down (cross). The picture's right brow
    // is the character's left, whose inner end points left.
    const sgn = side === 'L' ? 1 : -1;
    bindings.push({ target: `brow${side}`, prop: 'angle', params: ['BrowAngle'], keys: [[-1, 0, 1]], values: [-12 * sgn, 0, 12 * sgn] });
  }
  const m = L.mouth;
  const mouthRect: [number, number, number, number] = [m.cx - m.w, m.cy - m.w * 0.5, m.w * 2, m.w];
  deformers.push({ kind: 'warp', id: 'mouth', parent: 'face', rect: mouthRect, cols: 4, rows: 2 });
  const mouthPts = gridPoints(mouthRect, 4, 2);
  bindings.push({ target: 'mouth', prop: 'grid', params: ['MouthForm'], keys: [[-1, 0, 1]], values: [-1, 0, 1].map((s) => s === 0 ? zeros(mouthPts.length * 2) : gridOffsets(mouthPts, (x, y) => { const t = Math.min(1, Math.abs(x - m.cx) / (m.w * 0.6)); return [x + (x - m.cx) * 0.06 * s, y - s * m.w * 0.09 * t * t]; })) });
  bindings.push({ target: 'mouth', prop: 'grid', params: ['MouthOpen'], keys: [[0, 1]], values: [zeros(mouthPts.length * 2), gridOffsets(mouthPts, (x, y) => [x, y + (y > m.cy ? m.w * 0.06 : 0)])] });

  // ---- arms: a rotation at each shoulder (swing, a wave), poses swapped by opacity
  deformers.push({ kind: 'rotate', id: 'armL', parent: 'body', origin: L.shoulderL });
  deformers.push({ kind: 'rotate', id: 'armR', parent: 'body', origin: L.shoulderR });
  bindings.push({ target: 'armL', prop: 'angle', params: ['ArmLSwing'], keys: [[-1, 1]], values: [-5, 5] });
  bindings.push({ target: 'armR', prop: 'angle', params: ['ArmRSwing'], keys: [[-1, 1]], values: [-5, 5] });
  bindings.push({ target: 'armR', prop: 'angle', params: ['ArmWave'], keys: [[-1, 1]], values: [-7, 7] });

  // ---- parts
  const out: PuppetPart[] = [];
  const bySlot = new Map<string, RigPart[]>();
  for (const p of parts) { const s = slotOf(p.slot); bySlot.set(s, [...(bySlot.get(s) ?? []), p]); }
  const has = (slot: string) => (bySlot.get(slot)?.length ?? 0) > 0;
  const idsOf = (slot: string) => (bySlot.get(slot) ?? []).map((p) => p.id);
  for (const p of parts) {
    const slot = slotOf(p.slot);
    const def = SLOTS[slot];
    if (!def) throw new Error(`Unknown slot "${p.slot}" on part ${p.id}`);
    out.push({ id: p.id, name: p.name, slot: p.slot, texture: p.texture, mesh: p.mesh, parent: chestIds.has(p.id) ? 'chest' : def.deformer, z: p.z ?? def.z, opacity: 1, blend: 'normal', masks: def.mask ? idsOf(def.mask) : [], color: p.color ?? def.color });
  }
  const opacity = (slot: string, params: string[], keys: number[][], values: number[]) => { for (const id of idsOf(slot)) bindings.push({ target: id, prop: 'opacity', params, keys, values }); };
  for (const s of ['l', 'r'] as const) {
    const e = s === 'l' ? L.eyeL : L.eyeR;
    const open = `Eye${s.toUpperCase()}Open`;
    // Open eye parts squash toward the lash line as they close, then hand over to the half and shut drawings.
    const lid = e.cy + e.h * 0.28;
    for (const slot of [`eye.${s}.white`, `eye.${s}.iris`, `eye.${s}.lash`]) for (const p of bySlot.get(slot) ?? []) {
      const squash = (k: number) => { const r: number[] = []; for (let i = 0; i < p.mesh.positions.length; i += 2) r.push(0, (lid - p.mesh.positions[i + 1]!) * (1 - k)); return r; };
      bindings.push({ target: p.id, prop: 'verts', params: [open], keys: [[0, 0.5, 1]], values: [squash(0.2), squash(0.65), squash(1)] });
    }
    for (const p of bySlot.get(`eye.${s}.iris`) ?? []) {
      const n = p.mesh.positions.length;
      const shift = (dx: number, dy: number) => { const r: number[] = []; for (let i = 0; i < n; i += 2) r.push(dx, dy); return r; };
      const values: number[][] = [];
      for (const by of [-1, 0, 1]) for (const bx of [-1, 0, 1]) values.push(shift(bx * e.w * 0.24, -by * e.h * 0.2));
      bindings.push({ target: p.id, prop: 'verts', params: ['EyeBallX', 'EyeBallY'], keys: [[-1, 0, 1], [-1, 0, 1]], values });
    }
    const hasHalf = has(`eye.${s}.half`), hasClosed = has(`eye.${s}.closed`);
    for (const slot of [`eye.${s}.white`, `eye.${s}.iris`, `eye.${s}.lash`]) opacity(slot, [open], [[0, 0.2, 0.42, 0.62, 1]], hasHalf ? [0, 0, 0, 1, 1] : [0, 0, 0.5, 1, 1]);
    if (hasHalf) opacity(`eye.${s}.half`, [open], [[0, 0.2, 0.42, 0.62, 1]], [0, 0, 1, 0, 0]);
    if (hasClosed) opacity(`eye.${s}.closed`, [open], [[0, 0.2, 0.42]], [1, 1, 0]);
    // A smile replaces the eye drawings.
    if (has(`eye.${s}.smile`)) {
      opacity(`eye.${s}.smile`, ['EyeSmile'], [[0, 0.35, 0.65]], [0, 0, 1]);
      for (const slot of [`eye.${s}.white`, `eye.${s}.iris`, `eye.${s}.lash`, `eye.${s}.half`, `eye.${s}.closed`]) opacity(slot, ['EyeSmile'], [[0, 0.35, 0.65]], [1, 1, 0]);
    }
  }
  // Mouth drawings by openness and form (closed is the face's own mouth), vowels on top.
  const mouthKeys = [[0, 0.3, 0.7, 1], [-1, 0, 0.5, 1]];
  const grid = (rows: number[][]) => rows.flat(); // rows are form keys, each with the open keys
  const mouthTable: Record<string, number[][]> = {
    // form −1, 0, 0.5, 1 (rows) × open 0, 0.3, 0.7, 1 (columns)
    'mouth.smile': [[0, 0, 0, 0], [0, 0, 0, 0], [0.6, 0, 0, 0], [1, 0, 0, 0]],
    'mouth.open': [[0, 1, 0, 0], [0, 1, 0.5, 0], [0, 0.5, 0, 0], [0, 0, 0, 0]],
    'mouth.wide': [[0, 0, 1, 1], [0, 0, 0.5, 1], [0, 0, 0, 0.5], [0, 0, 0, 0]],
    'mouth.e': [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0.5, 1, 0.5], [0, 1, 0.5, 0]],
    'mouth.i': [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0.5], [0, 0, 1, 1]],
  };
  for (const [slot, rows] of Object.entries(mouthTable)) if (has(slot)) opacity(slot, ['MouthOpen', 'MouthForm'], mouthKeys, grid(rows));
  for (const [slot, vowel] of [['mouth.u', 'MouthU'], ['mouth.o', 'MouthO']] as const) {
    if (!has(slot)) continue;
    opacity(slot, [vowel], [[0, 1]], [0, 1]);
    for (const other of Object.keys(mouthTable)) opacity(other, [vowel], [[0, 1]], [1, 0]);
  }
  opacity('blush', ['Cheek'], [[0, 1]], [0, 1]);
  // Arm poses: the first option of each arm is the resting one.
  for (const [arm, param] of [['arm.l', 'ArmLPose'], ['arm.r', 'ArmRPose'], ['sleeve.l', 'ArmLPose'], ['sleeve.r', 'ArmRPose']] as const) {
    const list = bySlot.get(arm) ?? [];
    if (list.length < 2) continue;
    list.forEach((p, i) => bindings.push({ target: p.id, prop: 'opacity', params: [param], keys: [[0, 0.5, 1]], values: i === 0 ? [1, 1, 0] : [0, 0, 1] }));
  }

  // ---- physics: hair and arms swing with the head and body, the chest bounces a little
  physics.push({ id: 'hairFront', kind: 'pendulum', inputs: [{ param: 'AngleX', weight: 1, kind: 'x' }, { param: 'AngleZ', weight: 0.8, kind: 'angle' }, { param: 'BodyAngleX', weight: 0.4, kind: 'x' }], outputs: [{ param: 'HairFront', segment: 0, scale: 1, axis: 'x' }], segments: 2, length: 0.6, gravity: 1, damping: 0.12, stiffness: 3, limit: 25 });
  physics.push({ id: 'hairSide', kind: 'pendulum', inputs: [{ param: 'AngleX', weight: 1, kind: 'x' }, { param: 'AngleZ', weight: 1, kind: 'angle' }, { param: 'BodyAngleX', weight: 0.6, kind: 'x' }], outputs: [{ param: 'HairSide', segment: 1, scale: 1, axis: 'x' }], segments: 2, length: 1, gravity: 1, damping: 0.1, stiffness: 2, limit: 30 });
  physics.push({ id: 'hairBack', kind: 'pendulum', inputs: [{ param: 'AngleX', weight: 1, kind: 'x' }, { param: 'AngleZ', weight: 1, kind: 'angle' }, { param: 'BodyAngleX', weight: 1, kind: 'x' }, { param: 'BodyAngleZ', weight: 0.6, kind: 'angle' }], outputs: [{ param: 'HairBack', segment: 2, scale: 1, axis: 'x' }], segments: 3, length: 1.2, gravity: 1, damping: 0.08, stiffness: 1.5, limit: 30 });
  // The chest: a spring that lags behind the body and wobbles back (about 2.6 bounces a second).
  if (chestIds.size) physics.push({ id: 'bust', kind: 'spring', inputs: [{ param: 'BodyY', weight: 1, kind: 'y' }, { param: 'Breath', weight: 0.15, kind: 'y' }, { param: 'AngleY', weight: 0.15, kind: 'y' }, { param: 'BodyAngleX', weight: 0.7, kind: 'x' }, { param: 'BodyAngleZ', weight: 0.5, kind: 'x' }, { param: 'AngleX', weight: 0.1, kind: 'x' }], outputs: [{ param: 'BustY', segment: 0, scale: 1.6, axis: 'y' }, { param: 'BustX', segment: 0, scale: 1.6, axis: 'x' }], segments: 1, length: 1, gravity: 0, damping: 0.22, stiffness: 2.6, limit: 18 });
  // The tips: softer and slower, so they trail the breast and keep wobbling a little longer.
  if (chestIds.size) physics.push({ id: 'bustTip', kind: 'spring', inputs: [{ param: 'BodyY', weight: 1, kind: 'y' }, { param: 'Breath', weight: 0.15, kind: 'y' }, { param: 'AngleY', weight: 0.15, kind: 'y' }, { param: 'BodyAngleX', weight: 0.7, kind: 'x' }, { param: 'BodyAngleZ', weight: 0.5, kind: 'x' }, { param: 'AngleX', weight: 0.1, kind: 'x' }], outputs: [{ param: 'BustTipY', segment: 0, scale: 1.8, axis: 'y' }, { param: 'BustTipX', segment: 0, scale: 1.8, axis: 'x' }], segments: 1, length: 1, gravity: 0, damping: 0.14, stiffness: 1.9, limit: 22 });
  physics.push({ id: 'armL', kind: 'pendulum', inputs: [{ param: 'BodyAngleZ', weight: 1, kind: 'angle' }, { param: 'BodyAngleX', weight: 0.5, kind: 'x' }], outputs: [{ param: 'ArmLSwing', segment: 0, scale: 1, axis: 'x' }], segments: 1, length: 1.5, gravity: 1, damping: 0.2, stiffness: 1.5, limit: 15 });
  physics.push({ id: 'armR', kind: 'pendulum', inputs: [{ param: 'BodyAngleZ', weight: 1, kind: 'angle' }, { param: 'BodyAngleX', weight: 0.5, kind: 'x' }], outputs: [{ param: 'ArmRSwing', segment: 0, scale: 1, axis: 'x' }], segments: 1, length: 1.5, gravity: 1, damping: 0.2, stiffness: 1.5, limit: 15 });

  const params = [...STANDARD_PARAMS.map(([id, min, max, def]) => ({ id, min, max, default: def })), ...EXTRA_PARAMS.map(([id, min, max, def, internal]) => ({ id, min, max, default: def, ...(internal ? { internal: true } : {}) }))];
  const box = meshBox(parts.map((p) => p.mesh));
  return {
    format: PUPPET_FORMAT, version: PUPPET_VERSION,
    id: o.id, name: o.name, template: o.template, rating: o.rating ?? 'all-ages',
    canvas: { width: W, height: H },
    anchors: { floor: L.bottom, eyes: (L.eyeL.cy + L.eyeR.cy) / 2, headTop: h.top, centerX: box ? box[0] + box[2] / 2 : W / 2 },
    textures: o.textures,
    params, deformers, parts: out, bindings, physics,
    expressions: {}, motions: {}, colors: o.colors ?? {},
  };
}
