/**
 * Everloom's canonical humanoid skeleton. The names are VRM 1.0's humanoid bone names, the most
 * widely shared vocabulary for humanoid avatars. Every model is mapped onto these at import, and
 * every animation is stored for them once and retargeted to each model when it loads.
 */

export const HUMANOID_BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftEye', 'rightEye', 'jaw',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
  'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
  'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
  'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
  'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
  'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
  'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
  'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
  'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
  'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
  'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
] as const;
export type HumanBone = (typeof HUMANOID_BONES)[number];

/** Bones a model must have for body animation to work. */
export const REQUIRED_BONES: HumanBone[] = [
  'hips', 'spine', 'head',
  'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
];

/** The canonical parent of each bone (optional bones fall back to the nearest existing ancestor). */
export const HUMAN_PARENT: Record<HumanBone, HumanBone | null> = {
  hips: null, spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck', leftEye: 'head', rightEye: 'head', jaw: 'head',
  leftShoulder: 'upperChest', leftUpperArm: 'leftShoulder', leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm',
  rightShoulder: 'upperChest', rightUpperArm: 'rightShoulder', rightLowerArm: 'rightUpperArm', rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg', leftToes: 'leftFoot',
  rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg', rightToes: 'rightFoot',
  leftThumbMetacarpal: 'leftHand', leftThumbProximal: 'leftThumbMetacarpal', leftThumbDistal: 'leftThumbProximal',
  leftIndexProximal: 'leftHand', leftIndexIntermediate: 'leftIndexProximal', leftIndexDistal: 'leftIndexIntermediate',
  leftMiddleProximal: 'leftHand', leftMiddleIntermediate: 'leftMiddleProximal', leftMiddleDistal: 'leftMiddleIntermediate',
  leftRingProximal: 'leftHand', leftRingIntermediate: 'leftRingProximal', leftRingDistal: 'leftRingIntermediate',
  leftLittleProximal: 'leftHand', leftLittleIntermediate: 'leftLittleProximal', leftLittleDistal: 'leftLittleIntermediate',
  rightThumbMetacarpal: 'rightHand', rightThumbProximal: 'rightThumbMetacarpal', rightThumbDistal: 'rightThumbProximal',
  rightIndexProximal: 'rightHand', rightIndexIntermediate: 'rightIndexProximal', rightIndexDistal: 'rightIndexIntermediate',
  rightMiddleProximal: 'rightHand', rightMiddleIntermediate: 'rightMiddleProximal', rightMiddleDistal: 'rightMiddleIntermediate',
  rightRingProximal: 'rightHand', rightRingIntermediate: 'rightRingProximal', rightRingDistal: 'rightRingIntermediate',
  rightLittleProximal: 'rightHand', rightLittleIntermediate: 'rightLittleProximal', rightLittleDistal: 'rightLittleIntermediate',
};

/** The nearest ancestor of `bone` that the model actually has. */
export function existingParent(bone: HumanBone, has: (b: HumanBone) => boolean): HumanBone | null {
  let p = HUMAN_PARENT[bone];
  while (p && !has(p)) p = HUMAN_PARENT[p];
  return p;
}

export const isHumanBone = (s: string): s is HumanBone => (HUMANOID_BONES as readonly string[]).includes(s);

/** Mirror a left bone to its right twin and back. */
export function mirrorBone(b: HumanBone): HumanBone {
  if (b.startsWith('left')) return ('right' + b.slice(4)) as HumanBone;
  if (b.startsWith('right')) return ('left' + b.slice(5)) as HumanBone;
  return b;
}

/**
 * Regions of a body that clothes can hide (so skin doesn't poke through a garment). A base body
 * splits its mesh into these (by vertex group or by its dominant bone), and a garment lists the
 * regions it covers.
 */
export const BODY_REGIONS = [
  'head', 'neck', 'chest', 'belly', 'hips', 'upperArms', 'forearms', 'hands', 'thighs', 'knees', 'calves', 'feet',
] as const;
export type BodyRegion = (typeof BODY_REGIONS)[number];

/** Which region a vertex belongs to, by the canonical bone that moves it most. */
export const REGION_OF_BONE: Partial<Record<HumanBone, BodyRegion>> = {
  head: 'head', jaw: 'head', leftEye: 'head', rightEye: 'head', neck: 'neck',
  upperChest: 'chest', chest: 'chest', leftShoulder: 'chest', rightShoulder: 'chest', spine: 'belly', hips: 'hips',
  leftUpperArm: 'upperArms', rightUpperArm: 'upperArms', leftLowerArm: 'forearms', rightLowerArm: 'forearms',
  leftHand: 'hands', rightHand: 'hands',
  leftUpperLeg: 'thighs', rightUpperLeg: 'thighs', leftLowerLeg: 'calves', rightLowerLeg: 'calves',
  leftFoot: 'feet', rightFoot: 'feet', leftToes: 'feet', rightToes: 'feet',
};
export function regionOfBone(b: HumanBone): BodyRegion {
  if (REGION_OF_BONE[b]) return REGION_OF_BONE[b]!;
  if (/Thumb|Index|Middle|Ring|Little/.test(b)) return 'hands';
  return 'chest';
}
