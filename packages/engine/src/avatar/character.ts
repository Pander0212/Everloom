/**
 * The character creator's recipe (Characters › 3D avatars › Make › Character creator): one of
 * Everloom's own CC0 bases (apps/web/public/avatar/bases, built by
 * tools/avatars/build-character-bases.ts), body and face sliders that drive the base's shape keys,
 * eyes, skin and makeup painted in code, hair from the hair system, and clothing templates. The
 * browser builds the model from it; the recipe is saved with the avatar so it can be edited again.
 */
import { z } from 'zod';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const signed = z.number().min(-1).max(1);
const unit = z.number().min(0).max(1);

export const CHARACTER_BASES = [
  { id: 'anime-f', label: 'Woman', file: '/avatar/bases/anime-f.glb', height: 1.62 },
  { id: 'anime-m', label: 'Man', file: '/avatar/bases/anime-m.glb', height: 1.76 },
] as const;
export type CharacterBaseId = (typeof CHARACTER_BASES)[number]['id'];

export interface CharacterSlider {
  id: string;
  label: string;
  group: 'body' | 'breast' | 'face' | 'eyes' | 'nose' | 'mouth';
  /** Shape key at +1 and at −1 (either may be missing for one-sided sliders). */
  plus: string | null;
  minus: string | null;
  /** Only on this base (a base without the shape keys skips it). */
  base?: CharacterBaseId;
  /** Range shown, within −1…1, so extremes still look good. */
  min?: number;
  max?: number;
}

