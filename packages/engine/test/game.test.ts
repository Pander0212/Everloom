import { describe, expect, it } from 'vitest';
import {
  AI_OP_TYPES, applyOp, applyOps, buildGameStateBlock, createInitialState, currentSlot, distanceKm, findDuplicateNpcs, findNpc,
  formatClock, formatDate, invertOps, rebuild, relationshipLabel, selectActiveEntries, standingLabel, summarizeChanges,
  travelOptions, validateOps, type AnchoredEntry, type CampaignState, type Op,
} from '../src/index.js';

const base = () => createInitialState({ seed: 42, playerName: 'Anala' });
const apply = (s: CampaignState, ops: Op[], source: any = 'ai') => applyOps(s, ops, { source });

describe('op validation', () => {
  it('accepts valid ops and coerces numbers', () => {
    const v = validateOps({ ops: [{ type: 'time.advance', minutes: '20' }, { type: 'item.add', name: 'Tea' }] });
    expect(v.ok).toHaveLength(2);
    expect((v.ok[0] as any).minutes).toBe(20);
    expect((v.ok[1] as any).qty).toBe(1);
  });
  it('rejects unknown and malformed ops without dropping valid ones', () => {
    const v = validateOps([{ type: 'nuke.world' }, { type: 'item.add' }, { type: 'tracker.delta', id: 'hunger', delta: -5 }]);
    expect(v.ok).toHaveLength(1);
    expect(v.rejected).toHaveLength(2);
  });
  it('maps common aliases', () => {
    expect(validateOps([{ type: 'add_item', name: 'Rope' }]).ok[0].type).toBe('item.add');
  });
  it('never lets the AI send internal patch ops', () => {
    expect(AI_OP_TYPES).not.toContain('patch');
    expect(validateOps([{ type: 'patch', patches: [] }]).ok).toHaveLength(0);
  });
});

