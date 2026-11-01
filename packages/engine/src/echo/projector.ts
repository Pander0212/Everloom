/**
 * The projector: replays the event log (the active branch only, in story order) into derived
 * state. Pure and deterministic: the same events give the same projection, so a swipe or a delete
 * is handled by replaying without the abandoned events — nothing from them can survive.
 *
 * Incremental: events appended at the end are applied to an existing projector; anything else
 * (an event removed or changed) means a fresh replay. Callers cache by the active leaf.
 *
 * Truth maintenance (§3.3): every belief records its justification (`supports`). When a support
 * goes out (a lie is exposed, a witness corrects themselves, the owner retracts it), every belief
 * resting on it is re-evaluated and goes out too, recursively, with its interval closed — history
 * is never rewritten.
 */
import { defaultCues, perceive, revealAtLeast, sawEachOther, type Perceived } from './perception.js';
import { contradicts, MULTI_PREDICATES, normProp, propId, propKey, propText, slotKey } from './props.js';
import {
  DEFAULT_PROJECTOR_CONFIG,
  type ActorId,
  type Belief,
  type BeliefMode,
  type Commitment,
  type EchoEvent,
  type EmotionState,
  type FactVersion,
  type HigherOrder,
  type HypothesisSet,
  type ManualOp,
  type Membership,
  type MemoryType,
  type MemoryUnit,
  type Observation,
  type Prop,
  type ProjectorConfig,
  type Relationship,
  type Testimony,
  type Undetermined,
} from './types.js';

export const MODE_RANK: Record<BeliefMode, number> = { observed: 4, common: 3, told: 2, reflection: 2, inferred: 1.5, rumor: 1 };

export interface Violation {
  kind: 'collapse-constraint' | 'predecided-mismatch' | 'attempt-as-success' | 'canon-overwrite';
  eventId: string;
  messageId: string | null;
  detail: string;
}

interface HypEvidence {
  beliefId: string;
  optionId: string;
  factor: number;
}

const STOP = new Set('the and for with that this was were had has have his her him she they them their you your from into onto about over under then than when what which who whom whose where while after before again also just very more most some any each other such only own same not but are its one two there here said says told asked'.split(' '));

export function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w));
}

export function dayPhase(minutes: number): 'night' | 'morning' | 'afternoon' | 'evening' {
  const m = ((minutes % 1440) + 1440) % 1440;
  if (m < 300 || m >= 1320) return 'night';
  if (m < 720) return 'morning';
  if (m < 1080) return 'afternoon';
  return 'evening';
}

const ATTRIBUTE_WORDS = ['winter', 'summer', 'spring', 'autumn', 'fall', 'rain', 'snow', 'storm', 'sunny', 'night', 'morning', 'evening', 'dawn', 'dusk', 'noon', 'midnight'];
/** Attribute pairs that cannot both describe one moment. */
export const OPPOSED_ATTRIBUTES: Array<[string, string]> = [
  ['winter', 'summer'],
  ['spring', 'autumn'],
  ['spring', 'fall'],
  ['snow', 'summer'],
  ['night', 'morning'],
  ['night', 'noon'],
  ['midnight', 'noon'],
  ['dawn', 'dusk'],
  ['rain', 'sunny'],
];

export function attributesOf(text: string, minutes?: number): string[] {
  const low = ` ${text.toLowerCase()} `;
  const out = ATTRIBUTE_WORDS.filter((w) => new RegExp(`[^a-z]${w}[^a-z]`).test(low));
  if (minutes !== undefined && !out.some((w) => ['night', 'morning', 'evening', 'noon', 'midnight', 'dawn', 'dusk'].includes(w))) {
    const ph = dayPhase(minutes);
    if (ph !== 'afternoon') out.push(ph);
  }
  return [...new Set(out)];
}

export function gist(text: string, maxWords = 15): string {
  const w = text.trim().replace(/\s+/g, ' ').split(' ');
  return w.length <= maxWords ? w.join(' ') : `${w.slice(0, maxWords).join(' ')}…`;
}

function clip(text: string, maxChars: number): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length <= maxChars ? t : `${t.slice(0, maxChars - 1).replace(/\s+\S*$/, '')}…`;
}

