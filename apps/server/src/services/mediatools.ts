/**
 * Media localization and integrity.
 *
 * Localization downloads the remote images a card links to (creator notes are often full of them)
 * into local storage and points the card at the local copy, so it keeps working offline and after
 * the links die. The original link is kept in the media row, so a lost file can be downloaded again.
 *
 * The integrity check is deliberately conservative: it reports broken references and files nobody
 * can reach, and only offers to delete media that nothing in the database mentions any more.
 */
import { findRemoteMedia, replaceMediaUrls, type CardData } from '@everloom/engine';
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { fetchPublic } from '../util/public-fetch.js';
import { getCharacter, updateCharacter } from './characters.js';
import { saveMedia, type MediaRow } from './media.js';

const TEXT_FIELDS = ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions'] as const;
const MEDIA_ID = /m_[A-Za-z0-9_-]{12}/g;

function cardUrls(card: CardData): string[] {
  const all = new Set<string>();
  for (const f of TEXT_FIELDS) for (const u of findRemoteMedia(String(card[f] ?? ''))) all.add(u);
  for (const g of card.alternate_greetings ?? []) for (const u of findRemoteMedia(g)) all.add(u);
  return [...all];
}

/** Characters whose cards still link to remote images. */
export function remoteMediaReport(ctx: AppContext, owner: string): Array<{ id: string; name: string; urls: string[] }> {
  const rows = ctx.db.prepare('SELECT id, name, card FROM characters WHERE owner_id = ?').all(owner) as Array<{ id: string; name: string; card: string }>;
  const out: Array<{ id: string; name: string; urls: string[] }> = [];
  for (const r of rows) {
    if (!r.card.includes('http')) continue;
    let card: CardData;
    try {
      card = JSON.parse(r.card);
    } catch {
      continue;
    }
    const urls = cardUrls(card);
    if (urls.length) out.push({ id: r.id, name: r.name, urls });
  }
  return out.sort((a, b) => b.urls.length - a.urls.length || a.name.localeCompare(b.name));
}

export interface LocalizeResult {
  characterId: string;
  saved: number;
  reused: number;
  failed: Array<{ url: string; error: string }>;
}

async function download(ctx: AppContext, owner: string, url: string, characterId: string | null): Promise<MediaRow> {
  const res = await fetchPublic(url, { maxBytes: 15 * 1024 * 1024, allowPrivate: ctx.cfg.fetchPrivate, headers: { accept: 'image/*,video/*,audio/*;q=0.8,*/*;q=0.5' } });
  if (res.status !== 200) throw new Error(`the server answered ${res.status}`);
  return saveMedia(ctx, owner, res.body, { kind: 'localized', characterId, maxDim: 2560, meta: { source: url } });
}

