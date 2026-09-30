/**
 * Memory benchmark runner. Plays the synthetic campaign through the real server pipeline
 * (messages → tracker pass → memory writers → background chronicler/consolidation), and at each
 * question point builds the scene exactly as a reply would see it. The same campaign is fed to a
 * re-creation of the Phase-1 memory for comparison.
 *
 * Mock mode (default) is deterministic: the tracker returns the ground-truth events, so this
 * measures storage and retrieval. Real-model mode (MEMORY_BENCH_URL + MEMORY_BENCH_MODEL, optional
 * MEMORY_BENCH_KEY) sends the prose to a real model, so extraction quality counts too.
 */
import { countTokens } from '../../apps/server/src/services/tokens.js';
import { afterTurn, settleBackground } from '../../apps/server/src/services/chronicle.js';
import { createClient } from '../../apps/server/test/helpers.js';
import { startMockLlm } from '../mock-llm/server.js';
import { generateCampaign, PLAYER_NAME, type BenchQuestion, type QuestionKind } from './campaign.js';
import { Phase1Memory, type Complete } from './phase1.js';

export interface RealModel {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface BenchOptions {
  turns?: number;
  seed?: number;
  profile?: 'cheap' | 'balanced' | 'max';
  real?: RealModel | null;
  log?: (line: string) => void;
}

export interface SystemScore {
  recall: number;
  recallLexical: number;
  recallEntity: number;
  person: number;
  leak: number;
  fact: number;
  stale: number;
  avgTokens: number;
  maxTokens: number;
}

export interface BenchReport {
  mode: 'mock' | 'real';
  profile: string;
  turns: number;
  questions: Record<QuestionKind, number>;
  old: SystemScore;
  new: SystemScore;
  /** Model calls per turn on the new pipeline, by purpose. */
  callsPerTurn: Record<string, number>;
  misses: Array<{ system: 'old' | 'new'; kind: QuestionKind; cue: string; expect: string }>;
  ms: number;
}

const low = (s: string) => s.toLowerCase();

/** The lines of a scene block describing one person (from "- Name" to the next person or section). */
function personBlock(scene: string, name: string): string {
  const lines = scene.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`- ${name}`));
  if (start < 0) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && lines[i].startsWith('  '); i++) out.push(lines[i]);
  return out.join('\n');
}

/** The memory-bearing part of the new scene block: story so far + what people know + facts. */
function memoryPart(scene: string): string {
  const story = scene.split('## STORY SO FAR')[1]?.split('\n## ')[0] ?? '';
  const people = scene
    .split('\n')
    .filter((l) => /^\s+(KNOWS|HEARD|DOES NOT KNOW|FACTS)/.test(l))
    .join('\n');
  return `${story}\n${people}`.trim();
}

function lineWith(text: string, a: string, b: string): boolean {
  return text.split('\n').some((l) => low(l).includes(low(a)) && low(l).includes(low(b)));
}

interface Verdict {
  hit: boolean;
  leak?: boolean;
  stale?: boolean;
}

