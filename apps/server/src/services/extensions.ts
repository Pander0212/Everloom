/**
 * Extensions: installable add-ons described by `everloom-extension.json`.
 *
 * Client extensions (the default) are files the app runs in sandboxed frames with the same
 * permission bridge as scripts: a background frame (event hooks, slash commands, composer buttons,
 * macro values), panels and full screens, a settings page, and message renderers. They can also
 * declare prompt blocks, regex rules and custom game ops (declarative, so they roll back).
 *
 * Server extensions are optional Node modules for power users. They're off unless the server is
 * started with EVERLOOM_SERVER_EXTENSIONS=1, only the server's first account can install them, and
 * each runs in its own child process (see extension-host.ts) so a crash can't take the app down.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import {
  extOpDefSchema,
  importRegexScripts,
  registerExtOps,
  scriptFingerprint,
  SCRIPT_PERMISSIONS,
  unregisterExtOps,
  type RegexScript,
  type Script,
  type ScriptPermission,
  type ScriptRef,
} from '@everloom/engine';
import { unzipSync } from 'fflate';
import { z } from 'zod';
import { HttpError, type AppContext } from '../context.js';
import { json } from '../db/index.js';
import { safeFetch } from '../util/fetch.js';
import { readContentFile, writeContentFile } from '../vault/vault.js';
import { serverState, startServerPart, stopServerPart } from './extension-host.js';
import { getSettings } from './settings.js';

export const APP_VERSION = '0.1.0';

const relFile = z
  .string()
  .max(200)
  .regex(/^(?!\/)(?!.*\.\.)[\w./-]+$/, 'A relative file path inside the extension');
const iconName = z.string().max(40).optional();

export const manifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/, 'Lowercase letters, digits, dots, - and _'),
  name: z.string().min(1).max(80),
  version: z.string().regex(/^\d+\.\d+\.\d+([-+][\w.]+)?$/, 'A version like 1.2.0'),
  author: z.string().max(80).default(''),
  homepage: z.string().url().max(300).optional(),
  description: z.string().max(500).default(''),
  minEverloom: z.string().regex(/^\d+\.\d+\.\d+$/).default('0.1.0'),
  changelog: z.string().max(5000).optional(),
  permissions: z.array(z.enum(SCRIPT_PERMISSIONS)).default([]),
  domains: z.array(z.string().max(120)).max(20).default([]),
  entries: z
    .object({
      background: relFile.optional(),
      panels: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/), title: z.string().min(1).max(60), file: relFile, icon: iconName, tile: z.boolean().default(true) })).max(10).default([]),
      screens: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/), title: z.string().min(1).max(60), file: relFile, icon: iconName })).max(10).default([]),
      settings: relFile.optional(),
      composerButtons: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/), label: z.string().min(1).max(40), icon: iconName })).max(6).default([]),
      slashCommands: z.array(z.object({ name: z.string().regex(/^[a-z][a-z0-9-]{0,30}$/), help: z.string().max(200).default(''), usage: z.string().max(200).optional() })).max(20).default([]),
      promptBlocks: z
        .array(z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/), text: z.string().max(4000), position: z.enum(['before', 'after', 'depth']).default('after'), depth: z.number().int().min(0).max(100).default(4), role: z.enum(['system', 'user', 'assistant']).default('system') }))
        .max(10)
        .default([]),
      messageRenderers: z.array(z.object({ tag: z.string().regex(/^[a-z][a-z0-9-]{0,30}$/), file: relFile })).max(10).default([]),
      macros: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,30}$/)).max(20).default([]),
      ops: z.array(z.unknown()).max(30).default([]),
      regex: z.array(z.unknown()).max(50).default([]),
    })
    .default({ panels: [], screens: [], composerButtons: [], slashCommands: [], promptBlocks: [], messageRenderers: [], macros: [], ops: [], regex: [] }),
  server: z.object({ main: relFile }).optional(),
});
export type ExtensionManifest = z.infer<typeof manifestSchema>;

export interface ExtensionDTO {
  id: string;
  manifest: ExtensionManifest;
  enabled: boolean;
  source: string;
  /** A dev folder: read live from disk and reloaded on change. */
  dev: boolean;
  approved: boolean;
  /** Approved before, but files or permissions changed (an update): needs another look. */
  changed: boolean;
  errors: Array<{ at: number; where: string; message: string }>;
  installedAt: number;
  updatedAt: number;
  /** Server part: off, running, crashed… */
  server: { state: 'none' | 'off' | 'running' | 'stopped' | 'crashed' | 'not-allowed'; detail?: string } | null;
}

