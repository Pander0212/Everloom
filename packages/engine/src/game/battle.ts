/** Deterministic turn-based battle. All randomness comes from the battle seed and turn counters. */
import { clamp } from '../util/clamp.js';
import { createRng, seedFrom, type Rng } from '../util/rng.js';
import { slugify } from '../util/text.js';
import type { Battle, CampaignState, Combatant, Stats } from './state.js';

export interface EnemySpec {
  name: string;
  level?: number;
  hp?: number;
  atk?: number;
  def?: number;
  spd?: number;
  mag?: number;
  count?: number;
}

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
  };
  for (const m of Object.values(s.party)) {
    combatants[`ally_${m.id}`] = {
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
      skills: [],
    };
  }
  let n = 0;
  for (const e of enemies) {
    const count = Math.max(1, Math.min(8, e.count ?? 1));
    for (let i = 0; i < count && n < 8; i++, n++) {
      const lvl = Math.max(1, e.level ?? p.level);
      const hp = Math.round(e.hp ?? 30 + lvl * 18);
      const id = `enemy_${slugify(e.name)}_${n + 1}`;
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
      };
    }
  }
  const rng = createRng(seedFrom(seed, 'initiative'));
  const order = Object.values(combatants)
    .map((c) => ({ id: c.id, init: c.stats.spd + rng.int(1, 6) + (c.isPlayer ? 0.5 : 0) }))
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
  };
  runAutoTurns(s, battle);
  return battle;
}

export function equippedStats(s: CampaignState): Stats {
  const base = { ...s.player.stats };
  for (const it of Object.values(s.inventory)) {
    if (!it.equipped) continue;
    base.atk += it.stats.atk ?? 0;
    base.def += it.stats.def ?? 0;
    base.spd += it.stats.spd ?? 0;
    base.mag += it.stats.mag ?? 0;
  }
  return base;
}

export function currentActor(b: Battle): Combatant | undefined {
  return b.combatants[b.order[b.turnIndex]];
}

function living(b: Battle, side: 'party' | 'enemy') {
  return Object.values(b.combatants).filter((c) => c.side === side && c.alive);
}

function checkEnd(b: Battle): boolean {
  if (!living(b, 'enemy').length) {
    b.status = 'won';
    b.log.push({ round: b.round, text: 'Victory.', kind: 'info' });
    return true;
  }
  const player = b.combatants.player;
  if (!living(b, 'party').length || (player && !player.alive)) {
    b.status = 'lost';
    b.log.push({ round: b.round, text: 'Defeat.', kind: 'defeat' });
    return true;
  }
  return false;
}

