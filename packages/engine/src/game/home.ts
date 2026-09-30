/**
 * Player homes: residences on the map, rooms with amenities that do something (a better bed makes
 * sleep restore more, a kitchen is a cooking station), storage with capacity, and the household:
 * who lives where, who is visiting, and who is home right now (from schedules).
 */
import type { CampaignState, Discipline, Home, HomeKind, HouseholdMember, Room, ScheduleSlot, Storage } from './state.js';
import { slotActive } from './simulate.js';

export interface Amenity {
  id: string;
  label: string;
  /** A crafting station for this discipline. */
  station?: Discipline;
  /** Sleep restores this much more per level (0.25 = +25%). */
  sleep?: number;
  /** Bathing restores this much more per level. */
  bath?: number;
  /** Training and study give this much more XP per level. */
  study?: number;
}

export const AMENITIES: Amenity[] = [
  { id: 'bed', label: 'Bed', sleep: 0.25 },
  { id: 'bedroll', label: 'Bedroll', sleep: 0.05 },
  { id: 'kitchen', label: 'Kitchen', station: 'cooking' },
  { id: 'hearth', label: 'Hearth', station: 'cooking' },
  { id: 'forge', label: 'Forge', station: 'forge' },
  { id: 'alchemy', label: 'Alchemy bench', station: 'alchemy' },
  { id: 'enchanting', label: 'Enchanting table', station: 'enchantment' },
  { id: 'workbench', label: 'Workbench', station: 'general' },
  { id: 'bath', label: 'Bath', bath: 0.5 },
  { id: 'study', label: 'Study desk', study: 0.2 },
  { id: 'fireplace', label: 'Fireplace', sleep: 0.1 },
];
export const amenity = (id: string) => AMENITIES.find((a) => a.id === id);

type RoomSeed = [name: string, purpose: string, amenities: string[]];
const ROOMS: Record<HomeKind, RoomSeed[]> = {
  house: [['Bedroom', 'sleep', ['bed']], ['Kitchen', 'cooking', ['kitchen']], ['Living room', 'living', ['fireplace']], ['Bathroom', 'bath', ['bath']]],
  apartment: [['Bedroom', 'sleep', ['bed']], ['Kitchenette', 'cooking', ['kitchen']], ['Bathroom', 'bath', ['bath']]],
  room: [['Room', 'sleep', ['bed']]],
  guild: [['Quarters', 'sleep', ['bed']], ['Common hall', 'living', ['hearth']], ['Workshop', 'crafting', ['workbench']]],
  castle: [['Chamber', 'sleep', ['bed', 'fireplace']], ['Great kitchen', 'cooking', ['kitchen']], ['Smithy', 'crafting', ['forge']], ['Library', 'study', ['study']], ['Baths', 'bath', ['bath']]],
  cabin: [['Bunk', 'sleep', ['bed']], ['Galley', 'cooking', ['hearth']]],
  campsite: [['Tent', 'sleep', ['bedroll']], ['Campfire', 'cooking', ['hearth']]],
  cave: [['Nook', 'sleep', ['bedroll']], ['Fire pit', 'cooking', ['hearth']]],
  vehicle: [['Sleeping area', 'sleep', ['bedroll']]],
  other: [['Room', 'sleep', ['bed']]],
};
const STORAGE: Record<HomeKind, [string, number]> = {
  house: ['Storage chest', 20],
  apartment: ['Closet', 12],
  room: ['Trunk', 8],
  guild: ['Locker', 10],
  castle: ['Vault', 40],
  cabin: ['Footlocker', 8],
  campsite: ['Pack', 4],
  cave: ['Hidden cache', 6],
  vehicle: ['Trunk', 6],
  other: ['Chest', 10],
};

export function defaultRooms(kind: HomeKind, idFor: (name: string) => string): Room[] {
  return (ROOMS[kind] ?? ROOMS.other).map(([name, purpose, amenities]) => ({ id: idFor(name), name, purpose, amenities: [...amenities], level: 1 }));
}
export function defaultStorage(kind: HomeKind, id: string): Storage[] {
  const [name, capacity] = STORAGE[kind] ?? STORAGE.other;
  return [{ id, name, capacity }];
}

/** Is `locationId` the home's place or somewhere inside it (a room under the home on the map)? */
export function withinPlace(s: Pick<CampaignState, 'locations'>, locationId: string | null, placeId: string | null): boolean {
  if (!locationId || !placeId) return false;
  const seen = new Set<string>();
  let cur: string | null = locationId;
  while (cur && !seen.has(cur)) {
    if (cur === placeId) return true;
    seen.add(cur);
    cur = s.locations[cur]?.parentId ?? null;
  }
  return false;
}

