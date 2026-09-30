/**
 * Bundles: one zip with characters, their chats, gallery media and linked lorebooks.
 *
 * Layout (readable by hand, and by SillyTavern where the formats match):
 *   manifest.json                       what is inside (Everloom bundles only)
 *   characters/<slug>.png               a V2/V3 card with its embedded lorebook (SillyTavern-compatible)
 *   chats/<slug>/<n>.jsonl              SillyTavern JSONL chats
 *   gallery/<slug>/<file>               images, video, audio
 *   worlds/<name>.json                  linked lorebooks, SillyTavern world format
 *   everloom/<slug>.json                Everloom-only extras (nickname, favorite, collections, game data)
 *
 * Import accepts an Everloom bundle or a plain zip of SillyTavern files (cards, chats in a folder
 * named after the card, worlds). It is previewed first, with conflicts for the owner to resolve.
 */
import { cardHash, readCardFile, sniffImageType, worldFromSillyTavern, worldToSillyTavern, type CardData, type CharacterGame } from '@everloom/engine';
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { readFileSync } from 'node:fs';
import type { AppContext } from '../context.js';
import { HttpError } from '../context.js';
import { json } from '../db/index.js';
import { newId } from '../security/crypto.js';
import { createCharacter, exportCardPng, getCharacter, listCharacters, refreshMeta, updateCharacter } from './characters.js';
import { exportChat, importChat } from './chats.js';
import { editCollection, listCollections, saveCollection } from './charlib.js';
import { createLorebook, getCharacterBook, listLorebooks, updateLorebook } from './lorebooks.js';
import { getMedia, saveImage, saveMedia, sniffAvType } from './media.js';
import { snapshot } from './versions.js';

const slugify = (s: string) => s.normalize('NFKD').replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 48) || 'character';

export interface BundleOptions {
  chats?: boolean;
  gallery?: boolean;
  lorebooks?: boolean;
}

