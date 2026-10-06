/**
 * Writes rigged meshes as a GLB: a skeleton (bones at their rest positions, no rotation), skinned
 * meshes with plain-colour or textured materials, and morph targets. Used to export code-made parts
 * as a part pack; small enough to read in one sitting.
 */
export interface GlbBone {
  name: string;
  parent: string | null;
  at: [number, number, number];
}

export interface GlbMesh {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  uvs?: Float32Array;
  color: string;
  roughness?: number;
  metalness?: number;
  /** A PNG for the base colour (with `uvs`). */
  texture?: Buffer;
  morphs?: Record<string, Float32Array>;
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

export function writeGlb(bones: GlbBone[], meshes: GlbMesh[], opts: { generator?: string; extras?: Record<string, unknown> } = {}): Buffer {
  const chunks: Buffer[] = [];
  let offset = 0;
  const bufferViews: any[] = [];
  const accessors: any[] = [];
  const view = (data: ArrayBufferView, target?: number) => {
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const pad = (4 - (buf.length % 4)) % 4;
    chunks.push(buf, Buffer.alloc(pad));
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
    offset += buf.length + pad;
    return bufferViews.length - 1;
  };
  const accessor = (data: Float32Array | Uint32Array | Uint16Array, type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4', target?: number, minmax = false) => {
    const comp = data instanceof Float32Array ? 5126 : data instanceof Uint32Array ? 5125 : 5123;
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const a: any = { bufferView: view(data, target), componentType: comp, count: data.length / n, type };
    if (minmax) {
      const min = Array(n).fill(Infinity);
      const max = Array(n).fill(-Infinity);
      for (let i = 0; i < data.length; i++) {
        min[i % n] = Math.min(min[i % n], data[i]!);
        max[i % n] = Math.max(max[i % n], data[i]!);
      }
      a.min = min;
      a.max = max;
    }
    accessors.push(a);
    return accessors.length - 1;
  };

  // Skeleton: bone nodes first (parents before children), then one node per mesh.
  const nodes: any[] = [];
  const index = new Map<string, number>();
  const at = new Map(bones.map((b) => [b.name, b.at]));
  for (const b of bones) {
    const p = b.parent ? at.get(b.parent)! : [0, 0, 0];
    index.set(b.name, nodes.length);
    nodes.push({ name: b.name, translation: [b.at[0] - p[0], b.at[1] - p[1], b.at[2] - p[2]] });
  }
  for (const b of bones) if (b.parent) (nodes[index.get(b.parent)!].children ??= []).push(index.get(b.name)!);
  const ibm = new Float32Array(bones.length * 16);
  bones.forEach((b, i) => {
    ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -b.at[0], -b.at[1], -b.at[2], 1], i * 16);
  });
  const skin = { joints: bones.map((b) => index.get(b.name)!), inverseBindMatrices: accessor(ibm, 'MAT4'), skeleton: index.get(bones.find((b) => !b.parent)!.name) };

  const materials: any[] = [];
  const textures: any[] = [];
  const images: any[] = [];
  const glMeshes: any[] = [];
  for (const m of meshes) {
    const n = parseInt(m.color.slice(1), 16);
    const material: any = {
      name: m.name,
      pbrMetallicRoughness: { baseColorFactor: [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255), 1], metallicFactor: m.metalness ?? 0, roughnessFactor: m.roughness ?? 0.8 },
    };
    if (m.texture) {
      images.push({ bufferView: view(new Uint8Array(m.texture)), mimeType: 'image/png' });
      textures.push({ source: images.length - 1, sampler: 0 });
      material.pbrMetallicRoughness.baseColorTexture = { index: textures.length - 1 };
    }
    materials.push(material);
    const attributes: any = {
      POSITION: accessor(m.positions, 'VEC3', 34962, true),
      NORMAL: accessor(m.normals, 'VEC3', 34962),
      JOINTS_0: accessor(m.skinIndex, 'VEC4', 34962),
      WEIGHTS_0: accessor(m.skinWeight, 'VEC4', 34962),
    };
    if (m.uvs) attributes.TEXCOORD_0 = accessor(m.uvs, 'VEC2', 34962);
    const prim: any = { attributes, indices: accessor(m.indices, 'SCALAR', 34963), material: materials.length - 1 };
    const names = Object.keys(m.morphs ?? {});
    if (names.length) prim.targets = names.map((k) => ({ POSITION: accessor(m.morphs![k]!, 'VEC3', 34962, true) }));
    glMeshes.push({ name: m.name, primitives: [prim], ...(names.length ? { weights: names.map(() => 0), extras: { targetNames: names } } : {}) });
    nodes.push({ name: m.name, mesh: glMeshes.length - 1, skin: 0 });
  }
  const roots = bones.filter((b) => !b.parent).map((b) => index.get(b.name)!);
  const meshNodes = meshes.map((_, i) => bones.length + i);
  const json: any = {
    asset: { version: '2.0', generator: opts.generator ?? 'Everloom' },
    scene: 0,
    scenes: [{ nodes: [...roots, ...meshNodes] }],
    nodes,
    meshes: glMeshes,
    materials,
    skins: [skin],
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
    ...(textures.length ? { textures, images, samplers: [{ magFilter: 9729, minFilter: 9729, wrapS: 33071, wrapT: 33071 }] } : {}),
    ...(opts.extras ? { extras: opts.extras } : {}),
  };
  let jsonBuf = Buffer.from(JSON.stringify(json));
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jsonBuf, bh, bin]);
}
