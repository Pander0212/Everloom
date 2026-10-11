/** Native MakeHuman data installation. Assets use the encrypted media store, never Blender. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Unzip, UnzipInflate, unzipSync } from 'fflate';
import { parseHumanObj, parseProxy, parseTarget, parseHumanMaterial, parseHumanRig, resolveHumanPath, type AvatarConfig } from '@everloom/engine';
import sharp from 'sharp';
import { gunzipSync } from 'node:zlib';
import { isMinorAvatar, REFUSED } from '../minor-guard.js';
import { HttpError, type AppContext } from '../../context.js';
import { safeFetch } from '../../util/fetch.js';
import { deleteMedia, mediaUrl, saveModelFile } from '../media.js';
import { getKv, setKv } from '../settings.js';

const SOURCES = {
  core: { url: '', sha256: '9218e83c44a0335f37e01bcf471c6d57899115cacff9031fc817a34c709511ec', bytes: 38637876, max: 70 * 1024 * 1024 },
  system: { url: '', sha256: '2da052728c2900d2170862cebad797b4daa2d8b9334d7db66275bf45b00ac583', bytes: 92380784, max: 100 * 1024 * 1024 },
};
type Pack = keyof typeof SOURCES;
interface Install { state: 'idle' | 'running' | 'done' | 'failed'; stage: string; received: number; files: number; error: string | null }
interface Installed { version: string; files: Record<string, string>; bytes: number }
interface OwnerPack { id: string; label: string; adult: boolean; kind: string; files: Record<string, string> }
const ownerKey = 'makehuman:owner-packs:v1';
const jobs = new Map<string, Install>();
const keyFor = (pack: Pack) => `makehuman:${pack}:v1`;
const allowed = /\.(obj|mhclo|mhmat|mhskel|mhw|json|target|target\.gz|png|jpg|jpeg|webp)$/i;
const explicit = /(?:^|[\/_-])(genitals?|penis|vagina|nipples?|anus|explicit)(?:[\/_.-]|$)/i;

export function makeHumanStatus(ctx: AppContext, owner: string) {
  // Adult packs are always available (no setting; only the online character browser has one).
  const adultEnabled = true;
  const packs = getKv<OwnerPack[]>(ctx, owner, ownerKey, []).filter(pack => !pack.adult || adultEnabled);
  return { adultEnabled, ownerPacks: packs.map(({ files, ...metadata }) => ({ ...metadata, count: Object.keys(files).length })), ...Object.fromEntries((['core', 'system'] as const).map(pack => {
    const data = getKv<Installed | null>(ctx, owner, keyFor(pack), null);
    const files = { ...data?.files, ...Object.assign({}, ...packs.filter(p => (pack === 'core') === ['targets', 'rigs'].includes(p.kind)).map(p => p.files)) };
    return [pack, { installed: !!data, license: 'CC0 1.0', downloadBytes: SOURCES[pack].bytes, files: Object.fromEntries(Object.entries(files).map(([p, id]) => [p, mediaUrl(id as string)])), install: jobs.get(`${owner}:${pack}`) ?? { state: 'idle', stage: '', received: 0, files: 0, error: null } }];
  })) };
}

/** Owner-provided data never leaves the server or bypasses the Vault. */
export async function importHumanAssets(ctx: AppContext, owner: string, bytes: Buffer, options: { kind: string; label: string; adult: boolean; rightsConfirmed: boolean }) {
  if (!options.rightsConfirmed) throw new HttpError(400, 'Confirm that you may use these asset files.');
  if (bytes.length > 100 * 1024 * 1024) throw new HttpError(413, 'Asset packs must be smaller than 100 MB.');
  let total = 0, count = 0;
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(bytes, { filter: file => {
    if (!allowed.test(file.name) || file.name.endsWith('/')) return false;
    if (++count > 500 || file.originalSize > 20 * 1024 * 1024 || (total += file.originalSize) > 150 * 1024 * 1024) throw new HttpError(413, 'This asset pack expands beyond the installation limits.');
    return true;
  } }); } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'The asset ZIP could not be read.'); }
  if (!Object.keys(entries).length) throw new HttpError(400, 'This ZIP contains no supported MakeHuman assets.');
  const normalized: Record<string, Uint8Array> = {};
  for (const [raw, value] of Object.entries(entries)) {
    const name = raw.replace(/\\/g, '/');
    if (name.startsWith('/') || name.includes(':') || name.split('/').some(p => p === '..' || !p) || name.length > 160) throw new HttpError(400, 'Unsafe or overly long asset path in the ZIP.');
    if (!options.adult && explicit.test(name)) throw new HttpError(400, 'Anatomy assets must be in a pack tagged 18+.');
    const text = () => Buffer.from(value).toString('utf8');
    try {
      if (/\.obj$/i.test(name)) { const mesh = parseHumanObj(text()); if (mesh.vertices.length / 3 > 200000) throw new Error('OBJ has more than 200,000 vertices'); }
      else if (/\.mhclo$/i.test(name)) parseProxy(text(), 19158);
      else if (/\.target$/i.test(name)) parseTarget(text(), 19158);
      else if (/\.target\.gz$/i.test(name)) parseTarget(gunzipSync(value, { maxOutputLength: 20 * 1024 * 1024 }).toString('utf8'), 19158);
      else if (/\.mhmat$/i.test(name)) parseHumanMaterial(text());
      else if (/\.mhskel$|(?:^|\/)rig\.[^/]+\.json$/i.test(name)) parseHumanRig(text(), 19158);
      else if (/\.(json|mhw)$/i.test(name)) JSON.parse(text());
      else if (/\.(png|jpe?g|webp)$/i.test(name)) await sharp(value, { limitInputPixels: 16_777_216 }).metadata();
    } catch (error) { throw new HttpError(400, `${name}: ${(error as Error).message}`); }
    normalized[name] = value;
  }
  try {
    const paths = Object.keys(normalized);
    for (const [name, value] of Object.entries(normalized)) {
      const text = Buffer.from(value).toString('utf8');
      const requireFile = (relative: string) => resolveHumanPath(paths, name, relative);
      if (/\.mhclo$/i.test(name)) { const proxy = parseProxy(text, 19158), mesh = parseHumanObj(Buffer.from(normalized[requireFile(proxy.obj)]).toString('utf8')); if (mesh.vertices.length / 3 !== proxy.bindings.length) throw new Error(`The garment ${proxy.name} does not match its OBJ vertex count.`); if (proxy.material) requireFile(proxy.material); }
      else if (/\.mhmat$/i.test(name)) { const material = parseHumanMaterial(text); for (const key of ['diffuseTexture', 'normalmapTexture', 'aomapTexture', 'bumpmapTexture', 'displacementmapTexture']) if (material[key]) requireFile(material[key] as string); }
      else if (/\.mhskel$|(?:^|\/)rig\.[^/]+\.json$/i.test(name)) { const rig = parseHumanRig(text, 19158); requireFile(rig.weightsFile ?? name.replace(/^(.*\/)?rig\./, 'weights.')); }
    }
  } catch (error) { throw new HttpError(400, (error as Error).message); }
  const id = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const existing = getKv<OwnerPack[]>(ctx, owner, ownerKey, []);
  if (existing.some(pack => pack.id === id)) return makeHumanStatus(ctx, owner);
  const files: Record<string, string> = {}, created: string[] = [];
  try {
    for (const [name, value] of Object.entries(normalized)) {
      const storedPath = `${options.kind}/owner-${id}/${name}`;
      const media = saveModelFile(ctx, owner, Buffer.from(value), { kind: 'model-makehuman', ext: name.split('.').pop()!, meta: { makehuman: 'owner', path: storedPath, adult: options.adult, license: 'owner-provided' } });
      created.push(media.id); files[storedPath] = media.id;
    }
    setKv(ctx, owner, ownerKey, [...existing, { id, label: options.label, adult: options.adult, kind: options.kind, files }]);
  } catch (error) { for (const media of created) deleteMedia(ctx, owner, media); throw error; }
  return makeHumanStatus(ctx, owner);
}

