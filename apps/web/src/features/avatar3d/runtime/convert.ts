/**
 * Motion import: any skeleton's animation → an Everloom clip on the canonical skeleton. Used by the
 * clip importer (GLB, VRMA, FBX, BVH; VMD via Blender) and by the tool that builds the bundled clips.
 *
 * The rig is brought to its corrected T-pose first (prepareRig); the animation then sets every
 * bone, and each frame is read back as canonical rotations relative to that T-pose.
 */
import * as THREE from 'three';
import { mapBones, type HumanBone, type RigBone } from '@everloom/engine';
import { emptyPose, prepareRig, readCanonical, type CanonicalPose } from './canonical';
import { encodeClip, type ClipJSON } from './clip';
import { nodeIndex } from './loader';

export interface MotionSource {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
  /** A file's own humanoid map (VRMA): canonical bone → node name in the file. */
  humanoid?: Partial<Record<HumanBone, string>> | null;
}

/** The skeleton's bones mapped to canonical ones (skinned bones, plain bones, or named nodes). */
export function rigBones(src: MotionSource): { bones: Partial<Record<HumanBone, THREE.Object3D>>; missing: HumanBone[]; convention: string } {
  const all: THREE.Object3D[] = [];
  src.scene.traverse((o) => {
    if ((o as THREE.Bone).isBone) all.push(o);
  });
  src.scene.traverse((o) => {
    const sk = (o as THREE.SkinnedMesh).skeleton;
    if (sk) for (const b of sk.bones) if (!all.includes(b)) all.push(b);
  });
  if (src.humanoid) {
    const nodes: THREE.Object3D[] = [];
    src.scene.traverse((o) => nodes.push(o));
    const find = nodeIndex(nodes);
    const bones: Partial<Record<HumanBone, THREE.Object3D>> = {};
    for (const [k, n] of Object.entries(src.humanoid)) {
      const o = n ? find(n) : undefined;
      if (o) bones[k as HumanBone] = o;
    }
    const missing = (['hips', 'spine', 'head', 'leftUpperArm', 'rightUpperArm', 'leftUpperLeg', 'rightUpperLeg'] as HumanBone[]).filter((b) => !bones[b]);
    return { bones, missing, convention: 'vrm' };
  }
  const set = new Set(all);
  const list: RigBone[] = all.map((b) => ({ name: b.name, parent: b.parent && set.has(b.parent) ? b.parent.name : null }));
  const m = mapBones(list);
  const find = nodeIndex(all);
  const bones: Partial<Record<HumanBone, THREE.Object3D>> = {};
  for (const [k, v] of Object.entries(m.map)) {
    const o = v ? find(v) : undefined;
    if (o) bones[k as HumanBone] = o;
  }
  return { bones, missing: m.missing, convention: m.convention };
}

export interface ConvertOptions {
  id: string;
  loop: boolean;
  fps?: number;
  /** Remove travel (root motion) so the character stays where it stands; sway and bounce stay. */
  inPlace?: boolean;
  source?: string;
  /** Seconds to keep (from the start); default the whole clip. */
  maxSeconds?: number;
}

export function convertMotion(src: MotionSource, animation: THREE.AnimationClip, o: ConvertOptions): ClipJSON {
  const fps = o.fps ?? 30;
  const { bones, missing } = rigBones(src);
  if (!bones.hips || missing.some((b) => ['hips', 'spine', 'head'].includes(b))) throw new Error(`The skeleton couldn't be matched to a human (missing ${missing.join(', ') || 'hips'})`);
  const rig = prepareRig(src.scene, bones);
  const mixer = new THREE.AnimationMixer(src.scene);
  const action = mixer.clipAction(animation);
  // A one-shot must not wrap: its last frame is the clip's end, not its start.
  if (!o.loop) {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  }
  action.play();
  const duration = Math.min(animation.duration, o.maxSeconds ?? Infinity);
  const frames = Math.max(2, Math.round(duration * fps) + (o.loop ? 0 : 1));
  const poses: CanonicalPose[] = [];
  for (let i = 0; i < frames; i++) {
    // From the start each time: a finished one-shot otherwise stops updating.
    action.reset();
    mixer.setTime(i / fps);
    src.scene.updateMatrixWorld(true);
    poses.push(readCanonical(rig, emptyPose()));
  }
  mixer.stopAllAction();
  if (o.inPlace !== false && poses.length > 1) {
    // Take out the straight-line drift of the hips over the clip (walking forward), keep the rest.
    const a = poses[0]!.hips.clone();
    const b = poses[poses.length - 1]!.hips.clone();
    poses.forEach((p, i) => {
      const k = i / (poses.length - 1);
      p.hips.x -= a.x + (b.x - a.x) * k;
      p.hips.z -= a.z + (b.z - a.z) * k;
    });
  }
  return encodeClip(o.id, fps, poses, o.loop, o.source);
}
