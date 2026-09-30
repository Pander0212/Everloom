/** Character library: collections, batch actions with undo, duplicates and related characters. */
import { findDuplicates, relatedTo, type CharacterSummary } from '@everloom/engine';
import type { AppContext } from '../context.js';
import { HttpError } from '../context.js';
import { newId } from '../security/crypto.js';
import { deleteCharacter, getCharacter, listCharacters, updateCharacter } from './characters.js';

// ------------------------------------------------------------------ collections

export interface CollectionDTO {
  id: string;
  name: string;
  icon: string;
  color: string;
  position: number;
  characterIds: string[];
}

export function listCollections(ctx: AppContext, owner: string): CollectionDTO[] {
  const rows = ctx.db.prepare('SELECT * FROM collections WHERE owner_id = ? ORDER BY position, created_at').all(owner) as any[];
  const items = ctx.db.prepare('SELECT ci.collection_id, ci.character_id FROM collection_items ci JOIN collections c ON c.id = ci.collection_id WHERE c.owner_id = ? ORDER BY ci.position, ci.added_at').all(owner) as Array<{ collection_id: string; character_id: string }>;
  return rows.map((r) => ({ id: r.id, name: r.name, icon: r.icon, color: r.color, position: r.position, characterIds: items.filter((i) => i.collection_id === r.id).map((i) => i.character_id) }));
}

function collectionRow(ctx: AppContext, owner: string, id: string) {
  const r = ctx.db.prepare('SELECT * FROM collections WHERE id = ? AND owner_id = ?').get(id, owner);
  if (!r) throw new HttpError(404, 'Collection not found');
  return r;
}

export function saveCollection(ctx: AppContext, owner: string, input: { name: string; icon?: string; color?: string }, id?: string): CollectionDTO {
  const now = Date.now();
  if (id) {
    collectionRow(ctx, owner, id);
    ctx.db.prepare('UPDATE collections SET name = ?, icon = COALESCE(?, icon), color = COALESCE(?, color), updated_at = ? WHERE id = ?').run(input.name.trim().slice(0, 80), input.icon ?? null, input.color ?? null, now, id);
  } else {
    id = newId('col_');
    const pos = ((ctx.db.prepare('SELECT MAX(position) AS p FROM collections WHERE owner_id = ?').get(owner) as { p: number | null }).p ?? -1) + 1;
    ctx.db.prepare('INSERT INTO collections (id, owner_id, name, icon, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, owner, input.name.trim().slice(0, 80), input.icon ?? 'folder', input.color ?? 'accent', pos, now, now);
  }
  return listCollections(ctx, owner).find((c) => c.id === id)!;
}

export function deleteCollection(ctx: AppContext, owner: string, id: string) {
  collectionRow(ctx, owner, id);
  ctx.db.prepare('DELETE FROM collection_items WHERE collection_id = ?').run(id);
  ctx.db.prepare('DELETE FROM collections WHERE id = ?').run(id);
}

export function reorderCollections(ctx: AppContext, owner: string, ids: string[]) {
  const up = ctx.db.prepare('UPDATE collections SET position = ? WHERE id = ? AND owner_id = ?');
  ctx.db.transaction(() => ids.forEach((id, i) => up.run(i, id, owner)))();
}

/** Put characters in a collection (appended in order), take them out, or set the whole order. */
export function editCollection(ctx: AppContext, owner: string, id: string, input: { add?: string[]; remove?: string[]; order?: string[] }) {
  collectionRow(ctx, owner, id);
  const own = new Set(listCharacters(ctx, owner).map((c) => c.id));
  ctx.db.transaction(() => {
    let pos = ((ctx.db.prepare('SELECT MAX(position) AS p FROM collection_items WHERE collection_id = ?').get(id) as { p: number | null }).p ?? -1) + 1;
    for (const c of input.add ?? []) if (own.has(c)) ctx.db.prepare('INSERT OR IGNORE INTO collection_items (collection_id, character_id, position, added_at) VALUES (?, ?, ?, ?)').run(id, c, pos++, Date.now());
    for (const c of input.remove ?? []) ctx.db.prepare('DELETE FROM collection_items WHERE collection_id = ? AND character_id = ?').run(id, c);
    if (input.order) input.order.forEach((c, i) => ctx.db.prepare('UPDATE collection_items SET position = ? WHERE collection_id = ? AND character_id = ?').run(i, id, c));
  })();
  return listCollections(ctx, owner).find((c) => c.id === id)!;
}

// ------------------------------------------------------------------ batch actions

export type BatchAction = { action: 'tag'; tags: string[] } | { action: 'untag'; tags: string[] } | { action: 'fav'; value: boolean } | { action: 'delete' } | { action: 'collect'; collectionId: string } | { action: 'uncollect'; collectionId: string };

/** Apply one action to many characters. Deletes go to the trash first, so they can be undone. */
export function batch(ctx: AppContext, owner: string, ids: string[], a: BatchAction): { done: number; undoId?: string } {
  const list = ids.filter((id) => ctx.db.prepare('SELECT 1 FROM characters WHERE id = ? AND owner_id = ?').get(id, owner));
  if (a.action === 'delete') return { done: list.length, undoId: trashAndDelete(ctx, owner, list) };
  if (a.action === 'collect' || a.action === 'uncollect') {
    editCollection(ctx, owner, a.collectionId, a.action === 'collect' ? { add: list } : { remove: list });
    return { done: list.length };
  }
  ctx.db.transaction(() => {
    for (const id of list) {
      const c = getCharacter(ctx, owner, id);
      if (a.action === 'fav') updateCharacter(ctx, owner, id, { fav: a.value }, { snapshot: false });
      else {
        const norm = (t: string) => t.trim().toLowerCase();
        const want = a.tags.map((t) => t.trim()).filter(Boolean);
        const tags = a.action === 'tag' ? [...c.tags, ...want.filter((t) => !c.tags.some((x) => norm(x) === norm(t)))] : c.tags.filter((x) => !want.some((t) => norm(t) === norm(x)));
        if (tags.length !== c.tags.length) updateCharacter(ctx, owner, id, { card: { tags } }, { snapshot: false });
      }
    }
  })();
  return { done: list.length };
}

/** Keep everything needed to bring characters back exactly (same ids), then delete them. */
function trashAndDelete(ctx: AppContext, owner: string, ids: string[]): string {
  const payload = ids.map((id) => ({
    character: ctx.db.prepare('SELECT * FROM characters WHERE id = ?').get(id),
    lorebooks: ctx.db.prepare("SELECT * FROM lorebooks WHERE owner_id = ? AND scope = 'character' AND scope_id = ?").all(owner, id),
    collections: ctx.db.prepare('SELECT * FROM collection_items WHERE character_id = ?').all(id),
    versions: ctx.db.prepare('SELECT * FROM character_versions WHERE character_id = ?').all(id),
  }));
  const trashId = newId('tr_');
  ctx.db.transaction(() => {
    ctx.db.prepare('INSERT INTO character_trash (id, owner_id, payload, created_at) VALUES (?, ?, ?, ?)').run(trashId, owner, JSON.stringify(payload), Date.now());
    for (const id of ids) {
      deleteCharacter(ctx, owner, id);
      ctx.db.prepare('DELETE FROM collection_items WHERE character_id = ?').run(id);
      ctx.db.prepare('DELETE FROM character_versions WHERE character_id = ?').run(id);
    }
    // The trash keeps the last day only.
    ctx.db.prepare('DELETE FROM character_trash WHERE owner_id = ? AND created_at < ?').run(owner, Date.now() - 24 * 3600_000);
  })();
  return trashId;
}

const insertRow = (ctx: AppContext, table: string, row: Record<string, unknown>) => {
  const cols = Object.keys(row);
  ctx.db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c] as any));
};

