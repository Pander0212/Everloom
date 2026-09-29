/**
 * Import from a SillyTavern user data folder (…/SillyTavern/data/<user>/).
 * The source folder is only ever read. Paths are confined to the configured import roots.
 */
import { importSillyTavernPreset, parseChatJsonl, readCardFile, worldFromSillyTavern } from '@everloom/engine';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { HttpError, type AppContext } from '../context.js';
import { createCharacter } from './characters.js';
import { createChat, insertMessage, saveGroup, updateChat } from './chats.js';
import { createLorebook } from './lorebooks.js';
import { saveImage } from './media.js';
import { savePersona } from './personas.js';
import { savePreset } from './presets.js';

const MAX_FILE = 50 * 1024 * 1024;

export interface ScanResult {
  root: string;
  counts: Record<string, number>;
  samples: Record<string, string[]>;
}

/** Resolve and validate the folder: must exist, be a directory, and sit inside an allowed root. */
export function resolveStRoot(ctx: AppContext, input: string, extraRoots: string[] = []): string {
  if (!input || typeof input !== 'string') throw new HttpError(400, 'Enter a folder path');
  let p = path.resolve(input.trim());
  if (!existsSync(p)) throw new HttpError(404, 'Folder not found on the server');
  p = realpathSync(p);
  if (!statSync(p).isDirectory()) throw new HttpError(400, 'That path is not a folder');
  const roots = [...ctx.cfg.importRoots, ...extraRoots].map((r) => (existsSync(r) ? realpathSync(r) : path.resolve(r)));
  if (!roots.some((r) => p === r || p.startsWith(r.endsWith(path.sep) ? r : r + path.sep))) throw new HttpError(403, 'That folder is outside the allowed import locations');
  // Accept the SillyTavern root or data/ folder too: descend to default-user.
  for (const guess of ['data/default-user', 'default-user']) {
    const g = path.join(p, guess);
    if (!existsSync(path.join(p, 'characters')) && existsSync(path.join(g, 'characters'))) return g;
  }
  return p;
}

/** Safe listing: regular files only, no symlinks escaping the root. */
function files(root: string, sub: string, exts: string[]): string[] {
  const dir = path.join(root, sub);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((n) => exts.some((e) => n.toLowerCase().endsWith(e)))
    .map((n) => path.join(dir, n))
    .filter((f) => {
      try {
        const st = lstatSync(f);
        return st.isFile() && st.size <= MAX_FILE;
      } catch {
        return false;
      }
    });
}

function dirs(root: string, sub: string): string[] {
  const dir = path.join(root, sub);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((n) => path.join(dir, n))
    .filter((d) => {
      try {
        return lstatSync(d).isDirectory();
      } catch {
        return false;
      }
    });
}

function readSettings(root: string): any {
  try {
    return JSON.parse(readFileSync(path.join(root, 'settings.json'), 'utf8'));
  } catch {
    return {};
  }
}

export function scanSillyTavern(root: string): ScanResult {
  const chars = files(root, 'characters', ['.png', '.webp', '.json']);
  const chatFiles = dirs(root, 'chats').flatMap((d) => files(root, path.relative(root, d), ['.jsonl']));
  const settings = readSettings(root);
  const personas = Object.keys(settings?.power_user?.personas ?? {});
  const worlds = files(root, 'worlds', ['.json']);
  const bgs = files(root, 'backgrounds', ['.png', '.jpg', '.jpeg', '.webp', '.gif']);
  const presets = files(root, 'OpenAI Settings', ['.json']);
  const groups = files(root, 'groups', ['.json']);
  const base = (f: string) => path.basename(f).replace(/\.[^.]+$/, '');
  return {
    root,
    counts: { characters: chars.length, chats: chatFiles.length, groups: groups.length, personas: personas.length, worlds: worlds.length, backgrounds: bgs.length, presets: presets.length },
    samples: { characters: chars.slice(0, 5).map(base), worlds: worlds.slice(0, 5).map(base), personas: personas.slice(0, 5).map((p) => settings.power_user.personas[p]) },
  };
}

