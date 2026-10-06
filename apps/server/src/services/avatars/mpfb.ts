/**
 * Realistic characters with MPFB, the MakeHuman add-on for Blender (GPL-3.0), and MakeHuman's
 * system assets (CC0: skins, eyes, brows, lashes, hair, clothes). Neither ships with Everloom: the
 * owner installs them from Settings (downloaded from their official sources and checked against a
 * pinned SHA-256), or uses an MPFB already installed in their own Blender.
 *
 * Everloom's copy lives in <data>/blender/extensions, used as Blender's extensions folder for
 * MPFB jobs only, so the owner's own Blender profile is never changed.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Unzip, UnzipInflate } from 'fflate';
import { RealisticSpecSchema, adultAge, type RealisticSpec } from '@everloom/engine';
import { HttpError, type AppContext } from '../../context.js';
import { safeFetch } from '../../util/fetch.js';
import { findBlender, runBlenderJob } from '../blender.js';
import { createAvatar } from './service.js';

export interface MpfbSource {
  url: string;
  sha256: string;
  /** Upper bound for the download, in bytes. */
  max: number;
}
let SOURCES: { addon: MpfbSource; assets: MpfbSource } = {
  // MPFB 2.0.17 from extensions.blender.org (the URL itself names the file's hash).
  addon: {
    url: 'https://extensions.blender.org/download/sha256:4f0a879d64a39bf646fbf5f53601ac678855da329d650617dca5737548239a87/add-on-mpfb-v2.0.17.zip',
    sha256: '4f0a879d64a39bf646fbf5f53601ac678855da329d650617dca5737548239a87',
    max: 120 * 1024 * 1024,
  },
  // MakeHuman's CC0 system assets.
  assets: {
    url: 'https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip',
    sha256: 'b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107',
    max: 600 * 1024 * 1024,
  },
};
/** Tests point the installer at local files. */
export function setMpfbSources(s: typeof SOURCES) {
  SOURCES = s;
}

export const ASSET_KINDS = ['skins', 'eyes', 'eyebrows', 'eyelashes', 'hair', 'clothes'] as const;
export type MpfbAssets = Record<(typeof ASSET_KINDS)[number], string[]>;

export interface MpfbInstall {
  state: 'idle' | 'running' | 'done' | 'failed';
  stage: string;
  progress: number;
  error: string | null;
}
let install: MpfbInstall = { state: 'idle', stage: '', progress: 0, error: null };
let assetsCache: { at: number; managed: boolean; assets: MpfbAssets | null } | null = null;

export function mpfbDir(ctx: AppContext) {
  return path.join(ctx.cfg.dataDir, 'blender', 'extensions');
}
const MARKER = 'everloom-mpfb.json';
function managed(ctx: AppContext) {
  return existsSync(path.join(mpfbDir(ctx), MARKER));
}

/** Blender 4.2 or later (MPFB 2 is an extension, which needs 4.2). */
function recentEnough(version: string | null) {
  const [a = 0, b = 0] = (version ?? '').split('.').map(Number);
  return a > 4 || (a === 4 && b >= 2);
}

export async function mpfbStatus(ctx: AppContext, owner: string, opts: { refresh?: boolean } = {}) {
  const blender = await findBlender(ctx, owner);
  const base = { blender: blender.found, blenderVersion: blender.version, blenderRecent: recentEnough(blender.version), install, managed: managed(ctx) };
  if (!blender.found || !base.blenderRecent || install.state === 'running') return { ...base, installed: false, assets: null as MpfbAssets | null };
  if (opts.refresh || !assetsCache || assetsCache.managed !== base.managed || Date.now() - assetsCache.at > 10 * 60_000) {
    let assets: MpfbAssets | null = null;
    try {
      const r = await runBlenderJob(ctx, owner, { op: 'mpfb_assets', files: {}, input: '', output: '', extensions: base.managed ? mpfbDir(ctx) : undefined, timeoutMs: 90_000 });
      if (r.result.installed) assets = Object.fromEntries(ASSET_KINDS.map((k) => [k, Array.isArray(r.result[k]) ? (r.result[k] as string[]) : []])) as MpfbAssets;
    } catch {
      assets = null;
    }
    assetsCache = { at: Date.now(), managed: base.managed, assets };
  }
  const assets = assetsCache.assets;
  // MPFB without the system assets can't make anyone worth showing.
  return { ...base, installed: !!assets && assets.skins.length > 0, assets };
}

async function download(src: MpfbSource, file: string, onBytes: (n: number, total: number) => void) {
  const res = await safeFetch(src.url, { timeoutMs: 60 * 60_000, shield: false });
  if (!res.ok || !res.body) throw new Error(`The download failed (${res.status})`);
  const total = Number(res.headers.get('content-length') ?? 0);
  if (total > src.max) throw new Error('The download is larger than expected');
  const hash = createHash('sha256');
  const out = createWriteStream(file, { mode: 0o600 });
  let n = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > src.max) {
        await reader.cancel();
        throw new Error('The download is larger than expected');
      }
      hash.update(value);
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
      onBytes(n, total);
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (hash.digest('hex') !== src.sha256) throw new Error('The download did not match its checksum, so it was not installed');
}