const s = (id: string, label: string, group: CharacterSlider['group'], plus: string | null, minus: string | null, extra: Partial<CharacterSlider> = {}): CharacterSlider => ({ id, label, group, plus, minus, ...extra });
/** Sliders over the bases' shape keys (names as tools/avatars/build-character-bases.ts writes them). */
export const CHARACTER_SLIDERS: CharacterSlider[] = [
  s('breastSize', 'Breast size', 'breast', 'Breast_Large', 'Breast_Small', { base: 'anime-f' }),
  s('breastShape', 'Breast shape (round … pointed)', 'breast', 'Breast_Point', 'Breast_Round'),
  s('breastFirmness', 'Breast firmness', 'breast', 'Breast_Firm', 'Breast_Soft', { base: 'anime-f' }),
  s('breastPosition', 'Breast position', 'breast', 'Breast_Up', 'Breast_Down'),
  s('breastSpacing', 'Breast spacing', 'breast', 'Breast_Apart', 'Breast_Together'),
  s('chest', 'Chest', 'body', 'Chest_Broad', null, { base: 'anime-m', min: 0 }),
  s('shoulders', 'Shoulders', 'body', 'Shoulders_Wide', 'Shoulders_Narrow'),
  s('waist', 'Waist', 'body', 'Waist_Wide', 'Waist_Thin'),
  s('hips', 'Hips', 'body', 'Hips_Wide', 'Hips_Narrow'),
  s('butt', 'Butt', 'body', 'Butt_Big', 'Butt_Small'),
  s('belly', 'Belly', 'body', 'Belly_Out', 'Belly_In', { max: 0.6 }),
  s('thighs', 'Thighs', 'body', 'Thighs_Thick', 'Thighs_Thin'),
  s('legs', 'Leg length', 'body', 'Legs_Long', 'Legs_Short'),
  s('arms', 'Arms', 'body', 'Arms_Thick', 'Arms_Thin'),
  s('hands', 'Hands', 'body', 'Hands_Big', 'Hands_Small'),
  s('neck', 'Neck', 'body', 'Neck_Long', 'Neck_Short'),
  s('muscle', 'Muscle', 'body', 'Muscular', null, { min: 0 }),
  s('softness', 'Softness (slim … soft)', 'body', 'Weight_Heavy', 'Weight_Thin'),
  s('faceRound', 'Round face', 'face', 'Face_Round', null, { min: 0 }),
  s('faceOval', 'Oval face', 'face', 'Face_Oval', null, { min: 0 }),
  s('faceSquare', 'Square face', 'face', 'Face_Square', null, { min: 0 }),
  s('faceHeart', 'Heart-shaped face', 'face', 'Face_Heart', null, { min: 0 }),
  s('faceWidth', 'Face width', 'face', 'Face_Wide', 'Face_Narrow'),
  s('jaw', 'Jaw', 'face', 'Jaw_Wide', 'Jaw_Narrow'),
  s('chin', 'Chin', 'face', 'Chin_Long', 'Chin_Short'),
  s('cheeks', 'Cheeks', 'face', 'Cheeks_Full', 'Cheeks_Hollow'),
  s('cheekbones', 'Cheekbones', 'face', 'Cheekbones_High', 'Cheekbones_Low'),
  s('ears', 'Ear size', 'face', 'Ears_Big', 'Ears_Small'),
  s('earShape', 'Ear shape (round … pointed)', 'face', 'Ears_Pointed', 'Ears_Round'),
  s('eyeSize', 'Eye size', 'eyes', 'Eyes_Big', 'Eyes_Small'),
  s('eyeSpacing', 'Eye spacing', 'eyes', 'Eyes_Apart', 'Eyes_Close'),
  s('eyeHeight', 'Eye height', 'eyes', 'Eyes_Up', 'Eyes_Down'),
  s('eyeAngle', 'Eye angle', 'eyes', 'Eyes_Tilt_Up', 'Eyes_Tilt_Down'),
  s('eyeOpen', 'Eye shape (narrow … tall)', 'eyes', 'Eyes_Tall', 'Eyes_Narrow'),
  s('browHeight', 'Eyebrow height', 'eyes', 'Brows_Up', 'Brows_Down'),
  s('browAngle', 'Eyebrow angle', 'eyes', 'Brows_Angle_Up', 'Brows_Angle_Down'),
  s('noseSize', 'Nose size', 'nose', 'Nose_Big', 'Nose_Small'),
  s('noseHeight', 'Nose height', 'nose', 'Nose_Up', 'Nose_Down'),
  s('noseWidth', 'Nose width', 'nose', 'Nose_Wide', 'Nose_Narrow'),
  s('noseTip', 'Nose tip', 'nose', 'Nose_Point_Up', 'Nose_Point_Down'),
  s('mouthWidth', 'Mouth width', 'mouth', 'Mouth_Wide', 'Mouth_Narrow'),
  s('mouthHeight', 'Mouth height', 'mouth', 'Mouth_Up', 'Mouth_Down'),
  s('lips', 'Lips', 'mouth', 'Lips_Full', 'Lips_Thin'),
  s('mouthCorners', 'Mouth corners', 'mouth', 'Mouth_Corners_Up', 'Mouth_Corners_Down'),
];

/** Shape-key weights for a set of slider values (missing keys are skipped by the caller). */
export function sliderWeights(values: Record<string, number>, base: CharacterBaseId): Record<string, number> {
  const out: Record<string, number> = {};
  for (const sl of CHARACTER_SLIDERS) {
    if (sl.base && sl.base !== base) continue;
    const v = Math.max(sl.min ?? -1, Math.min(sl.max ?? 1, values[sl.id] ?? 0));
    if (sl.plus) out[sl.plus] = (out[sl.plus] ?? 0) + Math.max(0, v);
    if (sl.minus) out[sl.minus] = (out[sl.minus] ?? 0) + Math.max(0, -v);
  }
  return out;
}

// ---------------------------------------------------------------- hair

