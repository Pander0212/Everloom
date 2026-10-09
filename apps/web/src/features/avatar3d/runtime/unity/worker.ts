/**
 * Unpacks what the owner dropped, off the main thread: a .unitypackage (gzip + tar, streamed), a
 * .zip of an extracted folder, or loose files. Sends back plain {path, data} entries; nothing is
 * written anywhere, and the limits in TarReader / below stop archives that unpack to too much.
 */
import { unzipSync } from 'fflate';
import { TarReader, type TarLimits } from '@everloom/engine/unity';

export interface UnpackRequest {
  files: { name: string; path: string; file: Blob }[];
}
export type UnpackReply =
  | { ok: true; kind: 'package' | 'files'; entries: { name: string; data: Uint8Array }[]; files: { path: string; data: Uint8Array }[] }
  | { ok: false; error: string }
  | { progress: string };

const LIMITS: TarLimits = { maxEntries: 100_000, maxFileBytes: 512 * 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024 * 1024 };
const ZIP_MAX_TOTAL = 2 * 1024 * 1024 * 1024;

async function unpackPackage(blob: Blob, onProgress: (s: string) => void) {
  const entries: { name: string; data: Uint8Array }[] = [];
  // Only what an import can use; previews and the like are skipped while reading.
  const reader = new TarReader((e) => entries.push({ name: e.name, data: e.data }), LIMITS, (name) => /\/(asset|asset\.meta|pathname)$/.test(name));
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  const r = stream.getReader();
  let read = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    read += value.length;
    reader.push(value);
    if (read % (16 * 1024 * 1024) < value.length) onProgress(`Unpacking… ${Math.round(read / 1024 / 1024)} MB`);
  }
  return entries;
}

function unpackZip(data: Uint8Array): { path: string; data: Uint8Array }[] {
  let total = 0;
  let count = 0;
  const out = unzipSync(data, {
    filter: (f) => {
      count++;
      total += f.originalSize;
      if (count > LIMITS.maxEntries || f.originalSize > LIMITS.maxFileBytes || total > ZIP_MAX_TOTAL) throw new Error('The zip unpacks to more than Everloom accepts.');
      return !f.name.endsWith('/');
    },
  });
  return Object.entries(out).map(([path, d]) => ({ path, data: d }));
}

self.onmessage = async (ev: MessageEvent<UnpackRequest>) => {
  const post = (m: UnpackReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);
  try {
    const { files } = ev.data;
    const pkg = files.find((f) => /\.unitypackage$/i.test(f.name));
    if (pkg) {
      const entries = await unpackPackage(pkg.file, (s) => post({ progress: s }));
      post({ ok: true, kind: 'package', entries, files: [] }, entries.map((e) => e.data.buffer as ArrayBuffer));
      return;
    }
    const out: { path: string; data: Uint8Array }[] = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) out.push(...unpackZip(new Uint8Array(await f.file.arrayBuffer())));
      else out.push({ path: f.path || f.name, data: new Uint8Array(await f.file.arrayBuffer()) });
    }
    // A zip of one folder: drop the shared top folder so paths start at "Assets/…" or the asset's folder.
    post({ ok: true, kind: 'files', entries: [], files: out }, out.map((e) => e.data.buffer as ArrayBuffer));
  } catch (e) {
    post({ ok: false, error: (e as Error).message || 'Could not unpack the files.' });
  }
};