export class Projector {
  readonly cfg: ProjectorConfig;
  readonly events = new Map<string, EchoEvent>();
  readonly order: string[] = [];
  lastSeq = -Infinity;
  lastTime = 0;
  facts: FactVersion[] = [];
  observations: Observation[] = [];
  beliefs = new Map<string, Belief>();
  testimonies: Testimony[] = [];
  higher = new Map<string, HigherOrder>();
  hypotheses = new Map<string, HypothesisSet>();
  commitments = new Map<string, Commitment>();
  undetermined = new Map<string, Undetermined>();
  units: MemoryUnit[] = [];
  memberships: Membership[] = [];
  common: Array<{ group: string; prop: Prop; text: string; eventId: string; seq: number }> = [];
  relations = new Map<string, Relationship>();
  emotions = new Map<string, EmotionState>();
  violations: Violation[] = [];
  /** Manual ops in force (applied at view time, or during replay for pre-decisions). */
  readonly manual: ManualOp[];
  private dependents = new Map<string, Set<string>>();
  private hypPrior = new Map<string, Map<string, number>>();
  private hypEvidence = new Map<string, HypEvidence[]>();
  private episodes = new Map<string, { id: string; last: number }>();
  private predecided = new Map<string, string>();

  constructor(cfg: Partial<ProjectorConfig> = {}, manual: ManualOp[] = []) {
    this.cfg = { ...DEFAULT_PROJECTOR_CONFIG, ...cfg, traits: { ...DEFAULT_PROJECTOR_CONFIG.traits, ...(cfg.traits ?? {}) }, names: { ...(cfg.names ?? {}) } };
    this.manual = manual;
    for (const op of manual) if (op.kind === 'predecide') this.predecided.set(slotKey(op), op.value.toLowerCase().trim());
  }

  name(id: string): string {
    return this.cfg.names[id] ?? (id === 'player' ? 'the player' : id.replace(/^char:/, '').replace(/_/g, ' '));
  }

  // -------------------------------------------------------------- relations

  relation(from: ActorId, to: ActorId): Relationship {
    const k = `${from}>${to}`;
    let r = this.relations.get(k);
    if (!r) {
      r = { from, to, trust: this.cfg.defaultTrust, attachment: 0, suspicion: 0, resentment: 0, history: [] };
      this.relations.set(k, r);
    }
    return r;
  }

  trust(from: ActorId, to: ActorId): number {
    return this.relations.get(`${from}>${to}`)?.trust ?? this.cfg.defaultTrust;
  }

  private nudge(from: ActorId, to: ActorId, d: Partial<Record<'trust' | 'attachment' | 'suspicion' | 'resentment', number>>, eventId: string) {
    if (from === to) return;
    const r = this.relation(from, to);
    for (const [k, v] of Object.entries(d) as Array<[keyof typeof d, number]>) {
      const lo = k === 'attachment' ? -1 : 0;
      r[k] = Math.max(lo, Math.min(1, r[k] + v));
    }
    if (!r.history.includes(eventId)) r.history.push(eventId);
  }

  // -------------------------------------------------------------- dependency graph

  private depend(child: string, supports: string[]) {
    for (const s of supports) {
      let set = this.dependents.get(s);
      if (!set) this.dependents.set(s, (set = new Set()));
      set.add(child);
    }
  }

  /** A node went out: everything resting on it is re-evaluated (and goes out with it). */
  private withdraw(node: string, reason: string, seq: number, time: number) {
    const queue = [node];
    const touchedOwners = new Set<string>();
    while (queue.length) {
      const n = queue.shift()!;
      for (const child of this.dependents.get(n) ?? []) {
        if (child.startsWith('bel:')) {
          const b = this.beliefs.get(child);
          if (!b || b.status === 'out') continue;
          b.status = 'out';
          b.until = seq;
          b.untilTime = time;
          b.outReason = reason;
          touchedOwners.add(b.owner);
          queue.push(child);
        } else if (child.startsWith('ho:')) {
          const h = this.higher.get(child);
          if (!h || h.status === 'out') continue;
          h.status = 'out';
          h.until = seq;
          queue.push(child);
        }
      }
    }
    for (const o of touchedOwners) this.recomputeHypotheses(o, seq, `support withdrawn: ${reason}`);
  }

  private supportHolds(node: string): boolean {
    if (node.startsWith('bel:')) return this.beliefs.get(node)?.status === 'in';
    if (node.startsWith('ho:')) return this.higher.get(node)?.status === 'in';
    return true; // observations, testimonies and events hold while their event is in the log
  }

  // -------------------------------------------------------------- beliefs

  inBeliefs(owner: ActorId): Belief[] {
    const out: Belief[] = [];
    for (const b of this.beliefs.values()) if (b.owner === owner && b.status === 'in') out.push(b);
    return out;
  }

