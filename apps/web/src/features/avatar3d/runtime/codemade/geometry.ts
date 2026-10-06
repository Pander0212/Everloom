/**
 * Everything about a code-made character that is plain numbers: the skeleton, and every mesh with
 * its skin weights. No three.js here, so it runs in a worker (meshing takes about a second on a
 * laptop, longer on a phone) and the result is sent back as transferable arrays.
 */
import { AvatarRecipeSchema, type AvatarRecipe } from '@everloom/engine';
import { planBody, type BodyPlan } from './body';
import { planOutfit } from './outfit';
import { buildFace, type FaceMesh } from './face';
import { mesh as meshField, type Mesh } from './mesher';
import { evalField, type Field, type Shape, type V3 } from './sdf';

export interface BuildOptions {
  /** Coarser meshes for phones (about a third of the triangles). */
  low?: boolean;
}

export interface SkinnedMesh extends Mesh {
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
}

export interface CodePart extends SkinnedMesh {
  name: string;
  color: string;
  roughness: number;
  metalness: number;
  pattern: 'plain' | 'stripes' | 'checks' | 'dots';
  /** Texture coordinates for the pattern (wrapped around the body like a label). */
  uvs?: Float32Array;
}

/** Cylindrical coordinates around the body's axis: about one pattern repeat every 3.5 cm. */
function wrapUvs(positions: Float32Array, H: number): Float32Array {
  const n = positions.length / 3;
  const uv = new Float32Array(n * 2);
  const step = 0.021 * H;
  for (let v = 0; v < n; v++) {
    const x = positions[v * 3]!;
    const y = positions[v * 3 + 1]!;
    const z = positions[v * 3 + 2]!;
    // Arms and legs wrap around their own axis roughly: distance along x for arms, angle for the rest.
    uv[v * 2] = Math.abs(x) > 0.16 * H ? Math.abs(x) / step : ((Math.atan2(x, z) + Math.PI) * 0.09 * H) / step;
    uv[v * 2 + 1] = y / step;
  }
  return uv;
}

export interface CodeGeometry {
  /** In skin-index order; parents always come first. */
  bones: Array<{ name: string; parent: string | null; at: V3 }>;
  chains: string[][];
  parts: CodePart[];
  face: FaceMesh & { skinIndex: Uint16Array; skinWeight: Float32Array };
  height: number;
}

/** Skin weights: each vertex follows the bones whose shapes are nearest (softly), up to four. */
export function skin(m: Mesh, shapes: Shape[], boneIndex: Map<string, number>, sigma: number, inset = 0): SkinnedMesh {
  const n = m.positions.length / 3;
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const best = new Map<number, number>();
  for (let v = 0; v < n; v++) {
    // Garments take the weights of the skin under them, so both bend the same way.
    const x = m.positions[v * 3]! - m.normals[v * 3]! * inset;
    const y = m.positions[v * 3 + 1]! - m.normals[v * 3 + 1]! * inset;
    const z = m.positions[v * 3 + 2]! - m.normals[v * 3 + 2]! * inset;
    best.clear();
    let dmin = Infinity;
    for (const s of shapes) {
      const bi = boneIndex.get(s.bone);
      if (bi === undefined) continue;
      const d = s.d(x, y, z);
      const cur = best.get(bi);
      if (cur === undefined || d < cur) best.set(bi, d);
      if (d < dmin) dmin = d;
    }
    const ws = [...best.entries()].map(([b, d]) => [b, Math.exp(-(d - dmin) / sigma)] as const).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = ws.reduce((a, w) => a + w[1], 0) || 1;
    ws.forEach(([b, w], i) => {
      skinIndex[v * 4 + i] = b;
      skinWeight[v * 4 + i] = w / sum;
    });
    if (!ws.length) skinWeight[v * 4] = 1;
  }
  return { ...m, skinIndex, skinWeight };
}

