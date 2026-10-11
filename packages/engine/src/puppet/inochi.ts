/**
 * Inochi2D interchange (.inp / .inx, format 0.8), for polishing a puppet by hand in Inochi Creator
 * and bringing it back. Written from the Inochi2D SDK's own serializer (BSD-2-Clause; see
 * CREDITS.md): `TRNSRTS\0`, a big-endian length and the JSON payload, `TEX_SECT` with the texture
 * pages (PNG), and an optional `EXT_SECT` of named payloads.
 *
 * What goes across (docs/puppets.md › Inochi2D):
 *   - parts → Part nodes with their meshes, UVs into the shared texture pages, draw order, masks,
 *     blend mode and opacity;
 *   - each parameter → a one-axis Inochi2D parameter whose deform and opacity bindings are this
 *     puppet's own result sampled at each key with the other parameters at rest (so a head turn is
 *     baked into vertex offsets: Inochi2D has no warp deformers);
 *   - the full Everloom puppet, in the `everloom.puppet` extension payload.
 * Coming back: with that payload, the Everloom rig is restored exactly and whatever was changed in
 * Creator (moved vertices at rest, edited keyforms, new opacity) is added as a correction layer;
 * without it (a puppet made in Creator), parts, deform and opacity bindings are imported as they
 * are. Physics, automation and animations are not exchanged.
 */
import { PUPPET_FORMAT, PUPPET_VERSION, parsePuppet, type PuppetBinding, type PuppetModel, type PuppetPart } from './format.js';
import { PuppetRig } from './deform.js';

const MAGIC = 'TRNSRTS\0', TEX = 'TEX_SECT', EXT = 'EXT_SECT';
const NO_TEXTURE = 4294967295;
const EXT_KEY = 'everloom.puppet';

const enc = new TextEncoder(), dec = new TextDecoder();

export interface InochiFile { json: InochiPuppet; textures: Array<{ encoding: number; data: Uint8Array }>; ext: Record<string, Uint8Array> }
export interface InochiNode { uuid: number; name: string; type: string; enabled?: boolean; zsort?: number; transform?: { trans?: number[]; rot?: number[]; scale?: number[] }; children?: InochiNode[]; mesh?: { verts: number[]; uvs?: number[]; indices: number[]; origin?: number[] }; textures?: number[]; opacity?: number; blend_mode?: string; masks?: Array<{ source: number; mode: string }>; [k: string]: unknown }
export interface InochiBinding { node: number; param_name: string; values: unknown[][]; isSet: boolean[][]; interpolate_mode?: string }
export interface InochiParam { uuid: number; name: string; is_vec2: boolean; min: number[]; max: number[]; defaults: number[]; axis_points: number[][]; merge_mode?: string; bindings: InochiBinding[] }
export interface InochiPuppet { meta: Record<string, unknown>; physics?: Record<string, unknown>; nodes: InochiNode; param: InochiParam[]; automation?: unknown[]; animations?: Record<string, unknown> }

/** Reads an .inp/.inx container. */
export function readInochi(bytes: Uint8Array): InochiFile {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const tag = (s: string) => { const got = dec.decode(bytes.subarray(o, o + 8)); if (got !== s) throw new Error(`Not an Inochi2D file (expected ${s.replace('\0', '')})`); o += 8; };
  const u32 = () => { if (o + 4 > bytes.length) throw new Error('The Inochi2D file is cut short'); const v = dv.getUint32(o, false); o += 4; return v; };
  const take = (n: number) => { if (o + n > bytes.length) throw new Error('The Inochi2D file is cut short'); const s = bytes.subarray(o, o + n); o += n; return s; };
  tag(MAGIC);
  const json = JSON.parse(dec.decode(take(u32()))) as InochiPuppet;
  tag(TEX);
  const n = u32();
  if (n > 4096) throw new Error('Too many textures in the Inochi2D file');
  const textures: InochiFile['textures'] = [];
  for (let i = 0; i < n; i++) { const len = u32(); const encoding = bytes[o]!; o++; textures.push({ encoding, data: take(len) }); }
  const ext: Record<string, Uint8Array> = {};
  if (o + 8 <= bytes.length && dec.decode(bytes.subarray(o, o + 8)) === EXT) {
    o += 8;
    const count = u32();
    for (let i = 0; i < count; i++) { const name = dec.decode(take(u32())); ext[name] = take(u32()); }
  }
  return { json, textures, ext };
}

