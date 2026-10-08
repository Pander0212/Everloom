/**
 * Secondary-motion settings: hair, tails, skirts, loose cloth and the chest swing on spring chains
 * solved in the browser, with spheres and capsules on the body keeping them outside it.
 */
import { z } from 'zod';
import { HUMANOID_BONES } from './skeleton.js';

const bone = z.string().max(200);
const vec3 = z.tuple([z.number().min(-10).max(10), z.number().min(-10).max(10), z.number().min(-10).max(10)]);

export const CHAIN_KINDS = ['hair', 'tail', 'cloth', 'chest', 'accessory'] as const;
export type ChainKind = (typeof CHAIN_KINDS)[number];

export const SpringSettingsSchema = z.object({
  /** Pull back toward the rest shape (0 floppy, 4 stiff). */
  stiffness: z.number().min(0).max(8).default(1),
  /** How quickly motion dies down (0 swings forever, 1 none). */
  damping: z.number().min(0).max(1).default(0.4),
  gravity: z.number().min(0).max(4).default(1),
  /** How much wind moves it. */
  wind: z.number().min(0).max(2).default(0.5),
  /** Collision radius of each point, in metres. */
  radius: z.number().min(0).max(0.2).default(0.015),
});
export type SpringSettings = z.infer<typeof SpringSettingsSchema>;

/** A chain the owner picked (bones outside the humanoid: a ponytail, a tail, a skirt bone). */
export const ChainPickSchema = z.object({ bone, kind: z.enum(CHAIN_KINDS).default('hair'), on: z.boolean().default(true), settings: SpringSettingsSchema.partial().default({}) });

/** A change to one generated collider (they're made from the body's proportions). */
export const ColliderEditSchema = z.object({
  bone: z.enum(HUMANOID_BONES),
  /** Multiplies the generated radius. */
  radius: z.number().min(0).max(4).default(1),
  offset: vec3.default([0, 0, 0]),
  on: z.boolean().default(true),
});
export type ColliderEdit = z.infer<typeof ColliderEditSchema>;

export const PhysicsSchema = z.object({
  enabled: z.boolean().default(true),
  stiffness: z.number().min(0).max(4).default(1),
  gravity: z.number().min(0).max(4).default(1),
  damping: z.number().min(0).max(1).default(0.4),
  wind: z.number().min(0).max(2).default(0),
  chest: z.object({ enabled: z.boolean().default(true), strength: z.number().min(0).max(2).default(1) }).default({ enabled: true, strength: 1 }),
  /** Chains picked in the editor (on top of the ones found by name and VRM's own). */
  chains: z.array(ChainPickSchema).max(64).default([]),
  colliders: z.array(ColliderEditSchema).max(32).default([]),
});
export type Physics = z.infer<typeof PhysicsSchema>;

/**
 * A garment's or hairstyle's physics: how the loose part swings. 'chains' makes bone chains around
 * the garment (a skirt, a coat's tails) and pins the top to the body; 'hair' hangs chains from the
 * head. The pin gradient goes from fully on the body (above `pinStart`) to fully swinging (below
 * `pinEnd`), as fractions of the garment's height from its top.
 */
export const GarmentPhysicsSchema = z.object({
  mode: z.enum(['none', 'chains', 'hair']).default('none'),
  pinStart: z.number().min(0).max(1).default(0.15),
  pinEnd: z.number().min(0).max(1).default(0.75),
  chains: z.number().int().min(3).max(16).default(8),
  segments: z.number().int().min(2).max(6).default(4),
  settings: SpringSettingsSchema.default({ stiffness: 1, damping: 0.4, gravity: 1, wind: 0.5, radius: 0.015 }),
});
export type GarmentPhysics = z.infer<typeof GarmentPhysicsSchema>;

/** Per-quality limits on simulated points per character, and the solver's rate. */
export const PHYSICS_BUDGET = [
  { points: 0, hz: 0 },
  { points: 48, hz: 30 },
  { points: 96, hz: 60 },
  { points: 160, hz: 60 },
] as const;
