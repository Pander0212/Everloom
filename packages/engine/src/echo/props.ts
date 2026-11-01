/** Propositions: identity, slots and contradiction. Pure. */
import type { Prop } from './types.js';

/** Predicates that hold several values at once ("Anna has a key" and "Anna has a ring"). */
export const MULTI_PREDICATES = new Set(['has', 'knows', 'likes', 'dislikes', 'met', 'owns', 'member_of', 'said', 'suspects', 'fears', 'wants']);

const norm = (x: string) =>
  String(x ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

export function prop(s: string, p: string, o: string, neg = false): Prop {
  return neg ? { s: norm(s), p: norm(p), o: norm(o), neg: true } : { s: norm(s), p: norm(p), o: norm(o) };
}

export function normProp(x: Prop): Prop {
  return prop(x.s, x.p, x.o, !!x.neg);
}

/** The slot a functional predicate fills ("ring|location"). */
export function slotKey(x: Pick<Prop, 's' | 'p'>): string {
  return `${norm(x.s)}|${norm(x.p)}`;
}

/** Identity of the proposition without its polarity. */
export function propKey(x: Prop): string {
  return `${norm(x.s)}|${norm(x.p)}|${norm(x.o)}`;
}

/** Identity including polarity. */
export function propId(x: Prop): string {
  return `${x.neg ? '!' : ''}${propKey(x)}`;
}

export function sameProp(a: Prop, b: Prop): boolean {
  return propId(a) === propId(b);
}

/** Two propositions cannot both be true. */
export function contradicts(a: Prop, b: Prop): boolean {
  if (slotKey(a) !== slotKey(b)) return false;
  const sameObj = norm(a.o) === norm(b.o);
  if (sameObj) return !!a.neg !== !!b.neg;
  // Different values: only a contradiction for a single-valued slot when both are positive.
  if (MULTI_PREDICATES.has(norm(a.p))) return false;
  return !a.neg && !b.neg;
}

/** Plain-language rendering ("ring location: clara_bag"). */
export function propText(x: Prop, names: Record<string, string> = {}): string {
  const n = (v: string) => names[v] ?? v.replace(/_/g, ' ');
  return `${n(x.s)} ${x.neg ? 'not ' : ''}${x.p.replace(/_/g, ' ')} ${n(x.o)}`.trim();
}
