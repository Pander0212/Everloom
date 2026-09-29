/** Optional semantic World Info retrieval: entry embeddings cached in SQLite, cosine similarity. */
import type { LorebookDTO } from '@everloom/engine';
import type { AppContext } from '../context.js';
import { embed } from '../llm/providers.js';
import { sha256 } from '../security/crypto.js';
import { connectionForRole } from './connections.js';

function toBlob(v: number[]): Buffer {
  return Buffer.from(new Float32Array(v).buffer);
}

function fromBlob(b: Buffer): Float32Array {
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export async function ensureEmbeddings(ctx: AppContext, owner: string, books: LorebookDTO[]): Promise<number> {
  const conn = connectionForRole(ctx, owner, 'embeddings');
  if (!conn) return 0;
  const model = conn.params.embeddings_model || conn.model;
  const pending: Array<{ book: string; uid: string; hash: string; text: string }> = [];
  for (const b of books) {
    for (const e of Object.values(b.book.entries)) {
      if (e.disable || !e.content.trim()) continue;
      const text = `${e.comment ? e.comment + ': ' : ''}${e.content}`.slice(0, 4000);
      const hash = sha256(model + text);
      const row = ctx.db.prepare('SELECT hash FROM lore_embeddings WHERE book_id = ? AND entry_uid = ?').get(b.id, String(e.uid)) as { hash: string } | undefined;
      if (row?.hash !== hash) pending.push({ book: b.id, uid: String(e.uid), hash, text });
    }
  }
  for (let i = 0; i < pending.length; i += 64) {
    const batch = pending.slice(i, i + 64);
    const vectors = await embed(conn, batch.map((p) => p.text));
    const up = ctx.db.prepare(
      'INSERT INTO lore_embeddings (owner_id, book_id, entry_uid, hash, model, vector) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(book_id, entry_uid) DO UPDATE SET hash = excluded.hash, model = excluded.model, vector = excluded.vector',
    );
    ctx.db.transaction(() => batch.forEach((p, j) => vectors[j] && up.run(owner, p.book, p.uid, p.hash, model, toBlob(vectors[j]))))();
  }
  return pending.length;
}

/** Returns keys "<bookId>.<uid>" of entries semantically close to the query. */
export async function semanticHits(ctx: AppContext, owner: string, books: LorebookDTO[], query: string, topK: number, threshold: number): Promise<Set<string>> {
  const conn = connectionForRole(ctx, owner, 'embeddings');
  if (!conn || !query.trim()) return new Set();
  await ensureEmbeddings(ctx, owner, books);
  const [q] = await embed(conn, [query.slice(0, 4000)]);
  if (!q) return new Set();
  const ids = books.map((b) => b.id);
  if (!ids.length) return new Set();
  const rows = ctx.db.prepare(`SELECT book_id, entry_uid, vector FROM lore_embeddings WHERE owner_id = ? AND book_id IN (${ids.map(() => '?').join(',')})`).all(owner, ...ids) as Array<{ book_id: string; entry_uid: string; vector: Buffer }>;
  const scored = rows.map((r) => ({ key: `${r.book_id}.${r.entry_uid}`, score: cosine(q, fromBlob(r.vector)) })).filter((s) => s.score >= threshold);
  scored.sort((a, b) => b.score - a.score);
  return new Set(scored.slice(0, topK).map((s) => s.key));
}
