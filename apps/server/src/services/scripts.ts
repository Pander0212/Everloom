/**
 * Scripts on the server: the owner's own scripts, regex rules and quick replies; approvals (grants)
 * and trusted creators; which scripts apply to a chat; variables; each script's private store; and
 * the permission check behind the calls a script can make through the server (model calls, the
 * network, storage). Script code never runs here; it runs in a sandboxed frame in the browser.
 */
import {
  bundleHasCode,
  messageFingerprint,
  quickReplySetSchema,
  readBundle,
  regexFingerprint,
  regexScriptSchema,
  scriptFingerprint,
  scriptKey,
  scriptSchema,
  type QuickReplySet,
  type ReadBundle,
  type RegexScript,
  type Script,
  type ScriptPermission,
  type ScriptRef,
  type ScriptScope,
  type VarMap,
} from '@everloom/engine';
import { HttpError, type AppContext } from '../context.js';
import { json } from '../db/index.js';
import { newId } from '../security/crypto.js';
import { getCharacter, updateCharacter } from './characters.js';
import { getChat, getGroup } from './chats.js';
import { booksForChat, getLorebook } from './lorebooks.js';
import { getPreset, activePresetId } from './presets.js';
import { getSettings } from './settings.js';
import { extensionScripts, extensionRegex } from './extensions.js';

export type UserItemKind = 'script' | 'regex' | 'qr';

export interface UserItem<T> {
  id: string;
  kind: UserItemKind;
  scope: 'global' | 'chat';
  scopeId: string;
  data: T;
  position: number;
  updatedAt: number;
}

const toItem = (r: any): UserItem<any> => ({ id: r.id, kind: r.kind, scope: r.scope, scopeId: r.scope_id, data: json(r.data, {}), position: r.position, updatedAt: r.updated_at });

export function listUserItems<T = unknown>(ctx: AppContext, owner: string, kind: UserItemKind, scope?: { scope: 'global' | 'chat'; scopeId?: string }): UserItem<T>[] {
  const rows = scope
    ? ctx.db.prepare('SELECT * FROM user_scripts WHERE owner_id = ? AND kind = ? AND scope = ? AND scope_id = ? ORDER BY position, created_at').all(owner, kind, scope.scope, scope.scopeId ?? '')
    : ctx.db.prepare('SELECT * FROM user_scripts WHERE owner_id = ? AND kind = ? ORDER BY scope, position, created_at').all(owner, kind);
  return (rows as any[]).map(toItem);
}