describe('reducer', () => {
  it('adds, stacks and removes items with change summaries', () => {
    let s = base();
    let r = apply(s, [{ type: 'item.add', name: 'Iced Lemon Tea', qty: 1 } as Op]);
    s = r.state;
    expect(Object.values(s.inventory)[0].category).toBe('drink');
    r = apply(s, [{ type: 'item.add', name: 'iced lemon teas', qty: 2 } as Op]);
    expect(Object.values(r.state.inventory)[0].qty).toBe(3);
    r = apply(r.state, [{ type: 'item.remove', name: 'Iced Lemon Tea', qty: 5 } as Op]);
    expect(Object.keys(r.state.inventory)).toHaveLength(0);
  });

  it('uses food deterministically (restores hunger)', () => {
    let s = apply(base(), [{ type: 'item.add', name: 'Bread', qty: 2 } as Op]).state;
    s = apply(s, [{ type: 'tracker.set', id: 'hunger', value: 70 } as Op], 'user').state;
    const r = apply(s, [{ type: 'item.use', name: 'Bread' } as Op], 'user');
    expect(r.state.trackers.hunger.value).toBe(42);
    expect(Object.values(r.state.inventory)[0].qty).toBe(1);
  });

  it('clamps numbers', () => {
    const r = apply(base(), [{ type: 'tracker.delta', id: 'hunger', delta: 500 } as Op]);
    expect(r.state.trackers.hunger.value).toBeLessThanOrEqual(100);
    // A model's report never kills the player; the player's own change can.
    const r2 = apply(base(), [{ type: 'bar.delta', id: 'hp', delta: -9999 } as Op]);
    expect(r2.state.player.bars.hp.cur).toBe(1);
    expect(apply(base(), [{ type: 'bar.delta', id: 'hp', delta: -9999 } as Op], 'user').state.player.bars.hp.cur).toBe(0);
    // Feelings move at most 8 per model report.
    const r3 = apply(base(), [{ type: 'relationship.delta', name: 'Iris', affection: 90 } as Op]);
    expect(Object.values(r3.state.relationships)[0].affection).toBe(8);
  });

  it('time advance decays trackers and formats the clock', () => {
    const s0 = base();
    const r = apply(s0, [{ type: 'time.advance', minutes: 120 } as Op]);
    expect(r.state.trackers.hunger.value).toBe(s0.trackers.hunger.value + 8);
    expect(r.state.trackers.energy.value).toBe(s0.trackers.energy.value - 6);
    expect(formatClock(r.state.time.minutes, r.state.meta.calendar)).toBe('10:00 AM');
    expect(formatDate(s0.time.minutes, s0.meta.calendar)).toMatch(/July 1, 2026/);
    expect(summarizeChanges(r.changes)).toContain('2 h passed');
  });

  it('time.until never goes backwards', () => {
    const r = apply(base(), [{ type: 'time.until', hour: 7, minute: 0 } as Op]);
    expect(formatClock(r.state.time.minutes, r.state.meta.calendar)).toBe('7:00 AM');
    expect(r.state.time.minutes).toBeGreaterThan(base().time.minutes);
  });

  it('inverse patches restore the exact previous state', () => {
    const s0 = base();
    const ops: Op[] = [
      { type: 'item.add', name: 'Sword', qty: 1, category: 'weapon' } as Op,
      { type: 'item.equip', name: 'Sword', equipped: true } as Op,
      { type: 'time.advance', minutes: 600 } as Op,
      { type: 'npc.upsert', name: 'Tobias Moreno', role: 'Band leader', location: 'Old Mill', org: 'The Ravens' } as Op,
      { type: 'org.standing', name: 'The Ravens', delta: 10 } as Op,
      { type: 'quest.add', title: 'Find a vocalist', objectives: ['Ask around'] } as Op,
      { type: 'xp.add', amount: 250 } as Op,
    ];
    const r = apply(s0, ops);
    expect(r.errors).toEqual([]);
    expect(r.state.player.level).toBeGreaterThan(1);
    const undone = invertOps(r.state, r.inverses);
    expect(undone).toEqual(s0);
  });

  it('never lets AI ops change locked entities', () => {
    let s = apply(base(), [{ type: 'npc.upsert', name: 'Iris Thorne' } as Op], 'user').state;
    const id = Object.keys(s.npcs)[0];
    s = { ...s, npcs: { ...s.npcs, [id]: { ...s.npcs[id], locked: true } } };
    const r = apply(s, [{ type: 'npc.upsert', name: 'Iris Thorne', role: 'Villain' } as Op], 'ai');
    expect(r.errors).toHaveLength(1);
    expect(r.state.npcs[id].role).toBe('NPC');
    const r2 = apply(s, [{ type: 'npc.upsert', name: 'Iris Thorne', role: 'Friend' } as Op], 'user');
    expect(r2.state.npcs[id].role).toBe('Friend');
  });

  it('standing labels use fixed thresholds', () => {
    expect(standingLabel(0)).toBe('Enemy');
    expect(standingLabel(14)).toBe('Enemy');
    expect(standingLabel(15)).toBe('Hostile');
    expect(standingLabel(34)).toBe('Hostile');
    expect(standingLabel(35)).toBe('Neutral');
    expect(standingLabel(64)).toBe('Neutral');
    expect(standingLabel(65)).toBe('Friendly');
    expect(relationshipLabel({ affection: 50, trust: 60 })).toBe('Close friend');
  });

  it('level up is deterministic', () => {
    const r = apply(base(), [{ type: 'xp.add', amount: 100 } as Op]);
    expect(r.state.player.level).toBe(2);
    expect(r.state.player.bars.hp.max).toBe(110);
    expect(r.state.player.bars.xp.cur).toBe(0);
  });
});

