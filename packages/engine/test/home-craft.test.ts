import { describe, expect, it } from 'vitest';
import {
  applyOp,
  applyOps,
  craftCheck,
  craftOutcome,
  createInitialState,
  findRecipe,
  homeBonus,
  invertOps,
  OpSchemas,
  presentAt,
  validateOps,
  type CampaignState,
  type Op,
  type OpType,
} from '../src/index.js';

const ALL = Object.keys(OpSchemas) as OpType[];
const v = (op: unknown): Op => {
  const r = validateOps([op], ALL);
  if (!r.ok.length) throw new Error(`invalid op: ${r.rejected[0]?.error}`);
  return r.ok[0]!;
};
const ok = (s: CampaignState, op: unknown) => {
  const r = applyOp(s, v(op), { source: 'user' });
  if (r.error) throw new Error(r.error);
  return r.state;
};
const err = (s: CampaignState, op: unknown) => applyOp(s, v(op), { source: 'user' }).error;
const many = (s: CampaignState, ops: unknown[]) => ops.reduce<CampaignState>((acc, op) => ok(acc, op), s);
const at = (s: CampaignState, hour: number) => ok(s, { type: 'time.until', hour });
const names = (s: CampaignState, homeName: string) =>
  presentAt(s, Object.values(s.homes).find((h) => h.name === homeName)!)
    .map((p) => p.member.name)
    .sort();

function town(): CampaignState {
  return many(createInitialState({ style: 'fantasy', seed: 7 }), [
    { type: 'location.upsert', name: 'Millbrook', level: 'local', kind: 'town' },
    { type: 'location.upsert', name: 'Rose Cottage', level: 'local', kind: 'building', parent: 'Millbrook' },
    { type: 'location.upsert', name: 'Old Farm', level: 'local', kind: 'building', parent: 'Millbrook' },
    { type: 'location.upsert', name: 'Schoolhouse', level: 'local', kind: 'building', parent: 'Millbrook' },
    { type: 'location.upsert', name: 'Watermill', level: 'local', kind: 'building', parent: 'Millbrook' },
    { type: 'location.move', to: 'Rose Cottage' },
    { type: 'home.add', name: 'Rose Cottage', kind: 'house', location: 'Rose Cottage' },
    { type: 'home.add', name: 'Grandparents’ farm', kind: 'house', location: 'Old Farm', ownership: 'borrowed', primary: false },
  ]);
}

