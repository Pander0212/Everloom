/**
 * Narrative Context Compiler (§8.1), Affordance Engine (§8.2) and the separate context builders
 * (§5.4). Turns an AuthorizedView + recall hits into a small, bounded context packet.
 *
 * - Every line keeps its epistemic status and source ("told by Anna", "saw it", "not sure").
 * - Contradictory beliefs stay separate lines; nothing is merged into one confident statement.
 * - Memories say who remembers, how they know, and why it matters now. Detail is the smallest that
 *   suffices: L0 gist, L1 account, L2 exact words only when asked for and allowed.
 * - Affordances are suggestions, rotated, never orders.
 * - The packet is empty when nothing is relevant: story length never sets prompt length.
 */
import { authorize, beliefLine, type AccessScope, type AuthorizedView, type Perspective, type ViewBelief } from './access.js';
import type { Projector, Violation } from './projector.js';
import { propText } from './props.js';
import type { QueryUnderstanding } from './query.js';
import { recallMemories, type RecallHit, type RecallOptions, type RecallResult, type RecallSignals, type RecallState, type SceneCues } from './recall.js';
import { hashString } from '../util/rng.js';
import type { ActorId, Undetermined } from './types.js';

export interface Affordance {
  id: string;
  text: string;
  weight: number;
}

export interface PacketLine {
  section: SectionId;
  text: string;
  /** The record that justified it (for the leakage debugger). */
  source: string;
  reason: string;
  priority: number;
}

export type SectionId = 'constraints' | 'established' | 'beliefs' | 'memories' | 'relations' | 'commitments' | 'affordances' | 'adjudication';

const HEADINGS: Record<SectionId, string> = {
  constraints: 'Hard constraints',
  established: 'Established (as {name} knows it)',
  beliefs: 'Beliefs, suspicions, uncertainty',
  memories: 'Relevant memories',
  relations: 'Relationships and feelings',
  commitments: 'Goals and commitments',
  affordances: 'Possible reactions (suggestions, not orders)',
  adjudication: 'Undecided details (for the narrator)',
};

export interface ContextPacket {
  text: string;
  tokens: number;
  lines: PacketLine[];
  dropped: number;
  affordances: string[];
  recall: RecallResult;
  perspective: Perspective;
}

export interface CompileInput {
  view: AuthorizedView;
  query: QueryUnderstanding;
  scene: SceneCues & { place?: string; time?: string };
  names: Record<string, string>;
  signals?: RecallSignals;
  state?: RecallState;
  recall?: RecallOptions;
  /** Max tokens for the whole packet (default 700). */
  budget?: number;
  countTokens?: (s: string) => number;
  /** Affordance ids used in the last few turns (rotation). */
  recentAffordances?: string[];
  /** Show hypotheses (Balanced and up). */
  hypotheses?: boolean;
  /** Undecided world details + a seed for re-rollable suggestions (narrator builders only). */
  adjudication?: { slots: Undetermined[]; possible: (key: string) => string[]; seed: string };
}

const approxTokens = (s: string) => Math.ceil(s.length / 4);

