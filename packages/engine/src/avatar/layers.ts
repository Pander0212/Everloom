/**
 * Skin layers: transparent images composited onto the body's skin texture in the browser and baked
 * into one texture whenever the stack changes, so they cost nothing per frame. In stacking order:
 * base skin, makeup, body paint, tattoos, tight underwear and swimwear, stockings, then scars.
 *
 * A layer is either a whole image in the body's UV layout (underwear painted for this base) or a
 * decal placed on the body by tapping (a tattoo): an image stamped at a UV point with a size in
 * centimetres and a rotation. Clothing layers (underwear, swimwear, stockings) are wardrobe items:
 * outfits and equipped inventory items put them on like any garment.
 */
import { z } from 'zod';
import { GARMENT_SLOTS } from './slots.js';

export const SKIN_LAYER_KINDS = ['makeup', 'paint', 'tattoo', 'underwear', 'swimwear', 'stockings', 'scar'] as const;
export type SkinLayerKind = (typeof SKIN_LAYER_KINDS)[number];
/** Kinds that are clothing: they take part in outfits and item rules. */
export const CLOTHING_LAYER_KINDS: readonly SkinLayerKind[] = ['underwear', 'swimwear', 'stockings'];

const id = z.string().regex(/^[a-z0-9_-]{1,40}$/);
const media = z.string().regex(/^[\w-]{1,64}$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const DecalSchema = z.object({
  /** Where its centre sits in the body texture (0–1, glTF orientation: v down). */
  u: z.number().min(0).max(1),
  v: z.number().min(0).max(1),
  /** Width on the body in centimetres. */
  size: z.number().min(0.5).max(80).default(8),
  /** Degrees, clockwise on the skin. */
  rotation: z.number().min(-360).max(360).default(0),
  /**
   * The skin's frame at the spot, measured when placed: how far one centimetre to the skin's right,
   * and one centimetre up, moves in the texture. Keeps the decal unskewed whatever the UV layout.
   */
  right: z.tuple([z.number().min(-1).max(1), z.number().min(-1).max(1)]).default([0.01, 0]),
  up: z.tuple([z.number().min(-1).max(1), z.number().min(-1).max(1)]).default([0, -0.01]),
  /** The mesh it was placed on. */
  mesh: z.string().max(200).nullable().default(null),
});
export type Decal = z.infer<typeof DecalSchema>;

export const SkinLayerSchema = z.object({
  id,
  name: z.string().trim().min(1).max(60),
  kind: z.enum(SKIN_LAYER_KINDS),
  /** The colour image (PNG with transparency). Null: a plain tint (a skin tone wash, a body paint). */
  image: media.nullable().default(null),
  normal: media.nullable().default(null),
  roughness: media.nullable().default(null),
  tint: color.nullable().default(null),
  opacity: z.number().min(0).max(1).default(1),
  /** Placed by tapping; absent: the image covers the whole body texture. */
  decal: DecalSchema.nullable().default(null),
  on: z.boolean().default(true),
  /** Clothing layers: the slot they stand for, and the inventory items that put them on. */
  slot: z.enum(GARMENT_SLOTS).nullable().default(null),
  items: z.array(z.string().max(120)).max(16).default([]),
  /** 18+ image: never shown on, or saved for, a minor (the server's minor guard). */
  adult: z.boolean().default(false),
});
export type SkinLayer = z.infer<typeof SkinLayerSchema>;

export const AppearanceSchema = z.object({
  /** A wash over the base skin texture (multiplied, so detail stays). */
  skinTone: color.nullable().default(null),
  /** Meshes that are skin (the stack goes on their texture). Empty: the avatar's body meshes. */
  skinMeshes: z.array(z.string().max(200)).max(16).default([]),
  hair: z.object({
    meshes: z.array(z.string().max(200)).max(16).default([]),
    color: color.nullable().default(null),
    /** Lighter streak colour (the sheen or rim). */
    highlight: color.nullable().default(null),
    /** Root-to-tip gradient: the tip colour (root is `color`). */
    tip: color.nullable().default(null),
  }).default({ meshes: [], color: null, highlight: null, tip: null }),
  eyes: z.object({ meshes: z.array(z.string().max(200)).max(8).default([]), color: color.nullable().default(null) }).default({ meshes: [], color: null }),
});
export type Appearance = z.infer<typeof AppearanceSchema>;

/** Layers in the order they're painted: kind first, then the order the owner listed them. */
export function stackOrder(layers: readonly SkinLayer[]): SkinLayer[] {
  const rank = (k: SkinLayerKind) => SKIN_LAYER_KINDS.indexOf(k);
  return layers.map((l, i) => ({ l, i })).sort((a, b) => rank(a.l.kind) - rank(b.l.kind) || a.i - b.i).map((x) => x.l);
}