function validItem(kind: UserItemKind, data: unknown): unknown {
  const schema = kind === 'script' ? scriptSchema : kind === 'regex' ? regexScriptSchema : quickReplySetSchema;
  const p = schema.safeParse(data);
  if (!p.success) throw new HttpError(400, p.error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; '), 'validation');
  return p.data;
}

/**
 * Save one of the owner's own items. Scripts written or edited here are approved as they are (the
 * owner wrote them); `imported` ones wait for review like scripts from cards.
 */
export function saveUserItem(ctx: AppContext, owner: string, kind: UserItemKind, data: unknown, opts: { id?: string; scope?: 'global' | 'chat'; scopeId?: string; imported?: boolean } = {}): UserItem<any> {
  const clean = validItem(kind, data) as Record<string, any>;
  const now = Date.now();
  let id = opts.id;
  if (id) {
    const r = ctx.db.prepare('SELECT id FROM user_scripts WHERE id = ? AND owner_id = ? AND kind = ?').get(id, owner, kind);
    if (!r) throw new HttpError(404, 'Not found');
    ctx.db.prepare('UPDATE user_scripts SET data = ?, updated_at = ? WHERE id = ? AND owner_id = ?').run(JSON.stringify(clean), now, id, owner);
  } else {
    id = newId(kind === 'script' ? 'us_' : kind === 'regex' ? 'rx_' : 'qr_');
    const pos = (ctx.db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM user_scripts WHERE owner_id = ? AND kind = ?').get(owner, kind) as { p: number }).p;
    ctx.db
      .prepare('INSERT INTO user_scripts (id, owner_id, kind, scope, scope_id, data, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, owner, kind, opts.scope ?? 'global', opts.scopeId ?? '', JSON.stringify(clean), pos, now, now);
  }
  if (kind === 'script' && !opts.imported) {
    const s = clean as Script;
    setGrant(ctx, owner, scriptKey({ scope: 'global', scopeId: '', scriptId: id }), scriptFingerprint(s), s.permissions);
  }
  if (kind === 'regex' && !opts.imported) setGrant(ctx, owner, `global::${id}`, regexFingerprint([clean as RegexScript]), []);
  return toItem(ctx.db.prepare('SELECT * FROM user_scripts WHERE id = ?').get(id));
}

export function deleteUserItem(ctx: AppContext, owner: string, kind: UserItemKind, id: string) {
  ctx.db.prepare('DELETE FROM user_scripts WHERE id = ? AND owner_id = ? AND kind = ?').run(id, owner, kind);
  ctx.db.prepare('DELETE FROM script_grants WHERE owner_id = ? AND key = ?').run(owner, kind === 'regex' ? `global::${id}` : scriptKey({ scope: 'global', scopeId: '', scriptId: id }));
  if (kind === 'script') ctx.db.prepare('DELETE FROM script_storage WHERE owner_id = ? AND script_key = ?').run(owner, scriptKey({ scope: 'global', scopeId: '', scriptId: id }));
}

export function reorderUserItems(ctx: AppContext, owner: string, kind: UserItemKind, ids: string[]) {
  const up = ctx.db.prepare('UPDATE user_scripts SET position = ? WHERE id = ? AND owner_id = ? AND kind = ?');
  ctx.db.transaction(() => ids.forEach((id, i) => up.run(i, id, owner, kind)))();
}

// ------------------------------------------------------------------ grants and trust

/** "Enable once": approvals kept in memory only, gone after a restart or signing out. */
const onceGrants = new Map<string, Map<string, { fingerprint: string; permissions: ScriptPermission[] }>>();
export const clearOnceGrants = (owner: string) => onceGrants.delete(owner);

export function getGrant(ctx: AppContext, owner: string, key: string): { fingerprint: string; permissions: ScriptPermission[]; once?: boolean } | null {
  const r = ctx.db.prepare('SELECT fingerprint, permissions FROM script_grants WHERE owner_id = ? AND key = ?').get(owner, key) as { fingerprint: string; permissions: string } | undefined;
  if (r) return { fingerprint: r.fingerprint, permissions: json(r.permissions, []) };
  const o = onceGrants.get(owner)?.get(key);
  return o ? { ...o, once: true } : null;
}
export function setGrant(ctx: AppContext, owner: string, key: string, fingerprint: string, permissions: readonly ScriptPermission[]) {
  ctx.db
    .prepare('INSERT INTO script_grants (owner_id, key, fingerprint, permissions, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_id, key) DO UPDATE SET fingerprint = excluded.fingerprint, permissions = excluded.permissions, created_at = excluded.created_at')
    .run(owner, key, fingerprint, JSON.stringify(permissions), Date.now());
}
export function revokeGrant(ctx: AppContext, owner: string, key: string) {
  ctx.db.prepare('DELETE FROM script_grants WHERE owner_id = ? AND key = ?').run(owner, key);
}
const granted = (ctx: AppContext, owner: string, key: string, fp: string) => getGrant(ctx, owner, key)?.fingerprint === fp;

export function listTrust(ctx: AppContext, owner: string): Array<{ kind: 'creator' | 'source'; value: string }> {
  return ctx.db.prepare('SELECT kind, value FROM script_trust WHERE owner_id = ? ORDER BY kind, value').all(owner) as any;
}
export function setTrust(ctx: AppContext, owner: string, kind: 'creator' | 'source', value: string, on: boolean) {
  const v = value.trim().toLowerCase();
  if (!v) throw new HttpError(400, 'Name the creator or source');
  if (on) ctx.db.prepare('INSERT OR IGNORE INTO script_trust (owner_id, kind, value, created_at) VALUES (?, ?, ?, ?)').run(owner, kind, v, Date.now());
  else ctx.db.prepare('DELETE FROM script_trust WHERE owner_id = ? AND kind = ? AND value = ?').run(owner, kind, v);
}

// ------------------------------------------------------------------ what's in an item

export type ReviewTarget = { kind: 'character' | 'preset' | 'lorebook'; id: string };

export interface ReviewItem {
  key: string;
  type: 'script' | 'regex' | 'messages';
  name: string;
  description: string;
  /** The code (scripts), the rules as text (regex), or the HTML found in messages. */
  code: string;
  permissions: ScriptPermission[];
  domains: string[];
  fingerprint: string;
  granted: boolean;
  /** Approved before, but the code or permissions changed since. */
  changed: boolean;
  /** Approved for this session only. */
  once?: boolean;
  compat?: boolean;
  triggers?: string[];
}

interface Loaded {
  name: string;
  creator: string;
  source: string;
  bundle: ReadBundle;
  messageText: string[];
}

function loadTarget(ctx: AppContext, owner: string, t: ReviewTarget): Loaded {
  if (t.kind === 'character') {
    const c = getCharacter(ctx, owner, t.id);
    const messageText = [c.card.first_mes, ...(c.card.alternate_greetings ?? [])].filter(Boolean);
    return { name: c.name, creator: String(c.card.creator ?? ''), source: String(c.linked ?? '').split(':')[0] ?? '', bundle: readBundle(c.card.extensions, { messageText }), messageText };
  }
  if (t.kind === 'preset') {
    const p = getPreset(ctx, owner, t.id);
    return { name: p.name, creator: '', source: '', bundle: readBundle(p.preset.extensions), messageText: [] };
  }
  const b = getLorebook(ctx, owner, t.id);
  return { name: b.name, creator: '', source: '', bundle: readBundle((b.book as any).extensions), messageText: [] };
}

const regexText = (rules: RegexScript[]) => rules.map((r) => `# ${r.scriptName}${r.disabled ? ' (off)' : ''}\nfind:    ${r.findRegex}\nreplace: ${r.replaceString}`).join('\n\n');

/** Everything in a character, preset or lorebook that needs the owner's approval, and its state. */
export function reviewItems(ctx: AppContext, owner: string, t: ReviewTarget): { name: string; creator: string; source: string; items: ReviewItem[]; trusted: boolean } {
  const l = loadTarget(ctx, owner, t);
  const items: ReviewItem[] = [];
  const add = (key: string, base: Omit<ReviewItem, 'key' | 'granted' | 'changed' | 'once'>) => {
    const g = getGrant(ctx, owner, key);
    items.push({ ...base, key, granted: g?.fingerprint === base.fingerprint, changed: !!g && g.fingerprint !== base.fingerprint, once: g?.once });
  };
  for (const s of l.bundle.scripts)
    add(scriptKey({ scope: t.kind, scopeId: t.id, scriptId: s.id }), { type: 'script', name: s.name, description: s.description, code: s.code, permissions: s.permissions, domains: s.domains, fingerprint: scriptFingerprint(s), compat: s.compat, triggers: s.triggers });
  if (l.bundle.regex.length) add(`${t.kind}:${t.id}:@regex`, { type: 'regex', name: `${l.bundle.regex.length} regex rule${l.bundle.regex.length === 1 ? '' : 's'}`, description: 'Find-and-replace rules for messages and the prompt.', code: regexText(l.bundle.regex), permissions: [], domains: [], fingerprint: regexFingerprint(l.bundle.regex) });
  if (t.kind === 'character') {
    const html = [...l.bundle.regex.map((r) => r.replaceString), ...l.messageText].filter((x) => /<script\b/i.test(x));
    if (html.length || l.bundle.messagePermissions.length)
      add(`character:${t.id}:@messages`, { type: 'messages', name: 'Scripts in messages', description: 'Interactive HTML in this character’s messages runs with these permissions.', code: html.join('\n\n').slice(0, 20_000), permissions: l.bundle.messagePermissions, domains: [], fingerprint: messageFingerprint(l.bundle.messagePermissions) });
  }
  const trust = listTrust(ctx, owner);
  const trusted = trust.some((x) => (x.kind === 'creator' && l.creator && x.value === l.creator.toLowerCase()) || (x.kind === 'source' && l.source && x.value === l.source.toLowerCase()));
  return { name: l.name, creator: l.creator, source: l.source, items, trusted };
}

/** Approve (or withdraw) the listed items, optionally trusting the creator from now on. */
export function approveItems(ctx: AppContext, owner: string, t: ReviewTarget, keys: string[], opts: { trustCreator?: boolean; revoke?: string[]; once?: boolean } = {}) {
  const r = reviewItems(ctx, owner, t);
  for (const it of r.items) {
    if (keys.includes(it.key)) {
      if (opts.once) {
        const m = onceGrants.get(owner) ?? new Map();
        m.set(it.key, { fingerprint: it.fingerprint, permissions: it.permissions });
        onceGrants.set(owner, m);
      } else setGrant(ctx, owner, it.key, it.fingerprint, it.permissions);
    }
    if (opts.revoke?.includes(it.key)) {
      revokeGrant(ctx, owner, it.key);
      onceGrants.get(owner)?.delete(it.key);
    }
  }
  if (opts.trustCreator && r.creator) setTrust(ctx, owner, 'creator', r.creator, true);
  return reviewItems(ctx, owner, t);
}

/** After an import: approved automatically only when the owner trusts its creator or source. */
export function afterImport(ctx: AppContext, owner: string, characterId: string): { hasScripts: boolean; approved: boolean } {
  const r = reviewItems(ctx, owner, { kind: 'character', id: characterId });
  if (!r.items.length) return { hasScripts: false, approved: false };
  if (r.trusted) for (const it of r.items) setGrant(ctx, owner, it.key, it.fingerprint, it.permissions);
  return { hasScripts: true, approved: r.trusted };
}

/** Save a character's scripts from the editor: the owner wrote or checked them, so they're approved. */
export function saveCharacterScripts(ctx: AppContext, owner: string, characterId: string, scripts: unknown[], messagePermissions?: ScriptPermission[]): ReviewItem[] {
  const c = getCharacter(ctx, owner, characterId);
  const clean = scripts.map((s) => validItem('script', s) as Script);
  const ids = new Set<string>();
  for (const s of clean) {
    if (ids.has(s.id)) throw new HttpError(400, `Two scripts share the id "${s.id}"`);
    ids.add(s.id);
  }
  const ext = { ...(c.card.extensions ?? {}) } as Record<string, any>;
  ext.everloom_scripts = { ...(ext.everloom_scripts ?? {}), scripts: clean, ...(messagePermissions ? { messagePermissions } : {}) };
  // Tavern Helper scripts are replaced by the converted ones once edited here.
  delete ext.TavernHelper_scripts;
  updateCharacter(ctx, owner, characterId, { card: { extensions: ext } });
  const r = reviewItems(ctx, owner, { kind: 'character', id: characterId });
  for (const it of r.items) if (it.type === 'script' || (it.type === 'messages' && messagePermissions)) setGrant(ctx, owner, it.key, it.fingerprint, it.permissions);
  return reviewItems(ctx, owner, { kind: 'character', id: characterId }).items;
}

// ------------------------------------------------------------------ what applies to a chat

export interface ActiveScript {
  key: string;
  ref: ScriptRef;
  script: Script;
  fingerprint: string;
  granted: boolean;
  /** Where it comes from, for the error console and the review sheet ("Keeper", "My scripts"). */
  origin: string;
}

export interface ActiveSet {
  settings: ReturnType<typeof getSettings>['scripts'];
  scripts: ActiveScript[];
  /** Approved rules only, in the order they apply: global, preset, then each character's. */
  regex: RegexScript[];
  quickReplies: Array<{ scope: 'global' | 'chat' | 'character'; set: QuickReplySet }>;
  /** Per character: whether scripts inside its messages may run, and with what. */
  messages: Record<string, { key: string; granted: boolean; permissions: ScriptPermission[] }>;
  /** Items with something waiting for review. */
  pending: Array<{ target: ReviewTarget; name: string }>;
}

/** The chat's characters (one, or a group's members). */
function chatCharacterIds(ctx: AppContext, owner: string, chatId: string): string[] {
  const chat = getChat(ctx, owner, chatId);
  if (chat.groupId) return getGroup(ctx, owner, chat.groupId).members.map((m) => m.characterId);
  return chat.characterId ? [chat.characterId] : [];
}

export function activeFor(ctx: AppContext, owner: string, chatId?: string | null): ActiveSet {
  const settings = getSettings(ctx, owner).scripts;
  const out: ActiveSet = { settings, scripts: [], regex: [], quickReplies: [], messages: {}, pending: [] };
  const pushScript = (ref: ScriptRef, s: Script, origin: string) => {
    const key = scriptKey(ref);
    const fp = scriptFingerprint(s);
    out.scripts.push({ key, ref, script: s, fingerprint: fp, granted: granted(ctx, owner, key, fp), origin });
  };
  for (const it of listUserItems<Script>(ctx, owner, 'script', { scope: 'global' })) pushScript({ scope: 'global', scopeId: '', scriptId: it.id }, { ...it.data, id: it.id }, 'My scripts');
  for (const it of listUserItems<RegexScript>(ctx, owner, 'regex', { scope: 'global' })) if (granted(ctx, owner, `global::${it.id}`, regexFingerprint([it.data]))) out.regex.push(it.data);
  for (const it of listUserItems<QuickReplySet>(ctx, owner, 'qr', { scope: 'global' })) out.quickReplies.push({ scope: 'global', set: it.data });
  for (const x of extensionScripts(ctx, owner)) out.scripts.push({ ...x, granted: granted(ctx, owner, x.key, x.fingerprint) });
  out.regex.push(...extensionRegex(ctx, owner));
  // The active preset.
  const presetId = activePresetId(ctx, owner, chatId ? getChat(ctx, owner, chatId).metadata.presetId : null);
  if (presetId) {
    try {
      const p = getPreset(ctx, owner, presetId);
      const b = readBundle(p.preset.extensions);
      for (const s of b.scripts) pushScript({ scope: 'preset', scopeId: p.id, scriptId: s.id }, s, `Preset “${p.name}”`);
      if (b.regex.length) {
        if (granted(ctx, owner, `preset:${p.id}:@regex`, regexFingerprint(b.regex))) out.regex.push(...b.regex);
        else out.pending.push({ target: { kind: 'preset', id: p.id }, name: p.name });
      }
      if (b.scripts.some((s) => !granted(ctx, owner, scriptKey({ scope: 'preset', scopeId: p.id, scriptId: s.id }), scriptFingerprint(s)))) out.pending.push({ target: { kind: 'preset', id: p.id }, name: p.name });
    } catch {
      /* preset gone */
    }
  }
  if (!chatId) return dedupePending(out);
  const charIds = chatCharacterIds(ctx, owner, chatId);
  for (const id of charIds) {
    let l: Loaded;
    try {
      l = loadTarget(ctx, owner, { kind: 'character', id });
    } catch {
      continue;
    }
    for (const s of l.bundle.scripts) pushScript({ scope: 'character', scopeId: id, scriptId: s.id }, s, l.name);
    if (l.bundle.regex.length && granted(ctx, owner, `character:${id}:@regex`, regexFingerprint(l.bundle.regex))) out.regex.push(...l.bundle.regex);
    for (const q of l.bundle.quickReplies) out.quickReplies.push({ scope: 'character', set: q });
    const mk = `character:${id}:@messages`;
    out.messages[id] = { key: mk, granted: granted(ctx, owner, mk, messageFingerprint(l.bundle.messagePermissions)), permissions: l.bundle.messagePermissions };
    const review = reviewItems(ctx, owner, { kind: 'character', id });
    if (review.items.some((i) => !i.granted && i.type !== 'messages') || (review.items.some((i) => i.type === 'messages' && !i.granted) && bundleHasCode(l.bundle, l.messageText))) out.pending.push({ target: { kind: 'character', id }, name: l.name });
  }
  for (const b of booksForChat(ctx, owner, chatId, charIds)) {
    const bundle = readBundle((b.book as any).extensions);
    for (const s of bundle.scripts) pushScript({ scope: 'lorebook', scopeId: b.id, scriptId: s.id }, s, `Lorebook “${b.name}”`);
    if (bundle.scripts.some((s) => !granted(ctx, owner, scriptKey({ scope: 'lorebook', scopeId: b.id, scriptId: s.id }), scriptFingerprint(s)))) out.pending.push({ target: { kind: 'lorebook', id: b.id }, name: b.name });
  }
  for (const it of listUserItems<QuickReplySet>(ctx, owner, 'qr', { scope: 'chat', scopeId: chatId })) out.quickReplies.push({ scope: 'chat', set: it.data });
  return dedupePending(out);
}

function dedupePending(a: ActiveSet): ActiveSet {
  const seen = new Set<string>();
  a.pending = a.pending.filter((p) => {
    const k = `${p.target.kind}:${p.target.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  a.quickReplies = a.quickReplies.filter((q) => q.set.enabled !== false);
  return a;
}

/** Approved regex rules for the server's own pipeline (stored text and the prompt). */
export function regexForChat(ctx: AppContext, owner: string, chatId: string): RegexScript[] {
  if (!getSettings(ctx, owner).scripts.enabled) return [];
  try {
    return activeFor(ctx, owner, chatId).regex;
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------ the server-side check

/** Find a script by its key and confirm it's approved as it is now and has the permission. */
export function requireScript(ctx: AppContext, owner: string, key: string, perm: ScriptPermission): { name: string; domains: string[]; permissions: ScriptPermission[] } {
  if (!getSettings(ctx, owner).scripts.enabled) throw new HttpError(403, 'Scripts are turned off', 'scripts_off');
  const [scope, scopeId = '', scriptId = ''] = key.split(':') as [ScriptScope, string, string];
  let found: { name: string; fingerprint: string; permissions: ScriptPermission[]; domains: string[] } | null = null;
  if (scope === 'character' && scriptId === '@messages') {
    const l = loadTarget(ctx, owner, { kind: 'character', id: scopeId });
    found = { name: `${l.name} (messages)`, fingerprint: messageFingerprint(l.bundle.messagePermissions), permissions: l.bundle.messagePermissions, domains: [] };
  } else if (scope === 'global') {
    const r = ctx.db.prepare("SELECT * FROM user_scripts WHERE id = ? AND owner_id = ? AND kind = 'script'").get(scriptId, owner);
    if (r) {
      const s = toItem(r).data as Script;
      found = { name: s.name, fingerprint: scriptFingerprint(s), permissions: s.permissions, domains: s.domains };
    }
  } else if (scope === 'character' || scope === 'preset' || scope === 'lorebook') {
    const s = loadTarget(ctx, owner, { kind: scope, id: scopeId }).bundle.scripts.find((x) => x.id === scriptId);
    if (s) found = { name: s.name, fingerprint: scriptFingerprint(s), permissions: s.permissions, domains: s.domains };
  } else if (scope === 'extension') {
    const x = extensionScripts(ctx, owner).find((e) => e.key === key);
    if (x) found = { name: x.script.name, fingerprint: x.fingerprint, permissions: x.script.permissions, domains: x.script.domains };
  }
  if (!found) throw new HttpError(404, 'Script not found', 'script_unknown');
  const g = getGrant(ctx, owner, key);
  if (!g || g.fingerprint !== found.fingerprint) throw new HttpError(403, `${found.name} isn't approved`, 'script_unapproved');
  if (!found.permissions.includes(perm) || !g.permissions.includes(perm)) throw new HttpError(403, `${found.name} doesn't have the “${perm}” permission`, 'script_permission');
  return { name: found.name, domains: found.domains, permissions: found.permissions };
}

// ------------------------------------------------------------------ variables

export function getVars(ctx: AppContext, owner: string, scope: 'global' | 'character', scopeId = ''): VarMap {
  const r = ctx.db.prepare('SELECT data FROM variables WHERE owner_id = ? AND scope = ? AND scope_id = ?').get(owner, scope, scopeId) as { data: string } | undefined;
  return json(r?.data, {});
}

const VAR_LIMIT = 256 * 1024;
export function setVars(ctx: AppContext, owner: string, scope: 'global' | 'character', scopeId: string, patch: VarMap, replace = false): VarMap {
  const cur = replace ? {} : getVars(ctx, owner, scope, scopeId);
  for (const [k, v] of Object.entries(patch)) if (v === null) delete cur[k];
    else cur[k] = v;
  const text = JSON.stringify(cur);
  if (text.length > VAR_LIMIT) throw new HttpError(413, 'Too much variable data (256 KB at most per scope)');
  ctx.db
    .prepare('INSERT INTO variables (owner_id, scope, scope_id, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_id, scope, scope_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .run(owner, scope, scopeId, text, Date.now());
  return cur;
}

// ------------------------------------------------------------------ per-script storage

const STORE_VALUE = 64 * 1024;
const STORE_TOTAL = 1024 * 1024;

export function storageGet(ctx: AppContext, owner: string, key: string, k?: string): unknown {
  if (k !== undefined) {
    const r = ctx.db.prepare('SELECT v FROM script_storage WHERE owner_id = ? AND script_key = ? AND k = ?').get(owner, key, k) as { v: string } | undefined;
    return r ? json(r.v, null) : null;
  }
  return Object.fromEntries((ctx.db.prepare('SELECT k, v FROM script_storage WHERE owner_id = ? AND script_key = ? ORDER BY k').all(owner, key) as Array<{ k: string; v: string }>).map((r) => [r.k, json(r.v, null)]));
}

export function storageSet(ctx: AppContext, owner: string, key: string, k: string, value: unknown) {
  if (!k || k.length > 200) throw new HttpError(400, 'Keys are 1–200 characters');
  if (value === null || value === undefined) {
    ctx.db.prepare('DELETE FROM script_storage WHERE owner_id = ? AND script_key = ? AND k = ?').run(owner, key, k);
    return;
  }
  const text = JSON.stringify(value);
  if (text.length > STORE_VALUE) throw new HttpError(413, 'A stored value can be 64 KB at most');
  const used = (ctx.db.prepare('SELECT COALESCE(SUM(LENGTH(v)), 0) AS n FROM script_storage WHERE owner_id = ? AND script_key = ? AND k != ?').get(owner, key, k) as { n: number }).n;
  if (used + text.length > STORE_TOTAL) throw new HttpError(413, 'This script’s storage is full (1 MB)');
  ctx.db
    .prepare('INSERT INTO script_storage (owner_id, script_key, k, v, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_id, script_key, k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at')
    .run(owner, key, k, text, Date.now());
}

export function storageClear(ctx: AppContext, owner: string, keyPrefix: string) {
  ctx.db.prepare('DELETE FROM script_storage WHERE owner_id = ? AND (script_key = ? OR script_key LIKE ?)').run(owner, keyPrefix, `${keyPrefix}:%`);
}
