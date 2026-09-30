/**
 * The reducer: applies ops to campaign state deterministically and returns the inverse
 * (as immer patches) plus a list of human-readable changes for the toast.
 */
import { applyPatches, enablePatches, produceWithPatches, setAutoFreeze, type Patch } from 'immer';
import { clamp } from '../util/clamp.js';
import { createRng, seedFrom } from '../util/rng.js';
import { nameMatchScore, normalizeName, slugify } from '../util/text.js';
import { battleRewards, playerAction, startBattle } from './battle.js';
import { MIN_PER_DAY, fromDate, nextTimeOfDay, parseClock, toDate } from './calendar.js';
import { defaultEffects, defaultSlot, guessCategory, iconForItem } from './items.js';
import { earnedLabel, relationshipLabel, standingLabel, xpForLevel } from './labels.js';
import type { Op, OpOf } from './ops.js';
import { findExact, findFuzzy, findItem, findNpc, nextCounter, uniqueId } from './resolve.js';
import { logWorld, simulate, type Change } from './simulate.js';
import type { CampaignState, Location, MapLevel, Npc, Org, Relationship } from './state.js';
import { MAP_LEVELS } from './state.js';
import { freeSpot } from './mapgen.js';
import { defaultTravelOption, travelOptions } from './travel.js';
import { accrueInterest, processAssets, processBills, restockShops } from './economy.js';
import { HANDLERS3, type Kit } from './handlers3.js';
import { homeBonus } from './home.js';

enablePatches();
setAutoFreeze(false);

export type OpSource = 'ai' | 'user' | 'sim' | 'helper' | 'system';

export interface ApplyContext {
  source: OpSource;
  /** Character cards available for NPC ↔ card linking by name. */
  characters?: Array<{ id: string; name: string }>;
}

export interface ApplyResult {
  state: CampaignState;
  inverse: Op | null;
  changes: Change[];
  error?: string;
}

export { OpError } from './errors.js';
import { OpError } from './errors.js';

// A model can move a feeling at most this far in one turn.
const AI_RELATIONSHIP_STEP = 8;
const AI_STANDING_STEP = 15;

function childLevel(level: MapLevel): MapLevel {
  const i = MAP_LEVELS.indexOf(level);
  return MAP_LEVELS[Math.min(MAP_LEVELS.length - 1, i + 1)];
}

function placeFor(s: CampaignState, name: string, parentId: string | null = null): { x: number; y: number } {
  return freeSpot(s, parentId, slugify(name));
}

function ensureLocation(s: CampaignState, name: string, ctx: ApplyContext, changes: Change[]): Location {
  const found = findFuzzy(s.locations, name);
  if (found) return found;
  if (ctx.source === 'ai' || ctx.source === 'helper' || ctx.source === 'user' || ctx.source === 'system') {
    const cur = s.currentLocationId ? s.locations[s.currentLocationId] : null;
    const parentId = cur?.parentId ?? null;
    const level: MapLevel = cur?.level ?? 'local';
    const id = uniqueId(s.locations, 'loc', name);
    const pos = placeFor(s, name, parentId);
    s.locations[id] = {
      id,
      name,
      level,
      parentId,
      kind: 'other',
      x: pos.x,
      y: pos.y,
      description: '',
      customs: '',
      discovered: true,
      visited: false,
      locked: false,
      tags: [],
    };
    changes.push({ key: `loc:${id}`, label: name, text: `Discovered ${name}`, kind: 'text' });
    return s.locations[id];
  }
  throw new OpError(`Unknown location "${name}"`);
}

function ensureOrg(s: CampaignState, name: string, changes: Change[]): Org {
  const found = findFuzzy(s.orgs, name);
  if (found) return found;
  const id = uniqueId(s.orgs, 'org', name);
  s.orgs[id] = {
    id,
    name,
    type: 'organization',
    mainLocationId: null,
    standing: 50,
    influenceScale: 'local',
    leaderTitle: '',
    leaderNpcId: null,
    subLeaders: [],
    purpose: '',
    members: [],
    influence: [],
    rules: [],
    runins: [],
    locked: false,
  };
  changes.push({ key: `org:${id}`, label: name, text: `New organization: ${name}`, kind: 'text' });
  return s.orgs[id];
}

function newNpc(s: CampaignState, name: string, ctx: ApplyContext): Npc {
  const id = uniqueId(s.npcs, 'npc', name);
  const card = ctx.characters?.find((c) => nameMatchScore(c.name, name) >= 0.9);
  s.npcs[id] = {
    id,
    name,
    aliases: [],
    role: 'NPC',
    title: '',
    age: null,
    birthday: null,
    locationId: s.currentLocationId,
    appearance: '',
    personality: '',
    orgs: [],
    rumors: [],
    secrets: [],
    knownRumors: [],
    schedule: [],
    notes: '',
    locked: false,
    characterId: card?.id ?? null,
    status: 'alive',
    phone: false,
    firstSeenAt: s.time.minutes,
    lastSeenAt: s.time.minutes,
    portrait: null,
    outfit: null,
    goals: [],
    unconscious: false,
  };
  return s.npcs[id];
}

function relationshipFor(s: CampaignState, name: string, ctx: ApplyContext): Relationship {
  const npc = findNpc(s, name)?.npc;
  const key = npc ? npc.id : `rel_${slugify(name)}`;
  const existing = s.relationships[key] ?? Object.values(s.relationships).find((r) => nameMatchScore(r.name, name) >= 0.9);
  if (existing) return existing;
  const card = ctx.characters?.find((c) => nameMatchScore(c.name, name) >= 0.9);
  s.relationships[key] = {
    id: key,
    name: npc?.name ?? card?.name ?? name,
    npcId: npc?.id ?? null,
    affection: 0,
    trust: 0,
    desire: 0,
    tension: 0,
    label: 'Acquaintance',
    memories: [],
  };
  return s.relationships[key];
}

function assertUnlocked(entity: { locked: boolean; name: string } | undefined, ctx: ApplyContext) {
  if (entity?.locked && (ctx.source === 'ai' || ctx.source === 'helper' || ctx.source === 'sim')) {
    throw new OpError(`${entity.name} is locked`);
  }
}

function carriedPool(s: CampaignState): CampaignState['inventory'] {
  const out: CampaignState['inventory'] = {};
  for (const [id, it] of Object.entries(s.inventory)) if (!it.holder) out[id] = it;
  return out;
}

function advanceTime(s: CampaignState, minutes: number, changes: Change[]) {
  const m = Math.max(0, Math.round(minutes));
  if (!m) return;
  const from = s.time.minutes;
  s.time.minutes = from + m;
  changes.push({ key: 'time', label: 'passed', delta: m, kind: 'time' });
  simulate(s, from, s.time.minutes, changes);
  simulateEconomy(s, from, s.time.minutes, changes);
}

/** Money that moves with time: interest, bills (with consequences), business income, shop restocks. */
function simulateEconomy(s: CampaignState, from: number, to: number, changes: Change[]) {
  if (!s.economy) return;
  accrueInterest(s, to);
  processBills(s, from, to, changes, (t) => notifyPlayer(s, t));
  processAssets(s, from, to, changes);
  restockShops(s, to);
}

/** A notice for the player: in the world log, and (in settings with phones) as a phone digest. */
function notifyPlayer(s: CampaignState, text: string) {
  logWorld(s, s.time.minutes, 'reminder', text);
}

function addXp(s: CampaignState, amount: number, changes: Change[]) {
  const xp = (s.player.bars.xp ??= { id: 'xp', label: 'XP', cur: 0, max: xpForLevel(s.player.level), visible: true });
  xp.cur += Math.round(amount);
  changes.push({ key: 'xp', label: 'XP', delta: Math.round(amount), kind: 'xp' });
  let guard = 0;
  while (xp.cur >= xp.max && guard++ < 100) {
    xp.cur -= xp.max;
    s.player.level += 1;
    xp.max = xpForLevel(s.player.level);
    for (const bar of Object.values(s.player.bars)) {
      if (bar.id === 'xp') continue;
      const inc = bar.id === 'hp' ? 10 : 5;
      bar.max += inc;
      bar.cur = bar.max;
    }
    s.player.stats.atk += 1;
    s.player.stats.def += 1;
    s.player.stats.spd += 1;
    s.player.stats.mag += 1;
    changes.push({ key: 'level', label: 'Level', text: `Level ${s.player.level}`, kind: 'level' });
    logWorld(s, s.time.minutes, 'event', `You reached level ${s.player.level}.`, true);
  }
}

