/**
 * The Epistemic Access Engine (§5). The only way from a projection to anything that can reach a
 * prompt. Authorization happens here, BEFORE ranking, summarising or compiling: recall and the
 * compiler accept only an AuthorizedView, which only this module can make.
 *
 * The perspective comes from trusted server-side context. Nothing a model supplies can widen it:
 * the recall tool takes a query, never an actor or a scope.
 *
 * What an actor's view never contains: other actors' private thoughts, events they did not
 * perceive, the hidden detail of events they perceived only partly, whether their beliefs are
 * true (a lie they believe is just a belief to them), the player's out-of-character notes, the
 * future (relative to the query time), and anything from another branch (the projection is built
 * from the active branch only, and the view checks it was built for the same leaf).
 */
import { contradicts, propId, propText } from './props.js';
import type { Projector } from './projector.js';
import type { ActorId, Belief, Commitment, EmotionState, EpistemicStatus, HigherOrder, HypothesisSet, MemoryUnit, Prop, Relationship, Testimony, Undetermined } from './types.js';

export type AccessScope = 'actor' | 'persona-narrator' | 'omniscient' | 'adjudicator';

export interface Perspective {
  actorId: ActorId;
  storyId: string;
  /** Identity of the active branch leaf the projection was built for. */
  leaf: string;
  sceneId?: string | null;
  /** Story seq the view is taken at (default: now). Historical queries pass an earlier one. */
  atSeq?: number;
  /** World time the view is taken at (alternative to atSeq). */
  atTime?: number;
  informationType?: 'all' | 'memories' | 'beliefs' | 'social';
  accessScope: AccessScope;
}

declare const AUTHORIZED: unique symbol;

export interface ViewBelief {
  id: string;
  prop: Prop;
  text: string;
  status: EpistemicStatus;
  confidence: number;
  via: ActorId[];
  contested: boolean;
  /** Omniscient/adjudicator views only: whether the world agrees. */
  truth?: 'true' | 'false' | 'unknown';
}

export interface ViewUnit extends MemoryUnit {
  /** Drift overlay (subjective recollection), when the author enabled it. */
  drift?: string;
  /** Exact source text, only when quoteAllowed. */
  quote?: string;
}

export interface AuthorizedView {
  readonly [AUTHORIZED]: true;
  readonly perspective: Readonly<Perspective>;
  readonly units: ViewUnit[];
  readonly beliefs: ViewBelief[];
  readonly doubted: Testimony[];
  readonly hypotheses: HypothesisSet[];
  readonly higher: HigherOrder[];
  readonly commitments: Commitment[];
  readonly relations: Relationship[];
  readonly emotion: EmotionState | null;
  readonly common: Array<{ group: string; text: string; prop: Prop }>;
  /** Things the actor knows they don't know ("saw something put in the drawer, not what"). */
  readonly unknowns: string[];
  /** Adjudicator/omniscient only. */
  readonly undetermined: Undetermined[];
  /** id → why it is in this view (the leakage debugger). */
  readonly reasons: ReadonlyMap<string, string>;
}

export class AccessError extends Error {}

const STATUS_OF: Record<Belief['mode'], EpistemicStatus> = { observed: 'experienced', told: 'told', rumor: 'rumored', inferred: 'inferred', reflection: 'inferred', common: 'common' };

/** Whether a projection belongs to the leaf a perspective asks for. */
export interface LeafTagged {
  leaf: string;
  storyId: string;
}