const MAX_ZIP = 5 * 1024 * 1024;
const MAX_FILES = 300;
const MAX_TOTAL = 20 * 1024 * 1024;

export const extKey = (id: string) => `extension:${id}:main`;
const extDir = (ctx: AppContext, owner: string, id: string) => path.join(ctx.cfg.dataDir, 'extensions', owner, id);

function cmpVersion(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => Number(x) || 0);
  const pb = b.split(/[.+-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** The first account on the server: the only one allowed to install server extensions. */
export function isServerOwner(ctx: AppContext, owner: string): boolean {
  const r = ctx.sys.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get() as { id: string } | undefined;
  return r?.id === owner;
}
export const serverExtensionsAllowed = () => process.env.EVERLOOM_SERVER_EXTENSIONS === '1';

// ------------------------------------------------------------------ reading packages

interface Package {
  manifest: ExtensionManifest;
  files: Map<string, Buffer>;
}

function parseManifest(buf: Buffer | undefined): ExtensionManifest {
  if (!buf) throw new HttpError(400, 'No everloom-extension.json in the package');
  let raw: unknown;
  try {
    raw = JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'everloom-extension.json is not valid JSON');
  }
  const p = manifestSchema.safeParse(raw);
  if (!p.success) throw new HttpError(400, `everloom-extension.json: ${p.error.issues.map((i) => `${i.path.join('.') || 'file'}: ${i.message}`).join('; ')}`, 'validation');
  const m = p.data;
  if (cmpVersion(m.minEverloom, APP_VERSION) > 0) throw new HttpError(400, `${m.name} needs Everloom ${m.minEverloom} or newer`);
  for (const op of m.entries.ops) {
    const o = extOpDefSchema.safeParse(op);
    if (!o.success) throw new HttpError(400, `Game op in the manifest: ${o.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return m;
}

function checkPackage(manifest: ExtensionManifest, files: Map<string, Buffer>) {
  const need = [manifest.entries.background, manifest.entries.settings, ...manifest.entries.panels.map((p) => p.file), ...manifest.entries.screens.map((s) => s.file), ...manifest.entries.messageRenderers.map((r) => r.file), manifest.server?.main].filter(Boolean) as string[];
  for (const f of need) if (!files.has(f)) throw new HttpError(400, `The manifest names ${f}, which isn't in the package`);
}

/** Read a zip: the manifest at the top or inside one top-level folder (as GitHub zips are). */
export function readZip(bytes: Buffer): Package {
  if (bytes.length > MAX_ZIP) throw new HttpError(413, 'Extension packages can be 5 MB at most');
  let raw: Record<string, Uint8Array>;
  try {
    let count = 0;
    let total = 0;
    raw = unzipSync(new Uint8Array(bytes), {
      filter: (f) => {
        if (f.name.endsWith('/') || f.name.includes('__MACOSX/')) return false;
        if (++count > MAX_FILES) throw new Error('too many files');
        total += f.originalSize;
        if (total > MAX_TOTAL) throw new Error('unpacks to more than 20 MB');
        return true;
      },
    });
  } catch (e) {
    throw new HttpError(400, `Not a readable zip: ${(e as Error).message}`);
  }
  const names = Object.keys(raw);
  const manifestPath = names.filter((n) => /(^|\/)everloom-extension\.json$/.test(n)).sort((a, b) => a.split('/').length - b.split('/').length)[0];
  if (!manifestPath) throw new HttpError(400, 'No everloom-extension.json in the package');
  const prefix = manifestPath.slice(0, -'everloom-extension.json'.length);
  const files = new Map<string, Buffer>();
  for (const n of names) {
    if (!n.startsWith(prefix)) continue;
    const rel = n.slice(prefix.length);
    if (!rel || rel.includes('..') || rel.startsWith('/') || rel.split('/').some((p) => p.startsWith('.') && p !== '.')) continue;
    files.set(rel, Buffer.from(raw[n]!));
  }
  const manifest = parseManifest(files.get('everloom-extension.json'));
  checkPackage(manifest, files);
  return { manifest, files };
}

function readFolder(dir: string): Package {
  const files = new Map<string, Buffer>();
  let total = 0;
  const walk = (d: string, rel: string) => {
    for (const n of readdirSync(d)) {
      if (n.startsWith('.') || n === 'node_modules') continue;
      const f = path.join(d, n);
      const st = statSync(f);
      if (st.isDirectory()) walk(f, `${rel}${n}/`);
      else if (st.isFile()) {
        total += st.size;
        if (files.size >= MAX_FILES || total > MAX_TOTAL) throw new HttpError(413, 'The folder is too big for an extension');
        files.set(`${rel}${n}`, readFileSync(f));
      }
    }
  };
  walk(dir, '');
  const manifest = parseManifest(files.get('everloom-extension.json'));
  checkPackage(manifest, files);
  return { manifest, files };
}

/** github.com/owner/repo[/tree/ref] (or any URL to a .zip) → the package. */
export async function fetchFromGit(url: string): Promise<Package> {
  let zipUrl = url.trim();
  const gh = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([\w./-]+))?\/?$/.exec(zipUrl);
  if (gh) zipUrl = `https://codeload.github.com/${gh[1]}/${gh[2]}/zip/${gh[3] ? `refs/heads/${gh[3]}` : 'HEAD'}`;
  const gl = /^https:\/\/(gitlab\.com|codeberg\.org)\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (gl) zipUrl = gl[1] === 'gitlab.com' ? `https://gitlab.com/${gl[2]}/${gl[3]}/-/archive/HEAD/${gl[3]}-HEAD.zip` : `https://codeberg.org/${gl[2]}/${gl[3]}/archive/HEAD.zip`;
  if (!gh && !gl && !/\.zip(\?|$)/i.test(zipUrl)) throw new HttpError(400, 'Use a GitHub, GitLab or Codeberg repository address, or a link to a .zip');
  const res = await safeFetch(zipUrl, { shield: false, timeoutMs: 60_000 });
  if (!res.ok) throw new HttpError(502, `Couldn't download it (${res.status})`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_ZIP) throw new HttpError(413, 'Extension packages can be 5 MB at most');
  const buf = Buffer.from(await res.arrayBuffer());
  return readZip(buf);
}

// ------------------------------------------------------------------ storage

/** Hash of every file: a changed file means the code changed and asks for approval again. */
function contentHash(files: Map<string, Buffer>): string {
  const h = createHash('sha256');
  for (const k of [...files.keys()].sort()) h.update(k).update('\0').update(files.get(k)!).update('\0');
  return h.digest('hex');
}

const fingerprintOf = (m: ExtensionManifest, hash: string) => scriptFingerprint({ code: `${m.id}@${hash}`, permissions: m.permissions, domains: m.domains });

interface Row {
  id: string;
  owner_id: string;
  manifest: string;
  enabled: number;
  source: string;
  errors: string;
  installed_at: number;
  updated_at: number;
}

function rowOf(ctx: AppContext, owner: string, id: string): Row {
  const r = ctx.db.prepare('SELECT * FROM extensions WHERE owner_id = ? AND id = ?').get(owner, id) as Row | undefined;
  if (!r) throw new HttpError(404, 'Extension not found');
  return r;
}

const devFolder = (r: Row) => (r.source.startsWith('dev:') ? r.source.slice(4) : null);

/** The extension's files: its stored copy, or the live dev folder. */
function filesOf(ctx: AppContext, r: Row): Map<string, Buffer> {
  const dev = devFolder(r);
  if (dev) return existsSync(dev) ? readFolder(dev).files : new Map();
  const dir = extDir(ctx, r.owner_id, r.id);
  const files = new Map<string, Buffer>();
  if (!existsSync(dir)) return files;
  const walk = (d: string, rel: string) => {
    for (const n of readdirSync(d)) {
      const f = path.join(d, n);
      if (statSync(f).isDirectory()) walk(f, `${rel}${n}/`);
      else files.set(`${rel}${n}`, readContentFile(ctx.vault, f));
    }
  };
  walk(dir, '');
  return files;
}

const hashCache = new Map<string, { at: number; hash: string }>();
function hashOf(ctx: AppContext, r: Row): string {
  const k = `${r.owner_id}:${r.id}`;
  const c = hashCache.get(k);
  if (c && c.at === r.updated_at) return c.hash;
  const hash = contentHash(filesOf(ctx, r));
  hashCache.set(k, { at: r.updated_at, hash });
  return hash;
}

function grantState(ctx: AppContext, r: Row, m: ExtensionManifest) {
  const g = ctx.db.prepare('SELECT fingerprint FROM script_grants WHERE owner_id = ? AND key = ?').get(r.owner_id, extKey(r.id)) as { fingerprint: string } | undefined;
  const fp = fingerprintOf(m, hashOf(ctx, r));
  return { fp, approved: g?.fingerprint === fp, changed: !!g && g.fingerprint !== fp };
}

function toDTO(ctx: AppContext, r: Row): ExtensionDTO {
  const manifest = json<ExtensionManifest>(r.manifest, null as never);
  const g = grantState(ctx, r, manifest);
  return {
    id: r.id,
    manifest,
    enabled: !!r.enabled,
    source: devFolder(r) ? `Folder: ${devFolder(r)}` : r.source,
    dev: !!devFolder(r),
    approved: g.approved,
    changed: g.changed,
    errors: json(r.errors, []),
    installedAt: r.installed_at,
    updatedAt: r.updated_at,
    server: manifest.server ? serverState(r.owner_id, r.id, !!r.enabled) : null,
  };
}

export function listExtensions(ctx: AppContext, owner: string): ExtensionDTO[] {
  return (ctx.db.prepare('SELECT * FROM extensions WHERE owner_id = ? ORDER BY id').all(owner) as Row[]).map((r) => toDTO(ctx, r));
}
export const getExtension = (ctx: AppContext, owner: string, id: string) => toDTO(ctx, rowOf(ctx, owner, id));

/** What the install (or update) dialog shows before anything is saved. */
export function describePackage(ctx: AppContext, owner: string, pkg: Package) {
  const existing = ctx.db.prepare('SELECT * FROM extensions WHERE owner_id = ? AND id = ?').get(owner, pkg.manifest.id) as Row | undefined;
  const old = existing ? json<ExtensionManifest>(existing.manifest, null as never) : null;
  const added = pkg.manifest.permissions.filter((p) => !old?.permissions.includes(p));
  const removed = (old?.permissions ?? []).filter((p) => !pkg.manifest.permissions.includes(p));
  return {
    manifest: pkg.manifest,
    update: old ? { from: old.version, to: pkg.manifest.version, addedPermissions: added, removedPermissions: removed, addedDomains: pkg.manifest.domains.filter((d) => !old.domains.includes(d)) } : null,
    files: [...pkg.files.keys()].sort(),
    server: pkg.manifest.server ? { allowed: serverExtensionsAllowed() && isServerOwner(ctx, owner), main: pkg.manifest.server.main, code: pkg.files.get(pkg.manifest.server.main)?.toString('utf8').slice(0, 60_000) ?? '' } : null,
  };
}

/** Install or update from a package; approves it as shown (the owner saw the permissions). */
export function installPackage(ctx: AppContext, owner: string, pkg: Package, source: string, opts: { approve: boolean; dev?: string }): ExtensionDTO {
  const m = pkg.manifest;
  if (m.server && !(serverExtensionsAllowed() && isServerOwner(ctx, owner))) {
    if (!serverExtensionsAllowed()) throw new HttpError(403, 'This extension has a server part. Server extensions are off on this server (start it with EVERLOOM_SERVER_EXTENSIONS=1 to allow them).', 'server_ext_off');
    throw new HttpError(403, 'Only the server’s owner account can install extensions with a server part.', 'server_ext_owner');
  }
  const now = Date.now();
  if (!opts.dev) {
    const dir = extDir(ctx, owner, m.id);
    rmSync(dir, { recursive: true, force: true });
    for (const [rel, buf] of pkg.files) {
      const f = path.join(dir, rel);
      if (!f.startsWith(dir + path.sep)) continue;
      mkdirSync(path.dirname(f), { recursive: true });
      writeContentFile(ctx.vault, f, buf);
    }
  }
  const src = opts.dev ? `dev:${opts.dev}` : source;
  ctx.db
    .prepare('INSERT INTO extensions (id, owner_id, manifest, enabled, source, errors, installed_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?) ON CONFLICT(owner_id, id) DO UPDATE SET manifest = excluded.manifest, source = excluded.source, updated_at = excluded.updated_at')
    .run(m.id, owner, JSON.stringify(m), src, '[]', now, now);
  hashCache.delete(`${owner}:${m.id}`);
  const r = rowOf(ctx, owner, m.id);
  if (opts.approve) approveExtension(ctx, owner, m.id);
  loadExtension(ctx, r);
  return toDTO(ctx, rowOf(ctx, owner, m.id));
}

export function approveExtension(ctx: AppContext, owner: string, id: string) {
  const r = rowOf(ctx, owner, id);
  const m = json<ExtensionManifest>(r.manifest, null as never);
  const { fp } = grantState(ctx, r, m);
  ctx.db
    .prepare('INSERT INTO script_grants (owner_id, key, fingerprint, permissions, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_id, key) DO UPDATE SET fingerprint = excluded.fingerprint, permissions = excluded.permissions, created_at = excluded.created_at')
    .run(owner, extKey(id), fp, JSON.stringify(m.permissions), Date.now());
  loadExtension(ctx, rowOf(ctx, owner, id));
}

export function setExtensionEnabled(ctx: AppContext, owner: string, id: string, on: boolean) {
  rowOf(ctx, owner, id);
  ctx.db.prepare('UPDATE extensions SET enabled = ?, updated_at = updated_at WHERE owner_id = ? AND id = ?').run(on ? 1 : 0, owner, id);
  loadExtension(ctx, rowOf(ctx, owner, id));
}

/** Remove it; its stored data (script storage and variables) too unless kept. */
export function uninstallExtension(ctx: AppContext, owner: string, id: string, keepData: boolean) {
  const row = rowOf(ctx, owner, id);
  stopServerPart(owner, id);
  // Its game ops stay known (retired), so stories that used them still replay and roll back.
  const ops = json<ExtensionManifest>(row.manifest, null as never).entries.ops;
  if (ops.length) {
    registerExtOps(id, ops, { retired: true });
    ctx.db
      .prepare("INSERT INTO variables (owner_id, scope, scope_id, data, updated_at) VALUES (?, 'retired-ext-ops', ?, ?, ?) ON CONFLICT(owner_id, scope, scope_id) DO UPDATE SET data = excluded.data")
      .run(owner, id, JSON.stringify({ ops }), Date.now());
  } else unregisterExtOps(id);
  stopDevWatch(owner, id);
  ctx.db.prepare('DELETE FROM extensions WHERE owner_id = ? AND id = ?').run(owner, id);
  ctx.db.prepare('DELETE FROM script_grants WHERE owner_id = ? AND key = ?').run(owner, extKey(id));
  rmSync(extDir(ctx, owner, id), { recursive: true, force: true });
  if (!keepData) {
    ctx.db.prepare('DELETE FROM script_storage WHERE owner_id = ? AND script_key = ?').run(owner, extKey(id));
    ctx.db.prepare("DELETE FROM variables WHERE owner_id = ? AND scope = 'extension' AND scope_id = ?").run(owner, id);
  }
}

export function recordExtensionError(ctx: AppContext, owner: string, id: string, where: string, message: string) {
  const r = ctx.db.prepare('SELECT errors FROM extensions WHERE owner_id = ? AND id = ?').get(owner, id) as { errors: string } | undefined;
  if (!r) return;
  const list = [{ at: Date.now(), where: where.slice(0, 80), message: message.slice(0, 500) }, ...json<any[]>(r.errors, [])].slice(0, 50);
  ctx.db.prepare('UPDATE extensions SET errors = ? WHERE owner_id = ? AND id = ?').run(JSON.stringify(list), owner, id);
}
export function clearExtensionErrors(ctx: AppContext, owner: string, id: string) {
  ctx.db.prepare("UPDATE extensions SET errors = '[]' WHERE owner_id = ? AND id = ?").run(owner, id);
}

// ------------------------------------------------------------------ files for the app

const MIME: Record<string, string> = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', woff2: 'font/woff2', txt: 'text/plain', md: 'text/markdown' };
const mimeOf = (f: string) => MIME[f.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';

/**
 * One entry file, ready for a sandboxed frame: relative scripts, styles and pictures are inlined
 * (the frame can't load anything by address). JavaScript entries come back as they are.
 */
export function entryDocument(ctx: AppContext, owner: string, id: string, file: string): { type: 'html' | 'js'; text: string } {
  const r = rowOf(ctx, owner, id);
  if (!r.enabled) throw new HttpError(403, 'This extension is off');
  const files = filesOf(ctx, r);
  const m = json<ExtensionManifest>(r.manifest, null as never);
  const allowed = new Set([m.entries.background, m.entries.settings, ...m.entries.panels.map((p) => p.file), ...m.entries.screens.map((s) => s.file), ...m.entries.messageRenderers.map((x) => x.file)].filter(Boolean));
  if (!allowed.has(file)) throw new HttpError(404, 'Not an entry of this extension');
  const buf = files.get(file);
  if (!buf) throw new HttpError(404, 'File missing');
  if (!file.endsWith('.html')) return { type: 'js', text: buf.toString('utf8') };
  const base = path.posix.dirname(file);
  const resolve = (ref: string) => (/^[a-z]+:|^\/\//i.test(ref) ? null : path.posix.normalize(path.posix.join(base === '.' ? '' : base, ref)));
  let html = buf.toString('utf8');
  html = html.replace(/<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (full, a: string, src: string, b: string) => {
    const f = resolve(src);
    const body = f ? files.get(f) : null;
    return body ? `<script${a}${b}>${body.toString('utf8').replace(/<\/script/gi, '<\\/script')}</script>` : full;
  });
  html = html.replace(/<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>/gi, (full) => {
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(full)?.[1];
    const f = href ? resolve(href) : null;
    const body = f ? files.get(f) : null;
    return body ? `<style>${body.toString('utf8')}</style>` : full;
  });
  html = html.replace(/(\b(?:src|href)\s*=\s*["'])([^"'#][^"']*\.(?:png|jpe?g|webp|gif|svg|mp3|ogg|wav))(["'])/gi, (full, a: string, ref: string, z2: string) => {
    const f = resolve(ref);
    const body = f ? files.get(f) : null;
    return body && body.length < 2 * 1024 * 1024 ? `${a}data:${mimeOf(f!)};base64,${body.toString('base64')}${z2}` : full;
  });
  return { type: 'html', text: html };
}

// ------------------------------------------------------------------ what the rest of Everloom sees

/** Approved, enabled client extensions as scripts (one key per extension). */
export function extensionScripts(ctx: AppContext, owner: string): Array<{ key: string; ref: ScriptRef; script: Script; fingerprint: string; origin: string }> {
  const out: Array<{ key: string; ref: ScriptRef; script: Script; fingerprint: string; origin: string }> = [];
  if (!tableReady(ctx)) return out;
  for (const r of ctx.db.prepare('SELECT * FROM extensions WHERE owner_id = ? AND enabled = 1').all(owner) as Row[]) {
    const m = json<ExtensionManifest>(r.manifest, null as never);
    if (!m.entries.background && !m.entries.composerButtons.length && !m.entries.slashCommands.length) continue;
    const { fp } = grantState(ctx, r, m);
    out.push({
      key: extKey(r.id),
      ref: { scope: 'extension', scopeId: r.id, scriptId: 'main' },
      script: {
        id: 'main',
        name: m.name,
        description: m.description,
        code: '',
        permissions: m.permissions,
        domains: m.domains,
        triggers: ['load'],
        buttons: m.entries.composerButtons.map((b) => ({ id: b.id, label: b.label, icon: b.icon })),
        enabled: true,
        compat: false,
      },
      fingerprint: fp,
      origin: `Extension “${m.name}”`,
    });
  }
  return out;
}

function tableReady(ctx: AppContext) {
  try {
    ctx.db.prepare('SELECT 1 FROM extensions LIMIT 1').get();
    return true;
  } catch {
    return false;
  }
}

function approvedRows(ctx: AppContext, owner: string): Array<{ r: Row; m: ExtensionManifest }> {
  if (!tableReady(ctx)) return [];
  return (ctx.db.prepare('SELECT * FROM extensions WHERE owner_id = ? AND enabled = 1').all(owner) as Row[])
    .map((r) => ({ r, m: json<ExtensionManifest>(r.manifest, null as never) }))
    .filter(({ r, m }) => grantState(ctx, r, m).approved);
}

export function extensionRegex(ctx: AppContext, owner: string): RegexScript[] {
  return approvedRows(ctx, owner).flatMap(({ m }) => importRegexScripts(m.entries.regex));
}

/** Prompt blocks from approved extensions; text can use macros, including the extension's own values. */
export function extensionPromptBlocks(ctx: AppContext, owner: string): Array<{ ext: string; id: string; text: string; position: 'before' | 'after' | 'depth'; depth: number; role: 'system' | 'user' | 'assistant' }> {
  if (!getSettings(ctx, owner).scripts.enabled) return [];
  return approvedRows(ctx, owner).flatMap(({ r, m }) => m.entries.promptBlocks.map((b) => ({ ext: r.id, ...b })));
}

/** What the app needs to mount extension UI. */
export function extensionUi(ctx: AppContext, owner: string) {
  return approvedRows(ctx, owner).map(({ r, m }) => ({
    id: r.id,
    key: extKey(r.id),
    name: m.name,
    version: m.version,
    permissions: m.permissions,
    dev: !!devFolder(r),
    updatedAt: r.updated_at,
    background: m.entries.background ?? null,
    panels: m.entries.panels,
    screens: m.entries.screens,
    settings: m.entries.settings ?? null,
    composerButtons: m.entries.composerButtons,
    slashCommands: m.entries.slashCommands,
    messageRenderers: m.entries.messageRenderers,
    macros: m.entries.macros,
  }));
}

/** Register custom ops (and start server parts) for an extension as it is now. */
export function loadExtension(ctx: AppContext, r: Row) {
  const m = json<ExtensionManifest>(r.manifest, null as never);
  const on = !!r.enabled && grantState(ctx, r, m).approved;
  if (m.entries.ops.length) {
    // Off or unapproved: kept for replaying the story, refused for new changes.
    const res = registerExtOps(r.id, m.entries.ops, { retired: !on });
    for (const e of res.errors) recordExtensionError(ctx, r.owner_id, r.id, 'ops', e);
    ctx.db.prepare("DELETE FROM variables WHERE owner_id = ? AND scope = 'retired-ext-ops' AND scope_id = ?").run(r.owner_id, r.id);
  } else unregisterExtOps(r.id);
  if (m.server) {
    if (on && serverExtensionsAllowed() && isServerOwner(ctx, r.owner_id)) startServerPart(ctx, r.owner_id, r.id, devFolder(r) ?? extDir(ctx, r.owner_id, r.id), m.server.main, !!devFolder(r));
    else stopServerPart(r.owner_id, r.id);
  }
  const dev = devFolder(r);
  if (dev && r.enabled) startDevWatch(ctx, r.owner_id, r.id, dev);
  else stopDevWatch(r.owner_id, r.id);
}

/** At start-up (and after unlocking the vault): register every extension's ops. */
export function loadAllExtensions(ctx: AppContext) {
  if (!tableReady(ctx)) return;
  for (const r of ctx.db.prepare("SELECT scope_id, data FROM variables WHERE scope = 'retired-ext-ops'").all() as Array<{ scope_id: string; data: string }>) registerExtOps(r.scope_id, json<{ ops: unknown[] }>(r.data, { ops: [] }).ops, { retired: true });
  for (const r of ctx.db.prepare('SELECT * FROM extensions').all() as Row[]) {
    try {
      loadExtension(ctx, r);
    } catch (e) {
      console.error(`Extension ${r.id} failed to load:`, (e as Error).message);
    }
  }
}

// ------------------------------------------------------------------ dev folders (hot reload)

const watchers = new Map<string, FSWatcher>();

/** Install from a folder on the server (inside the allowed import locations), read live. */
export function installDevFolder(ctx: AppContext, owner: string, folder: string): ExtensionDTO {
  let p = path.resolve(folder.trim());
  if (!existsSync(p)) throw new HttpError(404, 'Folder not found on the server');
  p = realpathSync(p);
  const roots = ctx.cfg.importRoots.map((r) => (existsSync(r) ? realpathSync(r) : path.resolve(r)));
  if (!roots.some((r) => p === r || p.startsWith(r.endsWith(path.sep) ? r : r + path.sep))) throw new HttpError(403, 'That folder is outside the allowed import locations (EVERLOOM_IMPORT_ROOTS)');
  const pkg = readFolder(p);
  return installPackage(ctx, owner, pkg, `dev:${p}`, { approve: true, dev: p });
}

function startDevWatch(ctx: AppContext, owner: string, id: string, dir: string) {
  const k = `${owner}:${id}`;
  if (watchers.has(k)) return;
  let t: NodeJS.Timeout | null = null;
  try {
    const w = watch(dir, { recursive: true }, () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        if (!ctx.db.open) return;
        try {
          const pkg = readFolder(dir);
          const now = Date.now();
          ctx.db.prepare('UPDATE extensions SET manifest = ?, updated_at = ? WHERE owner_id = ? AND id = ?').run(JSON.stringify(pkg.manifest), now, owner, id);
          hashCache.delete(k);
          // A dev folder is the owner's own code: keep it approved as it changes.
          approveExtension(ctx, owner, id);
          ctx.bus.publish(owner, 'extension.changed', { id });
        } catch (e) {
          try {
            recordExtensionError(ctx, owner, id, 'reload', (e as Error).message);
            ctx.bus.publish(owner, 'extension.changed', { id, error: (e as Error).message });
          } catch {
            /* the app is shutting down */
          }
        }
      }, 250);
      t.unref?.();
    });
    w.unref?.();
    watchers.set(k, w);
  } catch {
    /* recursive watching isn't available everywhere; reloading by hand still works */
  }
}
/** When the app closes: no watcher may fire into a closed database. */
export function stopAllDevWatches() {
  for (const w of watchers.values()) w.close();
  watchers.clear();
}

function stopDevWatch(owner: string, id: string) {
  const k = `${owner}:${id}`;
  watchers.get(k)?.close();
  watchers.delete(k);
}

export { callServerPart } from './extension-host.js';