export function affordances(view: AuthorizedView, self: ActorId, present: string[], names: Record<string, string>, recent: string[] = [], nowTime?: number): Affordance[] {
  const n = (id: string) => names[id] ?? id;
  const out: Affordance[] = [];
  for (const r of view.relations) {
    if (r.from !== self || !present.includes(r.to)) continue;
    if (r.resentment >= 0.3 || r.trust <= 0.3) out.push({ id: `guarded:${r.to}`, text: `may be guarded or hesitant with ${n(r.to)} (trust is low)`, weight: 1 + r.resentment });
    if (r.suspicion >= 0.3) out.push({ id: `probe:${r.to}`, text: `may probe ${n(r.to)} indirectly rather than accuse`, weight: 0.8 + r.suspicion });
    if (r.attachment >= 0.4) out.push({ id: `warm:${r.to}`, text: `small signs of warmth toward ${n(r.to)}`, weight: 0.6 + r.attachment });
  }
  for (const c of view.commitments) {
    if (c.status !== 'open') continue;
    const other = [c.by, ...c.to].find((x) => x !== self && present.includes(x));
    if (other) out.push({ id: `promise:${c.id}`, text: `the promise (${c.what}) may come to mind with ${n(other)} here`, weight: 1.2 });
  }
  for (const h of view.hypotheses) {
    if (h.owner !== self || h.status !== 'open') continue;
    const sinister = h.options.filter((o) => o.sinister).reduce((s, o) => s + o.amplitude, 0);
    const who = h.options.flatMap((o) => [o.prop.s, o.prop.o]).find((x) => present.includes(x));
    if (sinister >= 0.3 && who) out.push({ id: `suspect:${h.id}`, text: `watches ${n(who)} more closely; may ask a careful question`, weight: 0.9 + sinister });
  }
  const em = view.emotion;
  if (em && em.actor === self && em.intensity >= 0.5 && (nowTime === undefined || nowTime - em.at <= 360)) {
    if (/fear|afraid|scared|anx/.test(em.emotion)) out.push({ id: `fear`, text: 'fear shows in attention and body language, not in words', weight: em.intensity });
    else if (/guilt|shame/.test(em.emotion)) out.push({ id: `guilt`, text: 'guilt may show as avoidance or over-politeness', weight: em.intensity });
    else if (/anger|angry|rage/.test(em.emotion)) out.push({ id: `anger`, text: 'anger simmers; short answers', weight: em.intensity });
  }
  // Rotation: what was used recently waits its turn.
  return out.filter((a) => !recent.includes(a.id)).sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
}

function howKnown(status: string, via: string[], names: Record<string, string>): string {
  switch (status) {
    case 'experienced':
      return 'was there';
    case 'told':
      return `told by ${names[via[0]] ?? via[0] ?? 'someone'}`;
    case 'rumored':
      return `rumor via ${via.map((v) => names[v] ?? v).join(' → ')}`;
    case 'common':
      return 'common knowledge';
    default:
      return 'worked it out';
  }
}

function whyNow(h: RecallHit, names: Record<string, string>, present: string[]): string {
  if (h.involuntary) return 'surfaces unbidden (a sensory cue)';
  if (h.paths.commitment) return 'an open promise involves someone here';
  if (h.paths.predictive) return `unresolved with ${h.unit.entities.filter((e) => present.includes(e)).map((e) => names[e] ?? e).join(', ')}`;
  if (h.paths.temporal) return 'the moment being referred to';
  if (h.paths.trigger) return 'something here recalls it';
  if (h.paths.entity) return 'about who is being discussed';
  return 'related to what is being said';
}

