import { describe, expect, it } from 'vitest';
import { readMaterial, familyFromProps } from '../src/unity/material';
import { humanTrait, readHumanoid } from '../src/unity/humanoid';
import { parseYaml } from '../src/unity/yaml';
import { chainKindFromName, identify, matchOutfitBone, readDescriptor, readPhysBone } from '../src/unity/vrchat';
import { projectFromFiles } from '../src/unity/project';
import { resolvePrefab } from '../src/unity/scene';

const enc = new TextEncoder();

const LILTOON_MAT = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!21 &2100000
Material:
  serializedVersion: 8
  m_Name: Body
  m_Shader: {fileID: 4800000, guid: df12117ecd77c31469c224178886498e, type: 3}
  m_ValidKeywords: []
  m_CustomRenderQueue: 2450
  m_SavedProperties:
    serializedVersion: 3
    m_TexEnvs:
    - _MainTex:
        m_Texture: {fileID: 2800000, guid: 11111111111111111111111111111111, type: 3}
        m_Scale: {x: 1, y: 1}
        m_Offset: {x: 0, y: 0}
    - _ShadowColorTex:
        m_Texture: {fileID: 0}
        m_Scale: {x: 1, y: 1}
        m_Offset: {x: 0, y: 0}
    m_Ints: []
    m_Floats:
    - _Cull: 0
    - _Cutoff: 0.4
    - _TransparentMode: 1
    - _UseShadow: 1
    - _ShadowBorder: 0.6
    - _UseEmission: 0
    - _lilToonVersion: 44
    m_Colors:
    - _Color: {r: 1, g: 0.9, b: 0.9, a: 1}
    - _ShadowColor: {r: 0.8, g: 0.7, b: 0.9, a: 1}
`;

describe('Unity materials', () => {
  it('reads a lilToon cutout material: texture, colour, alpha, shadow, two-sided', () => {
    const m = readMaterial(LILTOON_MAT)!;
    expect(m.family).toBe('liltoon');
    expect(m.alpha).toBe('cutout');
    expect(m.cutoff).toBe(0.4);
    expect(m.doubleSided).toBe(true);
    expect(m.map?.ref.guid).toBe('11111111111111111111111111111111');
    expect(m.color).toEqual([1, 0.9, 0.9, 1]);
    expect(m.shade).toEqual({ color: [0.8, 0.7, 0.9], map: undefined, border: 0.6 });
    expect(m.emissive).toBeUndefined();
  });

  it('recognises the shader family from properties alone', () => {
    expect(familyFromProps({ _ShadeToony: 0.9 }, {}, [])).toBe('unknown');
    expect(familyFromProps({ _ShadeToony: 0.9, _ShadeColor: 1 }, {}, [])).toBe('mtoon');
    expect(familyFromProps({ _Glossiness: 0.5, _Metallic: 0 }, {}, [])).toBe('standard');
    expect(familyFromProps({}, {}, ['POI_MAINTEX'])).toBe('poiyomi');
  });

  it('reads the older "first/second" property layout', () => {
    const m = readMaterial(`--- !u!21 &2100000
Material:
  m_Name: Old
  m_Shader: {fileID: 46, guid: 0000000000000000f000000000000000, type: 0}
  m_SavedProperties:
    m_TexEnvs:
    - first:
        name: _MainTex
      second:
        m_Texture: {fileID: 2800000, guid: 22222222222222222222222222222222, type: 3}
        m_Scale: {x: 2, y: 2}
        m_Offset: {x: 0, y: 0}
    m_Floats:
    - first:
        name: _Mode
      second: 3
    m_Colors: []
`)!;
    expect(m.family).toBe('standard');
    expect(m.alpha).toBe('transparent');
    expect(m.map?.scale).toEqual([2, 2]);
  });
});

describe('Unity humanoid mapping', () => {
  it('maps HumanTrait names, including fingers with spaces, to Everloom bones', () => {
    expect(humanTrait('LeftUpperArm')).toBe('leftUpperArm');
    expect(humanTrait('Left Thumb Proximal')).toBe('leftThumbMetacarpal');
    expect(humanTrait('Right Little Distal')).toBe('rightLittleDistal');
    expect(humanTrait('UpperChest')).toBe('upperChest');
    const h = readHumanoid(parseYaml(`ModelImporter:
  animationType: 3
  meshes:
    globalScale: 1
  humanDescription:
    human:
    - boneName: "\\u4E0A\\u534A\\u8EAB"
      humanName: Spine
    - boneName: Left arm
      humanName: LeftUpperArm
    - boneName: Thumb0_L
      humanName: Left Thumb Proximal
    - boneName: x
      humanName: SomethingNew
`))!;
    expect(h.animationType).toBe(3);
    expect(h.bones).toEqual({ spine: '上半身', leftUpperArm: 'Left arm', leftThumbMetacarpal: 'Thumb0_L' });
    expect(h.unknown).toEqual(['SomethingNew']);
  });
});

describe('VRChat and Modular Avatar components', () => {
  const FBX = 'aaaa0000aaaa0000aaaa0000aaaa0000';
  const prefab = `--- !u!1001 &1
PrefabInstance:
  m_Modification:
    m_TransformParent: {fileID: 0}
    m_Modifications: []
  m_SourcePrefab: {fileID: 100100000, guid: ${FBX}, type: 3}
--- !u!1 &2 stripped
GameObject:
  m_CorrespondingSourceObject: {fileID: 10, guid: ${FBX}, type: 3}
  m_PrefabInstance: {fileID: 1}
