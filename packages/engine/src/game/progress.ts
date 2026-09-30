/**
 * Progression: classes, a skill tree with unlock requirements, level curves, XP sources, stat and
 * skill points, and level-ups for the player and party members. All numbers are decided here.
 */
import { slugify } from '../util/text.js';
import type { CampaignState, ClassDef, LevelCurve, PartyMember, Skill, SkillNode, Stats, Style, TargetKind, XpSource } from './state.js';

export const CURVES: Record<LevelCurve, { label: string; base: number; growth: number }> = {
  gentle: { label: 'Gentle', base: 80, growth: 1.15 },
  standard: { label: 'Standard', base: 100, growth: 1.25 },
  steep: { label: 'Steep', base: 120, growth: 1.4 },
};

/** XP needed to go from `level` to the next. The standard curve matches the Phase 1 formula. */
export function xpToNext(level: number, curve: LevelCurve = 'standard'): number {
  const c = CURVES[curve] ?? CURVES.standard;
  return Math.round(c.base * Math.pow(c.growth, Math.max(0, level - 1)));
}

export const curveOf = (s: CampaignState): LevelCurve => s.partyMeta?.curve ?? 'standard';
export const xpSourceOn = (s: CampaignState, src: XpSource) => s.partyMeta?.xpSources?.[src] !== false;

export const DISCOVERY_XP = 10;
/** Finishing a quest: 30 + 10 per player level. */
export const questXp = (s: CampaignState) => 30 + 10 * s.player.level;
export const STAT_POINTS_PER_LEVEL = 3;
export const SKILL_POINTS_PER_LEVEL = 1;
export const STAT_KEYS: Array<keyof Stats> = ['atk', 'def', 'spd', 'mag'];

// ------------------------------------------------------------------ classes and skills

type ClassSeed = [name: string, desc: string, growth: Partial<Stats>, hp: number, mp: number, skills: NodeSeed[]];
/** name, kind, cost, costType, power, element, target, level, requires (index in this list) */
type NodeSeed = [string, Skill['kind'], number, Skill['costType'], number, string | null, TargetKind, number, number?];