function applyEffects(s: CampaignState, effects: { trackers?: Record<string, number>; bars?: Record<string, number>; status?: string }, changes: Change[]) {
  for (const [id, delta] of Object.entries(effects.trackers ?? {})) {
    const t = s.trackers[id];
    if (!t) continue;
    const before = t.value;
    t.value = clamp(t.value + delta, 0, t.max);
    if (t.value !== before) changes.push({ key: `tracker:${id}`, label: t.label, delta: Math.round((t.value - before) * 10) / 10, kind: 'tracker' });
  }
  for (const [id, delta] of Object.entries(effects.bars ?? {})) {
    const b = s.player.bars[id];
    if (!b) continue;
    const before = b.cur;
    b.cur = clamp(b.cur + delta, 0, b.max);
    if (b.cur !== before) changes.push({ key: `bar:${id}`, label: b.label, delta: Math.round(b.cur - before), kind: 'bar' });
  }
  if (effects.status) {
    const id = `st_${slugify(effects.status)}`;
    s.player.status[id] = { id, name: effects.status, kind: 'buff', desc: '', expiresAt: s.time.minutes + 120, perHour: {} };
    changes.push({ key: `status:${id}`, label: effects.status, text: effects.status, kind: 'text' });
  }
}

function finalizeBattle(s: CampaignState, changes: Change[]) {
  const b = s.battle;
  if (!b || b.status === 'active' || b.rewards) return;
  const me = b.combatants.player;
  if (me) {
    if (s.player.bars.hp) s.player.bars.hp.cur = clamp(b.status === 'lost' ? Math.max(1, me.hp) : me.hp, 0, s.player.bars.hp.max);
    if (s.player.bars.mp) s.player.bars.mp.cur = clamp(me.mp, 0, s.player.bars.mp.max);
    if (s.player.bars.ap) s.player.bars.ap.cur = clamp(me.ap, 0, s.player.bars.ap.max);
  }
  for (const m of Object.values(s.party)) {
    const c = b.combatants[`ally_${m.id}`];
    if (c) {
      m.hp = Math.max(b.status === 'lost' ? 1 : 0, c.hp);
      m.mp = c.mp;
    }
  }
  if (b.status === 'won') {
    const r = battleRewards(b);
    b.rewards = { xp: r.xp, currency: r.currency, items: [] };
    s.player.currency += r.currency;
    changes.push({ key: 'currency', label: s.meta.currency.name, delta: r.currency, kind: 'currency' });
    addXp(s, r.xp, changes);
  } else {
    b.rewards = { xp: 0, currency: 0, items: [] };
    if (b.status === 'lost') {
      s.player.status.st_wounded = { id: 'st_wounded', name: 'Wounded', kind: 'debuff', desc: 'Recovering from defeat.', expiresAt: s.time.minutes + 6 * 60, perHour: { hp: 3 } };
    }
  }
  const foes = Object.values(b.combatants).filter((c) => c.side === 'enemy').map((c) => c.name);
  logWorld(s, s.time.minutes, 'battle', `Battle ${b.status === 'won' ? 'won' : b.status === 'lost' ? 'lost' : 'fled'} against ${foes.join(', ')}.`, true);
  changes.push({ key: 'battle', label: 'Battle', text: b.status === 'won' ? 'Victory' : b.status === 'lost' ? 'Defeat' : 'Escaped', kind: 'text' });
  // A battle round takes time.
  advanceTime(s, Math.min(60, 2 + b.round), changes);
}