/** One lock group of a hair part: strands from a band of the scalp, combed in one direction. */
export interface HairLocks {
  /** Where the roots sit: an arc of the scalp in degrees around the head (0 = front, 90 = the character's left). */
  from: number;
  to: number;
  /** Root height on the scalp: 0 = the crown, 1 = the hairline. */
  root: number;
  /** Strands across the arc. */
  count: number;
  /** Length in metres (scaled by the hair length slider). */
  length: number;
  /** How far the tips fall away from the head (0 hugs it, 1 stands off). */
  lift: number;
  /** Width of a strand at its root, in metres. */
  width: number;
  /** 0 straight … 1 curly. */
  curl?: number;
  /** Tips swept sideways (− right, + left), in metres. */
  sweep?: number;
  /** Gathered at a point (a ponytail or twin tail): tie position and which side. */
  tie?: { height: number; side: number; back: number };
  /** Tips curve forward at the end (bangs) or inward (bob). */
  tipCurve?: number;
}
export interface HairPart { id: string; label: string; kind: 'front' | 'back' | 'side'; locks: HairLocks[] }

const L = (o: HairLocks) => o;
export const HAIR_PARTS: HairPart[] = [
  // Fronts (bangs)
  { id: 'none', label: 'None', kind: 'front', locks: [] },
  { id: 'straight-bangs', label: 'Straight bangs', kind: 'front', locks: [L({ from: -55, to: 55, root: 0.35, count: 11, length: 0.11, lift: 0.15, width: 0.022, tipCurve: 0.4 })] },
  { id: 'side-swept', label: 'Side-swept', kind: 'front', locks: [L({ from: -60, to: 50, root: 0.3, count: 10, length: 0.13, lift: 0.18, width: 0.024, sweep: 0.06, tipCurve: 0.3 })] },
  { id: 'parted', label: 'Middle part', kind: 'front', locks: [L({ from: -70, to: -8, root: 0.2, count: 6, length: 0.15, lift: 0.2, width: 0.026, sweep: -0.05 }), L({ from: 8, to: 70, root: 0.2, count: 6, length: 0.15, lift: 0.2, width: 0.026, sweep: 0.05 })] },
  { id: 'curtain', label: 'Curtain bangs', kind: 'front', locks: [L({ from: -65, to: -5, root: 0.3, count: 6, length: 0.12, lift: 0.22, width: 0.024, sweep: -0.07, tipCurve: 0.5 }), L({ from: 5, to: 65, root: 0.3, count: 6, length: 0.12, lift: 0.22, width: 0.024, sweep: 0.07, tipCurve: 0.5 })] },
  { id: 'hime', label: 'Blunt (hime) bangs', kind: 'front', locks: [L({ from: -50, to: 50, root: 0.35, count: 14, length: 0.1, lift: 0.1, width: 0.018, tipCurve: 0.2 })] },
  { id: 'spiky-front', label: 'Spiky', kind: 'front', locks: [L({ from: -60, to: 60, root: 0.25, count: 9, length: 0.1, lift: 0.45, width: 0.026, tipCurve: -0.3 })] },
  { id: 'messy', label: 'Messy', kind: 'front', locks: [L({ from: -65, to: 65, root: 0.3, count: 12, length: 0.12, lift: 0.3, width: 0.02, curl: 0.35, tipCurve: 0.2 })] },
  { id: 'swept-back', label: 'Swept back', kind: 'front', locks: [L({ from: -60, to: 60, root: 0.9, count: 10, length: 0.14, lift: 0.08, width: 0.026, tipCurve: -0.6 })] },
  { id: 'long-fringe', label: 'Long fringe', kind: 'front', locks: [L({ from: -45, to: 45, root: 0.3, count: 9, length: 0.16, lift: 0.14, width: 0.024, tipCurve: 0.3 })] },
  // Backs
  { id: 'none', label: 'None', kind: 'back', locks: [] },
  { id: 'short', label: 'Short', kind: 'back', locks: [L({ from: 60, to: 300, root: 0.4, count: 16, length: 0.12, lift: 0.08, width: 0.03, tipCurve: 0.2 })] },
  { id: 'bob', label: 'Bob', kind: 'back', locks: [L({ from: 50, to: 310, root: 0.35, count: 18, length: 0.2, lift: 0.12, width: 0.03, tipCurve: 0.5 })] },
  { id: 'shoulder', label: 'Shoulder length', kind: 'back', locks: [L({ from: 45, to: 315, root: 0.35, count: 18, length: 0.3, lift: 0.12, width: 0.03, tipCurve: 0.2 })] },
  { id: 'long', label: 'Long straight', kind: 'back', locks: [L({ from: 45, to: 315, root: 0.35, count: 20, length: 0.55, lift: 0.1, width: 0.03 })] },
  { id: 'long-wavy', label: 'Long wavy', kind: 'back', locks: [L({ from: 45, to: 315, root: 0.35, count: 20, length: 0.55, lift: 0.14, width: 0.03, curl: 0.45 })] },
  { id: 'very-long', label: 'Very long', kind: 'back', locks: [L({ from: 45, to: 315, root: 0.35, count: 22, length: 0.85, lift: 0.1, width: 0.03 })] },
  { id: 'ponytail', label: 'High ponytail', kind: 'back', locks: [L({ from: 50, to: 310, root: 0.4, count: 14, length: 0.1, lift: 0.04, width: 0.03 }), L({ from: 150, to: 210, root: 0.1, count: 9, length: 0.45, lift: 0.1, width: 0.026, tie: { height: 0.14, side: 0, back: 0.1 } })] },
  { id: 'low-ponytail', label: 'Low ponytail', kind: 'back', locks: [L({ from: 50, to: 310, root: 0.4, count: 14, length: 0.12, lift: 0.04, width: 0.03 }), L({ from: 150, to: 210, root: 0.1, count: 8, length: 0.4, lift: 0.08, width: 0.026, tie: { height: -0.02, side: 0, back: 0.11 } })] },
  { id: 'twintails', label: 'Twin tails', kind: 'back', locks: [L({ from: 50, to: 310, root: 0.4, count: 14, length: 0.1, lift: 0.04, width: 0.03 }), L({ from: 100, to: 150, root: 0.15, count: 6, length: 0.5, lift: 0.18, width: 0.026, tie: { height: 0.1, side: 1, back: 0.06 } }), L({ from: 210, to: 260, root: 0.15, count: 6, length: 0.5, lift: 0.18, width: 0.026, tie: { height: 0.1, side: -1, back: 0.06 } })] },
  { id: 'bun', label: 'Bun', kind: 'back', locks: [L({ from: 50, to: 310, root: 0.4, count: 16, length: 0.1, lift: 0.04, width: 0.03 }), L({ from: 140, to: 220, root: 0.1, count: 10, length: 0.08, lift: 0.5, width: 0.04, curl: 1, tie: { height: 0.16, side: 0, back: 0.09 } })] },
  { id: 'curly', label: 'Curly', kind: 'back', locks: [L({ from: 45, to: 315, root: 0.35, count: 22, length: 0.3, lift: 0.25, width: 0.03, curl: 0.9 })] },
  { id: 'spiky-back', label: 'Spiky', kind: 'back', locks: [L({ from: 60, to: 300, root: 0.4, count: 14, length: 0.1, lift: 0.5, width: 0.03, tipCurve: -0.3 })] },
  { id: 'layered', label: 'Layered', kind: 'back', locks: [L({ from: 45, to: 315, root: 0.3, count: 16, length: 0.22, lift: 0.14, width: 0.03, tipCurve: 0.3 }), L({ from: 60, to: 300, root: 0.5, count: 14, length: 0.4, lift: 0.1, width: 0.028 })] },
  // Sides
  { id: 'none', label: 'None', kind: 'side', locks: [] },
  { id: 'sidelocks', label: 'Sidelocks', kind: 'side', locks: [L({ from: 72, to: 82, root: 0.55, count: 2, length: 0.22, lift: 0.06, width: 0.026 }), L({ from: 278, to: 288, root: 0.55, count: 2, length: 0.22, lift: 0.06, width: 0.026 })] },
  { id: 'long-sidelocks', label: 'Long sidelocks', kind: 'side', locks: [L({ from: 72, to: 82, root: 0.55, count: 2, length: 0.4, lift: 0.06, width: 0.028 }), L({ from: 278, to: 288, root: 0.55, count: 2, length: 0.4, lift: 0.06, width: 0.028 })] },
  { id: 'drills', label: 'Drill curls', kind: 'side', locks: [L({ from: 74, to: 80, root: 0.55, count: 1, length: 0.3, lift: 0.1, width: 0.04, curl: 1 }), L({ from: 280, to: 286, root: 0.55, count: 1, length: 0.3, lift: 0.1, width: 0.04, curl: 1 })] },
  { id: 'tucked', label: 'Short sides', kind: 'side', locks: [L({ from: 65, to: 95, root: 0.5, count: 3, length: 0.08, lift: 0.04, width: 0.026 }), L({ from: 265, to: 295, root: 0.5, count: 3, length: 0.08, lift: 0.04, width: 0.026 })] },
  { id: 'ahoge', label: 'Ahoge (cowlick)', kind: 'side', locks: [L({ from: -5, to: 5, root: 0.0, count: 1, length: 0.09, lift: 1, width: 0.016, tipCurve: 0.8 })] },
];
export const hairPart = (kind: HairPart['kind'], id: string) => HAIR_PARTS.find((p) => p.kind === kind && p.id === id) ?? HAIR_PARTS.find((p) => p.kind === kind && p.id === 'none')!;

