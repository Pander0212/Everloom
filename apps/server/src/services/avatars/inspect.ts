/**
 * Reads a model file and reports what it is and what it holds: format (plain GLB, VRM 0.x, VRM 1.0),
 * skeleton, morph targets and VRM expressions, size and cost, plus the automatic bone and expression
 * mapping. Works on the raw description, so VRM extensions are read as written.
 */
import sharp from 'sharp';
import { mapBones, mapExpressions, REQUIRED_BONES, type BoneMapResult, type ExpressionMap, type HumanBone, type MorphWeight, type RigBone } from '@everloom/engine';
import { parseGlb, viewBytes, type Glb, type GltfJson } from './glb.js';

export type ModelFormat = 'glb' | 'vrm0' | 'vrm1';

export interface ModelWarning {
  code: string;
  message: string;
  /** 'info' is advice; 'heavy' means it may be slow on phones; 'problem' limits what works. */
  level: 'info' | 'heavy' | 'problem';
}

export interface ModelInfo {
  format: ModelFormat;
  generator: string;
  bytes: number;
  triangles: number;
  vertices: number;
  meshes: number;
  materials: number;
  textures: Array<{ index: number; mime: string; width: number; height: number; bytes: number }>;
  /** Uncompressed GPU memory for all textures with mipmaps, in bytes. */
  textureMemory: number;
  bones: RigBone[];
  joints: number;
  morphs: string[];
  vrmExpressions: string[];
  animations: string[];
  springs: boolean;
  /** Bounding box height in the file's units, and the size it's probably meant to be in metres. */
  height: number;
  unitScale: number;
  boneMap: Partial<Record<HumanBone, string>>;
  missingBones: HumanBone[];
  convention: BoneMapResult['convention'];
  expressionMap: ExpressionMap;
  faceRig: string;
  meshNames: string[];
  materialNames: string[];
  warnings: ModelWarning[];
}

/** Budgets from the brief: two avatars at 30 fps on a mid-range phone. */
export const BUDGET = {
  triangles: 60_000,
  trianglesMax: 150_000,
  textureDim: 2048,
  textureMemory: 96 * 1024 * 1024,
  materials: 24,
  joints: 256,
  bytes: 40 * 1024 * 1024,
};

type M4 = number[];
const ident = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: M4, b: M4): M4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
}
function trs(n: NonNullable<GltfJson['nodes']>[number]): M4 {
  if (n.matrix?.length === 16) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y! * y! + z! * z!)) * sx!, 2 * (x! * y! + z! * w!) * sx!, 2 * (x! * z! - y! * w!) * sx!, 0,
    2 * (x! * y! - z! * w!) * sy!, (1 - 2 * (x! * x! + z! * z!)) * sy!, 2 * (y! * z! + x! * w!) * sy!, 0,
    2 * (x! * z! + y! * w!) * sz!, 2 * (y! * z! - x! * w!) * sz!, (1 - 2 * (x! * x! + y! * y!)) * sz!, 0,
    tx!, ty!, tz!, 1,
  ];
}
const apply = (m: M4, p: number[]) => [0, 1, 2].map((r) => m[r]! * p[0]! + m[4 + r]! * p[1]! + m[8 + r]! * p[2]! + m[12 + r]!);

/** World matrices for every node (glTF nodes form a forest under the scenes). */
export function worldMatrices(json: GltfJson): M4[] {
  const nodes = json.nodes ?? [];
  const parent = new Array<number>(nodes.length).fill(-1);
  nodes.forEach((n, i) => n.children?.forEach((c) => (parent[c] = i)));
  const out: (M4 | null)[] = new Array(nodes.length).fill(null);
  const get = (i: number, depth = 0): M4 => {
    if (out[i]) return out[i]!;
    if (depth > 512) return ident();
    const local = trs(nodes[i]!);
    out[i] = parent[i]! >= 0 ? mul(get(parent[i]!, depth + 1), local) : local;
    return out[i]!;
  };
  return nodes.map((_, i) => get(i));
}

export function nodeParents(json: GltfJson): number[] {
  const nodes = json.nodes ?? [];
  const parent = new Array<number>(nodes.length).fill(-1);
  nodes.forEach((n, i) => n.children?.forEach((c) => (parent[c] = i)));
  return parent;
}