function run(s: CampaignState, op: Op, ctx: ApplyContext, changes: Change[]) {
  switch (op.type) {
    case 'time.advance':
      advanceTime(s, op.minutes, changes);
      return;
    case 'time.until': {
      const target = nextTimeOfDay(s.time.minutes, op.hour * 60 + op.minute);
      advanceTime(s, target - s.time.minutes, changes);
      return;
    }
    case 'weather.set':
      s.weather = { kind: op.kind, tempC: op.tempC ?? s.weather.tempC, since: s.time.minutes };
      changes.push({ key: 'weather', label: 'Weather', text: `Weather: ${op.kind}`, kind: 'text' });
      return;
    case 'tracker.delta':
    case 'tracker.set': {
      const t = s.trackers[op.id] ?? Object.values(s.trackers).find((x) => x.label.toLowerCase() === op.id.toLowerCase());
      if (!t) throw new OpError(`Unknown tracker "${op.id}"`);
      const before = t.value;
      let delta = op.type === 'tracker.delta' ? op.delta : op.value - t.value;
      if (ctx.source === 'ai') delta = clamp(delta, -50, 50);
      t.value = clamp(t.value + delta, 0, t.max);
      const d = Math.round((t.value - before) * 10) / 10;
      if (d) changes.push({ key: `tracker:${t.id}`, label: t.label, delta: d, kind: 'tracker' });
      return;
    }
    case 'tracker.define': {
      if (op.remove) {
        delete s.trackers[op.id];
        return;
      }
      const id = slugify(op.id);
      const t = (s.trackers[id] ??= { id, label: op.label ?? op.id, value: 50, max: 100, perHour: 0, direction: 'fill', visible: true });
      if (op.label !== undefined) t.label = op.label;
      if (op.max !== undefined) t.max = clamp(op.max, 1, 100000);
      if (op.value !== undefined) t.value = clamp(op.value, 0, t.max);
      if (op.perHour !== undefined) t.perHour = clamp(op.perHour, -100, 100);
      if (op.direction !== undefined) t.direction = op.direction;
      if (op.visible !== undefined) t.visible = op.visible;
      return;
    }
    case 'bar.delta': {
      if (op.target && s.party) {
        const member = findFuzzy(s.party, op.target);
        if (member && op.id === 'hp') {
          member.hp = clamp(member.hp + op.delta, 0, member.maxHp);
          return;
        }
      }
      const b = s.player.bars[op.id];
      if (!b) throw new OpError(`Unknown bar "${op.id}"`);
      if (b.id === 'xp') {
        if (op.delta > 0) addXp(s, op.delta, changes);
        return;
      }
      const before = b.cur;
      const delta = ctx.source === 'ai' ? clamp(op.delta, -b.max, b.max) : op.delta;
      // A model's report never kills the player: HP from the model floors at 1.
      b.cur = clamp(b.cur + delta, ctx.source === 'ai' && b.id === 'hp' ? Math.min(1, b.cur) : 0, b.max);
      if (b.cur !== before) changes.push({ key: `bar:${b.id}`, label: b.label, delta: Math.round(b.cur - before), kind: 'bar' });
      return;
    }
    case 'bar.set': {
      const b = (s.player.bars[op.id] ??= { id: op.id, label: op.label ?? op.id.toUpperCase(), cur: 0, max: 100, visible: true });
      if (op.label !== undefined) b.label = op.label;
      if (op.max !== undefined) b.max = clamp(op.max, 1, 1_000_000);
      if (op.cur !== undefined) b.cur = clamp(op.cur, 0, b.max);
      b.cur = clamp(b.cur, 0, b.max);
      return;
    }
    case 'currency.delta': {
      const before = s.player.currency;
      s.player.currency = Math.max(0, Math.round((s.player.currency + op.amount) * 100) / 100);
      const d = Math.round((s.player.currency - before) * 100) / 100;
      if (op.amount < 0 && before + op.amount < 0 && ctx.source !== 'ai') throw new OpError('Not enough money');
      if (d) changes.push({ key: 'currency', label: s.meta.currency.name, delta: d, kind: 'currency' });
      return;
    }
    case 'xp.add':
      addXp(s, ctx.source === 'ai' ? Math.min(op.amount, 500) : op.amount, changes);
      return;
    case 'item.add': {
      // New things land with the player; stacks held elsewhere (party bag, home storage) aren't merged into.
      const existing = findItem(carriedPool(s), op.name);
      if (existing) {
        assertUnlocked(existing, ctx);
        existing.qty = clamp(existing.qty + op.qty, 0, 1_000_000);
        if (op.desc && !existing.desc) existing.desc = op.desc;
        changes.push({ key: `item:${existing.id}`, label: existing.name, delta: op.qty, kind: 'item' });
        return;
      }
      const category = op.category ?? guessCategory(op.name);
      const id = uniqueId(s.inventory, 'item', op.name);
      const container = op.container ? findItem(s.inventory, op.container) : undefined;
      s.inventory[id] = {
        id,
        name: op.name,
        category,
        qty: op.qty,
        desc: op.desc ?? '',
        icon: op.icon ?? iconForItem(op.name, category),
        value: op.value ?? 0,
        equipped: false,
        slot: op.slot ?? defaultSlot(op.name, category),
        effects: op.effects ?? {},
        stats: op.stats ?? {},
        containerId: container?.id ?? null,
        locked: false,
        tags: op.tags ?? [],
        addedAt: s.time.minutes,
        holder: null,
        capacity: category === 'container' ? 6 : undefined,
      };
      if (s.inventory[id]!.capacity === undefined) delete s.inventory[id]!.capacity;
      changes.push({ key: `item:${id}`, label: op.name, delta: op.qty, kind: 'item' });
      return;
    }
    case 'item.remove': {
      const it = findItem(carriedPool(s), op.name) ?? findItem(s.inventory, op.name);
      if (!it) throw new OpError(`No item "${op.name}"`);
      assertUnlocked(it, ctx);
      const qty = Math.min(it.qty, op.qty);
      it.qty -= qty;
      changes.push({ key: `item:${it.id}`, label: it.name, delta: -qty, kind: 'item' });
      if (it.qty <= 0) {
        delete s.inventory[it.id];
        for (const other of Object.values(s.inventory)) if (other.containerId === it.id) other.containerId = null;
      }
      return;
    }
    case 'item.use': {
      // Only what you carry can be used (not what's stored at home or in someone else's pack).
      const it = findItem(carriedPool(s), op.name);
      if (!it) throw new OpError(`No item "${op.name}"`);
      assertUnlocked(it, ctx);
      const hasEffects = Object.keys(it.effects?.trackers ?? {}).length || Object.keys(it.effects?.bars ?? {}).length || it.effects?.status;
      const effects = hasEffects ? it.effects : defaultEffects(it.name, it.category);
      if (!Object.keys(effects.trackers ?? {}).length && !Object.keys(effects.bars ?? {}).length && !effects.status) {
        throw new OpError(`${it.name} can't be used`);
      }
      it.qty -= 1;
      changes.push({ key: `item:${it.id}`, label: it.name, delta: -1, kind: 'item' });
      if (it.qty <= 0) delete s.inventory[it.id];
      applyEffects(s, effects, changes);
      return;
    }
    case 'item.equip': {
      const it = findItem(s.inventory, op.name);
      if (!it) throw new OpError(`No item "${op.name}"`);
      assertUnlocked(it, ctx);
      if (op.equipped) {
        const slot = it.slot ?? defaultSlot(it.name, it.category);
        if (!slot) throw new OpError(`${it.name} can't be equipped`);
        it.slot = slot;
        for (const other of Object.values(s.inventory)) if (other.equipped && other.slot === slot && other.id !== it.id) other.equipped = false;
      }
      it.equipped = op.equipped;
      changes.push({ key: `equip:${it.id}`, label: it.name, text: `${op.equipped ? 'Equipped' : 'Unequipped'} ${it.name}`, kind: 'text' });
      return;
    }
    case 'item.update': {
      const it = findItem(s.inventory, op.name);
      if (!it) throw new OpError(`No item "${op.name}"`);
      if (op.locked === undefined) assertUnlocked(it, ctx);
      if (op.rename) it.name = op.rename;
      if (op.category) it.category = op.category;
      if (op.desc !== undefined) it.desc = op.desc;
      if (op.icon) it.icon = op.icon;
      if (op.value !== undefined) it.value = op.value;
      if (op.slot !== undefined) it.slot = op.slot;
      if (op.locked !== undefined) it.locked = op.locked;
      if (op.effects) it.effects = op.effects;
      if (op.container !== undefined) {
        const c = op.container ? findItem(s.inventory, op.container) : undefined;
        if (c && c.id === it.id) throw new OpError('An item cannot contain itself');
        if (c) {
          // One level of nesting, same holder, and within the container's capacity.
          if (c.containerId) throw new OpError(`${c.name} is itself inside a container`);
          if (it.category === 'container' && Object.values(s.inventory).some((x) => x.containerId === it.id)) throw new OpError(`Empty ${it.name} before putting it in another container`);
          if ((c.holder ?? null) !== (it.holder ?? null)) throw new OpError(`${c.name} is somewhere else`);
          const used = Object.values(s.inventory).filter((x) => x.containerId === c.id && x.id !== it.id).length;
          if (c.capacity !== undefined && used >= c.capacity) throw new OpError(`${c.name} is full (${c.capacity})`);
        }
        it.containerId = c?.id ?? null;
      }
      return;
    }
    case 'status.add': {
      const id = `st_${slugify(op.name)}`;
      s.player.status[id] = {
        id,
        name: op.name,
        kind: op.kind,
        desc: op.desc ?? s.player.status[id]?.desc ?? '',
        expiresAt: op.minutes ? s.time.minutes + op.minutes : null,
        perHour: op.perHour ?? {},
      };
      changes.push({ key: `status:${id}`, label: op.name, text: op.name, kind: 'text' });
      return;
    }
    case 'status.remove': {
      const st = findFuzzy(s.player.status, op.name);
      if (!st) throw new OpError(`No status "${op.name}"`);
      delete s.player.status[st.id];
      changes.push({ key: `status:${st.id}`, label: st.name, text: `${st.name} ended`, kind: 'text' });
      return;
    }
    case 'skill.add': {
      const id = `sk_${slugify(op.name)}`;
      s.player.skills[id] = { id, name: op.name, desc: op.desc ?? '', kind: op.kind, cost: op.cost, costType: op.costType, power: op.power };
      changes.push({ key: `skill:${id}`, label: op.name, text: `Learned ${op.name}`, kind: 'text' });
      return;
    }
    case 'skill.remove': {
      const sk = findFuzzy(s.player.skills, op.name);
      if (!sk) throw new OpError(`No skill "${op.name}"`);
      delete s.player.skills[sk.id];
      return;
    }
    case 'player.update': {
      if (op.name) s.player.name = op.name;
      if (op.className !== undefined) s.player.className = op.className;
      if (op.age !== undefined) s.player.age = op.age;
      if (op.ageStage !== undefined) s.player.ageStage = op.ageStage;
      if (op.appearance !== undefined) s.player.appearance = op.appearance;
      if (op.level !== undefined) s.player.level = op.level;
      if (op.stats) Object.assign(s.player.stats, Object.fromEntries(Object.entries(op.stats).filter(([, v]) => v !== undefined)));
      return;
    }
    case 'location.upsert': {
      let loc = findFuzzy(s.locations, op.name);
      if (!loc) assertNotForgotten(s, op.name, ctx);
      if (ctx.source === 'user') unforget(s, op.name);
      const parent = op.parent ? findFuzzy(s.locations, op.parent) ?? ensureLocation(s, op.parent, ctx, changes) : undefined;
      if (!loc) {
        const id = uniqueId(s.locations, 'loc', op.name);
        const pos = placeFor(s, op.name, op.parent === null ? null : parent?.id ?? null);
        const level = op.level ?? (parent ? childLevel(parent.level) : 'local');
        loc = s.locations[id] = {
          id,
          name: op.name,
          level,
          parentId: op.parent === null ? null : parent?.id ?? null,
          kind: op.kind ?? 'other',
          x: op.x ?? pos.x,
          y: op.y ?? pos.y,
          description: op.description ?? '',
          customs: op.customs ?? '',
          discovered: op.discovered ?? true,
          visited: false,
          locked: false,
          tags: op.tags ?? [],
        };
        changes.push({ key: `loc:${id}`, label: op.name, text: `Discovered ${op.name}`, kind: 'text' });
        return;
      }
      assertUnlocked(loc, ctx);
      if (op.level) loc.level = op.level;
      if (op.parent !== undefined) {
        if (parent?.id === loc.id) throw new OpError('A location cannot be its own parent');
        loc.parentId = parent?.id ?? null;
      }
      if (op.kind) loc.kind = op.kind;
      if (op.description) loc.description = op.description;
      if (op.customs) loc.customs = op.customs;
      if (op.x !== undefined) loc.x = op.x;
      if (op.y !== undefined) loc.y = op.y;
      if (op.discovered !== undefined) loc.discovered = op.discovered;
      if (op.tags) loc.tags = op.tags;
      return;
    }
    case 'location.move': {
      const loc = ensureLocation(s, op.to, ctx, changes);
      if (s.currentLocationId === loc.id) return;
      s.currentLocationId = loc.id;
      loc.discovered = true;
      loc.visited = true;
      changes.push({ key: 'location', label: 'Location', text: `Now at ${loc.name}`, kind: 'text' });
      for (const npc of Object.values(s.npcs)) if (npc.locationId === loc.id) npc.lastSeenAt = s.time.minutes;
      return;
    }
    case 'location.remove': {
      const loc = findExact(s.locations, op.name);
      if (!loc) throw new OpError(`No location "${op.name}"`);
      delete s.locations[loc.id];
      if (ctx.source === 'user') forget(s, loc.name);
      for (const l of Object.values(s.locations)) if (l.parentId === loc.id) l.parentId = loc.parentId;
      for (const r of Object.values(s.routes)) if (r.from === loc.id || r.to === loc.id) delete s.routes[r.id];
      for (const n of Object.values(s.npcs)) if (n.locationId === loc.id) n.locationId = null;
      if (s.currentLocationId === loc.id) s.currentLocationId = loc.parentId;
      return;
    }
    case 'travel': {
      const dest = findFuzzy(s.locations, op.to);
      if (!dest) throw new OpError(`Unknown destination "${op.to}"`);
      if (dest.id === s.currentLocationId) throw new OpError('Already there');
      const opts = travelOptions(s, s.currentLocationId, dest.id);
      const chosen = op.mode ? opts.find((o) => o.mode === op.mode) : defaultTravelOption(opts);
      if (!chosen) throw new OpError('No way to get there');
      if (!chosen.available) throw new OpError(chosen.reason ?? 'Not available');
      if (chosen.fare > 0) {
        s.player.currency = Math.max(0, Math.round((s.player.currency - chosen.fare) * 100) / 100);
        changes.push({ key: 'currency', label: s.meta.currency.name, delta: -chosen.fare, kind: 'currency' });
      }
      if (chosen.energy > 0 && s.trackers.energy) {
        const t = s.trackers.energy;
        const before = t.value;
        t.value = clamp(t.value - chosen.energy, 0, t.max);
        changes.push({ key: 'tracker:energy', label: t.label, delta: Math.round((t.value - before) * 10) / 10, kind: 'tracker' });
      }
      const fromName = s.currentLocationId ? s.locations[s.currentLocationId]?.name : null;
      s.currentLocationId = dest.id;
      dest.discovered = true;
      dest.visited = true;
      changes.push({ key: 'location', label: 'Location', text: `Travelled to ${dest.name} by ${chosen.label.toLowerCase()}`, kind: 'text' });
      logWorld(s, s.time.minutes, 'travel', `Travelled${fromName ? ` from ${fromName}` : ''} to ${dest.name} (${chosen.label}, ${chosen.minutes} min).`, true);
      advanceTime(s, chosen.minutes, changes);
      for (const npc of Object.values(s.npcs)) if (npc.locationId === dest.id) npc.lastSeenAt = s.time.minutes;
      return;
    }
    case 'route.add': {
      const a = ensureLocation(s, op.from, ctx, changes);
      const b = ensureLocation(s, op.to, ctx, changes);
      const id = `route_${[a.id, b.id].sort().join('__')}_${op.mode}`;
      s.routes[id] = { id, from: a.id, to: b.id, mode: op.mode, minutes: op.minutes ?? null };
      return;
    }
    case 'npc.upsert': {
      const match = findNpc(s, op.name);
      let npc = match?.npc;
      if (!npc) assertNotForgotten(s, op.name, ctx);
      if (ctx.source === 'user') unforget(s, op.name);
      if (npc) {
        assertUnlocked(npc, ctx);
        // Upgrade "Tobias" to "Tobias Moreno" and keep the short form as an alias.
        if (op.name.length > npc.name.length && nameMatchScore(npc.name, op.name) >= 0.85 && op.name.toLowerCase().startsWith(npc.name.toLowerCase().split(' ')[0])) {
          if (!npc.aliases.includes(npc.name)) npc.aliases.push(npc.name);
          npc.name = op.name;
        } else if (op.name !== npc.name && !npc.aliases.includes(op.name) && op.name.length < npc.name.length) {
          npc.aliases.push(op.name);
        }
      } else {
        npc = newNpc(s, op.name, ctx);
        changes.push({ key: `npc:${npc.id}`, label: npc.name, text: `Met ${npc.name}`, kind: 'text' });
      }
      if (op.aliases) for (const a of op.aliases) if (!npc.aliases.includes(a) && a !== npc.name) npc.aliases.push(a);
      if (op.role) npc.role = op.role;
      if (op.title) npc.title = op.title;
      if (op.age !== undefined) npc.age = op.age;
      if (op.appearance) npc.appearance = op.appearance;
      if (op.personality) npc.personality = op.personality;
      if (op.notes) npc.notes = npc.notes ? `${npc.notes}\n${op.notes}` : op.notes;
      if (op.status) npc.status = op.status;
      if (op.phone !== undefined) npc.phone = op.phone;
      if (op.rumor && !npc.rumors.includes(op.rumor)) npc.rumors.push(op.rumor);
      if (op.secret && !npc.secrets.includes(op.secret)) npc.secrets.push(op.secret);
      if (op.location !== undefined) npc.locationId = op.location ? ensureLocation(s, op.location, ctx, changes).id : null;
      if (op.org) {
        const org = ensureOrg(s, op.org, changes);
        const m = npc.orgs.find((o) => o.orgId === org.id);
        if (m) m.rank = op.rank ?? m.rank;
        else npc.orgs.push({ orgId: org.id, rank: op.rank ?? 'Member' });
        const om = org.members.find((x) => x.npcId === npc!.id);
        if (om) om.rank = op.rank ?? om.rank;
        else org.members.push({ npcId: npc.id, name: npc.name, rank: op.rank ?? 'Member' });
      }
      if (!npc.characterId && ctx.characters) {
        const card = ctx.characters.find((c) => nameMatchScore(c.name, npc!.name) >= 0.9);
        if (card) npc.characterId = card.id;
      }
      npc.lastSeenAt = s.time.minutes;
      return;
    }
    case 'npc.set': {
      const npc = s.npcs[op.id];
      if (!npc) throw new OpError('Unknown NPC');
      const { schedule, ...rest } = op.patch;
      Object.assign(npc, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)));
      if (schedule) npc.schedule = schedule.map((sl, i) => ({ id: sl.id ?? `slot_${i + 1}`, days: sl.days, from: sl.from, to: sl.to, activity: sl.activity, locationId: sl.locationId }));
      if (op.patch.orgs) {
        for (const org of Object.values(s.orgs)) {
          const want = op.patch.orgs.find((o) => o.orgId === org.id);
          const has = org.members.find((m) => m.npcId === npc.id);
          if (want && !has) org.members.push({ npcId: npc.id, name: npc.name, rank: want.rank });
          else if (want && has) has.rank = want.rank;
          else if (!want && has) org.members = org.members.filter((m) => m.npcId !== npc.id);
        }
      }
      return;
    }
    case 'npc.merge': {
      const into = s.npcs[op.into];
      const from = s.npcs[op.from];
      if (!into || !from || into.id === from.id) throw new OpError('Pick two different NPCs');
      const longer = from.name.length > into.name.length ? from.name : into.name;
      const aliases = new Set([...into.aliases, ...from.aliases, into.name, from.name]);
      aliases.delete(longer);
      into.name = longer;
      into.aliases = [...aliases];
      for (const k of ['role', 'title', 'appearance', 'personality'] as const) if (!into[k] || into[k] === 'NPC') into[k] = from[k];
      if (from.notes) into.notes = into.notes ? `${into.notes}\n${from.notes}` : from.notes;
      into.age ??= from.age;
      into.locationId ??= from.locationId;
      into.characterId ??= from.characterId;
      into.portrait ??= from.portrait;
      into.rumors = [...new Set([...into.rumors, ...from.rumors])];
      into.secrets = [...new Set([...into.secrets, ...from.secrets])];
      into.knownRumors = [...new Set([...into.knownRumors, ...from.knownRumors])];
      for (const o of from.orgs) if (!into.orgs.some((x) => x.orgId === o.orgId)) into.orgs.push(o);
      if (!into.schedule.length) into.schedule = from.schedule;
      into.phone = into.phone || from.phone;
      for (const org of Object.values(s.orgs)) {
        for (const m of org.members) if (m.npcId === from.id) m.npcId = into.id;
        const seen = new Set<string>();
        org.members = org.members.filter((m) => (m.npcId ? (seen.has(m.npcId) ? false : (seen.add(m.npcId), true)) : true));
        if (org.leaderNpcId === from.id) org.leaderNpcId = into.id;
      }
      for (const r of Object.values(s.relationships)) if (r.npcId === from.id) r.npcId = into.id;
      for (const m of Object.values(s.party)) if (m.npcId === from.id) m.npcId = into.id;
      for (const e of Object.values(s.events)) if (e.npcId === from.id) e.npcId = into.id;
      if (s.phone.unread[from.id]) {
        s.phone.unread[into.id] = (s.phone.unread[into.id] ?? 0) + s.phone.unread[from.id];
        delete s.phone.unread[from.id];
      }
      delete s.npcs[from.id];
      changes.push({ key: `npc:${into.id}`, label: into.name, text: `Merged into ${into.name}`, kind: 'text' });
      return;
    }
    case 'npc.move': {
      const npc = findNpc(s, op.name)?.npc;
      if (!npc) throw new OpError(`Unknown NPC "${op.name}"`);
      assertUnlocked(npc, ctx);
      npc.locationId = op.location ? ensureLocation(s, op.location, ctx, changes).id : null;
      return;
    }
    case 'npc.remove': {
      const npc = findNpc(s, op.name, 0.95)?.npc;
      if (!npc) throw new OpError(`Unknown NPC "${op.name}"`);
      assertUnlocked(npc, ctx);
      delete s.npcs[npc.id];
      if (ctx.source === 'user') forget(s, npc.name);
      for (const org of Object.values(s.orgs)) {
        org.members = org.members.filter((m) => m.npcId !== npc.id);
        if (org.leaderNpcId === npc.id) org.leaderNpcId = null;
      }
      for (const m of Object.values(s.party)) if (m.npcId === npc.id) delete s.party[m.id];
      return;
    }
    case 'npc.schedule': {
      const npc = findNpc(s, op.name)?.npc;
      if (!npc) throw new OpError(`Unknown NPC "${op.name}"`);
      assertUnlocked(npc, ctx);
      const toMin = (v: number | string) => (typeof v === 'number' ? v : parseClock(v) ?? 0);
      npc.schedule = op.slots.map((slot, i) => ({
        id: `slot_${i + 1}`,
        days: slot.days,
        from: toMin(slot.from),
        to: toMin(slot.to),
        activity: slot.activity,
        locationId: slot.location ? ensureLocation(s, slot.location, ctx, changes).id : null,
      }));
      return;
    }
    case 'org.upsert': {
      const existing = findFuzzy(s.orgs, op.name);
      if (existing) assertUnlocked(existing, ctx);
      const org = existing ?? ensureOrg(s, op.name, changes);
      if (op.orgType) org.type = op.orgType;
      if (op.purpose) org.purpose = op.purpose;
      if (op.location !== undefined) org.mainLocationId = op.location ? ensureLocation(s, op.location, ctx, changes).id : null;
      if (op.leaderTitle) org.leaderTitle = op.leaderTitle;
      if (op.leader !== undefined) {
        if (op.leader === null) org.leaderNpcId = null;
        else {
          const npc = findNpc(s, op.leader)?.npc ?? newNpc(s, op.leader, ctx);
          org.leaderNpcId = npc.id;
          if (!org.members.some((m) => m.npcId === npc.id)) org.members.push({ npcId: npc.id, name: npc.name, rank: org.leaderTitle || 'Leader' });
          if (!npc.orgs.some((o) => o.orgId === org.id)) npc.orgs.push({ orgId: org.id, rank: org.leaderTitle || 'Leader' });
        }
      }
      if (op.influenceScale) org.influenceScale = op.influenceScale;
      if (op.standing !== undefined && ctx.source !== 'ai') org.standing = clamp(op.standing, 0, 100);
      return;
    }
    case 'org.set': {
      const org = s.orgs[op.id];
      if (!org) throw new OpError('Unknown organization');
      const { members, ...rest } = op.patch;
      Object.assign(org, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)));
      if (op.patch.standing !== undefined) org.standing = clamp(Math.round(op.patch.standing), 0, 100);
      if (members) {
        org.members = members;
        for (const npc of Object.values(s.npcs)) {
          const m = members.find((x) => x.npcId === npc.id);
          const has = npc.orgs.find((o) => o.orgId === org.id);
          if (m && !has) npc.orgs.push({ orgId: org.id, rank: m.rank });
          else if (m && has) has.rank = m.rank;
          else if (!m && has) npc.orgs = npc.orgs.filter((o) => o.orgId !== org.id);
        }
      }
      return;
    }
    case 'org.remove': {
      if (!s.orgs[op.id]) throw new OpError('Unknown organization');
      delete s.orgs[op.id];
      for (const npc of Object.values(s.npcs)) npc.orgs = npc.orgs.filter((o) => o.orgId !== op.id);
      return;
    }
    case 'location.set': {
      const loc = s.locations[op.id];
      if (!loc) throw new OpError('Unknown location');
      if (op.patch.parentId !== undefined && op.patch.parentId !== null) {
        // Refuse cycles.
        let cur: string | null = op.patch.parentId;
        const seen = new Set<string>();
        while (cur && !seen.has(cur)) {
          if (cur === loc.id) throw new OpError('A place cannot be inside itself');
          seen.add(cur);
          cur = s.locations[cur]?.parentId ?? null;
        }
      }
      Object.assign(loc, Object.fromEntries(Object.entries(op.patch).filter(([, v]) => v !== undefined)));
      return;
    }
    case 'org.standing': {
      const org = findFuzzy(s.orgs, op.name);
      if (!org) throw new OpError(`Unknown organization "${op.name}"`);
      assertUnlocked(org, ctx);
      const before = org.standing;
      let next = op.set !== undefined ? op.set : org.standing + (op.delta ?? 0);
      if (ctx.source === 'ai') next = clamp(next, before - AI_STANDING_STEP, before + AI_STANDING_STEP);
      org.standing = clamp(Math.round(next), 0, 100);
      const d = org.standing - before;
      if (d) {
        const la = standingLabel(before);
        const lb = standingLabel(org.standing);
        changes.push({ key: `org:${org.id}`, label: org.name, delta: d, text: la !== lb ? `${org.name}: ${la} → ${lb}` : undefined, kind: la !== lb ? 'text' : 'tracker' });
      }
      return;
    }
    case 'org.member': {
      const org = findFuzzy(s.orgs, op.org);
      if (!org) throw new OpError(`Unknown organization "${op.org}"`);
      assertUnlocked(org, ctx);
      const npc = findNpc(s, op.npc)?.npc ?? (op.remove ? undefined : newNpc(s, op.npc, ctx));
      if (op.remove) {
        org.members = org.members.filter((m) => (npc ? m.npcId !== npc.id : nameMatchScore(m.name, op.npc) < 0.9));
        if (npc) npc.orgs = npc.orgs.filter((o) => o.orgId !== org.id);
        return;
      }
      if (!npc) return;
      const m = org.members.find((x) => x.npcId === npc.id);
      if (m) m.rank = op.rank ?? m.rank;
      else org.members.push({ npcId: npc.id, name: npc.name, rank: op.rank ?? 'Member' });
      const nm = npc.orgs.find((o) => o.orgId === org.id);
      if (nm) nm.rank = op.rank ?? nm.rank;
      else npc.orgs.push({ orgId: org.id, rank: op.rank ?? 'Member' });
      return;
    }
    case 'org.runin': {
      const org = findFuzzy(s.orgs, op.org) ?? ensureOrg(s, op.org, changes);
      assertUnlocked(org, ctx);
      org.runins.push({ id: `runin_${nextCounter(s.counters, 'runin')}`, at: s.time.minutes, text: op.text });
      return;
    }
    case 'org.rule': {
      const org = findFuzzy(s.orgs, op.org);
      if (!org) throw new OpError(`Unknown organization "${op.org}"`);
      assertUnlocked(org, ctx);
      if (op.remove) org.rules = org.rules.filter((r) => r !== op.text);
      else if (!org.rules.includes(op.text)) org.rules.push(op.text);
      return;
    }
    case 'org.influence': {
      const org = findFuzzy(s.orgs, op.org);
      if (!org) throw new OpError(`Unknown organization "${op.org}"`);
      assertUnlocked(org, ctx);
      const loc = ensureLocation(s, op.location, ctx, changes);
      const inf = org.influence.find((i) => i.locationId === loc.id);
      if (op.strength <= 0) org.influence = org.influence.filter((i) => i.locationId !== loc.id);
      else if (inf) inf.strength = op.strength;
      else org.influence.push({ locationId: loc.id, strength: op.strength });
      return;
    }
    case 'quest.add': {
      if (findFuzzy(Object.fromEntries(Object.values(s.quests).map((q) => [q.id, { id: q.id, name: q.title }])), op.title)) {
        return run(s, { type: 'quest.update', title: op.title, desc: op.desc }, ctx, changes);
      }
      const id = uniqueId(s.quests, 'quest', op.title);
      s.quests[id] = {
        id,
        title: op.title,
        desc: op.desc ?? '',
        status: 'active',
        objectives: (op.objectives ?? []).map((t, i) => ({ id: `obj_${i + 1}`, text: t, done: false })),
        giver: op.giver ?? '',
        reward: op.reward ?? '',
        createdAt: s.time.minutes,
        updatedAt: s.time.minutes,
      };
      changes.push({ key: `quest:${id}`, label: op.title, text: `New quest: ${op.title}`, kind: 'text' });
      return;
    }
    case 'quest.update': {
      const index = Object.fromEntries(Object.values(s.quests).map((q) => [q.id, { id: q.id, name: q.title }]));
      const ref = findFuzzy(index, op.title);
      if (!ref) throw new OpError(`Unknown quest "${op.title}"`);
      const q = s.quests[ref.id];
      if (op.desc) q.desc = op.desc;
      if (op.addObjective) q.objectives.push({ id: `obj_${q.objectives.length + 1}`, text: op.addObjective, done: false });
      if (op.objective) {
        const objIndex = Object.fromEntries(q.objectives.map((o) => [o.id, { id: o.id, name: o.text }]));
        const o = findFuzzy(objIndex, op.objective);
        if (o) {
          const obj = q.objectives.find((x) => x.id === o.id)!;
          obj.done = op.done ?? true;
        } else if (op.done === undefined) {
          q.objectives.push({ id: `obj_${q.objectives.length + 1}`, text: op.objective, done: false });
        }
      }
      if (op.status && op.status !== q.status) {
        q.status = op.status;
        changes.push({ key: `quest:${q.id}`, label: q.title, text: `${q.title}: ${op.status === 'done' ? 'completed' : op.status}`, kind: 'text' });
      }
      q.updatedAt = s.time.minutes;
      return;
    }
    case 'databank.add': {
      const dup = Object.values(s.databank).find((f) => f.text.trim().toLowerCase() === op.text.trim().toLowerCase());
      if (dup) return;
      const id = `fact_${nextCounter(s.counters, 'fact')}`;
      s.databank[id] = { id, title: op.title ?? '', text: op.text, tags: op.tags ?? [], at: s.time.minutes, source: ctx.source, kind: 'fact', trend: null, status: 'active' };
      changes.push({ key: `fact:${id}`, label: 'Fact', text: 'New fact learned', kind: 'text' });
      return;
    }
    case 'databank.update': {
      const f = s.databank[op.id];
      if (!f) throw new OpError('Unknown fact');
      if (op.text !== undefined) f.text = op.text;
      if (op.title !== undefined) f.title = op.title;
      if (op.tags !== undefined) f.tags = op.tags;
      return;
    }
    case 'quest.remove': {
      const idx = Object.fromEntries(Object.values(s.quests).map((q) => [q.id, { id: q.id, name: q.title }]));
      const q = findExact(idx, op.title) ?? findFuzzy(idx, op.title);
      if (!q) throw new OpError(`Unknown quest "${op.title}"`);
      delete s.quests[q.id];
      return;
    }
    case 'databank.remove':
      delete s.databank[op.id];
      return;
    case 'relationship.delta': {
      const r = relationshipFor(s, op.name, ctx);
      const step = ctx.source === 'ai' ? AI_RELATIONSHIP_STEP : 200;
      const da = clamp(op.affection ?? 0, -step, step);
      const dt = clamp(op.trust ?? 0, -step, step);
      r.affection = clamp(r.affection + da, -100, 100);
      r.trust = clamp(r.trust + dt, -100, 100);
      r.desire = clamp((r.desire ?? 0) + clamp(op.desire ?? 0, -step, step), -100, 100);
      r.tension = clamp((r.tension ?? 0) + clamp(op.tension ?? 0, -step, step), -100, 100);
      // An explicit label has to be earned (the player can set any).
      const kept = op.label ? (ctx.source === 'user' ? op.label : earnedLabel(op.label, r)) : null;
      const earned = r.label && r.label !== relationshipLabel({ affection: r.affection - da, trust: r.trust - dt }) ? earnedLabel(r.label, r) : null;
      r.label = kept ?? earned ?? relationshipLabel(r);
      if (da) changes.push({ key: `rel:${r.id}:a`, label: `${r.name} affection`, delta: da, kind: 'tracker' });
      if (dt) changes.push({ key: `rel:${r.id}:t`, label: `${r.name} trust`, delta: dt, kind: 'tracker' });
      return;
    }
    case 'relationship.memory': {
      const r = relationshipFor(s, op.name, ctx);
      r.memories.push({ id: `mem_${nextCounter(s.counters, 'mem')}`, at: s.time.minutes, text: op.text });
      if (r.memories.length > 100) r.memories.shift();
      return;
    }
    case 'outfit.set': {
      const outfit = { text: op.text, at: s.time.minutes };
      if (/^(player|you|me)$/i.test(op.who) || normalizeName(op.who) === normalizeName(s.player.name)) s.player.outfit = outfit;
      else {
        const npc = findNpc(s, op.who)?.npc;
        if (!npc) throw new OpError(`Unknown NPC "${op.who}"`);
        npc.outfit = outfit;
      }
      return;
    }
    case 'npc.vitals': {
      const npc = findNpc(s, op.name)?.npc;
      if (!npc) throw new OpError(`Unknown NPC "${op.name}"`);
      assertUnlocked(npc, ctx);
      if (op.state === 'dead') {
        if (npc.status !== 'dead') changes.push({ key: `npc:${npc.id}:dead`, label: npc.name, text: `${npc.name} died`, kind: 'text' });
        npc.status = 'dead';
        npc.unconscious = false;
        for (const m of Object.values(s.party)) if (m.npcId === npc.id) m.hp = 0;
      } else {
        if (op.state === 'unconscious' && !npc.unconscious) changes.push({ key: `npc:${npc.id}:ko`, label: npc.name, text: `${npc.name} was knocked out`, kind: 'text' });
        npc.unconscious = op.state === 'unconscious';
      }
      return;
    }
    case 'bond.delta': {
      const a = findNpc(s, op.from)?.npc;
      const b = findNpc(s, op.to)?.npc;
      if (!a) throw new OpError(`Unknown NPC "${op.from}"`);
      if (!b) throw new OpError(`Unknown NPC "${op.to}"`);
      if (a.id === b.id) throw new OpError('A bond needs two different people');
      const id = `${a.id}>${b.id}`;
      const bond = (s.bonds[id] ??= { from: a.id, to: b.id, affinity: 0, trust: 0, desire: 0, tension: 0, kind: '' });
      const step = ctx.source === 'ai' ? AI_RELATIONSHIP_STEP : 200;
      for (const k of ['affinity', 'trust', 'desire', 'tension'] as const) if (op[k] !== undefined) bond[k] = clamp(bond[k] + clamp(op[k]!, -step, step), -100, 100);
      if (op.kind) {
        const kept = ctx.source === 'user' ? op.kind : earnedLabel(op.kind, { affection: bond.affinity, trust: bond.trust, desire: bond.desire, tension: bond.tension });
        if (kept) bond.kind = kept;
      }
      return;
    }
    case 'goal.set': {
      const npc = findNpc(s, op.npc)?.npc;
      if (!npc) throw new OpError(`Unknown NPC "${op.npc}"`);
      const goals = (npc.goals ??= []);
      const same = goals.find((g) => normalizeName(g.text) === normalizeName(op.text));
      const target = op.target === null ? null : op.target ? findFuzzy(s.locations, op.target)?.id ?? null : undefined;
      const state = op.state ?? 'acting';
      if (same) {
        same.state = state;
        if (op.urgency !== undefined) same.urgency = op.urgency;
        if (target !== undefined) same.targetLocationId = target;
      } else {
        goals.push({ id: `goal_${nextCounter(s.counters, 'goal')}`, text: op.text, state, urgency: op.urgency ?? 5, targetLocationId: target ?? null, activateAt: null, deadline: null });
        if (goals.length > 8) goals.splice(0, goals.length - 8);
      }
      return;
    }
    case 'thread.add': {
      const id = `thread_${nextCounter(s.counters, 'thread')}`;
      const place = op.place ? findFuzzy(s.locations, op.place)?.id ?? null : null;
      const stages = op.stages ?? ['a rumour', 'signs anyone could see', 'impossible to ignore', 'it comes to a head'];
      s.threads[id] = { id, text: op.text, stages, rung: 0, max: stages.length - 1, pace: op.pace ?? 0.2, bias: 0, lastBeat: 0, status: 'active', placeId: place, createdAt: s.time.minutes, bornTurn: op.turn ?? 0 };
      return;
    }
    case 'thread.resolve': {
      const t = Object.values(s.threads).find((x) => x.status !== 'done' && nameMatchScore(x.text, op.text) >= 0.6);
      if (!t) throw new OpError(`Unknown storyline "${op.text}"`);
      t.status = 'done';
      changes.push({ key: `thread:${t.id}`, label: t.text, text: `Settled: ${t.text}`, kind: 'text' });
      return;
    }
    case 'event.add': {
      let at = s.time.minutes;
      if (op.at !== undefined) at = op.at;
      else if (op.inMinutes !== undefined) at = s.time.minutes + op.inMinutes;
      else if (op.date) {
        const now = toDate(s.time.minutes, s.meta.calendar);
        at = fromDate({ year: op.date.year ?? now.year, month: op.date.month - 1, day: op.date.day, hour: op.date.hour, minute: op.date.minute }, s.meta.calendar);
      }
      const npc = op.npc ? findNpc(s, op.npc)?.npc : undefined;
      const id = `ev_${nextCounter(s.counters, 'event')}`;
      s.events[id] = { id, title: op.title, kind: op.kind, at, recurring: op.recurring, notes: op.notes ?? '', npcId: npc?.id ?? null, lastFired: null };
      if (op.kind === 'birthday' && npc) {
        const d = toDate(at, s.meta.calendar);
        npc.birthday = { month: d.month, day: d.day };
      }
      changes.push({ key: `event:${id}`, label: op.title, text: `Scheduled: ${op.title}`, kind: 'text' });
      return;
    }
    case 'event.remove': {
      const idx = Object.fromEntries(Object.values(s.events).map((e) => [e.id, { id: e.id, name: e.title }]));
      const ev = findFuzzy(idx, op.title);
      if (!ev) throw new OpError(`Unknown event "${op.title}"`);
      delete s.events[ev.id];
      return;
    }
    case 'world.log':
      logWorld(s, s.time.minutes, op.kind, op.text);
      return;
    case 'world.seen':
      for (const e of s.worldLog) e.seen = true;
      return;
    case 'party.add': {
      const npc = findNpc(s, op.name)?.npc ?? newNpc(s, op.name, ctx);
      if (Object.values(s.party).some((m) => m.npcId === npc.id)) return;
      if (Object.keys(s.party).length >= 5) throw new OpError('Party is full');
      const level = op.level ?? s.player.level;
      const id = `pm_${slugify(npc.name)}`;
      s.party[id] = {
        id,
        name: npc.name,
        npcId: npc.id,
        characterId: npc.characterId,
        role: op.role ?? 'support',
        level,
        hp: 80 + level * 10,
        maxHp: 80 + level * 10,
        mp: 30 + level * 5,
        maxMp: 30 + level * 5,
        stats: { atk: 8 + level, def: 6 + level, spd: 9 + level, mag: 7 + level },
        equipment: {},
        skills: [],
        sovereign: false,
      };
      changes.push({ key: `party:${id}`, label: npc.name, text: `${npc.name} joined the party`, kind: 'text' });
      return;
    }
    case 'party.remove': {
      const m = findFuzzy(s.party, op.name);
      if (!m) throw new OpError(`${op.name} is not in the party`);
      delete s.party[m.id];
      changes.push({ key: `party:${m.id}`, label: m.name, text: `${m.name} left the party`, kind: 'text' });
      return;
    }
    case 'party.update': {
      const m = findFuzzy(s.party, op.name);
      if (!m) throw new OpError(`${op.name} is not in the party`);
      if (op.role) m.role = op.role;
      // Only the player decides who is sovereign.
      if (op.sovereign !== undefined && ctx.source === 'user') m.sovereign = op.sovereign;
      if (op.hp !== undefined) m.hp = clamp(op.hp, 0, m.maxHp);
      if (op.mp !== undefined) m.mp = clamp(op.mp, 0, m.maxMp);
      if (op.equip) {
        if (op.equip.item === null) delete m.equipment[op.equip.slot];
        else m.equipment[op.equip.slot] = op.equip.item;
      }
      return;
    }
    case 'battle.start': {
      if (s.battle && s.battle.status === 'active') throw new OpError('A battle is already in progress');
      const seed = seedFrom(s.meta.seed, 'battle', s.time.minutes, nextCounter(s.counters, 'battle'));
      s.battle = startBattle(s, op.enemies, seed);
      changes.push({ key: 'battle', label: 'Battle', text: 'Battle started', kind: 'text' });
      finalizeBattle(s, changes);
      return;
    }
    case 'battle.action': {
      if (!s.battle) throw new OpError('No battle in progress');
      const err = playerAction(s, s.battle, op);
      if (err) throw new OpError(err);
      finalizeBattle(s, changes);
      return;
    }
    case 'battle.end': {
      if (!s.battle) return;
      if (s.battle.status === 'active') {
        s.battle.status = op.outcome ?? 'fled';
        s.battle.log.push({ round: s.battle.round, text: 'The battle ends.', kind: 'info' });
      }
      finalizeBattle(s, changes);
      s.battle = null;
      return;
    }
    case 'phone.notify': {
      const npc = findNpc(s, op.npc)?.npc;
      if (!npc) throw new OpError(`Unknown NPC "${op.npc}"`);
      npc.phone = true;
      s.phone.pending.push({ id: `ph_${nextCounter(s.counters, 'phone')}`, npcId: npc.id, at: s.time.minutes, reason: op.reason ?? 'wants to talk' });
      s.phone.unread[npc.id] = (s.phone.unread[npc.id] ?? 0) + 1;
      return;
    }
    case 'phone.read': {
      const npc = findNpc(s, op.npc)?.npc;
      if (!npc) return;
      delete s.phone.unread[npc.id];
      s.phone.pending = s.phone.pending.filter((p) => p.npcId !== npc.id);
      return;
    }
    case 'activity':
      runActivity(s, op, changes);
      return;
    case 'meta.update': {
      if (op.title) s.meta.title = op.title;
      if (op.style) s.meta.style = op.style;
      if (op.currencyName) s.meta.currency.name = op.currencyName;
      if (op.currencySymbol !== undefined) s.meta.currency.symbol = op.currencySymbol;
      if (op.dayLengthMode) s.meta.dayLength.mode = op.dayLengthMode;
      if (op.realMinutesPerDay) s.meta.dayLength.realMinutesPerDay = op.realMinutesPerDay;
      if (op.calendar && typeof op.calendar === 'object' && Array.isArray(op.calendar.months) && op.calendar.months.length) {
        const c = op.calendar;
        s.meta.calendar = {
          name: String(c.name ?? s.meta.calendar.name).slice(0, 60),
          months: c.months.slice(0, 24).map((m: any) => ({ name: String(m.name ?? 'Month').slice(0, 40), days: clamp(Number(m.days) || 30, 1, 60) })),
          weekdays: Array.isArray(c.weekdays) && c.weekdays.length ? c.weekdays.slice(0, 14).map((w: any) => String(w).slice(0, 30)) : s.meta.calendar.weekdays,
          epochYear: Number.isFinite(Number(c.epochYear)) ? Number(c.epochYear) : s.meta.calendar.epochYear,
          epochWeekday: clamp(Number(c.epochWeekday) || 0, 0, 13),
          dateFormat: String(c.dateFormat ?? s.meta.calendar.dateFormat).slice(0, 80),
          clock: c.clock === '24h' ? '24h' : '12h',
        };
      }
      return;
    }
    case 'patch':
      applyPatches(s, op.patches as Patch[]);
      return;
    default: {
      const h = (HANDLERS3 as Record<string, (s: CampaignState, op: Op, kit: Kit) => void>)[op.type];
      if (!h) throw new OpError(`Unsupported op "${(op as Op).type}"`);
      h(s, op, {
        ctx,
        changes,
        advanceTime: (m) => advanceTime(s, m, changes),
        addXp: (a) => addXp(s, a, changes),
        ensureLocation: (name) => ensureLocation(s, name, ctx, changes),
        notify: (t) => notifyPlayer(s, t),
      });
    }
  }
}