const TREES: Record<Style, ClassSeed[]> = {
  fantasy: [
    ['Warrior', 'Front-line fighter who soaks up blows.', { atk: 2, def: 2 }, 14, 2, [
      ['Power Strike', 'attack', 10, 'ap', 16, null, 'single', 1],
      ['Cleave', 'attack', 20, 'ap', 12, null, 'row', 3, 0],
      ['Battle Cry', 'buff', 15, 'ap', 0, null, 'allies', 5, 0],
      ['Earthsplitter', 'attack', 35, 'ap', 22, 'earth', 'all', 8, 1],
    ]],
    ['Mage', 'Elemental caster; fragile but devastating.', { mag: 3 }, 6, 10, [
      ['Firebolt', 'attack', 8, 'mp', 16, 'fire', 'single', 1],
      ['Frost Nova', 'attack', 16, 'mp', 11, 'ice', 'all', 3, 0],
      ['Chain Lightning', 'attack', 20, 'mp', 13, 'lightning', 'random', 5, 0],
      ['Meteor', 'attack', 40, 'mp', 24, 'fire', 'all', 9, 1],
    ]],
    ['Rogue', 'Quick striker who exploits openings.', { spd: 2, atk: 1 }, 9, 4, [
      ['Backstab', 'attack', 10, 'ap', 18, null, 'single', 1],
      ['Poison Blade', 'debuff', 12, 'ap', 0, 'poison', 'single', 3, 0],
      ['Smoke Bomb', 'buff', 15, 'ap', 0, null, 'self', 5],
      ['Flurry', 'attack', 30, 'ap', 9, null, 'random', 7, 0],
    ]],
    ['Cleric', 'Healer and protector.', { mag: 2, def: 1 }, 10, 8, [
      ['Mend', 'heal', 8, 'mp', 22, 'holy', 'ally', 1],
      ['Smite', 'attack', 10, 'mp', 14, 'holy', 'single', 2],
      ['Prayer', 'heal', 20, 'mp', 16, 'holy', 'allies', 4, 0],
      ['Sanctuary', 'buff', 25, 'mp', 0, 'holy', 'allies', 7, 2],
    ]],
    ['Ranger', 'Archer and tracker; strikes from the back row.', { spd: 1, atk: 2 }, 10, 4, [
      ['Aimed Shot', 'attack', 10, 'ap', 17, null, 'single', 1],
      ['Volley', 'attack', 20, 'ap', 10, null, 'all', 3, 0],
      ['Hunter’s Mark', 'debuff', 10, 'ap', 0, null, 'single', 4],
      ['Piercing Arrow', 'attack', 25, 'ap', 22, 'wind', 'row', 6, 0],
    ]],
  ],
  modern: [
    ['Bruiser', 'Takes hits, hits back harder.', { atk: 2, def: 2 }, 14, 2, [
      ['Haymaker', 'attack', 10, 'ap', 16, null, 'single', 1],
      ['Tackle', 'attack', 15, 'ap', 12, null, 'row', 3, 0],
      ['Second Wind', 'heal', 20, 'ap', 18, null, 'self', 5],
    ]],
    ['Hacker', 'Turns the enemy’s tech against them.', { mag: 3 }, 7, 10, [
      ['Overload', 'attack', 8, 'mp', 15, 'electric', 'single', 1],
      ['Blackout', 'debuff', 14, 'mp', 0, 'electric', 'all', 3, 0],
      ['Cascade Failure', 'attack', 25, 'mp', 14, 'electric', 'all', 6, 0],
    ]],
    ['Medic', 'Keeps everyone standing.', { mag: 2, def: 1 }, 10, 8, [
      ['Patch Up', 'heal', 8, 'mp', 22, null, 'ally', 1],
      ['Stim Shot', 'buff', 12, 'mp', 0, null, 'ally', 3],
      ['Triage', 'heal', 20, 'mp', 16, null, 'allies', 5, 0],
    ]],
    ['Marksman', 'Precise at range.', { spd: 1, atk: 2 }, 10, 4, [
      ['Headshot', 'attack', 12, 'ap', 19, null, 'single', 1],
      ['Suppressing Fire', 'attack', 20, 'ap', 9, null, 'all', 3, 0],
      ['Incendiary Round', 'attack', 18, 'ap', 16, 'fire', 'single', 5, 0],
    ]],
  ],
  scifi: [
    ['Soldier', 'Armored front line.', { atk: 2, def: 2 }, 14, 2, [
      ['Rifle Burst', 'attack', 10, 'ap', 15, null, 'single', 1],
      ['Grenade', 'attack', 20, 'ap', 12, 'fire', 'row', 3, 0],
      ['Shield Wall', 'buff', 15, 'ap', 0, null, 'allies', 5],
    ]],
    ['Psion', 'Bends minds and matter.', { mag: 3 }, 6, 10, [
      ['Mind Spike', 'attack', 8, 'mp', 16, 'psychic', 'single', 1],
      ['Kinetic Wave', 'attack', 16, 'mp', 11, 'kinetic', 'all', 3, 0],
      ['Dominate', 'debuff', 20, 'mp', 0, 'psychic', 'single', 6, 0],
    ]],
    ['Engineer', 'Drones, turrets and repairs.', { mag: 1, def: 1, spd: 1 }, 10, 8, [
      ['Arc Welder', 'attack', 8, 'mp', 14, 'electric', 'single', 1],
      ['Repair Drone', 'heal', 12, 'mp', 18, null, 'ally', 2],
      ['EMP', 'attack', 22, 'mp', 12, 'electric', 'all', 5, 0],
    ]],
  ],
};

export function builtinClasses(style: Style): ClassDef[] {
  return (TREES[style] ?? TREES.fantasy).map(([name, desc, growth, hp, mp]) => ({ id: `class_${slugify(name)}`, name, desc, growth, hpPerLevel: hp, mpPerLevel: mp, builtin: true }));
}

