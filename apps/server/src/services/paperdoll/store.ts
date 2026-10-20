/**
 * Character Studio on the server (docs/character-studio/): trait sheets for story characters and
 * random NPCs (table studio_characters), and pose/scene templates installed from packs into the
 * owner's media folder (vault-aware), served at /api/paperdoll/templates/:id/….
 *
 * Studio characters are adults (the sheet requires age ≥ 18). A sheet is never linked to a card
 * that is, or is described as, under 18 (minor-guard.ts).
 */
import { fillPrompt, migrateTemplate, migrateTraitSheet, randomSheet, sheetFromAnswer, validateTemplate, type Template, type TraitSheet } from '@everloom/engine/studio';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import { HttpError, type AppContext } from '../../context.js';
import { newId } from '../../security/crypto.js';
import { readContentFile, writeContentFile } from '../../vault/vault.js';
import { cardMinorReason, REFUSED } from '../minor-guard.js';
import { utilityJson } from '../utility.js';

const SAFE = /^[A-Za-z0-9_-]{1,80}$/;

export interface StudioCharacter { id: string; characterId: string | null; kind: 'story' | 'npc'; sheet: TraitSheet; createdAt: number; updatedAt: number }

const row2 = (r: { id: string; character_id: string | null; kind: string; sheet: string; created_at: number; updated_at: number }): StudioCharacter => ({
  id: r.id, characterId: r.character_id, kind: r.kind === 'story' ? 'story' : 'npc', sheet: migrateTraitSheet(JSON.parse(r.sheet)), createdAt: r.created_at, updatedAt: r.updated_at,
});

/** A card linked to a studio sheet must not be, or be described as, a minor. */
function assertCardAdult(ctx: AppContext, owner: string, characterId: string) {
  const r = ctx.db.prepare('SELECT card, game FROM characters WHERE id = ? AND owner_id = ?').get(characterId, owner) as { card: string; game: string } | undefined;
  if (!r) throw new HttpError(404, 'Character not found');
  if (cardMinorReason(JSON.parse(r.card), JSON.parse(r.game))) throw new HttpError(400, `${REFUSED} The Character Studio only makes adults.`);
}

export function listStudioCharacters(ctx: AppContext, owner: string, o: { page?: number; perPage?: number } = {}) {
  const per = Math.max(1, Math.min(100, o.perPage ?? 13)), page = Math.max(0, o.page ?? 0);
  const total = (ctx.db.prepare('SELECT COUNT(*) AS n FROM studio_characters WHERE owner_id = ?').get(owner) as { n: number }).n;
  const rows = ctx.db.prepare('SELECT * FROM studio_characters WHERE owner_id = ? ORDER BY created_at LIMIT ? OFFSET ?').all(owner, per, page * per) as Parameters<typeof row2>[0][];
  return { items: rows.map(row2), page, pages: Math.max(1, Math.ceil(total / per)), total };
}

export function getStudioCharacter(ctx: AppContext, owner: string, id: string): StudioCharacter {
  const r = ctx.db.prepare('SELECT * FROM studio_characters WHERE id = ? AND owner_id = ?').get(id, owner) as Parameters<typeof row2>[0] | undefined;
  if (!r) throw new HttpError(404, 'Studio character not found');
  return row2(r);
}

export function studioForCharacter(ctx: AppContext, owner: string, characterId: string): StudioCharacter | null {
  const r = ctx.db.prepare('SELECT * FROM studio_characters WHERE owner_id = ? AND character_id = ?').get(owner, characterId) as Parameters<typeof row2>[0] | undefined;
  return r ? row2(r) : null;
}

