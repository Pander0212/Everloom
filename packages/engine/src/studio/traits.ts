/**
 * Character Studio trait sheets (docs/character-studio/FORMAT.md): a character is a list of traits,
 * and every pose or scene template has pre-aligned layers for each option, so the same character
 * looks the same everywhere. Studio characters are adults: `age` is required and at least 18, and
 * every body option is an adult body.
 */
import { z } from 'zod';

const opt = <T extends string>(ids: readonly T[], labels: Record<T, string>) => ids.map((id) => ({ id, label: labels[id] }));

export const BODY_TYPES = ['slim', 'average', 'athletic', 'curvy', 'muscular', 'plus'] as const;
export const SIZES = ['small', 'medium', 'large'] as const;
export const HAIR_FRONT = ['none', 'bangs', 'side_swept', 'parted'] as const;
export const HAIR_BACK = ['short', 'bob', 'long_straight', 'long_wavy', 'ponytail', 'twin_tails', 'bun', 'braid'] as const;
export const HAIR_SIDE = ['none', 'locks'] as const;
export const FACE_PRESETS = ['soft', 'sharp', 'round', 'mature', 'cool', 'cheerful'] as const;
export const EXPRESSIONS = ['neutral', 'smile', 'laugh', 'shy', 'angry', 'sad', 'surprised', 'pleased'] as const;
export const WARDROBE_SLOTS = ['top', 'bra', 'bottom', 'underwear', 'legwear', 'shoes', 'accessory'] as const;
export type BodyType = (typeof BODY_TYPES)[number];
export type Size = (typeof SIZES)[number];
export type WardrobeSlot = (typeof WARDROBE_SLOTS)[number];

/** Option catalogs with labels (for the editor's thumbnails and the AI fill prompt). */
export const CATALOG = {
  bodyType: opt(BODY_TYPES, { slim: 'Slim', average: 'Average', athletic: 'Athletic', curvy: 'Curvy', muscular: 'Muscular', plus: 'Plus-size' }),
  size: opt(SIZES, { small: 'Small', medium: 'Medium', large: 'Large' }),
  hairFront: opt(HAIR_FRONT, { none: 'No bangs', bangs: 'Straight bangs', side_swept: 'Side-swept', parted: 'Center part' }),
  hairBack: opt(HAIR_BACK, { short: 'Short', bob: 'Bob', long_straight: 'Long straight', long_wavy: 'Long wavy', ponytail: 'Ponytail', twin_tails: 'Twin tails', bun: 'Bun', braid: 'Braid' }),
  hairSide: opt(HAIR_SIDE, { none: 'None', locks: 'Side locks' }),
  facePreset: opt(FACE_PRESETS, { soft: 'Soft', sharp: 'Sharp', round: 'Round', mature: 'Mature', cool: 'Cool', cheerful: 'Cheerful' }),
  expression: opt(EXPRESSIONS, { neutral: 'Neutral', smile: 'Smile', laugh: 'Laugh', shy: 'Shy', angry: 'Angry', sad: 'Sad', surprised: 'Surprised', pleased: 'Pleased' }),
} as const;

/** Preset palettes for the color pickers (hand-picked, readable in anime style). */
export const PALETTES = {
  hair: ['#1b1b1f', '#3b2a22', '#6b4426', '#a0673a', '#d9b27c', '#efe2c4', '#c9c9cf', '#8a2b2b', '#d4566e', '#5a3d8a', '#2f5fa8', '#3f8a5c'],
  eyes: ['#3a2a1f', '#6b4a2b', '#3d7a3a', '#2f6db3', '#6aa7d8', '#8a3fb0', '#c2443c', '#d9a43a', '#7a7f87'],
  skin: ['#fbe3d3', '#f3cfb6', '#e8b896', '#d29d78', '#b07a55', '#8a5a3c', '#5e3b26'],
} as const;

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const slider = z.number().min(-1).max(1).default(0);

export const SLIDERS = ['breast', 'hips', 'butt', 'thighs', 'waist', 'shoulders'] as const;
export type Slider = (typeof SLIDERS)[number];

