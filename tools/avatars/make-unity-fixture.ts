/**
 * Everloom's own Unity test packages (CC0, built from Everloom's test models): an avatar package
 * laid out like a BOOTH VRChat avatar (FBX with a humanoid .meta, lilToon materials, a prefab with
 * a VRChat descriptor, PhysBones, a blendshape preset, a hidden hat with a Modular Avatar toggle)
 * and a clothing package made for it (Merge Armature with a bone prefix). Also the avatar as an
 * extracted folder, with and without its .meta files.
 *
 *   blender -b --factory-startup -P tools/avatars/unity-fixture.py -- tests/fixtures/avatars/models <tmp>
 *   npx tsx tools/avatars/make-unity-fixture.ts <tmp>
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { writeTar } from '../../packages/engine/src/unity/tar';

const fbxDir = process.argv[2];
if (!fbxDir) throw new Error('usage: make-unity-fixture.ts <dir with Ava.fbx and Shirt.fbx>');
const OUT = 'tests/fixtures/unity';

const G = {
  avaFbx: '1a0e0000000000000000000000000001',
  avaPrefab: '1a0e0000000000000000000000000002',
  bodyMat: '1a0e0000000000000000000000000003',
  bodyTex: '1a0e0000000000000000000000000004',
  hatMat: '1a0e0000000000000000000000000005',
  readme: '1a0e0000000000000000000000000006',
  script: '1a0e0000000000000000000000000007',
  folder: '1a0e0000000000000000000000000008',
  shirtFbx: '1a0e0000000000000000000000000011',
  shirtPrefab: '1a0e0000000000000000000000000012',
  shirtMat: '1a0e0000000000000000000000000013',
  shirtTex: '1a0e0000000000000000000000000014',
};
// lilToon's shader GUID is not needed: the material is recognised by its properties.
const LILTOON_SHADER = '{fileID: 4800000, guid: df12117ecd77c31469c224178886498e, type: 3}';
const PHYSBONE = '{fileID: 1661641543, guid: 2a2c05204084d904aa4945ccff20d8e5, type: 3}';
const DESCRIPTOR = '{fileID: 542108242, guid: 67cc4cb7839cd3741b63733d5adf0442, type: 3}';
const MERGE_ARMATURE = '{fileID: 11500000, guid: 2df373bf91cf30b4bbd495e11cb1a2ec, type: 3}';
const OBJECT_TOGGLE = '{fileID: 11500000, guid: a162bb8ec7e24a5abcf457887f1df3fa, type: 3}';
const MENU_ITEM = '{fileID: 11500000, guid: 3b29d45007c5493d926d2cd45a489529, type: 3}';

// File ids of the FBX's objects, as Unity lists them in internalIDToNameTable.
const AVA_IDS: [number, string, string][] = [
  [1, '919132149155446097', 'Ava'],
  [1, '100001', 'Body'],
  [1, '100002', 'Hat'],
  [1, '100003', 'Armature'],
  [1, '100004', 'Hair_Back_1'],
  [1, '100005', 'breast_l'],
  [1, '100006', 'breast_r'],
  [1, '100007', 'head'],
  [1, '100010', 'Eyes'],
  [4, '400004', 'Hair_Back_1'],
  [4, '400005', 'breast_l'],
  [4, '400006', 'breast_r'],
  [4, '400007', 'head'],
  [137, '13700001', 'Body'],
  [137, '13700002', 'Hat'],
];
const JACKET_IDS: [number, string, string][] = [
  [1, '919132149155446097', 'Shirt'],
  [1, '200001', 'Shirt'],
  [1, '200002', 'Armature'],
  [137, '13700011', 'Shirt'],
];

const human: [string, string][] = [
  ['pelvis', 'Hips'], ['上半身', 'Spine'], ['spine_02', 'Chest'], ['spine_03', 'UpperChest'], ['首', 'Neck'], ['head', 'Head'],
  ['clavicle_l', 'LeftShoulder'], ['upperarm_l', 'LeftUpperArm'], ['lowerarm_l', 'LeftLowerArm'], ['hand_l', 'LeftHand'],
  ['clavicle_r', 'RightShoulder'], ['upperarm_r', 'RightUpperArm'], ['lowerarm_r', 'RightLowerArm'], ['hand_r', 'RightHand'],
  ['thigh_l', 'LeftUpperLeg'], ['calf_l', 'LeftLowerLeg'], ['foot_l', 'LeftFoot'], ['ball_l', 'LeftToes'],
  ['thigh_r', 'RightUpperLeg'], ['calf_r', 'RightLowerLeg'], ['foot_r', 'RightFoot'], ['ball_r', 'RightToes'],
  ['thumb_01_l', 'Left Thumb Proximal'], ['thumb_02_l', 'Left Thumb Intermediate'], ['thumb_03_l', 'Left Thumb Distal'],
  ['index_01_l', 'Left Index Proximal'], ['index_02_l', 'Left Index Intermediate'], ['index_03_l', 'Left Index Distal'],
  ['thumb_01_r', 'Right Thumb Proximal'], ['thumb_02_r', 'Right Thumb Intermediate'], ['thumb_03_r', 'Right Thumb Distal'],
  ['index_01_r', 'Right Index Proximal'], ['index_02_r', 'Right Index Intermediate'], ['index_03_r', 'Right Index Distal'],
];

const yamlString = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `"${[...s].map((c) => (c.charCodeAt(0) > 127 ? `\\u${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}` : c)).join('')}"`);

function modelMeta(guid: string, ids: [number, string, string][], humanoid: boolean, materials: [string, string][]) {
  return `fileFormatVersion: 2
guid: ${guid}
ModelImporter:
  serializedVersion: 22200
  internalIDToNameTable:
${ids.map(([c, id, n]) => `  - first:\n      ${c}: ${id}\n    second: ${yamlString(n)}`).join('\n')}
  externalObjects:
${materials.map(([name, g]) => `  - first:\n      type: UnityEngine:Material\n      assembly: UnityEngine.CoreModule\n      name: ${name}\n    second: {fileID: 2100000, guid: ${g}, type: 2}`).join('\n')}
  materials:
    materialImportMode: 2
  meshes:
    globalScale: 1
  animationType: ${humanoid ? 3 : 2}
  avatarSetup: ${humanoid ? 1 : 0}
  humanDescription:
    serializedVersion: 3
    human:
${humanoid ? human.map(([b, h]) => `    - boneName: ${yamlString(b)}\n      humanName: ${h}\n      limit:\n        min: {x: 0, y: 0, z: 0}\n        max: {x: 0, y: 0, z: 0}\n        value: {x: 0, y: 0, z: 0}\n        length: 0\n        modified: 0`).join('\n') : '    []'}
    skeleton: []
  userData:
  assetBundleName:
`;
}

const textureMeta = (guid: string) => `fileFormatVersion: 2
guid: ${guid}
TextureImporter:
  serializedVersion: 12
  mipmaps:
    sRGBTexture: 1
  textureType: 0
  alphaIsTransparency: 1
`;

const simpleMeta = (guid: string, importer = 'DefaultImporter', extra = '') => `fileFormatVersion: 2
guid: ${guid}
${importer}:
  externalObjects: {}
${extra}  userData:
`;

function lilMat(name: string, tex: string, color: string, shadow: string, cutout = false) {
  return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!21 &2100000
Material:
  serializedVersion: 8
  m_ObjectHideFlags: 0
  m_Name: ${name}
  m_Shader: ${LILTOON_SHADER}
  m_ValidKeywords: []
  m_CustomRenderQueue: ${cutout ? 2450 : 2000}
  m_SavedProperties:
    serializedVersion: 3
    m_TexEnvs:
    - _MainTex:
        m_Texture: {fileID: 2800000, guid: ${tex}, type: 3}
        m_Scale: {x: 1, y: 1}
        m_Offset: {x: 0, y: 0}
    - _ShadowColorTex:
        m_Texture: {fileID: 0}
        m_Scale: {x: 1, y: 1}
        m_Offset: {x: 0, y: 0}
    m_Ints: []
    m_Floats:
    - _Cull: 2
    - _Cutoff: 0.5
    - _TransparentMode: ${cutout ? 1 : 0}
    - _UseShadow: 1
    - _ShadowBorder: 0.5
    - _UseRim: 1
    - _lilToonVersion: 44
    m_Colors:
    - _Color: ${color}
    - _ShadowColor: ${shadow}
    - _RimColor: {r: 0.9, g: 0.85, b: 1, a: 1}
`;
}

const plainMat = (name: string, color: string) => `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!21 &2100000
Material:
  m_Name: ${name}
  m_Shader: {fileID: 46, guid: 0000000000000000f000000000000000, type: 0}
  m_SavedProperties:
    m_TexEnvs: []
    m_Floats:
    - _Glossiness: 0.3
    - _Metallic: 0
    - _Mode: 0
    m_Colors:
    - _Color: ${color}
`;

function physBone(id: string, go: string, root: string, pull: number, spring: number, gravity: number) {
  return `--- !u!114 &${id}
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_GameObject: {fileID: ${go}}
  m_Enabled: 1
  m_Script: ${PHYSBONE}
  m_Name:
  version: 1
  integrationType: 1
  rootTransform: {fileID: ${root}}
  ignoreTransforms: []
  endpointPosition: {x: 0, y: 0, z: 0}
  multiChildType: 0
  pull: ${pull}
  pullCurve:
    serializedVersion: 2
    m_Curve: []
  spring: ${spring}
  stiffness: 0.2
  gravity: ${gravity}
  gravityFalloff: 0
  immobileType: 0
  immobile: 0
  allowCollision: 1
  radius: 0.02
  colliders: []
  limitType: 0
  maxAngleX: 45
`;
}

const stripped = (cls: number, type: string, id: string, src: string, guid: string, inst: string) => `--- !u!${cls} &${id} stripped
${type}:
  m_CorrespondingSourceObject: {fileID: ${src}, guid: ${guid}, type: 3}
  m_PrefabInstance: {fileID: ${inst}}
  m_PrefabAsset: {fileID: 0}
`;

const visemes = ['vrc.v_sil', 'vrc.v_pp', 'vrc.v_ff', 'vrc.v_th', 'vrc.v_dd', 'vrc.v_kk', 'vrc.v_ch', 'vrc.v_ss', 'vrc.v_nn', 'vrc.v_rr', 'vrc.v_aa', 'vrc.v_e', 'vrc.v_ih', 'vrc.v_oh', 'vrc.v_ou'];

// Body shape keys in the FBX are: Breast_Large (1), …, eyeBlinkLeft (18), eyeBlinkRight (19), … (Basis isn't counted).
const avaPrefab = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1001 &5000000000000000001
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    serializedVersion: 3
    m_TransformParent: {fileID: 0}
    m_Modifications:
    - target: {fileID: 919132149155446097, guid: ${G.avaFbx}, type: 3}
      propertyPath: m_Name
      value: Ava
      objectReference: {fileID: 0}
    - target: {fileID: 100002, guid: ${G.avaFbx}, type: 3}
      propertyPath: m_IsActive
      value: 0
      objectReference: {fileID: 0}
    - target: {fileID: 13700001, guid: ${G.avaFbx}, type: 3}
      propertyPath: m_BlendShapeWeights.Array.data[0]
      value: 40
      objectReference: {fileID: 0}
    - target: {fileID: 13700001, guid: ${G.avaFbx}, type: 3}
      propertyPath: m_BlendShapeWeights.Array.data[6]
      value: 25
      objectReference: {fileID: 0}
    m_RemovedComponents: []
    m_RemovedGameObjects: []
    m_AddedGameObjects: []
    m_AddedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${G.avaFbx}, type: 3}
${stripped(1, 'GameObject', '6000000000000000001', '919132149155446097', G.avaFbx, '5000000000000000001')}${stripped(1, 'GameObject', '6000000000000000002', '100004', G.avaFbx, '5000000000000000001')}${stripped(4, 'Transform', '6000000000000000003', '400004', G.avaFbx, '5000000000000000001')}${stripped(1, 'GameObject', '6000000000000000004', '100005', G.avaFbx, '5000000000000000001')}${stripped(4, 'Transform', '6000000000000000005', '400005', G.avaFbx, '5000000000000000001')}${stripped(1, 'GameObject', '6000000000000000006', '100006', G.avaFbx, '5000000000000000001')}${stripped(4, 'Transform', '6000000000000000007', '400006', G.avaFbx, '5000000000000000001')}${stripped(137, 'SkinnedMeshRenderer', '6000000000000000008', '13700001', G.avaFbx, '5000000000000000001')}${stripped(1, 'GameObject', '6000000000000000009', '100002', G.avaFbx, '5000000000000000001')}--- !u!114 &7000000000000000001
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_GameObject: {fileID: 6000000000000000001}
  m_Enabled: 1
  m_Script: ${DESCRIPTOR}
  m_Name:
  Name:
  ViewPosition: {x: 0, y: 1.52, z: 0.08}
  Animations: 0
  ScaleIPD: 1
  lipSync: 3
  lipSyncJawBone: {fileID: 0}
  VisemeSkinnedMesh: {fileID: 6000000000000000008}
  MouthOpenBlendShapeName: Facial_Blends.Jaw_Down
  VisemeBlendShapes:
${visemes.map((v) => `  - ${v}`).join('\n')}
  enableEyeLook: 1
  customEyeLookSettings:
    eyeMovement:
      confidence: 0.5
      excitement: 0.5
    leftEye: {fileID: 0}
    rightEye: {fileID: 0}
    eyelidType: 2
    eyelidsSkinnedMesh: {fileID: 6000000000000000008}
    eyelidsBlendshapes: 11000000ffffffffffffffff
  customizeAnimationLayers: 0
  baseAnimationLayers: []
  specialAnimationLayers: []
  expressionsMenu: {fileID: 0}
  expressionParameters: {fileID: 0}
${physBone('7000000000000000002', '6000000000000000002', '6000000000000000003', 0.2, 0.4, 0.1)}${physBone('7000000000000000003', '6000000000000000004', '6000000000000000005', 0.15, 0.6, 0.05)}${physBone('7000000000000000004', '6000000000000000006', '6000000000000000007', 0.15, 0.6, 0.05)}--- !u!114 &7000000000000000005
MonoBehaviour:
  m_GameObject: {fileID: 6000000000000000009}
  m_Enabled: 1
  m_Script: ${OBJECT_TOGGLE}
  m_objects:
  - Object:
      referencePath: Hat
      targetObject: {fileID: 6000000000000000009}
    Active: 1
  m_inverted: 0
--- !u!114 &7000000000000000006
MonoBehaviour:
  m_GameObject: {fileID: 6000000000000000009}
  m_Enabled: 1
  m_Script: ${MENU_ITEM}
  Control:
    name: Hat
    type: 102
  MenuSource: 1
  isSynced: 1
`;

const shirtPrefab = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1001 &5100000000000000001
PrefabInstance:
  m_Modification:
    m_TransformParent: {fileID: 0}
    m_Modifications:
    - target: {fileID: 919132149155446097, guid: ${G.shirtFbx}, type: 3}
      propertyPath: m_Name
      value: Shirt
      objectReference: {fileID: 0}
    m_RemovedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${G.shirtFbx}, type: 3}
${stripped(1, 'GameObject', '6100000000000000001', '200002', G.shirtFbx, '5100000000000000001')}--- !u!114 &7100000000000000001
MonoBehaviour:
  m_GameObject: {fileID: 6100000000000000001}
  m_Enabled: 1
  m_Script: ${MERGE_ARMATURE}
  mergeTarget:
    referencePath: Armature
    targetObject: {fileID: 0}
  prefix: Outfit_
  suffix:
  locked: 0
  mangleNames: 1
`;

const README = `Ava test avatar (Everloom test fixture)

Made by Everloom from its own CC0 test models. CC0 1.0: no rights reserved.
Laid out like a VRChat avatar sold on BOOTH, to test Unity package import.
`;

async function main() {
  const png = (r: number, g: number, b: number) => sharp({ create: { width: 64, height: 64, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer();
  const enc = new TextEncoder();
  const avaFiles: { path: string; guid: string; data: Uint8Array; meta: string }[] = [
    { path: 'Assets/Ava', guid: G.folder, data: new Uint8Array(0), meta: simpleMeta(G.folder, 'DefaultImporter', '  folderAsset: yes\n') },
    { path: 'Assets/Ava/Ava.fbx', guid: G.avaFbx, data: readFileSync(join(fbxDir, 'Ava.fbx')), meta: modelMeta(G.avaFbx, AVA_IDS, true, [['Body', G.bodyMat], ['Hat', G.hatMat]]) },
    { path: 'Assets/Ava/Ava.prefab', guid: G.avaPrefab, data: enc.encode(avaPrefab), meta: simpleMeta(G.avaPrefab, 'PrefabImporter') },
    { path: 'Assets/Ava/Materials/Body.mat', guid: G.bodyMat, data: enc.encode(lilMat('Body', G.bodyTex, '{r: 1, g: 0.92, b: 0.88, a: 1}', '{r: 0.82, g: 0.7, b: 0.78, a: 1}')), meta: simpleMeta(G.bodyMat, 'NativeFormatImporter', '  mainObjectFileID: 2100000\n') },
    { path: 'Assets/Ava/Materials/Hat.mat', guid: G.hatMat, data: enc.encode(plainMat('Hat', '{r: 0.3, g: 0.2, b: 0.5, a: 1}')), meta: simpleMeta(G.hatMat, 'NativeFormatImporter', '  mainObjectFileID: 2100000\n') },
    { path: 'Assets/Ava/Textures/Body.png', guid: G.bodyTex, data: await png(236, 200, 186), meta: textureMeta(G.bodyTex) },
    { path: 'Assets/Ava/README.txt', guid: G.readme, data: enc.encode(README), meta: simpleMeta(G.readme, 'TextScriptImporter') },
    { path: 'Assets/Ava/Scripts/AvaHelper.cs', guid: G.script, data: enc.encode('// A script: Everloom lists it and skips it.\npublic class AvaHelper {}\n'), meta: simpleMeta(G.script, 'MonoImporter') },
  ];
  const shirtFiles = [
    { path: 'Assets/AvaShirt/Shirt.fbx', guid: G.shirtFbx, data: readFileSync(join(fbxDir, 'Shirt.fbx')), meta: modelMeta(G.shirtFbx, JACKET_IDS, false, [['Shirt', G.shirtMat]]) },
    { path: 'Assets/AvaShirt/Shirt.prefab', guid: G.shirtPrefab, data: enc.encode(shirtPrefab), meta: simpleMeta(G.shirtPrefab, 'PrefabImporter') },
    { path: 'Assets/AvaShirt/Shirt.mat', guid: G.shirtMat, data: enc.encode(lilMat('Shirt', G.shirtTex, '{r: 0.35, g: 0.42, b: 0.7, a: 1}', '{r: 0.6, g: 0.6, b: 0.8, a: 1}')), meta: simpleMeta(G.shirtMat, 'NativeFormatImporter', '  mainObjectFileID: 2100000\n') },
    { path: 'Assets/AvaShirt/Shirt.png', guid: G.shirtTex, data: await png(80, 100, 170), meta: textureMeta(G.shirtTex) },
  ];
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const pack = (files: typeof avaFiles) =>
    gzipSync(
      writeTar(
        files.flatMap((f) => [
          ...(f.data.length || !f.meta.includes('folderAsset') ? [{ name: `${f.guid}/asset`, data: f.data }] : []),
          { name: `${f.guid}/asset.meta`, data: f.meta },
          { name: `${f.guid}/pathname`, data: f.path },
        ]),
      ),
    );
  writeFileSync(join(OUT, 'Ava.unitypackage'), pack(avaFiles));
  writeFileSync(join(OUT, 'AvaShirt.unitypackage'), pack(shirtFiles));
  // The same avatar, extracted: with .meta files, and without them.
  for (const [dir, withMeta] of [['Ava-extracted', true], ['Ava-extracted-nometa', false]] as const) {
    for (const f of avaFiles) {
      if (f.meta.includes('folderAsset')) continue;
      const p = join(OUT, dir, f.path);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, f.data);
      if (withMeta) writeFileSync(p + '.meta', f.meta);
    }
  }
  writeFileSync(join(OUT, 'README.md'), `# Unity test packages\n\nEvery one of these files was made by Everloom from its own CC0 test models (\`tests/fixtures/avatars/models\`), with\n\`tools/avatars/unity-fixture.py\` and \`tools/avatars/make-unity-fixture.ts\`. CC0 1.0.\n\n- \`Ava.unitypackage\`: an avatar laid out like a VRChat one (humanoid .meta, lilToon materials, descriptor, PhysBones, a blendshape preset, a hidden hat with a toggle, a script).\n- \`AvaShirt.unitypackage\`: a shirt made for it (Modular Avatar Merge Armature, bones prefixed \`Outfit_\`).\n- \`Ava-extracted/\`, \`Ava-extracted-nometa/\`: the avatar as loose files, with and without .meta files.\n`);
  console.log('ok');
}
void main();
