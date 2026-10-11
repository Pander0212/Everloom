/**
 * Clip Studio Paint `.clip` drawings as layered pictures for the puppet maker (like a PSD).
 *
 * A `.clip` is a big-endian chunk container (`CSFCHUNK`): `CHNKExta` chunks hold tiled pixel data,
 * and a `CHNKSQLi` chunk is a whole SQLite database describing the canvas and its layers. Each
 * layer's rendered pixels are found through Layer.LayerRenderMipmap → Mipmap → MipmapInfo →
 * Offscreen, whose BlockData names an external chunk of 256×256 zlib tiles (alpha plane, then
 * B,G,R,x). Written from the format notes of clipfile-rs (MIT, Aodaruma) and clip_to_psd (MIT,
 * dobrokot); no code copied.
 */
import { inflateSync } from 'node:zlib';
import Database from 'better-sqlite3-multiple-ciphers';
import sharp from 'sharp';
import { HttpError } from '../../context.js';
import type { LayersIndex } from './build.js';

const LIMITS = { fileBytes: 400 * 1024 * 1024, canvas: 8192, layers: 300, pixels: 64 * 1024 * 1024 };
const BEGIN = Buffer.from('BlockDataBeginChunk', 'utf16le').swap16();
const STATUS = Buffer.from('BlockStatus', 'utf16le').swap16();
const CHECKSUM = Buffer.from('BlockCheckSum', 'utf16le').swap16();

export const isClip = (b: Buffer) => b.length > 24 && b.subarray(0, 8).toString('latin1') === 'CSFCHUNK';

const bad = (why: string) => new HttpError(400, `This .clip file could not be read: ${why}`);

/** The container's chunks: the SQLite database and the external blobs by id. */
function chunks(b: Buffer): { sqlite: Buffer; external: Map<string, Buffer> } {
  if (b.length > LIMITS.fileBytes) throw new HttpError(413, 'That .clip file is larger than 400 MB.');
  let pos = Number(b.readBigUInt64BE(16));
  let sqlite: Buffer | null = null;
  const external = new Map<string, Buffer>();
  while (pos + 16 <= b.length) {
    const tag = b.subarray(pos, pos + 8).toString('latin1');
    const len = Number(b.readBigUInt64BE(pos + 8));
    const body = b.subarray(pos + 16, pos + 16 + len);
    if (body.length !== len) throw bad('it is cut short');
    if (tag === 'CHNKSQLi') sqlite = body;
    else if (tag === 'CHNKExta') {
      const idLen = Number(body.readBigUInt64BE(0));
      const id = body.subarray(8, 8 + idLen).toString('latin1');
      const n = Number(body.readBigUInt64BE(8 + idLen));
      external.set(id, body.subarray(16 + idLen, 16 + idLen + n));
    } else if (tag === 'CHNKFoot') break;
    pos += 16 + len;
  }
  if (!sqlite) throw bad('it has no layer database');
  return { sqlite, external };
}

/** The tiles of an external block-data chunk, in grid order (null where a tile is empty). */
function tiles(d: Buffer): (Buffer | null)[] {
  const out: (Buffer | null)[] = [];
  let i = 0;
  while (i + 8 <= d.length) {
    const n = d.readUInt32BE(i);
    if (n === STATUS.length / 2 && d.subarray(i + 4, i + 4 + STATUS.length).equals(STATUS)) {
      i += 4 + STATUS.length + 12 + out.length * 4;
      continue;
    }
    if (n === CHECKSUM.length / 2 && d.subarray(i + 4, i + 4 + CHECKSUM.length).equals(CHECKSUM)) {
      i += 4 + CHECKSUM.length + 12 + out.length * 4;
      continue;
    }
    if (!d.subarray(i + 8, i + 8 + BEGIN.length).equals(BEGIN) || n < 8 || i + n > d.length) throw bad('a picture tile is damaged');
    const block = d.subarray(i + 8 + BEGIN.length, i + n - (4 + 34));
    const has = block.readUInt32BE(16);
    out.push(has ? block.subarray(28) : null);
    i += n;
  }
  return out;
}

