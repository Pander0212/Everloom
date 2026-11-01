/**
 * ECHO recall benchmark (§12). Deterministic; no model, no network.
 *
 * Systems compared on the same synthetic stories and queries:
 *  - echo      the full read path (access engine → multi-path recall → interference fusion)
 *  - recency   the K most recent memories the actor has
 *  - topk      plain top-K lexical similarity (BM25) with no gate — stands in for "plain top-k
 *              vector search": this harness runs offline, without an embedding model
 *  - legacy    Everloom's current memory recall (engine/memory/recall.ts) fed the same events
 *
 * Metrics: Recall@3, Recall@5, MRR over target queries; "quiet" accuracy on queries that must
 * recall nothing; precision@5; packet tokens; per-stage p50/p95 timings.
 */
import { echo, HeardIndex, recall as legacyRecall, type MemoryItem } from '../../packages/engine/src/index.js';
import { generateStory, nameIndex, type BenchQuery } from './synth.js';

export interface SystemScore {
  recallAt3: number;
  recallAt5: number;
  mrr: number;
  quiet: number;
  precisionAt5: number;
  tokens: number;
}

export interface SizeReport {
  size: number;
  units: number;
  systems: Record<'echo' | 'recency' | 'topk' | 'legacy', SystemScore>;
  perQuery: Array<{ id: string; kind: string; echo: number | null; recency: number | null; topk: number | null; legacy: number | null }>;
  timings: Record<string, { p50: number; p95: number }>;
}

const tok = (s: string) => Math.ceil(s.length / 4);
const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 1000) / 1000;
};

function score(ranked: Map<string, string[]>, queries: BenchQuery[], tokens: Map<string, number>): SystemScore {
  const targets = queries.filter((q) => q.expect.length);
  const quiet = queries.filter((q) => !q.expect.length);
  let r3 = 0;
  let r5 = 0;
  let mrr = 0;
  let prec = 0;
  for (const q of targets) {
    const list = ranked.get(q.id) ?? [];
    const rank = list.indexOf(q.expect[0]);
    if (rank >= 0 && rank < 3) r3++;
    if (rank >= 0 && rank < 5) r5++;
    if (rank >= 0) mrr += 1 / (rank + 1);
    const top = list.slice(0, 5);
    prec += top.length ? top.filter((x) => q.expect.includes(x)).length / top.length : 0;
  }
  let calm = 0;
  for (const q of quiet) if (!(ranked.get(q.id) ?? []).length) calm++;
  const n = targets.length || 1;
  const avgTok = [...tokens.values()].reduce((a, b) => a + b, 0) / (tokens.size || 1);
  return { recallAt3: r3 / n, recallAt5: r5 / n, mrr: Math.round((mrr / n) * 1000) / 1000, quiet: quiet.length ? calm / quiet.length : 1, precisionAt5: Math.round((prec / n) * 1000) / 1000, tokens: Math.round(avgTok) };
}

