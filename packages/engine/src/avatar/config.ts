/**
 * An avatar's saved settings (the "Everloom avatar spec" beside the model file): how its bones and
 * face map onto the canonical ones, its size, floor and facing, look, physics and wardrobe. The model
 * file itself stays a plain GLB (or VRM); everything Everloom adds lives here.
 */
import { z } from 'zod';
import { CANONICAL_EXPRESSIONS } from './expressions.js';
import { BODY_REGIONS, HUMANOID_BONES } from './skeleton.js';
import { AvatarRecipeSchema } from './recipe.js';
import { MakerSelectionSchema } from './packs.js';
import { RealisticSpecSchema } from './realistic.js';
import { MorphSettingsSchema } from './morphs.js';
import { AppearanceSchema, SkinLayerSchema } from './layers.js';
import { GarmentPhysicsSchema, PhysicsSchema } from './physics.js';

const id = z.string().regex(/^[a-z0-9_-]{1,40}$/);
const label = z.string().trim().min(1).max(60);
const nodeName = z.string().max(200);

export const MorphWeightSchema = z.object({ morph: z.string().max(200), weight: z.number().min(-1).max(2) });
export const BoneMapSchema = z.partialRecord(z.enum(HUMANOID_BONES as unknown as [string, ...string[]]), nodeName);
export const ExpressionMapSchema = z.partialRecord(z.enum(CANONICAL_EXPRESSIONS as unknown as [string, ...string[]]), z.array(MorphWeightSchema).max(12));

/** Level 2 wardrobe: a part of the model (meshes) that can be shown or hidden. */
export const AvatarPartSchema = z.object({
  id,
  name: label,
  meshes: z.array(nodeName).min(1).max(64),
  /** Body regions this part covers; the body's meshes for those regions are hidden while it's on. */
  hides: z.array(z.enum(BODY_REGIONS as unknown as [string, ...string[]])).max(BODY_REGIONS.length).default([]),
  /** Parts in the same group replace each other (one hairstyle at a time). */
  group: z.string().max(40).optional(),
  on: z.boolean().default(true),
  /** Inventory items (by name) that put this part on when equipped (a helmet item shows the helmet). */
  items: z.array(z.string().max(120)).max(16).default([]),
});

/** Where a garment goes; one garment per slot and layer is worn at a time. */
import { GARMENT_SLOTS } from './slots.js';
export { GARMENT_SLOTS, type GarmentSlot } from './slots.js';

import { modelRef } from './slots.js';
export { modelRef, modelUrl } from './slots.js';

/**
 * Wardrobe level 3: a garment is its own model file rigged to the same body family's skeleton; it is
 * bound to the avatar's bones when worn. Layers stack (0 under, 3 outer); variants recolour it or
 * swap its texture.
 */
export const GarmentSchema = z.object({
  id,
  name: label,
  /** A media id, or a file of a built-in part pack (`/avatar/packs/…`). */
  model: modelRef,
  modelLow: modelRef.nullable().default(null),
  slot: z.enum(GARMENT_SLOTS),
  layer: z.number().int().min(0).max(3).default(1),
  hides: z.array(z.enum(BODY_REGIONS as unknown as [string, ...string[]])).max(BODY_REGIONS.length).default([]),
  /** Other garment slots this one hides while worn (a hood or helmet hides the hair). */
  hidesSlots: z.array(z.enum(GARMENT_SLOTS)).max(GARMENT_SLOTS.length).default([]),
  variants: z.array(z.object({ id, name: label, tint: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null), texture: z.string().max(64).nullable().default(null), /** How many times a pattern tile repeats across the garment. */ repeat: z.number().min(0.25).max(32).default(1) })).max(16).default([]),
  variant: id.nullable().default(null),
  /** Bone chains in the garment (a skirt, a cape) swing with physics. */
  springs: z.boolean().default(true),
  /** How its loose part swings (saved with the garment, like a preset). */
  physics: GarmentPhysicsSchema.optional(),
  /** Made in the browser's fitting mode: for which base, and what the automatic steps found. */
  fit: z.object({
    base: z.string().max(80).nullable().default(null),
    morphs: z.number().int().min(0).max(1024).default(0),
    flagged: z.number().int().min(0).default(0),
    vertices: z.number().int().min(0).default(0),
    ms: z.number().min(0).default(0),
  }).optional(),
  /** The body family it was made for (garments fit any avatar of that family). */
  family: z.string().max(40).nullable().default(null),
  on: z.boolean().default(true),
  items: z.array(z.string().max(120)).max(16).default([]),
});
export type Garment = z.infer<typeof GarmentSchema>;