  /** The strongest in-belief an owner has about exactly this proposition (with polarity). */
  holds(owner: ActorId, p: Prop): Belief | null {
    const id = propId(p);
    let best: Belief | null = null;
    for (const b of this.beliefs.values()) {
      if (b.owner !== owner || b.status !== 'in' || propId(b.prop) !== id) continue;
      if (!best || MODE_RANK[b.mode] > MODE_RANK[best.mode] || (MODE_RANK[b.mode] === MODE_RANK[best.mode] && b.confidence > best.confidence)) best = b;
    }
    return best;
  }

  private addBelief(e: EchoEvent, owner: ActorId, raw: Prop, mode: BeliefMode, confidence: number, supports: string[], text: string, via: ActorId[] = []): Belief | null {
    const p = normProp(raw);
    const id = `bel:${e.id}:${owner}:${propId(p)}:${mode}`;
    if (this.beliefs.has(id)) return this.beliefs.get(id)!;
    if (!supports.every((s) => this.supportHolds(s))) return null;
    const rank = MODE_RANK[mode];
    const rivals = this.inBeliefs(owner).filter((b) => contradicts(b.prop, p));
    // Someone who saw it for themselves isn't talked out of it.
    if (rivals.some((r) => MODE_RANK[r.mode] > rank)) return null;
    const b: Belief = { id, owner, prop: p, mode, confidence: Math.max(0, Math.min(1, confidence)), supports, via, text, eventId: e.id, since: e.seq, sinceTime: e.occurredAt, until: null, untilTime: null, status: 'in' };
    for (const r of rivals) {
      if (MODE_RANK[r.mode] < rank) {
        r.status = 'out';
        r.until = e.seq;
        r.untilTime = e.occurredAt;
        r.outReason = `revised: ${mode === 'observed' ? 'saw otherwise' : `${mode} otherwise`}`;
        // A claim proven false costs the teller trust.
        if ((r.mode === 'told' || r.mode === 'rumor') && r.via[0] && mode === 'observed') this.nudge(owner, r.via[0], { trust: -0.3, suspicion: 0.3 }, e.id);
        this.withdraw(r.id, `${this.name(owner)} learned otherwise`, e.seq, e.occurredAt);
      } else {
        r.contested = true;
        b.contested = true;
      }
    }
    this.beliefs.set(id, b);
    this.depend(id, supports);
    this.updateHypotheses(owner, b, e.seq);
    return b;
  }

  // -------------------------------------------------------------- hypotheses (superposition)

  private openHypothesis(e: EchoEvent, seed: NonNullable<EchoEvent['hypotheses']>[number]) {
    const id = `hyp:${seed.owner}:${seed.question.toLowerCase().trim()}`;
    if (this.hypotheses.has(id)) return;
    const paranoia = this.cfg.traits[seed.owner]?.paranoia ?? 0;
    const prior = new Map<string, number>();
    const options = seed.options.map((o, i) => {
      const oid = `${id}#${i}`;
      const w = Math.max(0.001, o.weight) * (o.sinister ? 1 + 2 * paranoia : 1);
      prior.set(oid, w);
      return { id: oid, label: o.label, prop: normProp(o.prop), amplitude: w, sinister: !!o.sinister, support: [] as string[], contra: [] as string[] };
    });
    const total = options.reduce((s, o) => s + o.amplitude, 0) || 1;
    for (const o of options) o.amplitude = o.amplitude / total;
    this.hypPrior.set(id, prior);
    this.hypEvidence.set(id, []);
    const set: HypothesisSet = { id, owner: seed.owner, question: seed.question, options, status: 'open', eventId: e.id, since: e.seq, history: [] };
    this.hypotheses.set(id, set);
    set.history.push({ seq: e.seq, amplitudes: Object.fromEntries(options.map((o) => [o.id, round(o.amplitude)])), why: 'formed' });
    // Evidence the owner already has counts from the start.
    for (const b of this.inBeliefs(seed.owner)) this.updateHypotheses(seed.owner, b, e.seq, id);
  }

  private credibility(b: Belief): number {
    if (b.mode === 'observed') return 1;
    if (b.mode === 'common') return 0.8;
    if (b.mode === 'told') return b.via[0] ? this.trust(b.owner, b.via[0]) : 0.6;
    if (b.mode === 'rumor') return 0.5 * (b.via[0] ? this.trust(b.owner, b.via[0]) : 0.6);
    return 0.5;
  }