export interface ImportOptions {
  characters?: boolean;
  chats?: boolean;
  groups?: boolean;
  personas?: boolean;
  worlds?: boolean;
  backgrounds?: boolean;
  presets?: boolean;
}

export async function runSillyTavernImport(ctx: AppContext, owner: string, root: string, include: ImportOptions) {
  const imported: Record<string, number> = { characters: 0, chats: 0, groups: 0, personas: 0, worlds: 0, backgrounds: 0, presets: 0 };
  const errors: string[] = [];
  const byAvatar = new Map<string, string>(); // "Seraphina.png" → character id
  const byName = new Map<string, string>(); // chat folder name → character id

  if (include.characters !== false) {
    for (const f of files(root, 'characters', ['.png', '.webp', '.json'])) {
      try {
        const bytes = readFileSync(f);
        const card = readCardFile(new Uint8Array(bytes));
        let avatar: string | null = null;
        if (/\.(png|webp)$/i.test(f)) {
          try {
            avatar = (await saveImage(ctx, owner, bytes, { kind: 'avatar', maxDim: 1536 })).id;
          } catch {
            avatar = null;
          }
        }
        const ch = createCharacter(ctx, owner, card.data, { avatar, topExtras: card.topLevelExtras, game: (card.data.extensions?.everloom as object) ?? {} });
        byAvatar.set(path.basename(f), ch.id);
        byName.set(path.basename(f).replace(/\.[^.]+$/, ''), ch.id);
        imported.characters++;
      } catch (e) {
        errors.push(`${path.basename(f)}: ${(e as Error).message}`);
      }
    }
  }

  if (include.personas !== false) {
    const settings = readSettings(root);
    const personas: Record<string, string> = settings?.power_user?.personas ?? {};
    const descs: Record<string, any> = settings?.power_user?.persona_descriptions ?? {};
    for (const [file, name] of Object.entries(personas)) {
      try {
        let avatar: string | null = null;
        const img = path.join(root, 'User Avatars', path.basename(file));
        if (existsSync(img) && lstatSync(img).isFile()) {
          try {
            avatar = (await saveImage(ctx, owner, readFileSync(img), { kind: 'persona' })).id;
          } catch {
            avatar = null;
          }
        }
        savePersona(ctx, owner, { name: String(name).slice(0, 80) || 'Persona', description: String(descs[file]?.description ?? ''), title: String(descs[file]?.title ?? ''), isDefault: settings?.power_user?.default_persona === file, avatar });
        imported.personas++;
      } catch (e) {
        errors.push(`persona ${name}: ${(e as Error).message}`);
      }
    }
  }

  if (include.chats !== false) {
    for (const d of dirs(root, 'chats')) {
      const charId = byName.get(path.basename(d));
      if (!charId) continue;
      for (const f of files(root, path.relative(root, d), ['.jsonl'])) {
        try {
          importChatFile(ctx, owner, readFileSync(f, 'utf8'), { characterId: charId, title: path.basename(f, '.jsonl') });
          imported.chats++;
        } catch (e) {
          errors.push(`${path.basename(d)}/${path.basename(f)}: ${(e as Error).message}`);
        }
      }
    }
  }

  if (include.groups !== false) {
    for (const f of files(root, 'groups', ['.json'])) {
      try {
        const g = JSON.parse(readFileSync(f, 'utf8'));
        const members = (Array.isArray(g.members) ? g.members : []).map((m: string) => byAvatar.get(m)).filter(Boolean) as string[];
        if (members.length < 1) continue;
        const disabled = new Set(Array.isArray(g.disabled_members) ? g.disabled_members.map((m: string) => byAvatar.get(m)) : []);
        const group = saveGroup(ctx, owner, { name: String(g.name ?? 'Group').slice(0, 120), members: members.map((id) => ({ characterId: id, muted: disabled.has(id) })), strategy: g.activation_strategy === 1 ? 'list' : g.activation_strategy === 2 ? 'manual' : 'natural' });
        imported.groups++;
        for (const chatId of Array.isArray(g.chats) ? g.chats : []) {
          const file = path.join(root, 'group chats', `${path.basename(String(chatId))}.jsonl`);
          if (!existsSync(file) || !lstatSync(file).isFile()) continue;
          try {
            importChatFile(ctx, owner, readFileSync(file, 'utf8'), { groupId: group.id, title: String(chatId) });
            imported.chats++;
          } catch (e) {
            errors.push(`group chat ${chatId}: ${(e as Error).message}`);
          }
        }
      } catch (e) {
        errors.push(`${path.basename(f)}: ${(e as Error).message}`);
      }
    }
  }

  if (include.worlds !== false) {
    for (const f of files(root, 'worlds', ['.json'])) {
      try {
        const name = path.basename(f, '.json');
        createLorebook(ctx, owner, { name, scope: 'global', book: worldFromSillyTavern(JSON.parse(readFileSync(f, 'utf8')), name) });
        imported.worlds++;
      } catch (e) {
        errors.push(`${path.basename(f)}: ${(e as Error).message}`);
      }
    }
  }

  if (include.backgrounds !== false) {
    for (const f of files(root, 'backgrounds', ['.png', '.jpg', '.jpeg', '.webp', '.gif'])) {
      try {
        await saveImage(ctx, owner, readFileSync(f), { kind: 'background', maxDim: 2560, meta: { name: path.basename(f) } });
        imported.backgrounds++;
      } catch (e) {
        errors.push(`${path.basename(f)}: ${(e as Error).message}`);
      }
    }
  }

  if (include.presets !== false) {
    for (const f of files(root, 'OpenAI Settings', ['.json'])) {
      try {
        const name = path.basename(f, '.json');
        savePreset(ctx, owner, name, importSillyTavernPreset(JSON.parse(readFileSync(f, 'utf8')), name).preset);
        imported.presets++;
      } catch (e) {
        errors.push(`${path.basename(f)}: ${(e as Error).message}`);
      }
    }
  }
  return { imported, errors };
}