interface Attr { width: number; height: number; gridW: number; gridH: number; channels: [number, number]; fillWhite: boolean }

/** Offscreen.Attribute: the bitmap size, its tile grid and the pixel packing. */
function attribute(a: Buffer): Attr {
  let p = 16;
  const str = () => { const n = a.readUInt32BE(p); p += 4; const s = a.subarray(p, p + n * 2); p += n * 2; return Buffer.from(s).swap16().toString('utf16le'); };
  const int = () => { const v = a.readUInt32BE(p); p += 4; return v; };
  if (str() !== 'Parameter') throw bad('a layer has an unknown pixel layout');
  const width = int(), height = int(), gridW = int(), gridH = int();
  const packing = Array.from({ length: 16 }, int);
  if (str() !== 'InitColor') throw bad('a layer has an unknown pixel layout');
  int();
  const fillWhite = int() !== 0;
  return { width, height, gridW, gridH, channels: [packing[1]!, packing[2]!], fillWhite };
}

/** RGBA pixels of a layer's bitmap (null for layouts not used by drawing layers). */
function decode(attr: Attr, list: (Buffer | null)[]): Uint8Array | null {
  const { width: W, height: H, gridW, gridH } = attr;
  if (attr.channels[0] !== 1 || attr.channels[1] !== 4) return null; // masks and 1-bit layers
  if (W * H > LIMITS.pixels || gridW * gridH !== list.length) throw bad('a layer is larger than expected');
  const rgba = new Uint8Array(W * H * 4);
  if (attr.fillWhite) rgba.fill(255);
  const K = 256 * 256;
  for (let ty = 0; ty < gridH; ty++) for (let tx = 0; tx < gridW; tx++) {
    const t = list[ty * gridW + tx];
    if (!t) continue;
    const px = inflateSync(t, { maxOutputLength: 5 * K });
    if (px.length !== 5 * K) throw bad('a picture tile has the wrong size');
    for (let y = 0; y < 256; y++) {
      const cy = ty * 256 + y;
      if (cy >= H) break;
      for (let x = 0; x < 256; x++) {
        const cx = tx * 256 + x;
        if (cx >= W) break;
        const s = y * 256 + x, o = (cy * W + cx) * 4;
        rgba[o] = px[K + s * 4 + 2]!; rgba[o + 1] = px[K + s * 4 + 1]!; rgba[o + 2] = px[K + s * 4]!; rgba[o + 3] = px[s]!;
      }
    }
  }
  return rgba;
}

/** A layer mask (one 8-bit channel per pixel; 255 shows the layer). */
function decodeMask(attr: Attr, list: (Buffer | null)[]): Uint8Array | null {
  const { width: W, height: H, gridW, gridH } = attr;
  if (attr.channels[0] + attr.channels[1] !== 1 || W * H > LIMITS.pixels || gridW * gridH !== list.length) return null;
  const out = new Uint8Array(W * H).fill(attr.fillWhite ? 255 : 0);
  const K = 256 * 256;
  for (let ty = 0; ty < gridH; ty++) for (let tx = 0; tx < gridW; tx++) {
    const t = list[ty * gridW + tx];
    if (!t) continue;
    const px = inflateSync(t, { maxOutputLength: K });
    if (px.length !== K) throw bad('a mask tile has the wrong size');
    for (let y = 0; y < 256 && ty * 256 + y < H; y++) for (let x = 0; x < 256 && tx * 256 + x < W; x++) out[(ty * 256 + y) * W + tx * 256 + x] = px[y * 256 + x]!;
  }
  return out;
}

type Row = Record<string, unknown>;
const KIND = { paper: 1584, correction: 4098 };

/**
 * The drawing's visible raster and vector layers (bottom first, folder names joined with "/"), as
 * a layering result: layers.json and one PNG per layer, cropped to its pixels.
 */