export async function localizeCharacter(ctx: AppContext, owner: string, id: string): Promise<LocalizeResult> {
  const c = getCharacter(ctx, owner, id);
  const urls = cardUrls(c.card);
  const result: LocalizeResult = { characterId: id, saved: 0, reused: 0, failed: [] };
  if (!urls.length) return result;
  // Copies made earlier for this character (still on disk) are reused, not downloaded again.
  const known = new Map<string, string>();
  for (const r of ctx.db.prepare("SELECT id, filename, meta FROM media WHERE owner_id = ? AND character_id = ? AND kind = 'localized'").all(owner, id) as Array<{ id: string; filename: string; meta: string }>) {
    try {
      const src = JSON.parse(r.meta).source;
      if (src && existsSync(path.join(ctx.cfg.mediaDir, owner, r.filename))) known.set(src, r.id);
    } catch {
      /* bad meta */
    }
  }
  const map: Record<string, string> = {};
  const queue = [...urls];
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      const have = known.get(url);
      if (have) {
        map[url] = `/media/${have}`;
        result.reused++;
        continue;
      }
      try {
        const row = await download(ctx, owner, url, id);
        map[url] = `/media/${row.id}`;
        result.saved++;
      } catch (e) {
        result.failed.push({ url, error: (e as Error).message.slice(0, 200) });
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (!Object.keys(map).length) return result;
  // Re-read: the card may have been edited while we downloaded.
  const card = getCharacter(ctx, owner, id).card;
  const patch: Partial<CardData> = {};
  for (const f of TEXT_FIELDS) {
    const before = String(card[f] ?? '');
    const after = replaceMediaUrls(before, map);
    if (after !== before) (patch as any)[f] = after;
  }
  const greetings = (card.alternate_greetings ?? []).map((g) => replaceMediaUrls(g, map));
  if (greetings.some((g, i) => g !== card.alternate_greetings[i])) patch.alternate_greetings = greetings;
  if (Object.keys(patch).length) updateCharacter(ctx, owner, id, { card: patch }); // keeps a snapshot of the linked version
  return result;
}

// ------------------------------------------------------------------ integrity

export interface IntegrityReport {
  /** Rows whose file is gone (broken images). `source` means it can be downloaded again. */
  missingFiles: Array<{ id: string; kind: string; characterId: string | null; characterName: string | null; source: string | null }>;
  /** Files on disk that no row points to; nothing can show them. */
  orphanFiles: Array<{ filename: string; size: number }>;
  /** Media nothing refers to any more: its character is gone for good, or a local copy no card uses. */
  unusedRows: Array<{ id: string; kind: string; size: number; reason: string }>;
  /** Characters pointing at media that doesn't exist. */
  danglingRefs: Array<{ characterId: string; name: string; where: 'avatar' | 'gallery' | 'expression' | 'text'; mediaId: string }>;
  totals: { rows: number; files: number; bytes: number };
}

/** Every media id mentioned anywhere in the database outside the media table itself. */
function referencedIds(ctx: AppContext): Set<string> {
  const refs = new Set<string>();
  const tables = (ctx.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' AND name != 'media'").all() as Array<{ name: string }>).map((t) => t.name);
  for (const t of tables) {
    const cols = (ctx.db.prepare(`PRAGMA table_info("${t}")`).all() as Array<{ name: string; type: string }>).filter((c) => !c.type || /TEXT|BLOB|^$/i.test(c.type)).map((c) => c.name);
    if (!cols.length) continue;
    const where = cols.map((c) => `"${c}" LIKE '%m\\_%' ESCAPE '\\'`).join(' OR ');
    for (const row of ctx.db.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM "${t}" WHERE ${where}`).iterate() as Iterable<Record<string, unknown>>) {
      for (const v of Object.values(row)) if (typeof v === 'string') for (const m of v.matchAll(MEDIA_ID)) refs.add(m[0]);
    }
  }
  return refs;
}

export function mediaIntegrity(ctx: AppContext, owner: string): IntegrityReport {
  const dir = path.join(ctx.cfg.mediaDir, owner);
  const rows = ctx.db.prepare('SELECT * FROM media WHERE owner_id = ?').all(owner) as MediaRow[];
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith('.')) : [];
  const fileSet = new Set(files);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const chars = ctx.db.prepare('SELECT id, name, avatar, card, game FROM characters WHERE owner_id = ?').all(owner) as Array<{ id: string; name: string; avatar: string | null; card: string; game: string }>;
  const charName = new Map(chars.map((c) => [c.id, c.name]));
  const trashed = new Set<string>();
  for (const t of ctx.db.prepare('SELECT payload FROM character_trash WHERE owner_id = ?').all(owner) as Array<{ payload: string }>) for (const m of t.payload.matchAll(/"id":"([^"]+)"/g)) trashed.add(m[1]!);
  const refs = referencedIds(ctx);

  const report: IntegrityReport = { missingFiles: [], orphanFiles: [], unusedRows: [], danglingRefs: [], totals: { rows: rows.length, files: files.length, bytes: 0 } };
  for (const r of rows) {
    report.totals.bytes += r.size;
    if (!fileSet.has(r.filename)) {
      let source: string | null = null;
      try {
        source = JSON.parse(r.meta).source ?? null;
      } catch {
        /* bad meta */
      }
      report.missingFiles.push({ id: r.id, kind: r.kind, characterId: r.character_id, characterName: r.character_id ? (charName.get(r.character_id) ?? null) : null, source });
      continue;
    }
    if (r.character_id && !charName.has(r.character_id) && !trashed.has(r.character_id) && !refs.has(r.id)) report.unusedRows.push({ id: r.id, kind: r.kind, size: r.size, reason: 'its character was deleted' });
    else if (r.kind === 'localized' && !refs.has(r.id)) report.unusedRows.push({ id: r.id, kind: r.kind, size: r.size, reason: 'no card uses this copy any more' });
  }
  const known = new Set(rows.map((r) => r.filename));
  for (const f of files) {
    if (known.has(f)) continue;
    try {
      const st = statSync(path.join(dir, f));
      if (st.isFile()) report.orphanFiles.push({ filename: f, size: st.size });
    } catch {
      /* vanished */
    }
  }
  for (const c of chars) {
    if (c.avatar && /^m_/.test(c.avatar) && !byId.has(c.avatar)) report.danglingRefs.push({ characterId: c.id, name: c.name, where: 'avatar', mediaId: c.avatar });
    let game: { gallery?: string[]; expressions?: Record<string, string> } = {};
    try {
      game = JSON.parse(c.game || '{}');
    } catch {
      /* bad json */
    }
    for (const g of game.gallery ?? []) if (!byId.has(g)) report.danglingRefs.push({ characterId: c.id, name: c.name, where: 'gallery', mediaId: g });
    for (const e of Object.values(game.expressions ?? {})) if (typeof e === 'string' && /^m_/.test(e) && !byId.has(e)) report.danglingRefs.push({ characterId: c.id, name: c.name, where: 'expression', mediaId: e });
    for (const m of c.card.matchAll(/\/media\/(m_[A-Za-z0-9_-]{12})/g)) if (!byId.has(m[1]!)) report.danglingRefs.push({ characterId: c.id, name: c.name, where: 'text', mediaId: m[1]! });
  }
  return report;
}

export type FixAction = 'redownload' | 'forget-missing' | 'delete-orphan-files' | 'delete-unused' | 'clear-dangling';

/** Applies the chosen fixes to the current state (the report is recomputed, never trusted from the client). */
export async function fixMedia(ctx: AppContext, owner: string, actions: FixAction[]): Promise<Record<FixAction, number>> {
  const done: Record<FixAction, number> = { redownload: 0, 'forget-missing': 0, 'delete-orphan-files': 0, 'delete-unused': 0, 'clear-dangling': 0 };
  const dir = path.join(ctx.cfg.mediaDir, owner);
  let report = mediaIntegrity(ctx, owner);
  if (actions.includes('redownload')) {
    for (const m of report.missingFiles.filter((x) => x.source)) {
      try {
        const res = await fetchPublic(m.source!, { maxBytes: 15 * 1024 * 1024, allowPrivate: ctx.cfg.fetchPrivate });
        if (res.status !== 200) continue;
        const fresh = await saveMedia(ctx, owner, res.body, { kind: m.kind, characterId: m.characterId, maxDim: 2560, meta: { source: m.source } });
        // Keep the old id (every reference uses it): move the new file under the old row.
        ctx.db.transaction(() => {
          ctx.db.prepare('UPDATE media SET filename = ?, mime = ?, size = ?, width = ?, height = ? WHERE id = ? AND owner_id = ?').run(fresh.filename, fresh.mime, fresh.size, fresh.width, fresh.height, m.id, owner);
          ctx.db.prepare('DELETE FROM media WHERE id = ?').run(fresh.id);
        })();
        done.redownload++;
      } catch {
        /* still unreachable */
      }
    }
    report = mediaIntegrity(ctx, owner);
  }
  if (actions.includes('forget-missing')) {
    for (const m of report.missingFiles) {
      ctx.db.prepare('DELETE FROM media WHERE id = ? AND owner_id = ?').run(m.id, owner);
      done['forget-missing']++;
    }
    report = mediaIntegrity(ctx, owner);
  }
  if (actions.includes('delete-orphan-files')) {
    for (const f of report.orphanFiles) {
      const file = path.resolve(dir, f.filename);
      if (!file.startsWith(dir + path.sep)) continue;
      try {
        unlinkSync(file);
        done['delete-orphan-files']++;
      } catch {
        /* gone */
      }
    }
  }
  if (actions.includes('delete-unused')) {
    for (const u of report.unusedRows) {
      const row = ctx.db.prepare('SELECT filename FROM media WHERE id = ? AND owner_id = ?').get(u.id, owner) as { filename: string } | undefined;
      if (!row) continue;
      ctx.db.prepare('DELETE FROM media WHERE id = ? AND owner_id = ?').run(u.id, owner);
      try {
        unlinkSync(path.join(dir, row.filename));
      } catch {
        /* gone */
      }
      done['delete-unused']++;
    }
  }
  if (actions.includes('clear-dangling')) {
    for (const d of mediaIntegrity(ctx, owner).danglingRefs) {
      if (d.where === 'avatar') ctx.db.prepare('UPDATE characters SET avatar = NULL WHERE id = ? AND owner_id = ? AND avatar = ?').run(d.characterId, owner, d.mediaId);
      else if (d.where === 'gallery' || d.where === 'expression') {
        const r = ctx.db.prepare('SELECT game FROM characters WHERE id = ?').get(d.characterId) as { game: string };
        const game = JSON.parse(r.game || '{}');
        if (d.where === 'gallery') game.gallery = (game.gallery ?? []).filter((g: string) => g !== d.mediaId);
        else for (const [k, v] of Object.entries(game.expressions ?? {})) if (v === d.mediaId) delete game.expressions[k];
        ctx.db.prepare('UPDATE characters SET game = ? WHERE id = ?').run(JSON.stringify(game), d.characterId);
      } else continue; // a broken link inside card text is reported, not rewritten
      done['clear-dangling']++;
    }
  }
  return done;
}