/** Import one JSONL chat for a character or a group, keeping swipes. */
export function importChatFile(ctx: AppContext, owner: string, text: string, target: { characterId?: string; groupId?: string; title?: string }) {
  const file = parseChatJsonl(text);
  const chat = createChat(ctx, owner, { characterId: target.characterId ?? null, groupId: target.groupId ?? null, greeting: false, title: target.title?.slice(0, 200) });
  const charIdsByName = new Map<string, string>();
  if (target.groupId) {
    const rows = ctx.db.prepare('SELECT id, name FROM characters WHERE owner_id = ?').all(owner) as Array<{ id: string; name: string }>;
    for (const r of rows) charIdsByName.set(r.name, r.id);
  }
  ctx.db.transaction(() => {
    for (const m of file.messages) {
      const t = Date.parse(m.createdAt);
      insertMessage(ctx, owner, chat.id, {
        role: m.role,
        name: m.name,
        characterId: m.role === 'assistant' ? target.characterId ?? charIdsByName.get(m.name) ?? null : null,
        swipes: m.swipes.map((s) => ({ text: s.text, reasoning: s.reasoning, createdAt: Date.parse(s.createdAt) || Date.now(), model: s.model })),
        swipeId: m.swipeId,
        hidden: m.hidden,
        createdAt: Number.isFinite(t) && t > 0 ? t : undefined,
      });
    }
  })();
  if (typeof file.metadata.note_prompt === 'string' && file.metadata.note_prompt) {
    updateChat(ctx, owner, chat.id, { metadata: { authorsNote: { content: file.metadata.note_prompt, depth: Number(file.metadata.note_depth ?? 4) || 4, role: 'system' } } });
  }
  return chat;
}