export function authorize(proj: Projector & Partial<LeafTagged>, persp: Perspective, sources?: { quote?: (eventId: string) => string | undefined }): AuthorizedView {
  if (proj.leaf !== undefined && proj.leaf !== persp.leaf) throw new AccessError(`ECHO: projection built for leaf ${proj.leaf}, asked for ${persp.leaf}`);
  if (proj.storyId !== undefined && proj.storyId !== persp.storyId) throw new AccessError('ECHO: projection belongs to another story');
  const privileged = persp.accessScope === 'omniscient' || persp.accessScope === 'adjudicator';
  const actor = persp.accessScope === 'persona-narrator' ? 'player' : persp.actorId;
  const at = persp.atSeq ?? (persp.atTime !== undefined ? seqAtTime(proj, persp.atTime) : Infinity);
  const live = (since: number, until: number | null) => since <= at && (until === null || until > at);
  const reasons = new Map<string, string>();
  const suppressed = new Set(proj.manual.filter((o) => (o.kind === 'suppress' || o.kind === 'forget')).map((o) => (o as { unitId: string }).unitId));
  const drift = new Map(proj.manual.filter((o) => o.kind === 'drift').map((o) => [(o as { unitId: string }).unitId, (o as { note: string }).note]));

  const units: ViewUnit[] = [];
  for (const u of proj.units) {
    if (!privileged && u.owner !== actor) continue;
    if (u.seq > at) continue;
    if (suppressed.has(u.id) && !privileged) continue;
    const v: ViewUnit = { ...u };
    if (drift.has(u.id)) v.drift = drift.get(u.id);
    if (u.quoteAllowed) v.quote = sources?.quote?.(u.eventId) ?? proj.events.get(u.eventId)?.quote;
    units.push(v);
    reasons.set(u.id, privileged ? `${persp.accessScope} view` : `${u.level === 'content' ? 'perceived' : `perceived partly (${u.level})`} by ${proj.name(actor)}`);
  }

  const beliefs: ViewBelief[] = [];
  for (const b of proj.beliefs.values()) {
    if (!privileged && b.owner !== actor) continue;
    if (!live(b.since, b.until)) continue;
    if (b.until === null && b.status === 'out' && at === Infinity) continue;
    const vb: ViewBelief = { id: b.id, prop: b.prop, text: b.text, status: STATUS_OF[b.mode], confidence: b.confidence, via: b.via, contested: !!b.contested };
    if (privileged) vb.truth = proj.isCanonical(b.prop) ? 'true' : proj.factAt(b.prop.s, b.prop.p).some((f) => contradicts(f, b.prop)) ? 'false' : 'unknown';
    beliefs.push(vb);
    reasons.set(b.id, privileged ? `${persp.accessScope} view` : `${proj.name(actor)}'s own belief (${b.mode}${b.via.length ? ` via ${b.via.map((x) => proj.name(x)).join(' → ')}` : ''})`);
  }

  const doubted = proj.testimonies.filter((t) => (privileged || t.listener === actor) && !t.accepted && t.seq <= at);
  for (const t of doubted) reasons.set(t.id, `${proj.name(t.listener)} heard ${proj.name(t.speaker)} say it`);

  const hypotheses = [...proj.hypotheses.values()].filter((h) => (privileged || h.owner === actor) && h.since <= at);
  for (const h of hypotheses) reasons.set(h.id, `${proj.name(h.owner)}'s own suspicion`);

  const higher = [...proj.higher.values()].filter((h) => (privileged || h.owner === actor) && live(h.since, h.until) && (h.status === 'in' || at !== Infinity));
  for (const h of higher) reasons.set(h.id, `${proj.name(h.owner)}'s belief about what others know`);

  const commitments = [...proj.commitments.values()].filter((c) => (privileged || c.knownBy.includes(actor)) && c.since <= at);
  for (const c of commitments) reasons.set(`commitment:${c.id}`, privileged ? `${persp.accessScope} view` : `${proj.name(actor)} was there when it was promised`);

  const relations = [...proj.relations.values()].filter((r) => privileged || r.from === actor);
  const emotion = proj.emotions.get(actor) ?? null;

  const groups = new Set(proj.groupsOf(actor, at));
  const common = proj.common.filter((c) => (privileged || groups.has(c.group)) && c.seq <= at).map((c) => ({ group: c.group, text: c.text, prop: c.prop }));
  for (const c of common) reasons.set(`common:${c.group}:${propId(c.prop)}`, `common knowledge of ${c.group}`);

  const unknowns: string[] = [];
  for (const u of units) {
    if (u.owner !== actor || u.level === 'content') continue;
    if (u.level === 'behavior' || u.level === 'presence') unknowns.push(`${u.l0} — but not what exactly`);
  }
  for (const h of hypotheses) if (h.status === 'open' && h.owner === actor) unknowns.push(`open question: ${h.question}`);

  const undetermined = privileged ? [...proj.undetermined.values()] : [];
  return { perspective: Object.freeze({ ...persp }), units, beliefs, doubted, hypotheses, higher, commitments, relations, emotion, common, unknowns: unknowns.slice(0, 6), undetermined, reasons } as unknown as AuthorizedView;
}

function seqAtTime(proj: Projector, time: number): number {
  let best = -Infinity;
  for (const id of proj.order) {
    const e = proj.events.get(id)!;
    if (e.occurredAt <= time) best = Math.max(best, e.seq);
  }
  return best;
}

/** "What did Anna believe about Ben at 21:00 yesterday?" */
export function beliefsAbout(proj: Projector & Partial<LeafTagged>, owner: ActorId, about: string, opts: { leaf: string; storyId: string; atTime?: number; atSeq?: number }): ViewBelief[] {
  const v = authorize(proj, { actorId: owner, storyId: opts.storyId, leaf: opts.leaf, atTime: opts.atTime, atSeq: opts.atSeq, accessScope: 'actor' });
  const a = about.toLowerCase();
  return v.beliefs.filter((b) => b.prop.s === a || b.prop.o === a || b.text.toLowerCase().includes(a));
}

/** Plain rendering of a view belief with its source. */
export function beliefLine(b: ViewBelief, names: Record<string, string> = {}): string {
  const how = b.status === 'experienced' ? 'saw it' : b.status === 'told' ? `told by ${names[b.via[0]] ?? b.via[0]}` : b.status === 'rumored' ? `rumor via ${b.via.map((v) => names[v] ?? v).join(' → ')}` : b.status === 'common' ? 'common knowledge' : 'worked it out';
  return `${b.text || propText(b.prop, names)} (${how}${b.confidence < 0.6 ? ', not sure' : ''}${b.contested ? ', contested' : ''})`;
}
