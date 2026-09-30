import { describe, expect, it } from 'vitest';
import {
  applyOp,
  applyOps,
  builtinSkillNodes,
  createInitialState,
  currentActor,
  invertOps,
  learnProblems,
  OpSchemas,
  powerAt,
  validateOps,
  xpToNext,
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
const many = (s: CampaignState, ops: unknown[]) => {
  const r = applyOps(s, ops.map(v), { source: 'user' });
  expect(r.errors).toEqual([]);
  return r.state;
};

function hero(): CampaignState {
  const s = createInitialState({ style: 'fantasy', seed: 5 });
  s.player.name = 'Anala';
  return s;
}

/** Hand the turn to the player, running the others (the battle does this itself). */
const playerTurn = (s: CampaignState) => currentActor(s.battle!)?.isPlayer;

describe('progression', () => {
  it('curves: standard matches Phase 1; gentle is cheaper, steep dearer', () => {
    expect([1, 2, 5].map((l) => xpToNext(l))).toEqual([100, 125, 244]);
    expect(xpToNext(5, 'gentle')).toBeLessThan(xpToNext(5));
    expect(xpToNext(5, 'steep')).toBeGreaterThan(xpToNext(5));
  });

  it('without a class, a level gives +1 to every stat (as before) plus stat and skill points', () => {
    let s = hero();
    const before = { ...s.player.stats };
    s = ok(s, { type: 'xp.add', amount: 100 });
    expect(s.player.level).toBe(2);
    expect(s.player.stats.atk).toBe(before.atk + 1);
    expect(s.player.statPoints).toBe(3);
    expect(s.player.skillPoints).toBe(1);
  });

  it('a class shapes growth; stat points go where you choose', () => {
    let s = hero();
    s = ok(s, { type: 'class.set', class: 'Mage' });
    expect(s.player.className).toBe('Mage');
    const mag = s.player.stats.mag;
    const atk = s.player.stats.atk;
    s = ok(s, { type: 'xp.add', amount: 100 });
    expect(s.player.stats.mag).toBe(mag + 3);
    expect(s.player.stats.atk).toBe(atk);
    const hpMax = s.player.bars.hp!.max;
    s = ok(s, { type: 'stats.spend', stat: 'hp', points: 2 });
    expect(s.player.bars.hp!.max).toBe(hpMax + 10);
    expect(err(s, { type: 'stats.spend', stat: 'atk', points: 2 })).toMatch(/Only 1 stat point/);
  });

  it('the skill tree checks class, level, prerequisites and points; ranks raise power', () => {
    let s = hero();
    s = ok(s, { type: 'class.set', class: 'Mage' });
    const nova = builtinSkillNodes('fantasy').find((n) => n.name === 'Frost Nova')!;
    expect(learnProblems(s, { kind: 'player' }, nova)).toEqual(['Needs level 3', 'Learn Firebolt first', 'No skill points']);
    expect(err(s, { type: 'skill.learn', skill: 'Power Strike' })).toMatch(/Warrior skill/);
    s = ok(s, { type: 'xp.add', amount: 100 }); // level 2, 1 point
    s = ok(s, { type: 'skill.learn', skill: 'Firebolt' });
    expect(s.player.skills[`skill_mage_firebolt`]?.power).toBe(16);
    s = ok(s, { type: 'xp.add', amount: 125 }); // level 3
    s = ok(s, { type: 'skill.learn', skill: 'Frost Nova' });
    expect(s.player.skillRanks).toMatchObject({ skill_mage_firebolt: 1, skill_mage_frost_nova: 1 });
    // Rank 2 of Firebolt needs level 1 + 2 = 3 and a point.
    s = ok(s, { type: 'xp.add', amount: 157 });
    s = ok(s, { type: 'skill.learn', skill: 'Firebolt' });
    expect(s.player.skills.skill_mage_firebolt?.power).toBe(powerAt({ power: 16 }, 2));
  });

  it('custom classes and skills with item and quest requirements', () => {
    let s = hero();
    s = many(s, [
      { type: 'class.define', name: 'Bard', growth: { mag: 1, spd: 2 }, hpPerLevel: 8 },
      { type: 'class.set', class: 'Bard' },
      { type: 'skillnode.add', name: 'Lullaby', class: 'Bard', kind: 'debuff', element: 'sound', target: 'all', item: 'Lute', quest: 'Find the Lute' },
      { type: 'xp.add', amount: 100 },
    ]);
    expect(err(s, { type: 'skill.learn', skill: 'Lullaby' })).toBe('Needs Lute; Finish "Find the Lute"');
    s = many(s, [{ type: 'item.add', name: 'Lute' }, { type: 'quest.add', title: 'Find the Lute' }, { type: 'quest.update', title: 'Find the Lute', status: 'done' }]);
    s = ok(s, { type: 'skill.learn', skill: 'Lullaby' });
    expect(Object.values(s.player.skills).map((k) => k.name)).toContain('Lullaby');
  });

  it('XP sources: quests and new places reward on their own and can be switched off', () => {
    let s = hero();
    s = many(s, [
      { type: 'location.upsert', name: 'Vale', level: 'region', kind: 'region' },
      { type: 'location.upsert', name: 'Ashford', level: 'local', kind: 'town', parent: 'Vale', x: 100, y: 100 },
      { type: 'location.upsert', name: 'Brook', level: 'local', kind: 'village', parent: 'Vale', x: 120, y: 100 },
      { type: 'location.move', to: 'Ashford' },
    ]);
    const xp0 = s.player.bars.xp!.cur;
    s = ok(s, { type: 'travel', to: 'Brook', mode: 'walk' });
    expect(s.player.bars.xp!.cur - xp0).toBe(10);
    s = ok(s, { type: 'travel', to: 'Ashford', mode: 'walk' }); // Ashford already visited
    expect(s.player.bars.xp!.cur - xp0).toBe(10);
    s = many(s, [{ type: 'quest.add', title: 'Help' }, { type: 'quest.update', title: 'Help', status: 'done' }]);
    expect(s.player.bars.xp!.cur - xp0).toBe(10 + 40);
    s = many(s, [{ type: 'party.meta', xpSources: { quests: false } }, { type: 'quest.add', title: 'Again' }, { type: 'quest.update', title: 'Again', status: 'done' }]);
    expect(s.player.bars.xp!.cur - xp0).toBe(50);
  });

  it('party: leader, formation limits and tactics', () => {
    let s = hero();
    s = many(s, [{ type: 'party.meta', maxActive: 2 }, ...['Iris', 'Tobias', 'Wren'].map((name) => ({ type: 'party.add', name }))]);
    const act = Object.values(s.party).map((m) => [m.name, m.active]);
    expect(act).toEqual([['Iris', true], ['Tobias', true], ['Wren', false]]);
    expect(err(s, { type: 'party.formation', name: 'Wren', active: true })).toMatch(/Only 2 can be active/);
    expect(err(s, { type: 'party.leader', name: 'Wren' })).toMatch(/in the reserve/);
    s = many(s, [{ type: 'party.leader', name: 'Iris' }, { type: 'party.formation', name: 'Iris', active: false }]);
    expect(s.partyMeta.leader).toBe('player');
    s = many(s, [{ type: 'party.formation', name: 'Tobias', row: 'back' }, { type: 'party.tactics', name: 'Tobias', roleKind: 'healer', preset: 'heal-first' }, { type: 'party.vital', name: 'Tobias', label: 'Sanity', max: 50 }]);
    expect(s.party.pm_tobias).toMatchObject({ row: 'back', roleKind: 'healer', tactics: { preset: 'heal-first' }, vitals: { sanity: { label: 'Sanity', cur: 50, max: 50 } } });
  });
});

describe('battle', () => {
  const tanky = (extra: object = {}) => ({ name: 'Golem', level: 3, hp: 5000, atk: 1, def: 0, spd: 1, ...extra });

  it('enemy intents are declared a turn ahead and carried out on that target', () => {
    let s = hero();
    s = ok(s, { type: 'battle.start', enemies: [tanky({ atk: 8 })] });
    const golem = Object.values(s.battle!.combatants).find((c) => c.side === 'enemy')!;
    expect(golem.intent?.label).toMatch(/→ Anala/);
    const hp = s.battle!.combatants.player!.hp;
    s = ok(s, { type: 'battle.action', action: 'defend' });
    const hitMe = s.battle!.log.some((l) => /Golem's (attack|heavy strike).*Anala/.test(l.text));
    expect(hitMe || s.battle!.combatants.player!.hp === hp).toBe(true);
    // Replaying gives the same intents and log.
    const again = ok(ok(hero(), { type: 'battle.start', enemies: [tanky({ atk: 8 })] }), { type: 'battle.action', action: 'defend' });
    expect(again.battle).toEqual(s.battle);
  });

  it('weakness hits break the gauge; a broken foe skips turns and takes more damage', () => {
    let s = hero();
    s.player.skills.fire = { id: 'fire', name: 'Firebolt', desc: '', kind: 'attack', cost: 0, costType: 'none', power: 12 };
    s.skillTree.fire = { ...builtinSkillNodes('fantasy').find((n) => n.name === 'Firebolt')!, id: 'fire', classId: null, costType: 'none', cost: 0 };
    s = ok(s, { type: 'battle.start', enemies: [tanky({ weaknesses: ['fire'], level: 1 })] });
    const id = Object.keys(s.battle!.combatants).find((k) => k.startsWith('enemy_'))!;
    expect(s.battle!.combatants[id]!.breakMax).toBe(3);
    for (let i = 0; i < 6 && !(s.battle!.combatants[id]!.brokenTurns ?? 0); i++) s = ok(s, { type: 'battle.action', action: 'skill', skill: 'fire', target: id });
    expect(s.battle!.log.some((l) => l.text === 'Golem is broken!')).toBe(true);
    expect(s.battle!.log.some((l) => l.text.includes('(weak point)'))).toBe(true);
    s = ok(s, { type: 'battle.action', action: 'defend' });
    expect(s.battle!.log.some((l) => l.text === 'Golem is reeling.')).toBe(true);
  });

  it('target types: all hits every foe, row hits one row', () => {
    let s = hero();
    s.player.skills.nova = { id: 'nova', name: 'Frost Nova', desc: '', kind: 'attack', cost: 0, costType: 'none', power: 10 };
    s.skillTree.nova = { ...builtinSkillNodes('fantasy').find((n) => n.name === 'Frost Nova')!, id: 'nova', classId: null };
    s.player.skills.cleave = { id: 'cleave', name: 'Cleave', desc: '', kind: 'attack', cost: 0, costType: 'none', power: 10 };
    s.skillTree.cleave = { ...builtinSkillNodes('fantasy').find((n) => n.name === 'Cleave')!, id: 'cleave', classId: null };
    s = ok(s, { type: 'battle.start', enemies: [tanky({ name: 'Front', count: 2 }), tanky({ name: 'Archer', row: 'back' })] });
    const hitNames = (from: number) => new Set(s.battle!.log.slice(from).filter((l) => /Anala's .* hits/.test(l.text)).map((l) => l.text.match(/hits (.+?)(?: \(weak point\))? for/)![1]));
    let n = s.battle!.log.length;
    s = ok(s, { type: 'battle.action', action: 'skill', skill: 'nova' });
    expect(hitNames(n).size).toBeGreaterThanOrEqual(2); // misses are possible, but not on all three
    n = s.battle!.log.length;
    const archer = Object.values(s.battle!.combatants).find((c) => c.name === 'Archer')!.id;
    s = ok(s, { type: 'battle.action', action: 'skill', skill: 'cleave', target: archer });
    expect([...hitNames(n)].every((x) => x === 'Archer')).toBe(true);
  });

  it('the back row takes less physical damage', () => {
    const hitOn = (row: 'front' | 'back') => {
      let s = hero();
      s = many(s, [{ type: 'party.add', name: 'Iris' }, { type: 'party.formation', name: 'Iris', row }]);
      s.party.pm_iris!.stats.spd = 0;
      s.party.pm_iris!.hp = s.party.pm_iris!.maxHp = 5000;
      s.player.bars.hp!.cur = s.player.bars.hp!.max = 5000;
      s = ok(s, { type: 'battle.start', enemies: [tanky({ atk: 30 })] });
      for (let i = 0; i < 12 && s.battle!.status === 'active'; i++) s = ok(s, { type: 'battle.action', action: 'defend' });
      return s.battle!.combatants.ally_pm_iris!.taken ?? 0;
    };
    // Same seed and same rolls; only the row differs. Enemies prefer the front row too.
    expect(hitOn('back')).toBeLessThan(hitOn('front'));
  });

  it('a reserve swap costs your turn and takes the outgoing ally’s place', () => {
    let s = hero();
    s = many(s, [{ type: 'party.meta', maxActive: 1 }, { type: 'party.add', name: 'Iris' }, { type: 'party.add', name: 'Wren' }]);
    s = ok(s, { type: 'battle.start', enemies: [tanky()] });
    const b0 = s.battle!;
    expect(b0.combatants.ally_pm_wren!.reserve).toBe(true);
    expect(b0.order).not.toContain('ally_pm_wren');
    expect(err(s, { type: 'battle.action', action: 'swap', target: 'ally_pm_iris' })).toMatch(/from the reserve/);
    const round = b0.round;
    s = ok(s, { type: 'battle.action', action: 'swap', target: 'ally_pm_wren' });
    const b = s.battle!;
    expect(b.combatants.ally_pm_iris!.reserve).toBe(true);
    expect(b.combatants.ally_pm_wren!.reserve).toBe(false);
    expect(b.order).toContain('ally_pm_wren');
    expect(b.order).not.toContain('ally_pm_iris');
    expect(b.log.some((l) => l.text === 'Wren swaps in for Iris.')).toBe(true);
    expect(b.round).toBe(round + 1); // the turn passed
  });

  it('tactics: a heal-first ally heals the hurt player', () => {
    let s = hero();
    s = many(s, [{ type: 'party.add', name: 'Iris' }, { type: 'party.tactics', name: 'Iris', preset: 'heal-first' }]);
    s.player.bars.hp!.cur = 20;
    s = ok(s, { type: 'battle.start', enemies: [tanky()] });
    s = ok(s, { type: 'battle.action', action: 'defend' });
    expect(s.battle!.log.some((l) => /Iris's first aid restores \d+ HP to Anala/.test(l.text))).toBe(true);
  });

  it('results persist: summary, shared XP, knock-outs, and sleep clears them', () => {
    let s = hero();
    s = many(s, [{ type: 'party.add', name: 'Iris', level: 1 }]);
    s.party.pm_iris!.hp = 1;
    s = ok(s, { type: 'battle.start', enemies: [{ name: 'Rat', level: 1, hp: 30, atk: 30, spd: 30 }] });
    for (let i = 0; i < 40 && s.battle?.status === 'active'; i++) s = ok(s, { type: 'battle.action', action: 'attack' });
    const b = s.battle!;
    expect(b.summary).toBeTruthy();
    expect(b.summary!.rounds).toBe(b.round);
    if (b.status === 'won') {
      expect(s.party.pm_iris!.xp! + (s.party.pm_iris!.level - 1) * 100).toBeGreaterThan(0);
      expect(b.summary!.dealt).toBeGreaterThan(0);
    }
    if (!b.combatants.ally_pm_iris!.alive) {
      expect(s.party.pm_iris!.injuries).toContain('Knocked out');
      expect(s.party.pm_iris!.hp).toBe(1);
      s = ok(ok(s, { type: 'battle.end' }), { type: 'activity', kind: 'sleep' });
      expect(s.party.pm_iris!.injuries).not.toContain('Knocked out');
      expect(s.party.pm_iris!.hp).toBe(s.party.pm_iris!.maxHp);
    }
  });
});

describe('rollback', () => {
  it('every progression and battle op is undone exactly by its inverse', () => {
    const s0 = many(hero(), [{ type: 'party.add', name: 'Iris' }, { type: 'party.add', name: 'Wren' }, { type: 'party.meta', maxActive: 1 }, { type: 'party.formation', name: 'Wren', active: false }]);
    const ops: unknown[] = [
      { type: 'party.meta', curve: 'gentle', xpSources: { discovery: false } },
      { type: 'class.define', name: 'Bard', growth: { mag: 1 } },
      { type: 'class.set', class: 'Warrior' },
      { type: 'class.set', who: 'Iris', class: 'Cleric' },
      { type: 'xp.add', amount: 300 },
      { type: 'skill.learn', skill: 'Power Strike' },
      { type: 'stats.spend', stat: 'atk', points: 2 },
      { type: 'party.leader', name: 'Iris' },
      { type: 'party.formation', name: 'Iris', row: 'back' },
      { type: 'party.tactics', name: 'Iris', roleKind: 'healer', rules: [{ when: 'allyHpBelow', value: 60, do: 'heal' }] },
      { type: 'party.vital', name: 'Iris', label: 'Faith', max: 20 },
      { type: 'party.injury', name: 'Iris', injury: 'Sprained wrist' },
      { type: 'skillnode.add', name: 'Shout', class: 'Warrior', kind: 'buff', target: 'allies' },
      { type: 'battle.start', enemies: [{ name: 'Wolf', level: 1, count: 2, weaknesses: ['fire'] }] },
      { type: 'battle.action', action: 'swap', target: 'ally_pm_wren' },
      { type: 'battle.action', action: 'attack' },
      { type: 'battle.end' },
    ];
    const r = applyOps(s0, ops.map(v), { source: 'user' });
    expect(r.errors).toEqual([]);
    expect(invertOps(r.state, r.inverses)).toEqual(s0);
  });
});