  private updateHypotheses(owner: ActorId, b: Belief, seq: number, only?: string) {
    const cred = this.credibility(b) * (this.cfg.traits[owner]?.credulity ?? 1);
    for (const set of this.hypotheses.values()) {
      if (set.owner !== owner || (only && set.id !== only)) continue;
      const ev = this.hypEvidence.get(set.id)!;
      let touched = false;
      for (const o of set.options) {
        if (propId(o.prop) === propId(b.prop)) {
          ev.push({ beliefId: b.id, optionId: o.id, factor: 1 + 3 * b.confidence * cred });
          o.support.push(b.id);
          touched = true;
        } else if (contradicts(o.prop, b.prop)) {
          ev.push({ beliefId: b.id, optionId: o.id, factor: Math.max(0.05, 1 - 0.85 * b.confidence * cred) });
          o.contra.push(b.id);
          touched = true;
        }
      }
      if (touched) {
        this.depend(`hypset:${set.id}`, [b.id]);
        this.recompute(set, seq, `${b.mode}: ${b.text}`);
      }
    }
  }

  private recomputeHypotheses(owner: ActorId, seq: number, why: string) {
    for (const set of this.hypotheses.values()) if (set.owner === owner) this.recompute(set, seq, why);
  }

  private recompute(set: HypothesisSet, seq: number, why: string) {
    const prior = this.hypPrior.get(set.id)!;
    const ev = this.hypEvidence.get(set.id) ?? [];
    for (const o of set.options) {
      let a = prior.get(o.id) ?? 0.001;
      for (const x of ev) if (x.optionId === o.id && this.beliefs.get(x.beliefId)?.status === 'in') a *= x.factor;
      o.amplitude = a;
    }
    const total = set.options.reduce((s, o) => s + o.amplitude, 0) || 1;
    for (const o of set.options) o.amplitude = o.amplitude / total;
    const top = set.options.slice().sort((a, b) => b.amplitude - a.amplitude)[0];
    // Resolved only by first-hand evidence and a clear winner; never into canon.
    const firstHand = top && top.support.some((id) => this.beliefs.get(id)?.status === 'in' && this.beliefs.get(id)?.mode === 'observed');
    if (top && top.amplitude >= 0.85 && firstHand) {
      set.status = 'resolved';
      set.resolvedTo = top.id;
    } else {
      set.status = 'open';
      delete set.resolvedTo;
    }
    const prev = set.history[set.history.length - 1];
    const amps = Object.fromEntries(set.options.map((o) => [o.id, round(o.amplitude)]));
    if (!prev || JSON.stringify(prev.amplitudes) !== JSON.stringify(amps)) set.history.push({ seq, amplitudes: amps, why });
  }

  // -------------------------------------------------------------- canon (bitemporal facts, lazy canon)

  currentFacts(): FactVersion[] {
    return this.facts.filter((f) => f.validTo === null);
  }

  /** Canonical value(s) of a slot at a story seq (default: now). */
  factAt(s: string, p: string, seq = Infinity): FactVersion[] {
    const k = slotKey({ s, p });
    return this.facts.filter((f) => slotKey(f) === k && f.validFrom <= seq && (f.validTo === null || f.validTo > seq));
  }

  /** Canonical value(s) of a slot at a world time. */
  factAtTime(s: string, p: string, time: number): FactVersion[] {
    const k = slotKey({ s, p });
    return this.facts.filter((f) => slotKey(f) === k && f.validFromTime <= time && (f.validToTime === null || f.validToTime > time));
  }

  isCanonical(p: Prop): boolean {
    const vals = this.factAt(p.s, p.p);
    const hit = vals.some((f) => f.o === normProp(p).o && !f.neg);
    return p.neg ? !hit && vals.some((f) => f.o === normProp(p).o && f.neg) : hit;
  }

  /** Check a value against an undetermined slot's constraints. */
  static satisfies(u: Pick<Undetermined, 'constraints'>, value: string): { ok: boolean; why?: string } {
    const v = value.toLowerCase().trim();
    for (const c of u.constraints) {
      const vals = c.values.map((x) => x.toLowerCase().trim());
      if (c.kind === 'oneOf' && !vals.includes(v)) return { ok: false, why: `must be one of ${vals.join(', ')}${c.why ? ` (${c.why})` : ''}` };
      if (c.kind === 'not' && vals.includes(v)) return { ok: false, why: `cannot be ${v}${c.why ? ` (${c.why})` : ''}` };
      if (c.kind === 'matches' && !vals.some((x) => v.includes(x))) return { ok: false, why: `must fit: ${vals.join(' / ')}${c.why ? ` (${c.why})` : ''}` };
    }
    return { ok: true };
  }

  /** Candidates still possible for an open slot. */
  possible(key: string): string[] {
    const u = this.undetermined.get(key);
    if (!u) return [];
    return u.candidates.filter((c) => Projector.satisfies(u, c).ok);
  }

