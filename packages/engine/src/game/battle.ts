/**
 * Deterministic turn-based battle. All randomness comes from the battle seed and turn counters.
 * Phase 3 adds rows (the back row takes less physical damage), a leader (initiative), break gauges
 * (weakness hits and crits drain them; a broken foe loses turns and takes more damage), enemy
 * intents declared a turn ahead, skill target types, tactics for allies and reserve swaps.
 */
import { clamp } from '../util/clamp.js';
import { createRng, seedFrom, type Rng } from '../util/rng.js';
import { slugify } from '../util/text.js';
import { findNode, powerAt } from './progress.js';
import type { Battle, CampaignState, Combatant, PartyMember, SkillNode, Stats, TacticRule, Tactics, TargetKind } from './state.js';

export interface EnemySpec {
  name: string;
  level?: number;
  hp?: number;
  atk?: number;
  def?: number;
  spd?: number;
  mag?: number;
  count?: number;
  weaknesses?: string[];
  row?: 'front' | 'back';
}

export const TACTIC_PRESETS: Record<Tactics['preset'], TacticRule[]> = {
  balanced: [
    { when: 'allyHpBelow', value: 35, do: 'heal' },
    { when: 'enemyBroken', value: 0, do: 'attackWeakest' },
    { when: 'always', value: 0, do: 'attackWeakest' },
  ],
  aggressive: [
    { when: 'enemyBroken', value: 0, do: 'attackWeakest' },
    { when: 'always', value: 0, do: 'skill' },
  ],
  defensive: [
    { when: 'selfHpBelow', value: 40, do: 'defend' },
    { when: 'allyHpBelow', value: 50, do: 'heal' },
    { when: 'always', value: 0, do: 'attackWeakest' },
  ],
  'heal-first': [
    { when: 'allyHpBelow', value: 70, do: 'heal' },
    { when: 'always', value: 0, do: 'attackWeakest' },
  ],
  conserve: [
    { when: 'allyHpBelow', value: 25, do: 'heal' },
    { when: 'always', value: 0, do: 'attackWeakest' },
  ],
};

function rngFor(b: Battle): Rng {
  return createRng(seedFrom(b.seed, b.round, b.turnIndex, b.log.length));
}

function effectiveStats(c: Combatant): Stats {
  let atkMul = 1;
  let defMul = 1;
  for (const st of c.statuses) {
    if (st.name === 'Empowered') atkMul += 0.25;
    if (st.name === 'Weakened') atkMul -= 0.25;
    if (st.name === 'Shielded') defMul += 0.5;
    if (st.name === 'Exposed') defMul -= 0.3;
  }
  return { atk: c.stats.atk * atkMul, def: c.stats.def * defMul, spd: c.stats.spd, mag: c.stats.mag };
}

function memberCombatant(m: PartyMember): Combatant {
  return {
    id: `ally_${m.id}`,
    name: m.name,
    side: 'party',
    hp: m.hp,
    maxHp: m.maxHp,
    mp: m.mp,
    maxMp: m.maxMp,
    ap: 50,
    maxAp: 50,
    stats: { ...m.stats },
    statuses: [],
    defending: false,
    alive: m.hp > 0,
    isPlayer: false,
    skills: [...m.skills],
    row: m.row ?? 'front',
    reserve: m.active === false,
    memberId: m.id,
    dealt: 0,
    taken: 0,
  };
}

