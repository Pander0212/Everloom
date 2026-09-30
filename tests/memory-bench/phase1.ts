/**
 * The Phase-1 memory, re-created for comparison: a rolling summary rewritten every 24 messages
 * (the newest 8 kept out), up to five "long-term memories" per rewrite, the 12 newest of those in
 * the prompt, and a full-text search over them (6 hits) for the game-state block.
 *
 * In mock mode the summarizer is an idealized stand-in (it never invents anything and keeps
 * important events longest), so the old numbers are, if anything, flattering. In real-model mode
 * the Phase-1 prompt is sent to the model.
 */
import Database from 'better-sqlite3';
import { extractJson } from '@everloom/engine';
import { ftsQuery } from '../../apps/server/src/services/search.js';
import type { BenchTurn } from './campaign.js';

export type Complete = (messages: Array<{ role: 'system' | 'user'; content: string }>) => Promise<string>;

interface Sentence {
  text: string;
  importance: number;
}

export class Phase1Memory {
  private summary: Sentence[] = [];
  private summaryText = '';
  private facts: Array<{ id: number; text: string; at: number }> = [];
  private upto = 0;
  private db = new Database(':memory:');
  private seq = 0;

  constructor(private opts: { every?: number; keepRecent?: number; maxWords?: number; complete?: Complete } = {}) {
    this.db.exec("CREATE VIRTUAL TABLE f USING fts5(id UNINDEXED, body, tokenize = 'porter unicode61')");
  }

  /** Call after each turn (a user message and a reply: two messages). */
  async afterTurn(turns: BenchTurn[], n: number) {
    const every = this.opts.every ?? 24;
    const keep = this.opts.keepRecent ?? 8;
    if ((n - this.upto) * 2 < every) return;
    const last = n - keep / 2;
    const batch = turns.slice(this.upto, last);
    if (!batch.length) return;
    if (this.opts.complete) await this.realRewrite(batch);
    else this.idealRewrite(batch);
    this.upto = last;
  }

  private idealRewrite(batch: BenchTurn[]) {
    const maxWords = this.opts.maxWords ?? 250;
    for (const t of batch) {
      for (const e of t.events) this.summary.push({ text: e.text, importance: e.importance });
      for (const f of t.facts) this.summary.push({ text: `${f.text}.`, importance: 2 });
    }
    const words = () => this.summary.reduce((n, s) => n + s.text.split(/\s+/).length, 0);
    // A good summarizer lets small things go first, oldest first; milestones last of all.
    for (const level of [1, 2, 3]) {
      for (let i = 0; i < this.summary.length && words() > maxWords; ) {
        if (this.summary[i].importance === level) this.summary.splice(i, 1);
        else i++;
      }
    }
    this.summaryText = this.summary.map((s) => s.text).join(' ');
    // Up to five durable facts per rewrite: changes first, then milestones, then promises/secrets.
    const cands = [
      ...batch.flatMap((t) => t.facts.map((f) => ({ text: f.text, rank: 4 }))),
      ...batch.flatMap((t) => t.events.filter((e) => e.importance >= 2).map((e) => ({ text: e.text, rank: e.importance }))),
    ].sort((a, b) => b.rank - a.rank);
    for (const c of cands.slice(0, 5)) this.addFact(c.text);
  }

  private async realRewrite(batch: BenchTurn[]) {
    const maxWords = this.opts.maxWords ?? 250;
    const body = batch.flatMap((t) => [`Anala: ${t.userText}`, `Narrator: ${t.story}`]).join('\n\n');
    // The Phase-1 prompt, word for word.
    const prompt = `Update the running summary of a roleplay story.
${this.summaryText ? `Current summary:\n${this.summaryText}\n\n` : ''}New events:
${body}

Reply with JSON only: {"summary": "<the updated summary, past tense, at most ${maxWords} words, concrete names, places and open threads>", "facts": ["<durable facts worth remembering long-term, e.g. relationships, promises, secrets; max 5>"]}`;
    const text = await this.opts.complete!([{ role: 'system', content: 'You summarize stories faithfully and concisely. Output JSON only.' }, { role: 'user', content: prompt }]);
    const parsed = extractJson<{ summary?: string; facts?: string[] }>(text);
    if (parsed.ok && typeof parsed.value?.summary === 'string') this.summaryText = parsed.value.summary.trim();
    if (parsed.ok && Array.isArray(parsed.value?.facts)) for (const f of parsed.value!.facts.slice(0, 5)) if (typeof f === 'string' && f.trim()) this.addFact(f.trim());
  }

  private addFact(text: string) {
    if (this.facts.some((f) => f.text === text)) return;
    const id = ++this.seq;
    this.facts.push({ id, text, at: id });
    this.db.prepare('INSERT INTO f (id, body) VALUES (?, ?)').run(id, text);
  }

  /** What Phase 1 put in front of the narrator about the past, for this recent text. */
  context(recentText: string): string {
    const parts: string[] = [];
    if (this.summaryText) parts.push(this.summaryText);
    const newest = this.facts.slice(-12).reverse();
    if (newest.length) parts.push(`Long-term memories:\n${newest.map((f) => `- ${f.text}`).join('\n')}`);
    const q = ftsQuery(recentText);
    let relevant: string[] = [];
    if (q) {
      try {
        relevant = (this.db.prepare('SELECT body FROM f WHERE f MATCH ? ORDER BY bm25(f) LIMIT 6').all(q) as Array<{ body: string }>).map((r) => r.body);
      } catch {
        relevant = [];
      }
    }
    if (relevant.length) parts.push(`Relevant:\n${relevant.map((r) => `- ${r}`).join('\n')}`);
    return parts.length ? `[Story so far]\n${parts.join('\n\n')}` : '';
  }
}
