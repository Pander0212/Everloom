/** Minimal PNG chunk reader/writer for tEXt metadata (SillyTavern-compatible). */
import { fromLatin1, latin1 } from '../util/base64.js';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export interface PngChunk {
  name: string;
  data: Uint8Array;
}

let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

export function crc32(bytes: Uint8Array, crc = 0xffffffff): number {
  const t = crcTable();
  for (let i = 0; i < bytes.length; i++) crc = t[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

export function extractChunks(bytes: Uint8Array): PngChunk[] {
  if (!isPng(bytes)) throw new Error('Not a PNG file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunk[] = [];
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos);
    const name = latin1(bytes.subarray(pos + 4, pos + 8));
    if (pos + 12 + len > bytes.length) throw new Error('Truncated PNG chunk');
    chunks.push({ name, data: bytes.slice(pos + 8, pos + 8 + len) });
    pos += 12 + len;
    if (name === 'IEND') break;
  }
  return chunks;
}

export function encodeChunks(chunks: PngChunk[]): Uint8Array {
  let total = 8;
  for (const c of chunks) total += 12 + c.data.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set(SIGNATURE, 0);
  let pos = 8;
  for (const c of chunks) {
    view.setUint32(pos, c.data.length);
    const nameBytes = fromLatin1(c.name);
    out.set(nameBytes, pos + 4);
    out.set(c.data, pos + 8);
    const crcInput = new Uint8Array(4 + c.data.length);
    crcInput.set(nameBytes, 0);
    crcInput.set(c.data, 4);
    view.setUint32(pos + 8 + c.data.length, crc32(crcInput));
    pos += 12 + c.data.length;
  }
  return out;
}

export function decodeText(chunk: PngChunk): { keyword: string; text: string } | null {
  if (chunk.name === 'tEXt') {
    const nul = chunk.data.indexOf(0);
    if (nul < 0) return null;
    return { keyword: latin1(chunk.data.subarray(0, nul)), text: latin1(chunk.data.subarray(nul + 1)) };
  }
  if (chunk.name === 'iTXt') {
    // keyword\0 compressionFlag compressionMethod languageTag\0 translatedKeyword\0 text
    const d = chunk.data;
    const k = d.indexOf(0);
    if (k < 0) return null;
    const compressed = d[k + 1] === 1;
    if (compressed) return null;
    let p = k + 3;
    const lang = d.indexOf(0, p);
    if (lang < 0) return null;
    const tr = d.indexOf(0, lang + 1);
    if (tr < 0) return null;
    p = tr + 1;
    return { keyword: latin1(d.subarray(0, k)), text: new TextDecoder().decode(d.subarray(p)) };
  }
  return null;
}

export function encodeText(keyword: string, text: string): PngChunk {
  const kw = fromLatin1(keyword);
  const tx = fromLatin1(text);
  const data = new Uint8Array(kw.length + 1 + tx.length);
  data.set(kw, 0);
  data[kw.length] = 0;
  data.set(tx, kw.length + 1);
  return { name: 'tEXt', data };
}

/** Read all text entries keyed by lowercase keyword. */
export function readPngText(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of extractChunks(bytes)) {
    const t = decodeText(c);
    if (t) out[t.keyword.toLowerCase()] = t.text;
  }
  return out;
}

/**
 * Replace text chunks with the given keywords (case-insensitive) and insert new ones before IEND.
 * Also strips eXIf and other textual metadata chunks when stripOther is set.
 */
export function writePngText(bytes: Uint8Array, entries: Record<string, string>, stripOther = false): Uint8Array {
  const keys = new Set(Object.keys(entries).map((k) => k.toLowerCase()));
  const chunks = extractChunks(bytes).filter((c) => {
    if (c.name === 'eXIf' && stripOther) return false;
    if (c.name === 'tEXt' || c.name === 'iTXt' || c.name === 'zTXt') {
      if (stripOther) return false;
      const t = decodeText(c);
      if (t && keys.has(t.keyword.toLowerCase())) return false;
    }
    return true;
  });
  const iend = chunks.findIndex((c) => c.name === 'IEND');
  const insertAt = iend < 0 ? chunks.length : iend;
  const newChunks = Object.entries(entries).map(([k, v]) => encodeText(k, v));
  chunks.splice(insertAt, 0, ...newChunks);
  return encodeChunks(chunks);
}