/** Writes an .inp/.inx container (textures are PNG, encoding 0). */
export function writeInochi(f: InochiFile): Uint8Array {
  const chunks: Uint8Array[] = [];
  const u32 = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, false); chunks.push(b); };
  const json = enc.encode(JSON.stringify(f.json));
  chunks.push(enc.encode(MAGIC)); u32(json.length); chunks.push(json);
  chunks.push(enc.encode(TEX)); u32(f.textures.length);
  for (const t of f.textures) { u32(t.data.length); chunks.push(Uint8Array.of(t.encoding)); chunks.push(t.data); }
  const names = Object.keys(f.ext);
  if (names.length) {
    chunks.push(enc.encode(EXT)); u32(names.length);
    for (const name of names) { const nb = enc.encode(name); u32(nb.length); chunks.push(nb); u32(f.ext[name]!.length); chunks.push(f.ext[name]!); }
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const BLEND_OUT: Record<string, string> = { normal: 'Normal', multiply: 'Multiply', screen: 'Screen' };
const BLEND_IN: Record<string, PuppetPart['blend']> = { Normal: 'normal', Multiply: 'multiply', Screen: 'screen' };

/** A scalar keyform's value at the given parameter values (linear, bilinear for two). */
function scalarAt(b: PuppetBinding, at: (id: string) => number): number {
  const seg = (keys: number[], v: number): [number, number, number] => {
    if (keys.length === 1 || v <= keys[0]!) return [0, 0, 0];
    const last = keys.length - 1;
    if (v >= keys[last]!) return [last, last, 0];
    let j = 0;
    while (v > keys[j + 1]!) j++;
    return [j, j + 1, (v - keys[j]!) / (keys[j + 1]! - keys[j]!)];
  };
  const val = (i: number) => { const v = b.values[i]!; return typeof v === 'number' ? v : v[0] ?? 0; };
  const [a0, a1, t] = seg(b.keys[0]!, at(b.params[0]!));
  if (b.params.length === 1) return val(a0) * (1 - t) + val(a1) * t;
  const n0 = b.keys[0]!.length;
  const [c0, c1, u] = seg(b.keys[1]!, at(b.params[1]!));
  return val(a0 + c0 * n0) * (1 - t) * (1 - u) + val(a1 + c0 * n0) * t * (1 - u) + val(a0 + c1 * n0) * (1 - t) * u + val(a1 + c1 * n0) * t * u;
}

/** The key values each parameter is sampled at (its keyforms' keys, plus its range and rest). */
function sampleKeys(m: PuppetModel, id: string): number[] {
  const p = m.params.find((x) => x.id === id)!;
  const keys = new Set([p.min, p.default, p.max]);
  for (const b of m.bindings) b.params.forEach((pid, axis) => { if (pid === id) for (const k of b.keys[axis]!) keys.add(k); });
  return [...keys].filter((k) => k >= p.min && k <= p.max).sort((a, b) => a - b);
}

/**
 * The puppet as an Inochi2D file. `pages` are the PNG bytes of model.textures, in order.
 * `inx` adds nothing but the name; both carry the Everloom payload.
 */
export function exportInochi(m: PuppetModel, pages: Uint8Array[], meta: { artist?: string; copyright?: string; license?: string } = {}): Uint8Array {
  const cx = m.canvas.width / 2, cy = m.canvas.height / 2;
  const uuid = new Map<string, number>();
  let next = 1000;
  const idOf = (key: string) => { let u = uuid.get(key); if (u === undefined) { u = next++; uuid.set(key, u); } return u; };
  const rig = new PuppetRig(m);
  rig.evaluate();
  const rest = rig.frames.map((f) => Float32Array.from(f.positions));
  const children: InochiNode[] = m.parts.map((p, i) => ({
    uuid: idOf(`part:${p.id}`), name: p.name ?? p.id, type: 'Part', enabled: !p.maskOnly, zsort: -p.z / 100,
    transform: { trans: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1] }, lockToRoot: false,
    mesh: { verts: Array.from(rest[i]!, (v, k) => (k % 2 ? v - cy : v - cx)), uvs: p.mesh.uvs, indices: p.mesh.indices, origin: [0, 0] },
    textures: [p.texture, NO_TEXTURE, NO_TEXTURE], blend_mode: BLEND_OUT[p.blend] ?? 'Normal', tint: [1, 1, 1], screenTint: [0, 0, 0], emissionStrength: 1,
    ...(p.masks.length ? { masks: p.masks.map((k) => ({ source: idOf(`part:${k}`), mode: 'Mask' })) } : {}),
    mask_threshold: 0.5, opacity: p.opacity,
  }));
  const params: InochiParam[] = m.params.filter((p) => m.bindings.some((b) => b.params.includes(p.id))).map((p) => {
    const keys = sampleKeys(m, p.id);
    const span = p.max - p.min || 1;
    const deform = new Map<number, number[][][]>(), opacity = new Map<number, number[]>();
    for (const k of keys) {
      rig.reset();
      rig.set(p.id, k);
      rig.evaluate();
      rig.frames.forEach((f, i) => {
        const d: number[][] = [];
        let moved = false;
        for (let v = 0; v < f.positions.length; v += 2) { const dx = f.positions[v]! - rest[i]![v]!, dy = f.positions[v + 1]! - rest[i]![v + 1]!; if (Math.abs(dx) > 1e-3 || Math.abs(dy) > 1e-3) moved = true; d.push([dx, dy]); }
        if (moved || deform.has(i)) { if (!deform.has(i)) deform.set(i, keys.map(() => [])); deform.get(i)![keys.indexOf(k)] = d; }
      });
    }
    // Opacity multiplies across parameters in both formats: each of our keyforms on this parameter
    // goes across as it is; a two-parameter table is cut along this axis at the other's rest value.
    const def = new Map(m.params.map((x) => [x.id, x.default]));
    m.parts.forEach((part, i) => {
      const own = m.bindings.filter((b) => b.target === part.id && b.prop === 'opacity' && b.params.includes(p.id));
      if (!own.length) return;
      opacity.set(i, keys.map((k) => own.reduce((acc, b) => {
        const at = (id: string) => (id === p.id ? k : def.get(id) ?? 0);
        let v = scalarAt(b, at);
        if (b.params.length === 2 && b.params[1] === p.id) { const r = scalarAt(b, (id) => def.get(id) ?? 0); if (r > 1e-6) v /= r; }
        return acc * v;
      }, 1)));
    });
    // Keys sampled before a part first moved hold zero offsets.
    for (const [i, vals] of deform) for (let ki = 0; ki < keys.length; ki++) if (!vals[ki]!.length) vals[ki] = Array.from({ length: rest[i]!.length / 2 }, () => [0, 0]);
    const bindings: InochiBinding[] = [
      ...[...deform].map(([i, vals]) => ({ node: children[i]!.uuid, param_name: 'deform', values: vals.map((v) => [v]), isSet: keys.map(() => [true]), interpolate_mode: 'Linear' })),
      ...[...opacity].map(([i, vals]) => ({ node: children[i]!.uuid, param_name: 'opacity', values: vals.map((v) => [v]), isSet: keys.map(() => [true]), interpolate_mode: 'Linear' })),
    ];
    return { uuid: idOf(`param:${p.id}`), name: p.id, is_vec2: false, min: [p.min, 0], max: [p.max, 0], defaults: [p.default, 0], axis_points: [keys.map((k) => (k - p.min) / span), [0]], merge_mode: 'Additive', bindings };
  });
  rig.reset();
  const json: InochiPuppet = {
    meta: { name: m.name, version: '1.0-alpha', rigger: 'Everloom', artist: meta.artist ?? '', copyright: meta.copyright ?? '', licenseURL: meta.license ?? '', contact: '', reference: 'everloom-puppet', thumbnailId: NO_TEXTURE, preservePixels: false },
    physics: { pixelsPerMeter: 1000, gravity: 9.8 },
    nodes: { uuid: idOf('root'), name: 'Root', type: 'Node', enabled: true, zsort: 0, transform: { trans: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1] }, lockToRoot: false, children },
    param: params, automation: [], animations: {},
  };
  // What Creator will show at rest, to tell later edits from our own baked keyforms.
  const baked = { uuids: Object.fromEntries(uuid), params: params.map((p) => ({ uuid: p.uuid, bindings: p.bindings })), rest: children.map((c) => c.mesh!.verts), opacity: children.map((c) => c.opacity!), zsort: children.map((c) => c.zsort!) };
  return writeInochi({ json, textures: pages.map((data) => ({ encoding: 0, data })), ext: { [EXT_KEY]: enc.encode(JSON.stringify({ model: m, baked })) } });
}

