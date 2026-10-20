/**
 * Character Studio templates (docs/character-studio/FORMAT.md, version 1): one pose or scene, drawn
 * once, with pre-aligned layers per trait option. A template has character slots (1–2), each with
 * its layers, cages (body sliders), recolor masks and a motion rig; optional background and POV
 * layers; and scene options the story can choose between.
 */
import { z } from 'zod';
import { EXPRESSIONS, SLIDERS, WARDROBE_SLOTS } from './traits.js';

export const TEMPLATE_FORMAT = 'everloom-studio-template';
export const TEMPLATE_VERSION = 1;

const id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const pt = z.tuple([z.number().finite(), z.number().finite()]);
const rect = z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]);

/**
 * When a layer is drawn: every key must match (an array means any of). Keys: a trait path
 * ("hair.back", "hair.front", "hair.side", "face.preset", "body.bodyHair", "sex", "face.makeup",
 * "face.freckles", "face.mole"), "wardrobe.<slot>" (an outfit item id), "expression", or
 * "option.<id>" (a scene option).
 */
export const WhenSchema = z.record(z.string().regex(/^(hair\.(front|back|side)|face\.(preset|makeup|brows|freckles|mole)|body\.bodyHair|sex|wardrobe\.[a-z]+|expression|option\.[a-z0-9_-]+)$/), z.union([z.string(), z.boolean(), z.array(z.union([z.string(), z.boolean()]))]));
export type When = z.infer<typeof WhenSchema>;

