/**
 * Part packs: the CharacterStudio trait manifest (https://github.com/M3-org/CharacterStudio, docs
 * "Character Traits"), so packs made for it import unchanged. Fields Everloom doesn't use (wallets,
 * prices, NFT locks) are accepted and ignored. Everloom adds `everloom` (slot mapping and license)
 * for packs that want to say more.
 */
import { z } from 'zod';
import { GARMENT_SLOTS, modelRef } from './slots.js';
import { garmentFromItem } from './recipe.js';

const rel = z.string().min(1).max(300);
const hex = z.string().regex(/^#?[0-9a-fA-F]{6}$/);

export const PackPartSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().max(120).optional(),
    directory: rel,
    thumbnail: rel.optional(),
    fullThumbnail: rel.optional(),
    type: z.array(z.string().max(40)).max(20).optional(),
    cullingLayer: z.number().int().min(-1).max(20).optional(),
    cullingDistance: z.tuple([z.number(), z.number()]).optional(),
    textureCollection: z.string().max(80).optional(),
    colorCollection: z.string().max(80).optional(),
    blendshapeTraits: z.array(z.object({ trait: z.string(), name: z.string().optional(), collection: z.array(z.object({ id: z.string(), name: z.string().optional() }).passthrough()) }).passthrough()).optional(),
  })
  .passthrough();
export type PackPart = z.infer<typeof PackPartSchema>;

export const PackGroupSchema = z
  .object({
    trait: z.string().min(1).max(60),
    name: z.string().max(80).optional(),
    iconSvg: z.string().max(200).optional(),
    cullingLayer: z.number().int().min(-1).max(20).optional(),
    cullingDistance: z.tuple([z.number(), z.number()]).optional(),
    cameraTarget: z.object({ distance: z.number(), height: z.number() }).partial().optional(),
    collection: z.array(PackPartSchema).min(1).max(500),
  })
  .passthrough();
export type PackGroup = z.infer<typeof PackGroupSchema>;

const ColourCollectionSchema = z.object({ trait: z.string().max(80), collection: z.array(z.object({ id: z.string().max(80), name: z.string().max(80).optional(), value: z.union([hex, z.array(hex)]) }).passthrough()) }).passthrough();
const TextureCollectionSchema = z.object({ trait: z.string().max(80), collection: z.array(z.object({ id: z.string().max(80), name: z.string().max(80).optional(), directory: rel, thumbnail: rel.optional() }).passthrough()) }).passthrough();

