/**
 * Unity's humanoid mapping, stored in a model's .meta (`ModelImporter.humanDescription.human`):
 * each entry names a transform of the model and the Unity "HumanTrait" bone it plays. That mapping
 * was set up (or checked) by the avatar's author in Unity, so it beats any guess from names.
 */
import { HUMANOID_BONES, type HumanBone } from '../avatar/skeleton.js';
import { asList, asMap, asNum, asStr, type YamlMap } from './yaml';

/** Unity HumanTrait names (as written in .meta files, fingers with spaces) → Everloom/VRM 1.0. */
const TRAIT: Record<string, HumanBone> = {
  Hips: 'hips', Spine: 'spine', Chest: 'chest', UpperChest: 'upperChest', Neck: 'neck', Head: 'head', Jaw: 'jaw', LeftEye: 'leftEye', RightEye: 'rightEye',
  LeftShoulder: 'leftShoulder', LeftUpperArm: 'leftUpperArm', LeftLowerArm: 'leftLowerArm', LeftHand: 'leftHand',
  RightShoulder: 'rightShoulder', RightUpperArm: 'rightUpperArm', RightLowerArm: 'rightLowerArm', RightHand: 'rightHand',
  LeftUpperLeg: 'leftUpperLeg', LeftLowerLeg: 'leftLowerLeg', LeftFoot: 'leftFoot', LeftToes: 'leftToes',
  RightUpperLeg: 'rightUpperLeg', RightLowerLeg: 'rightLowerLeg', RightFoot: 'rightFoot', RightToes: 'rightToes',
};
// Fingers: Unity's thumb proximal/intermediate/distal are VRM 1.0's metacarpal/proximal/distal.
for (const side of ['Left', 'Right'] as const) {
  const s = side.toLowerCase() as 'left' | 'right';
  TRAIT[`${side} Thumb Proximal`] = `${s}ThumbMetacarpal`;
  TRAIT[`${side} Thumb Intermediate`] = `${s}ThumbProximal`;
  TRAIT[`${side} Thumb Distal`] = `${s}ThumbDistal`;
  for (const f of ['Index', 'Middle', 'Ring', 'Little'] as const) {
    TRAIT[`${side} ${f} Proximal`] = `${s}${f}Proximal` as HumanBone;
    TRAIT[`${side} ${f} Intermediate`] = `${s}${f}Intermediate` as HumanBone;
    TRAIT[`${side} ${f} Distal`] = `${s}${f}Distal` as HumanBone;
  }
}

/** A HumanTrait name in any spelling ("LeftThumbProximal", "Left Thumb Proximal") → Everloom bone. */
export function humanTrait(name: string): HumanBone | null {
  if (TRAIT[name]) return TRAIT[name];
  const spaced = name.replace(/([a-z])([A-Z])/g, '$1 $2');
  // "Left Upper Arm" → "LeftUpperArm" for the body; fingers keep their spaces.
  const body = name.replace(/\s+/g, '');
  return TRAIT[body] ?? TRAIT[spaced] ?? null;
}

export interface UnityHumanoid {
  /** Everloom bone → the model's transform name. */
  bones: Partial<Record<HumanBone, string>>;
  /** 0 None, 1 Legacy, 2 Generic, 3 Humanoid. */
  animationType: number;
  /** Import scale (Unity's globalScale × useFileScale). */
  scale: number;
  /** HumanTrait names that weren't recognised. */
  unknown: string[];
}

export function readHumanoid(meta: YamlMap | undefined): UnityHumanoid | null {
  const imp = asMap(meta?.ModelImporter);
  if (!Object.keys(imp).length) return null;
  const hd = asMap(imp.humanDescription);
  const bones: Partial<Record<HumanBone, string>> = {};
  const unknown: string[] = [];
  for (const e of asList(hd.human).map(asMap)) {
    const bone = asStr(e.boneName);
    const trait = asStr(e.humanName);
    if (!bone || !trait) continue;
    const b = humanTrait(trait);
    if (b) bones[b] = bone;
    else unknown.push(trait);
  }
  const meshes = asMap(imp.meshes);
  const scale = asNum(meshes.globalScale, asNum(hd.globalScale, 1));
  return { bones, animationType: asNum(imp.animationType, 2), scale, unknown };
}

export const isHumanBone = (b: string): b is HumanBone => (HUMANOID_BONES as readonly string[]).includes(b);