/** Recolor: which colour a layer's pixels follow. The mask (white = recolour) defaults to the whole layer. */
export const RecolorSchema = z.object({
  kind: z.enum(['hair', 'highlight', 'eyes', 'skin']),
  /** The colour the layer was painted in (the recolour maps from it). */
  base: z.string().regex(/^#[0-9a-f]{6}$/i),
  mask: z.string().optional(),
});

export const LayerSchema = z.object({
  id,
  /** What the layer is: decides defaults for z and which wardrobe slot it belongs to. */
  part: z.enum(['background', 'pov', 'body', 'bodyDetail', 'hairBack', 'hairSide', 'hairFront', 'face', 'eyes', 'brows', 'expression', 'clothing', 'accessory', 'effect']),
  file: z.string().regex(/^[A-Za-z0-9_./-]+\.(png|webp)$/),
  rect,
  z: z.number(),
  /** z overrides: the first matching rule wins (hair in front of / behind the shoulder…). */
  zRules: z.array(z.object({ when: WhenSchema, z: z.number() })).default([]),
  when: WhenSchema.default({}),
  recolor: z.array(RecolorSchema).default([]),
  /** Cages that deform this layer (default: every cage of its slot). */
  cages: z.array(id).optional(),
  /** Only in 18+ templates' explicit states. */
  adult: z.boolean().default(false),
});
export type Layer = z.infer<typeof LayerSchema>;

/**
 * A cage for one body slider: a polygon around the region (rest), and the polygon at the slider's
 * minimum and maximum. Points inside follow by mean-value coordinates; a margin around it blends
 * back to rest, so nothing tears at the edge.
 */
export const CageSchema = z.object({
  id,
  slider: z.enum(SLIDERS),
  rest: z.array(pt).min(3).max(64),
  min: z.array(pt).min(3).max(64),
  max: z.array(pt).min(3).max(64),
  margin: z.number().positive().default(24),
}).refine((c) => c.rest.length === c.min.length && c.rest.length === c.max.length, 'rest, min and max need the same number of points');
export type Cage = z.infer<typeof CageSchema>;

export const SlotSchema = z.object({
  id,
  /** Which sexes this slot's art fits (a template drawn with a female base offers "female"). */
  sex: z.array(z.enum(['female', 'male'])).min(1),
  layers: z.array(LayerSchema).min(1),
  cages: z.array(CageSchema).default([]),
  /** Idle motion: a breathing region and sway pivot (in canvas pixels), driven by the runtime. */
  rig: z.object({
    breathe: rect.optional(),
    pivot: pt.optional(),
    bounce: z.array(rect).default([]),
  }).prefault({}),
  /** Landmarks of the base character (used for cages and checks). */
  keypoints: z.record(z.string(), pt).default({}),
});
export type Slot = z.infer<typeof SlotSchema>;

export const OptionSchema = z.object({
  id,
  label: z.string().max(80),
  values: z.array(z.object({ id, label: z.string().max(80) })).min(2),
  default: id.optional(),
});

export const TemplateSchema = z.object({
  format: z.literal(TEMPLATE_FORMAT),
  version: z.literal(TEMPLATE_VERSION),
  id,
  name: z.string().max(80),
  category: z.enum(['standing', 'sitting', 'action', 'scene']),
  rating: z.enum(['all-ages', '18+']),
  width: z.number().int().positive().max(4096),
  height: z.number().int().positive().max(4096),
  /** Trait options this template has art for (the compositor falls back for the rest). */
  supports: z.object({
    hairFront: z.array(z.string()).default([]),
    hairBack: z.array(z.string()).default([]),
    hairSide: z.array(z.string()).default([]),
    facePreset: z.array(z.string()).default([]),
    expressions: z.array(z.enum(EXPRESSIONS)).default(['neutral']),
    wardrobe: z.partialRecord(z.enum(WARDROBE_SLOTS), z.array(z.string())).default({}),
  }).prefault({}),
  slots: z.array(SlotSchema).min(1).max(2),
  options: z.array(OptionSchema).default([]),
  /** Tags the story can match ("greeting", "sitting", "bed"…). */
  tags: z.array(z.string().max(30)).default([]),
});
export type Template = z.output<typeof TemplateSchema>;

/** Reads a stored template (older versions upgraded here; version 1 is the first). */
export function migrateTemplate(input: unknown): Template {
  const t = input as { format?: string; version?: number };
  if (t?.format !== TEMPLATE_FORMAT) throw new Error('Not a studio template');
  if (t.version !== TEMPLATE_VERSION) throw new Error(`Unsupported template version ${t.version}`);
  return TemplateSchema.parse(input);
}

/** Semantic checks beyond the schema: unique ids, z conflicts, references, adult rules. */
export function validateTemplate(t: Template): string[] {
  const errors: string[] = [];
  for (const slot of t.slots) {
    const ids = new Set<string>();
    for (const l of slot.layers) {
      if (ids.has(l.id)) errors.push(`slot ${slot.id}: duplicate layer id ${l.id}`);
      ids.add(l.id);
      if (l.adult && t.rating !== '18+') errors.push(`slot ${slot.id}: layer ${l.id} is adult in an all-ages template`);
      for (const c of l.cages ?? []) if (!slot.cages.some((k) => k.id === c)) errors.push(`slot ${slot.id}: layer ${l.id} names a missing cage ${c}`);
    }
    // Two layers that can be drawn together at the same depth have no defined order.
    const byZ = new Map<number, Layer[]>();
    for (const l of slot.layers) byZ.set(l.z, [...(byZ.get(l.z) ?? []), l]);
    for (const [z, ls] of byZ) {
      for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
        if (canCoexist(ls[i]!.when, ls[j]!.when)) errors.push(`slot ${slot.id}: layers ${ls[i]!.id} and ${ls[j]!.id} share z ${z}`);
      }
    }
  }
  for (const o of t.options) if (o.default && !o.values.some((v) => v.id === o.default)) errors.push(`option ${o.id}: default ${o.default} is not one of its values`);
  return errors;
}

/** Whether two layer conditions can both hold at once (no key with disjoint values). */
export function canCoexist(a: When, b: When): boolean {
  for (const k of Object.keys(a)) {
    if (!(k in b)) continue;
    const va = ([] as Array<string | boolean>).concat(a[k]!), vb = ([] as Array<string | boolean>).concat(b[k]!);
    if (!va.some((x) => vb.includes(x))) return false;
  }
  return true;
}
