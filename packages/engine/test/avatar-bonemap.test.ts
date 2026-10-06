import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { boneWords, mapBones, type RigBone } from '../src/avatar/bonemap.js';
import { REQUIRED_BONES } from '../src/avatar/skeleton.js';

const fixture = (name: string): RigBone[] => JSON.parse(readFileSync(new URL(`../../../tests/fixtures/avatars/skeletons/${name}.json`, import.meta.url), 'utf8'));

/** Builds a rig from chains: [parent, child, child…] where each child hangs off the previous. */
function rig(...chains: string[][]): RigBone[] {
  const out = new Map<string, RigBone>();
  for (const c of chains) {
    c.forEach((n, i) => {
      if (!out.has(n)) out.set(n, { name: n, parent: i === 0 ? null : c[i - 1]! });
    });
  }
  // The first element of a chain after the first may already exist (a branch point).
  return [...out.values()];
}

const mixamo = (p = 'mixamorig:') => {
  const s = (side: string) => [
    [`${p}Spine2`, `${p}${side}Shoulder`, `${p}${side}Arm`, `${p}${side}ForeArm`, `${p}${side}Hand`],
    ...['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].map((f) => [`${p}${side}Hand`, ...[1, 2, 3, 4].map((i) => `${p}${side}Hand${f}${i}`)]),
    [`${p}Hips`, `${p}${side}UpLeg`, `${p}${side}Leg`, `${p}${side}Foot`, `${p}${side}ToeBase`, `${p}${side}Toe_End`],
  ];
  return rig([`${p}Hips`, `${p}Spine`, `${p}Spine1`, `${p}Spine2`, `${p}Neck`, `${p}Head`, `${p}HeadTop_End`], [`${p}Head`, `${p}LeftEye`], [`${p}Head`, `${p}RightEye`], ...s('Left'), ...s('Right'));
};

const vroid = () => {
  const s = (S: string) => [
    ['J_Bip_C_UpperChest', `J_Bip_${S}_Shoulder`, `J_Bip_${S}_UpperArm`, `J_Bip_${S}_LowerArm`, `J_Bip_${S}_Hand`],
    ...['Thumb', 'Index', 'Middle', 'Ring', 'Little'].map((f) => [`J_Bip_${S}_Hand`, `J_Bip_${S}_${f}1`, `J_Bip_${S}_${f}2`, `J_Bip_${S}_${f}3`]),
    ['J_Bip_C_Hips', `J_Bip_${S}_UpperLeg`, `J_Bip_${S}_LowerLeg`, `J_Bip_${S}_Foot`, `J_Bip_${S}_ToeBase`],
    ['J_Bip_C_Head', `J_Adj_${S}_FaceEye`],
  ];
  return rig(['Root', 'J_Bip_C_Hips', 'J_Bip_C_Spine', 'J_Bip_C_Chest', 'J_Bip_C_UpperChest', 'J_Bip_C_Neck', 'J_Bip_C_Head'], ['J_Bip_C_Head', 'J_Sec_Hair1_01', 'J_Sec_Hair2_01'], ...s('L'), ...s('R'));
};

/** A full Rigify DEF rig: limbs split into .001 segments, the head is spine.006. */
const rigify = () => {
  const s = (S: string) => [
    ['DEF-spine.003', `DEF-shoulder.${S}`, `DEF-upper_arm.${S}`, `DEF-upper_arm.${S}.001`, `DEF-forearm.${S}`, `DEF-forearm.${S}.001`, `DEF-hand.${S}`],
    ...['thumb', 'f_index', 'f_middle', 'f_ring', 'f_pinky'].map((f) => [`DEF-hand.${S}`, `DEF-${f}.01.${S}`, `DEF-${f}.02.${S}`, `DEF-${f}.03.${S}`]),
    ['DEF-spine', `DEF-thigh.${S}`, `DEF-thigh.${S}.001`, `DEF-shin.${S}`, `DEF-shin.${S}.001`, `DEF-foot.${S}`, `DEF-toe.${S}`],
  ];
  return rig(['DEF-spine', 'DEF-spine.001', 'DEF-spine.002', 'DEF-spine.003', 'DEF-spine.004', 'DEF-spine.005', 'DEF-spine.006'], ...s('L'), ...s('R'));
};

/** An MMD rig: Japanese names, twist bones inside the arm chain, IK bones beside the legs. */
const mmd = () => {
  const s = (S: '左' | '右') => [
    ['上半身2', `${S}肩`, `${S}腕`, `${S}腕捩`, `${S}ひじ`, `${S}手捩`, `${S}手首`],
    [`${S}手首`, `${S}親指０`, `${S}親指１`, `${S}親指２`, `${S}親指先`],
    [`${S}手首`, `${S}人指１`, `${S}人指２`, `${S}人指３`],
    [`${S}手首`, `${S}中指１`, `${S}中指２`, `${S}中指３`],
    [`${S}手首`, `${S}薬指１`, `${S}薬指２`, `${S}薬指３`],
    [`${S}手首`, `${S}小指１`, `${S}小指２`, `${S}小指３`],
    ['下半身', `${S}足`, `${S}ひざ`, `${S}足首`, `${S}つま先`],
    ['センター', `${S}足ＩＫ`, `${S}つま先ＩＫ`],
    ['頭', `${S}目`],
  ];
  return rig(['全ての親', 'センター', 'グルーブ', '上半身', '上半身2', '首', '頭'], ['グルーブ', '下半身'], ...s('左'), ...s('右'));
};

function expectComplete(r: ReturnType<typeof mapBones>) {
  expect(r.missing).toEqual([]);
  for (const b of REQUIRED_BONES) expect(r.map[b], b).toBeTruthy();
  // Left and right never swap.
  expect(r.map.leftHand).not.toBe(r.map.rightHand);
}

describe('bone mapping', () => {
  it('reads side and words from every convention', () => {
    expect(boneWords('mixamorig:LeftForeArm')).toMatchObject({ side: 'left', joined: 'forearm' });
    expect(boneWords('DEF-upper_arm.L')).toMatchObject({ side: 'left', joined: 'upperarm' });
    expect(boneWords('upperarm_r')).toMatchObject({ side: 'right', joined: 'upperarm' });
    expect(boneWords('J_Bip_L_UpperArm')).toMatchObject({ side: 'left', joined: 'upperarm' });
    expect(boneWords('右ひじ')).toMatchObject({ side: 'right', joined: 'ひじ' });
    expect(boneWords('Bip01 L Thigh')).toMatchObject({ side: 'left', joined: 'thigh' });
  });

  it('Mixamo', () => {
    const r = mapBones(mixamo());
    expectComplete(r);
    expect(r.convention).toBe('mixamo');
    expect(r.map).toMatchObject({ hips: 'mixamorig:Hips', spine: 'mixamorig:Spine', chest: 'mixamorig:Spine1', upperChest: 'mixamorig:Spine2', neck: 'mixamorig:Neck', head: 'mixamorig:Head' });
    // "Leg" is the shin in Mixamo; "UpLeg" the thigh.
    expect(r.map).toMatchObject({ leftUpperLeg: 'mixamorig:LeftUpLeg', leftLowerLeg: 'mixamorig:LeftLeg', leftFoot: 'mixamorig:LeftFoot', leftToes: 'mixamorig:LeftToeBase' });
    expect(r.map).toMatchObject({ leftShoulder: 'mixamorig:LeftShoulder', leftUpperArm: 'mixamorig:LeftArm', leftLowerArm: 'mixamorig:LeftForeArm' });
    expect(r.map).toMatchObject({ leftThumbMetacarpal: 'mixamorig:LeftHandThumb1', leftIndexDistal: 'mixamorig:LeftHandIndex3', rightLittleProximal: 'mixamorig:RightHandPinky1', leftEye: 'mixamorig:LeftEye' });
    // Without the namespace too.
    expectComplete(mapBones(mixamo('')));
  });

  it('VRoid (J_Bip names), ignoring hair and skirt bones', () => {
    const r = mapBones(vroid());
    expectComplete(r);
    expect(r.convention).toBe('vroid');
    expect(r.map).toMatchObject({ hips: 'J_Bip_C_Hips', spine: 'J_Bip_C_Spine', chest: 'J_Bip_C_Chest', upperChest: 'J_Bip_C_UpperChest', neck: 'J_Bip_C_Neck', head: 'J_Bip_C_Head', rightEye: 'J_Adj_R_FaceEye', leftMiddleIntermediate: 'J_Bip_L_Middle2' });
    expect(Object.values(r.map).some((n) => /Sec/.test(n!))).toBe(false);
  });

  it('a VRM humanoid map wins, and VRM 0.x thumbs are renamed', () => {
    const bones = vroid();
    const r = mapBones(bones, { hips: 'J_Bip_C_Hips', head: 'J_Bip_C_Head', leftThumbProximal: 'J_Bip_L_Thumb1', leftThumbIntermediate: 'J_Bip_L_Thumb2', leftThumbDistal: 'J_Bip_L_Thumb3', nonsense: 'nope' });
    expect(r.convention).toBe('vrm');
    expect(r.map).toMatchObject({ leftThumbMetacarpal: 'J_Bip_L_Thumb1', leftThumbProximal: 'J_Bip_L_Thumb2', leftThumbDistal: 'J_Bip_L_Thumb3' });
    expect(r.missing).toContain('leftHand');
  });

  it('Rigify: segments merge, and the head is found without a "head" name', () => {
    const r = mapBones(rigify());
    expectComplete(r);
    expect(r.convention).toBe('rigify');
    expect(r.map).toMatchObject({ hips: 'DEF-spine', head: 'DEF-spine.006', neck: 'DEF-spine.004', spine: 'DEF-spine.001', upperChest: 'DEF-spine.003' });
    // The topmost segment of each limb drives it.
    expect(r.map).toMatchObject({ leftUpperArm: 'DEF-upper_arm.L', leftLowerArm: 'DEF-forearm.L', leftUpperLeg: 'DEF-thigh.L', leftLowerLeg: 'DEF-shin.L', leftToes: 'DEF-toe.L' });
    expect(r.map).toMatchObject({ leftThumbMetacarpal: 'DEF-thumb.01.L', leftRingDistal: 'DEF-f_ring.03.L' });
  });

  it('Quaternius Universal Animation Library (Rigify-style DEF names, real file)', () => {
    const r = mapBones(fixture('quaternius-ual1'));
    expectComplete(r);
    expect(r.map).toMatchObject({ hips: 'DEF-hips', head: 'DEF-head', neck: 'DEF-neck', leftUpperArm: 'DEF-upper_arm.L', rightFoot: 'DEF-foot.R', leftToes: 'DEF-toe.L' });
  });

  it('Unreal mannequin (Universal Animation Library 2, real file)', () => {
    const r = mapBones(fixture('quaternius-ual2'));
    expectComplete(r);
    expect(r.convention).toBe('unreal');
    expect(r.map).toMatchObject({ hips: 'pelvis', spine: 'spine_01', chest: 'spine_02', upperChest: 'spine_03', neck: 'neck_01', head: 'Head' });
    expect(r.map).toMatchObject({ leftShoulder: 'clavicle_l', leftUpperArm: 'upperarm_l', leftLowerArm: 'lowerarm_l', leftHand: 'hand_l', rightUpperLeg: 'thigh_r', rightLowerLeg: 'calf_r', rightToes: 'ball_r' });
    expect(r.map).toMatchObject({ leftIndexProximal: 'index_01_l', leftIndexDistal: 'index_03_l' });
    expect(Object.values(r.map).some((n) => /leaf/.test(n!))).toBe(false);
  });

  it('MMD: Japanese names, twist bones in the arm, IK bones skipped', () => {
    const r = mapBones(mmd());
    expectComplete(r);
    expect(r.convention).toBe('mmd');
    expect(r.map).toMatchObject({ spine: '上半身', chest: '上半身2', neck: '首', head: '頭' });
    expect(r.map).toMatchObject({ leftShoulder: '左肩', leftUpperArm: '左腕', leftLowerArm: '左ひじ', leftHand: '左手首' });
    expect(r.map).toMatchObject({ rightUpperLeg: '右足', rightLowerLeg: '右ひざ', rightFoot: '右足首', rightToes: '右つま先', leftEye: '左目' });
    expect(r.map).toMatchObject({ leftThumbMetacarpal: '左親指０', leftThumbDistal: '左親指２', leftLittleDistal: '左小指３' });
    // Hips: the common ancestor of legs and spine.
    expect(['グルーブ', 'センター']).toContain(r.map.hips);
    expect(Object.values(r.map).some((n) => /ＩＫ|捩/.test(n!))).toBe(false);
  });

  it('says what is missing on a rig it cannot read', () => {
    const r = mapBones(rig(['Root', 'Body', 'Thing1', 'Thing2']));
    expect(r.missing).toEqual(expect.arrayContaining(['hips', 'head', 'leftHand', 'rightFoot']));
  });
});
