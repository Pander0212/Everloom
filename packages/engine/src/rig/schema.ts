/**
 * Bone mapping beyond the humanoid core: the spine as a chain of any length, and secondary roles
 * (breasts, butt, hair, skirt, tail, helpers…) holding any number of bones or chains, each with a
 * side, the evidence that put it there, and a confidence. See docs/3d-import/bones.md.
 */
import { z } from 'zod';

export const RIG_ROLES = [
  'breast',
  'butt',
  'belly',
  'thighHelper',
  'upperArmHelper',
  'forearmHelper',
  'shoulderHelper',
  'hair',
  'skirt',
  'coat',
  'tail',
  'ears',
  'wings',
  'eyelid',
  'tongue',
  'teeth',
  'accessory',
] as const;
export type RigRole = (typeof RIG_ROLES)[number];

/** Roles that swing with physics, and the spring preset each uses. */
export const ROLE_PHYSICS: Partial<Record<RigRole, 'chest' | 'butt' | 'belly' | 'hair' | 'cloth' | 'tail' | 'accessory'>> = {
  breast: 'chest',
  butt: 'butt',
  belly: 'belly',
  hair: 'hair',
  skirt: 'cloth',
  coat: 'cloth',
  tail: 'tail',
  ears: 'accessory',
  wings: 'accessory',
  accessory: 'accessory',
};

/** Helper and twist bones follow their parent's twist by this fraction when retargeting. */
export const HELPER_FOLLOW: Partial<Record<RigRole, number>> = { thighHelper: 0.5, upperArmHelper: 0.5, forearmHelper: 0.5, shoulderHelper: 0.5 };

const bone = z.string().max(200);
export const SideSchema = z.enum(['L', 'R', 'C']);

export const RoleAssignmentSchema = z.object({
  role: z.enum(RIG_ROLES),
  side: SideSchema.default('C'),
  /** A chain from its root outward (one bone for a single helper). */
  bones: z.array(bone).min(1).max(64),
  /** 0–1: how sure the mapping is; under 0.6 is flagged for review. */
  confidence: z.number().min(0).max(1).default(1),
  /** Why it was put here (the evidence), or "set by you". */
  why: z.string().max(200).default(''),
});
export type RoleAssignment = z.infer<typeof RoleAssignmentSchema>;

export const RigMappingSchema = z.object({
  version: z.literal(1).default(1),
  /** The spine from the hips up to the neck, in order (Spine → Spine1 → Spine2 → Chest → UpperChest). */
  spine: z.array(bone).max(12).default([]),
  roles: z.array(RoleAssignmentSchema).max(400).default([]),
  /** Bones deliberately left alone (end bones, IK targets, controls). */
  ignore: z.array(bone).max(1000).default([]),
  /** A known base the skeleton was recognised as (preset id). */
  base: z.string().max(60).nullable().default(null),
});
export type RigMapping = z.infer<typeof RigMappingSchema>;