/** Reads an Inochi2D file back: the Everloom puppet with Creator's changes on top, or a plain import. */
export function importInochi(bytes: Uint8Array, id = 'imported'): { model: PuppetModel; pages: Uint8Array[]; restored: boolean } {
  const f = readInochi(bytes);
  for (const t of f.textures) if (t.encoding !== 0) throw new Error('Only PNG textures can be imported (re-save the textures as PNG in Inochi Creator).');
  const pages = f.textures.map((t) => t.data);
  const parts: InochiNode[] = [];
  const walk = (n: InochiNode, ox: number, oy: number) => {
    const t = n.transform?.trans ?? [0, 0, 0];
    const x = ox + (t[0] ?? 0), y = oy + (t[1] ?? 0);
    if (n.type === 'Part' && n.mesh) parts.push({ ...n, mesh: { ...n.mesh, verts: n.mesh.verts.map((v, k) => v + (k % 2 ? y : x)) } });
    for (const c of n.children ?? []) walk(c, x, y);
  };
  walk(f.json.nodes, 0, 0);
  const payload = f.ext[EXT_KEY] ? JSON.parse(dec.decode(f.ext[EXT_KEY]!)) as { model: PuppetModel; baked: Baked } : null;
  if (payload) return { model: restore(payload, f.json, parts), pages, restored: true };
  return { model: plainImport(f.json, parts, id), pages, restored: false };
}

