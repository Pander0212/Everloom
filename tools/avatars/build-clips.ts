/**
 * Converts the bundled CC0 animation libraries into Everloom canonical clips.
 *
 *   npx tsx tools/avatars/build-clips.ts <Universal Animation Library .glb> <Universal Animation Library 2 .glb>
 *
 * Output: apps/web/public/avatar/clips/<id>.json and index.json. Sources and licenses: CREDITS.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mapBones, type HumanBone, type RigBone } from '@everloom/engine';
import { applyCanonical, prepareRig, readCanonical, emptyPose, type CanonicalPose, type RigInfo } from '../../apps/web/src/features/avatar3d/runtime/canonical';
import { encodeClip } from '../../apps/web/src/features/avatar3d/runtime/clip';

const OUT = path.resolve('apps/web/public/avatar/clips');
const FPS = 30;

/** Everloom id → [library, clip name, loop, seconds to take (optional), reverse?] */
const PICK: Record<string, [1 | 2, string, boolean, number?]> = {
  idle: [1, 'Idle_Loop', true],
  talk: [1, 'Idle_Talking_Loop', true],
  dance: [1, 'Dance_Loop', true],
  sit: [1, 'Sitting_Idle_Loop', true],
  sit_talk: [1, 'Sitting_Talking_Loop', true],
  sit_enter: [1, 'Sitting_Enter', false],
  sit_exit: [1, 'Sitting_Exit', false],
  walk: [1, 'Walk_Loop', true],
  kneel: [1, 'Crouch_Idle_Loop', true],
  ready: [1, 'Sword_Idle', true],
  attack: [1, 'Sword_Attack', false],
  punch: [1, 'Punch_Jab', false],
  cast: [1, 'Spell_Simple_Shoot', false],
  hit: [1, 'Hit_Chest', false],
  defeat: [1, 'Death01', false],
  interact: [1, 'Interact', false],
  idle_confident: [2, 'Idle_FoldArms_Loop', true],
  shake_head: [2, 'Idle_No_Loop', false],
  nod: [2, 'Yes', false],
  lie_to_idle: [2, 'LayToIdle', false],
  drink: [2, 'Consume', false],
  defend: [2, 'Sword_Block', false],
  hit_big: [2, 'Hit_Knockback', false],
};

async function load(file: string) {
  const buf = readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise<any>((resolve, reject) => new GLTFLoader().parse(ab as ArrayBuffer, '', resolve, reject));
}

function rigOf(gltf: any) {
  const scene: THREE.Object3D = gltf.scene;
  let skinned: THREE.SkinnedMesh | null = null;
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && !skinned) skinned = o as THREE.SkinnedMesh;
  });
  if (!skinned) throw new Error('no skinned mesh');
  const sk = (skinned as THREE.SkinnedMesh).skeleton;
  const set = new Set(sk.bones);
  const list: RigBone[] = sk.bones.map((b) => ({ name: b.name, parent: b.parent && set.has(b.parent as THREE.Bone) ? b.parent.name : null }));
  const m = mapBones(list);
  if (m.missing.length) throw new Error(`unmapped: ${m.missing.join(', ')}`);
  const bones: Partial<Record<HumanBone, THREE.Object3D>> = {};
  for (const [k, v] of Object.entries(m.map)) bones[k as HumanBone] = sk.bones.find((b) => b.name === v)!;
  return { scene, bones, convention: m.convention };
}

function dirOf(rig: RigInfo, a: HumanBone, b: HumanBone) {
  rig.root.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(rig.bones[b]!.matrixWorld).sub(new THREE.Vector3().setFromMatrixPosition(rig.bones[a]!.matrixWorld)).normalize();
}

async function main() {
  const [lib1, lib2] = process.argv.slice(2);
  if (!lib1 || !lib2) throw new Error('usage: build-clips.ts <UAL.glb> <UAL2.glb>');
  mkdirSync(OUT, { recursive: true });
  const libs: Record<1 | 2, any> = { 1: await load(lib1), 2: await load(lib2) };
  const index: Array<{ id: string; frames: number; seconds: number; bytes: number; loop: boolean }> = [];
  for (const [id, [lib, name, loop]] of Object.entries(PICK)) {
    const gltf = libs[lib];
    const clip: THREE.AnimationClip | undefined = gltf.animations.find((a: THREE.AnimationClip) => a.name === name);
    if (!clip) {
      console.warn('missing clip', name);
      continue;
    }
    // A fresh rig for every clip: the mixer leaves bones where the last clip ended.
    const fresh = await load(lib === 1 ? lib1 : lib2);
    const { scene, bones } = rigOf(fresh);
    const rig = prepareRig(scene, bones);
    const mixer = new THREE.AnimationMixer(scene);
    // Drop root-bone translation so clips stay in place (hips motion is kept separately).
    const action = mixer.clipAction(clip);
    // A one-shot must not wrap: its last frame is the clip's end, not its start.
    if (!loop) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    action.play();
    const frames = Math.max(2, Math.round(clip.duration * FPS) + (loop ? 0 : 1));
    const poses: CanonicalPose[] = [];
    for (let i = 0; i < frames; i++) {
      action.reset();
      mixer.setTime(i / FPS);
      scene.updateMatrixWorld(true);
      poses.push(readCanonical(rig, emptyPose()));
    }
    // Round trip: replay the canonical poses on a second copy and compare limb directions with the original.
    const copy = rigOf(await load(lib === 1 ? lib1 : lib2));
    const rig2 = prepareRig(copy.scene, copy.bones);
    let worst = 0;
    for (let i = 0; i < frames; i += 5) {
      action.reset();
      mixer.setTime(i / FPS);
      scene.updateMatrixWorld(true);
      applyCanonical(rig2, poses[i]!);
      for (const [a, b] of [['leftUpperArm', 'leftLowerArm'], ['rightLowerArm', 'rightHand'], ['leftUpperLeg', 'leftLowerLeg'], ['rightLowerLeg', 'rightFoot'], ['neck', 'head']] as Array<[HumanBone, HumanBone]>) {
        worst = Math.max(worst, dirOf(rig, a, b).angleTo(dirOf(rig2, a, b)));
      }
    }
    const json = encodeClip(id, FPS, poses, loop, `Quaternius Universal Animation Library${lib === 2 ? ' 2' : ''} (CC0): ${name}`);
    const text = JSON.stringify(json);
    writeFileSync(path.join(OUT, `${id}.json`), text);
    index.push({ id, frames, seconds: Math.round((frames / FPS) * 100) / 100, bytes: text.length, loop });
    console.log(id.padEnd(16), name.padEnd(22), `${frames} frames`, `${(text.length / 1024).toFixed(1)} KB`, `${Object.keys(json.tracks).length} tracks`, `round trip ${((worst * 180) / Math.PI).toFixed(2)}°`);
    if (worst > (2 * Math.PI) / 180) throw new Error(`${id}: round trip off by more than 2°`);
  }
  writeFileSync(path.join(OUT, 'bundled.json'), JSON.stringify(index, null, 1));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
