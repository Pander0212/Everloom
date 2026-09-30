import { describe, expect, it } from 'vitest';
import {
  applyOps, checkOdds, createInitialState, detectCheck, detectMove, earnedLabel, goalOps, healthCheck, nextHop, pulseAt, threadRung, tierFor, turnTick,
  type CampaignState, type Op,
} from '../src/index.js';

const base = () => createInitialState({ seed: 42, playerName: 'Anala' });
const apply = (s: CampaignState, ops: object[], source: any = 'ai') => applyOps(s, ops as Op[], { source });
const world = () =>
  apply(
    base(),
    [
      { type: 'location.upsert', name: 'The Lantern', kind: 'building' },
      { type: 'location.upsert', name: 'Market Square', kind: 'district' },
      { type: 'location.upsert', name: 'Old Pier', kind: 'district' },
      { type: 'route.add', from: 'The Lantern', to: 'Market Square' },
      { type: 'route.add', from: 'Market Square', to: 'Old Pier' },
      { type: 'location.move', to: 'The Lantern' },
      { type: 'npc.upsert', name: 'Iris Thorne', location: 'The Lantern' },
      { type: 'npc.upsert', name: 'Tobias Moreno', location: 'Old Pier' },
    ],
    'user',
  ).state;

describe('dice', () => {
  it('logistic odds: even 50%, +2 about 76%, +4 about 91%', () => {
    expect(checkOdds(0)).toBeCloseTo(0.5, 2);
    expect(checkOdds(2)).toBeCloseTo(0.76, 2);
    expect(checkOdds(4)).toBeCloseTo(0.91, 2);
    expect(checkOdds(-2)).toBeCloseTo(0.24, 2);
  });
  it('four tiers in the right proportions', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 10000; i++) {
      const t = tierFor(0.6, i / 10000);
      counts[t] = (counts[t] ?? 0) + 1;
    }
    const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
    near(counts['critical success'], 600);
    near(counts.success, 5400);
    near(counts['critical failure'], 400);
    near(counts.failure, 3600);
  });
  it('only first-person attempts roll, and the same message always gets the same roll', () => {
    const s = world();
    expect(detectCheck(s, 'Iris tries to climb the wall.', 'm1')).toBeNull();
    expect(detectCheck(s, 'I climb the stairs.', 'm1')).toBeNull();
    expect(detectCheck(s, '"I will try to persuade you," I say.', 'm1')).toBeNull(); // quoted speech is not an action
    const a = detectCheck(s, 'I try to sneak past the heavily guarded gate.', 'm1')!;
    expect(a).toMatchObject({ skill: 'agility', difficulty: 'hard' });
    expect(detectCheck(s, 'I try to sneak past the heavily guarded gate.', 'm1')).toEqual(a);
    const rolls = new Set(Array.from({ length: 20 }, (_, i) => detectCheck(s, 'I try to sneak past.', `m${i}`)!.roll));
    expect(rolls.size).toBe(20);
  });
});

describe('intent', () => {
  it('moves the player to a named place, and companions follow', () => {
    let s = world();
    s = apply(s, [{ type: 'party.add', name: 'Iris Thorne' }]).state;
    expect(detectMove(s, 'I head to the market square to look around.')!.name).toBe('Market Square');
    expect(detectMove(s, 'We walk over to old pier')!.name).toBe('Old Pier');
    expect(detectMove(s, 'I think about the market.')).toBeNull();
    expect(detectMove(s, '"Let\'s go to the Old Pier," I say.')).toBeNull();
    expect(detectMove(s, 'I go to the moon.')).toBeNull();
    const t = turnTick(s, { text: 'I head to Market Square.', messageKey: 'x', turn: 1, switches: { intent: true, dice: true, pulse: false, threads: false } });
    const after = apply(s, t.ops).state;
    const market = Object.values(after.locations).find((l) => l.name === 'Market Square')!;
    expect(after.currentLocationId).toBe(market.id);
    expect(Object.values(after.npcs).find((n) => n.name === 'Iris Thorne')!.locationId).toBe(market.id);
  });
});