/** A rigid accessory (sword, hat, glasses) attached to a bone: its own small model file. */
export const AvatarAccessorySchema = z.object({
  id,
  name: label,
  model: z.string().max(64),
  bone: z.enum(HUMANOID_BONES as unknown as [string, ...string[]]),
  /** Position (metres), rotation (degrees) and size relative to the bone. */
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  scale: z.number().min(0.01).max(100).default(1),
  on: z.boolean().default(true),
  items: z.array(z.string().max(120)).max(16).default([]),
});

/** Level 1 wardrobe: a named outfit; a different model file, or a set of parts switched on. */
export const MaterialOverrideSchema = z.object({
  texture: z.string().regex(/^[\w-]{1,64}$/).nullable().optional(),
  shadeTexture: z.string().regex(/^[\w-]{1,64}$/).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  alpha: z.enum(['opaque', 'mask', 'blend']).optional(),
});
export const MaterialOverridesSchema = z.record(nodeName, MaterialOverrideSchema).refine(v => Object.keys(v).length <= 128, 'Too many material overrides');
export const AvatarOutfitSchema = z.object({
  /** Native proxies are rebuilt against the current body, preserving story outfit rollback. */
  makehumanProxies: z.array(z.string().max(200)).max(32).optional(),
  id,
  name: label,
  /** A whole other model (media id) for this outfit, with the same skeleton. */
  model: z.string().max(64).nullable().default(null),
  modelLow: z.string().max(64).nullable().default(null),
  /** Parts to switch on (all others in this list's groups go off). */
  parts: z.array(id).max(64).default([]),
  /** Garments to wear (others in the same slot and layer come off), with a variant each. */
  garments: z.array(z.object({ id, variant: id.nullable().default(null) })).max(32).default([]),
  /** Clothing skin layers to wear (underwear, swimwear, stockings); others of those kinds come off. */
  layers: z.array(id).max(32).optional(),
  /** Inventory items (by name) that put this outfit on when equipped. */
  items: z.array(z.string().max(120)).max(16).default([]),
  materialOverrides: MaterialOverridesSchema.optional(),
});

const reportLines = z.array(z.object({ what: z.string().max(120), detail: z.string().max(600).optional() })).max(60).default([]);
/** How a model came in (a Unity package, extracted files…), and what the import did with it. */
export const ImportReportSchema = z.object({
  source: z.string().max(80),
  imported: reportLines,
  approximated: reportLines,
  skipped: reportLines,
  /** The package's own license or readme (first part). */
  license: z.array(z.object({ path: z.string().max(300), text: z.string().max(6000) })).max(6).default([]),
  /** Bought or downloaded content: personal use; never exported, bundled or shared unless the owner confirms the right to. */
  thirdParty: z.boolean().default(false),
  guessed: z.array(z.object({ from: z.string().max(300), to: z.string().max(300), how: z.string().max(120) })).max(200).default([]),
  at: z.string().max(40).optional(),
});
export type ImportReport = z.infer<typeof ImportReportSchema>;