function dealDamage(b: Battle, rng: Rng, actor: Combatant, target: Combatant, power: number, useMag: boolean, label: string) {
  const a = effectiveStats(actor);
  const t = effectiveStats(target);
  const missChance = clamp(0.06 + (t.spd - a.spd) * 0.006, 0.02, 0.3);
  if (rng.next() < missChance) {
    b.log.push({ round: b.round, text: `${actor.name}'s ${label} misses ${target.name}.`, kind: 'miss' });
    return;
  }
  const offense = useMag ? a.mag : a.atk;
  let dmg = offense * (power / 10) - t.def * 0.5 + rng.int(-2, 2);
  const crit = rng.next() < clamp(0.08 + a.spd * 0.002, 0.05, 0.25);
  if (crit) dmg *= 1.5;
  if (target.defending) dmg *= 0.5;
  const final = Math.max(1, Math.round(dmg));
  target.hp = Math.max(0, target.hp - final);
  b.log.push({ round: b.round, text: `${actor.name}'s ${label} ${crit ? 'critically ' : ''}hits ${target.name} for ${final}.`, kind: crit ? 'crit' : 'hit' });
  if (target.hp <= 0) {
    target.alive = false;
    b.log.push({ round: b.round, text: `${target.name} is down.`, kind: 'defeat' });
  }
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

function chooseTarget(rng: Rng, foes: Combatant[]): Combatant {
  const weakest = foes.slice().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  return rng.next() < 0.6 ? weakest : rng.pick(foes);
}

/** Run AI turns until it's the player's turn or the battle ends. */
export function runAutoTurns(s: CampaignState, b: Battle) {
  let guard = 0;
  while (b.status === 'active' && guard++ < 64) {
    const actor = currentActor(b);
    if (!actor) break;
    if (!actor.alive) {
      advanceTurn(b);
      continue;
    }
    if (actor.isPlayer) break;
    const rng = rngFor(b);
    if (actor.statuses.some((st) => st.name === 'Stunned')) {
      b.log.push({ round: b.round, text: `${actor.name} is stunned.`, kind: 'status' });
    } else if (actor.side === 'enemy') {
      const foes = living(b, 'party');
      if (!foes.length) break;
      const target = chooseTarget(rng, foes);
      if (actor.ap >= 20 && rng.next() < 0.25) {
        actor.ap -= 20;
        dealDamage(b, rng, actor, target, 15, false, 'heavy strike');
      } else if (actor.hp < actor.maxHp * 0.3 && rng.next() < 0.2) {
        actor.defending = true;
        b.log.push({ round: b.round, text: `${actor.name} braces for impact.`, kind: 'info' });
      } else dealDamage(b, rng, actor, target, 10, false, 'attack');
    } else {
      const foes = living(b, 'enemy');
      if (!foes.length) break;
      const hurt = living(b, 'party').sort((a, c) => a.hp / a.maxHp - c.hp / c.maxHp)[0];
      if (hurt && hurt.hp < hurt.maxHp * 0.35 && actor.mp >= 10) {
        actor.mp -= 10;
        const amount = Math.round(12 + actor.stats.mag * 1.2);
        hurt.hp = Math.min(hurt.maxHp, hurt.hp + amount);
        b.log.push({ round: b.round, text: `${actor.name} heals ${hurt.name} for ${amount}.`, kind: 'heal' });
      } else dealDamage(b, rng, actor, chooseTarget(rng, foes), 10, false, 'attack');
    }
    if (checkEnd(b)) break;
    advanceTurn(b);
  }
}

export interface BattleActionInput {
  action: 'attack' | 'skill' | 'item' | 'defend' | 'flee';
  target?: string;
  skill?: string;
  item?: string;
}

/** Apply the player's action. Returns an error string if the action is invalid. */
export function playerAction(s: CampaignState, b: Battle, input: BattleActionInput): string | null {
  if (b.status !== 'active') return 'Battle is over';
  const actor = currentActor(b);
  if (!actor?.isPlayer) return 'Not your turn';
  const rng = rngFor(b);
  const enemies = living(b, 'enemy');
  const pickEnemy = () => (input.target && b.combatants[input.target]?.alive ? b.combatants[input.target] : enemies[0]);
  switch (input.action) {
    case 'attack': {
      const t = pickEnemy();
      if (!t) return 'No target';
      dealDamage(b, rng, actor, t, 10, false, 'attack');
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
      const pool = sk.costType === 'mp' ? 'mp' : sk.costType === 'ap' ? 'ap' : null;
      if (pool && actor[pool] < sk.cost) return `Not enough ${pool.toUpperCase()}`;
      if (pool) actor[pool] -= sk.cost;
      if (sk.kind === 'heal') {
        const target = input.target && b.combatants[input.target]?.side === 'party' ? b.combatants[input.target] : actor;
        const amount = Math.round(sk.power + actor.stats.mag * 0.8);
        target.hp = Math.min(target.maxHp, target.hp + amount);
        b.log.push({ round: b.round, text: `${sk.name} restores ${amount} HP to ${target.name}.`, kind: 'heal' });
      } else if (sk.kind === 'buff') {
        actor.statuses.push({ name: 'Empowered', turns: 3, kind: 'buff' });
        b.log.push({ round: b.round, text: `${actor.name} is empowered by ${sk.name}.`, kind: 'status' });
      } else if (sk.kind === 'debuff') {
        const t = pickEnemy();
        if (!t) return 'No target';
        t.statuses.push({ name: rng.next() < 0.5 ? 'Weakened' : 'Poisoned', turns: 3, kind: 'debuff' });
        b.log.push({ round: b.round, text: `${sk.name} afflicts ${t.name}.`, kind: 'status' });
      } else {
        const t = pickEnemy();
        if (!t) return 'No target';
        dealDamage(b, rng, actor, t, sk.power, sk.costType === 'mp', sk.name);
      }
      break;
    }
    case 'item': {
      const it = Object.values(s.inventory).find((x) => x.id === input.item || x.name.toLowerCase() === String(input.item ?? '').toLowerCase());
      if (!it || it.qty <= 0) return 'Item not available';
      const heal = it.effects.bars?.hp ?? (it.category === 'medicine' ? 30 : it.category === 'food' ? 10 : 0);
      const mp = it.effects.bars?.mp ?? 0;
      if (!heal && !mp) return `${it.name} has no use in battle`;
      actor.hp = Math.min(actor.maxHp, actor.hp + heal);
      actor.mp = Math.min(actor.maxMp, actor.mp + mp);
      it.qty -= 1;
      if (it.qty <= 0) delete s.inventory[it.id];
      b.log.push({ round: b.round, text: `${actor.name} uses ${it.name}${heal ? ` (+${heal} HP)` : ''}${mp ? ` (+${mp} MP)` : ''}.`, kind: 'heal' });
      break;
    }
    case 'flee': {
      const avgSpd = enemies.reduce((sum, e) => sum + e.stats.spd, 0) / Math.max(1, enemies.length);
      const chance = clamp(0.5 + (actor.stats.spd - avgSpd) * 0.03, 0.15, 0.9);
      if (rng.next() < chance) {
        b.status = 'fled';
        b.log.push({ round: b.round, text: 'You escaped.', kind: 'info' });
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
