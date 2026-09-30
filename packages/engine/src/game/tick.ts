/**
 * The turn tick: what the world does before a reply is written, with no model call. Everything
 * here is a pure function of the state, the player's message and the turn number, so a swipe or
 * regenerate replays exactly the same result.
 *
 *  - intent:  "I head to the market" moves the player (and the party) before the narrator writes
 *  - dice:    risky actions get a check with logistic odds, rolled from the player's message
 *  - pulse:   now and then something happens on its own, with a pity timer
 *  - threads: off-screen storylines climb their ladder on seeded heartbeats
 *  - goals:   people pursuing a goal somewhere else move toward it, a hop at a time
 */
import { createRng, seedFrom } from '../util/rng.js';
import { nameMatchScore, normalizeName } from '../util/text.js';
import { exitsFrom } from './injection.js';
import type { Op } from './ops.js';
import type { CampaignState, Location, Thread } from './state.js';

// ------------------------------------------------------------------ intent

const MOVE_RE = /\b(?:i|we)\s+(?:(?:go|head|walk|run|hurry|wander|travel|return|drive|ride|sail|fly|make (?:my|our) way|set off|leave)\s+(?:back\s+)?(?:to|into|towards?|for|over to|down to|up to)|enter|go inside)\s+(?:the\s+)?([^.,!?;\n*"]{2,50})/i;

/** Where the player says they're going, if it is a known place. */
export function detectMove(s: CampaignState, text: string): Location | null {
  const clean = text.replace(/"[^"]*"/g, ' '); // spoken words are not actions
  const m = MOVE_RE.exec(clean);
  if (!m) return null;
  const want = m[1].trim().split(/\s+(?:and|then|with|to)\s+/i)[0];
  let best: { loc: Location; score: number } | null = null;
  const candidates = [...exitsFrom(s, s.currentLocationId), ...Object.values(s.locations)];
  for (const loc of candidates) {
    const score = nameMatchScore(loc.name.replace(/^the\s+/i, ''), want.replace(/^the\s+/i, ''));
    if (score >= 0.8 && (!best || score > best.score)) best = { loc, score };
  }
  if (!best || best.loc.id === s.currentLocationId) return null;
  return best.loc;
}

export function intentOps(s: CampaignState, text: string): Op[] {
  const to = detectMove(s, text);
  if (!to) return [];
  const ops: Op[] = [{ type: 'location.move', to: to.name } as Op];
  // Companions come along.
  for (const m of Object.values(s.party)) if (m.npcId && s.npcs[m.npcId]?.status === 'alive') ops.push({ type: 'npc.set', id: m.npcId, patch: { locationId: to.id } } as Op);
  return ops;
}

// ------------------------------------------------------------------ dice

export type CheckTier = 'critical success' | 'success' | 'failure' | 'critical failure';

export interface Check {
  skill: string;
  stat: 'atk' | 'def' | 'spd' | 'mag' | 'level';
  difficulty: 'easy' | 'normal' | 'hard' | 'very hard';
  /** Chance of success, 0..1. */
  odds: number;
  roll: number;
  tier: CheckTier;
}

const CHECKS: Array<{ re: RegExp; skill: string; stat: Check['stat'] }> = [
  { re: /\b(sneak|hide|creep|slip past|pickpocket|steal|pick the lock|lockpick|dodge|leap|jump across|outrun|chase)\b/i, skill: 'agility', stat: 'spd' },
  { re: /\b(climb|lift|force|break down|smash|shove|push|wrestle|kick (?:in|down)|pry)\b/i, skill: 'strength', stat: 'atk' },
  { re: /\b(persuade|convince|charm|seduce|bluff|lie to|deceive|haggle|bargain|intimidate|threaten|talk (?:him|her|them) into)\b/i, skill: 'presence', stat: 'level' },
  { re: /\b(cast|spell|enchant|ward|scry|dispel|channel)\b/i, skill: 'magic', stat: 'mag' },
  { re: /\b(resist|endure|hold (?:my|our) breath|brace|withstand)\b/i, skill: 'endurance', stat: 'def' },
];
const ATTEMPT_RE = /\b(try|tries|trying|attempt|attempts|attempting|struggle|manage|dare)\b/i;

/** Logistic odds from the gap between skill and difficulty: even 50%, +2 ≈ 76%, +4 ≈ 91%. */
export function checkOdds(gap: number): number {
  return 1 / (1 + Math.exp(-0.576 * gap));
}

export function tierFor(odds: number, roll: number): CheckTier {
  if (roll < odds * 0.1) return 'critical success';
  if (roll < odds) return 'success';
  if (roll > 1 - (1 - odds) * 0.1) return 'critical failure';
  return 'failure';
}

/**
 * A check for a risky action the player attempts. Only first-person attempts count ("I try to
 * sneak past"); the roll is seeded by the message, so the same message always gets the same roll.
 */
export function detectCheck(s: CampaignState, text: string, seedKey: string): Check | null {
  const clean = text.replace(/"[^"]*"/g, ' ');
  if (!/\b(i|we)\b/i.test(clean) || !ATTEMPT_RE.test(clean)) return null;
  const hit = CHECKS.find((c) => c.re.test(clean));
  if (!hit) return null;
  const difficulty: Check['difficulty'] = /\b(impossible|nearly impossible|very hard|desperate)\b/i.test(clean) ? 'very hard' : /\b(hard|difficult|heavily guarded|guarded|tough)\b/i.test(clean) ? 'hard' : /\b(easy|simple|quick)\b/i.test(clean) ? 'easy' : 'normal';
  const p = s.player;
  const statValue = hit.stat === 'level' ? 10 + p.level : p.stats[hit.stat];
  const gap = (statValue - 10) / 2 + (p.level - 1) / 3 - { easy: -2, normal: 0, hard: 2, 'very hard': 4 }[difficulty];
  const odds = checkOdds(gap);
  const roll = createRng(seedFrom('check', seedKey, normalizeName(text))).next();
  return { skill: hit.skill, stat: hit.stat, difficulty, odds, roll, tier: tierFor(odds, roll) };
}

export function describeCheck(c: Check): string {
  const what = { 'critical success': 'a critical success — it goes better than hoped', success: 'a success', failure: 'a failure — it does not work', 'critical failure': 'a critical failure — it goes wrong in a way that costs something' }[c.tier];
  return `${c.skill[0].toUpperCase()}${c.skill.slice(1)} check (${c.difficulty}, ${Math.round(c.odds * 100)}% odds): ${what}. Narrate this outcome; do not re-roll it.`;
}

// ------------------------------------------------------------------ pulse

const PULSE: Record<string, string[]> = {
  any: [
    'A stranger bumps into the player, mutters an apology and hurries on.',
    'A sudden noise nearby makes everyone look up.',
    'Someone the player half-recognizes passes by, then glances back.',
    'A dropped coin rolls to a stop at the player\'s feet.',
    'The weather shifts noticeably.',
    'A messenger is asking around for someone matching the player\'s description.',
  ],
  shop: ['A customer starts a loud argument over a price.', 'A shelf gives way and goods spill across the floor.'],
  tavern: ['A song starts up and half the room joins in.', 'A fight breaks out over a spilled drink.'],
  market: ['A pickpocket is spotted and the crowd surges.', 'A cart overturns and fruit rolls everywhere.'],
  wild: ['Something moves in the undergrowth.', 'Tracks cross the path — fresh ones.'],
};

/**
 * Does something happen this turn? A small chance that grows every quiet turn (pity), computed
 * from the turn number alone by replaying the recent turns, so it is swipe-safe.
 */
export function pulseAt(seed: number, turn: number, opts: { base?: number; step?: number; lookback?: number } = {}): boolean {
  const base = opts.base ?? 0.03;
  const step = opts.step ?? 0.02;
  let quiet = 0;
  let fired = false;
  for (let t = Math.max(1, turn - (opts.lookback ?? 40)); t <= turn; t++) {
    const p = Math.min(0.6, base + quiet * step);
    fired = t > 3 && createRng(seedFrom(seed, 'pulse', t)).next() < p;
    quiet = fired ? 0 : quiet + 1;
  }
  return fired;
}

export function pulseEvent(s: CampaignState, turn: number): string {
  const loc = s.currentLocationId ? s.locations[s.currentLocationId] : undefined;
  const kind = loc ? (/(tavern|inn|bar|pub)/i.test(`${loc.kind} ${loc.name}`) ? 'tavern' : /(shop|store)/i.test(loc.kind) ? 'shop' : /(market|square|bazaar)/i.test(`${loc.kind} ${loc.name}`) ? 'market' : /(forest|wild|road|trail|field|mountain)/i.test(`${loc.kind} ${loc.name}`) ? 'wild' : 'any') : 'any';
  const pool = [...PULSE.any, ...(PULSE[kind] ?? [])];
  return createRng(seedFrom(s.meta.seed, 'pulse-event', turn)).pick(pool);
}

// ------------------------------------------------------------------ threads

/** A thread's rung at a turn: one seeded heartbeat per turn since it began. */
export function threadRung(t: Thread, turn: number): { rung: number; peakedNow: boolean } {
  let rung = 0;
  let peakedAt = -1;
  for (let x = t.bornTurn + 1; x <= turn && rung < t.max; x++) {
    if (createRng(seedFrom(t.id, 'beat', x)).next() < t.pace) {
      rung++;
      if (rung === t.max) peakedAt = x;
    }
  }
  return { rung, peakedNow: peakedAt === turn };
}

// ------------------------------------------------------------------ goals

/** The next place on the way from one location to another (routes first, else straight there). */
export function nextHop(s: CampaignState, from: string | null, to: string): string {
  if (!from) return to;
  const prev = new Map<string, string>([[from, from]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) break;
    for (const r of Object.values(s.routes)) {
      const nxt = r.from === cur ? r.to : r.to === cur ? r.from : null;
      if (nxt && !prev.has(nxt)) {
        prev.set(nxt, cur);
        queue.push(nxt);
      }
    }
  }
  if (!prev.has(to)) return to;
  let step = to;
  while (prev.get(step) !== from && prev.get(step) !== step) step = prev.get(step)!;
  return step;
}

/** Off-screen pursuit: every `every` turns, people acting on a goal elsewhere take one step. */
export function goalOps(s: CampaignState, turn: number, every = 3): Op[] {
  if (turn <= 0 || turn % every !== 0) return [];
  const ops: Op[] = [];
  const inParty = new Set(Object.values(s.party).map((m) => m.npcId));
  for (const n of Object.values(s.npcs)) {
    if (n.status !== 'alive' || n.unconscious || n.locked || inParty.has(n.id)) continue;
    if (n.locationId && n.locationId === s.currentLocationId) continue; // not while the player is watching
    const goal = (n.goals ?? []).filter((g) => g.state === 'acting' && g.targetLocationId && s.locations[g.targetLocationId]).sort((a, b) => b.urgency - a.urgency)[0];
    if (!goal || n.locationId === goal.targetLocationId) continue;
    ops.push({ type: 'npc.set', id: n.id, patch: { locationId: nextHop(s, n.locationId, goal.targetLocationId!) } } as Op);
  }
  return ops;
}

// ------------------------------------------------------------------ the tick

export interface TickInput {
  /** The player's message this turn. */
  text: string;
  /** Stable id of that message (seeds the dice). */
  messageKey: string;
  /** This reply's turn number (assistant replies so far + 1). */
  turn: number;
  switches: { intent: boolean; dice: boolean; pulse: boolean; threads: boolean };
}

export interface TickResult {
  ops: Op[];
  dice: string[];
  happens: string[];
  check: Check | null;
  threads: Array<{ id: string; rung: number }>;
}

export function turnTick(s: CampaignState, input: TickInput): TickResult {
  const ops: Op[] = [];
  const happens: string[] = [];
  if (input.switches.intent) ops.push(...intentOps(s, input.text));
  ops.push(...goalOps(s, input.turn));
  const check = input.switches.dice ? detectCheck(s, input.text, input.messageKey) : null;
  if (input.switches.pulse && pulseAt(s.meta.seed, input.turn)) happens.push(pulseEvent(s, input.turn));
  const threads: TickResult['threads'] = [];
  if (input.switches.threads) {
    for (const t of Object.values(s.threads ?? {})) {
      if (t.status === 'done') continue;
      const r = threadRung(t, input.turn);
      threads.push({ id: t.id, rung: r.rung });
      if (r.peakedNow) happens.push(`The storyline comes to a head: ${t.text} — ${t.stages[t.stages.length - 1]}.`);
    }
  }
  return { ops, dice: check ? [describeCheck(check)] : [], happens, check, threads };
}