export function saveStudioCharacter(ctx: AppContext, owner: string, input: { id?: string; characterId?: string | null; sheet: unknown }): StudioCharacter {
  let sheet: TraitSheet;
  try { sheet = migrateTraitSheet(input.sheet); } catch (e) { throw new HttpError(400, `Not a valid trait sheet: ${(e as Error).message.slice(0, 300)}`); }
  const now = Date.now();
  if (input.id) {
    const cur = getStudioCharacter(ctx, owner, input.id);
    // A locked design keeps its traits; only unlocking (or renaming) changes it.
    if (cur.sheet.locked && sheet.locked) sheet = { ...cur.sheet, name: sheet.name, locked: true };
    const characterId = input.characterId === undefined ? cur.characterId : input.characterId;
    if (characterId) assertCardAdult(ctx, owner, characterId);
    ctx.db.prepare('UPDATE studio_characters SET sheet = ?, character_id = ?, kind = ?, updated_at = ? WHERE id = ? AND owner_id = ?').run(JSON.stringify(sheet), characterId, characterId ? 'story' : 'npc', now, input.id, owner);
    return getStudioCharacter(ctx, owner, input.id);
  }
  if (input.characterId) {
    assertCardAdult(ctx, owner, input.characterId);
    if (studioForCharacter(ctx, owner, input.characterId)) throw new HttpError(409, 'This character already has a studio look');
  }
  const id = newId('sc_');
  ctx.db.prepare('INSERT INTO studio_characters (id, owner_id, character_id, kind, sheet, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, owner, input.characterId ?? null, input.characterId ? 'story' : 'npc', JSON.stringify(sheet), now, now);
  return getStudioCharacter(ctx, owner, id);
}

export function deleteStudioCharacter(ctx: AppContext, owner: string, id: string) {
  ctx.db.prepare('DELETE FROM studio_characters WHERE id = ? AND owner_id = ?').run(id, owner);
}

/** Random NPC: a coherent roll (locks keep traits of `base`), not saved until the owner keeps it. */
export function rollStudioCharacter(ctx: AppContext, owner: string, o: { seed?: number; base?: unknown; locks?: string[]; sex?: 'female' | 'male' }) {
  const outfits = listTemplates(ctx, owner).flatMap((t) => outfitSets(t));
  return randomSheet({ seed: o.seed, base: o.base ? migrateTraitSheet(o.base) : undefined, locks: o.locks as never, sex: o.sex, outfits });
}

/** The outfit sets a template offers (its wardrobe items, grouped coherently: tops with bottoms). */
function outfitSets(t: TemplateMeta) {
  const w = t.supports?.wardrobe ?? {};
  const tops = w.top ?? [], bottoms = w.bottom ?? [];
  return tops.flatMap((top) => (bottoms.length ? bottoms.map((b) => ({ id: `${top}+${b}`, items: { top, bottom: b, shoes: w.shoes?.[0] ?? null } })) : [{ id: top, items: { top } }]));
}

/** Fill a sheet from a character's card with the utility model (reviewed by the owner, not saved). */
export async function fillFromCharacter(ctx: AppContext, owner: string, characterId: string): Promise<TraitSheet> {
  const r = ctx.db.prepare('SELECT name, card, game FROM characters WHERE id = ? AND owner_id = ?').get(characterId, owner) as { name: string; card: string; game: string } | undefined;
  if (!r) throw new HttpError(404, 'Character not found');
  const card = JSON.parse(r.card), game = JSON.parse(r.game);
  if (cardMinorReason(card, game)) throw new HttpError(400, `${REFUSED} The Character Studio only makes adults.`);
  const answer = await utilityJson<unknown>(ctx, owner, 'You describe how a character looks, for a character creator. Reply with JSON only.', fillPrompt({ name: r.name, description: card.description ?? '', personality: card.personality ?? '' }), 600, 'studio look');
  const { sheet, reason } = sheetFromAnswer(r.name, JSON.stringify(answer));
  if (!sheet) throw new HttpError(400, reason ?? 'No sheet');
  return { ...sheet, age: game?.age && game.age >= 18 ? game.age : sheet.age };
}

// ---------------------------------------------------------------- templates

export type TemplateMeta = Pick<Template, 'id' | 'name' | 'category' | 'rating' | 'width' | 'height' | 'supports' | 'options' | 'tags'> & { slots: Array<{ id: string; sex: string[] }>; base: string };

export function templatesDir(ctx: AppContext, owner: string, ...parts: string[]) {
  if (!SAFE.test(owner) || parts.some((p) => !SAFE.test(p))) throw new HttpError(400, 'Bad id');
  const d = path.join(ctx.cfg.mediaDir, owner, 'studio', ...parts);
  mkdirSync(d, { recursive: true });
  return d;
}

export function getTemplate(ctx: AppContext, owner: string, id: string): Template | null {
  if (!SAFE.test(id)) return null;
  const f = path.join(ctx.cfg.mediaDir, owner, 'studio', id, 'template.json');
  if (!existsSync(f)) return null;
  try { return migrateTemplate(JSON.parse(readContentFile(ctx.vault, f).toString('utf8'))); } catch { return null; }
}

export function listTemplates(ctx: AppContext, owner: string): TemplateMeta[] {
  const root = templatesDir(ctx, owner);
  const out: TemplateMeta[] = [];
  for (const id of readdirSync(root)) {
    const t = getTemplate(ctx, owner, id);
    if (!t) continue;
    out.push({ id: t.id, name: t.name, category: t.category, rating: t.rating, width: t.width, height: t.height, supports: t.supports, options: t.options, tags: t.tags, slots: t.slots.map((s) => ({ id: s.id, sex: s.sex })), base: `/api/paperdoll/templates/${t.id}/` });
  }
  return out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export function deleteTemplate(ctx: AppContext, owner: string, id: string) {
  rmSync(templatesDir(ctx, owner, id), { recursive: true, force: true });
}

/**
 * Installs templates from a pack zip: one or more folders (or the root) holding template.json and
 * its pictures. Every template is validated (schema + semantic checks, adult layers only in 18+
 * templates) and every picture re-encoded (pixels only).
 */
export async function installTemplatePack(ctx: AppContext, owner: string, zip: Buffer): Promise<TemplateMeta[]> {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(zip); } catch { throw new HttpError(400, 'That is not a zip file'); }
  const indexes = Object.keys(files).filter((p) => p === 'template.json' || /^[^/]+\/template\.json$/.test(p));
  if (!indexes.length) throw new HttpError(400, 'No template.json in the pack');
  const installed: string[] = [];
  for (const ix of indexes) {
    const base = ix.slice(0, -'template.json'.length);
    let t: Template;
    try { t = migrateTemplate(JSON.parse(Buffer.from(files[ix]!).toString('utf8'))); } catch (e) { throw new HttpError(400, `${ix}: ${(e as Error).message.slice(0, 300)}`); }
    const errs = validateTemplate(t);
    if (errs.length) throw new HttpError(400, `${t.id}: ${errs.slice(0, 3).join('; ')}`);
    const needed = new Set<string>();
    for (const s of t.slots) for (const l of s.layers) { needed.add(l.file); for (const r of l.recolor) if (r.mask) needed.add(r.mask); }
    const dir = templatesDir(ctx, owner, t.id);
    for (const f of needed) {
      if (f.includes('..') || f.startsWith('/')) throw new HttpError(400, `${t.id}: bad file name ${f}`);
      const buf = files[`${base}${f}`];
      if (!buf) throw new HttpError(400, `${t.id}: missing ${f}`);
      const meta = await sharp(Buffer.from(buf)).metadata().catch(() => null);
      if (!meta || !['png', 'webp'].includes(meta.format ?? '')) throw new HttpError(400, `${t.id}: ${f} is not a picture`);
      const out = path.join(dir, f);
      mkdirSync(path.dirname(out), { recursive: true });
      writeContentFile(ctx.vault, out, meta.format === 'png' ? await sharp(Buffer.from(buf)).png().toBuffer() : await sharp(Buffer.from(buf)).webp({ lossless: true }).toBuffer());
    }
    writeContentFile(ctx.vault, path.join(dir, 'template.json'), Buffer.from(JSON.stringify(t)));
    installed.push(t.id);
  }
  return listTemplates(ctx, owner).filter((t) => installed.includes(t.id));
}
