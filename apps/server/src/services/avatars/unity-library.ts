/** Persistent, owner-scoped GUID library. Archive and asset bytes remain in Vault-covered chunks. */
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import yauzl from 'yauzl';
import { UnityProject, streamTar, safeUnityPath, kindOf, pathGuid, parseYaml, asStr, type UnityAsset } from '@everloom/engine/unity';
import { runBlenderJob } from '../blender.js';
import { createAvatar } from './service.js';
import { HttpError, type AppContext } from '../../context.js';
import { getKv, setKv } from '../settings.js';
import { deleteMedia, readMedia } from '../media.js';
import { getUpload, storeUpload, readBlob, storeBlob, uploadLimit, UPLOAD_CHUNK, type BlobRecord } from './uploads.js';

type StoredAsset = Omit<UnityAsset, 'data'> & { blob?: BlobRecord; text?: string };
const libraryKey = 'unity-library';
const active = new Map<string, AbortController>();
const decoder = new TextDecoder();
export function libraryAssets(ctx: AppContext, owner: string) { return getKv<StoredAsset[]>(ctx, owner, libraryKey, []); }
export function libraryProject(ctx: AppContext, owner: string) {
  const p = new UnityProject();
  for (const a of libraryAssets(ctx, owner)) p.add({ ...a, data: a.text === undefined ? undefined : new TextEncoder().encode(a.text), sourceId: a.guid });
  return p;
}
export function libraryManifest(ctx: AppContext, owner: string) { return libraryAssets(ctx, owner).map(({ blob, ...a }) => ({ ...a, sourceId: a.guid })); }
export function libraryBlob(ctx: AppContext, owner: string, guid: string) {
  const asset = libraryAssets(ctx, owner).find(a => a.guid === guid);
  if (!asset?.blob) throw new HttpError(404, 'Unity asset not found');
  return asset.blob;
}
class ChunkReader extends yauzl.RandomAccessReader {
  constructor(private ctx: AppContext, private owner: string, private blob: BlobRecord) { super(); }
  override _readStreamForRange(start: number, end: number) {
    const { ctx, owner, blob } = this;
    return Readable.from((async function* () {
      while (start < end) {
        if (ctx.vault.locked) throw new HttpError(423, 'The vault is locked', 'locked');
        const index = Math.floor(start / UPLOAD_CHUNK), offset = start % UPLOAD_CHUNK;
        const bytes = readMedia(ctx, owner, blob.chunks[index]!).bytes;
        const part = bytes.subarray(offset, Math.min(bytes.length, offset + end - start));
        if (!part.length) throw new Error('Truncated stored ZIP');
        start += part.length; yield part;
      }
    })());
  }
}
async function* zipEntries(ctx: AppContext, owner: string, blob: BlobRecord) {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.fromRandomAccessReader(new ChunkReader(ctx, owner, blob), blob.size, { lazyEntries: true, autoClose: false }, (err, z) => err ? reject(err) : resolve(z)));
  let failure: Error | undefined;
  zip.on('error', e => { failure = e; });
  try {
    if (zip.entryCount > 50_000) throw new Error('ZIP contains too many entries');
    for (;;) {
      if (failure) throw failure;
      const entry = await new Promise<yauzl.Entry | null>((resolve, reject) => {
        const clean = () => { zip.off('entry', found); zip.off('end', end); zip.off('error', error); };
        const found = (e: yauzl.Entry) => { clean(); resolve(e); };
        const end = () => { clean(); resolve(null); };
        const error = (e: Error) => { clean(); reject(e); };
        zip.once('entry', found); zip.once('end', end); zip.once('error', error); zip.readEntry();
      });
      if (!entry) break;
      if (entry.fileName.endsWith('/')) continue;
      const stream = await new Promise<Readable>((resolve, reject) => zip.openReadStream(entry, (err, s) => err ? reject(err) : resolve(s)));
      try { yield { name: entry.fileName, size: entry.uncompressedSize, chunks: stream as AsyncIterable<Uint8Array> }; }
      finally { stream.destroy(); }
    }
  } finally { zip.close(); }
}
async function collect(source: AsyncIterable<Uint8Array>, max: number) {
  const chunks: Uint8Array[] = []; let size = 0;
  for await (const b of source) { size += b.length; if (size > max) throw new Error('Unity metadata exceeds its size limit'); chunks.push(b); }
  return Buffer.concat(chunks);
}
export function cancelLibraryJob(owner: string, id: string) { active.get(`${owner}:${id}`)?.abort(); }
export function startLibraryJob(ctx: AppContext, owner: string, id: string, mode: 'library' | 'avatar' = 'library') {
  const u = getUpload(ctx, owner, id), key = `${owner}:${id}`;
  if (active.has(key) || u.state === 'done') return u;
  if (u.offset !== u.size) throw new HttpError(409, 'Finish uploading the file first');
  for (const chunk of u.stagedChunks ?? []) deleteMedia(ctx, owner, chunk);
  u.stagedChunks = [];
  const abort = new AbortController(); active.set(key, abort);
  u.state = 'processing'; u.progress = 0; delete u.error; storeUpload(ctx, owner, u);
  void indexUpload(ctx, owner, u, abort.signal).then(async () => {
    if (mode === 'avatar') {
      const guids = (u.result as { guids: string[] }).guids, assets = libraryAssets(ctx, owner).filter(a => guids.includes(a.guid));
      const blends = assets.filter(a => /\.blend$/i.test(a.path) && a.blob);
      if (blends.length !== 1) throw new Error('Choose an archive containing exactly one .blend file and its textures');
      const files = Object.fromEntries(assets.filter(a => a.blob).map(a => [`blend/${a.path}`, readBlob(ctx, owner, a.blob!)]));
      u.progress = 0.5; storeUpload(ctx, owner, u);
      const converted = await runBlenderJob(ctx, owner, { op: 'convert', files, input: `blend/${blends[0]!.path}`, output: 'output.glb', timeoutMs: 20 * 60_000, signal: abort.signal });
      abort.signal.throwIfAborted();
      const avatar = createAvatar(ctx, owner, converted.output, { filename: 'converted.glb', name: blends[0]!.path.split('/').pop()!.replace(/\.blend$/i, ''), conversion: converted.result });
      u.result = { ...(u.result as object), avatar: avatar.id };
    }
    u.state = 'done'; u.progress = 1; }).catch(e => {
    u.state = 'failed'; u.error = abort.signal.aborted ? 'Import cancelled' : (e as Error).message;
  }).finally(() => { active.delete(key); if (!ctx.vault.locked) storeUpload(ctx, owner, u); });
  return u;
}
async function indexUpload(ctx: AppContext, owner: string, u: ReturnType<typeof getUpload>, signal: AbortSignal) {
  const staged: StoredAsset[] = [], allocated: string[] = [];
  const loose = new Map<string, { blob: BlobRecord; text?: string }>();
  let total = 0, count = 0, textBytes = 0;
  const check = () => { signal.throwIfAborted(); if (ctx.vault.locked) throw new HttpError(423, 'The vault is locked', 'locked'); };
  const store = async (source: AsyncIterable<Uint8Array>) => {
    async function* bounded() { for await (const c of source) { check(); total += c.length; if (total > uploadLimit() * 2) throw new Error('Archive exceeds the unpacked size limit'); yield c; } }
    return storeBlob(ctx, owner, bounded(), uploadLimit(), id => {
      allocated.push(id);
      u.stagedChunks = [...allocated]; storeUpload(ctx, owner, u);
    });
  };
  const metadata = async (b: BlobRecord) => {
    textBytes += b.size;
    if (textBytes > 32 * 1024 ** 2) throw new Error('Package contains too much serialized metadata');
    return decoder.decode(await collect(readBlob(ctx, owner, b), 8 * 1024 ** 2));
  };
  const add = async (guid: string, path: string, blob?: BlobRecord, metaText?: string) => {
    const kind = blob ? kindOf(path) : 'folder';
    const isText = ['prefab', 'scene', 'material', 'anim', 'controller', 'asset', 'text'].includes(kind);
    const text = blob && isText ? await metadata(blob) : undefined;
    const meta = metaText ? parseYaml(metaText) : undefined;
    staged.push({ guid, path, kind, size: blob?.size ?? 0, blob, text, meta, sourceId: guid });
  };
  const packageFile = async (source: AsyncIterable<Uint8Array>) => {
    const input = Readable.from(source), gunzip = input.pipe(createGunzip());
    input.on('error', e => gunzip.destroy(e));
    const groups = new Map<string, { blob?: BlobRecord; path?: string; meta?: string }>();
    try {
      for await (const e of streamTar(gunzip, { maxEntries: 150_000, maxFileBytes: uploadLimit(), maxTotalBytes: uploadLimit() * 2 })) {
        check();
        const m = /^([a-f\d]{32})\/(asset|asset\.meta|pathname)$/i.exec(e.name);
        if (!m) continue;
        const guid = m[1]!.toLowerCase(), g = groups.get(guid) ?? {};
        if (m[2] === 'asset') g.blob = await store(e.chunks);
        else if (m[2] === 'pathname') g.path = safeUnityPath(decoder.decode(await collect(e.chunks, 4096)).split('\n')[0]!) ?? undefined;
        else {
          textBytes += e.size;
          if (textBytes > 32 * 1024 ** 2) throw new Error('Package contains too much serialized metadata');
          g.meta = decoder.decode(await collect(e.chunks, 8 * 1024 ** 2));
        }
        groups.set(guid, g);
        if (groups.size > 50_000) throw new Error('Too many assets in the package');
      }
      for (const [guid, g] of groups) if (g.path) await add(guid, g.path, g.blob, g.meta);
    } finally { input.destroy(); gunzip.destroy(); }
  };
  const entry = async (name: string, source: AsyncIterable<Uint8Array>, depth = 0) => {
    check(); if (++count > 50_000) throw new Error('Too many files in this import');
    const path = safeUnityPath(name); if (!path) throw new Error('Unsafe archive path');
    if (/\.unitypackage$/i.test(path)) { await packageFile(source); return; }
    if (/\.zip$/i.test(path)) {
      if (depth >= 2) throw new Error('Nested ZIP limit exceeded');
      const b = await store(source);
      for await (const e of zipEntries(ctx, owner, b)) await entry(e.name, e.chunks, depth + 1);
      return;
    }
    const at = path.indexOf('/Assets/'), normalized = at < 0 ? path : path.slice(at + 1);
    loose.set(normalized, { blob: await store(source) });
  };
  try {
    await entry(u.name, readBlob(ctx, owner, u));
    for (const [path, f] of loose) {
      if (/\.meta$/i.test(path)) {
        staged.push({ guid: pathGuid(path), path, kind: 'other', text: await metadata(f.blob), blob: f.blob, size: f.blob.size });
        continue;
      }
      const metaFile = loose.get(`${path}.meta`), metaText = metaFile ? await metadata(metaFile.blob) : undefined;
      const guid = metaText ? asStr(parseYaml(metaText).guid).toLowerCase() : '';
      await add(/^[a-f\d]{32}$/.test(guid) ? guid : pathGuid(path), path, f.blob, metaText);
      staged.at(-1)!.guessed = !/^[a-f\d]{32}$/.test(guid);
    }
    check();
    const old = libraryAssets(ctx, owner), merged = new Map(old.map(a => [a.guid, a]));
    for (const a of staged) merged.set(a.guid, a);
    if (merged.size > 50_000) throw new Error('Unity library asset limit reached');
    // Sidecars may arrive in a later upload than their model. Re-key those assets by the exact GUID.
    const byPath = new Map([...merged.values()].map(a => [a.path.toLowerCase(), a]));
    for (const a of byPath.values()) {
      const sidecar = byPath.get(`${a.path.toLowerCase()}.meta`);
      if (!sidecar?.text) continue;
      const meta = parseYaml(sidecar.text), guid = asStr(meta.guid).toLowerCase();
      if (/^[a-f\d]{32}$/.test(guid)) { a.guid = guid; a.sourceId = guid; a.meta = meta; a.guessed = false; }
    }
    const final = [...new Map([...byPath.values()].map(a => [a.guid, a])).values()], retained = new Set(final.flatMap(a => a.blob?.chunks ?? []));
    if (Buffer.byteLength(JSON.stringify(final)) > 48 * 1024 ** 2) throw new Error('Unity library metadata limit reached');
    ctx.db.transaction(() => {
      setKv(ctx, owner, libraryKey, final);
      u.stagedChunks = []; storeUpload(ctx, owner, u);
    })();
    for (const id of [...allocated, ...old.flatMap(a => a.blob?.chunks ?? [])]) if (!retained.has(id)) deleteMedia(ctx, owner, id);
    u.result = { assets: staged.length, guids: staged.map(a => a.guid) };
  } catch (e) { if (!ctx.vault.locked) { for (const id of allocated) deleteMedia(ctx, owner, id); u.stagedChunks = []; } throw e; }
}