export function startBattle(s: CampaignState, enemies: EnemySpec[], seed: number): Battle {
  const combatants: Record<string, Combatant> = {};
  const p = s.player;
  combatants.player = {
    id: 'player',
    name: p.name,
    side: 'party',
    hp: p.bars.hp?.cur ?? 100,
    maxHp: p.bars.hp?.max ?? 100,
    mp: p.bars.mp?.cur ?? 0,
    maxMp: p.bars.mp?.max ?? 0,
    ap: p.bars.ap?.cur ?? 0,
    maxAp: p.bars.ap?.max ?? 0,
    stats: equippedStats(s),
    statuses: [],
    defending: false,
    alive: (p.bars.hp?.cur ?? 100) > 0,
    isPlayer: true,
    skills: Object.values(p.skills).map((sk) => sk.id),
    row: 'front',
    dealt: 0,
    taken: 0,
  };
  for (const m of Object.values(s.party)) combatants[`ally_${m.id}`] = memberCombatant(m);
  let n = 0;
  for (const e of enemies) {
    const count = Math.max(1, Math.min(8, e.count ?? 1));
    for (let i = 0; i < count && n < 8; i++, n++) {
      const lvl = Math.max(1, e.level ?? p.level);
      const hp = Math.round(e.hp ?? 30 + lvl * 18);
      const id = `enemy_${slugify(e.name)}_${n + 1}`;
      const brk = 2 + Math.ceil(lvl / 3);
      combatants[id] = {
        id,
        name: count > 1 ? `${e.name} ${String.fromCharCode(65 + i)}` : e.name,
        side: 'enemy',
        hp,
        maxHp: hp,
        mp: 20 + lvl * 5,
        maxMp: 20 + lvl * 5,
        ap: 50,
        maxAp: 50,
        stats: { atk: e.atk ?? 6 + lvl * 2.5, def: e.def ?? 3 + lvl * 1.5, spd: e.spd ?? 8 + lvl, mag: e.mag ?? 4 + lvl * 2 },
        statuses: [],
        defending: false,
        alive: true,
        isPlayer: false,
        skills: [],
        row: e.row ?? 'front',
        breakMax: brk,
        breakCur: brk,
        brokenTurns: 0,
        weaknesses: (e.weaknesses ?? []).map((w) => w.toLowerCase()),
        intent: null,
        dealt: 0,
        taken: 0,
      };
    }
  }
  const leader = s.partyMeta?.leader && s.partyMeta.leader !== 'player' && combatants[`ally_${s.partyMeta.leader}`] ? `ally_${s.partyMeta.leader}` : 'player';
  const rng = createRng(seedFrom(seed, 'initiative'));
  const order = Object.values(combatants)
    .filter((c) => !c.reserve)
    .map((c) => ({ id: c.id, init: c.stats.spd + rng.int(1, 6) + (c.isPlayer ? 0.5 : 0) + (c.id === leader ? 3 : 0) }))
    .sort((a, b) => b.init - a.init || a.id.localeCompare(b.id))
    .map((x) => x.id);
  const battle: Battle = {
    id: `battle_${seed}`,
    seed,
    round: 1,
    turnIndex: 0,
    order,
    combatants,
    log: [{ round: 1, text: `Battle begins: ${enemies.map((e) => (e.count && e.count > 1 ? `${e.count}× ${e.name}` : e.name)).join(', ')}.`, kind: 'info' }],
    status: 'active',
    rewards: null,
    startedAt: s.time.minutes,
    leader,
    summary: null,
  };
  for (const c of Object.values(combatants)) if (c.side === 'enemy') planIntent(battle, c);
  runAutoTurns(s, battle);
  return battle;
}

export function equippedStats(s: CampaignState): Stats {
  const base = { ...s.player.stats };
  for (const it of Object.values(s.inventory)) {
    if (!it.equipped || it.holder) continue;
    base.atk += it.stats.atk ?? 0;
    base.def += it.stats.def ?? 0;
    base.spd += it.stats.spd ?? 0;
    base.mag += it.stats.mag ?? 0;
  }
  return base;
}

export function currentActor(b: Battle): Combatant | undefined {
  return b.combatants[b.order[b.turnIndex]!];
}

/** Living combatants on a side who are in the fight (not in reserve). */
function living(b: Battle, side: 'party' | 'enemy') {
  return Object.values(b.combatants).filter((c) => c.side === side && c.alive && !c.reserve);
}

function checkEnd(b: Battle): boolean {
  let over = false;
  if (!living(b, 'enemy').length) {
    b.status = 'won';
    b.log.push({ round: b.round, text: 'Victory.', kind: 'info' });
    over = true;
  } else {
    const player = b.combatants.player;
    if (!living(b, 'party').length || (player && !player.alive)) {
      b.status = 'lost';
      b.log.push({ round: b.round, text: 'Defeat.', kind: 'defeat' });
      over = true;
    }
  }
  if (over) b.summary = summarize(b);
  return over;
}