/** MakeHuman assets on an avatar: the starter suit stays and 18+ packs stay off for a minor (services/minor-guard.ts). */
export function assertHumanAssets(ctx: AppContext, owner: string, config: AvatarConfig, avatarId?: string) {
  if (!config.makehuman) return;
  const selected = new Set([config.makehuman.skin, config.makehuman.rig, ...config.makehuman.proxies, ...Object.keys(config.makehuman.targets), ...config.outfits.flatMap(outfit => outfit.makehumanProxies ?? [])]);
  const adultAssets = getKv<OwnerPack[]>(ctx, owner, ownerKey, []).some(pack => pack.adult && Object.keys(pack.files).some(path => selected.has(path)));
  const suitless = [config.makehuman.proxies, ...config.outfits.flatMap(outfit => outfit.makehumanProxies ? [outfit.makehumanProxies] : [])].some(proxies => !proxies.some(path => /casualsuit|sportsuit|worksuit|elegantsuit/.test(path)));
  if ((adultAssets || suitless) && isMinorAvatar(ctx, owner, config, avatarId)) throw new HttpError(400, REFUSED);
}

export function installMakeHuman(ctx: AppContext, owner: string, pack: Pack) {
  const key = `${owner}:${pack}`;
  if (jobs.get(key)?.state === 'running') throw new HttpError(409, 'This MakeHuman pack is already downloading.');
  if (getKv(ctx, owner, keyFor(pack), null)) return makeHumanStatus(ctx, owner);
  const status: Install = { state: 'running', stage: 'Downloading CC0 assets', received: 0, files: 0, error: null };
  jobs.set(key, status);
  void (async () => {
    const src = SOURCES[pack], created: string[] = [], files: Record<string, string> = {};
    let expanded = 0, failure: Error | null = null;
    const archive = new Unzip(); archive.register(UnzipInflate);
    archive.onfile = file => {
      let name = file.name.replace(/\\/g, '/');
      if (name.split('/').some(p => p === '..') || name.startsWith('/')) { failure = new Error('Unsafe path in the asset pack.'); return; }
      if (pack === 'core') {
        const marker = '/src/mpfb/data/'; const i = name.indexOf(marker);
        if (i < 0) return;
        name = name.slice(i + marker.length);
        // Data only: the Blender add-on's GPL code and UI images are never installed.
        if (!/^(3dobjs\/base\.obj|rigs\/standard\/|targets\/|faceunits\/)/.test(name)) return;
      }
      if (name.endsWith('/') || !allowed.test(name) || explicit.test(name)) return;
      expanded += file.originalSize ?? 0;
      if ((file.originalSize ?? 0) > 20 * 1024 * 1024 || expanded > 1024 * 1024 * 1024 || Object.keys(files).length > 6000) { failure = new Error('The asset pack exceeds the installation size limits.'); return; }
      const chunks: Uint8Array[] = []; let size = 0;
      file.ondata = (error, chunk, final) => {
        if (failure) return;
        if (error) { failure = error; return; }
        size += chunk.length;
        if (size > 20 * 1024 * 1024) { failure = new Error('An asset is larger than 20 MB.'); return; }
        chunks.push(chunk);
        if (!final) return;
        try {
          const ext = name.split('.').pop()!.toLowerCase();
          const media = saveModelFile(ctx, owner, Buffer.concat(chunks.map(c => Buffer.from(c))), { kind: 'model-makehuman', ext, meta: { makehuman: pack, path: name, license: 'CC0 1.0' } });
          created.push(media.id); files[name] = media.id; status.files++;
        } catch (e) { failure = e as Error; }
      };
      file.start();
    };
    try {
      // Both packs are sanitized before distribution, so installation never
      // downloads upstream anatomy targets or full-body skin textures.
      const res = src.url ? await safeFetch(src.url, { timeoutMs: 20 * 60_000, shield: false }) : null;
      if (res && (!res.ok || !res.body)) throw new Error(`Download failed (HTTP ${res.status}).`);
      const reader = res?.body?.getReader();
      const local = !src.url ? createReadStream(path.join(ctx.cfg.webDir, `avatar/makehuman-${pack}.zip`)) : null;
      const stream = local ?? { async *[Symbol.asyncIterator]() { for (;;) { const item = await reader!.read(); if (item.done) break; yield item.value; } } };
      const hash = createHash('sha256');
      try {
        for await (const value of stream) {
          status.received += value.length;
          if (status.received > src.max) throw new Error('The download is larger than expected.');
          hash.update(value); archive.push(value);
          if (failure) throw failure;
        }
        archive.push(new Uint8Array(), true);
        if (failure) throw failure;
      } finally { local?.destroy(); await reader?.cancel().catch(() => {}); }
      if (hash.digest('hex') !== src.sha256) throw new Error('Checksum mismatch; the pack was not installed.');
      if (!Object.keys(files).length || (pack === 'core' && !files['3dobjs/base.obj'])) throw new Error('The pack does not contain its expected MakeHuman data.');
      setKv(ctx, owner, keyFor(pack), { version: src.sha256, files, bytes: status.received } satisfies Installed);
      status.state = 'done'; status.stage = 'Installed';
    } catch (e) {
      for (const id of created) { try { deleteMedia(ctx, owner, id); } catch { /* A locked Vault is cleaned on the next integrity check. */ } }
      status.state = 'failed'; status.stage = 'Installation failed'; status.error = (e as Error).message.slice(0, 300);
    }
  })();
  return makeHumanStatus(ctx, owner);
}