describe('household', () => {
  it('a child living with their grandparents goes to school on weekdays and is home otherwise', () => {
    let s = many(town(), [
      { type: 'household.add', name: 'Grandma Ilse', home: 'Grandparents’ farm', role: 'head', relation: 'grandparent' },
      { type: 'household.add', name: 'Pip', home: 'Grandparents’ farm', role: 'dependent', relation: 'child', schedule: [{ days: [0, 1, 2, 3, 4], from: 540, to: 900, activity: 'school', location: 'Schoolhouse' }] },
    ]);
    // Day 0 in this calendar is a Thursday (epochWeekday 3), so weekday indices 0–4 are Mon–Fri.
    s = at(s, 10);
    const wd = (Math.floor(s.time.minutes / 1440) + s.meta.calendar.epochWeekday) % 7;
    expect(names(s, 'Grandparents’ farm')).toEqual(wd <= 4 ? ['Grandma Ilse'] : ['Grandma Ilse', 'Pip']);
    s = at(s, 18);
    expect(names(s, 'Grandparents’ farm')).toEqual(['Grandma Ilse', 'Pip']);
    expect(names(s, 'Rose Cottage')).toEqual([]);
  });

  it('siblings live in different homes; a partner who lives elsewhere visits on a schedule', () => {
    let s = many(town(), [
      { type: 'household.add', name: 'Anna', home: 'Rose Cottage', role: 'resident', relation: 'sibling' },
      { type: 'household.add', name: 'Tomas', home: 'Grandparents’ farm', role: 'resident', relation: 'sibling' },
      { type: 'household.add', name: 'Lior', home: 'Rose Cottage', role: 'guest', relation: 'partner', schedule: [{ days: [], from: 19 * 60, to: 23 * 60, activity: 'visiting', location: 'Rose Cottage' }] },
    ]);
    s = at(s, 12);
    expect(names(s, 'Rose Cottage')).toEqual(['Anna']);
    expect(names(s, 'Grandparents’ farm')).toEqual(['Tomas']);
    s = at(s, 20);
    expect(names(s, 'Rose Cottage')).toEqual(['Anna', 'Lior']);
    const lior = presentAt(s, Object.values(s.homes).find((h) => h.name === 'Rose Cottage')!).find((p) => p.member.name === 'Lior')!;
    expect(lior.resident).toBe(false);
  });

  it('a resident who works on a schedule is away then, but still belongs to the household', () => {
    let s = many(town(), [{ type: 'household.add', name: 'Bram', home: 'Rose Cottage', role: 'resident', relation: 'roommate', schedule: [{ days: [], from: 8 * 60, to: 16 * 60, activity: 'work', location: 'Watermill' }] }]);
    s = at(s, 9);
    expect(names(s, 'Rose Cottage')).toEqual([]);
    s = at(s, 17);
    expect(names(s, 'Rose Cottage')).toEqual(['Bram']);
    expect(Object.values(s.household).map((m) => m.name)).toEqual(['Bram']);
  });

  it('inviting someone over brings them for a few hours; linked NPC schedules count too', () => {
    let s = many(town(), [{ type: 'npc.upsert', name: 'Mara Quill', location: 'Watermill' }]);
    s = ok(s, { type: 'home.invite', npc: 'Mara Quill', hours: 2 });
    expect(names(s, 'Rose Cottage')).toEqual(['Mara Quill']);
    s = ok(s, { type: 'time.advance', minutes: 180 });
    expect(names(s, 'Rose Cottage')).toEqual([]);
    s = ok(s, { type: 'location.move', to: 'Watermill' });
    expect(err(s, { type: 'home.invite', npc: 'Mara Quill' })).toMatch(/at one of your homes/);
  });

  it('one primary home at a time; removing a home returns what was stored there', () => {
    let s = town();
    expect(Object.values(s.homes).filter((h) => h.primary).map((h) => h.name)).toEqual(['Rose Cottage']);
    s = ok(s, { type: 'home.update', home: 'Grandparents’ farm', primary: true });
    expect(Object.values(s.homes).filter((h) => h.primary).map((h) => h.name)).toEqual(['Grandparents’ farm']);
    s = ok(s, { type: 'item.add', name: 'Quilt', qty: 1 });
    s = ok(s, { type: 'item.move', name: 'Quilt', to: Object.values(s.homes).find((h) => h.name === 'Rose Cottage')!.storage[0]!.id });
    s = ok(s, { type: 'home.remove', home: 'Rose Cottage' });
    expect(Object.values(s.inventory).find((i) => i.name === 'Quilt')!.holder).toBeNull();
  });
});

describe('home effects', () => {
  it('a bed at home makes sleep restore more, and an upgrade more still', () => {
    let s = town();
    expect(homeBonus(s, 'sleep')).toBe(1.25); // the best amenity counts: bed 0.25 (fireplace 0.1)
    s = ok(s, { type: 'room.update', home: 'Rose Cottage', room: 'Bedroom', upgrade: true });
    expect(s.player.currency).toBe(75);
    expect(homeBonus(s, 'sleep')).toBe(1.5);
    s.trackers.energy!.value = 10;
    const slept = ok(s, { type: 'activity', kind: 'sleep', hours: 2 });
    let away = ok(s, { type: 'location.move', to: 'Watermill' });
    away = ok(away, { type: 'activity', kind: 'sleep', hours: 2 });
    expect(slept.trackers.energy!.value).toBeGreaterThan(away.trackers.energy!.value);
  });
});