export async function exportBundle(ctx: AppContext, owner: string, ids: string[], opts: BundleOptions = {}): Promise<Buffer> {
  const want = { chats: true, gallery: true, lorebooks: true, ...opts };
  const files: Zippable = {};
  const manifest: { format: string; version: number; exportedAt: string; characters: unknown[] } = { format: 'everloom-bundle', version: 1, exportedAt: new Date().toISOString(), characters: [] };
  const collections = listCollections(ctx, owner);
  const books = listLorebooks(ctx, owner);
  const used = new Set<string>();
  for (const id of ids) {
    const c = getCharacter(ctx, owner, id);
    let slug = slugify(c.name);
    while (used.has(slug)) slug = `${slugify(c.name)}-${used.size}`;
    used.add(slug);
    const entry: Record<string, unknown> = { id: c.id, name: c.name, card: `characters/${slug}.png`, extras: `everloom/${slug}.json`, chats: [], gallery: [], worlds: [] };
    files[`characters/${slug}.png`] = [new Uint8Array(await exportCardPng(ctx, owner, id)), { level: 0 }];
    if (want.chats) {
      const chats = ctx.db.prepare('SELECT id FROM chats WHERE owner_id = ? AND character_id = ? ORDER BY created_at').all(owner, id) as Array<{ id: string }>;
      chats.forEach((ch, i) => {
        const path = `chats/${slug}/${String(i + 1).padStart(3, '0')}.jsonl`;
        files[path] = strToU8(exportChat(ctx, owner, ch.id).body);
        (entry.chats as string[]).push(path);
      });
    }
    if (want.gallery) {
      const ids = new Set<string>([...(c.game.gallery ?? []), ...(ctx.db.prepare("SELECT id FROM media WHERE owner_id = ? AND character_id = ? AND kind IN ('gallery', 'portrait')").all(owner, id) as Array<{ id: string }>).map((r) => r.id)]);
      for (const mid of ids) {
        try {
          const { row, file } = getMedia(ctx, owner, mid);
          const path = `gallery/${slug}/${row.filename}`;
          files[path] = [new Uint8Array(readFileSync(file)), { level: 0 }];
          (entry.gallery as string[]).push(path);
        } catch {
          /* missing file: skipped (the integrity check reports it) */
        }
      }
    }
    if (want.lorebooks) {
      const linked = typeof c.card.extensions?.world === 'string' ? books.find((b) => b.name === c.card.extensions!.world) : undefined;
      if (linked) {
        const path = `worlds/${slugify(linked.name)}.json`;
        files[path] = strToU8(JSON.stringify({ ...worldToSillyTavern(linked.book), name: linked.name }, null, 2));
        (entry.worlds as string[]).push(path);
      }
    }
    files[`everloom/${slug}.json`] = strToU8(JSON.stringify({ displayName: c.displayName, fav: c.fav, collections: collections.filter((col) => col.characterIds.includes(id)).map((col) => ({ name: col.name, icon: col.icon, color: col.color })), game: c.game }, null, 2));
    manifest.characters.push(entry);
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  return Buffer.from(zipSync(files, { level: 6 }));
}

// ------------------------------------------------------------------ import

interface PlannedCharacter {
  index: number;
  name: string;
  creator: string;
  card: CardData;
  cardBytes: Uint8Array;
  topExtras: Record<string, unknown>;
  extras: { displayName?: string | null; fav?: boolean; collections?: Array<{ name: string; icon?: string; color?: string }>; game?: CharacterGame } | null;
  chats: Uint8Array[];
  gallery: Array<{ name: string; bytes: Uint8Array }>;
  worlds: Array<{ name: string; raw: unknown }>;
}

export interface BundlePreviewItem {
  index: number;
  name: string;
  creator: string;
  chats: number;
  gallery: number;
  worlds: number;
  conflict: { id: string; name: string; reason: 'identical' | 'same name' } | null;
}

const pending = new Map<string, { owner: string; at: number; plan: PlannedCharacter[] }>();

function unzip(bytes: Buffer): Record<string, Uint8Array> {
  if (bytes.length > 512 * 1024 * 1024) throw new HttpError(413, 'Bundle too large');
  let files: Record<string, Uint8Array>;
  try {
    // Guard against zip bombs: refuse more than 2 GB unpacked or 20,000 files.
    let total = 0;
    let count = 0;
    files = unzipSync(new Uint8Array(bytes), {
      filter: (f) => {
        count++;
        total += f.originalSize;
        if (count > 20000 || total > 2 * 1024 * 1024 * 1024) throw new Error('Bundle unpacks to too much data');
        return !f.name.endsWith('/') && !f.name.startsWith('__MACOSX/');
      },
    });
  } catch (e) {
    throw new HttpError(400, `Not a readable zip: ${(e as Error).message}`);
  }
  return files;
}

const base = (p: string) => p.split('/').pop()!.replace(/\.[^.]+$/, '');
const dir = (p: string) => p.split('/').slice(0, -1).pop() ?? '';

function plan(files: Record<string, Uint8Array>): PlannedCharacter[] {
  const out: PlannedCharacter[] = [];
  const text = (b: Uint8Array) => new TextDecoder().decode(b);
  const manifest = files['manifest.json'] ? json<any>(text(files['manifest.json']), null) : null;
  if (manifest?.format === 'everloom-bundle') {
    for (const e of manifest.characters ?? []) {
      const bytes = files[e.card];
      if (!bytes) continue;
      let parsed;
      try {
        parsed = readCardFile(bytes);
      } catch {
        continue;
      }
      out.push({
        index: out.length,
        name: parsed.data.name,
        creator: parsed.data.creator ?? '',
        card: parsed.data,
        cardBytes: bytes,
        topExtras: parsed.topLevelExtras,
        extras: files[e.extras] ? json(text(files[e.extras]), null) : null,
        chats: (e.chats ?? []).map((p: string) => files[p]).filter(Boolean),
        gallery: (e.gallery ?? []).filter((p: string) => files[p]).map((p: string) => ({ name: p, bytes: files[p] })),
        worlds: (e.worlds ?? []).filter((p: string) => files[p]).map((p: string) => ({ name: base(p), raw: json(text(files[p]), null) })),
      });
    }
    return out;
  }
  // A plain zip of SillyTavern files.
  const worldFiles: Array<{ path: string; raw: any }> = [];
  for (const [path, bytes] of Object.entries(files)) {
    const lower = path.toLowerCase();
    if (!/\.(png|webp|json)$/.test(lower)) continue;
    try {
      const parsed = readCardFile(bytes);
      if (!parsed.data?.name) throw new Error('no name');
      const key = base(path).toLowerCase();
      const chats = Object.entries(files)
        .filter(([p]) => p.toLowerCase().endsWith('.jsonl') && (dir(p).toLowerCase() === key || dir(p).toLowerCase() === parsed.data.name.toLowerCase()))
        .map(([, b]) => b);
      const gallery = Object.entries(files)
        .filter(([p, b]) => p !== path && (dir(p).toLowerCase() === key || dir(p).toLowerCase() === parsed.data.name.toLowerCase()) && (sniffImageType(b.subarray(0, 16)) || sniffAvType(b.subarray(0, 16))))
        .map(([p, b]) => ({ name: p, bytes: b }));
      out.push({ index: out.length, name: parsed.data.name, creator: parsed.data.creator ?? '', card: parsed.data, cardBytes: bytes, topExtras: parsed.topLevelExtras, extras: null, chats, gallery, worlds: [] });
    } catch {
      if (lower.endsWith('.json')) {
        const raw = json<any>(text(bytes), null);
        if (raw && typeof raw === 'object' && raw.entries) worldFiles.push({ path, raw });
      }
    }
  }
  // Worlds go with the character that links them by name.
  for (const w of worldFiles) {
    const name = String(w.raw.name ?? base(w.path));
    const owner = out.find((c) => c.card.extensions?.world === name || c.card.extensions?.world === base(w.path));
    if (owner) owner.worlds.push({ name, raw: w.raw });
  }
  return out;
}

export function previewBundle(ctx: AppContext, owner: string, bytes: Buffer): { token: string; items: BundlePreviewItem[] } {
  const p = plan(unzip(bytes));
  if (!p.length) throw new HttpError(400, 'No characters found in that file');
  const lib = listCharacters(ctx, owner);
  for (const [k, v] of pending) if (Date.now() - v.at > 30 * 60_000) pending.delete(k);
  const token = newId('bn_');
  pending.set(token, { owner, at: Date.now(), plan: p });
  return {
    token,
    items: p.map((c) => {
      const same = lib.find((x) => x.name.toLowerCase() === c.name.toLowerCase());
      const identical = same && sameContent(ctx, same.id, c.card);
      return { index: c.index, name: c.name, creator: c.creator, chats: c.chats.length, gallery: c.gallery.length, worlds: c.worlds.length, conflict: same ? { id: same.id, name: same.name, reason: identical ? 'identical' : 'same name' } : null };
    }),
  };
}

function sameContent(ctx: AppContext, id: string, card: CardData): boolean {
  const r = ctx.db.prepare('SELECT content_hash FROM characters WHERE id = ?').get(id) as { content_hash: string } | undefined;
  return !!r && r.content_hash === cardHash(card);
}


export type BundleChoice = 'new' | 'replace' | 'skip';

export async function importBundle(ctx: AppContext, owner: string, token: string, choices: Record<number, BundleChoice>): Promise<{ created: string[]; replaced: string[]; skipped: number }> {
  const p = pending.get(token);
  if (!p || p.owner !== owner) throw new HttpError(410, 'That upload expired. Choose the file again.');
  const res = { created: [] as string[], replaced: [] as string[], skipped: 0 };
  const lib = listCharacters(ctx, owner);
  for (const c of p.plan) {
    const conflict = lib.find((x) => x.name.toLowerCase() === c.name.toLowerCase());
    const choice: BundleChoice = choices[c.index] ?? (conflict ? 'skip' : 'new');
    if (choice === 'skip') {
      res.skipped++;
      continue;
    }
    let avatar: string | null = null;
    if (sniffImageType(c.cardBytes.subarray(0, 16))) {
      try {
        avatar = (await saveImage(ctx, owner, Buffer.from(c.cardBytes), { kind: 'avatar', maxDim: 1536 })).id;
      } catch {
        avatar = null;
      }
    }
    const game: CharacterGame = { ...((c.card.extensions?.everloom as CharacterGame) ?? {}), ...(c.extras?.game ?? {}) };
    // Media ids from another instance mean nothing here: gallery and expressions are rebuilt.
    delete game.gallery;
    delete game.expressions;
    let id: string;
    if (choice === 'replace' && conflict) {
      id = conflict.id;
      snapshot(ctx, owner, id, 'update', 'Before bundle import');
      updateCharacter(ctx, owner, id, { card: c.card, game, avatar: avatar ?? undefined }, { snapshot: false });
      const book = getCharacterBook(ctx, owner, id);
      if (c.card.character_book?.entries && book) updateLorebook(ctx, owner, book.id, { book: worldFromSillyTavern(c.card.character_book, book.name) });
      res.replaced.push(id);
    } else {
      id = createCharacter(ctx, owner, c.card, { avatar, game, topExtras: c.topExtras }).id;
      res.created.push(id);
    }
    if (c.extras) {
      updateCharacter(ctx, owner, id, { displayName: c.extras.displayName ?? null, fav: c.extras.fav }, { snapshot: false });
      for (const col of c.extras.collections ?? []) {
        const existing = listCollections(ctx, owner).find((x) => x.name.toLowerCase() === col.name.toLowerCase()) ?? saveCollection(ctx, owner, { name: col.name, icon: col.icon, color: col.color });
        editCollection(ctx, owner, existing.id, { add: [id] });
      }
    }
    for (const chat of c.chats) {
      try {
        importChat(ctx, owner, id, new TextDecoder().decode(chat), { campaign: false });
      } catch {
        /* a broken chat file doesn't stop the rest */
      }
    }
    const galleryIds: string[] = [];
    for (const g of c.gallery) {
      try {
        galleryIds.push((await saveMedia(ctx, owner, Buffer.from(g.bytes), { kind: 'gallery', characterId: id })).id);
      } catch {
        /* unsupported file: skipped */
      }
    }
    for (const w of c.worlds) {
      if (!w.raw || listLorebooks(ctx, owner).some((b) => b.name === w.name)) continue;
      createLorebook(ctx, owner, { name: w.name, scope: 'global', book: worldFromSillyTavern(w.raw, w.name) });
    }
    refreshMeta(ctx, id);
  }
  pending.delete(token);
  return res;
}