export function summarize(b: Battle) {
  const ours = Object.values(b.combatants).filter((c) => c.side === 'party');
  const mvp = ours.slice().sort((a, c) => (c.dealt ?? 0) - (a.dealt ?? 0))[0];
  return {
    rounds: b.round,
    dealt: ours.reduce((n, c) => n + (c.dealt ?? 0), 0),
    taken: ours.reduce((n, c) => n + (c.taken ?? 0), 0),
    mvp: mvp && (mvp.dealt ?? 0) > 0 ? mvp.name : null,
    breaks: b.log.filter((l) => l.text.endsWith(' is broken!')).length,
    levelUps: [],
    injuries: [],
  };
}

interface HitOpts {
  power: number;
  useMag: boolean;
  label: string;
  element?: string | null;
}

function dealDamage(b: Battle, rng: Rng, actor: Combatant, target: Combatant, o: HitOpts) {
  const a = effectiveStats(actor);
  const t = effectiveStats(target);
  const broken = (target.brokenTurns ?? 0) > 0;
  const missChance = broken ? 0 : clamp(0.06 + (t.spd - a.spd) * 0.006, 0.02, 0.3);
  if (rng.next() < missChance) {
    b.log.push({ round: b.round, text: `${actor.name}'s ${o.label} misses ${target.name}.`, kind: 'miss' });
    return;
  }
  const offense = o.useMag ? a.mag : a.atk;
  let dmg = offense * (o.power / 10) - t.def * 0.5 + rng.int(-2, 2);
  const crit = rng.next() < clamp(0.08 + a.spd * 0.002, 0.05, 0.25);
  const weak = !!o.element && !!target.weaknesses?.includes(o.element.toLowerCase());
  if (crit) dmg *= 1.5;
  if (weak) dmg *= 1.3;
  if (broken) dmg *= 1.5;
  if (!o.useMag && target.row === 'back') dmg *= 0.75;
  if (target.defending) dmg *= 0.5;
  const final = Math.max(1, Math.round(dmg));
  target.hp = Math.max(0, target.hp - final);
  actor.dealt = (actor.dealt ?? 0) + final;
  target.taken = (target.taken ?? 0) + final;
  b.log.push({ round: b.round, text: `${actor.name}'s ${o.label} ${crit ? 'critically ' : ''}hits ${target.name}${weak ? ' (weak point)' : ''} for ${final}.`, kind: crit ? 'crit' : 'hit' });
  // Break gauge: weakness hits and crits wear it down.
  if (target.breakMax && !broken && (weak || crit) && target.hp > 0) {
    target.breakCur = Math.max(0, (target.breakCur ?? target.breakMax) - (weak && crit ? 2 : 1));
    if (target.breakCur === 0) {
      target.brokenTurns = 2;
      target.intent = null;
      b.log.push({ round: b.round, text: `${target.name} is broken!`, kind: 'status' });
    }
  }
  if (target.hp <= 0) {
    target.alive = false;
    target.intent = null;
    b.log.push({ round: b.round, text: `${target.name} is down.`, kind: 'defeat' });
  }
}

function heal(b: Battle, actor: Combatant, target: Combatant, amount: number, label: string) {
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + amount);
  b.log.push({ round: b.round, text: `${label} restores ${target.hp - before} HP to ${target.name}.`, kind: 'heal' });
}

function advanceTurn(b: Battle) {
  for (let i = 0; i < b.order.length; i++) {
    b.turnIndex++;
    if (b.turnIndex >= b.order.length) {
      b.turnIndex = 0;
      b.round++;
      // Tick statuses at round start.
      for (const c of Object.values(b.combatants)) {
        c.statuses = c.statuses.map((st) => ({ ...st, turns: st.turns - 1 })).filter((st) => st.turns > 0);
        if (c.statuses.some((st) => st.name === 'Poisoned') && c.alive) {
          const dmg = Math.max(1, Math.round(c.maxHp * 0.05));
          c.hp = Math.max(0, c.hp - dmg);
          c.taken = (c.taken ?? 0) + dmg;
          b.log.push({ round: b.round, text: `${c.name} takes ${dmg} poison damage.`, kind: 'status' });
          if (c.hp <= 0) c.alive = false;
        }
      }
    }
    const next = currentActor(b);
    if (next?.alive) {
      next.defending = false;
      return;
    }
  }
}

