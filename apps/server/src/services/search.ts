/** SQLite FTS5 search over databank, memories, journal, run-ins, diary and characters. */
import type { AppContext } from '../context.js';

export function indexDoc(ctx: AppContext, owner: string, campaignId: string | null, kind: string, refId: string, title: string, body: string) {
  ctx.db.prepare('DELETE FROM search_fts WHERE owner_id = ? AND kind = ? AND ref_id = ?').run(owner, kind, refId);
  ctx.db.prepare('INSERT INTO search_fts (owner_id, campaign_id, kind, ref_id, title, body) VALUES (?, ?, ?, ?, ?, ?)').run(owner, campaignId ?? '', kind, refId, title ?? '', body ?? '');
}

export function removeDoc(ctx: AppContext, owner: string, kind: string, refId: string) {
  ctx.db.prepare('DELETE FROM search_fts WHERE owner_id = ? AND kind = ? AND ref_id = ?').run(owner, kind, refId);
}

export function clearCampaignDocs(ctx: AppContext, owner: string, campaignId: string, kinds: string[]) {
  ctx.db.prepare(`DELETE FROM search_fts WHERE owner_id = ? AND campaign_id = ? AND kind IN (${kinds.map(() => '?').join(',')})`).run(owner, campaignId, ...kinds);
}

/** Turn free text into a safe FTS5 query: OR of quoted terms. */
export function ftsQuery(text: string, maxTerms = 12): string {
  const stop = new Set(['the', 'and', 'for', 'you', 'your', 'are', 'was', 'with', 'that', 'this', 'what', 'have', 'from', 'she', 'her', 'his', 'him', 'they', 'them', 'not', 'but', 'just', 'into', 'about']);
  const terms = [...new Set(String(text).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter((t) => !stop.has(t)).slice(0, maxTerms);
  return terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
}

export interface SearchHit {
  kind: string;
  refId: string;
  campaignId: string;
  title: string;
  snippet: string;
  body: string;
}

export function search(ctx: AppContext, owner: string, text: string, opts: { campaignId?: string | null; kinds?: string[]; limit?: number } = {}): SearchHit[] {
  const q = ftsQuery(text);
  if (!q) return [];
  const where = ['search_fts MATCH ?', 'owner_id = ?'];
  const args: unknown[] = [q, owner];
  if (opts.campaignId) {
    where.push("(campaign_id = ? OR campaign_id = '')");
    args.push(opts.campaignId);
  }
  if (opts.kinds?.length) {
    where.push(`kind IN (${opts.kinds.map(() => '?').join(',')})`);
    args.push(...opts.kinds);
  }
  try {
    const rows = ctx.db
      .prepare(`SELECT kind, ref_id, campaign_id, title, body, snippet(search_fts, 5, '[', ']', '…', 12) AS snip FROM search_fts WHERE ${where.join(' AND ')} ORDER BY bm25(search_fts) LIMIT ?`)
      .all(...args, opts.limit ?? 20) as any[];
    return rows.map((r) => ({ kind: r.kind, refId: r.ref_id, campaignId: r.campaign_id, title: r.title, snippet: r.snip, body: r.body }));
  } catch {
    return [];
  }
}