  private commitFact(e: EchoEvent, raw: Prop) {
    const p = normProp(raw);
    const key = slotKey(p);
    const u = this.undetermined.get(key);
    if (u && u.status !== 'collapsed' && !p.neg) {
      const pre = this.predecided.get(key);
      if (pre !== undefined && pre !== p.o) {
        this.violations.push({ kind: 'predecided-mismatch', eventId: e.id, messageId: e.messageId, detail: `${u.label}: the author decided "${pre}", the story said "${p.o}"` });
        return;
      }
      const check = Projector.satisfies(u, p.o);
      if (!check.ok) {
        this.violations.push({ kind: 'collapse-constraint', eventId: e.id, messageId: e.messageId, detail: `${u.label}: "${p.o}" ${check.why}` });
        return;
      }
      u.status = 'collapsed';
      u.value = p.o;
      u.collapsedBy = e.id;
    }
    const open = this.facts.filter((f) => slotKey(f) === key && f.validTo === null);
    const multi = MULTI_PREDICATES.has(p.p);
    const same = open.find((f) => f.o === p.o && !!f.neg === !!p.neg);
    if (same) {
      if (!same.sourceEventIds.includes(e.id)) same.sourceEventIds.push(e.id);
      return;
    }
    for (const f of open) {
      const closes = multi ? f.o === p.o : true;
      if (closes) {
        f.validTo = e.seq;
        f.validToTime = e.occurredAt;
      }
    }
    if (p.neg && multi) return; // "no longer has X" closes it and is not itself a standing fact
    this.facts.push({ id: `fact:${e.id}:${propId(p)}`, s: p.s, p: p.p, o: p.o, ...(p.neg ? { neg: true } : {}), validFrom: e.seq, validFromTime: e.occurredAt, validTo: null, validToTime: null, sourceEventIds: [e.id], status: u ? 'collapsed' : 'canonical' });
  }

  // -------------------------------------------------------------- groups

  groupsOf(actor: ActorId, seq = Infinity): string[] {
    return [...new Set(this.memberships.filter((m) => m.actor === actor && m.from <= seq && (m.to === null || m.to > seq)).map((m) => m.group))];
  }

  // -------------------------------------------------------------- apply

