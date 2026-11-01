/**
 * Recall: the read path (§7 B–E), over an AuthorizedView only.
 *
 * Several independent paths each nominate memories: lexical, semantic (when the server supplies
 * scores for the authorized ids), entity graph (named people/things and their one-hop
 * associates, Personalized-PageRank-lite), temporal, causal/commitment, trigger signatures and a
 * weak recency signal. They are fused by Reciprocal Rank Fusion; memories reached by several
 * independent cues are amplified (constructive interference) and memories whose attributes
 * contradict the cue are dampened (destructive interference: "the lake in winter" vs a summer
 * memory). Accessibility (a forgetting curve weighted by importance, emotion and how often a
 * memory was recalled) scales the result but never deletes anything: a strong cue still reaches
 * an old memory.
 *
 * Involuntary recall ("tunneling") lets a faded memory surface through a strong sensory cue,
 * rarely, deterministically per message and swipe (seeded), and is marked as such.
 */
import type { AuthorizedView, ViewUnit } from './access.js';
import { OPPOSED_ATTRIBUTES, words } from './projector.js';
import type { QueryUnderstanding } from './query.js';
import { hashString } from '../util/rng.js';

export type RecallPath = 'lexical' | 'semantic' | 'entity' | 'temporal' | 'commitment' | 'causal' | 'trigger' | 'recency' | 'predictive';

export interface SceneCues {
  now: number;
  present: string[];
  locationId: string | null;
  /** Objects in view or in hand. */
  objects?: string[];
  /** Sensory words in the scene (a smell, a song). */
  sensory?: string[];
}

export interface RecallSignals {
  /** unitId → 0..1 from the server's FTS (authorized ids only). Engine BM25 is used when absent. */
  lexical?: Map<string, number>;
  /** unitId → cosine similarity (authorized ids only). */
  semantic?: Map<string, number>;
}

export interface RecallState {
  /** unitId → how often and when it was last recalled (message-bound records from the server). */
  recalls?: Map<string, { count: number; lastTime: number }>;
  /** The actor's impairment right now (0..1): drunk, asleep, concussed. */
  impairedNow?: number;
}

export interface RecallOptions {
  maxResults?: number;
  /** Path weights. */
  weights?: Partial<Record<RecallPath, number>>;
  rrfK?: number;
  /** Bonus per extra agreeing path. */
  agreement?: number;
  /** Multiplier for contradicted attributes. */
  dampen?: number;
  tunneling?: { enabled: boolean; rate: number; seed: string };
  /** Drop hits scoring below this share of the best one (default 0.4). */
  cutoff?: number;
}

export const DEFAULT_PATH_WEIGHTS: Record<RecallPath, number> = {
  lexical: 1,
  semantic: 0.9,
  entity: 0.8,
  temporal: 0.8,
  commitment: 0.9,
  causal: 0.5,
  trigger: 0.7,
  recency: 0.15,
  predictive: 0.6,
};

export interface RecallHit {
  unit: ViewUnit;
  score: number;
  paths: Partial<Record<RecallPath, { rank: number; raw: number }>>;
  agreeing: number;
  accessibility: number;
  dampened?: string;
  involuntary?: boolean;
  why: string[];
}

export interface RecallResult {
  hits: RecallHit[];
  considered: number;
  timings: Record<string, number>;
}

/** Retrieval accessibility (0..1): fades with time, slower for important, emotional, rehearsed memories. */
export function accessibility(u: Pick<ViewUnit, 'importance' | 'emotion' | 'occurredAt'>, now: number, rec?: { count: number; lastTime: number }): number {
  const base = u.importance >= 3 ? 90 : u.importance === 2 ? 15 : 3;
  const stability = base * (1 + u.emotion) * (1 + 0.6 * (rec?.count ?? 0));
  const since = Math.max(u.occurredAt, rec?.lastTime ?? -Infinity);
  const days = Math.max(0, now - since) / 1440;
  return Math.exp(-days / stability);
}