export const AvatarConfigSchema = z.object({
  content: z.object({ adult: z.boolean().default(false), age: z.number().min(0).max(120).nullable().default(null), description: z.string().max(4000).default(''), confirmedAdult: z.boolean().default(false) }).default({ adult: false, age: null, description: '', confirmedAdult: false }),
  version: z.literal(1).default(1),
  boneMap: BoneMapSchema.default({}),
  expressionMap: ExpressionMapSchema.default({}),
  materialOverrides: MaterialOverridesSchema.default({}),
  bodyShape: z.object({ chest: z.number().min(-0.35).max(0.35).default(0), buttocks: z.number().min(-0.35).max(0.35).default(0), hips: z.number().min(-0.35).max(0.35).default(0), waist: z.number().min(-0.35).max(0.35).default(0), thighs: z.number().min(-0.35).max(0.35).default(0), shoulders: z.number().min(-0.35).max(0.35).default(0) }).optional(),
  /** 'auto': toon for VRM and anime models, PBR for realistic ones (chosen when loaded). */
  look: z.enum(['auto', 'toon', 'pbr']).default('auto'),
  outlines: z.boolean().default(true),
  outlineWidth: z.number().min(0).max(0.02).optional(),
  /** File units to metres (0.01 for centimetre models), times any size change made in the wizard. */
  scale: z.number().min(0.0001).max(10_000).default(1),
  /** Metres to raise (+) or lower (−) the model so its feet meet the floor. */
  floor: z.number().min(-5).max(5).default(0),
  /** Degrees to turn the model so it faces the camera. */
  facing: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  /** Fine-tuning of the camera presets: where the eyes are, as a fraction of the height. */
  eyeLine: z.number().min(0.5).max(1).optional(),
  physics: PhysicsSchema.default(PhysicsSchema.parse({})),
  /** Custom bases: sliders made from the file's morph targets, their values and saved body presets. */
  morphs: MorphSettingsSchema.optional(),
  /** Makeup, tattoos, tight clothing and scars baked onto the skin texture. */
  skinLayers: z.array(SkinLayerSchema).max(32).default([]),
  /** Skin tone, hair and eye colours. */
  appearance: AppearanceSchema.optional(),
  parts: z.array(AvatarPartSchema).max(64).default([]),
  outfits: z.array(AvatarOutfitSchema).max(32).default([]),
  outfit: id.nullable().default(null),
  accessories: z.array(AvatarAccessorySchema).max(32).default([]),
  garments: z.array(GarmentSchema).max(64).default([]),
  /** The body family this avatar belongs to (which garments fit it). */
  family: z.string().max(40).nullable().default(null),
  /** The meshes that are the body's skin (regions of these hide under clothes). */
  body: z.array(nodeName).max(16).default([]),
  /** Colours set on meshes by name (the parts maker's skin colour). */
  tints: z.record(z.string().max(80), z.string().regex(/^#[0-9a-fA-F]{6}$/)).default({}),
  /** Code-made avatars: the recipe the model is built from (no model file). */
  recipe: AvatarRecipeSchema.optional(),
  /** Parts-made avatars: the pack and the parts chosen in the maker (stays editable). */
  maker: MakerSelectionSchema.optional(),
  /** Realistic (MPFB) avatars: the sliders and assets it was made from (to make it again). */
  realistic: RealisticSpecSchema.optional(),
  /** Imported from a Unity package or similar: what came in, and the license the files came with. */
  importReport: ImportReportSchema.optional(),
  /** Native MakeHuman data recipe, applied in the browser to a professionally authored base. */
  makehuman: z.object({
    macro: RealisticSpecSchema.shape.macro,
    cupsize: z.number().min(0).max(1).default(0.5),
    firmness: z.number().min(0).max(1).default(0.5),
    targets: z.record(z.string().max(200), z.number().min(-1).max(1)).default({}),
    rig: z.string().max(200).default('rigs/standard/rig.game_engine.json'),
    skin: z.string().max(200),
    proxies: z.array(z.string().max(200)).max(32),
  }).optional(),
});
export type AvatarConfig = z.infer<typeof AvatarConfigSchema>;
export type AvatarPart = z.infer<typeof AvatarPartSchema>;
export type AvatarOutfit = z.infer<typeof AvatarOutfitSchema>;
export type AvatarAccessory = z.infer<typeof AvatarAccessorySchema>;

export const AVATAR_KINDS = ['imported', 'parts', 'code', 'realistic', 'makehuman'] as const;
export type AvatarKind = (typeof AVATAR_KINDS)[number];

/** How a character is shown on the stage. 'auto' picks the richest one available. */
export const DISPLAY_MODES = ['auto', '3d', 'live2d', 'sprite'] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];

export function defaultAvatarConfig(): AvatarConfig {
  return AvatarConfigSchema.parse({});
}

/** A motion clip on the canonical skeleton (see apps/web/src/features/avatar3d/runtime/clip.ts). */
export const ClipSchema = z
  .object({
    v: z.literal(1),
    id: z.string().regex(/^[a-z0-9_]{1,40}$/),
    fps: z.number().min(1).max(120),
    frames: z.number().int().min(1).max(30 * 120),
    loop: z.boolean(),
    tracks: z.partialRecord(z.enum(HUMANOID_BONES as unknown as [string, ...string[]]), z.array(z.number().finite()).max(4 * 30 * 120)),
    hips: z.array(z.number().finite()).max(3 * 30 * 120).optional(),
    source: z.string().max(200).optional(),
  })
  .superRefine((c, ctx) => {
    for (const [b, t] of Object.entries(c.tracks)) if (t && t.length !== 4 && t.length !== 4 * c.frames) ctx.addIssue({ code: 'custom', message: `Track ${b} has the wrong length` });
    if (c.hips && c.hips.length !== 3 && c.hips.length !== 3 * c.frames) ctx.addIssue({ code: 'custom', message: 'The hips track has the wrong length' });
  });
export type ClipData = z.infer<typeof ClipSchema>;