function weakest(foes: Combatant[]) {
  return foes.slice().sort((a, c) => a.hp / a.maxHp - c.hp / c.maxHp || a.id.localeCompare(c.id))[0];
}
function strongest(foes: Combatant[]) {
  return foes.slice().sort((a, c) => c.hp - a.hp || a.id.localeCompare(c.id))[0];
}

/** Enemies prefer the front row, then the weakest. */
function enemyTarget(rng: Rng, foes: Combatant[]): Combatant {
  const front = foes.filter((f) => f.row !== 'back');
  const pool = front.length && rng.next() < 0.8 ? front : foes;
  return rng.next() < 0.6 ? weakest(pool)! : rng.pick(pool);
}

/** Decide (and show) what an enemy will do on its next turn. */
export function planIntent(b: Battle, e: Combatant) {
  if (!e.alive || (e.brokenTurns ?? 0) > 0) {
    e.intent = null;
    return;
  }
  const foes = living(b, 'party');
  if (!foes.length) return;
  const rng = createRng(seedFrom(b.seed, 'intent', e.id, b.round, b.log.length));
  const roll = rng.next();
  if (e.hp < e.maxHp * 0.3 && roll < 0.3) {
    e.intent = { kind: 'defend', target: null, label: 'Bracing' };
    return;
  }
  const target = enemyTarget(rng, foes);
  if (e.ap >= 20 && roll < 0.3) e.intent = { kind: 'heavy', target: target.id, label: `Heavy strike → ${target.name}` };
  else e.intent = { kind: 'attack', target: target.id, label: `Attack → ${target.name}` };
}

function enemyTurn(b: Battle, rng: Rng, actor: Combatant) {
  if ((actor.brokenTurns ?? 0) > 0) {
    actor.brokenTurns = (actor.brokenTurns ?? 1) - 1;
    b.log.push({ round: b.round, text: `${actor.name} is reeling.`, kind: 'status' });
    if (actor.brokenTurns === 0) actor.breakCur = actor.breakMax;
    return;
  }
  const foes = living(b, 'party');
  if (!foes.length) return;
  const intent = actor.intent ?? { kind: 'attack' as const, target: null, label: '' };
  const t = intent.target && b.combatants[intent.target]?.alive && !b.combatants[intent.target]?.reserve ? b.combatants[intent.target]! : enemyTarget(rng, foes);
  if (intent.kind === 'defend') {
    actor.defending = true;
    b.log.push({ round: b.round, text: `${actor.name} braces for impact.`, kind: 'info' });
  } else if (intent.kind === 'heavy' && actor.ap >= 20) {
    actor.ap -= 20;
    dealDamage(b, rng, actor, t, { power: 15, useMag: false, label: 'heavy strike' });
  } else dealDamage(b, rng, actor, t, { power: 10, useMag: false, label: 'attack' });
}

function nodeFor(s: CampaignState, id: string): SkillNode | undefined {
  return findNode(s, id);
}

/** Resolve a skill's targets from its target type and the chosen target. */
export function resolveTargets(b: Battle, rng: Rng, actor: Combatant, kind: TargetKind, chosen?: string): Combatant[] {
  const foeSide = actor.side === 'party' ? 'enemy' : 'party';
  const foes = living(b, foeSide);
  const friends = living(b, actor.side);
  const pick = chosen ? b.combatants[chosen] : undefined;
  switch (kind) {
    case 'self':
      return [actor];
    case 'ally':
      return [pick && pick.side === actor.side && pick.alive && !pick.reserve ? pick : actor];
    case 'allies':
      return friends;
    case 'all':
      return foes;
    case 'row': {
      const row = pick && pick.side === foeSide && pick.alive ? (pick.row ?? 'front') : (foes[0]?.row ?? 'front');
      return foes.filter((f) => (f.row ?? 'front') === row);
    }
    case 'random':
      return foes.length ? [0, 1, 2].map(() => rng.pick(foes)) : [];
    default:
      return [pick && pick.side === foeSide && pick.alive && !pick.reserve ? pick : foes[0]!].filter(Boolean);
  }
}

