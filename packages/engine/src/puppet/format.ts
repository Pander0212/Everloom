/**
 * Everloom Puppet: an animated 2D character in the spirit of Live2D, in a format of our own
 * (docs/puppets.md). A puppet is textured parts with meshes, a tree of deformers (warp grids and
 * rotations), parameters that drive keyforms, pendulum physics, and expressions and motions in
 * terms of parameters. Coordinates are the art's pixels, y down.
 *
 * Everything here is data and pure functions; the browser runtime (apps/web/src/features/puppets)
 * draws it with WebGL, and the pack builder (tools/puppets) makes it.
 */
import { z } from 'zod';

export const PUPPET_FORMAT = 'everloom-puppet';
export const PUPPET_VERSION = 1;

const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9_.:-]+$/);
const finite = z.number().finite();

/** Parameters every template has, so expressions, motions, life and lip-sync work on any puppet. */
export const STANDARD_PARAMS = [
  ['AngleX', -30, 30, 0], ['AngleY', -30, 30, 0], ['AngleZ', -30, 30, 0],
  ['BodyAngleX', -10, 10, 0], ['BodyAngleZ', -10, 10, 0], ['Breath', 0, 1, 0],
  ['EyeLOpen', 0, 1, 1], ['EyeROpen', 0, 1, 1], ['EyeSmile', 0, 1, 0],
  ['EyeBallX', -1, 1, 0], ['EyeBallY', -1, 1, 0],
  ['BrowY', -1, 1, 0], ['BrowAngle', -1, 1, 0],
  ['MouthOpen', 0, 1, 0], ['MouthForm', -1, 1, 0], ['Cheek', 0, 1, 0],
  // Vowel shapes for lip-sync (0–1 each; the strongest wins when the voice gives them).
  ['MouthA', 0, 1, 0], ['MouthI', 0, 1, 0], ['MouthU', 0, 1, 0], ['MouthE', 0, 1, 0], ['MouthO', 0, 1, 0],
  // Body shape (clothing parts follow the same deformers, so outfits keep fitting).
  ['Bust', -1, 1, 0], ['Waist', -1, 1, 0], ['Hips', -1, 1, 0], ['Thighs', -1, 1, 0], ['Shoulders', -1, 1, 0], ['Build', -1, 1, 0],
] as const;
export type StandardParam = (typeof STANDARD_PARAMS)[number][0];

export const ParamSchema = z.object({
  id, name: z.string().max(80).optional(),
  min: finite, max: finite, default: finite,
  /** Kept out of the maker and the story (physics outputs, internal helpers). */
  internal: z.boolean().optional(),
});
export type PuppetParam = z.infer<typeof ParamSchema>;

export const MeshSchema = z.object({
  /** Vertex positions in art pixels, x0,y0,x1,y1,… */
  positions: z.array(finite).max(200_000),
  /** Texture coordinates 0–1 in the part's texture page, u0,v0,… */
  uvs: z.array(finite).max(200_000),
  indices: z.array(z.number().int().nonnegative()).max(300_000),
});
export type PuppetMesh = z.infer<typeof MeshSchema>;

export const BLEND_MODES = ['normal', 'multiply', 'screen'] as const;

export const PartSchema = z.object({
  id, name: z.string().max(80).optional(),
  /** The schema slot it fills (docs/puppets.md): `hair.front`, `eye.l.iris`, `top`… */
  slot: z.string().max(60),
  texture: z.number().int().nonnegative(),
  mesh: MeshSchema,
  /** The deformer that moves it (none: the puppet's own space). */
  parent: id.nullable().default(null),
  /** Draw order, back to front; bindings can add to it. */
  z: finite.default(0),
  opacity: z.number().min(0).max(1).default(1),
  blend: z.enum(BLEND_MODES).default('normal'),
  /** Parts whose shape clips this one (irises inside the eye whites, the inside of the mouth). */
  masks: z.array(id).max(8).default([]),
  /** A colour group the maker recolours (`hair`, `eyes`, `skin`, `cloth1`…). */
  color: z.string().max(40).optional(),
  /** Only drawn as a mask for other parts. */
  maskOnly: z.boolean().optional(),
});
export type PuppetPart = z.infer<typeof PartSchema>;

export const DeformerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('warp'), id, parent: id.nullable().default(null), rect: z.tuple([finite, finite, finite, finite]), cols: z.number().int().min(1).max(16), rows: z.number().int().min(1).max(16) }),
  z.object({ kind: z.literal('rotate'), id, parent: id.nullable().default(null), origin: z.tuple([finite, finite]) }),
]);
export type PuppetDeformer = z.infer<typeof DeformerSchema>;