export async function clipToLayers(b: Buffer): Promise<{ index: LayersIndex; files: Map<string, Buffer>; skipped: string[] }> {
  const { sqlite, external } = chunks(b);
  const db = new Database(sqlite, { readonly: true });
  try {
    const cols = (t: string) => new Set((db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name));
    const pick = (t: string, want: string[]) => { const have = cols(t); return want.filter((c) => have.has(c)); };
    const canvas = db.prepare('SELECT CanvasWidth AS w, CanvasHeight AS h FROM Canvas').get() as { w: number; h: number } | undefined;
    if (!canvas) throw bad('it has no canvas');
    const W = Math.round(canvas.w), H = Math.round(canvas.h);
    if (!(W > 0 && H > 0 && W <= LIMITS.canvas && H <= LIMITS.canvas)) throw new HttpError(400, `The drawing is ${W}×${H} pixels; up to ${LIMITS.canvas} on a side is supported.`);
    const lc = pick('Layer', ['MainId', 'LayerName', 'LayerType', 'LayerVisibility', 'LayerOpacity', 'LayerFolder', 'LayerFirstChildIndex', 'LayerNextIndex', 'LayerOffsetX', 'LayerOffsetY', 'LayerRenderOffscrOffsetX', 'LayerRenderOffscrOffsetY', 'LayerRenderMipmap', 'LayerLayerMaskMipmap', 'LayerMaskOffsetX', 'LayerMaskOffsetY', 'LayerMaskOffscrOffsetX', 'LayerMaskOffscrOffsetY']);
    const layers = new Map((db.prepare(`SELECT ${lc.join(',')} FROM Layer`).all() as Row[]).map((r) => [Number(r.MainId), r]));
    const mipmap = new Map((db.prepare('SELECT MainId, BaseMipmapInfo FROM Mipmap').all() as Row[]).map((r) => [Number(r.MainId), Number(r.BaseMipmapInfo)]));
    const info = new Map((db.prepare('SELECT MainId, Offscreen FROM MipmapInfo').all() as Row[]).map((r) => [Number(r.MainId), Number(r.Offscreen)]));
    const offscreen = new Map((db.prepare('SELECT MainId, BlockData, Attribute FROM Offscreen').all() as Row[]).map((r) => [Number(r.MainId), r]));
    const root = (db.prepare(`SELECT ${cols('Canvas').has('CanvasRootFolder') ? 'CanvasRootFolder' : 'NULL'} AS r FROM Canvas`).get() as { r: number | null }).r ?? [...layers.values()].find((l) => Number(l.LayerType) === 256)?.MainId;
    // Bottom-first walk of the layer tree, skipping hidden folders and their contents.
    const order: { row: Row; path: string; folders: Row[] }[] = [];
    const seen = new Set<number>();
    const walk = (first: number, path: string, folders: Row[]) => {
      for (let id = first; id && !seen.has(id); id = Number(layers.get(id)?.LayerNextIndex ?? 0)) {
        seen.add(id);
        const l = layers.get(id);
        if (!l) break;
        const visible = (Number(l.LayerVisibility ?? 1) & 1) === 1;
        const name = String(l.LayerName ?? '').trim() || `Layer ${id}`;
        if (Number(l.LayerFolder ?? 0)) { if (visible) walk(Number(l.LayerFirstChildIndex ?? 0), path ? `${path}/${name}` : name, [...folders, l]); }
        else if (visible) order.push({ row: l, path: path ? `${path}/${name}` : name, folders });
      }
    };
    walk(Number(layers.get(Number(root))?.LayerFirstChildIndex ?? 0), '', []);
    const files = new Map<string, Buffer>();
    const out: LayersIndex['layers'] = [];
    const skipped: string[] = [];
    for (const { row, path, folders } of order) {
      const type = Number(row.LayerType);
      if (type === KIND.paper) continue;
      if (type === KIND.correction) { skipped.push(`${path} (a correction layer)`); continue; }
      if (out.length >= LIMITS.layers) { skipped.push(`${path} (over ${LIMITS.layers} layers)`); continue; }
      const bitmap = (mip: unknown) => {
        const off = offscreen.get(info.get(mipmap.get(Number(mip)) ?? -1) ?? -1);
        const blob = off ? external.get(typeof off.BlockData === 'string' ? off.BlockData : Buffer.from(off.BlockData as Uint8Array).toString('latin1')) : undefined;
        return off && blob ? { attr: attribute(Buffer.from(off.Attribute as Uint8Array)), tiles: tiles(blob) } : null;
      };
      const pixels = bitmap(row.LayerRenderMipmap);
      if (!pixels) continue; // nothing drawn on it
      const { attr } = pixels;
      const rgba = decode(attr, pixels.tiles);
      if (!rgba) { skipped.push(`${path} (a pixel layout Everloom doesn't read)`); continue; }
      const ox = Number(row.LayerOffsetX ?? 0) + Number(row.LayerRenderOffscrOffsetX ?? 0), oy = Number(row.LayerOffsetY ?? 0) + Number(row.LayerRenderOffscrOffsetY ?? 0);
      // Enabled masks (visibility bit 2) of the layer and of the folders it is in cut it, as Clip Studio shows it.
      for (const owner of [row, ...folders]) {
        const m = Number(owner.LayerVisibility ?? 1) & 2 && Number(owner.LayerLayerMaskMipmap) ? bitmap(owner.LayerLayerMaskMipmap) : null;
        const mask = m ? decodeMask(m.attr, m.tiles) : null;
        if (!m || !mask) continue;
        const mx = Number(owner.LayerMaskOffsetX ?? 0) + Number(owner.LayerOffsetX ?? 0) + Number(owner.LayerMaskOffscrOffsetX ?? 0), my = Number(owner.LayerMaskOffsetY ?? 0) + Number(owner.LayerOffsetY ?? 0) + Number(owner.LayerMaskOffscrOffsetY ?? 0);
        const outside = m.attr.fillWhite ? 255 : 0;
        for (let y = 0; y < attr.height; y++) for (let x = 0; x < attr.width; x++) {
          const u = x + ox - mx, v = y + oy - my;
          const k = u >= 0 && v >= 0 && u < m.attr.width && v < m.attr.height ? mask[v * m.attr.width + u]! : outside;
          if (k < 255) rgba[(y * attr.width + x) * 4 + 3] = Math.round((rgba[(y * attr.width + x) * 4 + 3]! * k) / 255);
        }
      }
      // Folder opacity multiplies in too.
      const opacityOf = (r: Row) => Math.max(0, Math.min(1, Number(r.LayerOpacity ?? 256) / 256));
      const opacity = [row, ...folders].reduce((k, r) => k * opacityOf(r), 1);
      if (opacity < 1) for (let i = 3; i < rgba.length; i += 4) rgba[i] = Math.round(rgba[i]! * opacity);
      // Crop to the drawn pixels.
      let x0 = attr.width, y0 = attr.height, x1 = -1, y1 = -1;
      for (let y = 0; y < attr.height; y++) for (let x = 0; x < attr.width; x++) if (rgba[(y * attr.width + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) continue;
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      const png = await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width: attr.width, height: attr.height, channels: 4 } }).extract({ left: x0, top: y0, width: w, height: h }).png().toBuffer();
      const file = `layers/${String(out.length).padStart(2, '0')}.png`;
      files.set(file, png);
      out.push({ name: path, file, left: x0 + ox, top: y0 + oy, width: w, height: h });
    }
    if (!out.length) throw new HttpError(400, 'The drawing has no visible layers with pixels on them.');
    return { index: { width: W, height: H, layers: out }, files, skipped };
  } finally {
    db.close();
  }
}

/** The drawing's own flattened preview (a PNG Clip Studio stores in the file), when it has one. */
export function clipPreview(b: Buffer): Buffer | null {
  const db = new Database(chunks(b).sqlite, { readonly: true });
  try {
    const r = db.prepare('SELECT ImageData FROM CanvasPreview LIMIT 1').get() as { ImageData?: Uint8Array } | undefined;
    return r?.ImageData ? Buffer.from(r.ImageData) : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}
