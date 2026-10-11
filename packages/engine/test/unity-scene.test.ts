import { describe, expect, it } from 'vitest';
import { UnityProject, projectFromFiles, projectFromPackage } from '../src/unity/project';
import { activeInHierarchy, nodePath, resolvePrefab } from '../src/unity/scene';
import { readTar, writeTar } from '../src/unity/tar';

const enc = new TextEncoder();
const FBX = 'aaaa0000aaaa0000aaaa0000aaaa0000';
const PREFAB = 'bbbb0000bbbb0000bbbb0000bbbb0000';
const VARIANT = 'cccc0000cccc0000cccc0000cccc0000';
const MAT_SKIN = 'dddd0000dddd0000dddd0000dddd0000';
const MAT_RED = 'eeee0000eeee0000eeee0000eeee0000';

const fbxMeta = `fileFormatVersion: 2
guid: ${FBX}
ModelImporter:
  internalIDToNameTable:
  - first:
      1: 100
    second: Body
  - first:
      1: 101
    second: Jacket
  - first:
      1: 102
    second: Hips
  - first:
      4: 400
    second: Body
  - first:
      4: 402
    second: Hips
  - first:
      137: 1370
    second: Body
  - first:
      137: 1371
    second: Jacket
`;

const prefab = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1001 &9000
PrefabInstance:
  m_Modification:
    m_TransformParent: {fileID: 0}
    m_Modifications:
    - target: {fileID: 101, guid: ${FBX}, type: 3}
      propertyPath: m_IsActive
      value: 0
      objectReference: {fileID: 0}
    - target: {fileID: 1370, guid: ${FBX}, type: 3}
      propertyPath: m_BlendShapeWeights.Array.data[2]
      value: 75
      objectReference: {fileID: 0}
    - target: {fileID: 1370, guid: ${FBX}, type: 3}
      propertyPath: m_Materials.Array.data[0]
      value:
      objectReference: {fileID: 2100000, guid: ${MAT_SKIN}, type: 2}
    m_RemovedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${FBX}, type: 3}
--- !u!1 &9100 stripped
GameObject:
  m_CorrespondingSourceObject: {fileID: 102, guid: ${FBX}, type: 3}
  m_PrefabInstance: {fileID: 9000}
--- !u!4 &9101 stripped
Transform:
  m_CorrespondingSourceObject: {fileID: 402, guid: ${FBX}, type: 3}
  m_PrefabInstance: {fileID: 9000}
--- !u!114 &9200
MonoBehaviour:
  m_GameObject: {fileID: 9100}
  m_Enabled: 1
  m_Script: {fileID: 1661641543, guid: 2a2c05204084d904aa4945ccff20d8e5, type: 3}
  rootTransform: {fileID: 9101}
  pull: 0.2
  spring: 0.4
--- !u!1 &9300
GameObject:
  m_Component:
  - component: {fileID: 9301}
  m_Name: Halo
  m_IsActive: 1
--- !u!4 &9301
Transform:
  m_GameObject: {fileID: 9300}
  m_LocalPosition: {x: 0, y: 0.3, z: 0}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Father: {fileID: 9101}
`;

// A variant of the prefab: turns the jacket back on and recolors it.
const variant = `%YAML 1.1
--- !u!1001 &7000
PrefabInstance:
  m_Modification:
    m_TransformParent: {fileID: 0}
    m_Modifications:
    - target: {fileID: 101, guid: ${FBX}, type: 3}
      propertyPath: m_IsActive
      value: 1
      objectReference: {fileID: 0}
    - target: {fileID: 9200, guid: ${PREFAB}, type: 3}
      propertyPath: pull
      value: 0.5
      objectReference: {fileID: 0}
    m_RemovedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${PREFAB}, type: 3}