/** VRM's humanoid as canonical (VRM 1.0) bone name → node name. */
export function vrmHumanoid(json: GltfJson): Record<string, string> | null {
  const nodes = json.nodes ?? [];
  const v1 = json.extensions?.VRMC_vrm?.humanoid?.humanBones as Record<string, { node: number }> | undefined;
  if (v1) return Object.fromEntries(Object.entries(v1).flatMap(([k, v]) => (nodes[v?.node]?.name ? [[k, nodes[v.node]!.name!]] : [])));
  const v0 = json.extensions?.VRM?.humanoid?.humanBones as Array<{ bone: string; node: number }> | undefined;
  if (v0) return Object.fromEntries(v0.flatMap((b) => (nodes[b.node]?.name ? [[b.bone, nodes[b.node]!.name!]] : [])));
  return null;
}

/** VRM expression (blend shape group) names, 1.0 presets plus custom; 0.x presets mapped to 1.0 names. */
export function vrmExpressionNames(json: GltfJson): string[] {
  const v1 = json.extensions?.VRMC_vrm?.expressions;
  if (v1) return [...Object.keys(v1.preset ?? {}), ...Object.keys(v1.custom ?? {})];
  const v0 = json.extensions?.VRM?.blendShapeMaster?.blendShapeGroups as Array<{ name?: string; presetName?: string }> | undefined;
  if (!v0) return [];
  const RENAME: Record<string, string> = { joy: 'happy', sorrow: 'sad', fun: 'relaxed', a: 'aa', i: 'ih', u: 'ou', e: 'ee', o: 'oh', blink_l: 'blinkLeft', blink_r: 'blinkRight' };
  return v0.map((g) => (g.presetName && g.presetName !== 'unknown' ? (RENAME[g.presetName] ?? g.presetName) : (g.name ?? ''))).filter(Boolean);
}


