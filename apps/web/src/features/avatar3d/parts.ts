/**
 * Parts-made characters as wardrobe garments: the chosen parts of a pack, and the part an equipped
 * item puts on (matched by slot, then by words, tags and types; see partForItem).
 */
import { GARMENT_SLOTS, packPath, packSlots, partForItem, type AvatarConfig, type Garment, type GarmentSlot, type MakerSelection, type PackPart } from '@everloom/engine';
import { packRef, type LoadedPack } from '@/features/avatars/packs';

const LAYER: Partial<Record<GarmentSlot, number>> = { underwear: 0, socks: 0, outer: 2, head: 2 };

/** One pack part as a garment of the pack's body family. */
export function garmentOf(pack: LoadedPack, group: string, part: PackPart, slot: GarmentSlot, color?: string): Garment | null {
  const ref = packRef(pack, packPath(pack.manifest, part.directory));
  if (!ref) return null;
  return {
    id: `${group}-${part.id}`.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 40),
    name: (part.name ?? part.id).slice(0, 60),
    model: ref,
    modelLow: null,
    slot,
    layer: LAYER[slot] ?? 1,
    hides: [],
    // CharacterStudio packs describe parts with types; "hides-hair" (and so on) hides that slot.
    hidesSlots: (part.type ?? []).flatMap((t) => {
      const s = /^hides-(\w+)$/.exec(t)?.[1];
      return s && (GARMENT_SLOTS as readonly string[]).includes(s) ? [s as GarmentSlot] : [];
    }),
    variants: color ? [{ id: 'chosen', name: 'Chosen colour', tint: color, texture: null }] : [],
    variant: color ? 'chosen' : null,
    springs: true,
    family: `pack:${pack.id}`,
    on: true,
    items: [],
  };
}

/** The garments a selection wears (one per chosen part outside the body group). */
export function garmentsFor(pack: LoadedPack, sel: MakerSelection): Garment[] {
  const { body, slots } = packSlots(pack.manifest);
  const out: Garment[] = [];
  for (const g of pack.manifest.traits) {
    if (g.trait === body) continue;
    const id = sel.parts[g.trait];
    const part = id ? g.collection.find((p) => p.id === id) : null;
    const gm = part ? garmentOf(pack, g.trait, part, slots[g.trait] ?? 'outer', sel.colors[g.trait]) : null;
    if (gm) out.push(gm);
  }
  return out;
}

export interface WornItem {
  name: string;
  desc?: string;
  category?: string;
  slot?: string | null;
  tags?: string[];
}

/**
 * The settings with equipped items worn: each item that matches a part of the character's pack
 * replaces what the character wears in that slot. Garments already linked to the item by name
 * (the dressing room) win, so they're left to the wardrobe.
 */
export function wearItems(cfg: AvatarConfig, pack: LoadedPack | undefined, items: WornItem[]): AvatarConfig {
  if (!pack || !cfg.maker || !items.length) return cfg;
  const { slots } = packSlots(pack.manifest);
  let garments = cfg.garments;
  for (const it of items) {
    if (garments.some((g) => g.items.includes(it.name))) continue;
    const hit = partForItem(pack.manifest, it);
    const slot = hit ? slots[hit.group] : null;
    const gm = hit && slot ? garmentOf(pack, hit.group, hit.part, slot, cfg.maker.colors[hit.group]) : null;
    if (!gm) continue;
    garments = [...garments.filter((g) => g.slot !== gm.slot), { ...gm, id: `item-${gm.id}`.slice(0, 40) }];
  }
  return garments === cfg.garments ? cfg : { ...cfg, garments };
}
