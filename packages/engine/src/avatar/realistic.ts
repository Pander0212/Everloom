/**
 * Realistic characters made with MPFB (the MakeHuman add-on for Blender): the body sliders and the
 * MakeHuman system assets (skins, eyes, brows, lashes, hair, clothes) the character wears. Saved
 * on the avatar so it can be made again with changes.
 */
import { z } from 'zod';

const unit = z.number().min(0).max(1);
/** MakeHuman asset folder names, e.g. "young_caucasian_female" or "female_casualsuit01". */
export const MpfbAssetName = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);

export const RealisticSpecSchema = z.object({
  macro: z
    .object({
      /** 0 female … 1 male. */
      gender: unit.default(0.5),
      /** 0 is 1 year old, 0.1875 is 11, 0.5 is 25, 1 is 90 (MakeHuman's scale). */
      age: unit.default(0.5),
      weight: unit.default(0.5),
      muscle: unit.default(0.5),
      height: unit.default(0.5),
      proportions: unit.default(0.5),
      race: z.object({ african: unit.default(0.33), asian: unit.default(0.33), caucasian: unit.default(0.33) }).prefault({}),
    })
    .prefault({}),
  skin: MpfbAssetName.nullable().default(null),
  eyes: MpfbAssetName.nullable().default('low-poly'),
  eyebrows: MpfbAssetName.nullable().default(null),
  eyelashes: MpfbAssetName.nullable().default(null),
  hair: MpfbAssetName.nullable().default(null),
  clothes: z.array(MpfbAssetName).max(8).default([]),
});
export type RealisticSpec = z.infer<typeof RealisticSpecSchema>;

/** Characters are adults: MakeHuman's age slider is clamped to 18 years and up. */
export const MIN_ADULT_AGE = 0.34375;
export function adultAge(age: number): number {
  return Math.max(MIN_ADULT_AGE, Math.min(1, age));
}

/** MakeHuman's age slider as years (0 → 1, 0.1875 → 11, 0.5 → 25, 1 → 90). */
export function ageYears(v: number): number {
  if (v < 0.1875) return 1 + (v / 0.1875) * 10;
  if (v < 0.5) return 11 + ((v - 0.1875) / 0.3125) * 14;
  return 25 + ((v - 0.5) / 0.5) * 65;
}