export async function inspectModel(bytes: Buffer, glb?: Glb): Promise<ModelInfo> {
  const g = glb ?? parseGlb(bytes);
  const { json } = g;
  const nodes = json.nodes ?? [];
  if (json.asset?.version !== '2.0') throw new Error('The model must declare glTF 2.0.');
  if (!Array.isArray(nodes) || nodes.length > 100000) throw new Error('Invalid or excessively large node list.');
  const parents = new Int32Array(nodes.length).fill(-1);
  nodes.forEach((node, i) => {
    if (!node || typeof node !== 'object' || (node.children !== undefined && !Array.isArray(node.children))) throw new Error(`Invalid node ${i}.`);
    for (const child of node.children ?? []) {
      if (!Number.isInteger(child) || child < 0 || child >= nodes.length) throw new Error(`Node ${i} points at a missing child.`);
      if (parents[child] !== -1) throw new Error('A model node has more than one parent.');
      parents[child] = i;
    }
  });
  const visited = new Uint8Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    let current = i;
    const chain: number[] = [];
    while (current >= 0 && visited[current] !== 2) {
      if (visited[current] === 1) throw new Error('The model skeleton contains a cycle.');
      visited[current] = 1; chain.push(current); current = parents[current]!;
    }
    chain.forEach(n => { visited[n] = 2; });
  }
  const format: ModelFormat = json.extensions?.VRMC_vrm ? 'vrm1' : json.extensions?.VRM ? 'vrm0' : 'glb';
  const warnings: ModelWarning[] = [];
  if ((json.buffers ?? []).some((b) => b.uri)) throw new Error('The model refers to outside files; export it as a single .glb');
  if ((json.images ?? []).some((i) => i.uri && !i.uri.startsWith('data:'))) throw new Error('The model refers to outside image files; export it as a single .glb');

  // Geometry cost.
  let triangles = 0;
  let vertices = 0;
  const morphs = new Set<string>();
  for (const m of json.meshes ?? []) {
    m.primitives.forEach((p) => {
      const pos = json.accessors?.[p.attributes.POSITION ?? -1];
      const count = p.indices !== undefined ? (json.accessors?.[p.indices]?.count ?? 0) : (pos?.count ?? 0);
      if (p.mode === undefined || p.mode === 4) triangles += Math.floor(count / 3);
      else if (p.mode === 5 || p.mode === 6) triangles += Math.max(0, count - 2);
      vertices += pos?.count ?? 0;
    });
    (m.extras?.targetNames ?? []).forEach((n) => typeof n === 'string' && morphs.add(n));
    // Unnamed morph targets still count; they're addressed by index.
    const t = m.primitives[0]?.targets?.length ?? 0;
    if (t && !m.extras?.targetNames) for (let i = 0; i < t; i++) morphs.add(`${m.name ?? 'mesh'}#${i}`);
  }

  // Textures.
  const textures: ModelInfo['textures'] = [];
  let textureMemory = 0;
  for (const [index, img] of (json.images ?? []).entries()) {
    let data: Buffer | null = null;
    if (img.bufferView !== undefined) data = viewBytes(g, img.bufferView);
    else if (img.uri?.startsWith('data:')) data = Buffer.from(img.uri.replace(/^data:[^,]*,/, ''), 'base64');
    if (!data) continue;
    let width = 0;
    let height = 0;
    const mime = img.mimeType ?? '';
    if (mime === 'image/ktx2') {
      width = data.readUInt32LE(20);
      height = data.readUInt32LE(24);
    } else {
      try {
        const md = await sharp(data).metadata();
        width = md.width ?? 0;
        height = md.height ?? 0;
      } catch {
        warnings.push({ code: 'bad_texture', message: `Texture ${index + 1} could not be read`, level: 'problem' });
      }
    }
    textures.push({ index, mime, width, height, bytes: data.length });
    textureMemory += Math.round(width * height * 4 * 1.33);
  }

  // Skeleton: every skin joint, with parents limited to joints.
  const parent = nodeParents(json);
  const jointSet = new Set<number>();
  for (const s of json.skins ?? []) s.joints.forEach((j) => jointSet.add(j));
  const humanoid = vrmHumanoid(json);
  // Some files skin a few bones only; include the humanoid's nodes and their ancestors too.
  if (humanoid) for (const name of Object.values(humanoid)) {
    const i = nodes.findIndex((n) => n.name === name);
    if (i >= 0) jointSet.add(i);
  }
  // Rigid game characters attach meshes directly to animated transform nodes.
  // Include their non-mesh ancestors, not just the few joints used by hand skins.
  for (const [index, node] of nodes.entries()) if (node.mesh !== undefined || jointSet.has(index)) {
    let ancestor = parent[index]!;
    while (ancestor >= 0) { if (nodes[ancestor].mesh === undefined) jointSet.add(ancestor); ancestor = parent[ancestor]!; }
  }
  const named = (i: number) => nodes[i]?.name || `node_${i}`;
  const joints = [...jointSet];
  const bones: RigBone[] = joints.map((j) => {
    let p = parent[j]!;
    while (p >= 0 && !jointSet.has(p)) p = parent[p]!;
    return { name: named(j), parent: p >= 0 ? named(p) : null };
  });
  // Unnamed or duplicate bone names would make name-based mapping ambiguous.
  const dup = bones.length - new Set(bones.map((b) => b.name)).size;
  if (dup) warnings.push({ code: 'duplicate_bones', message: `${dup} bones share a name with another bone; mapping may pick the wrong one`, level: 'problem' });
  const auto = mapBones(bones, humanoid);

  const vrmExpressions = vrmExpressionNames(json);
  const vrmMap: Record<string, MorphWeight[]> | null = vrmExpressions.length ? Object.fromEntries(vrmExpressions.map((e) => [e, [{ morph: `vrm:${e}`, weight: 1 }]])) : null;
  const ex = mapExpressions([...morphs, ...vrmExpressions.map((e) => `vrm:${e}`)], vrmMap);

  // Size: the bounds of every mesh in world space (skinned meshes in bind pose).
  const world = worldMatrices(json);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  nodes.forEach((n, i) => {
    if (n.mesh === undefined) return;
    for (const p of json.meshes?.[n.mesh]?.primitives ?? []) {
      const a = json.accessors?.[p.attributes.POSITION ?? -1] as { min?: number[]; max?: number[] } | undefined;
      if (!a?.min || !a.max) continue;
      // Skinned meshes are placed by their skeleton, not their node: use the identity for them.
      const m = n.skin !== undefined ? ident() : world[i]!;
      for (let k = 0; k < 8; k++) {
        const c = apply(m, [k & 1 ? a.max[0]! : a.min[0]!, k & 2 ? a.max[1]! : a.min[1]!, k & 4 ? a.max[2]! : a.min[2]!]);
        for (let d = 0; d < 3; d++) {
          lo[d] = Math.min(lo[d]!, c[d]!);
          hi[d] = Math.max(hi[d]!, c[d]!);
        }
      }
    }
  });
  const height = Number.isFinite(lo[1]) ? hi[1]! - lo[1]! : 0;
  // Guess the unit: people are 0.5–2.5 m tall; centimetres give 50–250; some exports are ×100 inside.
  const unitScale = height > 20 && height < 400 ? 0.01 : height > 0 && height < 0.05 ? 100 : 1;

  const materials = json.materials?.length ?? 0;
  if (!(json.meshes?.length ?? 0)) warnings.push({ code: 'no_mesh', message: 'The file has no meshes', level: 'problem' });
  if (!joints.length) warnings.push({ code: 'no_skeleton', message: 'The model has no skeleton, so it can only stand still. Rig it (Blender, or Mixamo) and import it again.', level: 'problem' });
  else if (auto.missing.some((b) => (REQUIRED_BONES as readonly string[]).includes(b))) warnings.push({ code: 'bones_missing', message: `Some main bones weren't found (${auto.missing.filter((b) => (REQUIRED_BONES as readonly string[]).includes(b)).join(', ')}). Set them on the bones step.`, level: 'problem' });
  if (!ex.found.length) warnings.push({ code: 'no_face', message: 'No facial expressions or mouth shapes were found: the face will not move (the body still will).', level: 'info' });
  if (triangles > BUDGET.trianglesMax) warnings.push({ code: 'very_heavy', message: `${triangles.toLocaleString('en')} triangles is very heavy; phones will use the low-detail version`, level: 'heavy' });
  else if (triangles > BUDGET.triangles) warnings.push({ code: 'heavy', message: `${triangles.toLocaleString('en')} triangles is above the phone budget (${BUDGET.triangles.toLocaleString('en')})`, level: 'heavy' });
  if (textures.some((t) => Math.max(t.width, t.height) > BUDGET.textureDim)) warnings.push({ code: 'big_textures', message: `Textures larger than ${BUDGET.textureDim}px will be scaled down`, level: 'info' });
  if (textureMemory > BUDGET.textureMemory) warnings.push({ code: 'texture_memory', message: `Textures need about ${Math.round(textureMemory / 1048576)} MB of graphics memory before compression`, level: 'heavy' });
  if (materials > BUDGET.materials) warnings.push({ code: 'materials', message: `${materials} materials means many draw calls; fewer is faster`, level: 'heavy' });
  if (joints.length > BUDGET.joints) warnings.push({ code: 'joints', message: `${joints.length} bones; some phones can't skin more than ${BUDGET.joints}`, level: 'heavy' });
  if (bytes.length > BUDGET.bytes) warnings.push({ code: 'file_size', message: `The file is ${Math.round(bytes.length / 1048576)} MB`, level: 'heavy' });
  if (unitScale !== 1) warnings.push({ code: 'units', message: unitScale < 1 ? 'The model may be in centimetres; check its size on the Fit step' : 'The model may be very small; check its size on the Fit step', level: 'info' });

  return {
    format,
    generator: json.asset?.generator ?? '',
    bytes: bytes.length,
    triangles,
    vertices,
    meshes: json.meshes?.length ?? 0,
    materials,
    textures,
    textureMemory,
    bones,
    joints: joints.length,
    morphs: [...morphs],
    vrmExpressions,
    animations: (json.animations ?? []).map((a, i) => a.name || `Animation ${i + 1}`),
    springs: !!(json.extensions?.VRMC_springBone || json.extensions?.VRM?.secondaryAnimation?.boneGroups?.length),
    height,
    unitScale,
    boneMap: auto.map,
    missingBones: auto.missing,
    convention: auto.convention,
    expressionMap: ex.map,
    faceRig: ex.rig,
    // The names three.js gives the objects: the node's name (or its mesh's when the node has none).
    meshNames: [...new Set(nodes.flatMap((n) => (n.mesh !== undefined ? [n.name || json.meshes?.[n.mesh]?.name || ''] : [])).filter(Boolean))],
    materialNames: (json.materials ?? []).map((m, i) => m.name || `Material ${i + 1}`),
    warnings,
  };
}