describe('npc dedupe', () => {
  it('merges "Tobias" into "Tobias Moreno" instead of duplicating', () => {
    let s = apply(base(), [{ type: 'npc.upsert', name: 'Tobias Moreno', role: 'Local coordinator' } as Op]).state;
    s = apply(s, [{ type: 'npc.upsert', name: 'Tobias', notes: 'Plays drums.' } as Op]).state;
    expect(Object.keys(s.npcs)).toHaveLength(1);
    const npc = Object.values(s.npcs)[0];
    expect(npc.name).toBe('Tobias Moreno');
    expect(npc.aliases).toContain('Tobias');
  });
  it('upgrades a short name to the full name', () => {
    let s = apply(base(), [{ type: 'npc.upsert', name: 'Bastian' } as Op]).state;
    s = apply(s, [{ type: 'npc.upsert', name: 'Bastian Rivers', role: 'Independent specialist' } as Op]).state;
    expect(Object.values(s.npcs).map((n) => n.name)).toEqual(['Bastian Rivers']);
  });
  it('keeps different people apart', () => {
    let s = apply(base(), [{ type: 'npc.upsert', name: 'Tobias Moreno' } as Op]).state;
    s = apply(s, [{ type: 'npc.upsert', name: 'Tobias Reyes' } as Op]).state;
    expect(Object.keys(s.npcs)).toHaveLength(2);
    expect(findNpc(s, 'Tobias')).toBeUndefined();
  });
  it('tolerates small typos and honorifics', () => {
    let s = apply(base(), [{ type: 'npc.upsert', name: 'Iris Thorne' } as Op]).state;
    s = apply(s, [{ type: 'npc.upsert', name: 'Iris Thorn' } as Op]).state;
    s = apply(s, [{ type: 'npc.upsert', name: 'Ms. Iris Thorne' } as Op]).state;
    expect(Object.keys(s.npcs)).toHaveLength(1);
  });
  it('links NPCs to character cards by name', () => {
    const r = applyOps(base(), [{ type: 'npc.upsert', name: 'Iris Thorne' } as Op], { source: 'ai', characters: [{ id: 'char_1', name: 'Iris Thorne' }] });
    expect(Object.values(r.state.npcs)[0].characterId).toBe('char_1');
  });
  it('finds duplicates for merging', () => {
    const s = base();
    s.npcs.a = { ...apply(base(), [{ type: 'npc.upsert', name: 'x' } as Op]).state.npcs.npc_x, id: 'a', name: 'Tobias' };
    s.npcs.b = { ...s.npcs.a, id: 'b', name: 'Tobias Moreno' };
    expect(findDuplicateNpcs(s)).toEqual([['a', 'b']]);
  });
});

