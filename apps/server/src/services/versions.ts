/**
 * Character version history: an automatic snapshot before every save that changes the card,
 * manual snapshots with a label, a field-level diff against the current card, and restore
 * (which snapshots the current state first, so a restore is itself undoable).
 */
import { diffCards, emptyCardData, type CardData, type CharacterGame, type FieldDiff } from '@everloom/engine';
import type { AppContext } from '../context.js';
import { HttpError } from '../context.js';
import { json } from '../db/index.js';
import { newId } from '../security/crypto.js';
import { getSettings } from './settings.js';

export interface VersionRow {
  id: string;
  kind: 'auto' | 'manual' | 'restore' | 'update';
  label: string;
  name: string;
  createdAt: number;
  /** Fields that differ from the character as it is now. */
  changed: string[];
}

function currentRow(ctx: AppContext, owner: string, id: string) {
  const r = ctx.db.prepare('SELECT name, card, game, avatar FROM characters WHERE id = ? AND owner_id = ?').get(id, owner) as { name: string; card: string; game: string; avatar: string | null } | undefined;
  if (!r) throw new HttpError(404, 'Character not found');
  return r;
}

export function snapshot(ctx: AppContext, owner: string, characterId: string, kind: VersionRow['kind'], label = ''): string {
  const r = currentRow(ctx, owner, characterId);
  const id = newId('cv_');
  ctx.db.prepare('INSERT INTO character_versions (id, owner_id, character_id, kind, label, name, card, game, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, owner, characterId, kind, label.slice(0, 120), r.name, r.card, r.game, r.avatar, Date.now());
  prune(ctx, owner, characterId);
  return id;
}

/** Before a save: keep the current card unless the newest snapshot already is it. */
export function autoSnapshot(ctx: AppContext, owner: string, characterId: string) {
  const r = currentRow(ctx, owner, characterId);
  const last = ctx.db.prepare('SELECT card, game FROM character_versions WHERE character_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(characterId) as { card: string; game: string } | undefined;
  if (last && last.card === r.card && last.game === r.game) return;
  snapshot(ctx, owner, characterId, 'auto');
}

function prune(ctx: AppContext, owner: string, characterId: string) {
  const keep = Math.max(1, getSettings(ctx, owner).library.versionRetention);
  ctx.db.prepare("DELETE FROM character_versions WHERE character_id = ? AND kind != 'manual' AND id NOT IN (SELECT id FROM character_versions WHERE character_id = ? AND kind != 'manual' ORDER BY created_at DESC, rowid DESC LIMIT ?)").run(characterId, characterId, keep);
}

export function listVersions(ctx: AppContext, owner: string, characterId: string): VersionRow[] {
  const cur = currentRow(ctx, owner, characterId);
  const curCard = json<CardData>(cur.card, emptyCardData(cur.name));
  const rows = ctx.db.prepare('SELECT * FROM character_versions WHERE character_id = ? AND owner_id = ? ORDER BY created_at DESC, rowid DESC').all(characterId, owner) as any[];
  return rows.map((r) => ({ id: r.id, kind: r.kind, label: r.label, name: r.name, createdAt: r.created_at, changed: diffCards(json<CardData>(r.card, emptyCardData(r.name)), curCard).map((d) => d.label) }));
}

export function versionDiff(ctx: AppContext, owner: string, characterId: string, versionId: string): FieldDiff[] {
  const v = ctx.db.prepare('SELECT * FROM character_versions WHERE id = ? AND character_id = ? AND owner_id = ?').get(versionId, characterId, owner) as any;
  if (!v) throw new HttpError(404, 'Version not found');
  const cur = currentRow(ctx, owner, characterId);
  // "before" is the version, "after" is now: reading it shows what changed since.
  return diffCards(json<CardData>(v.card, emptyCardData(v.name)), json<CardData>(cur.card, emptyCardData(cur.name)));
}

export function restoreVersion(ctx: AppContext, owner: string, characterId: string, versionId: string) {
  const v = ctx.db.prepare('SELECT * FROM character_versions WHERE id = ? AND character_id = ? AND owner_id = ?').get(versionId, characterId, owner) as any;
  if (!v) throw new HttpError(404, 'Version not found');
  snapshot(ctx, owner, characterId, 'restore', 'Before restoring');
  const card = json<CardData>(v.card, emptyCardData(v.name));
  ctx.db.prepare('UPDATE characters SET name = ?, card = ?, game = ?, tags = ?, avatar = COALESCE(?, avatar), updated_at = ? WHERE id = ? AND owner_id = ?').run(v.name, v.card, v.game ?? '{}', JSON.stringify(card.tags ?? []), v.avatar, Date.now(), characterId, owner);
  return json<CharacterGame>(v.game, {});
}

export function deleteVersion(ctx: AppContext, owner: string, versionId: string) {
  ctx.db.prepare('DELETE FROM character_versions WHERE id = ? AND owner_id = ?').run(versionId, owner);
}
