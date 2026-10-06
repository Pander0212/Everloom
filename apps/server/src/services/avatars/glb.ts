/**
 * Minimal GLB reading and writing, without a full glTF library: enough to inspect any model
 * (including VRM, whose extensions a general library would drop) and to swap texture bytes while
 * keeping every other part of the file exactly as it was.
 */
export interface GltfJson {
  asset?: { version?: string; generator?: string };
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  extensions?: Record<string, any>;
  nodes?: Array<{ name?: string; children?: number[]; mesh?: number; skin?: number; extensions?: Record<string, any>; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }>;
  meshes?: Array<{ name?: string; primitives: Array<{ attributes: Record<string, number>; indices?: number; material?: number; targets?: Array<Record<string, number>>; mode?: number; extensions?: Record<string, any> }>; extras?: { targetNames?: string[] } }>;
  skins?: Array<{ joints: number[]; skeleton?: number; inverseBindMatrices?: number }>;
  materials?: Array<{ name?: string; alphaMode?: string; extensions?: Record<string, any> }>;
  textures?: Array<{ source?: number; extensions?: Record<string, any> }>;
  images?: Array<{ bufferView?: number; mimeType?: string; uri?: string; name?: string }>;
  accessors?: Array<{ bufferView?: number; count: number; componentType: number; type: string; byteOffset?: number }>;
  bufferViews?: Array<{ buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; target?: number }>;
  buffers?: Array<{ byteLength: number; uri?: string }>;
  animations?: Array<{ name?: string; channels: unknown[]; samplers: unknown[] }>;
  scenes?: Array<{ nodes?: number[] }>;
  scene?: number;
  [k: string]: unknown;
}

export interface Glb {
  json: GltfJson;
  bin: Buffer;
}

const MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

export function isGlb(b: Uint8Array): boolean {
  return b.length >= 20 && Buffer.from(b.buffer, b.byteOffset, 4).readUInt32LE(0) === MAGIC;
}

/** Parses a GLB (version 2). Throws a readable message on anything malformed. */
export function parseGlb(bytes: Buffer): Glb {
  if (!isGlb(bytes)) throw new Error('Not a GLB file');
  if (bytes.readUInt32LE(4) !== 2) throw new Error('Only glTF 2.0 files are supported');
  const total = bytes.readUInt32LE(8);
  if (total > bytes.length) throw new Error('The file is cut short');
  let off = 12;
  let json: GltfJson | null = null;
  let bin: Buffer = Buffer.alloc(0);
  while (off + 8 <= total) {
    const len = bytes.readUInt32LE(off);
    const type = bytes.readUInt32LE(off + 4);
    const start = off + 8;
    if (start + len > total) throw new Error('A chunk runs past the end of the file');
    if (type === JSON_CHUNK && !json) {
      try {
        json = JSON.parse(bytes.subarray(start, start + len).toString('utf8').replace(/[\u0000\s]+$/, ''));
      } catch {
        throw new Error('The model description could not be read');
      }
    } else if (type === BIN_CHUNK && !bin.length) bin = bytes.subarray(start, start + len);
    off = start + len;
  }
  if (!json || typeof json !== 'object') throw new Error('The model has no description chunk');
  return { json, bin };
}

const pad4 = (n: number) => (n + 3) & ~3;

export function writeGlb({ json, bin }: Glb): Buffer {
  if (json.buffers?.[0]) json.buffers[0].byteLength = bin.length;
  const js = Buffer.from(JSON.stringify(json), 'utf8');
  const jsLen = pad4(js.length);
  const binLen = pad4(bin.length);
  const out = Buffer.alloc(12 + 8 + jsLen + (bin.length ? 8 + binLen : 0), 0);
  out.writeUInt32LE(MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jsLen, 12);
  out.writeUInt32LE(JSON_CHUNK, 16);
  js.copy(out, 20);
  out.fill(0x20, 20 + js.length, 20 + jsLen);
  if (bin.length) {
    const o = 20 + jsLen;
    out.writeUInt32LE(binLen, o);
    out.writeUInt32LE(BIN_CHUNK, o + 4);
    bin.copy(out, o + 8);
  }
  return out;
}

/** The bytes of one buffer view (from the GLB's binary chunk). */
export function viewBytes(g: Glb, index: number): Buffer {
  const v = g.json.bufferViews?.[index];
  if (!v || v.buffer !== 0) throw new Error('Unsupported buffer view');
  const s = v.byteOffset ?? 0;
  if (s + v.byteLength > g.bin.length) throw new Error('A buffer view runs past the data');
  return g.bin.subarray(s, s + v.byteLength);
}

/**
 * Rebuilds the binary chunk with some buffer views replaced (new image bytes), moving the others
 * to their new offsets. Everything in the description other than offsets and lengths is untouched.
 */
export function replaceViews(g: Glb, replace: Map<number, Buffer>): Glb {
  const views = g.json.bufferViews ?? [];
  const parts: Buffer[] = [];
  let off = 0;
  const json = structuredClone(g.json);
  views.forEach((v, i) => {
    const data = replace.get(i) ?? viewBytes(g, i);
    const aligned = pad4(off);
    if (aligned > off) parts.push(Buffer.alloc(aligned - off));
    off = aligned;
    json.bufferViews![i] = { ...v, byteOffset: off, byteLength: data.length };
    parts.push(data);
    off += data.length;
  });
  const bin = Buffer.concat(parts);
  if (json.buffers?.[0]) json.buffers[0].byteLength = bin.length;
  return { json, bin };
}
