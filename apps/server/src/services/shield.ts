/**
 * The name shield's link to the data: which terms apply to the current work (owner, chat, persona,
 * characters), and which names a chat already uses (a stand-in must not be one of them). A clash
 * gets a different stand-in for that chat, remembered in the chat and announced once.
 */
import { buildShield, defaultShieldSettings, type ShieldSettings, type ShieldTerm } from '@everloom/engine';
import type { AppContext } from '../context.js';
import { resolveTerms, setShieldResolver, type ResolvedShield, type ShieldStore } from '../privacy/shield.js';
import { getSettings } from './settings.js';

const namesCache = new Map<string, { at: number; names: string[] }>();

/** Names a chat already uses: its characters, the persona, and the game's people and places. */
function chatNames(ctx: AppContext, owner: string, chatId: string): string[] {
  const hit = namesCache.get(chatId);
  if (hit && Date.now() - hit.at < 15_000) return hit.names;
  const names: string[] = [];
  const chat = ctx.db.prepare('SELECT character_id, group_id, campaign_id FROM chats WHERE id = ? AND owner_id = ?').get(chatId, owner) as { character_id: string | null; group_id: string | null; campaign_id: string | null } | undefined;
  if (chat) {
    let ids: string[] = chat.character_id ? [chat.character_id] : [];
    if (chat.group_id) {
      const g = ctx.db.prepare('SELECT members FROM groups WHERE id = ?').get(chat.group_id) as { members: string } | undefined;
      try {
        ids = (JSON.parse(g?.members ?? '[]') as Array<{ characterId: string }>).map((m) => m.characterId);
      } catch {
        ids = [];
      }
    }
    for (const id of ids) {
      const r = ctx.db.prepare('SELECT name FROM characters WHERE id = ?').get(id) as { name: string } | undefined;
      if (r) names.push(r.name);
    }
    if (chat.campaign_id) {
      const row = ctx.db.prepare('SELECT state FROM campaigns WHERE id = ?').get(chat.campaign_id) as { state: string } | undefined;
      try {
        const st = row ? JSON.parse(row.state) : null;
        for (const n of Object.values(st?.npcs ?? {}) as Array<{ name?: string }>) if (n.name) names.push(n.name);
        for (const l of Object.values(st?.locations ?? {}) as Array<{ name?: string }>) if (l.name) names.push(l.name);
      } catch {
        /* no names from a broken state */
      }
    }
  }
  namesCache.set(chatId, { at: Date.now(), names });
  return names;
}

function chatSwaps(ctx: AppContext, chatId: string): Record<string, string> {
  const r = ctx.db.prepare('SELECT metadata FROM chats WHERE id = ?').get(chatId) as { metadata: string } | undefined;
  try {
    return (r ? JSON.parse(r.metadata)?.shieldSwaps : null) ?? {};
  } catch {
    return {};
  }
}

export function shieldFor(ctx: AppContext, store: ShieldStore | null): ResolvedShield | null {
  let settings: ShieldSettings;
  let owners: string[];
  if (store?.owner) {
    owners = [store.owner];
    settings = getSettings(ctx, store.owner).privacy?.shield ?? defaultShieldSettings();
  } else {
    // No idea whose work this is: every owner's terms (hide more, never less).
    owners = (ctx.db.prepare('SELECT id FROM users').all() as Array<{ id: string }>).map((r) => r.id);
    const all = owners.map((o) => getSettings(ctx, o).privacy?.shield ?? defaultShieldSettings()).filter((s) => s.enabled);
    settings = { ...defaultShieldSettings(), enabled: all.length > 0, terms: all.flatMap((s) => s.terms), onLeak: 'block' };
  }
  if (!settings.enabled || !settings.terms.length) return null;
  const chatId = store?.chatId ?? null;
  let terms: ShieldTerm[];
  if (chatId && store?.owner) {
    const swaps = chatSwaps(ctx, chatId);
    const r = resolveTerms(settings, store, chatNames(ctx, store.owner, chatId), swaps);
    terms = r.terms;
    if (Object.keys(r.newSwaps).length) {
      const row = ctx.db.prepare('SELECT metadata FROM chats WHERE id = ?').get(chatId) as { metadata: string } | undefined;
      const meta = row ? JSON.parse(row.metadata) : {};
      ctx.db.prepare('UPDATE chats SET metadata = ? WHERE id = ?').run(JSON.stringify({ ...meta, shieldSwaps: { ...swaps, ...r.newSwaps } }), chatId);
      const changed = settings.terms.filter((t) => r.newSwaps[t.id]).map((t) => t.real);
      ctx.bus.publish(store.owner, 'shield.notice', { chatId, message: `A stand-in clashed with a name in this chat, so ${changed.join(', ')} now ${changed.length === 1 ? 'has' : 'have'} a different stand-in here.` });
    }
  } else terms = resolveTerms(settings, store, [], {}).terms;
  return { shield: buildShield(terms), settings, terms };
}

export function installShield(ctx: AppContext) {
  setShieldResolver((store) => shieldFor(ctx, store));
}
