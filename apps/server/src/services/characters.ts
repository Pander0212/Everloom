import sharp from 'sharp';
import {
  buildV2Json, cardHash, characterBookToWorld, emptyCardData, readCardFile, worldToCharacterBook, writeCardToPng,
  type CardData, type CharacterDTO, type CharacterGame, type CharacterSummary,
} from '@everloom/engine';
import { readFileSync } from 'node:fs';
import { HttpError, type AppContext } from '../context.js';
import { json } from '../db/index.js';
import { newId } from '../security/crypto.js';
import { createLorebook, getCharacterBook } from './lorebooks.js';
import { getMedia, mediaUrl, saveImage } from './media.js';
import { indexDoc, removeDoc } from './search.js';
import { countTokens } from './tokens.js';
import { autoSnapshot } from './versions.js';

function summary(r: any): CharacterSummary {
  const card: CardData = json(r.card, emptyCardData(r.name));
  return {
    id: r.id,
    name: r.name,
    avatar: mediaUrl(r.avatar),
    tags: json(r.tags, []),
    fav: !!r.fav,
    description: (card.creator_notes || card.description || '').slice(0, 280),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastChatAt: r.last_chat_at,
    chatCount: r.chat_count ?? 0,
    displayName: r.display_name ?? null,
    creator: r.creator ?? card.creator ?? '',
    tokens: r.tokens ?? 0,
    hash: r.content_hash ?? '',
    version: card.character_version ?? '',
    hasLorebook: !!r.has_book,
    hasGallery: !!r.has_gallery,
    hasGreetings: (card.alternate_greetings ?? []).length > 0,
    linked: r.source ? (json<{ key?: string }>(r.source, {}).key ?? null) : null,
    collections: r.cols ? String(r.cols).split(',') : [],
  };
}

const SUMMARY_SQL = `SELECT c.*,
  (SELECT COUNT(*) FROM chats WHERE character_id = c.id) AS chat_count,
  EXISTS (SELECT 1 FROM lorebooks l WHERE l.owner_id = c.owner_id AND l.scope = 'character' AND l.scope_id = c.id) AS has_book,
  (EXISTS (SELECT 1 FROM media m WHERE m.owner_id = c.owner_id AND m.character_id = c.id AND m.kind IN ('gallery', 'portrait')) OR json_array_length(COALESCE(json_extract(c.game, '$.gallery'), '[]')) > 0) AS has_gallery,
  (SELECT group_concat(collection_id) FROM collection_items ci WHERE ci.character_id = c.id) AS cols
  FROM characters c`;

export function listCharacters(ctx: AppContext, owner: string): CharacterSummary[] {
  const rows = ctx.db.prepare(`${SUMMARY_SQL} WHERE c.owner_id = ? ORDER BY c.fav DESC, COALESCE(c.last_chat_at, c.updated_at) DESC`).all(owner) as any[];
  return rows.map(summary);
}

export function getCharacter(ctx: AppContext, owner: string, id: string): CharacterDTO {
  const r = ctx.db.prepare(`${SUMMARY_SQL} WHERE c.id = ? AND c.owner_id = ?`).get(id, owner) as any;
  if (!r) throw new HttpError(404, 'Character not found');
  return { ...summary(r), card: json(r.card, emptyCardData(r.name)), game: json(r.game, {}) };
}

/** Creator, permanent token count and content hash, kept in columns for fast filtering. */
export function refreshMeta(ctx: AppContext, id: string) {
  const r = ctx.db.prepare('SELECT card, name FROM characters WHERE id = ?').get(id) as { card: string; name: string } | undefined;
  if (!r) return;
  const card: CardData = json(r.card, emptyCardData(r.name));
  const perm = [card.description, card.personality, card.scenario, card.first_mes, card.mes_example, card.system_prompt, card.post_history_instructions].filter(Boolean).join('\n');
  ctx.db.prepare('UPDATE characters SET creator = ?, tokens = ?, content_hash = ? WHERE id = ?').run(String(card.creator ?? '').slice(0, 200), countTokens(perm), cardHash({ ...card, name: r.name }), id);
}

/** Fill library columns for characters created before they existed. */
export function backfillMeta(ctx: AppContext) {
  const ids = ctx.db.prepare("SELECT id FROM characters WHERE content_hash = ''").all() as Array<{ id: string }>;
  const tx = ctx.db.transaction(() => {
    for (const { id } of ids) refreshMeta(ctx, id);
  });
  tx();
  return ids.length;
}

export function characterRow(ctx: AppContext, owner: string, id: string): any {
  const r = ctx.db.prepare('SELECT * FROM characters WHERE id = ? AND owner_id = ?').get(id, owner);
  if (!r) throw new HttpError(404, 'Character not found');
  return r;
}

