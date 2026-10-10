/**
 * MMD motions in the browser: VMD (motion) and VPD (pose). Only the model's skeleton matters for
 * retargeting, so the PMX/PMD it was made for is optional: without it, a standard MMD skeleton
 * (the bone names and proportions most MMD models share) stands in. Rotations in VMD/VPD are
 * relative to bones with no rest rotation, which is why a stand-in skeleton works.
 */
import * as THREE from 'three';
import type { MotionSource } from './convert';

type Vec = [number, number, number];
interface MmdBone { name: string; parent: string | null; position: Vec }

// Standard MMD skeleton (MMD units, left-handed: the model faces -Z, its left side is +X).
const L = (name: string, parent: string | null, x: number, y: number, z: number): MmdBone[] => {
  const side = (s: string) => s.replace(/^左/, '右');
  if (!name.startsWith('左')) return [{ name, parent, position: [x, y, z] }];
  return [
    { name, parent, position: [x, y, z] },
    { name: side(name), parent: parent && side(parent), position: [-x, y, z] },
  ];
};
const STANDARD: MmdBone[] = [
  ...L('全ての親', null, 0, 0, 0),
  ...L('センター', '全ての親', 0, 8, 0),
  ...L('グルーブ', 'センター', 0, 8.2, 0),
  ...L('上半身', 'グルーブ', 0, 11.6, 0.2),
  ...L('上半身2', '上半身', 0, 12.8, 0.2),
  ...L('首', '上半身2', 0, 15.4, 0.4),
  ...L('頭', '首', 0, 16.2, 0.2),
  ...L('下半身', 'グルーブ', 0, 11.6, 0.2),
  ...L('左肩', '上半身2', 0.25, 15, 0.4),
  ...L('左腕', '左肩', 1.35, 14.7, 0.5),
  ...L('左ひじ', '左腕', 3.1, 12.6, 0.6),
  ...L('左手首', '左ひじ', 4.7, 10.9, 0.2),
  ...L('左足', '下半身', 0.9, 10.6, 0.2),
  ...L('左ひざ', '左足', 0.95, 6, 0),
  ...L('左足首', '左ひざ', 1, 1.3, 0.5),
  ...L('左つま先', '左足首', 1, 0.2, -1.2),
];

/** A skinned mesh with no triangles, holding the bones: what MMD's animation builder binds to. */
function skeletonMesh(bones: MmdBone[]): THREE.SkinnedMesh {
  const objs = new Map<string, THREE.Bone>();
  const abs = new Map<string, Vec>();
  for (const b of bones) {
    const o = new THREE.Bone();
    o.name = b.name;
    // three's space: z flipped, as the MMD loader converts models.
    abs.set(b.name, [b.position[0], b.position[1], -b.position[2]]);
    objs.set(b.name, o);
  }
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  for (const b of bones) {
    const o = objs.get(b.name)!;
    const p = abs.get(b.name)!;
    const parent = b.parent ? objs.get(b.parent) : undefined;
    const q = b.parent ? abs.get(b.parent) : undefined;
    o.position.set(p[0] - (q?.[0] ?? 0), p[1] - (q?.[1] ?? 0), p[2] - (q?.[2] ?? 0));
    (parent ?? mesh).add(o);
  }
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([...objs.values()]));
  mesh.morphTargetDictionary = {};
  return mesh;
}

const parser = async () => new (await import('./vendor/mmdparser.module.js')).Parser();

/** The model's skeleton from a PMX/PMD file (bones only: no meshes or textures are loaded). */
async function modelSkeleton(model: File): Promise<THREE.SkinnedMesh> {
  const p = await parser();
  const buf = await model.arrayBuffer();
  const data = /\.pmd$/i.test(model.name) ? p.parsePmd(buf, false) : p.parsePmx(buf, false);
  const list = data.bones as { name: string; parentIndex: number; position: Vec }[];
  if (!list?.length) throw new Error(`${model.name} has no bones.`);
  return skeletonMesh(list.map((b) => ({ name: b.name, parent: b.parentIndex >= 0 ? list[b.parentIndex]!.name : null, position: b.position })));
}

/** Text in UTF-8 if it is valid UTF-8, else Shift-JIS (what MMD writes). */
async function mmdText(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('shift_jis').decode(buf);
  }
}

/** Reads VMD motions or a VPD pose, with the model they were made for when it was given. */
export async function mmdSource(files: File[]): Promise<MotionSource & { standIn: boolean }> {
  const model = files.find((f) => /\.(pmx|pmd)$/i.test(f.name));
  const mesh = model ? await modelSkeleton(model) : skeletonMesh(STANDARD);
  const p = await parser();
  const vmds = files.filter((f) => /\.vmd$/i.test(f.name));
  const vpd = files.find((f) => /\.vpd$/i.test(f.name));
  let clip: THREE.AnimationClip;
  if (vmds.length) {
    const parsed = await Promise.all(vmds.map(async (f) => p.parseVmd(await f.arrayBuffer(), true)));
    const vmd = parsed.length > 1 ? p.mergeVmds(parsed) : parsed[0];
    if (!vmd.motions.length) throw new Error(`${vmds[0]!.name} has no bone motion (it may be a camera or facial motion only).`);
    const { MMDLoader } = await import('./vendor/MMDLoader.js');
    clip = (new MMDLoader() as unknown as { animationBuilder: { build: (v: unknown, m: THREE.SkinnedMesh) => THREE.AnimationClip } }).animationBuilder.build(vmd, mesh);
    clip.name = vmds.map((f) => f.name.replace(/\.vmd$/i, '')).join(' + ');
  } else if (vpd) {
    const pose = p.parseVpd(await mmdText(vpd), true) as { bones: { name: string; translation: Vec; quaternion: [number, number, number, number] }[] };
    const tracks: THREE.KeyframeTrack[] = [];
    for (const b of pose.bones) {
      const bone = mesh.skeleton.getBoneByName(b.name);
      if (!bone) continue;
      const q = b.quaternion;
      tracks.push(new THREE.QuaternionKeyframeTrack(`.bones[${b.name}].quaternion`, [0, 1], [...q, ...q]));
      const t = bone.position.clone().add(new THREE.Vector3(...b.translation)).toArray();
      tracks.push(new THREE.VectorKeyframeTrack(`.bones[${b.name}].position`, [0, 1], [...t, ...t]));
    }
    if (!tracks.length) throw new Error(`${vpd.name} poses no bone of ${model ? model.name : 'a standard MMD model'}.`);
    clip = new THREE.AnimationClip(vpd.name.replace(/\.vpd$/i, ''), 1, tracks);
  } else throw new Error('Choose a .vmd motion or a .vpd pose.');
  if (!clip.tracks.length) throw new Error(`None of the motion's bones are in ${model ? model.name : 'a standard MMD model'}: is it a camera motion?`);
  // A bone the motion doesn't key stays in its rest pose (MMD's relaxed arms), so it gets a
  // track too: the retargeter moves bones to a T-pose first and only tracks put them back.
  const keyed = new Set(clip.tracks.filter((t) => t.name.endsWith('.quaternion')).map((t) => t.name));
  for (const b of mesh.skeleton.bones) {
    const name = `.bones[${b.name}].quaternion`;
    if (!keyed.has(name)) clip.tracks.push(new THREE.QuaternionKeyframeTrack(name, [0], [0, 0, 0, 1]));
  }
  return { scene: mesh, animations: [clip], standIn: !model };
}
