import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { mapBones, type RigBone } from '@everloom/engine';
for (const name of ['cesium-man.glb', 'rigged-figure.glb']) it(`maps ${name}'s numbered Blender joints, including reversed left-arm suffixes`, () => {
  const bytes = readFileSync(path.resolve(import.meta.dirname, '../../../tests/fixtures/models', name));
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const parents = new Map<number, number>();
  json.nodes.forEach((node: { children?: number[] }, index: number) => node.children?.forEach(child => parents.set(child, index)));
  const joints = new Set<number>(json.skins.flatMap((skin: { joints: number[] }) => skin.joints));
  const bones: RigBone[] = [...joints].map(index => ({ name: json.nodes[index].name, parent: parents.has(index) ? json.nodes[parents.get(index)!].name : null }));
  const result = mapBones(bones);
  expect(result.missing).toEqual([]);
  expect(bones.find(bone => bone.name === result.map.leftHand)?.parent).toBe(result.map.leftLowerArm);
  expect(bones.find(bone => bone.name === result.map.rightFoot)?.parent).toBe(result.map.rightLowerLeg);
});