export function builtinSkillNodes(style: Style): SkillNode[] {
  return (TREES[style] ?? TREES.fantasy).flatMap(([cls, , , , , seeds]) => {
    const classId = `class_${slugify(cls)}`;
    const ids = seeds.map((n) => `skill_${slugify(cls)}_${slugify(n[0])}`);
    return seeds.map(([name, kind, cost, costType, power, element, target, level, req], i): SkillNode => ({
      id: ids[i]!,
      name,
      desc: '',
      classId,
      kind,
      cost,
      costType,
      power,
      element,
      target,
      maxRank: kind === 'buff' || kind === 'debuff' ? 1 : 3,
      requires: { level, ...(req !== undefined ? { skills: [ids[req]!] } : {}) },
      source: 'builtin',
    }));
  });
}

export const allClasses = (s: CampaignState): ClassDef[] => [...builtinClasses(s.meta.style), ...Object.values(s.classes ?? {})];
export const allSkillNodes = (s: CampaignState): SkillNode[] => [...builtinSkillNodes(s.meta.style), ...Object.values(s.skillTree ?? {})];
export const findClass = (s: CampaignState, idOrName: string) => allClasses(s).find((c) => c.id === idOrName || c.name.toLowerCase() === idOrName.toLowerCase());
export const findNode = (s: CampaignState, idOrName: string) => allSkillNodes(s).find((n) => n.id === idOrName || n.name.toLowerCase() === idOrName.toLowerCase());

// ------------------------------------------------------------------ who

export type Who = { kind: 'player' } | { kind: 'member'; m: PartyMember };

export function whoLevel(s: CampaignState, w: Who) {
  return w.kind === 'player' ? s.player.level : w.m.level;
}
function ranksOf(s: CampaignState, w: Who): Record<string, number> {
  if (w.kind === 'player') return (s.player.skillRanks ??= {});
  return (w.m.skillRanks ??= {});
}
export const rankOf = (s: CampaignState, w: Who, nodeId: string) => (w.kind === 'player' ? s.player.skillRanks?.[nodeId] : w.m.skillRanks?.[nodeId]) ?? 0;
const classIdOf = (s: CampaignState, w: Who) => (w.kind === 'player' ? s.player.classId : w.m.classId) ?? null;

/** Why a skill can't be learned or ranked up yet (empty when it can). */
export function learnProblems(s: CampaignState, w: Who, node: SkillNode): string[] {
  const out: string[] = [];
  const rank = rankOf(s, w, node.id);
  if (rank >= node.maxRank) return ['Already at the highest rank'];
  const cls = classIdOf(s, w);
  if (node.classId && node.classId !== cls) out.push(`${findClass(s, node.classId)?.name ?? 'Another class'} skill`);
  const lvl = whoLevel(s, w);
  const needLevel = (node.requires.level ?? 1) + rank * 2;
  if (lvl < needLevel) out.push(`Needs level ${needLevel}`);
  for (const req of node.requires.skills ?? []) {
    if (rankOf(s, w, req) < 1) out.push(`Learn ${findNode(s, req)?.name ?? req} first`);
  }
  if (node.requires.item) {
    const n = node.requires.item.toLowerCase();
    if (!Object.values(s.inventory).some((i) => !i.holder && i.name.toLowerCase().includes(n))) out.push(`Needs ${node.requires.item}`);
  }
  if (node.requires.quest) {
    const q = Object.values(s.quests).find((x) => x.title.toLowerCase() === node.requires.quest!.toLowerCase());
    if (q?.status !== 'done') out.push(`Finish "${node.requires.quest}"`);
  }
  const pts = w.kind === 'player' ? (s.player.skillPoints ?? 0) : (w.m.skillPoints ?? 0);
  if (pts < 1) out.push('No skill points');
  return out;
}

/** Power at a rank: +25% per rank above the first. */
export const powerAt = (node: Pick<SkillNode, 'power'>, rank: number) => Math.round(node.power * (1 + 0.25 * Math.max(0, rank - 1)));