export const ACTIVITY_RATES: Record<string, { hours: number; perHour: Record<string, number>; bars?: Record<string, number>; xpPerHour?: number; payPerHour?: number; label: string }> = {
  sleep: { hours: 8, perHour: { energy: 14, hunger: -2 }, bars: { hp: 4, mp: 5, ap: 5 }, label: 'Slept' },
  nap: { hours: 1, perHour: { energy: 10 }, bars: { ap: 5 }, label: 'Napped' },
  rest: { hours: 1, perHour: { energy: 6 }, bars: { hp: 5, ap: 8 }, label: 'Rested' },
  work: { hours: 4, perHour: { energy: -3, hygiene: -1 }, payPerHour: 12, label: 'Worked' },
  train: { hours: 2, perHour: { energy: -6, hygiene: -3, hunger: 2 }, xpPerHour: 12, label: 'Trained' },
  study: { hours: 2, perHour: { energy: -2 }, xpPerHour: 8, label: 'Studied' },
  explore: { hours: 1, perHour: { energy: -3 }, xpPerHour: 5, label: 'Explored' },
  cook: { hours: 1, perHour: {}, label: 'Cooked' },
  bathe: { hours: 0.5, perHour: { hygiene: 200 }, label: 'Bathed' },
};

function runActivity(s: CampaignState, op: OpOf<'activity'>, changes: Change[]) {
  const spec = ACTIVITY_RATES[op.kind];
  const hours = op.hours ?? spec.hours;
  if (op.kind === 'cook') {
    if (s.player.currency < 3) throw new OpError('Not enough money for ingredients');
    s.player.currency -= 3;
    changes.push({ key: 'currency', label: s.meta.currency.name, delta: -3, kind: 'currency' });
    run(s, { type: 'item.add', name: 'Home-cooked Meal', qty: 1, category: 'food' }, { source: 'system' }, changes);
  }
  // Time passes first (normal drift), then the activity's own effect lands on top.
  advanceTime(s, Math.round(hours * 60), changes);
  // Doing it at home with the right amenities helps (a better bed, a bath, a study desk).
  const bonus = op.kind === 'sleep' || op.kind === 'nap' ? homeBonus(s, 'sleep') : op.kind === 'bathe' ? homeBonus(s, 'bath') : op.kind === 'study' || op.kind === 'train' ? homeBonus(s, 'study') : 1;
  const boost = (v: number) => (v > 0 ? v * bonus : v);
  applyEffects(
    s,
    {
      trackers: Object.fromEntries(Object.entries(spec.perHour).map(([k, v]) => [k, boost(v) * hours])),
      bars: Object.fromEntries(Object.entries(spec.bars ?? {}).map(([k, v]) => [k, boost(v) * hours])),
    },
    changes,
  );
  if (bonus > 1) changes.push({ key: `activity:${op.kind}:home`, label: 'Home', text: `+${Math.round((bonus - 1) * 100)}% from your home`, kind: 'text' });
  if (spec.xpPerHour) addXp(s, Math.round(spec.xpPerHour * hours * bonus), changes);
  if (spec.payPerHour) {
    const pay = Math.round(spec.payPerHour * hours);
    s.player.currency += pay;
    changes.push({ key: 'currency', label: s.meta.currency.name, delta: pay, kind: 'currency' });
  }
  changes.push({ key: `activity:${op.kind}`, label: spec.label, text: `${spec.label} for ${hours} h`, kind: 'text' });
}