describe('op log rollback (swipe / edit / delete / branch)', () => {
  // Minimal model of how the server anchors ops to messages and swipes.
  function setup() {
    const baseState = base();
    const messages = [
      { id: 'm1', chatId: 'c1', swipeId: 0 },
      { id: 'm2', chatId: 'c1', swipeId: 0 },
    ];
    const entries: AnchoredEntry[] = [
      { id: 'e1', seq: 1, chatId: 'c1', messageId: 'm1', swipeId: 0, source: 'ai', ops: [{ type: 'item.add', name: 'Iced Lemon Tea', qty: 1 } as Op, { type: 'time.advance', minutes: 20 } as Op] },
      { id: 'e2', seq: 2, chatId: 'c1', messageId: 'm2', swipeId: 0, source: 'ai', ops: [{ type: 'item.use', name: 'Iced Lemon Tea' } as Op] },
      { id: 'e3', seq: 3, chatId: 'c1', messageId: 'm2', swipeId: 1, source: 'ai', ops: [{ type: 'currency.delta', amount: 50 } as Op] },
      { id: 'e4', seq: 4, chatId: 'c1', messageId: 'm2', swipeId: null, source: 'user', ops: [{ type: 'item.add', name: 'Map', qty: 1 } as Op] },
    ];
    const state = () => rebuild(baseState, selectActiveEntries(entries, messages)).state;
    return { baseState, messages, entries, state };
  }

  it('swipe switches between alternative op sets exactly', () => {
    const { messages, state, baseState } = setup();
    let s = state();
    expect(Object.values(s.inventory).map((i) => i.name)).toEqual(['Map']);
    expect(s.player.currency).toBe(baseState.player.currency);
    messages[1].swipeId = 1;
    s = state();
    expect(Object.values(s.inventory).map((i) => i.name).sort()).toEqual(['Iced Lemon Tea', 'Map']);
    expect(s.player.currency).toBe(baseState.player.currency + 50);
    messages[1].swipeId = 0;
    expect(state()).toEqual(setup().state());
  });

  it('delete removes the message ops but keeps earlier ones', () => {
    const { messages, state, baseState } = setup();
    messages.splice(1, 1);
    const s = state();
    expect(Object.values(s.inventory).map((i) => i.name)).toEqual(['Iced Lemon Tea']);
    expect(s.time.minutes).toBe(baseState.time.minutes + 20);
  });

  it('edit replaces the ops of that message/swipe', () => {
    const { entries, state } = setup();
    const e2 = entries.find((e) => e.id === 'e2')!;
    e2.ops = [{ type: 'item.add', name: 'Cookie', qty: 2 } as Op];
    const s = state();
    expect(Object.values(s.inventory).map((i) => `${i.name}:${i.qty}`).sort()).toEqual(['Cookie:2', 'Iced Lemon Tea:1', 'Map:1']);
  });

  it('branch at m1 copies only ops up to the branch point', () => {
    const { entries, baseState } = setup();
    const branchMessages = [{ id: 'b1', chatId: 'c2', swipeId: 0 }];
    const copied = entries.filter((e) => e.messageId === 'm1').map((e) => ({ ...e, id: `${e.id}b`, chatId: 'c2', messageId: 'b1' }));
    const s = rebuild(baseState, selectActiveEntries(copied, branchMessages)).state;
    expect(Object.values(s.inventory).map((i) => i.name)).toEqual(['Iced Lemon Tea']);
  });

  it('incremental apply equals full rebuild', () => {
    const { baseState, entries, messages } = setup();
    let inc = baseState;
    for (const e of selectActiveEntries(entries, messages)) inc = applyOps(inc, e.ops, { source: e.source }).state;
    expect(inc).toEqual(rebuild(baseState, selectActiveEntries(entries, messages)).state);
  });
});

describe('world simulation', () => {
  function world() {
    let s = base();
    s = apply(s, [
      { type: 'location.upsert', name: 'Northcrest', level: 'region', x: 500, y: 300 } as Op,
      { type: 'location.upsert', name: 'Rehearsal Studio', parent: 'Northcrest', kind: 'building', x: 200, y: 200 } as Op,
      { type: 'location.upsert', name: 'Market', parent: 'Northcrest', kind: 'shop', x: 700, y: 400 } as Op,
      { type: 'location.move', to: 'Market' } as Op,
      { type: 'npc.upsert', name: 'Tobias Moreno', location: 'Rehearsal Studio', rumor: 'The mayor owes the Ravens money.', org: 'The Ravens' } as Op,
      { type: 'npc.upsert', name: 'Bastian Rivers', location: 'Rehearsal Studio', org: 'The Ravens', phone: true } as Op,
      { type: 'relationship.delta', name: 'Bastian Rivers', affection: 10 } as Op,
      { type: 'relationship.delta', name: 'Bastian Rivers', affection: 10 } as Op,
      { type: 'npc.schedule', name: 'Tobias Moreno', slots: [{ days: [], from: '9:00', to: '17:00', activity: 'Shopping', location: 'Market' }, { days: [], from: '17:00', to: '9:00', activity: 'Rehearsing', location: 'Rehearsal Studio' }] } as Op,
      { type: 'event.add', title: 'Gig night', inMinutes: 60 * 30 } as Op,
    ], 'user').state;
    return s;
  }

  it('is deterministic for the same seed', () => {
    const a = apply(world(), [{ type: 'time.advance', minutes: 60 * 24 * 5 } as Op]).state;
    const b = apply(world(), [{ type: 'time.advance', minutes: 60 * 24 * 5 } as Op]).state;
    expect(a).toEqual(b);
  });

  it('gives the same world whether time is advanced at once or in steps', () => {
    const once = apply(world(), [{ type: 'time.advance', minutes: 60 * 72 } as Op]).state;
    let steps = world();
    for (let i = 0; i < 12; i++) steps = apply(steps, [{ type: 'time.advance', minutes: 360 } as Op]).state;
    expect(steps.weather).toEqual(once.weather);
    expect(steps.npcs).toEqual(once.npcs);
    expect(steps.phone).toEqual(once.phone);
  });

  it('moves NPCs along schedules and fires events', () => {
    let s = world();
    s = apply(s, [{ type: 'time.until', hour: 10, minute: 0 } as Op]).state;
    const tob = Object.values(s.npcs).find((n) => n.name === 'Tobias Moreno')!;
    expect(s.locations[tob.locationId!].name).toBe('Market');
    expect(currentSlot(tob, s.time.minutes, s)?.activity).toBe('Shopping');
    s = apply(s, [{ type: 'time.advance', minutes: 60 * 30 } as Op]).state;
    expect(s.worldLog.some((l) => l.text === 'Gig night')).toBe(true);
  });

  it('spreads rumors between NPCs sharing a place or group', () => {
    const s = apply(world(), [{ type: 'time.advance', minutes: 60 * 24 * 10 } as Op]).state;
    const bastian = Object.values(s.npcs).find((n) => n.name === 'Bastian Rivers')!;
    expect(bastian.knownRumors).toContain('The mayor owes the Ravens money.');
  });

  it('different seeds give different weather histories', () => {
    const a = apply(world(), [{ type: 'time.advance', minutes: 60 * 24 * 7 } as Op]).state;
    const w = world();
    w.meta.seed = 7;
    const b = apply(w, [{ type: 'time.advance', minutes: 60 * 24 * 7 } as Op]).state;
    expect(JSON.stringify(a.worldLog.filter((l) => l.kind === 'weather'))).not.toEqual(JSON.stringify(b.worldLog.filter((l) => l.kind === 'weather')));
  });
});