--- !u!1 &3 stripped
GameObject:
  m_CorrespondingSourceObject: {fileID: 11, guid: ${FBX}, type: 3}
  m_PrefabInstance: {fileID: 1}
--- !u!137 &4 stripped
SkinnedMeshRenderer:
  m_CorrespondingSourceObject: {fileID: 12, guid: ${FBX}, type: 3}
  m_PrefabInstance: {fileID: 1}
--- !u!114 &5
MonoBehaviour:
  m_GameObject: {fileID: 2}
  m_Enabled: 1
  m_Script: {fileID: 542108242, guid: 67cc4cb7839cd3741b63733d5adf0442, type: 3}
  ViewPosition: {x: 0, y: 1.32, z: 0.06}
  lipSync: 3
  VisemeSkinnedMesh: {fileID: 4}
  VisemeBlendShapes:
  - vrc.v_sil
  - vrc.v_pp
  - vrc.v_ff
  - vrc.v_th
  - vrc.v_dd
  - vrc.v_kk
  - vrc.v_ch
  - vrc.v_ss
  - vrc.v_nn
  - vrc.v_rr
  - vrc.v_aa
  - vrc.v_e
  - vrc.v_ih
  - vrc.v_oh
  - vrc.v_ou
  customEyeLookSettings:
    eyelidType: 2
    eyelidsSkinnedMesh: {fileID: 4}
    eyelidsBlendshapes: 0c0000000d000000
--- !u!114 &6
MonoBehaviour:
  m_GameObject: {fileID: 3}
  m_Enabled: 1
  m_Script: {fileID: 1661641543, guid: 2a2c05204084d904aa4945ccff20d8e5, type: 3}
  version: 1
  integrationType: 1
  rootTransform: {fileID: 0}
  ignoreTransforms: []
  pull: 0.25
  spring: 0.5
  stiffness: 0.1
  gravity: 0.15
  radius: 0.03
  colliders:
  - {fileID: 0}
  limitType: 1
`;
  const meta = `guid: ${FBX}
ModelImporter:
  internalIDToNameTable:
  - first:
      1: 10
    second: Armature
  - first:
      1: 11
    second: Hair_Back
  - first:
      137: 12
    second: Body
`;
  const project = projectFromFiles([
    { path: 'Assets/A/A.fbx', data: new Uint8Array([0]) },
    { path: 'Assets/A/A.fbx.meta', data: enc.encode(meta) },
    { path: 'Assets/A/A.prefab', data: enc.encode(prefab) },
    { path: 'Assets/A/A.prefab.meta', data: enc.encode('guid: 99990000999900009999000099990000\n') },
  ]);
  const scene = resolvePrefab(project, '99990000999900009999000099990000');
  const mbs = [...scene.comps.values()].filter((c) => c.type === 'MonoBehaviour') as Extract<ReturnType<typeof scene.comps.get>, { type: 'MonoBehaviour' }>[];

  it('identifies components by script identity', () => {
    expect(mbs.map(identify).sort()).toEqual(['avatarDescriptor', 'physBone']);
  });

  it('reads the avatar descriptor: visemes, view position, the face mesh', () => {
    const d = readDescriptor(scene, mbs.find((m) => identify(m) === 'avatarDescriptor')!);
    expect(d.visemes.aa).toBe('vrc.v_aa');
    expect(d.visemes.E).toBe('vrc.v_e');
    expect(d.viewPosition.y).toBe(1.32);
    expect(scene.nodes.get(d.visemeMesh!)?.name).toBe('Body');
    // The eyelid blendshapes come as a hex blob of int32s.
    expect(d.eyelids).toMatchObject({ blink: 12, up: 13, down: null });
  });

  it('turns a PhysBone into a spring chain on its own node when rootTransform is empty', () => {
    const c = readPhysBone(scene, mbs.find((m) => identify(m) === 'physBone')!)!;
    expect(scene.nodes.get(c.root)?.name).toBe('Hair_Back');
    expect(c.kind).toBe('hair');
    expect(c.settings.stiffness).toBeCloseTo(0.25 * 4 + 0.1 * 2);
    expect(c.settings.damping).toBeCloseTo(0.6);
    expect(c.settings.gravity).toBeCloseTo(0.3);
    expect(c.notes.join(' ')).toMatch(/colliders/);
    expect(c.notes.join(' ')).toMatch(/angle limits/);
  });

  it('names chain kinds in English and Japanese', () => {
    expect(chainKindFromName('Breast_L')).toBe('chest');
    expect(chainKindFromName('胸.L')).toBe('chest');
    expect(chainKindFromName('スカート_前')).toBe('cloth');
    expect(chainKindFromName('しっぽ1')).toBe('tail');
    expect(chainKindFromName('前髪')).toBe('hair');
  });

  it('matches an outfit’s bones to the avatar’s, with Merge Armature’s prefix and suffix', () => {
    const bones = new Set(['Hips', 'Spine', 'Upper_Leg.L', 'Breast_L']);
    expect(matchOutfitBone('Outfit_Hips', bones, 'Outfit_')).toBe('Hips');
    expect(matchOutfitBone('Spine (Dress)', bones, '', ' (Dress)')).toBe('Spine');
    expect(matchOutfitBone('upper_leg_l', bones)).toBe('Upper_Leg.L');
    expect(matchOutfitBone('Skirt_01', bones)).toBe(null);
    expect(matchOutfitBone('Upper_Leg.L.001', bones)).toBe('Upper_Leg.L');
    expect(matchOutfitBone('breast-L', bones)).toBe('Breast_L');
  });
});