/** Learn a node or rank it up. Returns the new rank. Caller checks learnProblems first. */
export function learn(s: CampaignState, w: Who, node: SkillNode): number {
  const ranks = ranksOf(s, w);
  const rank = (ranks[node.id] ?? 0) + 1;
  ranks[node.id] = rank;
  if (w.kind === 'player') {
    s.player.skillPoints = (s.player.skillPoints ?? 0) - 1;
    s.player.skills[node.id] = { id: node.id, name: node.name, desc: node.desc, kind: node.kind, cost: node.cost, costType: node.costType, power: powerAt(node, rank) };
  } else {
    w.m.skillPoints = (w.m.skillPoints ?? 0) - 1;
    if (!w.m.skills.includes(node.id)) w.m.skills.push(node.id);
  }
  return rank;
}

// ------------------------------------------------------------------ levels

export interface LevelUp {
  who: string;
  level: number;
  gains: Partial<Record<keyof Stats | 'hp' | 'mp', number>>;
}

/** Apply one level's growth to the player. Without a class, +1 to every stat (the Phase 1 rule). */
export function levelUpPlayer(s: CampaignState): LevelUp {
  const p = s.player;
  p.level += 1;
  const cls = p.classId ? findClass(s, p.classId) : null;
  const gains: LevelUp['gains'] = {};
  for (const k of STAT_KEYS) {
    const g = cls ? (cls.growth[k] ?? 0) : 1;
    if (g) {
      p.stats[k] += g;
      gains[k] = g;
    }
  }
  for (const bar of Object.values(p.bars)) {
    if (bar.id === 'xp') continue;
    const inc = bar.id === 'hp' ? (cls?.hpPerLevel ?? 10) : bar.id === 'mp' ? (cls?.mpPerLevel ?? 5) : 5;
    bar.max += inc;
    bar.cur = bar.max;
    if (bar.id === 'hp' || bar.id === 'mp') gains[bar.id] = inc;
  }
  p.statPoints = (p.statPoints ?? 0) + STAT_POINTS_PER_LEVEL;
  p.skillPoints = (p.skillPoints ?? 0) + SKILL_POINTS_PER_LEVEL;
  return { who: p.name || 'You', level: p.level, gains };
}

/** Give a party member XP and apply their level-ups. */
export function addMemberXp(s: CampaignState, m: PartyMember, amount: number): LevelUp[] {
  const ups: LevelUp[] = [];
  m.xp = (m.xp ?? 0) + Math.round(amount);
  let guard = 0;
  while (m.xp >= xpToNext(m.level, curveOf(s)) && guard++ < 100) {
    m.xp -= xpToNext(m.level, curveOf(s));
    m.level += 1;
    const cls = m.classId ? findClass(s, m.classId) : null;
    const gains: LevelUp['gains'] = {};
    for (const k of STAT_KEYS) {
      const g = cls ? (cls.growth[k] ?? 0) : 1;
      if (g) {
        m.stats[k] += g;
        gains[k] = g;
      }
    }
    const hp = cls?.hpPerLevel ?? 10;
    const mp = cls?.mpPerLevel ?? 5;
    m.maxHp += hp;
    m.maxMp += mp;
    m.hp = m.maxHp;
    m.mp = m.maxMp;
    gains.hp = hp;
    gains.mp = mp;
    m.statPoints = (m.statPoints ?? 0) + STAT_POINTS_PER_LEVEL;
    m.skillPoints = (m.skillPoints ?? 0) + SKILL_POINTS_PER_LEVEL;
    ups.push({ who: m.name, level: m.level, gains });
  }
  return ups;
}

/** Skills that just became learnable at this level (for the level-up moment). */
export function newlyAvailable(s: CampaignState, w: Who): SkillNode[] {
  const lvl = whoLevel(s, w);
  const cls = classIdOf(s, w);
  return allSkillNodes(s).filter((n) => (!n.classId || n.classId === cls) && (n.requires.level ?? 1) === lvl && rankOf(s, w, n.id) === 0);
}