/** Small BM25 over the view's units (fallback when the server has no FTS scores). */
export function bm25(units: ViewUnit[], queryWords: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!queryWords.length || !units.length) return out;
  const docs = units.map((u) => words(u.l1));
  const avg = docs.reduce((s, d) => s + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const q = [...new Set(queryWords)];
  let max = 0;
  docs.forEach((d, i) => {
    let s = 0;
    for (const w of q) {
      const n = df.get(w);
      if (!n) continue;
      const tf = d.filter((x) => x === w).length;
      if (!tf) continue;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      s += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (d.length / avg))));
    }
    if (s > 0) {
      out.set(units[i].id, s);
      max = Math.max(max, s);
    }
  });
  for (const [k, v] of out) out.set(k, v / max);
  return out;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function recallMemories(view: AuthorizedView, q: QueryUnderstanding, scene: SceneCues, signals: RecallSignals = {}, state: RecallState = {}, opts: RecallOptions = {}): RecallResult {
  const t0 = now();
  const w = { ...DEFAULT_PATH_WEIGHTS, ...(opts.weights ?? {}) };
  const k = opts.rrfK ?? 5;
  const self = view.perspective.accessScope === 'persona-narrator' ? 'player' : view.perspective.actorId;
  const units = view.units.filter((u) => u.owner === self || view.perspective.accessScope === 'omniscient' || view.perspective.accessScope === 'adjudicator');
  const raw: Partial<Record<RecallPath, Map<string, number>>> = {};

  // Lexical.
  raw.lexical = signals.lexical ? new Map([...signals.lexical].filter(([id]) => units.some((u) => u.id === id))) : bm25(units, q.words);
  const t1 = now();
  // Semantic: only for ids in this view (the server computes scores for authorized ids only).
  if (signals.semantic) {
    const ids = new Set(units.map((u) => u.id));
    raw.semantic = new Map([...signals.semantic].filter(([id, v]) => ids.has(id) && v > 0.3));
  }
  // Entity graph: named entities, then their one-hop associates.
  const qEnt = new Set(q.entities.filter((e) => e !== self));
  const assoc = new Map<string, number>();
  if (qEnt.size) {
    for (const u of units) {
      if (!u.entities.some((e) => qEnt.has(e))) continue;
      for (const e of u.entities) if (!qEnt.has(e) && e !== self) assoc.set(e, (assoc.get(e) ?? 0) + 1);
    }
  }
  const topAssoc = new Set([...assoc].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([e]) => e));
  raw.entity = new Map();
  for (const u of units) {
    let s = 0;
    for (const e of u.entities) {
      if (qEnt.has(e)) s += 1;
      else if (topAssoc.has(e)) s += 0.25;
    }
    if (s > 0) raw.entity.set(u.id, s / Math.max(1, Math.sqrt(u.entities.length)));
  }
  // Temporal.
  raw.temporal = new Map();
  for (const cue of q.temporal) {
    let window = cue.window;
    if (!window && cue.anchor) {
      const aw = words(cue.anchor);
      const anchorUnit = units
        .filter((u) => {
          const uw = new Set([...words(u.l1), ...(u.locationId ? words(u.locationId) : []), ...u.triggers]);
          return aw.length && aw.filter((x) => uw.has(x)).length >= Math.ceil(aw.length / 2);
        })
        .sort((a, b) => b.seq - a.seq)[0];
      if (anchorUnit) {
        if (cue.relation === 'before') window = [anchorUnit.occurredAt - 3 * 1440, anchorUnit.occurredAt];
        else if (cue.relation === 'after') window = [anchorUnit.occurredAt, anchorUnit.occurredAt + 3 * 1440];
        else window = [anchorUnit.occurredAt - 360, anchorUnit.occurredAt + 360];
        if (!cue.relation) raw.temporal.set(anchorUnit.id, 1);
      }
    }
    if (!window) continue;
    const [from, to] = window;
    for (const u of units) {
      if (u.occurredAt < from || u.occurredAt >= to) continue;
      const mid = (from + to) / 2;
      const closeness = 1 - Math.min(1, Math.abs(u.occurredAt - mid) / Math.max(1, to - from));
      raw.temporal.set(u.id, Math.max(raw.temporal.get(u.id) ?? 0, 0.6 + 0.4 * closeness));
    }
  }
  // Commitments: open promises that involve someone here or named.
  raw.commitment = new Map();
  const focus = new Set([...qEnt, ...scene.present.filter((p) => p !== self)]);
  for (const c of view.commitments) {
    if (c.status !== 'open') continue;
    const parties = [c.by, ...c.to].filter((x) => x !== self);
    if (!parties.some((p) => focus.has(p))) continue;
    for (const u of units) if (u.commitmentId === c.id) raw.commitment.set(u.id, 1);
  }
  // Trigger signatures: sensory, objects, place.
  raw.trigger = new Map();
  const sens = new Set((scene.sensory ?? []).flatMap((s) => words(s)));
  const objs = new Set((scene.objects ?? []).flatMap((o) => [o.toLowerCase(), ...words(o)]));
  for (const u of units) {
    const trig = new Set(u.triggers);
    let s = 0;
    // A sensory cue recalls a memory normally only while it is still accessible; a faded one can
    // only surface involuntarily (below), rarely.
    if (sens.size && accessibility(u, scene.now, state.recalls?.get(u.id)) >= 0.35) for (const x of sens) if (trig.has(`sense:${x}`) || trig.has(x)) s += 1;
    for (const x of objs) if (trig.has(x)) s += 0.8;
    if (scene.locationId && u.locationId === scene.locationId && (q.recallNeed > 0 || s > 0)) s += 0.4;
    if (s > 0) raw.trigger.set(u.id, s);
  }
  // Predictive activation: present people surface unresolved business with them, not everything.
  raw.predictive = new Map();
  const tension = new Map<string, Set<string>>();
  for (const r of view.relations) if (r.from === self && (r.resentment >= 0.3 || r.suspicion >= 0.3 || r.trust <= 0.3)) tension.set(r.to, new Set(r.history));
  for (const u of units) {
    const here = u.entities.filter((e) => scene.present.includes(e) && e !== self);
    if (!here.length) continue;
    const unresolved = here.some((p) => tension.get(p)?.has(u.eventId));
    if (unresolved) raw.predictive.set(u.id, 1);
    else if (u.importance >= 3) raw.predictive.set(u.id, 0.6);
  }
  // Recency: weak.
  raw.recency = new Map();
  const maxSeq = Math.max(0, ...units.map((u) => u.seq));
  for (const u of units) raw.recency.set(u.id, Math.exp(-(maxSeq - u.seq) / 40));
  const t2 = now();

  // Fusion (RRF) + interference.
  const fused = new Map<string, RecallHit>();
  const byId = new Map(units.map((u) => [u.id, u]));
  const floors: Partial<Record<RecallPath, number>> = { lexical: 0.15, semantic: 0.45, entity: 0.2, temporal: 0.5, commitment: 0.5, trigger: 0.4, predictive: 0.5, recency: 0 };
  const fuse = (path: RecallPath, m: Map<string, number>) => {
    const ranked = [...m].filter(([, v]) => v >= (floors[path] ?? 0)).sort((a, b) => b[1] - a[1]);
    const top = ranked[0]?.[1] || 1;
    ranked.forEach(([id, v], i) => {
      const u = byId.get(id);
      if (!u) return;
      let h = fused.get(id);
      if (!h) fused.set(id, (h = { unit: u, score: 0, paths: {}, agreeing: 0, accessibility: 1, why: [] }));
      h.paths[path] = { rank: i + 1, raw: Math.round(v * 1000) / 1000 };
      // Rank fusion weighted by how strong the match is within its path: a clear #1 stays clear.
      h.score += (w[path] * (0.4 + 0.6 * Math.min(1, v / top))) / (k + i + 1);
    });
  };
  for (const p of Object.keys(raw) as RecallPath[]) fuse(p, raw[p]!);
  // Causal: one hop from what is already strong.
  const strong = [...fused.values()].filter((h) => evidence(h) >= 1).sort((a, b) => b.score - a.score).slice(0, 5);
  raw.causal = new Map();
  for (const h of strong) {
    for (const u of units) {
      if (u.id === h.unit.id) continue;
      if (h.unit.causes.includes(u.eventId) || u.causes.includes(h.unit.eventId)) raw.causal.set(u.id, 0.8);
    }
  }
  fuse('causal', raw.causal);

  const agreementBonus = opts.agreement ?? 0.35;
  const dampen = opts.dampen ?? 0.35;
  const qa = new Set(q.attributes);
  for (const h of fused.values()) {
    h.agreeing = evidence(h);
    h.score *= 1 + agreementBonus * Math.max(0, h.agreeing - 1);
    for (const [a, b] of OPPOSED_ATTRIBUTES) {
      const clash = (qa.has(a) && h.unit.attributes.includes(b) && !h.unit.attributes.includes(a)) || (qa.has(b) && h.unit.attributes.includes(a) && !h.unit.attributes.includes(b));
      if (clash) {
        h.score *= dampen;
        h.dampened = `${qa.has(a) ? a : b} vs ${qa.has(a) ? b : a}`;
        break;
      }
    }
    h.accessibility = accessibility(h.unit, scene.now, state.recalls?.get(h.unit.id));
    // Accessibility tilts, it never decides: a strong cue still reaches an old memory.
    h.score *= (0.8 + 0.2 * h.accessibility) * (1 - 0.4 * Math.max(0, Math.min(1, state.impairedNow ?? 0)));
    h.why = (Object.keys(h.paths) as RecallPath[]).filter((p) => p !== 'recency').map((p) => `${p} #${h.paths[p]!.rank}`);
    if (h.dampened) h.why.push(`dampened (${h.dampened})`);
  }
  // Relevance gate: something must tie it to this moment — recency alone never does.
  let hits = [...fused.values()].filter((h) => h.agreeing >= 1).sort((a, b) => b.score - a.score || b.unit.seq - a.unit.seq);
  // One memory per event and episode-level dedupe of near-identical lines.
  const seen = new Set<string>();
  hits = hits.filter((h) => (seen.has(h.unit.eventId) ? false : (seen.add(h.unit.eventId), true)));
  const max = opts.maxResults ?? 6;
  // A weak tail is noise, not context: keep what is within reach of the best match.
  const best = hits[0]?.score ?? 0;
  hits = hits.filter((h) => h.score >= (opts.cutoff ?? 0.4) * best).slice(0, max);

  // Tunneling: a faded memory surfacing through a strong sensory cue. Rare, seeded, marked.
  const tun = opts.tunneling;
  // One seeded roll per turn decides whether anything surfaces at all; then the faded memory whose
  // own sensory signature best matches the cue is the one that does.
  if (tun?.enabled && sens.size && hashString(`${tun.seed}␟tunnel`) / 4294967296 < tun.rate) {
    const taken = new Set(hits.map((h) => h.unit.id));
    let best: { u: ViewUnit; overlap: number; acc: number; tie: number } | null = null;
    for (const u of units) {
      if (taken.has(u.id)) continue;
      const acc = accessibility(u, scene.now, state.recalls?.get(u.id));
      if (acc >= 0.35) continue;
      const overlap = [...sens].filter((s) => u.triggers.includes(`sense:${s}`)).length;
      if (!overlap) continue;
      const tie = hashString(`${tun.seed}␟${u.id}`);
      if (!best || overlap > best.overlap || (overlap === best.overlap && tie < best.tie)) best = { u, overlap, acc, tie };
    }
    if (best) hits.push({ unit: best.u, score: 0, paths: { trigger: { rank: 0, raw: best.overlap } }, agreeing: 1, accessibility: best.acc, involuntary: true, why: ['involuntary recall (sensory cue)'] });
  }
  const t3 = now();
  return { hits, considered: units.length, timings: { lexical: t1 - t0, paths: t2 - t1, fusion: t3 - t2, total: t3 - t0 } };
}

/** Independent evidence paths (recency and causal-only don't count as a reason on their own). */
function evidence(h: RecallHit): number {
  return (Object.keys(h.paths) as RecallPath[]).filter((p) => p !== 'recency' && p !== 'causal').length;
}
