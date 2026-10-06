/**
 * What a 3D character wears right now. In order: the outfit the story put them in (avatar.outfit,
 * which rolls back with swipes), else an outfit their equipped items call for, else their default
 * outfit. Parts and accessories linked to equipped items go on too; parts in the same group replace
 * each other; the body regions covered by what is on are hidden so skin never pokes through.
 */
import type { AvatarAccessory, AvatarConfig, AvatarOutfit, Garment } from './config.js';
import { BODY_REGIONS, type BodyRegion } from './skeleton.js';

export interface WardrobeState {
  outfit: AvatarOutfit | null;
  /** Part id → shown. */
  parts: Record<string, boolean>;
  accessories: AvatarAccessory[];
  /** Garments worn, with the variant chosen for each. */
  garments: Array<{ garment: Garment; variant: string | null }>;
  hidden: BodyRegion[];
  /** Why this outfit (for the dressing room and the detail sheet). */
  reason: 'story' | 'items' | 'default' | 'none';
}

const norm = (s: string) => s.trim().toLowerCase();

export function resolveWardrobe(cfg: Pick<AvatarConfig, 'parts' | 'outfits' | 'outfit' | 'accessories'> & Partial<Pick<AvatarConfig, 'garments'>>, opts: { story?: string | null; equipped?: readonly string[] } = {}): WardrobeState {
  const equipped = new Set((opts.equipped ?? []).map(norm));
  const byName = (x: string) => cfg.outfits.find((o) => o.id === x || norm(o.name) === norm(x));
  let outfit: AvatarOutfit | null = null;
  let reason: WardrobeState['reason'] = 'none';
  if (opts.story) {
    outfit = byName(opts.story) ?? null;
    if (outfit) reason = 'story';
  }
  if (!outfit && equipped.size) {
    outfit = cfg.outfits.find((o) => o.items.some((i) => equipped.has(norm(i)))) ?? null;
    if (outfit) reason = 'items';
  }
  if (!outfit && cfg.outfit) {
    outfit = cfg.outfits.find((o) => o.id === cfg.outfit) ?? null;
    if (outfit) reason = 'default';
  }

  const parts: Record<string, boolean> = Object.fromEntries(cfg.parts.map((p) => [p.id, p.on]));
  const turnOn = (id: string) => {
    const p = cfg.parts.find((x) => x.id === id);
    if (!p) return;
    if (p.group) for (const q of cfg.parts) if (q.group === p.group) parts[q.id] = false;
    parts[id] = true;
  };
  if (outfit?.parts.length) {
    // An outfit decides its groups: everything grouped with what it lists goes off first.
    const groups = new Set(outfit.parts.map((id) => cfg.parts.find((p) => p.id === id)?.group).filter(Boolean));
    for (const p of cfg.parts) if (p.group && groups.has(p.group)) parts[p.id] = false;
    for (const id of outfit.parts) turnOn(id);
  }
  // Equipped items show their parts (a helmet), on top of the outfit.
  for (const p of cfg.parts) if (p.items.some((i) => equipped.has(norm(i)))) turnOn(p.id);

  // Garments: one per slot and layer. Defaults first, then the outfit's, then equipped items'.
  const all = cfg.garments ?? [];
  const worn = new Map<string, { garment: Garment; variant: string | null }>();
  const wear = (g: Garment, variant: string | null) => worn.set(`${g.slot}:${g.layer}`, { garment: g, variant: variant ?? g.variant });
  if (outfit?.garments.length) for (const og of outfit.garments) {
    const g = all.find((x) => x.id === og.id);
    if (g) wear(g, og.variant);
  }
  else for (const g of all) if (g.on && !g.items.length) wear(g, g.variant);
  for (const g of all) if (g.items.some((i) => equipped.has(norm(i)))) wear(g, g.variant);
  // A garment can hide whole slots (a helmet hides the hair under it).
  const hiddenSlots = new Set([...worn.values()].flatMap((w) => w.garment.hidesSlots ?? []));
  const garments = [...worn.values()].filter((w) => !hiddenSlots.has(w.garment.slot)).sort((a, b) => a.garment.layer - b.garment.layer);

  const accessories = cfg.accessories.filter((a) => (a.items.length ? a.items.some((i) => equipped.has(norm(i))) : a.on));
  const hidden = new Set<BodyRegion>();
  for (const p of cfg.parts) if (parts[p.id]) for (const r of p.hides) hidden.add(r as BodyRegion);
  for (const { garment } of garments) for (const r of garment.hides) hidden.add(r as BodyRegion);
  return { outfit, parts, accessories, garments, hidden: BODY_REGIONS.filter((r) => hidden.has(r)), reason };
}

/** Hidden regions as a bit mask (bit i = BODY_REGIONS[i]), for the shader. */
export function regionMask(hidden: readonly BodyRegion[]): number {
  return hidden.reduce((m, r) => m | (1 << BODY_REGIONS.indexOf(r)), 0);
}