export const TraitSheetSchema = z.object({
  version: z.literal(1).default(1),
  name: z.string().trim().min(1).max(80),
  sex: z.enum(['female', 'male']),
  /** Required and adult: the studio only makes adult characters. */
  age: z.number().int().min(18).max(200),
  body: z.object({
    type: z.enum(BODY_TYPES).default('average'),
    breast: z.enum(SIZES).default('medium'),
    hips: z.enum(SIZES).default('medium'),
    skin: hex.default('#f3cfb6'),
    bodyHair: z.enum(['none', 'light', 'natural']).default('none'),
    /** Fine adjustments on top of the presets (cage deformation), −1…1. */
    sliders: z.object(Object.fromEntries(SLIDERS.map((s) => [s, slider])) as Record<Slider, typeof slider>).default({ breast: 0, hips: 0, butt: 0, thighs: 0, waist: 0, shoulders: 0 }),
  }).prefault({}),
  face: z.object({
    preset: z.enum(FACE_PRESETS).default('soft'),
    eyeColor: hex.default('#6b4a2b'),
    brows: z.enum(['natural', 'thin', 'thick']).default('natural'),
    makeup: z.enum(['none', 'light', 'bold']).default('none'),
    freckles: z.boolean().default(false),
    mole: z.boolean().default(false),
  }).prefault({}),
  hair: z.object({
    front: z.enum(HAIR_FRONT).default('bangs'),
    back: z.enum(HAIR_BACK).default('long_straight'),
    side: z.enum(HAIR_SIDE).default('none'),
    color: hex.default('#3b2a22'),
    highlight: hex.nullable().default(null),
  }).prefault({}),
  /** Outfit item ids per slot (template outfit options; inventory items map onto them). null = nothing. */
  wardrobe: z.object(Object.fromEntries(WARDROBE_SLOTS.map((s) => [s, z.string().max(60).nullable().default(null)])) as Record<WardrobeSlot, z.ZodDefault<z.ZodNullable<z.ZodString>>>).prefault({}),
  /** The expressions this character uses most (the default is the first). */
  expressions: z.array(z.enum(EXPRESSIONS)).min(1).default(['neutral', 'smile', 'shy', 'angry', 'sad', 'surprised']),
  /** Final design: once locked, every render follows these traits exactly (no re-rolls). */
  locked: z.boolean().default(false),
});
export type TraitSheet = z.output<typeof TraitSheetSchema>;
export type TraitSheetInput = z.input<typeof TraitSheetSchema>;

/** Presets: body type and sizes as cage-slider values (one base body, deformed; clothes follow). */
export const BODY_PRESETS: Record<BodyType, Partial<Record<Slider, number>>> = {
  slim: { waist: -0.35, hips: -0.3, thighs: -0.35, shoulders: -0.2, butt: -0.25 },
  average: {},
  athletic: { waist: -0.2, shoulders: 0.25, thighs: 0.1, butt: 0.1 },
  curvy: { waist: -0.25, hips: 0.45, thighs: 0.35, butt: 0.4 },
  muscular: { shoulders: 0.6, waist: 0.1, thighs: 0.35 },
  plus: { waist: 0.7, hips: 0.55, thighs: 0.6, butt: 0.5, shoulders: 0.2 },
};
export const SIZE_PRESET: Record<Size, number> = { small: -0.55, medium: 0, large: 0.55 };

/** The slider values a sheet resolves to: preset + size + fine adjustment, clamped to −1…1. */
export function resolvedSliders(sheet: TraitSheet): Record<Slider, number> {
  const p = BODY_PRESETS[sheet.body.type];
  const out = {} as Record<Slider, number>;
  for (const s of SLIDERS) {
    let v = (p[s] ?? 0) + sheet.body.sliders[s];
    if (s === 'breast') v += sheet.sex === 'female' ? SIZE_PRESET[sheet.body.breast] : -0.6;
    if (s === 'hips') v += SIZE_PRESET[sheet.body.hips] * (sheet.sex === 'female' ? 1 : 0.5);
    out[s] = Math.max(-1, Math.min(1, v));
  }
  return out;
}

/** Reads any stored sheet (older versions are upgraded here; there is only version 1 so far). */
export function migrateTraitSheet(input: unknown): TraitSheet {
  const raw = (input && typeof input === 'object' ? { ...(input as Record<string, unknown>) } : {}) as Record<string, unknown>;
  if (raw.version === undefined) raw.version = 1;
  return TraitSheetSchema.parse(raw);
}