  apply(e: EchoEvent): void {
    if (this.events.has(e.id)) return;
    if (e.seq < this.lastSeq) throw new Error(`ECHO: event ${e.id} is out of order (seq ${e.seq} < ${this.lastSeq}); replay instead`);
    this.events.set(e.id, e);
    this.order.push(e.id);
    this.lastSeq = e.seq;
    this.lastTime = Math.max(this.lastTime, e.occurredAt);

    // Episodes: same place, no long gap.
    const loc = e.locationId ?? '∅';
    const ep = this.episodes.get(loc);
    const episodeId = ep && e.occurredAt - ep.last <= this.cfg.episodeGap ? ep.id : `ep:${e.id}`;
    this.episodes.set(loc, { id: episodeId, last: e.occurredAt });

    for (const g of e.groupJoin ?? []) this.memberships.push({ actor: g.actor, group: g.group, from: e.seq, to: null });
    for (const g of e.groupLeave ?? []) for (const m of this.memberships) if (m.actor === g.actor && m.group === g.group && m.to === null) m.to = e.seq;
    for (const c of e.common ?? []) this.common.push({ group: c.group, prop: normProp(c.prop), text: c.text, eventId: e.id, seq: e.seq });

    for (const u of e.undetermined ?? []) {
      const key = slotKey(u);
      if (this.undetermined.has(key)) continue;
      const pre = this.predecided.get(key);
      this.undetermined.set(key, { key, s: u.s.toLowerCase().trim(), p: u.p.toLowerCase().trim(), label: u.label, candidates: (u.candidates ?? []).map((c) => c.toLowerCase().trim()), constraints: [], status: pre !== undefined ? 'predecided' : 'open', ...(pre !== undefined ? { value: pre } : {}), since: e.seq });
    }
    for (const c of e.constrains ?? []) {
      const u = this.undetermined.get(slotKey(c));
      if (u && u.status !== 'collapsed') u.constraints.push({ ...c.constraint, eventId: e.id });
    }

    // Canon: only validated outcomes. An attempt is not a success.
    const succeeded = e.outcome === 'success' || (!e.attempted && e.outcome !== 'failure');
    if (e.establishes?.length) {
      if (succeeded) for (const p of e.establishes) this.commitFact(e, p);
      else if (e.attempted && e.outcome === 'unknown') this.violations.push({ kind: 'attempt-as-success', eventId: e.id, messageId: e.messageId, detail: `"${clip(e.action, 80)}" was attempted with no outcome; its changes were not applied` });
    }
    const established = succeeded ? (e.establishes ?? []).map(normProp) : [];

    // Perception → observations, first-hand beliefs, memory units.
    const perceived = e.unresolved ? perceiveUnresolved(e) : perceive(e, this.cfg.noticeThreshold);
    const observed = new Map<string, Prop[]>();
    for (const pc of perceived) {
      const obsId = `obs:${e.id}:${pc.actor}`;
      this.observations.push({ id: obsId, owner: pc.actor, eventId: e.id, level: pc.level, details: pc.details, channels: pc.channels, seq: e.seq, at: e.occurredAt });
      const props: Prop[] = [];
      for (const c of pc.cues) for (const p of c.props ?? []) props.push(normProp(p));
      if (pc.level === 'content') props.push(...established);
      const uniq = [...new Map(props.map((p) => [propId(p), p])).values()];
      observed.set(pc.actor, uniq);
      for (const p of uniq) this.addBelief(e, pc.actor, p, 'observed', revealAtLeast(pc.level, 'identity') ? 1 : 0.8, [obsId], propText(p, this.cfg.names));
      this.units.push(this.unitFor(e, pc, episodeId, uniq));
    }

    // Testimony: "X said P" is a record, not P. Accepted claims become told/rumor beliefs.
    const speaker = e.actors[0];
    if (speaker && e.claims?.length) {
      for (const pc of perceived) {
        if (pc.actor === speaker || pc.level !== 'content') continue;
        e.claims.forEach((cl, i) => {
          const listener = pc.actor;
          const tesId = `tes:${e.id}:${listener}:${i}`;
          const own = this.holds(speaker, cl.prop);
          const via = [speaker, ...(own && (own.mode === 'told' || own.mode === 'rumor') ? own.via : [])].slice(0, 6);
          const trust = this.trust(listener, speaker) * (this.cfg.traits[listener]?.credulity ?? 1);
          const accepted = trust >= this.cfg.acceptThreshold;
          this.testimonies.push({ id: tesId, speaker, listener, claim: { prop: normProp(cl.prop), text: cl.text }, eventId: e.id, accepted, seq: e.seq, at: e.occurredAt });
          if (accepted) {
            const mode: BeliefMode = via.length > 1 ? 'rumor' : 'told';
            const text = via.length > 1 ? `${this.name(via[0])} said (heard from ${via.slice(1).map((v) => this.name(v)).join(' via ')}): ${cl.text}` : `${this.name(speaker)} said: ${cl.text}`;
            this.addBelief(e, listener, cl.prop, mode, trust * Math.pow(0.85, via.length - 1), [tesId], text, via);
          }
          // Each side knows what the other now has (depth 2).
          this.addHigher(e, listener, [{ about: speaker, kind: 'believes' }], cl.prop, [tesId], `${this.name(listener)} thinks ${this.name(speaker)} believes ${cl.text}`);
          this.addHigher(e, speaker, [{ about: listener, kind: 'knows' }], cl.prop, [`obs:${e.id}:${speaker}`], `${this.name(speaker)} told ${this.name(listener)}: ${cl.text}`);
        });
      }
    }

    // Co-witnesses: A saw B see it → A believes B knows it. Secrets: the parties know the others know.
    const content = perceived.filter((p) => p.level !== 'presence').slice(0, 8);
    for (const a of content) {
      for (const b of content) {
        if (a.actor === b.actor) continue;
        const shared = (observed.get(a.actor) ?? []).filter((p) => (observed.get(b.actor) ?? []).some((q) => propId(q) === propId(p)));
        if (!shared.length) continue;
        const mutual = e.visibility !== 'public' ? e.actors.includes(a.actor) || e.recipients.includes(a.actor) : sawEachOther(e, a.actor, b.actor);
        if (!mutual) continue;
        for (const p of shared.slice(0, 4)) this.addHigher(e, a.actor, [{ about: b.actor, kind: 'knows' }], p, [`obs:${e.id}:${a.actor}`], `${this.name(a.actor)} knows ${this.name(b.actor)} knows: ${propText(p, this.cfg.names)}`);
      }
    }
    for (const m of e.meta ?? []) {
      if (m.chain.length + 1 > this.cfg.maxDepth) continue;
      const k = perceived.find((p) => p.actor === m.owner);
      if (!k) continue;
      this.addHigher(e, m.owner, m.chain, m.prop, [`obs:${e.id}:${m.owner}`], `${this.name(m.owner)} ${m.chain.map((c) => `${c.kind === 'knows' ? 'thinks' : 'thinks'} ${this.name(c.about)} ${c.kind}`).join(' that ')} ${propText(m.prop, this.cfg.names)}`);
    }

    // Inferences and reflections rest on the beliefs they came from.
    for (const inf of e.infers ?? []) {
      const from = inf.from.map((p) => this.holds(inf.owner, p));
      if (from.some((b) => !b)) continue;
      this.addBelief(e, inf.owner, inf.prop, inf.reflection ? 'reflection' : 'inferred', Math.min(...from.map((b) => b!.confidence)) * 0.8, from.map((b) => b!.id), inf.text);
    }
    for (const c of e.corrects ?? []) {
      for (const b of this.inBeliefs(c.owner)) {
        if (propId(b.prop) !== propId(normProp(c.prop))) continue;
        b.status = 'out';
        b.until = e.seq;
        b.untilTime = e.occurredAt;
        b.outReason = c.reason;
        this.withdraw(b.id, c.reason, e.seq, e.occurredAt);
      }
    }

    for (const h of e.hypotheses ?? []) if (perceived.some((p) => p.actor === h.owner) || e.actors.includes(h.owner)) this.openHypothesis(e, h);

    // Commitments: prospective memory; keeping or breaking one moves trust for those who learn of it.
    if (e.commitment) {
      const knownBy = perceived.filter((p) => p.level === 'content').map((p) => p.actor);
      this.commitments.set(e.commitment.id, { id: e.commitment.id, by: e.commitment.by, to: e.commitment.to, what: e.commitment.what, due: e.commitment.due ?? null, status: 'open', eventId: e.id, since: e.seq, knownBy });
    }
    if (e.commitmentUpdate) {
      const c = this.commitments.get(e.commitmentUpdate.id);
      if (c) {
        c.status = e.commitmentUpdate.status;
        const learners = new Set(perceived.filter((p) => revealAtLeast(p.level, 'behavior')).map((p) => p.actor));
        for (const to of c.to) {
          if (!learners.has(to)) continue;
          if (c.status === 'broken') {
            this.nudge(to, c.by, { trust: -0.3, resentment: 0.35 }, e.id);
            if (learners.has(c.by)) this.addHigher(e, c.by, [{ about: to, kind: 'knows' }], { s: c.by, p: 'broke_promise_to', o: to }, [`obs:${e.id}:${c.by}`], `${this.name(c.by)} knows ${this.name(to)} knows the promise was broken`);
          } else this.nudge(to, c.by, { trust: 0.1, attachment: 0.1 }, e.id);
        }
        if (c.status === 'broken') this.emotions.set(c.by, { actor: c.by, emotion: 'guilt', intensity: 0.5, toward: c.to[0], seq: e.seq, at: e.occurredAt });
      }
    }

    for (const em of e.emotions ?? []) this.emotions.set(em.actor, { actor: em.actor, emotion: em.emotion, intensity: Math.max(0, Math.min(1, em.intensity)), toward: em.toward, seq: e.seq, at: e.occurredAt });
    for (const r of e.relations ?? []) {
      // Feelings change only for someone who perceived the event.
      if (!perceived.some((p) => p.actor === r.from)) continue;
      this.nudge(r.from, r.to, { trust: r.trust ?? 0, attachment: r.attachment ?? 0, suspicion: r.suspicion ?? 0, resentment: r.resentment ?? 0 }, e.id);
    }
  }

