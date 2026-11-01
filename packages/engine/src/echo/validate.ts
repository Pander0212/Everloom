/**
 * Validation (§9): deterministic checks of a reply's extracted events against the projection as
 * it stood before the reply. Structured invariants only; an optional semantic model check can be
 * layered on top, but it is never the access-control mechanism (that is the access engine).
 *
 * Each issue names the least disruptive fix: regenerate only the passage, or flag it (one tap to
 * fix) without blocking the stream. Unexpected but legitimate creative choices are not issues:
 * a made-up detail that contradicts nothing passes.
 */
import { Projector } from './projector.js';
import { normProp, propText, slotKey } from './props.js';
import type { ActorId, EchoEvent, Prop } from './types.js';

export type IssueKind =
  | 'unknown-knowledge'
  | 'location-contradiction'
  | 'object-contradiction'
  | 'belief-as-fact'
  | 'perspective-leak'
  | 'impossible-action'
  | 'attempt-as-success'
  | 'collapse-constraint'
  | 'branch-violation';

export interface ValidationIssue {
  kind: IssueKind;
  eventId: string;
  actor?: ActorId;
  detail: string;
  fix: 'regenerate-passage' | 'flag';
}

export interface ValidateContext {
  /** Whose perspective the reply was written from. */
  narration: 'character' | 'persona' | 'omniscient';
  /** Live event ids on the active branch (for branch checks). */
  liveEventIds: Set<string>;
  /** Actors exempt from knowledge checks (the narrator in omniscient mode). */
  omniscientActors?: string[];
}

/** An actor knows a slot when they hold any in-belief on it or the group they belong to does. */
function knowsSlot(before: Projector, actor: ActorId, p: Prop): boolean {
  const key = slotKey(p);
  for (const b of before.inBeliefs(actor)) if (slotKey(b.prop) === key) return true;
  const groups = new Set(before.groupsOf(actor));
  return before.common.some((c) => groups.has(c.group) && slotKey(c.prop) === key);
}

/** A canonical fact nobody outside its witnesses was given (it came from a private/secret event). */
function isSecret(before: Projector, p: Prop): boolean {
  const facts = before.factAt(p.s, p.p).filter((f) => f.o === normProp(p).o);
  return facts.some((f) => f.sourceEventIds.some((id) => before.events.get(id)?.visibility !== 'public'));
}

const IMPOSSIBLE = new Set(['dead', 'unconscious', 'asleep', 'imprisoned']);

export function validateTurn(before: Projector, reply: EchoEvent[], ctx: ValidateContext): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const omni = new Set(ctx.omniscientActors ?? []);
  for (const e of reply) {
    const actor = e.actors[0];
    for (const c of e.causes) if (!ctx.liveEventIds.has(c) && !reply.some((r) => r.id === c)) out.push({ kind: 'branch-violation', eventId: e.id, detail: `refers to event ${c}, which is not on this branch`, fix: 'regenerate-passage' });

    if (actor && actor !== 'player' && actor !== 'narrator' && !omni.has(actor)) {
      for (const cl of e.claims ?? []) {
        const p = normProp(cl.prop);
        if (before.isCanonical(p) && isSecret(before, p) && !knowsSlot(before, actor, p)) out.push({ kind: 'unknown-knowledge', eventId: e.id, actor, detail: `${before.name(actor)} says "${cl.text}" but never learned it`, fix: 'regenerate-passage' });
      }
      const status = before.factAt(actor, 'status')[0]?.o;
      if (status && IMPOSSIBLE.has(status) && e.type !== 'thought' && e.type !== 'world') out.push({ kind: 'impossible-action', eventId: e.id, actor, detail: `${before.name(actor)} is ${status}`, fix: 'regenerate-passage' });
      const where = before.factAt(actor, 'location')[0]?.o;
      if (where && e.locationId && where !== e.locationId.toLowerCase() && e.type !== 'move' && e.type !== 'message') out.push({ kind: 'location-contradiction', eventId: e.id, actor, detail: `${before.name(actor)} is at ${where}, not ${e.locationId}`, fix: 'flag' });
    }
    for (const raw of e.establishes ?? []) {
      const p = normProp(raw);
      if (p.p === 'has' && p.neg) {
        const has = before.factAt(p.s, 'has').some((f) => f.o === p.o && !f.neg);
        if (!has && before.factAt(p.s, 'has').length) out.push({ kind: 'object-contradiction', eventId: e.id, detail: `${p.s} gives away ${p.o} but does not have it`, fix: 'flag' });
      }
      const u = before.undetermined.get(slotKey(p));
      if (u && u.status !== 'collapsed' && !p.neg) {
        if (u.status === 'predecided' && u.value !== p.o) out.push({ kind: 'collapse-constraint', eventId: e.id, detail: `${u.label}: decided as "${u.value}", the reply says "${p.o}"`, fix: 'regenerate-passage' });
        else {
          const ok = Projector.satisfies(u, p.o);
          if (!ok.ok) out.push({ kind: 'collapse-constraint', eventId: e.id, detail: `${u.label}: "${p.o}" ${ok.why}`, fix: 'regenerate-passage' });
        }
      }
      // Narration stating someone's open suspicion as settled fact.
      if (ctx.narration !== 'omniscient' && (actor === 'narrator' || !actor)) {
        for (const h of before.hypotheses.values()) {
          if (h.status !== 'open') continue;
          if (h.options.some((o) => slotKey(o.prop) === slotKey(p) && o.prop.o === p.o) && !before.isCanonical(p)) out.push({ kind: 'belief-as-fact', eventId: e.id, detail: `narration states "${propText(p, before.cfg.names)}" as fact; it is only a suspicion of ${before.name(h.owner)}`, fix: 'flag' });
        }
      }
      // Player-perspective narration revealing something the persona doesn't know.
      if (ctx.narration === 'persona' && (actor === 'narrator' || !actor) && before.isCanonical(p) && isSecret(before, p) && !knowsSlot(before, 'player', p)) out.push({ kind: 'perspective-leak', eventId: e.id, detail: `narration reveals "${propText(p, before.cfg.names)}", which the player's character doesn't know`, fix: 'regenerate-passage' });
    }
    if (e.attempted && e.outcome !== 'success' && e.establishes?.length && e.outcome === 'unknown') out.push({ kind: 'attempt-as-success', eventId: e.id, detail: `"${e.action.slice(0, 80)}" is only an attempt; its changes were not applied`, fix: 'flag' });
  }
  return out;
}
