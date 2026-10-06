/**
 * An avatar's saved settings (the "Everloom avatar spec" beside the model file): how its bones and
 * face map onto the canonical ones, its size, floor and facing, look, physics and wardrobe. The model
 * file itself stays a plain GLB (or VRM); everything Everloom adds lives here.
 */
import { z } from 'zod';
import { CANONICAL_EXPRESSIONS } from './expressions.js';
import { BODY_REGIONS, HUMANOID_BONES } from './skeleton.js';

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
});

/** Level 1 wardrobe: a named outfit; a different model file, or a set of parts switched on. */
export const AvatarOutfitSchema = z.object({
  id,
  name: label,
  /** A whole other model (media id) for this outfit, with the same skeleton. */
  model: z.string().max(64).nullable().default(null),
  modelLow: z.string().max(64).nullable().default(null),
  /** Parts to switch on (all others in this list's groups go off). */
  parts: z.array(id).max(64).default([]),
  /** Inventory items (by name) that put this outfit on when equipped. */
  items: z.array(z.string().max(120)).max(16).default([]),
});

export const AvatarConfigSchema = z.object({
  version: z.literal(1).default(1),
  boneMap: BoneMapSchema.default({}),
  expressionMap: ExpressionMapSchema.default({}),
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
  physics: z.object({ enabled: z.boolean().default(true), stiffness: z.number().min(0).max(4).default(1), gravity: z.number().min(0).max(4).default(1) }).default({ enabled: true, stiffness: 1, gravity: 1 }),
  parts: z.array(AvatarPartSchema).max(64).default([]),
  outfits: z.array(AvatarOutfitSchema).max(32).default([]),
  outfit: id.nullable().default(null),
});
export type AvatarConfig = z.infer<typeof AvatarConfigSchema>;
export type AvatarPart = z.infer<typeof AvatarPartSchema>;
export type AvatarOutfit = z.infer<typeof AvatarOutfitSchema>;

export const AVATAR_KINDS = ['imported', 'parts', 'code', 'realistic'] as const;
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