/**
 * Keyforms: how a target changes with one or two parameters. `keys` lists the parameter values
 * where a keyform is set (per axis); `values` holds one entry per key combination, first axis
 * fastest. What an entry is depends on `prop`:
 *   grid     a warp's point offsets (x,y per point, (cols+1)*(rows+1) points)
 *   verts    a part's vertex offsets (x,y per vertex)
 *   angle    a rotation deformer's angle in degrees
 *   offset   a rotation deformer's move [x, y]
 *   scale    a rotation deformer's scale factor (multiplied)
 *   opacity  a part's opacity (multiplied)
 *   z        added to a part's draw order
 * Bindings on the same target and prop from different parameters add up (scale and opacity
 * multiply), so a head turned and tilted is the two keyform sets together.
 */
export const BINDING_PROPS = ['grid', 'verts', 'angle', 'offset', 'scale', 'opacity', 'z'] as const;
export type BindingProp = (typeof BINDING_PROPS)[number];
export const BindingSchema = z.object({
  target: id,
  prop: z.enum(BINDING_PROPS),
  params: z.array(id).min(1).max(2),
  keys: z.array(z.array(finite).min(1).max(16)).min(1).max(2),
  values: z.array(z.union([finite, z.array(finite).max(200_000)])).min(1),
});
export type PuppetBinding = z.infer<typeof BindingSchema>;

/**
 * Physics driven by how the head and body move, written to output parameters that keyforms use.
 * A `pendulum` is a chain that swings (hair strands, ribbons, skirts, earrings); a `spring` is a
 * mass that lags behind its anchor and wobbles back, in two directions (the chest, soft bellies).
 */
export const PuppetPhysicsSchema = z.object({
  id,
  kind: z.enum(['pendulum', 'spring']).default('pendulum'),
  /** Which parameters push it and how much: sideways motion `x`, up-down motion `y` (springs),
   * turning `angle` (pendulums). Each moves the anchor by value/range × weight. */
  inputs: z.array(z.object({ param: id, weight: finite, kind: z.enum(['x', 'y', 'angle']).default('x') })).min(1).max(8),
  /** Written each frame: a pendulum's swing (its end angle over `limit`), a spring's lag along
   * `axis` (in anchor units × scale), mapped onto the parameter's range. */
  outputs: z.array(z.object({ param: id, segment: z.number().int().min(0).max(7).default(0), scale: finite.default(1), axis: z.enum(['x', 'y']).default('x') })).min(1).max(4),
  segments: z.number().int().min(1).max(8).default(2),
  /** Length of each segment, in relative units (1 ≈ a head's height). */
  length: z.number().positive().max(10).default(1),
  gravity: z.number().min(0).max(4).default(1),
  /** 0 keeps swinging, 1 stops at once (a spring: its damping ratio, 1 = no overshoot). */
  damping: z.number().min(0).max(1).default(0.15),
  /** Pendulum: pull back to hanging straight down. Spring: its natural frequency, Hz. */
  stiffness: z.number().min(0).max(20).default(2),
  /** Largest swing either way, degrees. */
  limit: z.number().min(1).max(90).default(30),
});
export type PuppetPhysics = z.infer<typeof PuppetPhysicsSchema>;

/** A parameter animation: tracks of [time s, value] keys, played over the current pose. */
export const MotionSchema = z.object({
  duration: z.number().positive().max(60),
  loop: z.boolean().default(false),
  /** Added to the pose (true) or replacing it (false), per motion. */
  additive: z.boolean().default(true),
  tracks: z.record(id, z.array(z.tuple([finite, finite])).min(1).max(256)),
});
export type PuppetMotion = z.infer<typeof MotionSchema>;