export const PackManifestSchema = z
  .object({
    assetsLocation: z.string().max(300).optional(),
    traitsDirectory: z.string().max(300).optional(),
    thumbnailsDirectory: z.string().max(300).optional(),
    traitIconsDirectorySvg: z.string().max(300).optional(),
    displayScale: z.number().optional(),
    exportScale: z.number().optional(),
    initialTraits: z.record(z.string(), z.string()).optional(),
    requiredTraits: z.array(z.string()).optional(),
    randomTraits: z.array(z.string()).optional(),
    traitRestrictions: z.record(z.string(), z.object({ restrictedTraits: z.array(z.string()).optional(), restrictedTypes: z.array(z.string()).optional() }).passthrough()).optional(),
    typeRestrictions: z.record(z.string(), z.array(z.string())).optional(),
    defaultCullingLayer: z.number().int().optional(),
    defaultCullingDistance: z.tuple([z.number(), z.number()]).optional(),
    vrmMeta: z.record(z.string(), z.unknown()).optional(),
    traits: z.array(PackGroupSchema).min(1).max(40),
    textureCollections: z.array(TextureCollectionSchema).optional(),
    colorCollections: z.array(ColourCollectionSchema).optional(),
    /** Everloom's own additions (optional). */
    everloom: z
      .object({
        name: z.string().max(80).optional(),
        license: z.string().max(200).optional(),
        credits: z.string().max(4000).optional(),
        /** Trait group → wardrobe slot, where the group name doesn't make it obvious. */
        slots: z.record(z.string(), z.enum(GARMENT_SLOTS)).optional(),
        /** The group holding bodies (default: BODY / Body / body). */
        bodyGroup: z.string().optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough();
export type PackManifest = z.infer<typeof PackManifestSchema>;

/** Where a part file lives inside the pack (CharacterStudio: assetsLocation + traitsDirectory + directory). */
export function packPath(m: PackManifest, file: string, kind: 'trait' | 'thumbnail' | 'icon' | 'asset' = 'trait'): string {
  const dir = kind === 'trait' ? m.traitsDirectory : kind === 'thumbnail' ? m.thumbnailsDirectory : kind === 'icon' ? m.traitIconsDirectorySvg : '';
  // assetsLocation points at where the pack was hosted; inside a zip, paths are relative to the manifest.
  const parts = [dir ?? '', file].join('/').replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

const SLOT_WORDS: Array<[RegExp, (typeof GARMENT_SLOTS)[number]]> = [
  [/hair/i, 'hair'],
  [/head|hat|helm|crown|mask|glasses|eyewear/i, 'head'],
  [/dress|full|suit|onesie|robe/i, 'full'],
  [/outer|coat|jacket|cape|cloak/i, 'outer'],
  [/chest|torso|top|shirt|upper/i, 'top'],
  [/leg|pants|bottom|skirt|lower|waist/i, 'bottom'],
  [/hand|glove|wrist/i, 'hands'],
  [/feet|foot|shoe|boot/i, 'feet'],
  [/sock/i, 'socks'],
  [/under/i, 'underwear'],
];

/** The body group and each other group's wardrobe slot (groups that aren't clothing get null). */
export function packSlots(m: PackManifest): { body: string | null; slots: Record<string, (typeof GARMENT_SLOTS)[number] | null> } {
  const body = m.everloom?.bodyGroup ?? m.traits.find((g) => /^(body|skin|base)$/i.test(g.trait))?.trait ?? null;
  const slots: Record<string, (typeof GARMENT_SLOTS)[number] | null> = {};
  for (const g of m.traits) {
    if (g.trait === body) continue;
    const own = m.everloom?.slots?.[g.trait];
    slots[g.trait] = own ?? SLOT_WORDS.find(([re]) => re.test(`${g.trait} ${g.name ?? ''}`))?.[1] ?? null;
  }
  return { body, slots };
}

/** Problems that make a pack unusable, in plain words (empty: fine). `has` says whether a file is in the pack. */
export function packProblems(m: PackManifest, has: (path: string) => boolean): string[] {
  const out: string[] = [];
  const { body } = packSlots(m);
  if (!body) out.push('No body group: name one trait group "BODY" (or set everloom.bodyGroup).');
  const ids = new Set<string>();
  for (const g of m.traits) {
    if (ids.has(g.trait)) out.push(`Trait group "${g.trait}" appears twice.`);
    ids.add(g.trait);
    for (const p of g.collection) {
      const f = packPath(m, p.directory);
      if (!/\.(vrm|glb)$/i.test(f)) out.push(`${g.trait}/${p.id}: "${p.directory}" is not a VRM or GLB file.`);
      else if (!has(f)) out.push(`${g.trait}/${p.id}: "${f}" is missing from the pack.`);
    }
  }
  for (const [g, id] of Object.entries(m.initialTraits ?? {})) {
    const grp = m.traits.find((x) => x.trait === g);
    if (grp && !grp.collection.some((p) => p.id === id)) out.push(`initialTraits: "${id}" is not a part of "${g}".`);
  }
  return out.slice(0, 20);
}

/**
 * The parts a character is made of: the pack, one part per group (or none), colours per group, and
 * morph (blendshape) choices. Kept with the avatar so it stays editable.
 */
export const MakerSelectionSchema = z.object({
  pack: z.string().max(64),
  /** The body part's model (a media id or a built-in pack file). */
  body: modelRef,
  parts: z.record(z.string().max(60), z.string().max(80).nullable()),
  colors: z.record(z.string().max(60), z.string().regex(/^#[0-9a-fA-F]{6}$/)).default({}),
  textures: z.record(z.string().max(60), z.string().max(80)).default({}),
  morphs: z.record(z.string().max(80), z.number().min(0).max(1)).default({}),
});
export type MakerSelection = z.infer<typeof MakerSelectionSchema>;

const ITEM_SLOT: Record<string, (typeof GARMENT_SLOTS)[number][]> = { head: ['head', 'hair'], body: ['top', 'full', 'outer'], legs: ['bottom', 'full'], feet: ['feet', 'socks'], hands: ['hands'], back: ['outer'], accessory: ['head', 'outer'] };
const GARMENT_TO_SLOT: Record<string, (typeof GARMENT_SLOTS)[number][]> = { hat: ['head'], top: ['top', 'full', 'outer'], bottom: ['bottom', 'full'], shoes: ['feet'], extra: ['outer', 'head'] };
const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);

/**
 * The pack part an inventory item puts on a parts-made character: the item's slot (or what its
 * words say it is) picks the trait groups, then the part whose id, name and types share the most
 * words with the item's name, description and tags. Null when nothing fits.
 */
export function partForItem(m: PackManifest, item: { name: string; desc?: string; category?: string; slot?: string | null; tags?: string[] }): { group: string; part: PackPart } | null {
  const { slots } = packSlots(m);
  const g = garmentFromItem(item).garment;
  const want = new Set([...(item.slot ? (ITEM_SLOT[item.slot] ?? []) : []), ...(g ? (GARMENT_TO_SLOT[g.slot] ?? []) : [])]);
  if (!want.size) return null;
  const itemWords = new Set([...words(item.name), ...words(item.desc ?? ''), ...(item.tags ?? []).flatMap(words), ...(g ? [g.kind] : [])]);
  let best: { group: string; part: PackPart; score: number } | null = null;
  for (const grp of m.traits) {
    const slot = slots[grp.trait];
    if (!slot || !want.has(slot)) continue;
    for (const p of grp.collection) {
      const pw = new Set([...words(p.id.replace(/_/g, ' ')), ...words(p.name ?? ''), ...(p.type ?? []).flatMap(words), p.id.toLowerCase()]);
      let score = 0;
      for (const w of itemWords) if (pw.has(w)) score += w === g?.kind ? 3 : 1;
      if (score > 0 && (!best || score > best.score)) best = { group: grp.trait, part: p, score };
    }
  }
  return best ? { group: best.group, part: best.part } : null;
}