export const HairSpecSchema = z.object({
  front: z.string().max(40).default('side-swept'),
  back: z.string().max(40).default('long'),
  side: z.string().max(40).default('sidelocks'),
  color: hex.default('#3a2a26'),
  /** A gradient towards the tips (null = one colour). */
  tips: hex.nullable().default(null),
  /** A shine band. */
  highlight: unit.default(0.5),
  length: signed.default(0),
  volume: signed.default(0),
  curl: unit.default(0),
  /** Physics on the hair chains. */
  physics: z.boolean().default(true),
});
export type HairSpec = z.infer<typeof HairSpecSchema>;

/** Whole hairstyles: a front, a back and a side mixed, with their settings (the owner can mix freely). */
export const HAIR_PRESETS: { id: string; label: string; hair: Partial<HairSpec> }[] = [
  ['long-straight', 'Long straight', 'side-swept', 'long', 'sidelocks'],
  ['hime-cut', 'Hime cut', 'hime', 'very-long', 'long-sidelocks'],
  ['bob', 'Bob', 'straight-bangs', 'bob', 'none'],
  ['side-bob', 'Side-swept bob', 'side-swept', 'bob', 'tucked'],
  ['short', 'Short', 'messy', 'short', 'tucked'],
  ['pixie', 'Pixie', 'side-swept', 'short', 'none'],
  ['shoulder', 'Shoulder length', 'curtain', 'shoulder', 'sidelocks'],
  ['layered', 'Layered', 'curtain', 'layered', 'sidelocks'],
  ['high-ponytail', 'High ponytail', 'straight-bangs', 'ponytail', 'sidelocks'],
  ['low-ponytail', 'Low ponytail', 'parted', 'low-ponytail', 'none'],
  ['twintails', 'Twin tails', 'straight-bangs', 'twintails', 'none'],
  ['twintails-long', 'Long twin tails', 'hime', 'twintails', 'long-sidelocks'],
  ['bun', 'Bun', 'curtain', 'bun', 'sidelocks'],
  ['messy-bun', 'Messy bun', 'messy', 'bun', 'tucked'],
  ['curly', 'Curly', 'messy', 'curly', 'none'],
  ['curly-long', 'Long curls', 'parted', 'long-wavy', 'drills'],
  ['ojou', 'Drill curls', 'hime', 'long', 'drills'],
  ['wavy', 'Long wavy', 'side-swept', 'long-wavy', 'sidelocks'],
  ['very-long', 'Very long', 'long-fringe', 'very-long', 'long-sidelocks'],
  ['parted-long', 'Middle part, long', 'parted', 'long', 'none'],
  ['swept-back', 'Swept back', 'swept-back', 'short', 'none'],
  ['slicked', 'Slicked back, long', 'swept-back', 'shoulder', 'none'],
  ['spiky', 'Spiky', 'spiky-front', 'spiky-back', 'none'],
  ['spiky-hero', 'Spiky hero', 'spiky-front', 'short', 'ahoge'],
  ['messy-short', 'Messy short', 'messy', 'short', 'ahoge'],
  ['fringe-bob', 'Long fringe bob', 'long-fringe', 'bob', 'sidelocks'],
  ['ahoge-long', 'Long, with ahoge', 'side-swept', 'long', 'ahoge'],
  ['tomboy', 'Tomboy', 'messy', 'short', 'sidelocks'],
  ['princess', 'Princess', 'curtain', 'very-long', 'drills'],
  ['ponytail-fringe', 'Ponytail with fringe', 'long-fringe', 'ponytail', 'long-sidelocks'],
  ['buzz', 'Very short', 'none', 'short', 'none'],
  ['bald', 'Bald', 'none', 'none', 'none'],
].map(([id, label, front, back, side]) => ({ id: id!, label: label!, hair: { front, back, side } }));

