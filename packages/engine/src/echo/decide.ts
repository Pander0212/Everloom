/**
 * Belief-conditioned decisions (§8.3), for Strict mode and NPC autonomy.
 *
 * goal manager → utility → proposal. Utility = goal fit + personality fit + relationship impact +
 * emotional motivation + expected benefit − PERCEIVED risk − cost, with configurable weights.
 * Risk is computed from what the character believes (beliefs and suspicions in its own
 * AuthorizedView), never from hidden truth. The result is a proposal, not an outcome: the outcome
 * engine (dice, validation) decides what actually happens.
 */
import type { AuthorizedView } from './access.js';
import { contradicts, propId } from './props.js';
import type { ActorId, Prop } from './types.js';

export interface ActionOption {
  id: string;
  label: string;
  /** goal id → how well the action serves it (−1..1). */
  goals?: Record<string, number>;
  /** trait → how much the action expresses it (−1..1), e.g. { bold: 1, honest: -0.5 }. */
  traits?: Record<string, number>;
  /** How the action treats people (−1 hurts … 1 helps). */
  affects?: Array<{ actor: ActorId; effect: number }>;
  /** Dangers that exist if a proposition is true. */
  risks?: Array<{ prop: Prop; harm: number }>;
  benefit?: number;
  cost?: number;
  /** Emotion that pushes toward it ("anger" → confront). */
  emotion?: string;
}

export interface DecisionProfile {
  /** goal id → importance 0..1. */
  goals: Record<string, number>;
  /** trait → strength −1..1. */
  traits: Record<string, number>;
}

export interface DecisionWeights {
  goal: number;
  personality: number;
  relationship: number;
  emotion: number;
  benefit: number;
  risk: number;
  cost: number;
}

export const DEFAULT_DECISION_WEIGHTS: DecisionWeights = { goal: 1.2, personality: 0.6, relationship: 0.7, emotion: 0.5, benefit: 0.8, risk: 1.4, cost: 0.6 };

export interface Proposal {
  option: ActionOption;
  utility: number;
  parts: Record<keyof DecisionWeights, number>;
  /** What the perceived risk rested on (belief/hypothesis ids). */
  because: string[];
}

/** How strongly the actor believes a proposition is true (0..1), from their own view only. */
export function believedLikelihood(view: AuthorizedView, p: Prop): { p: number; because: string[] } {
  const id = propId(p);
  let best = 0;
  const because: string[] = [];
  for (const b of view.beliefs) {
    if (propId(b.prop) === id && b.confidence > best) {
      best = b.confidence;
      because.push(b.id);
    }
  }
  if (best) return { p: best, because };
  let against = 0;
  for (const b of view.beliefs) if (contradicts(b.prop, p)) against = Math.max(against, b.confidence);
  for (const h of view.hypotheses) {
    for (const o of h.options) {
      if (propId(o.prop) === id) {
        best = Math.max(best, o.amplitude);
        because.push(h.id);
      }
    }
  }
  if (best) return { p: best * (1 - against), because };
  // Nothing known either way: an unknown danger is half-feared, unless the actor believes otherwise.
  return { p: against ? 0.05 : 0.5, because };
}

export function decide(view: AuthorizedView, self: ActorId, options: ActionOption[], profile: DecisionProfile, weights: Partial<DecisionWeights> = {}): Proposal[] {
  const w = { ...DEFAULT_DECISION_WEIGHTS, ...weights };
  const rel = new Map(view.relations.filter((r) => r.from === self).map((r) => [r.to, r]));
  const emotion = view.emotion && view.emotion.actor === self ? view.emotion : null;
  const out: Proposal[] = options.map((o) => {
    let goal = 0;
    for (const [g, fit] of Object.entries(o.goals ?? {})) goal += (profile.goals[g] ?? 0) * fit;
    let personality = 0;
    for (const [t, x] of Object.entries(o.traits ?? {})) personality += (profile.traits[t] ?? 0) * x;
    let relationship = 0;
    for (const a of o.affects ?? []) {
      const r = rel.get(a.actor);
      const care = r ? r.attachment + (r.trust - 0.5) - r.resentment : 0;
      relationship += a.effect * care;
    }
    const emo = emotion && o.emotion && emotion.emotion.toLowerCase().includes(o.emotion.toLowerCase()) ? emotion.intensity : 0;
    let risk = 0;
    const because: string[] = [];
    for (const r of o.risks ?? []) {
      const lk = believedLikelihood(view, r.prop);
      risk += lk.p * r.harm;
      because.push(...lk.because);
    }
    const parts = { goal: goal * w.goal, personality: personality * w.personality, relationship: relationship * w.relationship, emotion: emo * w.emotion, benefit: (o.benefit ?? 0) * w.benefit, risk: -risk * w.risk, cost: -(o.cost ?? 0) * w.cost };
    const utility = Object.values(parts).reduce((a, b) => a + b, 0);
    return { option: o, utility: Math.round(utility * 1000) / 1000, parts, because: [...new Set(because)] };
  });
  return out.sort((a, b) => b.utility - a.utility || a.option.id.localeCompare(b.option.id));
}