/** Unzips a file into a folder as it streams (the asset pack is 300 MB: never held in memory). */
export async function extractZip(file: string, dest: string) {
  const root = path.resolve(dest);
  mkdirSync(root, { recursive: true });
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  const writes: Array<Promise<void>> = [];
  let failed: Error | null = null;
  unzip.onfile = (f) => {
    const target = path.resolve(root, f.name);
    if (target !== root && !target.startsWith(root + path.sep)) {
      failed = new Error(`Unsafe path in the archive: ${f.name.slice(0, 80)}`);
      return;
    }
    if (f.name.endsWith('/')) {
      mkdirSync(target, { recursive: true });
      return;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    const out = createWriteStream(target);
    writes.push(
      new Promise<void>((resolve, reject) => {
        out.on('error', reject);
        out.on('finish', () => resolve());
        f.ondata = (err, chunk, final) => {
          if (err) {
            out.destroy();
            reject(err);
            return;
          }
          out.write(chunk);
          if (final) out.end();
        };
      }),
    );
    f.start();
  };
  for await (const chunk of createReadStream(file, { highWaterMark: 1 << 20 })) {
    unzip.push(chunk as Uint8Array);
    if (failed) throw failed;
  }
  unzip.push(new Uint8Array(0), true);
  if (failed) throw failed;
  await Promise.all(writes);
}

/** Downloads and installs MPFB and the CC0 assets into Everloom's own Blender extensions folder. */
export function installMpfb(ctx: AppContext): MpfbInstall {
  if (install.state === 'running') return install;
  install = { state: 'running', stage: 'Downloading MPFB', progress: 0, error: null };
  const root = mpfbDir(ctx);
  const tmp = path.join(ctx.cfg.dataDir, 'tmp', 'mpfb');
  void (async () => {
    try {
      rmSync(tmp, { recursive: true, force: true });
      mkdirSync(tmp, { recursive: true, mode: 0o700 });
      const addon = path.join(tmp, 'mpfb.zip');
      const assets = path.join(tmp, 'assets.zip');
      await download(SOURCES.addon, addon, (n, t) => (install.progress = Math.round((t ? n / t : 0) * 10)));
      install.stage = 'Downloading the MakeHuman assets';
      await download(SOURCES.assets, assets, (n, t) => (install.progress = 10 + Math.round((t ? n / t : 0) * 70)));
      install.stage = 'Installing';
      install.progress = 80;
      rmSync(path.join(root, MARKER), { force: true });
      const ext = path.join(root, 'user_default', 'mpfb');
      const data = path.join(root, '.user', 'user_default', 'mpfb', 'data');
      rmSync(ext, { recursive: true, force: true });
      rmSync(data, { recursive: true, force: true });
      await extractZip(addon, ext);
      install.progress = 85;
      await extractZip(assets, data);
      writeFileSync(path.join(root, MARKER), JSON.stringify({ installedAt: Date.now(), addon: SOURCES.addon.sha256, assets: SOURCES.assets.sha256 }));
      assetsCache = null;
      install = { state: 'done', stage: 'Installed', progress: 100, error: null };
    } catch (e) {
      install = { state: 'failed', stage: 'Failed', progress: 0, error: (e as Error).message.slice(0, 300) };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  })();
  return install;
}

export function removeMpfb(ctx: AppContext) {
  if (install.state === 'running') throw new HttpError(409, 'MPFB is being installed');
  rmSync(mpfbDir(ctx), { recursive: true, force: true });
  assetsCache = null;
  install = { state: 'idle', stage: '', progress: 0, error: null };
}

/** The installed version (Everloom's copy), for the settings page. */
export function mpfbInstalledInfo(ctx: AppContext): { installedAt: number } | null {
  try {
    return JSON.parse(readFileSync(path.join(mpfbDir(ctx), MARKER), 'utf8')) as { installedAt: number };
  } catch {
    return null;
  }
}

/** Makes the character in Blender, then brings it in like any imported model. */
export async function createRealisticAvatar(ctx: AppContext, owner: string, input: { name?: string; spec: unknown }) {
  const spec: RealisticSpec = RealisticSpecSchema.parse(input.spec ?? {});
  spec.macro.age = adultAge(spec.macro.age);
  const st = await mpfbStatus(ctx, owner);
  if (!st.blender) throw new HttpError(424, 'Realistic characters need Blender 4.2 or later (free from blender.org).', 'blender_missing');
  if (!st.installed || !st.assets) throw new HttpError(424, 'Realistic characters need MPFB and the MakeHuman assets: install them in Settings → 3D characters.', 'mpfb_missing');
  const a = st.assets;
  const has = (list: string[], v: string | null) => v === null || list.includes(v);
  if (!has(a.skins, spec.skin) || !has(a.eyes, spec.eyes) || !has(a.eyebrows, spec.eyebrows) || !has(a.eyelashes, spec.eyelashes) || !has(a.hair, spec.hair) || !spec.clothes.every((c) => a.clothes.includes(c))) {
    throw new HttpError(400, 'One of the chosen assets is not installed');
  }
  const r = await runBlenderJob(ctx, owner, {
    op: 'mpfb',
    files: {},
    input: '',
    output: 'human.glb',
    extensions: st.managed ? mpfbDir(ctx) : undefined,
    timeoutMs: 5 * 60_000,
    extra: { macro: spec.macro, skin: spec.skin, eyes: spec.eyes, eyebrows: spec.eyebrows, eyelashes: spec.eyelashes, hair: spec.hair, clothes: spec.clothes, rig: 'game_engine' },
  });
  return createAvatar(ctx, owner, r.output, { name: input.name || 'Realistic character', filename: 'realistic.glb', kind: 'realistic', config: { realistic: spec, look: 'pbr' } });
}