describe('travel', () => {
  it('computes distance, time, energy and fares deterministically', () => {
    let s = createInitialState({ seed: 1, style: 'modern' });
    s = apply(s, [
      { type: 'location.upsert', name: 'City', level: 'region', x: 100, y: 100 } as Op,
      { type: 'location.upsert', name: 'Home', parent: 'City', x: 100, y: 100 } as Op,
      { type: 'location.upsert', name: 'Office', parent: 'City', x: 400, y: 500 } as Op,
      { type: 'location.move', to: 'Home' } as Op,
    ], 'user').state;
    const km = distanceKm(s, s.currentLocationId!, Object.values(s.locations).find((l) => l.name === 'Office')!.id);
    expect(km).toBeCloseTo(10, 0);
    const opts = travelOptions(s, s.currentLocationId, 'loc_office');
    const walk = opts.find((o) => o.mode === 'walk')!;
    expect(walk.minutes).toBe(Math.round((km / 4.8) * 60));
    const taxi = opts.find((o) => o.mode === 'taxi')!;
    expect(taxi.fare).toBeGreaterThan(0);
    const before = s.player.currency;
    const r = apply(s, [{ type: 'travel', to: 'Office', mode: 'taxi' } as Op], 'user');
    expect(r.errors).toEqual([]);
    expect(r.state.currentLocationId).toBe('loc_office');
    expect(r.state.player.currency).toBeCloseTo(before - taxi.fare, 2);
    expect(r.state.time.minutes).toBe(s.time.minutes + taxi.minutes);
  });
});

describe('battle', () => {
  it('runs deterministically and writes results back', () => {
    const start = (s: CampaignState) => apply(s, [{ type: 'battle.start', enemies: [{ name: 'Wolf', level: 1, count: 2 }] } as Op]).state;
    const play = (s: CampaignState) => {
      let cur = start(s);
      for (let i = 0; i < 60 && cur.battle?.status === 'active'; i++) {
        const target = Object.values(cur.battle.combatants).find((c) => c.side === 'enemy' && c.alive)?.id;
        cur = applyOps(cur, [{ type: 'battle.action', action: 'attack', target } as Op], { source: 'user' }).state;
      }
      return cur;
    };
    const a = play(base());
    const b = play(base());
    expect(a).toEqual(b);
    expect(['won', 'lost']).toContain(a.battle!.status);
    if (a.battle!.status === 'won') expect(a.player.bars.xp.cur + (a.player.level - 1) * 100).toBeGreaterThan(0);
    const ended = applyOps(a, [{ type: 'battle.end' } as Op], { source: 'user' }).state;
    expect(ended.battle).toBeNull();
  });
  it('rejects actions out of turn or without battle', () => {
    expect(applyOp(base(), { type: 'battle.action', action: 'attack' } as Op, { source: 'user' }).error).toBeTruthy();
  });
});