describe('crafting', () => {
  const kitchenReady = () =>
    many(town(), [
      { type: 'item.add', name: 'Flour', qty: 2 },
      { type: 'item.add', name: 'Herbs', qty: 2 },
    ]);

  it('checks ingredients, station and level, and names what is missing', () => {
    let s = kitchenReady();
    const bread = findRecipe(s, 'Herb Bread')!;
    expect(craftCheck(s, bread).ok).toBe(true);
    const sword = findRecipe(s, 'Iron Sword')!;
    expect(craftCheck(s, sword).problems).toEqual(['Need 4× Iron Ingot (you have 0)', 'Need 1× Whetstone (you have 0)', 'Needs a forge station (a home room with one, or a public place)', 'Forge level 1 needed (you have 0)']);
    s = ok(s, { type: 'location.move', to: 'Watermill' });
    expect(craftCheck(s, bread).problems).toEqual(['Needs a cooking station (a home room with one, or a public place)']);
  });

  it('crafting uses the ingredients, takes time, gives discipline XP, and replays identically', () => {
    const s = kitchenReady();
    const t0 = s.time.minutes;
    const a = ok(s, { type: 'craft', recipe: 'Herb Bread' });
    const b = ok(s, { type: 'craft', recipe: 'Herb Bread' });
    expect(a).toEqual(b);
    expect(a.time.minutes).toBe(t0 + 45);
    expect(Object.values(a.inventory).find((i) => i.name === 'Flour')?.qty ?? 0).toBe(1);
    expect(a.player.crafting!.cooking!.xp).toBeGreaterThanOrEqual(10);
    const out = craftOutcome(s, findRecipe(s, 'Herb Bread')!, 1);
    const bread = Object.values(a.inventory).find((i) => i.name === 'Herb Bread');
    expect(bread?.qty ?? 0).toBe(out.qty);
  });

  it('forged gear gets a quality tier from the roll that scales its stats and value', () => {
    let s = many(town(), [
      { type: 'room.add', home: 'Rose Cottage', name: 'Smithy', amenities: ['forge'] },
      { type: 'item.add', name: 'Iron Ingot', qty: 40 },
    ]);
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      s = ok(s, { type: 'craft', recipe: 'Iron Dagger' });
    }
    for (const it of Object.values(s.inventory).filter((x) => x.name === 'Iron Dagger')) {
      seen.add(it.quality!);
      const mult = { poor: 0.8, common: 1, fine: 1.15, superior: 1.3, masterwork: 1.5 }[it.quality!];
      expect(it.stats.atk).toBeCloseTo(3 * mult, 1);
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(s.player.crafting!.forge!.level).toBeGreaterThanOrEqual(1);
  });

  it('enchanting uses a slot on success; the target must be gear with a free slot', () => {
    let s = many(town(), [
      { type: 'room.add', home: 'Rose Cottage', name: 'Study', amenities: ['enchanting'] },
      { type: 'item.add', name: 'Arcane Dust', qty: 40 },
      { type: 'item.add', name: 'Old Sword', qty: 1, category: 'weapon' },
      { type: 'item.add', name: 'Bread', qty: 1 },
    ]);
    expect(err(s, { type: 'craft', recipe: 'Rune of Sharpness' })).toMatch(/Choose the item to enchant/);
    expect(err(s, { type: 'craft', recipe: 'Rune of Sharpness', target: 'Bread' })).toMatch(/can't be enchanted/);
    let tries = 0;
    while (!Object.values(s.inventory).find((i) => i.name === 'Old Sword')!.enchantments?.length && tries++ < 10) {
      const e = err(s, { type: 'craft', recipe: 'Rune of Sharpness', target: 'Old Sword' });
      if (e) break;
      s = ok(s, { type: 'craft', recipe: 'Rune of Sharpness', target: 'Old Sword' });
    }
    const sword = Object.values(s.inventory).find((i) => i.name === 'Old Sword')!;
    expect(sword.enchantments).toEqual(['Sharpness']);
    expect(sword.stats.atk).toBe(2);
    expect(err(s, { type: 'craft', recipe: 'Rune of Sharpness', target: 'Old Sword' })).toMatch(/no free enchantment slot/);
  });

  it('home and crafting ops roll back exactly', () => {
    const s0 = kitchenReady();
    const ops = [
      { type: 'room.add', home: 'Rose Cottage', name: 'Workshop', amenities: ['workbench'] },
      { type: 'storage.add', home: 'Rose Cottage', name: 'Cellar', capacity: 30 },
      { type: 'household.add', name: 'Anna', home: 'Rose Cottage', relation: 'sibling' },
      { type: 'craft', recipe: 'Herb Bread' },
      { type: 'recipe.add', name: 'Toast', discipline: 'cooking', ingredients: [{ name: 'Herb Bread', qty: 1 }], result: { name: 'Toast', category: 'food' } },
      { type: 'room.update', home: 'Rose Cottage', room: 'Kitchen', upgrade: true },
      { type: 'item.move', name: 'Herbs', to: 'Cellar' },
    ].map(v);
    const r = applyOps(s0, ops, { source: 'user' });
    expect(r.errors).toEqual([]);
    expect(invertOps(r.state, r.inverses)).toEqual(s0);
  });
});
