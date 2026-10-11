import { describe, expect, it } from 'vitest';
import { asList, asMap, asRef, parseUnityYaml, parseYaml } from '../src/unity/yaml';

const PREFAB = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &1234567890123456789
GameObject:
  m_ObjectHideFlags: 0
  serializedVersion: 6
  m_Component:
  - component: {fileID: 4000011}
  - component: {fileID: 137000012}
  m_Layer: 0
  m_Name: Body
  m_IsActive: 1
--- !u!137 &137000012
SkinnedMeshRenderer:
  m_GameObject: {fileID: 1234567890123456789}
  m_Materials:
  - {fileID: 2100000, guid: 0123456789abcdef0123456789abcdef, type: 2}
  - {fileID: 0}
  m_BlendShapeWeights:
  - 0
  - 35.5
  - 100
  m_Mesh: {fileID: 4300000, guid: fedcba9876543210fedcba9876543210, type: 3}
--- !u!1001 &5550000
PrefabInstance:
  m_Modification:
    m_Modifications:
    - target: {fileID: 919132149155446097, guid: aaaabbbbccccddddeeeeffff00001111,
        type: 3}
      propertyPath: m_Name
      value: Kikyo
      objectReference: {fileID: 0}
    - target: {fileID: 2, guid: aaaabbbbccccddddeeeeffff00001111, type: 3}
      propertyPath: m_BlendShapeWeights.Array.data[3]
      value: 60
      objectReference: {fileID: 0}
    m_RemovedComponents: []
--- !u!4 &4000011 stripped
Transform:
  m_CorrespondingSourceObject: {fileID: 400000, guid: aaaabbbbccccddddeeeeffff00001111, type: 3}
`;

describe('Unity YAML', () => {
  it('splits documents with class ids, file ids and stripped markers', () => {
    const docs = parseUnityYaml(PREFAB);
    expect(docs.map((d) => [d.classId, d.type, d.stripped])).toEqual([
      [1, 'GameObject', false],
      [137, 'SkinnedMeshRenderer', false],
      [1001, 'PrefabInstance', false],
      [4, 'Transform', true],
    ]);
    // Big file ids keep every digit.
    expect(docs[0]!.fileId).toBe('1234567890123456789');
    expect(docs[0]!.body.m_Name).toBe('Body');
    expect(asList(docs[0]!.body.m_Component).map((c) => asRef(asMap(c).component)?.fileID)).toEqual(['4000011', '137000012']);
  });

  it('reads flow maps, sequences at the key indent, and references', () => {
    const smr = parseUnityYaml(PREFAB)[1]!.body;
    expect(asRef(smr.m_GameObject)).toEqual({ fileID: '1234567890123456789', guid: undefined, type: undefined });
    const mats = asList(smr.m_Materials).map(asRef);
    expect(mats[0]).toEqual({ fileID: '2100000', guid: '0123456789abcdef0123456789abcdef', type: 2 });
    expect(mats[1]).toBeNull();
    expect(smr.m_BlendShapeWeights).toEqual([0, 35.5, 100]);
  });

  it('joins a flow map that wraps onto the next line, and maps inside sequence items', () => {
    const mods = asList(asMap(parseUnityYaml(PREFAB)[2]!.body.m_Modification).m_Modifications).map(asMap);
    expect(mods).toHaveLength(2);
    expect(asRef(mods[0]!.target)).toEqual({ fileID: '919132149155446097', guid: 'aaaabbbbccccddddeeeeffff00001111', type: 3 });
    expect(mods[0]!.value).toBe('Kikyo');
    expect(mods[1]!.propertyPath).toBe('m_BlendShapeWeights.Array.data[3]');
    expect(mods[1]!.value).toBe(60);
    expect(asMap(parseUnityYaml(PREFAB)[2]!.body.m_Modification).m_RemovedComponents).toEqual([]);
  });

  it('reads a .meta file with nested maps, quoted strings and multi-line plain scalars', () => {
    const meta = parseYaml(`fileFormatVersion: 2
guid: 0123456789abcdef0123456789abcdef
ModelImporter:
  serializedVersion: 21300
  humanDescription:
    serializedVersion: 3
    human:
    - boneName: "\\u4E0A\\u534A\\u8EAB"
      humanName: Spine
      limit:
        min: {x: 0, y: 0, z: 0}
    - boneName: 'Left ''arm'''
      humanName: LeftUpperArm
    skeleton: []
  userData: a long note that
    wraps onto a second line
  globalScale: 1
`);
    expect(meta.guid).toBe('0123456789abcdef0123456789abcdef');
    const human = asList(asMap(asMap(meta.ModelImporter).humanDescription).human).map(asMap);
    expect(human.map((h) => [h.boneName, h.humanName])).toEqual([
      ['上半身', 'Spine'],
      ["Left 'arm'", 'LeftUpperArm'],
    ]);
    expect(asMap(asMap(human[0]!.limit).min)).toEqual({ x: 0, y: 0, z: 0 });
    expect(asMap(meta.ModelImporter).userData).toBe('a long note that wraps onto a second line');
    expect(asMap(meta.ModelImporter).globalScale).toBe(1);
  });
});