export const PuppetModelSchema = z.object({
  format: z.literal(PUPPET_FORMAT),
  version: z.literal(PUPPET_VERSION),
  id, name: z.string().min(1).max(120),
  /** The template it was made from (`everloom-f`, `everloom-m`, `placeholder`…): parts fit it. */
  template: z.string().max(60),
  rating: z.enum(['all-ages', '18+']).default('all-ages'),
  canvas: z.object({ width: z.number().positive().max(16384), height: z.number().positive().max(16384) }),
  /** Where the feet would be and where the eyes are, for staging (art pixels). */
  anchors: z.object({ floor: finite, eyes: finite, headTop: finite, centerX: finite }).partial().default({}),
  textures: z.array(z.string().max(200)).min(1).max(16),
  params: z.array(ParamSchema).max(256),
  deformers: z.array(DeformerSchema).max(512),
  parts: z.array(PartSchema).min(1).max(1024),
  bindings: z.array(BindingSchema).max(4096),
  physics: z.array(PuppetPhysicsSchema).max(64).default([]),
  /** Everloom emotions → parameter values (blended smoothly). */
  expressions: z.record(z.string().max(40), z.record(id, finite)).default({}),
  motions: z.record(z.string().max(40), MotionSchema).default({}),
  /** Colour groups with their base colour (the maker recolours by shifting from it). */
  colors: z.record(z.string().max(40), z.string().regex(/^#[0-9a-f]{6}$/i)).default({}),
});
export type PuppetModel = z.infer<typeof PuppetModelSchema>;

export interface PuppetCheck { ok: boolean; errors: string[] }

/** Cross-reference checks the schema can't express (ids exist, arrays have the right lengths). */
export function checkPuppet(m: PuppetModel): PuppetCheck {
  const errors: string[] = [];
  const params = new Set(m.params.map((p) => p.id));
  const deformers = new Map(m.deformers.map((d) => [d.id, d]));
  const parts = new Map(m.parts.map((p) => [p.id, p]));
  const seen = new Set<string>();
  for (const x of [...m.params, ...m.deformers, ...m.parts]) {
    if (seen.has(x.id)) errors.push(`duplicate id "${x.id}"`);
    seen.add(x.id);
  }
  for (const p of m.params) if (!(p.min <= p.default && p.default <= p.max)) errors.push(`param ${p.id}: default outside min–max`);
  for (const d of m.deformers) {
    if (d.parent && !deformers.has(d.parent)) errors.push(`deformer ${d.id}: no parent "${d.parent}"`);
    // No cycles.
    let cur: string | null = d.parent, n = 0;
    while (cur && n++ < 600) { if (cur === d.id) { errors.push(`deformer ${d.id}: its parents loop`); break; } cur = deformers.get(cur)?.parent ?? null; }
  }
  for (const p of m.parts) {
    if (p.parent && !deformers.has(p.parent)) errors.push(`part ${p.id}: no deformer "${p.parent}"`);
    if (p.texture >= m.textures.length) errors.push(`part ${p.id}: no texture ${p.texture}`);
    const v = p.mesh.positions.length;
    if (v % 2 || p.mesh.uvs.length !== v) errors.push(`part ${p.id}: positions and uvs must be x,y pairs of the same count`);
    if (p.mesh.indices.length % 3) errors.push(`part ${p.id}: indices must be triangles`);
    if (p.mesh.indices.some((i) => i >= v / 2)) errors.push(`part ${p.id}: an index past the last vertex`);
    for (const k of p.masks) if (!parts.has(k)) errors.push(`part ${p.id}: no mask part "${k}"`);
  }
  for (const [i, b] of m.bindings.entries()) {
    for (const pid of b.params) if (!params.has(pid)) errors.push(`binding ${i}: no param "${pid}"`);
    if (b.keys.length !== b.params.length) errors.push(`binding ${i}: one key list per param`);
    const combos = b.keys.reduce((n, k) => n * k.length, 1);
    if (b.values.length !== combos) errors.push(`binding ${i}: ${combos} keyforms expected, ${b.values.length} given`);
    for (const k of b.keys) for (let j = 1; j < k.length; j++) if (!(k[j]! > k[j - 1]!)) errors.push(`binding ${i}: keys must increase`);
    const size = bindingSize(m, b);
    if (size === null) { errors.push(`binding ${i}: no ${b.prop === 'grid' || b.prop === 'angle' || b.prop === 'offset' || b.prop === 'scale' ? 'deformer' : 'part'} "${b.target}" for ${b.prop}`); continue; }
    for (const v of b.values) {
      const len = typeof v === 'number' ? 1 : v.length;
      if (len !== size) { errors.push(`binding ${i}: each keyform needs ${size} numbers, one has ${len}`); break; }
    }
  }
  for (const ph of m.physics) for (const x of [...ph.inputs, ...ph.outputs]) if (!params.has(x.param)) errors.push(`physics ${ph.id}: no param "${x.param}"`);
  for (const [name, ex] of Object.entries(m.expressions)) for (const pid of Object.keys(ex)) if (!params.has(pid)) errors.push(`expression ${name}: no param "${pid}"`);
  for (const [name, mo] of Object.entries(m.motions)) for (const pid of Object.keys(mo.tracks)) if (!params.has(pid)) errors.push(`motion ${name}: no param "${pid}"`);
  return { ok: errors.length === 0, errors };
}

/** How many numbers one keyform of this binding holds (null: the target isn't the right kind). */
export function bindingSize(m: PuppetModel, b: PuppetBinding): number | null {
  if (b.prop === 'verts' || b.prop === 'opacity' || b.prop === 'z') {
    const p = m.parts.find((x) => x.id === b.target);
    if (!p) return null;
    return b.prop === 'verts' ? p.mesh.positions.length : 1;
  }
  const d = m.deformers.find((x) => x.id === b.target);
  if (!d) return null;
  if (b.prop === 'grid') return d.kind === 'warp' ? (d.cols + 1) * (d.rows + 1) * 2 : null;
  if (d.kind !== 'rotate') return null;
  return b.prop === 'offset' ? 2 : 1;
}

/** Reads and checks a puppet; throws with every problem listed. */
export function parsePuppet(data: unknown): PuppetModel {
  const m = PuppetModelSchema.parse(data);
  const c = checkPuppet(m);
  if (!c.ok) throw new Error(`Not a valid puppet: ${c.errors.slice(0, 8).join('; ')}${c.errors.length > 8 ? ` (and ${c.errors.length - 8} more)` : ''}`);
  return m;
}