function judgeNew(q: BenchQuestion, scene: string): Verdict {
  const first = (n: string) => n.split(' ')[0];
  if (q.kind === 'person') return { hit: low(personBlock(scene, q.viewer!)).includes(low(q.expect)) };
  if (q.kind === 'leak') {
    const block = low(personBlock(scene, q.viewer!));
    const knows = block.split('\n').some((l) => /^\s*(knows|heard)/.test(l) && l.includes(low(q.expect)));
    const marked = block.split('\n').some((l) => l.trim().startsWith('does not know') && l.includes(low(q.expect)));
    // Shown to the narrator is fine when the scene says who doesn't know: a DOES NOT KNOW line, or
    // a secret marker that doesn't name them.
    const first = q.viewer!.split(' ')[0].toLowerCase();
    const secretLine = low(scene).split('\n').some((l) => l.includes(low(q.expect)) && l.includes('(secret — only you') && !l.split(' know)')[0].includes(first));
    const shown = low(scene).includes(low(q.expect));
    return { hit: !knows, leak: knows || (shown && !marked && !secretLine) };
  }
  if (q.kind === 'fact') {
    const about = q.cue.match(/^What is (.+?)'s/)![1];
    // Facts appear in the person's FACTS line (under their name) or as a line naming them.
    const block = personBlock(scene, about);
    const has = (v: string) => lineWith(block, 'FACTS', v) || lineWith(scene, first(about), v);
    const hit = has(q.expect);
    return { hit, stale: !!q.stale && has(q.stale) && !hit };
  }
  return { hit: [q.expect, ...(q.anyOf ?? [])].some((e) => low(scene).includes(low(e))) };
}

function judgeOld(q: BenchQuestion, ctx: string): Verdict {
  const shown = low(ctx).includes(low(q.expect));
  if (q.kind === 'leak') return { hit: !shown, leak: shown }; // nothing is scoped: shown means everyone "knows"
  if (q.kind === 'fact') {
    const about = q.cue.match(/^What is (.+?)'s/)![1].split(' ')[0];
    const hit = lineWith(ctx, about, q.expect);
    return { hit, stale: !!q.stale && lineWith(ctx, about, q.stale) && !hit };
  }
  return { hit: [q.expect, ...(q.anyOf ?? [])].some((e) => low(ctx).includes(low(e))) };
}

function score(verdicts: Array<{ q: BenchQuestion; v: Verdict; tokens: number }>): SystemScore {
  const of = (k: QuestionKind[]) => verdicts.filter((x) => k.includes(x.q.kind));
  const rate = (list: typeof verdicts, f: (v: Verdict) => boolean | undefined) => (list.length ? list.filter((x) => f(x.v)).length / list.length : 0);
  const toks = verdicts.map((x) => x.tokens);
  return {
    recall: rate(of(['recall-lexical', 'recall-entity']), (v) => v.hit),
    recallLexical: rate(of(['recall-lexical']), (v) => v.hit),
    recallEntity: rate(of(['recall-entity']), (v) => v.hit),
    person: rate(of(['person']), (v) => v.hit),
    leak: rate(of(['leak']), (v) => v.leak),
    fact: rate(of(['fact']), (v) => v.hit),
    stale: rate(of(['fact']), (v) => v.stale),
    avgTokens: Math.round(toks.reduce((a, b) => a + b, 0) / Math.max(1, toks.length)),
    maxTokens: Math.max(0, ...toks),
  };
}

export async function runBench(opts: BenchOptions = {}): Promise<BenchReport> {
  const t0 = Date.now();
  const log = opts.log ?? (() => {});
  const campaign = generateCampaign({ turns: opts.turns, seed: opts.seed });
  const mock = opts.real ? null : await startMockLlm();
  const control = (body: object) => (mock ? fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify(body) }) : Promise.resolve());
  const c = await createClient();
  try {
    await control({ reset: true });
    // In mock mode the tracker already reports every event; a chronicler would add nothing new.
    await control({ chronicle: { memories: [], facts: [], summary: '' } });
    const conn = await c.req('POST', '/api/connections', {
      name: opts.real ? 'Bench model' : 'Mock',
      provider: 'openai',
      baseUrl: opts.real?.baseUrl ?? mock!.url,
      model: opts.real?.model ?? 'mock-story',
      ...(opts.real?.apiKey ? { apiKey: opts.real.apiKey } : {}),
      params: { max_tokens: 400, context_size: 16384 },
    });
    if (conn.status !== 200) throw new Error(`connection: ${conn.body}`);
    await c.req('PATCH', '/api/settings', { roles: { main: conn.json.id }, world: { profile: opts.profile ?? 'balanced' } });
    await c.req('POST', '/api/personas', { name: PLAYER_NAME, isDefault: true });
    const ch = await c.req('POST', '/api/characters', { card: { name: 'Narrator', description: 'The narrator of a town full of secrets.', first_mes: 'The town wakes.' } });
    const chat = (await c.req('POST', '/api/chats', { characterId: ch.json.id, greeting: false })).json;
    const owner = (c.built.ctx.db.prepare('SELECT id FROM users').get() as { id: string }).id;

    const complete: Complete | undefined = opts.real
      ? async (messages) => {
          const r = await fetch(`${opts.real!.baseUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(opts.real!.apiKey ? { authorization: `Bearer ${opts.real!.apiKey}` } : {}) },
            body: JSON.stringify({ model: opts.real!.model, messages, temperature: 0.3, max_tokens: 900 }),
          });
          const j = (await r.json()) as any;
          return j.choices?.[0]?.message?.content ?? '';
        }
      : undefined;
    const old = new Phase1Memory({ complete });
    const verdicts = { old: [] as Array<{ q: BenchQuestion; v: Verdict; tokens: number }>, new: [] as Array<{ q: BenchQuestion; v: Verdict; tokens: number }> };
    const misses: BenchReport['misses'] = [];
    const byTurn = new Map<number, BenchQuestion[]>();
    for (const q of campaign.questions) (byTurn.get(q.after) ?? byTurn.set(q.after, []).get(q.after)!).push(q);
    const recent: string[] = [];

    for (const turn of campaign.turns) {
      await control({
        trackerOps: turn.ops,
        trackerMemories: turn.events.map((e) => ({ text: e.text, about: e.about, importance: e.importance, private: e.secret, to: e.to })),
        trackerFacts: turn.facts.map((f) => ({ about: f.about, key: f.key, value: f.value, text: f.text, changed: f.changed })),
      });
      await c.req('POST', `/api/chats/${chat.id}/messages`, { role: 'user', name: PLAYER_NAME, text: turn.userText });
      const reply = await c.req('POST', `/api/chats/${chat.id}/messages`, { role: 'assistant', name: 'Narrator', text: turn.story, characterId: ch.json.id });
      const tracked = await c.req('POST', `/api/messages/${reply.json.id}/retrack`);
      if (!tracked.json?.ok) log(`turn ${turn.n}: tracker failed: ${tracked.json?.error}`);
      afterTurn(c.built.ctx, owner, chat.id);
      await settleBackground(chat.id);
      await old.afterTurn(campaign.turns, turn.n);
      recent.push(turn.userText, turn.story);

      for (const q of byTurn.get(turn.n) ?? []) {
        const cue = await c.req('POST', `/api/chats/${chat.id}/messages`, { role: 'user', name: PLAYER_NAME, text: q.cue });
        const scene = (await c.req('GET', `/api/chats/${chat.id}/scene?fresh=1`)).json.text as string;
        await c.req('DELETE', `/api/messages/${cue.json.id}`);
        const oldCtx = old.context([...recent.slice(-2), q.cue].join('\n'));
        const vn = judgeNew(q, scene);
        const vo = judgeOld(q, oldCtx);
        verdicts.new.push({ q, v: vn, tokens: countTokens(memoryPart(scene)) });
        verdicts.old.push({ q, v: vo, tokens: countTokens(oldCtx) });
        if (!vn.hit || vn.leak) misses.push({ system: 'new', kind: q.kind, cue: q.cue, expect: q.expect });
        if ((!vn.hit || vn.leak) && process.env.BENCH_DEBUG) {
          const row = c.built.ctx.db.prepare('SELECT id, kind, text FROM mem_items WHERE text LIKE ? ORDER BY seq').all(`%${q.expect}%`) as any[];
          const why = [];
          for (const r of row) why.push({ kind: r.kind, text: r.text.slice(0, 60), ...(await c.req('GET', `/api/chats/${chat.id}/memory/why/${r.id}`)).json.score });
          log(`--- MISS ${q.kind} ${q.cue} -> ${q.expect} (event ${q.eventId})\n${JSON.stringify(why)}\n${process.env.BENCH_DEBUG === '2' ? scene : ''}\n`);
        }
        if (!vo.hit || vo.leak) misses.push({ system: 'old', kind: q.kind, cue: q.cue, expect: q.expect });
      }
      if (turn.n % 50 === 0) log(`turn ${turn.n}/${campaign.turns.length}`);
    }

    const calls = c.built.ctx.db.prepare('SELECT purpose, COUNT(*) AS n FROM llm_calls WHERE chat_id = ? GROUP BY purpose').all(chat.id) as Array<{ purpose: string; n: number }>;
    const questions = Object.fromEntries(['recall-lexical', 'recall-entity', 'person', 'leak', 'fact'].map((k) => [k, campaign.questions.filter((q) => q.kind === k).length])) as Record<QuestionKind, number>;
    return {
      mode: opts.real ? 'real' : 'mock',
      profile: opts.profile ?? 'balanced',
      turns: campaign.turns.length,
      questions,
      old: score(verdicts.old),
      new: score(verdicts.new),
      callsPerTurn: Object.fromEntries(calls.map((r) => [r.purpose, Math.round((r.n / campaign.turns.length) * 1000) / 1000])),
      misses,
      ms: Date.now() - t0,
    };
  } finally {
    await c.close();
    await mock?.close();
  }
}

export function formatReport(r: BenchReport): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const row = (label: string, o: string, n: string) => `| ${label} | ${o} | ${n} |`;
  return [
    `Memory benchmark — ${r.mode} mode, ${r.profile} profile, ${r.turns} turns, ${Object.values(r.questions).reduce((a, b) => a + b, 0)} questions (${Object.entries(r.questions).map(([k, v]) => `${k} ${v}`).join(', ')})`,
    '',
    '| Metric | Phase 1 | Phase 2 |',
    '|---|---|---|',
    row('Recall hit rate (all)', pct(r.old.recall), pct(r.new.recall)),
    row('— by keyword cue', pct(r.old.recallLexical), pct(r.new.recallLexical)),
    row('— by person + place cue', pct(r.old.recallEntity), pct(r.new.recallEntity)),
    row('Person present remembers what they saw', pct(r.old.person), pct(r.new.person)),
    row('Knowledge-leak rate (lower is better)', pct(r.old.leak), pct(r.new.leak)),
    row('Current fact shown', pct(r.old.fact), pct(r.new.fact)),
    row('Stale-fact rate (lower is better)', pct(r.old.stale), pct(r.new.stale)),
    row('Memory tokens per prompt (avg / max)', `${r.old.avgTokens} / ${r.old.maxTokens}`, `${r.new.avgTokens} / ${r.new.maxTokens}`),
    '',
    `Model calls per turn (Phase 2 pipeline): ${Object.entries(r.callsPerTurn).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
    `Took ${(r.ms / 1000).toFixed(1)} s.`,
  ].join('\n');
}