interface Baked { uuids: Record<string, number>; params: Array<{ uuid: number; bindings: InochiBinding[] }>; rest: number[][]; opacity: number[]; zsort: number[] }

/** Our puppet, plus what changed in Creator: moved rest vertices and edited keyforms, as extra bindings. */
function restore(payload: { model: PuppetModel; baked: Baked }, json: InochiPuppet, parts: InochiNode[]): PuppetModel {
  const m = structuredClone(payload.model) as PuppetModel;
  const byUuid = new Map(parts.map((p) => [p.uuid, p]));
  const extra: PuppetBinding[] = [];
  m.parts.forEach((part, i) => {
    const node = byUuid.get(payload.baked.uuids[`part:${part.id}`]!);
    if (!node?.mesh) return;
    const before = payload.baked.rest[i]!;
    if (node.mesh.verts.length !== before.length) return; // remeshed in Creator: keep ours (documented)
    // Rest vertices moved in Creator: a correction applied at every pose.
    let moved = false;
    // Both are centred on the canvas (the file's way); the difference is what Creator moved.
    for (let k = 0; k < before.length; k++) if (Math.abs(node.mesh.verts[k]! - before[k]!) > 0.01) moved = true;
    if (moved) part.mesh.positions = part.mesh.positions.map((v, k) => v + node.mesh!.verts[k]! - before[k]!);
    if (typeof node.opacity === 'number' && Math.abs(node.opacity - payload.baked.opacity[i]!) > 1e-6) part.opacity = Math.max(0, Math.min(1, node.opacity));
    if (typeof node.zsort === 'number' && Math.abs(node.zsort - payload.baked.zsort[i]!) > 1e-9) part.z = -node.zsort * 100;
  });
  for (const p of json.param ?? []) {
    const ours = payload.baked.params.find((x) => x.uuid === p.uuid);
    const param = m.params.find((x) => x.id === p.name);
    if (!param) continue;
    const span = param.max - param.min || 1;
    const keys = (p.axis_points?.[0] ?? []).map((a) => param.min + a * span);
    for (const b of p.bindings ?? []) {
      const partIndex = m.parts.findIndex((x) => payload.baked.uuids[`part:${x.id}`] === b.node);
      if (partIndex < 0 || b.param_name !== 'deform') continue;
      const before = ours?.bindings.find((x) => x.node === b.node && x.param_name === 'deform');
      const n = m.parts[partIndex]!.mesh.positions.length;
      const values = keys.map((_, ki) => {
        const now = (b.values[ki]?.[0] ?? []) as number[][];
        const was = (before?.values[ki]?.[0] ?? []) as number[][];
        const out: number[] = [];
        for (let v = 0; v < n / 2; v++) out.push((now[v]?.[0] ?? 0) - (was[v]?.[0] ?? 0), (now[v]?.[1] ?? 0) - (was[v]?.[1] ?? 0));
        return out;
      });
      if (keys.length && values.some((v) => v.some((x) => Math.abs(x) > 0.01))) extra.push({ target: m.parts[partIndex]!.id, prop: 'verts', params: [param.id], keys: [keys], values });
    }
  }
  m.bindings.push(...extra);
  return parsePuppet(m);
}

