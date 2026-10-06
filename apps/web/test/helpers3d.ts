/** Test helpers for the 3D runtime: loading fixture models in Node and building synthetic rigs. */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mapBones, type HumanBone, type RigBone } from '@everloom/engine';
import { decodeClip, type ClipJSON } from '../src/features/avatar3d/runtime/clip';

export const ROOT = new URL('../../../', import.meta.url);

export async function loadGlb(rel: string): Promise<any> {
  const buf = readFileSync(new URL(rel, ROOT));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((resolve, reject) => new GLTFLoader().parse(ab as ArrayBuffer, '', resolve, reject));
}

export function clip(id: string) {
  return decodeClip(JSON.parse(readFileSync(new URL(`apps/web/public/avatar/clips/${id}.json`, ROOT), 'utf8')) as ClipJSON);
}

/** Canonical bone → object, using the engine's automatic mapping. */
export function bonesOf(root: THREE.Object3D): Partial<Record<HumanBone, THREE.Object3D>> {
  const all: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) all.push(o);
  });
  const set = new Set(all);
  const list: RigBone[] = all.map((b) => ({ name: b.name, parent: b.parent && set.has(b.parent) ? b.parent.name : null }));
  const m = mapBones(list);
  if (m.missing.length) throw new Error(`unmapped: ${m.missing.join(', ')}`);
  const out: Partial<Record<HumanBone, THREE.Object3D>> = {};
  for (const [k, v] of Object.entries(m.map)) out[k as HumanBone] = all.find((b) => b.name === v)!;
  return out;
}

type Names = Record<string, string>;
const MIXAMO: Names = { hips: 'mixamorig:Hips', spine: 'mixamorig:Spine', chest: 'mixamorig:Spine1', upperChest: 'mixamorig:Spine2', neck: 'mixamorig:Neck', head: 'mixamorig:Head', LShoulder: 'mixamorig:LeftShoulder', LUpperArm: 'mixamorig:LeftArm', LLowerArm: 'mixamorig:LeftForeArm', LHand: 'mixamorig:LeftHand', LMiddle: 'mixamorig:LeftHandMiddle1', LUpperLeg: 'mixamorig:LeftUpLeg', LLowerLeg: 'mixamorig:LeftLeg', LFoot: 'mixamorig:LeftFoot', LToes: 'mixamorig:LeftToeBase' };
const MMD: Names = { hips: '下半身', spine: '上半身', chest: '上半身2', neck: '首', head: '頭', LShoulder: '左肩', LUpperArm: '左腕', LLowerArm: '左ひじ', LHand: '左手首', LMiddle: '左中指１', LUpperLeg: '左足', LLowerLeg: '左ひざ', LFoot: '左足首', LToes: '左つま先' };

/**
 * A stick-figure humanoid with named bones. `armDown` tilts the rest arms (0 = T-pose, 45 = A-pose);
 * `legs` and `arms` scale those lengths; `backwards` makes it face -Z; `scale` scales everything.
 */
export function syntheticRig(conv: 'mixamo' | 'mmd', o: { armDown?: number; legs?: number; arms?: number; backwards?: boolean; scale?: number; twist?: boolean } = {}) {
  const N = conv === 'mixamo' ? MIXAMO : MMD;
  const name = (k: string, side: 'L' | 'R') => {
    const base = N[`L${k}`]!;
    return side === 'L' ? base : conv === 'mixamo' ? base.replace('Left', 'Right') : base.replace('左', '右');
  };
  const s = o.scale ?? 1;
  const legs = (o.legs ?? 1) * 0.9 * s;
  const arms = (o.arms ?? 1) * 0.28 * s;
  const a = ((o.armDown ?? 0) * Math.PI) / 180;
  const root = new THREE.Object3D();
  root.name = 'Armature';
  const bone = (n: string, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const b = new THREE.Bone();
    b.name = n;
    b.position.set(x, y, z);
    parent.add(b);
    return b;
  };
  const hips = bone(N.hips!, root, 0, legs + 0.05 * s, 0);
  const spine = bone(N.spine!, hips, 0, 0.12 * s, 0);
  const chest = bone(N.chest!, spine, 0, 0.14 * s, 0);
  const top = N.upperChest ? bone(N.upperChest, chest, 0, 0.12 * s, 0) : chest;
  const neck = bone(N.neck!, top, 0, 0.12 * s, 0);
  bone(N.head!, neck, 0, 0.1 * s, 0);
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    const sh = bone(name('Shoulder', side), top, 0.04 * s * sx, 0.08 * s, 0);
    // MMD rigs put a twist bone between the upper arm and the elbow.
    let ua: THREE.Object3D = bone(name('UpperArm', side), sh, 0.12 * s * sx, 0, 0);
    const dir = new THREE.Vector3(Math.cos(a) * sx, -Math.sin(a), 0);
    if (o.twist && conv === 'mmd') ua = bone(side === 'L' ? '左腕捩' : '右腕捩', ua, dir.x * arms * 0.5, dir.y * arms * 0.5, 0);
    const half = o.twist && conv === 'mmd' ? 0.5 : 1;
    const la = bone(name('LowerArm', side), ua, dir.x * arms * half, dir.y * arms * half, 0);
    const hand = bone(name('Hand', side), la, dir.x * arms, dir.y * arms, 0);
    bone(name('Middle', side), hand, dir.x * 0.08 * s, dir.y * 0.08 * s, 0);
    const ul = bone(name('UpperLeg', side), hips, 0.1 * s * sx, -0.05 * s, 0);
    const ll = bone(name('LowerLeg', side), ul, 0, -legs / 2, 0);
    const ft = bone(name('Foot', side), ll, 0, -legs / 2 + 0.06 * s, 0);
    bone(name('Toes', side), ft, 0, -0.05 * s, 0.12 * s);
  }
  if (o.backwards) root.rotation.y = Math.PI;
  const scene = new THREE.Group();
  scene.add(root);
  scene.updateMatrixWorld(true);
  return scene;
}

/** World direction from one canonical bone to another, in the rig's facing frame. */
export function boneDir(rig: { root: THREE.Object3D; facing: THREE.Quaternion; bones: Partial<Record<HumanBone, THREE.Object3D>> }, a: HumanBone, b: HumanBone): THREE.Vector3 {
  rig.root.updateMatrixWorld(true);
  const pa = new THREE.Vector3().setFromMatrixPosition(rig.bones[a]!.matrixWorld);
  const pb = new THREE.Vector3().setFromMatrixPosition(rig.bones[b]!.matrixWorld);
  const rootQ = new THREE.Quaternion();
  rig.root.matrixWorld.decompose(new THREE.Vector3(), rootQ, new THREE.Vector3());
  return pb.sub(pa).applyQuaternion(rootQ.invert()).applyQuaternion(rig.facing.clone().invert()).normalize();
}

/** Lowest foot height above the floor, per hips height, in the root's space. */
export function footClearance(rig: { root: THREE.Object3D; hipsHeight: number; bones: Partial<Record<HumanBone, THREE.Object3D>> }, floorY: number): number {
  rig.root.updateMatrixWorld(true);
  const inv = rig.root.matrixWorld.clone().invert();
  const ys = (['leftFoot', 'rightFoot', 'leftToes', 'rightToes'] as HumanBone[]).filter((b) => rig.bones[b]).map((b) => new THREE.Vector3().setFromMatrixPosition(rig.bones[b]!.matrixWorld).applyMatrix4(inv).y);
  return (Math.min(...ys) - floorY) / rig.hipsHeight;
}
