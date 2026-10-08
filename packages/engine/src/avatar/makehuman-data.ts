/** Independently implemented readers for MakeHuman's CC0 data formats; no Blender API. */
export interface HumanObj {
  vertices: Float32Array;
  uv: Array<[number, number]>;
  faces: Array<{ vertices: number[]; uv: number[]; group: string }>;
  groups: Map<string, Set<number>>;
}
export interface Target { indices: Uint32Array; offsets: Float32Array }
export function resolveHumanPath(paths: string[], parent: string, relative: string): string {
  if (/^[\/\\]|^[a-z]+:/i.test(relative)) throw new Error(`Asset companions must use local relative paths: ${relative}`);
  const parts = parent.replace(/\\/g, '/').split('/').slice(0, -1);
  for (const part of relative.replace(/\\/g, '/').split('/')) { if (part === '..') { if (!parts.length) throw new Error('Asset companion path leaves its pack.'); parts.pop(); } else if (part && part !== '.') parts.push(part); }
  const path = parts.join('/');
  if (paths.includes(path)) return path;
  const exact = paths.filter(candidate => candidate.toLowerCase() === path.toLowerCase());
  if (exact.length === 1) return exact[0];
  const basename = relative.replace(/\\/g, '/').split('/').pop()!.toLowerCase();
  const matches = paths.filter(candidate => candidate.split('/').pop()!.toLowerCase() === basename);
  if (matches.length === 1) return matches[0];
  throw new Error(`MakeHuman companion file is missing or ambiguous: ${relative}`);
}
export type HumanRig = Record<string, { head: { strategy: string; cube_name?: string; vertex_indices?: number[]; default_position: number[] }; parent: string }>;
/** Normalize legacy .mhskel joint references and MPFB JSON rigs into one data format. */
export function parseHumanRig(text: string, vertexCount: number): { bones: HumanRig; weightsFile?: string } {
  const raw = JSON.parse(text), input = raw.bones ?? raw, bones: HumanRig = {};
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length || Object.keys(input).length > 512) throw new Error('A rig must have between 1 and 512 bones.');
  for (const [name, value] of Object.entries(input)) {
    const def = value as { head?: unknown; parent?: unknown };
    if (!def || typeof def !== 'object' || name.length > 120) throw new Error('Invalid rig bone.');
    const head = typeof def.head === 'string' ? { strategy: 'MEAN', vertex_indices: raw.joints?.[def.head], default_position: [0, 0, 0] } : def.head as HumanRig[string]['head'];
    if (!head || !['MEAN', 'CUBE', 'DEFAULT', 'XYZ'].includes(head.strategy)) throw new Error(`Unsupported joint position for ${name}.`);
    if (head.vertex_indices && (!Array.isArray(head.vertex_indices) || !head.vertex_indices.length || head.vertex_indices.some(v => !Number.isInteger(v) || v < 0 || v >= vertexCount))) throw new Error(`Invalid rig joint reference: ${name}.`);
    if (typeof def.head === 'string' && !head.vertex_indices) throw new Error(`Missing rig joint: ${def.head}.`);
    if (!Array.isArray(head.default_position) || head.default_position.length !== 3 || head.default_position.some(v => !Number.isFinite(v))) throw new Error(`Invalid default position: ${name}.`);
    if (def.parent != null && typeof def.parent !== 'string') throw new Error(`Invalid parent: ${name}.`);
    bones[name] = { head, parent: (def.parent as string) || '' };
  }
  for (const name of Object.keys(bones)) {
    const visited = new Set<string>(); let current = name;
    while (current) { if (visited.has(current)) throw new Error('The skeleton contains a parent cycle.'); visited.add(current); if (!bones[current]) throw new Error(`Missing parent bone: ${current}.`); current = bones[current].parent; }
  }
  if (raw.weights_file != null && (typeof raw.weights_file !== 'string' || raw.weights_file.length > 240)) throw new Error('Invalid skeleton weight-file name.');
  return { bones, weightsFile: raw.weights_file };
}
export interface Proxy {
  name: string;
  obj: string;
  material: string | null;
  bindings: Array<{ vertices: number[]; weights: number[]; offset: number[] }>;
  hidden: Set<number>;
  scales: Partial<Record<'x' | 'y' | 'z', [number, number, number]>>;
}
const lines = (text: string) => text.replace(/^\uFEFF/, '').split(/\r?\n/);
const numbers = (values: string[], line: number) => values.map(v => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`Invalid number on line ${line + 1}`); return n; });

export function parseHumanObj(text: string): HumanObj {
  const vertices: number[] = [];
  const uv: HumanObj['uv'] = [];
  const faces: HumanObj['faces'] = [];
  const groups = new Map<string, Set<number>>();
  let group = 'body';
  for (const [i, raw] of lines(text).entries()) {
    const [key, ...p] = raw.trim().split(/\s+/);
    if (!key || key.startsWith('#')) continue;
    if (key === 'v') { if (p.length < 3) throw new Error(`Incomplete OBJ vertex on line ${i + 1}`); vertices.push(...numbers(p.slice(0, 3), i)); }
    else if (key === 'vt') uv.push(numbers(p.slice(0, 2), i) as [number, number]);
    else if (key === 'g') group = p[0] || 'body';
    else if (key === 'f') {
      if (p.length < 3) throw new Error(`Incomplete OBJ face on line ${i + 1}`);
      const refs = p.map(s => s.split('/'));
      const index = (v: string, count: number) => { const n = Number(v); const result = n < 0 ? count + n : n - 1; if (!Number.isInteger(n) || n === 0 || result < 0 || result >= count) throw new Error(`Invalid OBJ index on line ${i + 1}`); return result; };
      const face = { vertices: refs.map(r => index(r[0], vertices.length / 3)), uv: refs.map(r => r[1] ? index(r[1], uv.length) : -1), group };
      faces.push(face);
      if (!groups.has(group)) groups.set(group, new Set());
      face.vertices.forEach(v => groups.get(group)!.add(v));
    }
  }
  if (!vertices.length || !faces.length) throw new Error('The OBJ has no mesh.');
  return { vertices: new Float32Array(vertices), uv, faces, groups };
}

