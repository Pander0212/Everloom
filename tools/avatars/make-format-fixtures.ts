/** CC0 RobotExpressive format conversions, written without Blender or external converter code. */
import { readFileSync, writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';
import { parseGlb, writeGlb } from '../../apps/server/src/services/avatars/glb.js';

const file = 'tests/fixtures/models/robot-expressive.glb', bytes = readFileSync(file);
const glb = parseGlb(bytes);
const mapping = { hips: 8, spine: 9, chest: 10, neck: 11, head: 12, leftShoulder: 15, leftUpperArm: 17, leftLowerArm: 19, leftHand: 20, rightShoulder: 35, rightUpperArm: 37, rightLowerArm: 39, rightHand: 40, leftUpperLeg: 55, leftLowerLeg: 57, leftFoot: 3, rightUpperLeg: 60, rightLowerLeg: 62, rightFoot: 67 };
glb.json.extensionsUsed = [...(glb.json.extensionsUsed ?? []), 'VRM'];
glb.json.extensions = { ...glb.json.extensions, VRM: {
  exporterVersion: 'Everloom CC0 fixture conversion', specVersion: '0.0',
  meta: { title: 'RobotExpressive CC0 format fixture', version: '1', author: 'Quaternius; GLB conversion Don McCurdy; VRM conversion Everloom', contactInformation: '', reference: 'https://quaternius.com/', allowedUserName: 'Everyone', violentUssageName: 'Disallow', sexualUssageName: 'Disallow', commercialUssageName: 'Allow', licenseName: 'Other', otherLicenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  humanoid: { humanBones: Object.entries(mapping).map(([bone, node]) => ({ bone, node, useDefaultValues: true })), armStretch: 0.05, legStretch: 0.05, upperArmTwist: 0.5, lowerArmTwist: 0.5, upperLegTwist: 0.5, lowerLegTwist: 0.5, feetSpacing: 0, hasTranslationDoF: false },
  firstPerson: { firstPersonBone: 12, firstPersonBoneOffset: { x: 0, y: 0, z: 0 }, meshAnnotations: [], lookAtTypeName: 'Bone' },
  blendShapeMaster: { blendShapeGroups: [] }, secondaryAnimation: { boneGroups: [], colliderGroups: [] },
  materialProperties: (glb.json.materials ?? []).map(material => ({ name: material.name ?? '', shader: 'VRM_USE_GLTFSHADER', renderQueue: -1, floatProperties: {}, vectorProperties: {}, textureProperties: {}, keywordMap: {}, tagMap: {} })),
} };
writeFileSync('tests/fixtures/models/robot-vrm0.vrm', writeGlb(glb));

// PMX 2.0: UTF-8, four-byte indices, original triangles/material colors and full rig.
const doc = await new NodeIO().readBinary(bytes), nodes = doc.getRoot().listNodes(), nodeIndex = new Map(nodes.map((node, index) => [node, index]));
const chunks: Buffer[] = [], push = (value: Buffer) => chunks.push(value);
const u8 = (n: number) => { const b = Buffer.alloc(1); b.writeUInt8(n); push(b); };
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); push(b); };
const i32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32LE(n); push(b); };
const f32 = (n: number) => { const b = Buffer.alloc(4); b.writeFloatLE(n); push(b); };
const string = (text: string) => { const b = Buffer.from(text); i32(b.length); push(b); };
const vector = (value: number[]) => value.forEach(f32);
interface Vertex { position: number[]; normal: number[]; uv: number[]; joints: number[]; weights: number[] }
const vertices: Vertex[] = [], triangles: number[] = [], materials: { name: string; color: number[]; count: number }[] = [];
for (const node of nodes) for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
  if (primitive.getMode() !== 4) throw new Error('Fixture needs triangle primitives');
  const position = primitive.getAttribute('POSITION')!, normal = primitive.getAttribute('NORMAL'), uv = primitive.getAttribute('TEXCOORD_0'), joints = primitive.getAttribute('JOINTS_0'), weights = primitive.getAttribute('WEIGHTS_0');
  const matrix = new THREE.Matrix4().fromArray(node.getWorldMatrix()), normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix), base = vertices.length;
  for (let i = 0; i < position.getCount(); i++) {
    const p = new THREE.Vector3().fromArray(position.getElement(i, [])).applyMatrix4(matrix), n = new THREE.Vector3().fromArray(normal?.getElement(i, []) ?? [0, 1, 0]).applyMatrix3(normalMatrix).normalize();
    const joint = joints?.getElement(i, []) ?? [0, 0, 0, 0], weight = weights?.getElement(i, []) ?? [1, 0, 0, 0], skin = node.getSkin();
    const sum = weight.reduce((total, value) => total + value, 0) || 1;
    vertices.push({ position: [p.x, p.y, -p.z], normal: [n.x, n.y, -n.z], uv: uv?.getElement(i, []) ?? [0, 0], joints: joint.map(index => skin ? nodeIndex.get(skin.listJoints()[index]) ?? 0 : nodeIndex.get(node)!), weights: weight.map(value => value / sum) });
  }
  const indices = primitive.getIndices(), count = indices?.getCount() ?? position.getCount();
  for (let i = 0; i < count; i += 3) for (const k of [0, 2, 1]) triangles.push(base + (indices ? indices.getScalar(i + k) : i + k));
  materials.push({ name: primitive.getMaterial()?.getName() || 'Robot material', color: primitive.getMaterial()?.getBaseColorFactor() ?? [1, 1, 1, 1], count });
}
push(Buffer.from('PMX ')); f32(2); u8(8); push(Buffer.from([1, 0, 4, 4, 4, 4, 4, 4]));
string('RobotExpressive CC0'); string('RobotExpressive CC0'); string('Quaternius; GLB Don McCurdy; PMX Everloom. CC0 https://creativecommons.org/publicdomain/zero/1.0/'); string('Independent format conversion, no Blender.');
i32(vertices.length);
for (const vertex of vertices) { vector(vertex.position); vector(vertex.normal); vector(vertex.uv); u8(2); vertex.joints.forEach(i32); vector(vertex.weights); f32(1); }
i32(triangles.length); triangles.forEach(i32); i32(0); i32(materials.length);
for (const material of materials) { string(material.name); string(material.name); vector(material.color); vector([0.15, 0.15, 0.15]); f32(20); vector([0.2, 0.2, 0.2]); u8(0x1d); vector([0, 0, 0, 1]); f32(0); i32(-1); i32(-1); u8(0); u8(1); u8(0); string('CC0'); i32(material.count); }
i32(nodes.length);
const used = new Set<string>();
for (const [index, node] of nodes.entries()) {
  const raw = node.getMesh() ? `meshpart${index}` : node.getName() || `bone${index}`, name = used.has(raw) ? `${raw}_part${index}` : raw; used.add(name);
  string(name); string(name); const p = node.getWorldTranslation(); vector([p[0], p[1], -p[2]]);
  i32(node.getParentNode() ? nodeIndex.get(node.getParentNode()!) ?? -1 : -1); i32(0); u16(0x1b); i32(node.listChildren().length ? nodeIndex.get(node.listChildren()[0])! : -1);
}
for (let i = 0; i < 5; i++) i32(0); // morphs, display frames, rigid bodies, joints, soft bodies
writeFileSync('tests/fixtures/models/robot.pmx', Buffer.concat(chunks));
console.log({ vertices: vertices.length, triangles: triangles.length / 3, bones: nodes.length });