export function createCharacter(ctx: AppContext, owner: string, card: CardData, opts: { avatar?: string | null; game?: CharacterGame; topExtras?: Record<string, unknown> } = {}): CharacterDTO {
  const id = newId('ch_');
  const now = Date.now();
  const { character_book, ...rest } = card;
  ctx.db
    .prepare('INSERT INTO characters (id, owner_id, name, avatar, card, top_extras, tags, fav, game, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, owner, card.name, opts.avatar ?? null, JSON.stringify(rest), JSON.stringify(opts.topExtras ?? {}), JSON.stringify(card.tags ?? []), card.extensions?.fav ? 1 : 0, JSON.stringify(opts.game ?? {}), now, now);
  if (character_book && Array.isArray(character_book.entries)) {
    createLorebook(ctx, owner, { name: character_book.name || `${card.name}'s lore`, scope: 'character', scopeId: id, book: characterBookToWorld(character_book, character_book.name || `${card.name}'s lore`) });
  }
  indexDoc(ctx, owner, null, 'character', id, card.name, `${card.description}\n${card.personality}\n${card.scenario}`);
  refreshMeta(ctx, id);
  return getCharacter(ctx, owner, id);
}

export function updateCharacter(ctx: AppContext, owner: string, id: string, patch: { card?: Partial<CardData>; game?: CharacterGame; fav?: boolean; avatar?: string | null; displayName?: string | null }, opts: { snapshot?: boolean } = {}): CharacterDTO {
  const cur = getCharacter(ctx, owner, id);
  // Every save that changes the card keeps the previous version.
  if (opts.snapshot !== false && (patch.card || patch.game)) autoSnapshot(ctx, owner, id);
  if (patch.displayName !== undefined) ctx.db.prepare('UPDATE characters SET display_name = ? WHERE id = ?').run(patch.displayName?.trim() ? patch.displayName.trim().slice(0, 120) : null, id);
  const card: CardData = { ...cur.card, ...(patch.card ?? {}) };
  delete (card as any).character_book;
  if (patch.fav !== undefined) card.extensions = { ...card.extensions, fav: patch.fav };
  const game = patch.game ? { ...cur.game, ...patch.game } : cur.game;
  ctx.db
    .prepare('UPDATE characters SET name = ?, card = ?, tags = ?, fav = ?, game = ?, avatar = COALESCE(?, avatar), updated_at = ? WHERE id = ? AND owner_id = ?')
    .run(card.name, JSON.stringify(card), JSON.stringify(card.tags ?? []), (patch.fav ?? cur.fav) ? 1 : 0, JSON.stringify(game), patch.avatar ?? null, Date.now(), id, owner);
  if (patch.avatar === null) ctx.db.prepare('UPDATE characters SET avatar = NULL WHERE id = ?').run(id);
  indexDoc(ctx, owner, null, 'character', id, card.name, `${card.description}\n${card.personality}\n${card.scenario}`);
  refreshMeta(ctx, id);
  return getCharacter(ctx, owner, id);
}

export function deleteCharacter(ctx: AppContext, owner: string, id: string) {
  characterRow(ctx, owner, id);
  ctx.db.prepare('DELETE FROM characters WHERE id = ? AND owner_id = ?').run(id, owner);
  ctx.db.prepare("DELETE FROM lorebooks WHERE owner_id = ? AND scope = 'character' AND scope_id = ?").run(owner, id);
  removeDoc(ctx, owner, 'character', id);
}

export function duplicateCharacter(ctx: AppContext, owner: string, id: string): CharacterDTO {
  const c = getCharacter(ctx, owner, id);
  const book = getCharacterBook(ctx, owner, id);
  const card = { ...c.card, name: `${c.card.name} (copy)` } as CardData;
  if (book) card.character_book = worldToCharacterBook(book.book);
  const row = characterRow(ctx, owner, id);
  return createCharacter(ctx, owner, card, { avatar: row.avatar, game: c.game, topExtras: json(row.top_extras, {}) });
}

/** Import a PNG / WebP / JSON card. */
export async function importCard(ctx: AppContext, owner: string, bytes: Buffer): Promise<CharacterDTO> {
  if (bytes.length > 30 * 1024 * 1024) throw new HttpError(413, 'Card file too large');
  let parsed;
  try {
    parsed = readCardFile(new Uint8Array(bytes));
  } catch (e) {
    throw new HttpError(400, `Not a character card: ${(e as Error).message}`);
  }
  let avatar: string | null = null;
  const head = new Uint8Array(bytes.subarray(0, 16));
  if (head[0] === 0x89 || (head[0] === 0x52 && head[8] === 0x57)) {
    try {
      avatar = (await saveImage(ctx, owner, bytes, { kind: 'avatar', maxDim: 1536 })).id;
    } catch {
      avatar = null;
    }
  }
  const everloom = parsed.data.extensions?.everloom as CharacterGame | undefined;
  return createCharacter(ctx, owner, parsed.data, { avatar, topExtras: parsed.topLevelExtras, game: everloom ?? {} });
}

function exportData(ctx: AppContext, owner: string, id: string): { card: CardData; extras: Record<string, unknown>; row: any } {
  const row = characterRow(ctx, owner, id);
  const c = getCharacter(ctx, owner, id);
  const card: CardData = { ...c.card };
  const book = getCharacterBook(ctx, owner, id);
  if (book) card.character_book = worldToCharacterBook(book.book);
  // Carry game-layer data inside extensions so it survives a trip through other apps.
  if (Object.keys(c.game ?? {}).length) card.extensions = { ...card.extensions, everloom: { ...c.game, expressions: undefined, gallery: undefined } };
  card.extensions = { ...card.extensions, fav: c.fav };
  return { card, extras: json(row.top_extras, {}), row };
}

export function exportCardJson(ctx: AppContext, owner: string, id: string): Record<string, unknown> {
  const { card, extras } = exportData(ctx, owner, id);
  return buildV2Json(card, extras);
}

export async function exportCardPng(ctx: AppContext, owner: string, id: string): Promise<Buffer> {
  const { card, extras, row } = exportData(ctx, owner, id);
  let png: Buffer;
  if (row.avatar) {
    const { file } = getMedia(ctx, owner, row.avatar);
    png = await sharp(readFileSync(file)).png().toBuffer();
  } else {
    png = await sharp({ create: { width: 400, height: 600, channels: 3, background: { r: 38, g: 40, b: 46 } } }).png().toBuffer();
  }
  return Buffer.from(writeCardToPng(new Uint8Array(png), card, extras));
}
