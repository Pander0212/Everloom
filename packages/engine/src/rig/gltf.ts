/**
 * A glTF/VRM file's skeleton for the auto-mapper: every joint (and its ancestors), with rest-pose
 * world positions from the nodes' transforms, the file's own humanoid map (VRM 0.x or 1.0), and
 * VRM spring-bone roots as physics chains.
 */
import type { HumanBone } from '../avatar/skeleton.js';
import type { AutomapBone, AutomapInput, Vec3 } from './automap.js';

interface GltfNode {
  name?: string;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
  mesh?: number;
  skin?: number;
}
export interface GltfJson {
  nodes?: GltfNode[];
  skins?: { joints: number[] }[];
  extensions?: Record<string, any>;
}

type M4 = number[];
const ident = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: M4, b: M4): M4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
}
function compose(n: GltfNode): M4 {
  if (n.matrix?.length === 16) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const x2 = x! + x!, y2 = y! + y!, z2 = z! + z!;
  const xx = x! * x2, xy = x! * y2, xz = x! * z2, yy = y! * y2, yz = y! * z2, zz = z! * z2, wx = w! * x2, wy = w! * y2, wz = w! * z2;
  return [(1 - (yy + zz)) * sx!, (xy + wz) * sx!, (xz - wy) * sx!, 0, (xy - wz) * sy!, (1 - (xx + zz)) * sy!, (yz + wx) * sy!, 0, (xz + wy) * sz!, (yz - wx) * sz!, (1 - (xx + yy)) * sz!, 0, tx!, ty!, tz!, 1];
}

export function skeletonFromGltf(json: GltfJson): AutomapInput {
  const nodes = json.nodes ?? [];
  const parent = new Array<number>(nodes.length).fill(-1);
  nodes.forEach((n, i) => n.children?.forEach((c) => (parent[c] = i)));
  const world: M4[] = [];
  const worldOf = (i: number): M4 => (world[i] ??= parent[i]! >= 0 ? mul(worldOf(parent[i]!), compose(nodes[i]!)) : compose(nodes[i]!));
  const joints = new Set<number>();
  for (const s of json.skins ?? []) for (const j of s.joints) joints.add(j);
  // VRM humanoid and spring roots.
  const vrm1 = json.extensions?.VRMC_vrm?.humanoid?.humanBones as Record<string, { node: number }> | undefined;
  const vrm0 = json.extensions?.VRM?.humanoid?.humanBones as { bone: string; node: number }[] | undefined;
  const humanoid: Partial<Record<HumanBone, string>> = {};
  const name = (i: number) => nodes[i]?.name || `node_${i}`;
  if (vrm1) for (const [b, v] of Object.entries(vrm1)) {
    humanoid[b as HumanBone] = name(v.node);
    joints.add(v.node);
  }
  if (vrm0) for (const v of vrm0) {
    const b = v.bone === 'leftThumbProximal' ? 'leftThumbMetacarpal' : v.bone === 'leftThumbIntermediate' ? 'leftThumbProximal' : v.bone === 'rightThumbProximal' ? 'rightThumbMetacarpal' : v.bone === 'rightThumbIntermediate' ? 'rightThumbProximal' : v.bone;
    humanoid[b as HumanBone] = name(v.node);
    joints.add(v.node);
  }
  // Ancestors of joints that aren't meshes belong to the skeleton too.
  for (const j of [...joints]) for (let p = parent[j]!; p >= 0; p = parent[p]!) if (nodes[p]!.mesh === undefined) joints.add(p);
  const bones: AutomapBone[] = [...joints].map((j) => {
    let p = parent[j]!;
    while (p >= 0 && !joints.has(p)) p = parent[p]!;
    const m = worldOf(j);
    return { name: name(j), parent: p >= 0 ? name(p) : null, pos: [m[12]!, m[13]!, m[14]!] as Vec3 };
  });
  const chains: { root: string; kind: string }[] = [];
  const springs1 = json.extensions?.VRMC_springBone?.springs as { joints: { node: number }[]; name?: string }[] | undefined;
  for (const s of springs1 ?? []) if (s.joints[0]) chains.push({ root: name(s.joints[0].node), kind: /bust|breast|胸/i.test(s.name ?? '') ? 'chest' : /hair|髪/i.test(s.name ?? '') ? 'hair' : /skirt|スカート/i.test(s.name ?? '') ? 'cloth' : 'accessory' });
  const springs0 = json.extensions?.VRM?.secondaryAnimation?.boneGroups as { bones: number[]; comment?: string }[] | undefined;
  for (const g of springs0 ?? []) for (const b of g.bones) chains.push({ root: name(b), kind: /bust|breast|胸/i.test(g.comment ?? '') ? 'chest' : /hair|髪/i.test(g.comment ?? '') ? 'hair' : 'accessory' });
  return { bones, humanoid: Object.keys(humanoid).length ? humanoid : null, humanoidSource: vrm1 ? 'VRM 1.0 humanoid' : vrm0 ? 'VRM 0.x humanoid' : undefined, chains };
}

/** The JSON chunk of a GLB (or the text of a .gltf). */
export function readGltfJson(bytes: Uint8Array): GltfJson {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) === 0x46546c67) {
    const len = dv.getUint32(12, true);
    return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len))) as GltfJson;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as GltfJson;
}

export const gltfFile = (path: string) => /\.(glb|vrm|gltf)$/i.test(path);