describe('pulse, threads and goals are pure functions of the turn number', () => {
  it('pulse: deterministic, and the pity timer guarantees quiet stretches end', () => {
    const fires = Array.from({ length: 200 }, (_, i) => pulseAt(7, i + 1));
    expect(Array.from({ length: 200 }, (_, i) => pulseAt(7, i + 1))).toEqual(fires);
    expect(fires.slice(0, 3).some(Boolean)).toBe(false);
    let quiet = 0;
    let longest = 0;
    for (const f of fires) {
      quiet = f ? 0 : quiet + 1;
      longest = Math.max(longest, quiet);
    }
    expect(longest).toBeLessThan(40);
    expect(fires.filter(Boolean).length).toBeGreaterThan(3);
  });
  it('threads climb on heartbeats and come to a head exactly once', () => {
    let s = world();
    s = apply(s, [{ type: 'thread.add', text: 'The missing ferryman', turn: 10, pace: 0.4 }], 'sim').state;
    const t = Object.values(s.threads)[0];
    const rungs = Array.from({ length: 60 }, (_, i) => threadRung(t, 10 + i));
    expect(rungs[0].rung).toBe(0);
    for (let i = 1; i < rungs.length; i++) expect(rungs[i].rung).toBeGreaterThanOrEqual(rungs[i - 1].rung);
    expect(rungs.filter((r) => r.peakedNow)).toHaveLength(1);
    expect(rungs.at(-1)!.rung).toBe(t.max);
  });
  it('people pursue goals one hop at a time along routes, every third turn, not in front of the player', () => {
    let s = world();
    s = apply(s, [{ type: 'goal.set', npc: 'Tobias Moreno', text: 'Find a singer', target: 'The Lantern' }]).state;
    const loc = (n: string) => Object.values(s.locations).find((l) => l.name === n)!.id;
    expect(nextHop(s, loc('Old Pier'), loc('The Lantern'))).toBe(loc('Market Square'));
    expect(goalOps(s, 2)).toEqual([]);
    s = apply(s, goalOps(s, 3), 'user').state;
    expect(Object.values(s.npcs).find((n) => n.name === 'Tobias Moreno')!.locationId).toBe(loc('Market Square'));
    s = apply(s, goalOps(s, 6), 'user').state;
    expect(Object.values(s.npcs).find((n) => n.name === 'Tobias Moreno')!.locationId).toBe(loc('The Lantern'));
    expect(goalOps(s, 9)).toEqual([]); // arrived
  });
});

describe('relationship rules', () => {
  it('caps model changes per report and makes labels earned', () => {
    let s = world();
    s = apply(s, [{ type: 'relationship.delta', name: 'Iris Thorne', affection: 50, label: 'Lover' }]).state;
    let r = Object.values(s.relationships)[0];
    expect(r.affection).toBe(8);
    expect(r.label).not.toBe('Lover');
    s = apply(s, [{ type: 'relationship.delta', name: 'Iris Thorne', label: 'Sister' }]).state;
    expect(Object.values(s.relationships)[0].label).toBe('Sister'); // kinship needs nothing
    for (let i = 0; i < 6; i++) s = apply(s, [{ type: 'relationship.delta', name: 'Iris Thorne', affection: 8, trust: 8 }]).state;
    s = apply(s, [{ type: 'relationship.delta', name: 'Iris Thorne', label: 'Partner' }]).state;
    r = Object.values(s.relationships)[0];
    expect(r.label).toBe('Partner');
    expect(earnedLabel('crush', { affection: 5, trust: 0, desire: 0 })).toBeNull();
    expect(earnedLabel('crush', { affection: 5, trust: 0, desire: 20 })).toBe('crush');
    // The player can set anything.
    s = apply(world(), [{ type: 'relationship.delta', name: 'Iris Thorne', label: 'Lover' }], 'user').state;
    expect(Object.values(s.relationships)[0].label).toBe('Lover');
  });
  it('bonds are directional and capped', () => {
    let s = world();
    s = apply(s, [{ type: 'bond.delta', from: 'Iris Thorne', to: 'Tobias Moreno', affinity: 30, tension: 5, kind: 'rival' }]).state;
    const b = Object.values(s.bonds);
    expect(b).toHaveLength(1);
    expect(b[0].affinity).toBe(8);
    expect(b[0].kind).toBe(''); // a rivalry has to be earned
    expect(apply(s, [{ type: 'bond.delta', from: 'Iris Thorne', to: 'Iris Thorne', affinity: 1 }]).errors).toHaveLength(1);
  });
});