`;

function project(withMeta = true) {
  const files = [
    { path: 'Assets/Ava/Ava.fbx', data: new Uint8Array([1, 2, 3]) },
    { path: 'Assets/Ava/Ava.prefab', data: enc.encode(prefab) },
    { path: 'Assets/Ava/Materials/Skin.mat', data: enc.encode('%YAML 1.1\n--- !u!21 &2100000\nMaterial:\n  m_Name: Skin\n') },
  ];
  if (withMeta) {
    files.push({ path: 'Assets/Ava/Ava.fbx.meta', data: enc.encode(fbxMeta) });
    files.push({ path: 'Assets/Ava/Ava.prefab.meta', data: enc.encode(`fileFormatVersion: 2\nguid: ${PREFAB}\n`) });
    files.push({ path: 'Assets/Ava/Materials/Skin.mat.meta', data: enc.encode(`fileFormatVersion: 2\nguid: ${MAT_SKIN}\n`) });
  }
  return projectFromFiles(files);
}

describe('Unity prefabs', () => {
  it('resolves a prefab built on a model: modifications, stripped objects and added objects', () => {
    const p = project();
    const s = resolvePrefab(p, PREFAB);
    const byName = (n: string) => [...s.nodes.values()].find((x) => x.name === n)!;
    expect(s.models.has(FBX)).toBe(true);
    // The jacket is switched off in the prefab.
    expect(byName('Jacket').active).toBe(false);
    // Body's renderer: a blendshape value and a material from the prefab.
    const body = s.comps.get(byName('Body').comps[0]!)!;
    expect(body.type).toBe('SkinnedMeshRenderer');
    if (body.type === 'SkinnedMeshRenderer') {
      expect(body.blendShapes[2]).toBe(75);
      expect(body.materials[0]?.guid).toBe(MAT_SKIN);
    }
    // A component added to a model's node lands on that node, and its reference resolves.
    const hips = byName('Hips');
    const pb = hips.comps.map((k) => s.comps.get(k)!).find((c) => c.type === 'MonoBehaviour')!;
    expect(pb.type === 'MonoBehaviour' && pb.fields.pull).toBe(0.2);
    if (pb.type === 'MonoBehaviour') expect(s.keyOf(String((pb.fields.rootTransform as { fileID: string }).fileID))).toBe(hips.key);
    // An object of the prefab's own, parented under the model's hips.
    expect(nodePath(s, byName('Halo').key)).toEqual(['Ava', 'Hips', 'Halo']);
    expect(byName('Halo').pos).toEqual({ x: 0, y: 0.3, z: 0 });
    expect(activeInHierarchy(s, byName('Jacket').key)).toBe(false);
  });

  it('resolves a variant: its modifications go on top of the base prefab’s', () => {
    const p = project();
    p.add({ guid: VARIANT, path: 'Assets/Ava/Ava Variant.prefab', kind: 'prefab', data: enc.encode(variant) });
    const s = resolvePrefab(p, VARIANT);
    const byName = (n: string) => [...s.nodes.values()].find((x) => x.name === n)!;
    expect(byName('Jacket').active).toBe(true);
    const pb = [...s.comps.values()].find((c) => c.type === 'MonoBehaviour')!;
    expect(pb.type === 'MonoBehaviour' && pb.fields.pull).toBe(0.5);
    // Still carries the base prefab's material and blendshape.
    const body = s.comps.get(byName('Body').comps[0]!)!;
    expect(body.type === 'SkinnedMeshRenderer' && body.blendShapes[2]).toBe(75);
  });

  it('without .meta files, references by GUID can’t resolve and the project says so', () => {
    const p = project(false);
    expect(p.exact).toBe(false);
    // The material can still be found by name.
    expect(p.byName('Skin', 'Assets/Ava/Ava.prefab', 'material')?.path).toBe('Assets/Ava/Materials/Skin.mat');
  });

  it('reads a .unitypackage (gzipped tar of GUID folders) and refuses paths that climb out', () => {
    const tar = writeTar([
      { name: `${FBX}/asset`, data: new Uint8Array([1]) },
      { name: `${FBX}/asset.meta`, data: fbxMeta },
      { name: `${FBX}/pathname`, data: 'Assets/Ava/Ava.fbx\n00' },
      { name: `${MAT_RED}/asset`, data: 'x' },
      { name: `${MAT_RED}/pathname`, data: '../../etc/passwd' },
      { name: `${'f'.repeat(32)}/pathname`, data: 'Assets/Ava' },
    ]);
    const p = projectFromPackage(readTar(tar));
    expect(p.get(FBX)?.path).toBe('Assets/Ava/Ava.fbx');
    expect(p.get(FBX)?.kind).toBe('model');
    expect(p.get(MAT_RED)).toBeUndefined();
    expect(p.get('f'.repeat(32))?.kind).toBe('folder');
    expect(p).toBeInstanceOf(UnityProject);
  });
});