describe('activities and injection', () => {
  it('sleep restores energy and advances time', () => {
    let s = base();
    s = apply(s, [{ type: 'tracker.set', id: 'energy', value: 20 } as Op], 'user').state;
    const r = apply(s, [{ type: 'activity', kind: 'sleep' } as Op], 'user');
    expect(r.state.trackers.energy.value).toBeGreaterThan(80);
    expect(r.state.time.minutes).toBe(s.time.minutes + 480);
  });
  it('builds a compact state block within budget', () => {
    let s = base();
    s = apply(s, [
      { type: 'location.upsert', name: 'Old Mill', description: 'A creaky mill by the river.' } as Op,
      { type: 'location.move', to: 'Old Mill' } as Op,
      { type: 'npc.upsert', name: 'Iris Thorne', location: 'Old Mill', role: 'Community regular' } as Op,
      { type: 'quest.add', title: 'Find a vocalist', objectives: ['Ask Iris'] } as Op,
    ], 'user').state;
    const block = buildGameStateBlock(s, { budgetTokens: 400 });
    expect(block).toContain('Old Mill');
    expect(block).toContain('Iris Thorne');
    expect(block).toContain('Find a vocalist');
    const tiny = buildGameStateBlock(s, { budgetTokens: 60 });
    expect(tiny.length).toBeLessThan(block.length);
  });
});

describe('direct editing ops', () => {
  it('merges NPCs, keeping memberships and relationships', () => {
    let s = apply(base(), [
      { type: 'npc.upsert', name: 'Tobias', org: 'The Ravens' } as Op,
      { type: 'relationship.delta', name: 'Tobias', affection: 5 } as Op,
    ], 'user').state;
    // Simulate a duplicate the AI created before dedupe existed.
    s = { ...s, npcs: { ...s.npcs, npc_moreno: { ...s.npcs.npc_tobias, id: 'npc_moreno', name: 'Tobias Moreno', role: 'Band leader', orgs: [], aliases: [] } } };
    const r = applyOps(s, [{ type: 'npc.merge', into: 'npc_tobias', from: 'npc_moreno' } as Op], { source: 'user' });
    expect(r.errors).toEqual([]);
    expect(Object.keys(r.state.npcs)).toEqual(['npc_tobias']);
    const t = r.state.npcs.npc_tobias;
    expect(t.name).toBe('Tobias Moreno');
    expect(t.aliases).toContain('Tobias');
    expect(t.role).toBe('Band leader');
    expect(Object.values(r.state.orgs)[0].members.map((m) => m.npcId)).toEqual(['npc_tobias']);
    expect(Object.values(r.state.relationships)[0].npcId).toBe('npc_tobias');
  });
  it('npc.set is user-only and edits schedules', () => {
    const s = apply(base(), [{ type: 'npc.upsert', name: 'Iris' } as Op], 'user').state;
    expect(validateOps([{ type: 'npc.set', id: 'npc_iris', patch: { role: 'x' } }]).ok).toHaveLength(0);
    const r = applyOps(s, [{ type: 'npc.set', id: 'npc_iris', patch: { role: 'Bartender', schedule: [{ days: [], from: 600, to: 1200, activity: 'Working', locationId: null }] } } as Op], { source: 'user' });
    expect(r.state.npcs.npc_iris.role).toBe('Bartender');
    expect(r.state.npcs.npc_iris.schedule[0].activity).toBe('Working');
  });
});
