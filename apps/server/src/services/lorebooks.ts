import { normalizeBook, type LorebookDTO, type WorldBook } from '@everloom/engine';
import { HttpError, type AppContext } from '../context.js';
import { json } from '../db/index.js';
import { newId } from '../security/crypto.js';

function toDTO(r: any): LorebookDTO {
  const book: WorldBook = normalizeBook(json(r.data, { entries: {} }), r.name);
  return { id: r.id, name: r.name, scope: r.scope, scopeId: r.scope_id, enabled: !!r.enabled, book, entryCount: Object.keys(book.entries).length, updatedAt: r.updated_at };
}

export function listLorebooks(ctx: AppContext, owner: string, filter: { scope?: string; scopeId?: string } = {}): LorebookDTO[] {
  let sql = 'SELECT * FROM lorebooks WHERE owner_id = ?';
  const args: unknown[] = [owner];
  if (filter.scope) {
    sql += ' AND scope = ?';
    args.push(filter.scope);
  }
  if (filter.scopeId) {
    sql += ' AND scope_id = ?';
    args.push(filter.scopeId);
  }
  return (ctx.db.prepare(sql + ' ORDER BY scope, name').all(...args) as any[]).map(toDTO);
}

export function getLorebook(ctx: AppContext, owner: string, id: string): LorebookDTO {
  const r = ctx.db.prepare('SELECT * FROM lorebooks WHERE id = ? AND owner_id = ?').get(id, owner);
  if (!r) throw new HttpError(404, 'Lorebook not found');
  return toDTO(r);
}

export function getCharacterBook(ctx: AppContext, owner: string, characterId: string): LorebookDTO | null {
  const r = ctx.db.prepare("SELECT * FROM lorebooks WHERE owner_id = ? AND scope = 'character' AND scope_id = ? ORDER BY created_at LIMIT 1").get(owner, characterId);
  return r ? toDTO(r) : null;
}

export function createLorebook(ctx: AppContext, owner: string, input: { name: string; scope?: 'global' | 'character' | 'chat'; scopeId?: string | null; book?: WorldBook; enabled?: boolean }): LorebookDTO {
  const id = newId('lb_');
  const now = Date.now();
  const book = normalizeBook(input.book ?? { entries: {} }, input.name);
  ctx.db
    .prepare('INSERT INTO lorebooks (id, owner_id, name, scope, scope_id, enabled, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, owner, input.name, input.scope ?? 'global', input.scopeId ?? null, input.enabled === false ? 0 : 1, JSON.stringify(book), now, now);
  return getLorebook(ctx, owner, id);
}

export function updateLorebook(ctx: AppContext, owner: string, id: string, patch: { name?: string; scope?: 'global' | 'character' | 'chat'; scopeId?: string | null; book?: WorldBook; enabled?: boolean }): LorebookDTO {
  const cur = getLorebook(ctx, owner, id);
  const book = patch.book ? normalizeBook(patch.book, patch.name ?? cur.name) : cur.book;
  ctx.db
    .prepare('UPDATE lorebooks SET name = ?, scope = ?, scope_id = ?, enabled = ?, data = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
    .run(patch.name ?? cur.name, patch.scope ?? cur.scope, patch.scopeId === undefined ? cur.scopeId : patch.scopeId, (patch.enabled ?? cur.enabled) ? 1 : 0, JSON.stringify(book), Date.now(), id, owner);
  return getLorebook(ctx, owner, id);
}

export function deleteLorebook(ctx: AppContext, owner: string, id: string) {
  ctx.db.prepare('DELETE FROM lorebooks WHERE id = ? AND owner_id = ?').run(id, owner);
  ctx.db.prepare('DELETE FROM lore_embeddings WHERE book_id = ? AND owner_id = ?').run(id, owner);
}

/** Books that apply to a chat: enabled global + character(s) + chat-scoped. */
export function booksForChat(ctx: AppContext, owner: string, chatId: string, characterIds: string[]): LorebookDTO[] {
  const all = listLorebooks(ctx, owner).filter((b) => b.enabled);
  return all.filter((b) => b.scope === 'global' || (b.scope === 'chat' && b.scopeId === chatId) || (b.scope === 'character' && b.scopeId && characterIds.includes(b.scopeId)));
}