  private addHigher(e: EchoEvent, owner: ActorId, chain: HigherOrder['chain'], raw: Prop, supports: string[], text: string) {
    const depth = chain.length + 1;
    if (depth > this.cfg.maxDepth) return;
    const p = normProp(raw);
    const id = `ho:${owner}:${chain.map((c) => `${c.about}/${c.kind}`).join('>')}:${propId(p)}`;
    const cur = this.higher.get(id);
    if (cur && cur.status === 'in') return;
    const h: HigherOrder = { id, owner, chain, prop: p, text, depth, supports, since: e.seq, until: null, status: 'in' };
    this.higher.set(id, h);
    this.depend(id, supports);
  }

  private unitFor(e: EchoEvent, pc: Perceived, episodeId: string, props: Prop[]): MemoryUnit {
    const full = pc.level === 'content';
    const l1 = clip(full ? e.action : pc.details.join(' '), 320);
    const isActor = e.actors.includes(pc.actor);
    const recognised = e.observers.find((o) => o.actor === pc.actor)?.recognises !== false;
    const entities = new Set<string>();
    if (full) for (const x of [...e.actors, ...e.targets, ...e.recipients]) entities.add(x);
    else if (recognised) for (const a of e.actors) entities.add(a);
    for (const p of props) {
      entities.add(p.s);
      if (/^[a-z0-9_:]+$/.test(p.o) && p.o.length < 40) entities.add(p.o);
    }
    entities.delete(pc.actor);
    const kind: MemoryType = e.commitment ? 'prospective' : e.importance >= 3 && isActor ? 'autobiographical' : e.type === 'speech' || e.relations?.length ? 'social' : 'episodic';
    const emotion = Math.max(0, ...(e.emotions ?? []).filter((x) => x.actor === pc.actor).map((x) => x.intensity));
    const attributes = attributesOf(`${l1} ${pc.cues.map((c) => c.detail).join(' ')}`, e.occurredAt);
    const nameWords = [...entities].flatMap((id) => words(this.cfg.names[id] ?? ''));
    // The memory's own sensory signature (what can bring it back unbidden).
    const sensory = pc.cues.filter((c) => c.channel === 'smell' || c.channel === 'sound').flatMap((c) => words(c.detail)).flatMap((w) => [w, `sense:${w}`]);
    const triggers = [
      ...entities,
      ...(e.locationId ? [e.locationId] : []),
      `type:${e.type}`,
      ...(e.commitment ? ['promise', `commitment:${e.commitment.id}`] : []),
      ...attributes,
      ...nameWords,
      ...sensory,
      ...words(l1).slice(0, 12),
    ];
    return {
      id: `mu:${e.id}:${pc.actor}`,
      owner: pc.actor,
      eventId: e.id,
      episodeId,
      level: pc.level,
      status: 'experienced',
      kind,
      l0: gist(l1),
      l1,
      quoteAllowed: full && !!e.quote,
      entities: [...entities],
      locationId: e.locationId,
      occurredAt: e.occurredAt,
      seq: e.seq,
      importance: e.importance,
      emotion,
      triggers: [...new Set(triggers.map((t) => t.toLowerCase()))],
      attributes,
      via: [],
      causes: e.causes.slice(0, 8),
      ...(e.commitment ? { commitmentId: e.commitment.id } : {}),
    };
  }