export function isAtHome(s: CampaignState, home: Home): boolean {
  return home.ownership !== 'lost' && withinPlace(s, s.currentLocationId, home.locationId);
}

/** The home the player is at right now (primary first). */
export function currentHome(s: CampaignState): Home | null {
  const homes = Object.values(s.homes).filter((h) => isAtHome(s, h));
  return homes.find((h) => h.primary) ?? homes[0] ?? null;
}

export function primaryHome(s: CampaignState): Home | null {
  return Object.values(s.homes).find((h) => h.primary && h.ownership !== 'lost') ?? null;
}

function weekdayAt(s: Pick<CampaignState, 'meta'>, minute: number): number {
  const cal = s.meta.calendar;
  const n = cal.weekdays.length || 7;
  return (((Math.floor(minute / 1440) + cal.epochWeekday) % n) + n) % n;
}

function activeSlot(slots: ScheduleSlot[], minute: number, weekday: number): ScheduleSlot | null {
  return slots.find((sl) => slotActive(sl, minute, weekday)) ?? null;
}

/**
 * Where a household member is at `minute`: an active slot of their own schedule (or their NPC's)
 * decides; otherwise residents, heads, dependents and guardians are at home and guests aren't.
 * Returns a location id, or null for "away, somewhere not on the map".
 */
export function memberWhere(s: CampaignState, m: HouseholdMember, minute = s.time.minutes): { locationId: string | null; activity: string } {
  const home = s.homes[m.homeId];
  const weekday = weekdayAt(s, minute);
  const own = activeSlot(m.schedule, minute, weekday);
  if (own) return { locationId: own.locationId, activity: own.activity };
  const npc = m.npcId ? s.npcs[m.npcId] : null;
  if (npc && npc.status !== 'alive') return { locationId: null, activity: npc.status };
  const npcSlot = npc ? activeSlot(npc.schedule, minute, weekday) : null;
  if (npcSlot) return { locationId: npcSlot.locationId, activity: npcSlot.activity };
  if (m.role === 'guest') return { locationId: null, activity: 'at their own place' };
  return { locationId: home?.locationId ?? null, activity: 'at home' };
}

export interface Presence {
  member: HouseholdMember;
  activity: string;
  /** Lives here (vs. visiting from another home). */
  resident: boolean;
}

/** Who is at this home right now: its own household, plus anyone whose schedule brings them here. */
export function presentAt(s: CampaignState, home: Home, minute = s.time.minutes): Presence[] {
  if (!home.locationId) return [];
  const out: Presence[] = [];
  for (const m of Object.values(s.household)) {
    const w = memberWhere(s, m, minute);
    if (withinPlace(s, w.locationId, home.locationId)) out.push({ member: m, activity: w.activity, resident: m.homeId === home.id && m.role !== 'guest' });
  }
  return out;
}

/** Best level of amenities of this kind in a home (0 = none). */
function best(home: Home, pick: (a: Amenity) => number | undefined): number {
  let v = 0;
  for (const r of home.rooms) for (const id of r.amenities) v = Math.max(v, (pick(amenity(id)!) ?? 0) * r.level);
  return v;
}

/** Bonus multipliers for activities done at home (1 = none). */
export function homeBonus(s: CampaignState, kind: 'sleep' | 'bath' | 'study'): number {
  const home = currentHome(s);
  if (!home) return 1;
  return 1 + best(home, (a) => a[kind]);
}

/** A crafting station for this discipline: an amenity at the home you're in, or a public place tagged with it. */
export function stationHere(s: CampaignState, discipline: Discipline, station: string | null): string | null {
  const wanted = station ? [station] : AMENITIES.filter((a) => a.station === discipline).map((a) => a.id);
  const home = currentHome(s);
  if (home) for (const r of home.rooms) for (const id of r.amenities) if (wanted.includes(id)) return `${r.name} (${home.name})`;
  const here = s.currentLocationId ? s.locations[s.currentLocationId] : null;
  if (here) {
    const tags = here.tags.map((t) => t.toLowerCase());
    for (const w of wanted) {
      const label = amenity(w)?.label.toLowerCase() ?? w;
      if (tags.includes(w) || tags.includes(label) || here.name.toLowerCase().includes(label)) return here.name;
    }
  }
  return null;
}

/** Items stored in a home's storage, by storage id. */
export function storedIn(s: CampaignState, storageId: string) {
  return Object.values(s.inventory).filter((i) => i.holder === `store:${storageId}`);
}

export function findStorage(s: CampaignState, idOrName: string): { home: Home; storage: Storage } | null {
  const want = idOrName.toLowerCase();
  for (const home of Object.values(s.homes))
    for (const st of home.storage) if (st.id === idOrName || st.name.toLowerCase() === want || `${home.name} ${st.name}`.toLowerCase() === want) return { home, storage: st };
  return null;
}