interface SkillUse {
  name: string;
  kind: SkillNode['kind'];
  power: number;
  costType: SkillNode['costType'];
  cost: number;
  element: string | null;
  target: TargetKind;
}

function useSkill(b: Battle, rng: Rng, actor: Combatant, sk: SkillUse, chosen?: string): string | null {
  const pool = sk.costType === 'mp' ? 'mp' : sk.costType === 'ap' ? 'ap' : null;
  if (pool && actor[pool] < sk.cost) return `Not enough ${pool.toUpperCase()}`;
  const defaultTarget: TargetKind = sk.kind === 'heal' || sk.kind === 'buff' ? (sk.target === 'single' ? 'ally' : sk.target) : sk.target;
  const targets = resolveTargets(b, rng, actor, defaultTarget, chosen);
  if (!targets.length) return 'No target';
  if (pool) actor[pool] -= sk.cost;
  for (const t of targets) {
    if (sk.kind === 'heal') heal(b, actor, t, Math.round(sk.power + actor.stats.mag * 0.8), sk.name);
    else if (sk.kind === 'buff') {
      const name = /shield|sanctuary|wall|guard/i.test(sk.name) ? 'Shielded' : 'Empowered';
      t.statuses.push({ name, turns: 3, kind: 'buff' });
      b.log.push({ round: b.round, text: `${t.name} is ${name.toLowerCase()} by ${sk.name}.`, kind: 'status' });
    } else if (sk.kind === 'debuff') {
      const name = sk.element === 'poison' ? 'Poisoned' : rng.next() < 0.5 ? 'Weakened' : 'Poisoned';
      t.statuses.push({ name, turns: 3, kind: 'debuff' });
      b.log.push({ round: b.round, text: `${sk.name} afflicts ${t.name} (${name.toLowerCase()}).`, kind: 'status' });
    } else if (t.alive) dealDamage(b, rng, actor, t, { power: sk.power, useMag: sk.costType === 'mp', label: sk.name, element: sk.element });
  }
  return null;
}

function tacticsFor(s: CampaignState, c: Combatant): TacticRule[] {
  const m = c.memberId ? s.party[c.memberId] : undefined;
  if (m?.tactics?.rules?.length) return m.tactics.rules;
  return TACTIC_PRESETS[m?.tactics?.preset ?? 'balanced'];
}

/** A party member's turn, following their tactics (first matching rule wins). */
function allyTurn(s: CampaignState, b: Battle, rng: Rng, actor: Combatant) {
  const foes = living(b, 'enemy');
  const friends = living(b, 'party');
  if (!foes.length) return;
  const nodes = actor.skills.map((id) => nodeFor(s, id)).filter((n): n is SkillNode => !!n);
  const m = actor.memberId ? s.party[actor.memberId] : undefined;
  const skillOf = (n: SkillNode): SkillUse => ({ ...n, power: powerAt(n, m?.skillRanks?.[n.id] ?? 1) });
  const can = (n: SkillNode) => (n.costType === 'mp' ? actor.mp >= n.cost : n.costType === 'ap' ? actor.ap >= n.cost : true);
  for (const r of tacticsFor(s, actor)) {
    const hurt = weakest(friends);
    const matches =
      r.when === 'always' ||
      (r.when === 'allyHpBelow' && !!hurt && (hurt.hp / hurt.maxHp) * 100 < r.value) ||
      (r.when === 'selfHpBelow' && (actor.hp / actor.maxHp) * 100 < r.value) ||
      (r.when === 'enemyBroken' && foes.some((f) => (f.brokenTurns ?? 0) > 0));
    if (!matches) continue;
    if (r.do === 'defend') {
      actor.defending = true;
      b.log.push({ round: b.round, text: `${actor.name} holds the line.`, kind: 'info' });
      return;
    }
    if (r.do === 'heal') {
      const healNode = nodes.find((n) => n.kind === 'heal' && can(n));
      if (healNode) {
        useSkill(b, rng, actor, skillOf(healNode), hurt?.id);
        return;
      }
      if (actor.mp >= 10 && hurt) {
        actor.mp -= 10;
        heal(b, actor, hurt, Math.round(12 + actor.stats.mag * 1.2), `${actor.name}'s first aid`);
        return;
      }
      continue;
    }
    if (r.do === 'skill') {
      const n = (r.skill ? nodes.find((x) => x.id === r.skill || x.name === r.skill) : nodes.find((x) => x.kind === 'attack')) ?? null;
      if (n && can(n) && !useSkill(b, rng, actor, skillOf(n), weakest(foes)?.id)) return;
      dealDamage(b, rng, actor, weakest(foes)!, { power: 10, useMag: false, label: 'attack' });
      return;
    }
    const broken = foes.find((f) => (f.brokenTurns ?? 0) > 0);
    const target = r.when === 'enemyBroken' && broken ? broken : r.do === 'attackStrongest' ? strongest(foes)! : weakest(foes)!;
    dealDamage(b, rng, actor, target, { power: 10, useMag: false, label: 'attack' });
    return;
  }
  dealDamage(b, rng, actor, weakest(foes)!, { power: 10, useMag: false, label: 'attack' });
}