export function parseTarget(text: string, vertexCount: number): Target {
  const indices: number[] = [], offsets: number[] = [];
  for (const [i, raw] of lines(text).entries()) {
    const s = raw.trim(); if (!s || s.startsWith('#')) continue;
    const p = numbers(s.split(/\s+/), i);
    if (p.length !== 4 || !Number.isInteger(p[0]) || p[0] < 0 || p[0] >= vertexCount) throw new Error(`Target vertex out of range on line ${i + 1}`);
    indices.push(p[0]); offsets.push(...p.slice(1));
  }
  return { indices: new Uint32Array(indices), offsets: new Float32Array(offsets) };
}

/** Targets are deltas from one immutable rest mesh, so undo and reset cannot accumulate drift. */
export function blendTargets(base: Float32Array, targets: Array<{ target: Target; value: number }>): Float32Array {
  const out = base.slice();
  for (const { target, value } of targets) {
    if (!Number.isFinite(value) || value < -1 || value > 1) throw new Error('Target weight must be between -1 and 1.');
    target.indices.forEach((v, i) => { for (let axis = 0; axis < 3; axis++) out[v * 3 + axis] += target.offsets[i * 3 + axis] * value; });
  }
  return out;
}

export function parseProxy(text: string, vertexCount: number): Proxy {
  const out: Proxy = { name: 'Garment', obj: '', material: null, bindings: [], hidden: new Set(), scales: {} };
  let section = '';
  for (const [i, raw] of lines(text).entries()) {
    const s = raw.trim(); if (!s || s.startsWith('#')) continue;
    const [key, ...p] = s.split(/\s+/);
    if (key === 'verts' || key === 'delete_verts') { section = key; continue; }
    if (key === 'name') { out.name = p.join(' '); section = ''; }
    else if (key === 'obj_file') { out.obj = p.join(' '); section = ''; }
    // Some official hair files put their material header after `verts 0`.
    else if (key === 'material') { out.material = p.join(' '); }
    else if (/^[xyz]_scale$/.test(key)) { const n = numbers(p, i); if (n.length !== 3 || n[2] <= 0 || n.slice(0, 2).some(v => !Number.isInteger(v) || v < 0 || v >= vertexCount)) throw new Error(`Invalid proxy scale on line ${i + 1}`); out.scales[key[0] as 'x'] = n as [number, number, number]; section = ''; }
    else if (/^\d/.test(key) && section === 'verts') {
      const n = numbers([key, ...p], i);
      const binding = n.length === 1 ? { vertices: [n[0]], weights: [1], offset: [0, 0, 0] } : n.length === 9 ? { vertices: n.slice(0, 3), weights: n.slice(3, 6), offset: n.slice(6, 9) } : null;
      if (!binding || binding.vertices.some(v => !Number.isInteger(v) || v < 0 || v >= vertexCount) || Math.abs(binding.weights.reduce((a, b) => a + b, 0) - 1) > 0.02) throw new Error(`Invalid proxy binding on line ${i + 1}`);
      out.bindings.push(binding);
    } else if (/^\d/.test(key) && section === 'delete_verts') {
      const tokens = [key, ...p];
      for (let j = 0; j < tokens.length; j++) {
        const a = Number(tokens[j]); let b = a;
        if (tokens[j + 1] === '-') { b = Number(tokens[j + 2]); j += 2; }
        if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < a || b >= vertexCount) throw new Error(`Invalid hidden vertex on line ${i + 1}`);
        for (let v = a; v <= b; v++) out.hidden.add(v);
      }
    } else if (!/^\d/.test(key)) section = '';
  }
  if (!out.obj || !out.bindings.length) throw new Error('The MHCLO is missing its OBJ file or vertex bindings.');
  return out;
}

/** Weighted body points plus scaled offsets, in MakeHuman's Y-up coordinates. */
export function fitProxy(body: Float32Array, proxy: Proxy): Float32Array {
  const out = new Float32Array(proxy.bindings.length * 3);
  const factors = ['x', 'y', 'z'].map((axis, i) => {
    const ref = proxy.scales[axis as 'x'];
    return ref ? Math.abs(body[ref[0] * 3 + i] - body[ref[1] * 3 + i]) / ref[2] : 1;
  });
  proxy.bindings.forEach((b, index) => { for (let axis = 0; axis < 3; axis++) { out[index * 3 + axis] = b.offset[axis] * factors[axis]; b.vertices.forEach((v, j) => { out[index * 3 + axis] += body[v * 3 + axis] * b.weights[j]; }); } });
  return out;
}

export function parseHumanMaterial(text: string): Record<string, string | number[]> {
  const out: Record<string, string | number[]> = {};
  for (const raw of lines(text)) {
    const [key, ...p] = raw.trim().split(/\s+/); if (!key || key.startsWith('#')) continue;
    if (/^(diffuseColor|specularColor|emissiveColor)$/.test(key)) { const color = p.map(Number); if (color.length !== 3 || color.some(value => !Number.isFinite(value))) throw new Error(`Invalid material color: ${key}.`); out[key] = color; }
    else out[key] = p.join(' ');
  }
  return out;
}