  /** Owner edits that act on the finished projection (retracting a belief propagates). */
  finish(): this {
    for (const op of this.manual) {
      if (op.kind !== 'retract-belief') continue;
      const b = this.beliefs.get(op.beliefId);
      if (!b || b.status === 'out') continue;
      b.status = 'out';
      b.until = this.lastSeq;
      b.untilTime = this.lastTime;
      b.outReason = 'retracted by the author';
      this.withdraw(b.id, 'retracted by the author', this.lastSeq, this.lastTime);
    }
    return this;
  }
}

/**
 * Migration events (§13): the legacy row's recorded witnesses are its only observers. When none
 * were recorded the knowledge is unresolved and granted to nobody — never to everyone.
 */
function perceiveUnresolved(e: EchoEvent): Perceived[] {
  return e.actors.map((a) => ({ actor: a, level: 'content' as const, details: [e.action], channels: ['sight' as const], cues: [], reason: 'recorded witness (migrated memory)' }));
}

/**
 * The active branch: an event is live when its message is on the active path with the same swipe
 * (or it has no message: manual and always-live records). `path`: messageId → active swipe.
 */
export function onBranch<T extends Pick<EchoEvent, 'messageId' | 'swipeId'>>(events: T[], path: ReadonlyMap<string, number>): T[] {
  return events.filter((e) => e.messageId === null || (path.has(e.messageId) && (e.swipeId === null || path.get(e.messageId) === e.swipeId)));
}

/** A stable identity for the active leaf (cache key; changes whenever the path changes). */
export function leafKey(path: ReadonlyMap<string, number>): string {
  let h = 0x811c9dc5;
  const parts = [...path].map(([m, s]) => `${m}:${s}`).join('|');
  for (let i = 0; i < parts.length; i++) {
    h ^= parts.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${path.size}-${(h >>> 0).toString(36)}`;
}

function round(x: number) {
  return Math.round(x * 1000) / 1000;
}

/** Replay a log (sorted by seq) into a finished projection. */
export function project(events: EchoEvent[], cfg: Partial<ProjectorConfig> = {}, manual: ManualOp[] = []): Projector {
  const p = new Projector(cfg, manual);
  for (const e of events.slice().sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id))) p.apply(e);
  return p.finish();
}