// ---------------------------------------------------------------- clothes

/**
 * Clothing templates: shells made from the body itself, so they share the body's UV layout (the
 * MakeHuman layout; Characters › 3D avatars › Character creator › Clothes › "UV template" saves it
 * as a picture to paint on). Each is the body region it covers, pushed out by its thickness.
 */
export const CLOTHING_TEMPLATES = [
  { id: 'bra', label: 'Bra', kind: 'underwear', layer: 0 },
  { id: 'briefs', label: 'Briefs', kind: 'underwear', layer: 0 },
  { id: 'tank', label: 'Tank top', kind: 'top', layer: 1 },
  { id: 'tshirt', label: 'T-shirt', kind: 'top', layer: 1 },
  { id: 'longsleeve', label: 'Long-sleeved top', kind: 'top', layer: 1 },
  { id: 'crop', label: 'Crop top', kind: 'top', layer: 1 },
  { id: 'shorts', label: 'Shorts', kind: 'bottom', layer: 1 },
  { id: 'pants', label: 'Trousers', kind: 'bottom', layer: 1 },
  { id: 'leggings', label: 'Leggings', kind: 'bottom', layer: 1 },
  { id: 'skirt', label: 'Skirt', kind: 'bottom', layer: 2 },
  { id: 'long-skirt', label: 'Long skirt', kind: 'bottom', layer: 2 },
  { id: 'dress', label: 'Dress', kind: 'dress', layer: 2 },
  { id: 'jacket', label: 'Jacket', kind: 'outerwear', layer: 3 },
  { id: 'coat', label: 'Long coat', kind: 'outerwear', layer: 3 },
  { id: 'socks', label: 'Socks', kind: 'socks', layer: 0 },
  { id: 'stockings', label: 'Thigh-high stockings', kind: 'socks', layer: 0 },
  { id: 'shoes', label: 'Shoes', kind: 'shoes', layer: 2 },
  { id: 'boots', label: 'Boots', kind: 'shoes', layer: 2 },
  { id: 'gloves', label: 'Gloves', kind: 'gloves', layer: 1 },
] as const;
export type ClothingTemplateId = (typeof CLOTHING_TEMPLATES)[number]['id'];