/** A puppet made elsewhere: parts in their places, deform and opacity bindings per parameter. */
function plainImport(json: InochiPuppet, parts: InochiNode[], id: string): PuppetModel {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of parts) for (let k = 0; k < p.mesh!.verts.length; k += 2) { x0 = Math.min(x0, p.mesh!.verts[k]!); x1 = Math.max(x1, p.mesh!.verts[k]!); y0 = Math.min(y0, p.mesh!.verts[k + 1]!); y1 = Math.max(y1, p.mesh!.verts[k + 1]!); }
  if (!parts.length) throw new Error('The Inochi2D file has no parts.');
  const ox = -x0, oy = -y0;
  const partId = new Map<number, string>();
  const out: PuppetPart[] = parts.map((p, i) => {
    const pid = `part${i}`;
    partId.set(p.uuid, pid);
    return { id: pid, name: String(p.name).slice(0, 80), slot: 'imported', texture: Math.max(0, p.textures?.[0] ?? 0), mesh: { positions: p.mesh!.verts.map((v, k) => v + (k % 2 ? oy : ox)), uvs: p.mesh!.uvs ?? [], indices: p.mesh!.indices }, parent: null, z: -(p.zsort ?? 0) * 100, opacity: typeof p.opacity === 'number' ? p.opacity : 1, blend: BLEND_IN[p.blend_mode ?? 'Normal'] ?? 'normal', masks: [] };
  });
  parts.forEach((p, i) => { out[i]!.masks = (p.masks ?? []).map((mk) => partId.get(mk.source)).filter((x): x is string => !!x); });
  const params: PuppetModel['params'] = [];
  const bindings: PuppetBinding[] = [];
  for (const p of json.param ?? []) {
    const pid = String(p.name).replace(/[^A-Za-z0-9_.:-]+/g, '_').slice(0, 80) || `param${params.length}`;
    const min = p.min?.[0] ?? 0, max = p.max?.[0] ?? 1;
    params.push({ id: pid, min, max, default: Math.min(max, Math.max(min, p.defaults?.[0] ?? min)) });
    const keys = (p.axis_points?.[0] ?? [0, 1]).map((a) => min + a * (max - min));
    for (const b of p.bindings ?? []) {
      const target = partId.get(b.node);
      if (!target || p.is_vec2) continue;
      if (b.param_name === 'deform') bindings.push({ target, prop: 'verts', params: [pid], keys: [keys], values: keys.map((_, ki) => ((b.values[ki]?.[0] ?? []) as number[][]).flatMap((d) => [d[0] ?? 0, d[1] ?? 0])) });
      else if (b.param_name === 'opacity') bindings.push({ target, prop: 'opacity', params: [pid], keys: [keys], values: keys.map((_, ki) => Number(b.values[ki]?.[0] ?? 1)) });
    }
  }
  const name = typeof json.meta?.name === 'string' && json.meta.name ? json.meta.name : 'Imported puppet';
  return parsePuppet({ format: PUPPET_FORMAT, version: PUPPET_VERSION, id, name, template: 'inochi2d', rating: 'all-ages', canvas: { width: Math.ceil(x1 - x0) || 1, height: Math.ceil(y1 - y0) || 1 }, anchors: {}, textures: Array.from({ length: Math.max(1, ...out.map((p) => p.texture + 1)) }, (_, i) => `page${i}.png`), params, deformers: [], parts: out, bindings, physics: [], expressions: {}, motions: {}, colors: {} });
}
