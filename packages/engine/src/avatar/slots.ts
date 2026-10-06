import { z } from 'zod';

/** Wardrobe slots for garments (one garment per slot and layer). */
export const GARMENT_SLOTS = ['hair', 'head', 'top', 'bottom', 'full', 'outer', 'hands', 'feet', 'socks', 'underwear'] as const;
export type GarmentSlot = (typeof GARMENT_SLOTS)[number];

/** A model file: a media id, or a file of a built-in part pack served with the app. */
export const modelRef = z.string().max(300).refine((s) => /^[\w-]{1,64}$/.test(s) || (/^\/avatar\/packs\/[\w\-./]+\.(glb|vrm)$/.test(s) && !s.includes('..')), 'Not a model file');
export const modelUrl = (ref: string) => (ref.startsWith('/') ? ref : `/media/${ref}`);