export const CLOTH_PATTERNS = ['plain', 'stripes', 'checks', 'dots', 'plaid', 'knit', 'denim', 'lace'] as const;

export const ClothingItemSchema = z.object({
  template: z.enum(CLOTHING_TEMPLATES.map((t) => t.id) as [ClothingTemplateId, ...ClothingTemplateId[]]),
  color: hex.default('#4a5a7a'),
  accent: hex.default('#e8e4dc'),
  pattern: z.enum(CLOTH_PATTERNS).default('plain'),
  /** A picture painted in the UV template (a media id), over the colour. */
  texture: z.string().max(64).nullable().default(null),
});
export type ClothingItem = z.infer<typeof ClothingItemSchema>;

// ---------------------------------------------------------------- the recipe

export const CharacterSpecSchema = z.object({
  v: z.literal(1).default(1),
  base: z.enum(['anime-f', 'anime-m']).default('anime-f'),
  body: z
    .object({
      /** The character's age. The creator works in the adult range only (18 and up). */
      age: z.number().min(18).max(90).default(22),
      /** Height in metres. */
      height: z.number().min(1.4).max(2.1).default(1.62),
      /** Head size (anime proportions sit around 1.08). */
      head: z.number().min(0.85).max(1.3).default(1.08),
      sliders: z.record(z.string().max(40), signed).default({}),
    })
    .default({ age: 22, height: 1.62, head: 1.08, sliders: {} }),
  face: z.object({ sliders: z.record(z.string().max(40), signed).default({ eyeSize: 0.45, eyeOpen: 0.3, noseSize: -0.3 }) }).default({ sliders: { eyeSize: 0.45, eyeOpen: 0.3, noseSize: -0.3 } }),
  eyes: z
    .object({
      iris: hex.default('#4a6fb0'),
      /** Lower half of the iris (a gradient). */
      iris2: hex.default('#2a3a6a'),
      irisSize: unit.default(0.62),
      pupil: unit.default(0.35),
      highlight: unit.default(0.7),
      lashes: hex.default('#2a1d1a'),
      style: z.enum(['round', 'sharp', 'soft']).default('round'),
    })
    .default({ iris: '#4a6fb0', iris2: '#2a3a6a', irisSize: 0.62, pupil: 0.35, highlight: 0.7, lashes: '#2a1d1a', style: 'round' }),
  skin: z
    .object({
      tone: hex.default('#f6dece'),
      blush: unit.default(0.25),
      blushColor: hex.default('#f08a8a'),
      lips: hex.default('#d9787a'),
      lipColor: unit.default(0.4),
      eyeshadow: hex.default('#b07a8a'),
      eyeshadowAmount: unit.default(0),
      nails: hex.nullable().default(null),
      /** Toon (cel) shading; off = soft realistic shading. */
      toon: z.boolean().default(true),
    })
    .default({ tone: '#f6dece', blush: 0.25, blushColor: '#f08a8a', lips: '#d9787a', lipColor: 0.4, eyeshadow: '#b07a8a', eyeshadowAmount: 0, nails: null, toon: true }),
  hair: HairSpecSchema.default(() => HairSpecSchema.parse({})),
  clothes: z.array(ClothingItemSchema).max(12).default([{ template: 'bra', color: '#e8e4dc', accent: '#e8e4dc', pattern: 'plain', texture: null }, { template: 'briefs', color: '#e8e4dc', accent: '#e8e4dc', pattern: 'plain', texture: null }]),
  /**
   * Anatomy editing: shape keys and texture layers from the separate anatomy pack (installed like
   * any pack; never in the repository). No unlock: it applies when the pack is installed, never on
   * a minor (the server's minor guard, apps/server/src/services/minor-guard.ts).
   */
  anatomy: z
    .object({
      enabled: z.boolean().default(false),
      areolaSize: unit.default(0.5),
      areolaColor: hex.default('#c98a7a'),
      nippleSize: unit.default(0.5),
      puffiness: unit.default(0),
      genitalPreset: z.string().max(40).nullable().default(null),
      genitalShape: z.record(z.string().max(40), signed).default({}),
    })
    .default({ enabled: false, areolaSize: 0.5, areolaColor: '#c98a7a', nippleSize: 0.5, puffiness: 0, genitalPreset: null, genitalShape: {} }),
});
export type CharacterSpec = z.infer<typeof CharacterSpecSchema>;