export function compilePacket(input: CompileInput): ContextPacket {
  const { view, query, scene, names } = input;
  const persp = view.perspective;
  const self = persp.accessScope === 'persona-narrator' ? 'player' : persp.actorId;
  const n = (id: string) => names[id] ?? id;
  const count = input.countTokens ?? approxTokens;
  const budget = input.budget ?? 700;
  const recall = recallMemories(view, query, scene, input.signals, input.state, input.recall);
  const lines: PacketLine[] = [];
  const focus = new Set([...query.entities, ...scene.present].filter((x) => x !== self));
  const about = (b: ViewBelief) => focus.has(b.prop.s) || focus.has(b.prop.o) || query.words.some((w) => b.prop.s.includes(w) || b.prop.o.includes(w));

  // Hard constraints: the physical scene and what the perspective does not know.
  if (scene.place || scene.time) lines.push({ section: 'constraints', text: `${scene.place ? `At ${scene.place}` : ''}${scene.place && scene.time ? ', ' : ''}${scene.time ?? ''}.`, source: 'scene', reason: 'current scene', priority: 10 });
  for (const u of view.unknowns.slice(0, 2)) lines.push({ section: 'constraints', text: `${n(self)} is unsure: ${u}`, source: 'unknowns', reason: 'known unknown', priority: 6 });

  // Beliefs: established (first-hand / common) vs told, rumored, inferred — kept separate.
  const relevant = view.beliefs.filter(about).sort((a, b) => b.confidence - a.confidence);
  const seen = new Set<string>();
  for (const b of relevant.slice(0, 10)) {
    const key = `${b.prop.s}|${b.prop.p}|${b.prop.o}|${b.status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const first = b.status === 'experienced' || b.status === 'common';
    lines.push({ section: first ? 'established' : 'beliefs', text: beliefLine(b, names), source: b.id, reason: view.reasons.get(b.id) ?? 'own belief', priority: first ? 7 : 6 });
  }
  for (const t of view.doubted.filter((t) => focus.has(t.speaker) || focus.has(t.claim.prop.s)).slice(0, 2)) {
    lines.push({ section: 'beliefs', text: `${n(t.speaker)} claimed: ${t.claim.text} (${n(self)} doubts it)`, source: t.id, reason: view.reasons.get(t.id) ?? 'heard it', priority: 5 });
  }
  if (input.hypotheses !== false) {
    for (const h of view.hypotheses) {
      if (h.owner !== self) continue;
      const involved = h.options.some((o) => focus.has(o.prop.s) || focus.has(o.prop.o));
      if (!involved) continue;
      const opts = h.options.slice().sort((a, b) => b.amplitude - a.amplitude);
      if (h.status === 'resolved') {
        const win = opts[0];
        lines.push({ section: 'beliefs', text: `${n(self)} has settled "${h.question}": ${win.label}`, source: h.id, reason: 'resolved suspicion', priority: 5 });
        continue;
      }
      const word = (a: number) => (a >= 0.5 ? 'likely' : a >= 0.25 ? 'possible' : 'unlikely');
      lines.push({ section: 'beliefs', text: `${n(self)} wonders ${h.question} — ${opts.map((o) => `${o.label} (${word(o.amplitude)})`).join('; ')}; not sure`, source: h.id, reason: view.reasons.get(h.id) ?? 'own suspicion', priority: 6 });
    }
  }
  for (const ho of view.higher.filter((h) => h.owner === self && h.chain.some((c) => focus.has(c.about)) && h.status === 'in').slice(0, 3)) {
    lines.push({ section: 'beliefs', text: ho.text, source: ho.id, reason: view.reasons.get(ho.id) ?? 'own belief about others', priority: 4 });
  }

  // Memories with the smallest detail that suffices.
  recall.hits.forEach((h, i) => {
    const u = h.unit;
    const detail = query.exact && u.quote && i < 2 ? `"${u.quote}"` : i < 3 || h.involuntary ? u.l1 : u.l0;
    const drift = u.drift ? ` [as ${n(self)} recalls it now: ${u.drift}]` : '';
    lines.push({ section: 'memories', text: `${detail}${drift} — ${howKnown(u.status, u.via, names)}; ${whyNow(h, names, scene.present)}`, source: u.id, reason: `${view.reasons.get(u.id) ?? 'own memory'}; recalled by ${h.why.join(', ')}`, priority: 9 - Math.min(5, i) });
  });

  // Relationships and feelings toward who is here.
  for (const r of view.relations) {
    if (r.from !== self || !scene.present.includes(r.to)) continue;
    const bits: string[] = [];
    if (r.trust <= 0.35) bits.push('low trust');
    else if (r.trust >= 0.8) bits.push('trusts');
    if (r.resentment >= 0.3) bits.push('resentful');
    if (r.suspicion >= 0.3) bits.push('suspicious');
    if (r.attachment >= 0.4) bits.push('attached');
    if (bits.length) lines.push({ section: 'relations', text: `${n(self)} → ${n(r.to)}: ${bits.join(', ')}`, source: `rel:${r.from}>${r.to}`, reason: 'own relationship', priority: 6 });
  }
  // A feeling is hot state only while it is fresh (six game hours).
  if (view.emotion && view.emotion.actor === self && view.emotion.intensity >= 0.3 && scene.now - view.emotion.at <= 360) lines.push({ section: 'relations', text: `${n(self)} feels ${view.emotion.emotion}${view.emotion.toward ? ` toward ${n(view.emotion.toward)}` : ''}`, source: `emotion:${self}`, reason: 'own feeling', priority: 5 });

  for (const c of view.commitments) {
    if (c.status !== 'open') continue;
    const parties = [c.by, ...c.to];
    if (!parties.some((p) => focus.has(p)) && !query.words.some((w) => c.what.toLowerCase().includes(w))) continue;
    const text = c.by === self ? `${n(self)} promised ${c.to.map(n).join(', ')}: ${c.what}` : `${n(c.by)} promised ${c.to.includes(self) ? n(self) : c.to.map(n).join(', ')}: ${c.what}`;
    lines.push({ section: 'commitments', text: `${text} (open)`, source: `commitment:${c.id}`, reason: view.reasons.get(`commitment:${c.id}`) ?? 'known promise', priority: 8 });
  }

  const aff = affordances(view, self, scene.present, names, input.recentAffordances, scene.now).slice(0, 2);
  for (const a of aff) lines.push({ section: 'affordances', text: a.text, source: a.id, reason: 'derived from memory and feelings', priority: 3 });

  if (input.adjudication && (persp.accessScope === 'persona-narrator' || persp.accessScope === 'omniscient' || persp.accessScope === 'adjudicator')) {
    for (const u of input.adjudication.slots) {
      if (u.status === 'collapsed') continue;
      const touched = query.words.some((w) => u.s.includes(w) || u.label.toLowerCase().includes(w)) || focus.has(u.s);
      if (!touched) continue;
      let pick = u.status === 'predecided' ? u.value : undefined;
      if (!pick) {
        const pool = input.adjudication.possible(u.key);
        if (pool.length) pick = pool[hashString(`${input.adjudication.seed}␟${u.key}`) % pool.length];
      }
      const rules = u.constraints.map((c) => `${c.kind === 'oneOf' ? 'one of' : c.kind === 'not' ? 'not' : 'fits'} ${c.values.join('/')}`).join('; ');
      lines.push({ section: 'adjudication', text: `${u.label}: not decided yet.${rules ? ` Must stay consistent with the clues (${rules}).` : ''}${pick ? ` If it is revealed now, it is: ${pick}.` : ''}`, source: `undetermined:${u.key}`, reason: u.status === 'predecided' ? 'decided by the author' : 'lazy canon', priority: 7 });
    }
  }

  // Budget: drop the lowest priority lines until it fits.
  const render = (ls: PacketLine[]) => {
    if (!ls.filter((l) => l.section !== 'constraints').length) return '';
    const parts: string[] = [`[ECHO · what ${n(self)} knows — let it show through behavior; never recite it]`];
    for (const sec of Object.keys(HEADINGS) as SectionId[]) {
      const these = ls.filter((l) => l.section === sec);
      if (!these.length) continue;
      parts.push(`${HEADINGS[sec].replace('{name}', n(self))}:`);
      for (const l of these) parts.push(`- ${l.text}`);
    }
    parts.push('[/ECHO]');
    return parts.join('\n');
  };
  let kept = lines.slice();
  let text = render(kept);
  let dropped = 0;
  while (text && count(text) > budget && kept.length) {
    let worst = 0;
    for (let i = 1; i < kept.length; i++) if (kept[i].priority < kept[worst].priority || (kept[i].priority === kept[worst].priority && i > worst)) worst = i;
    kept.splice(worst, 1);
    dropped++;
    text = render(kept);
  }
  return { text, tokens: text ? count(text) : 0, lines: kept, dropped, affordances: kept.filter((l) => l.section === 'affordances').map((l) => l.source), recall, perspective: view.perspective as Perspective };
}

// ------------------------------------------------------------------ the four builders (§5.4)

export interface BuildContextArgs extends Omit<CompileInput, 'view'> {
  proj: Projector & { leaf?: string; storyId?: string };
  storyId: string;
  leaf: string;
  atSeq?: number;
}

function build(scope: AccessScope, actorId: ActorId, a: BuildContextArgs): ContextPacket {
  const view = authorize(a.proj, { actorId, storyId: a.storyId, leaf: a.leaf, atSeq: a.atSeq, accessScope: scope });
  return compilePacket({ ...a, view, adjudication: scope === 'actor' ? undefined : a.adjudication });
}

/** NPC cognition and action: only what this character knows. Never given world adjudication. */
export const buildNpcContext = (actorId: ActorId, a: BuildContextArgs) => build('actor', actorId, a);
/** Player-perspective narration: the persona's knowledge limits what the narrator reveals. */
export const buildNarratorContext = (a: BuildContextArgs) => build('persona-narrator', 'player', a);
/** Omniscient narration — only when the author explicitly turned it on. */
export const buildOmniscientContext = (a: BuildContextArgs) => build('omniscient', 'narrator', a);
/** The privileged world adjudicator (validation, collapse). Never a character's input. */
export const buildAdjudicatorContext = (a: BuildContextArgs) => build('adjudicator', 'world', a);

export type { Violation };
export { propText };