describe('vitals, outfits and forgotten names', () => {
  it('knocks out and kills NPCs, never the player', () => {
    let s = world();
    s = apply(s, [{ type: 'npc.vitals', name: 'Iris Thorne', state: 'unconscious' }]).state;
    expect(Object.values(s.npcs).find((n) => n.name === 'Iris Thorne')!.unconscious).toBe(true);
    s = apply(s, [{ type: 'npc.vitals', name: 'Iris Thorne', state: 'dead' }]).state;
    expect(Object.values(s.npcs).find((n) => n.name === 'Iris Thorne')!.status).toBe('dead');
    s = apply(s, [{ type: 'bar.delta', id: 'hp', delta: -500 }]).state;
    expect(s.player.bars.hp.cur).toBe(1);
  });
  it('records what people wear and when', () => {
    let s = world();
    s = apply(s, [{ type: 'outfit.set', who: 'player', text: 'yellow rain hood' }, { type: 'outfit.set', who: 'Iris', text: 'green apron' }]).state;
    expect(s.player.outfit!.text).toBe('yellow rain hood');
    expect(Object.values(s.npcs).find((n) => n.name === 'Iris Thorne')!.outfit!.text).toBe('green apron');
  });
  it('a name the player deleted is not brought back by the model', () => {
    let s = world();
    s = apply(s, [{ type: 'npc.remove', name: 'Tobias Moreno' }], 'user').state;
    const r = apply(s, [{ type: 'npc.upsert', name: 'Tobias Moreno', location: 'Old Pier' }]);
    expect(r.errors[0].error).toMatch(/removed by the player/);
    expect(Object.values(r.state.npcs).some((n) => n.name === 'Tobias Moreno')).toBe(false);
    s = apply(s, [{ type: 'npc.upsert', name: 'Tobias Moreno' }], 'user').state;
    expect(apply(s, [{ type: 'npc.move', name: 'Tobias Moreno', location: 'Old Pier' }]).errors).toEqual([]);
  });
  it('only the player makes a party member sovereign', () => {
    let s = apply(world(), [{ type: 'party.add', name: 'Iris Thorne' }]).state;
    s = apply(s, [{ type: 'party.update', name: 'Iris Thorne', sovereign: true }]).state;
    expect(Object.values(s.party)[0].sovereign).toBe(false);
    s = apply(s, [{ type: 'party.update', name: 'Iris Thorne', sovereign: true }], 'user').state;
    expect(Object.values(s.party)[0].sovereign).toBe(true);
  });
});

describe('health check', () => {
  it('finds duplicates and fixes them', () => {
    let s = world();
    s = apply(s, [{ type: 'npc.set', id: Object.values(s.npcs)[0].id, patch: { name: 'Tobias Moreno' } }], 'user').state;
    const issue = healthCheck(s).find((i) => i.id.startsWith('dupe-'))!;
    expect(issue).toBeTruthy();
    s = apply(s, issue.fix!.ops, 'user').state;
    expect(healthCheck(s).find((i) => i.id.startsWith('dupe-'))).toBeUndefined();
  });
});