export function runSize(size: number, seed = 7): SizeReport {
  const story = generateStory(size, seed);
  const idx = nameIndex(story.names);
  const times: Record<string, number[]> = { project: [], authorize: [], understand: [], recall: [], compile: [] };
  const t0 = performance.now();
  const proj = echo.project(story.events, { names: story.names });
  times.project.push(performance.now() - t0);
  const sys = { echo: new Map<string, string[]>(), recency: new Map<string, string[]>(), topk: new Map<string, string[]>(), legacy: new Map<string, string[]>() };
  const toks = { echo: new Map<string, number>(), recency: new Map<string, number>(), topk: new Map<string, number>(), legacy: new Map<string, number>() };
  // Legacy memory items from the same events (who it is about, who saw it).
  const legacyItems: MemoryItem[] = story.events.map((e) => ({ id: e.id, text: e.action, kind: 'beat', participants: [...new Set([...e.actors, ...e.targets])].filter((x) => x !== 'player'), witnesses: [...new Set([...e.actors, ...e.observers.map((o) => o.actor)])], locationId: e.locationId, gameTime: e.occurredAt, importance: e.importance, secret: e.visibility !== 'public', pinned: false, seq: e.seq }));
  for (const q of story.queries) {
    const ta = performance.now();
    const view = echo.authorize(proj, { actorId: q.actor, storyId: 'bench', leaf: 'bench', accessScope: 'actor' });
    const tb = performance.now();
    const qu = echo.understand(q.text, idx, q.scene.now);
    const tc = performance.now();
    const r = echo.recallMemories(view, qu, q.scene, {}, {}, { maxResults: 5 });
    const td = performance.now();
    const pkt = echo.compilePacket({ view, query: qu, scene: q.scene, names: story.names });
    const te = performance.now();
    times.authorize.push(tb - ta);
    times.understand.push(tc - tb);
    times.recall.push(td - tc);
    times.compile.push(te - td);
    sys.echo.set(q.id, r.hits.map((h) => h.unit.eventId));
    toks.echo.set(q.id, pkt.tokens);
    const mine = view.units.filter((u) => u.owner === q.actor);
    const recent = mine.slice().sort((a, b) => b.seq - a.seq).slice(0, 5);
    sys.recency.set(q.id, recent.map((u) => u.eventId));
    toks.recency.set(q.id, tok(recent.map((u) => u.l1).join('\n')));
    const bm = echo.bm25(mine, qu.words);
    const top = [...bm].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => mine.find((u) => u.id === id)!);
    sys.topk.set(q.id, top.map((u) => u.eventId));
    toks.topk.set(q.id, tok(top.map((u) => u.l1).join('\n')));
    // Legacy: the same BM25 lexical signal, plus people/place/importance/recency, scoped to the player.
    const lex = new Map([...echo.bm25(mine, qu.words)].map(([id, v]) => [mine.find((u) => u.id === id)!.eventId, v]));
    const named = new Set(qu.entities);
    const lr = legacyRecall(legacyItems, new HeardIndex(), { now: q.scene.now, present: q.scene.present, locationId: q.scene.locationId, lexical: lex, named, namedPlaces: new Set() }, { playerLimit: 5 });
    sys.legacy.set(q.id, lr.player.map((x) => x.m.id));
    toks.legacy.set(q.id, tok(lr.player.map((x) => x.m.text).join('\n')));
  }
  const rankOf = (m: Map<string, string[]>, q: BenchQuery) => (q.expect.length ? (m.get(q.id) ?? []).indexOf(q.expect[0]) + 1 || null : (m.get(q.id) ?? []).length ? 0 : null);
  return {
    size,
    units: proj.units.length,
    systems: { echo: score(sys.echo, story.queries, toks.echo), recency: score(sys.recency, story.queries, toks.recency), topk: score(sys.topk, story.queries, toks.topk), legacy: score(sys.legacy, story.queries, toks.legacy) },
    perQuery: story.queries.map((q) => ({ id: q.id, kind: q.kind, echo: rankOf(sys.echo, q), recency: rankOf(sys.recency, q), topk: rankOf(sys.topk, q), legacy: rankOf(sys.legacy, q) })),
    timings: Object.fromEntries(Object.entries(times).map(([k, v]) => [k, { p50: pct(v, 50), p95: pct(v, 95) }])),
  };
}

export function runBench(sizes = [100, 500, 1000, 5000]): SizeReport[] {
  return sizes.map((s) => runSize(s));
}

export function toMarkdown(reports: SizeReport[]): string {
  const f = (x: number) => (x <= 1 ? `${Math.round(x * 100)}%` : String(x));
  const lines: string[] = [];
  for (const r of reports) {
    lines.push(`### ${r.size} memory records (${r.units} memory units)`, '', '| System | Recall@3 | Recall@5 | MRR | Quiet when nothing fits | Precision@5 | Tokens/turn |', '|---|---|---|---|---|---|---|');
    for (const [name, s] of Object.entries(r.systems)) lines.push(`| ${name} | ${f(s.recallAt3)} | ${f(s.recallAt5)} | ${s.mrr} | ${f(s.quiet)} | ${s.precisionAt5} | ${s.tokens} |`);
    lines.push('', '| Stage | p50 ms | p95 ms |', '|---|---|---|');
    for (const [k, v] of Object.entries(r.timings)) lines.push(`| ${k} | ${v.p50} | ${v.p95} |`);
    lines.push('', '| Query | Kind | echo | recency | topk | legacy |', '|---|---|---|---|---|---|');
    for (const q of r.perQuery) lines.push(`| ${q.id} | ${q.kind} | ${q.echo ?? '–'} | ${q.recency ?? '–'} | ${q.topk ?? '–'} | ${q.legacy ?? '–'} |`);
    lines.push('');
  }
  lines.push('Per-query cells: rank of the target (– = not in the top 5); for "missing"/"unrelated" queries, 0 = correctly recalled nothing, – = recalled something.');
  return lines.join('\n');
}