/** Apply one op. Never throws: rejected ops return the unchanged state with `error`. */
export function applyOp(state: CampaignState, op: Op, ctx: ApplyContext = { source: 'user' }): ApplyResult {
  const changes: Change[] = [];
  try {
    const [next, , inverse] = produceWithPatches(state, (draft: CampaignState) => {
      run(draft, op, ctx, changes);
    });
    return { state: next as CampaignState, inverse: inverse.length ? { type: 'patch', patches: inverse } : null, changes };
  } catch (e) {
    if (e instanceof OpError) return { state, inverse: null, changes: [], error: e.message };
    return { state, inverse: null, changes: [], error: `Internal error: ${(e as Error).message}` };
  }
}

export interface ApplyManyResult {
  state: CampaignState;
  /** Inverses in application order; undo by applying them in reverse. */
  inverses: Op[];
  changes: Change[];
  applied: Op[];
  errors: Array<{ op: Op; error: string }>;
}

/** Names the player deleted: the model may not bring them back; the player can. */
function forget(s: CampaignState, name: string) {
  const n = normalizeName(name);
  if (n && !s.forgotten.includes(n)) s.forgotten.push(n);
}
function unforget(s: CampaignState, name: string) {
  const n = normalizeName(name);
  s.forgotten = s.forgotten.filter((x) => x !== n);
}
function assertNotForgotten(s: CampaignState, name: string, ctx: ApplyContext) {
  if (ctx.source !== 'user' && s.forgotten?.includes(normalizeName(name))) throw new OpError(`"${name}" was removed by the player`);
}

export function applyOps(state: CampaignState, ops: Op[], ctx: ApplyContext = { source: 'user' }): ApplyManyResult {
  let cur = state;
  const inverses: Op[] = [];
  const changes: Change[] = [];
  const applied: Op[] = [];
  const errors: Array<{ op: Op; error: string }> = [];
  for (const op of ops) {
    const r = applyOp(cur, op, ctx);
    if (r.error) {
      errors.push({ op, error: r.error });
      continue;
    }
    cur = r.state;
    if (r.inverse) inverses.push(r.inverse);
    changes.push(...r.changes);
    applied.push(op);
  }
  return { state: cur, inverses, changes, applied, errors };
}

/** Undo: apply inverse patches in reverse order. */
export function invertOps(state: CampaignState, inverses: Op[]): CampaignState {
  let cur = state;
  for (let i = inverses.length - 1; i >= 0; i--) {
    const r = applyOp(cur, inverses[i], { source: 'system' });
    if (r.error) throw new Error(`Inverse failed: ${r.error}`);
    cur = r.state;
  }
  return cur;
}

export { MIN_PER_DAY };
