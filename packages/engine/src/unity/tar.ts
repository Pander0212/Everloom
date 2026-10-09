/**
 * A streaming tar reader (ustar, GNU long names, pax headers): feed it chunks of the decompressed
 * stream and it calls back with each regular file. A `.unitypackage` is a gzipped tar of GUID
 * folders, each holding `asset`, `asset.meta` and `pathname`.
 *
 * Guards: a cap on entry count, on each file's size and on the total, so a crafted archive can't
 * exhaust memory. Entry names are only ever used as keys, never as paths on disk.
 */

export interface TarLimits {
  maxEntries: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_TAR_LIMITS: TarLimits = { maxEntries: 200_000, maxFileBytes: 1024 * 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 * 1024 };

export class TarLimitError extends Error {
  code = 'tar_limit';
}

export interface TarEntry {
  name: string;
  size: number;
  data: Uint8Array;
}

const dec = new TextDecoder();
const str = (b: Uint8Array, start: number, len: number) => {
  const s = b.subarray(start, start + len);
  const z = s.indexOf(0);
  return dec.decode(z < 0 ? s : s.subarray(0, z));
};
const octal = (b: Uint8Array, start: number, len: number) => {
  // GNU base-256 for big sizes.
  if (b[start]! & 0x80) {
    let v = 0;
    for (let i = start + 1; i < start + len; i++) v = v * 256 + b[i]!;
    return v;
  }
  const s = str(b, start, len).trim();
  return s ? parseInt(s, 8) : 0;
};

export class TarReader {
  private buf = new Uint8Array(0);
  /** Chunks not yet joined to buf, and how many bytes the next step needs. */
  private queue: Uint8Array[] = [];
  private queued = 0;
  private need = 512;
  private entries = 0;
  private total = 0;
  private longName: string | null = null;
  private paxPath: string | null = null;
  private done = false;
  /** Called for each regular file; return false to skip storing its data (it's still read past). */
  constructor(
    private onFile: (e: TarEntry) => void,
    private limits: TarLimits = DEFAULT_TAR_LIMITS,
    private want: (name: string, size: number) => boolean = () => true,
  ) {}

  push(chunk: Uint8Array) {
    if (this.done) return;
    this.queue.push(chunk);
    this.queued += chunk.length;
    // Join only once the next header or file is complete, so a big file isn't copied per chunk.
    if (this.buf.length + this.queued < this.need) return;
    const out = new Uint8Array(this.buf.length + this.queued);
    out.set(this.buf, 0);
    let o = this.buf.length;
    for (const q of this.queue) {
      out.set(q, o);
      o += q.length;
    }
    this.buf = out;
    this.queue = [];
    this.queued = 0;
    this.drain();
  }

  /** True once the end-of-archive marker was read. */
  get finished() {
    return this.done;
  }

  private drain() {
    let off = 0;
    const b = this.buf;
    this.need = 512;
    while (!this.done && b.length - off >= 512) {
      const h = b.subarray(off, off + 512);
      if (h.every((x) => x === 0)) {
        this.done = true;
        off += 512;
        break;
      }
      const size = octal(h, 124, 12);
      const type = String.fromCharCode(h[156] || 48);
      const padded = Math.ceil(size / 512) * 512;
      // Checked before waiting for the body, so a header claiming a huge size is refused, not buffered.
      if ((type === 'L' || type === 'x' || type === 'g') && size > 1024 * 1024) throw new TarLimitError('A file name in the archive is too long.');
      if (size > this.limits.maxFileBytes) throw new TarLimitError('A file in the archive is larger than allowed.');
      if (b.length - off < 512 + padded) {
        this.need = 512 + padded; // wait for the whole entry
        break;
      }
      const body = b.subarray(off + 512, off + 512 + size);
      off += 512 + padded;
      if (type === 'L') {
        this.longName = str(body, 0, body.length);
        continue;
      }
      if (type === 'x' || type === 'g') {
        const p = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(dec.decode(body));
        if (p && type === 'x') this.paxPath = p[1]!;
        continue;
      }
      const prefix = str(h, 345, 155);
      let name = this.paxPath ?? this.longName ?? (prefix ? `${prefix}/${str(h, 0, 100)}` : str(h, 0, 100));
      this.paxPath = this.longName = null;
      name = name.replace(/^\.\//, '');
      if (type !== '0' && type !== '\0' && type !== '7') continue; // directories, links: skipped
      if (++this.entries > this.limits.maxEntries) throw new TarLimitError(`More than ${this.limits.maxEntries} files in the archive.`);
      this.total += size;
      if (this.total > this.limits.maxTotalBytes) throw new TarLimitError('The archive unpacks to more than allowed.');
      if (this.want(name, size)) this.onFile({ name, size, data: body.slice() });
    }
    // Keep only the leftover (copied, so the big buffer can be released).
    if (off) this.buf = b.slice(off);
  }
}

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Reads a whole (already decompressed) tar in memory. */
export function readTar(data: Uint8Array, limits?: TarLimits): TarEntry[] {
  const out: TarEntry[] = [];
  const r = new TarReader((e) => out.push(e), limits);
  r.push(data);
  return out;
}

/** Writes a minimal ustar archive (used by tests and fixtures). */
export function writeTar(files: { name: string; data: Uint8Array | string }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const f of files) {
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const h = new Uint8Array(512);
    const nameBytes = enc.encode(f.name);
    if (nameBytes.length > 100) {
      // GNU long name entry.
      parts.push(header('././@LongLink', nameBytes.length + 1, 'L'), pad(concat(nameBytes, new Uint8Array(1))));
      h.set(nameBytes.subarray(0, 100), 0);
    } else h.set(nameBytes, 0);
    fillHeader(h, data.length, '0');
    parts.push(h, pad(data));
  }
  parts.push(new Uint8Array(1024));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;

  function header(name: string, size: number, type: string) {
    const h = new Uint8Array(512);
    h.set(enc.encode(name), 0);
    fillHeader(h, size, type);
    return h;
  }
  function fillHeader(h: Uint8Array, size: number, type: string) {
    h.set(enc.encode('0000644\0'), 100);
    h.set(enc.encode('0000000\0'), 108);
    h.set(enc.encode('0000000\0'), 116);
    h.set(enc.encode(size.toString(8).padStart(11, '0') + '\0'), 124);
    h.set(enc.encode('00000000000\0'), 136);
    h[156] = type.charCodeAt(0);
    h.set(enc.encode('ustar\0'), 257);
    h.set(enc.encode('00'), 263);
    h.fill(32, 148, 156);
    let sum = 0;
    for (const x of h) sum += x;
    h.set(enc.encode(sum.toString(8).padStart(6, '0') + '\0 '), 148);
  }
  function pad(d: Uint8Array) {
    const p = new Uint8Array(Math.ceil(d.length / 512) * 512);
    p.set(d, 0);
    return p;
  }
}