/** Drops triangles that lie well inside any covering field (skin under clothes). */
export function cull(m: Mesh, covers: Field[], margin: number): Mesh {
  if (!covers.length) return m;
  const n = m.positions.length / 3;
  const hidden = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    const x = m.positions[v * 3]!;
    const y = m.positions[v * 3 + 1]!;
    const z = m.positions[v * 3 + 2]!;
    for (const f of covers)
      if (evalField(f, x, y, z) < -margin) {
        hidden[v] = 1;
        break;
      }
  }
  const idx: number[] = [];
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t]!;
    const b = m.indices[t + 1]!;
    const c = m.indices[t + 2]!;
    if (hidden[a] && hidden[b] && hidden[c]) continue;
    idx.push(a, b, c);
  }
  return { ...m, indices: Uint32Array.from(idx) };
}

function depth(plan: BodyPlan, k: string): number {
  let d = 0;
  for (let p = plan.parent[k]; p; p = plan.parent[p]) d++;
  return d;
}

export function codeGeometry(input: AvatarRecipe | unknown, opts: BuildOptions = {}): CodeGeometry {
  const recipe = AvatarRecipeSchema.parse(input);
  const plan = planBody(recipe);
  const outfit = planOutfit(plan, recipe);
  const H = plan.H;
  const q = opts.low ? 1.7 : 1;

  const bones: CodeGeometry['bones'] = Object.keys(plan.joints)
    .sort((a, b) => depth(plan, a) - depth(plan, b))
    .map((name) => ({ name, parent: plan.parent[name] ?? null, at: plan.joints[name]! }));
  const chains: string[][] = [];
  for (const c of outfit.chains) {
    const names = c.points.map((_, i) => `${c.name}_${i}`);
    c.points.forEach((at, i) => bones.push({ name: names[i]!, parent: i === 0 ? c.parent : names[i - 1]!, at }));
    chains.push(names);
  }
  const boneIndex = new Map(bones.map((b, i) => [b.name, i]));

  const parts: CodePart[] = [];
  // Body, minus the skin that clothes cover.
  const covers = outfit.parts.filter((p) => p.covers).map((p) => p.field);
  const body = cull(meshField({ shapes: plan.shapes, blend: plan.blend }, 0.009 * H * q), covers, 0.0025 * H);
  parts.push({ name: 'Body', color: recipe.body.skin, roughness: 0.7, metalness: 0, pattern: 'plain', ...skin(body, plan.shapes, boneIndex, 0.016 * H) });
  for (const p of outfit.parts) {
    const m = meshField(p.field, p.cell * H * q);
    if (!m.indices.length) continue;
    const shapes = p.weights ?? [...p.field.shapes, ...plan.shapes];
    const pattern = p.pattern ?? 'plain';
    parts.push({ name: p.name, color: p.color, roughness: p.roughness ?? 0.8, metalness: p.metalness ?? 0, pattern, ...(pattern !== 'plain' ? { uvs: wrapUvs(m.positions, H) } : {}), ...skin(m, shapes, boneIndex, (p.sigma ?? 0.016) * H, p.covers ? (p.field.offset ?? 0) : 0) });
  }

  // The face follows the head.
  const f = buildFace(plan, recipe);
  const fn = f.positions.length / 3;
  const head = boneIndex.get('head')!;
  const skinIndex = new Uint16Array(fn * 4);
  const skinWeight = new Float32Array(fn * 4);
  for (let v = 0; v < fn; v++) {
    skinIndex[v * 4] = head;
    skinWeight[v * 4] = 1;
  }
  let height = 0;
  for (const p of parts) for (let i = 1; i < p.positions.length; i += 3) height = Math.max(height, p.positions[i]!);
  return { bones, chains, parts, face: { ...f, skinIndex, skinWeight }, height };
}

/** The arrays to transfer (not copy) from a worker. */
export function transferables(g: CodeGeometry): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const p of g.parts) if (p.uvs) out.push(p.uvs.buffer as ArrayBuffer);
  for (const p of [...g.parts, g.face]) out.push(p.positions.buffer as ArrayBuffer, p.normals.buffer as ArrayBuffer, p.indices.buffer as ArrayBuffer, p.skinIndex.buffer as ArrayBuffer, p.skinWeight.buffer as ArrayBuffer);
  out.push(g.face.uvs.buffer as ArrayBuffer, g.face.palette.buffer as ArrayBuffer, ...Object.values(g.face.morphs).map((m) => m.buffer as ArrayBuffer));
  return [...new Set(out)];
}