/** Run AI turns until it's the player's turn or the battle ends. */
export function runAutoTurns(s: CampaignState, b: Battle) {
  let guard = 0;
  while (b.status === 'active' && guard++ < 64) {
    const actor = currentActor(b);
    if (!actor) break;
    if (!actor.alive || actor.reserve) {
      advanceTurn(b);
      continue;
    }
    if (actor.isPlayer) break;
    const rng = rngFor(b);
    if (actor.statuses.some((st) => st.name === 'Stunned')) {
      b.log.push({ round: b.round, text: `${actor.name} is stunned.`, kind: 'status' });
    } else if (actor.side === 'enemy') {
      enemyTurn(b, rng, actor);
      planIntent(b, actor);
    } else allyTurn(s, b, rng, actor);
    if (checkEnd(b)) break;
    advanceTurn(b);
  }
}

export interface BattleActionInput {
  action: 'attack' | 'skill' | 'item' | 'defend' | 'flee' | 'swap';
  target?: string;
  skill?: string;
  item?: string;
  /** For swap: the ally who steps back (defaults to one who is down, then the most hurt). */
  actor?: string;
}

/** Apply the player's action. Returns an error string if the action is invalid. */
export function playerAction(s: CampaignState, b: Battle, input: BattleActionInput): string | null {
  if (b.status !== 'active') return 'Battle is over';
  const actor = currentActor(b);
  if (!actor?.isPlayer) return 'Not your turn';
  const rng = rngFor(b);
  const enemies = living(b, 'enemy');
  const pickEnemy = () => (input.target && b.combatants[input.target]?.alive && b.combatants[input.target]?.side === 'enemy' ? b.combatants[input.target] : enemies[0]);
  switch (input.action) {
    case 'attack': {
      const t = pickEnemy();
      if (!t) return 'No target';
      dealDamage(b, rng, actor, t, { power: 10, useMag: false, label: 'attack' });
      break;
    }
    case 'defend':
      actor.defending = true;
      actor.ap = Math.min(actor.maxAp, actor.ap + 10);
      b.log.push({ round: b.round, text: `${actor.name} takes a defensive stance.`, kind: 'info' });
      break;
    case 'skill': {
      const sk = Object.values(s.player.skills).find((x) => x.id === input.skill || x.name.toLowerCase() === String(input.skill ?? '').toLowerCase());
      if (!sk) return 'Unknown skill';
      const node = nodeFor(s, sk.id);
      const err = useSkill(b, rng, actor, { name: sk.name, kind: sk.kind, power: sk.power, cost: sk.cost, costType: sk.costType, element: node?.element ?? null, target: node?.target ?? 'single' }, input.target);
      if (err) return err;
      break;
    }
    case 'item': {
      const it = Object.values(s.inventory).find((x) => (!x.holder || x.holder === 'party') && (x.id === input.item || x.name.toLowerCase() === String(input.item ?? '').toLowerCase()));
      if (!it || it.qty <= 0) return 'Item not available';
      const hp = it.effects.bars?.hp ?? (it.category === 'medicine' ? 30 : it.category === 'food' ? 10 : 0);
      const mp = it.effects.bars?.mp ?? 0;
      if (!hp && !mp) return `${it.name} has no use in battle`;
      const t = input.target && b.combatants[input.target]?.side === 'party' && b.combatants[input.target]?.alive && !b.combatants[input.target]?.reserve ? b.combatants[input.target]! : actor;
      t.hp = Math.min(t.maxHp, t.hp + hp);
      t.mp = Math.min(t.maxMp, t.mp + mp);
      it.qty -= 1;
      if (it.qty <= 0) delete s.inventory[it.id];
      b.log.push({ round: b.round, text: `${actor.name} uses ${it.name}${t !== actor ? ` on ${t.name}` : ''}${hp ? ` (+${hp} HP)` : ''}${mp ? ` (+${mp} MP)` : ''}.`, kind: 'heal' });
      break;
    }
    case 'swap': {
      // Bring a reserve in; it takes the outgoing ally's place in the turn order. Costs your turn.
      const incoming = input.target ? b.combatants[input.target] : undefined;
      if (!incoming || !incoming.reserve || incoming.side !== 'party') return 'Choose someone from the reserve';
      if (!incoming.alive) return `${incoming.name} can't fight`;
      const active = Object.values(b.combatants).filter((c) => c.side === 'party' && !c.isPlayer && !c.reserve);
      const outgoing = input.actor ? b.combatants[input.actor] : (active.find((c) => !c.alive) ?? weakest(active.filter((c) => c.alive)));
      if (outgoing && (outgoing.isPlayer || outgoing.reserve || outgoing.side !== 'party')) return 'Only an active ally can step back';
      const maxActive = Math.max(1, s.partyMeta?.maxActive ?? 4);
      if (!outgoing && active.length >= maxActive) return 'Choose who steps back';
      if (outgoing) {
        outgoing.reserve = true;
        outgoing.intent = null;
        const idx = b.order.indexOf(outgoing.id);
        if (idx >= 0) b.order[idx] = incoming.id;
        else b.order.push(incoming.id);
      } else b.order.push(incoming.id);
      incoming.reserve = false;
      incoming.defending = false;
      b.log.push({ round: b.round, text: outgoing ? `${incoming.name} swaps in for ${outgoing.name}.` : `${incoming.name} joins the fight.`, kind: 'info' });
      // Enemies aiming at someone who left pick a new target.
      for (const e of enemies) if (e.intent?.target && b.combatants[e.intent.target]?.reserve) planIntent(b, e);
      break;
    }
    case 'flee': {
      const avgSpd = enemies.reduce((sum, e) => sum + e.stats.spd, 0) / Math.max(1, enemies.length);
      const chance = clamp(0.5 + (actor.stats.spd - avgSpd) * 0.03, 0.15, 0.9);
      if (rng.next() < chance) {
        b.status = 'fled';
        b.log.push({ round: b.round, text: 'You escaped.', kind: 'info' });
        b.summary = summarize(b);
        return null;
      }
      b.log.push({ round: b.round, text: 'Could not escape.', kind: 'miss' });
      break;
    }
  }
  if (!checkEnd(b)) {
    advanceTurn(b);
    runAutoTurns(s, b);
  }
  return null;
}

/** Compute rewards when the battle is won. */
export function battleRewards(b: Battle): { xp: number; currency: number } {
  const foes = Object.values(b.combatants).filter((c) => c.side === 'enemy');
  const rng = createRng(seedFrom(b.seed, 'rewards'));
  let xp = 0;
  let currency = 0;
  for (const f of foes) {
    const lvl = Math.max(1, Math.round((f.maxHp - 30) / 18));
    xp += 12 + lvl * 8;
    currency += rng.int(1, 4) * lvl;
  }
  return { xp, currency };
}