export function undoDelete(ctx: AppContext, owner: string, trashId: string): number {
  const t = ctx.db.prepare('SELECT * FROM character_trash WHERE id = ? AND owner_id = ?').get(trashId, owner) as { payload: string } | undefined;
  if (!t) throw new HttpError(404, 'Nothing to undo');
  const payload = JSON.parse(t.payload) as Array<{ character: Record<string, unknown>; lorebooks: Record<string, unknown>[]; collections: Record<string, unknown>[]; versions: Record<string, unknown>[] }>;
  ctx.db.transaction(() => {
    for (const p of payload) {
      insertRow(ctx, 'characters', p.character);
      for (const l of p.lorebooks) insertRow(ctx, 'lorebooks', l);
      for (const c of p.collections) if (ctx.db.prepare('SELECT 1 FROM collections WHERE id = ?').get(c.collection_id)) insertRow(ctx, 'collection_items', c);
      for (const v of p.versions) insertRow(ctx, 'character_versions', v);
    }
    ctx.db.prepare('DELETE FROM character_trash WHERE id = ?').run(trashId);
  })();
  return payload.length;
}

// ------------------------------------------------------------------ duplicates and related

export function duplicates(ctx: AppContext, owner: string) {
  const list = listCharacters(ctx, owner);
  const byId = new Map(list.map((c) => [c.id, c]));
  return findDuplicates(list.map((c) => ({ id: c.id, name: c.name, creator: c.creator, hash: c.hash, description: c.description, updatedAt: c.updatedAt }))).map((g) => ({ ...g, characters: g.ids.map((id) => byId.get(id)!) }));
}

/** Keep one character; the others' chats move to it and the others are deleted (undoable). */
export function mergeDuplicates(ctx: AppContext, owner: string, keepId: string, removeIds: string[]): { moved: number; undoId?: string } {
  getCharacter(ctx, owner, keepId);
  const others = removeIds.filter((id) => id !== keepId);
  let moved = 0;
  ctx.db.transaction(() => {
    for (const id of others) moved += ctx.db.prepare('UPDATE chats SET character_id = ? WHERE character_id = ? AND owner_id = ?').run(keepId, id, owner).changes;
  })();
  const { undoId } = batch(ctx, owner, others, { action: 'delete' });
  return { moved, undoId };
}

export function related(ctx: AppContext, owner: string, id: string, limit = 12): Array<CharacterSummary & { score: number; reasons: string[] }> {
  const list = listCharacters(ctx, owner);
  const target = list.find((c) => c.id === id);
  if (!target) throw new HttpError(404, 'Character not found');
  const byId = new Map(list.map((c) => [c.id, c]));
  return relatedTo(target, list, limit).map((r) => ({ ...byId.get(r.id)!, score: r.score, reasons: r.reasons }));
}
