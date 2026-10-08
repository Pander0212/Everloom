import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import * as THREE from 'three';
import { loadModel } from '../src/features/avatar3d/runtime/loader';
import { prepareRig, applyCanonical } from '../src/features/avatar3d/runtime/canonical';
import { sampleClip } from '../src/features/avatar3d/runtime/clip';
import { ROOT, clip } from './helpers3d';
import { inspectModel } from '../../server/src/services/avatars/inspect';

for (const name of ['robot-expressive.glb', 'robot-vrm0.vrm']) it(`keeps ${name}'s complete rigid rig upright during wave`, async () => {
  const bytes = readFileSync(new URL(`tests/fixtures/models/${name}`, ROOT));
  const info = await inspectModel(bytes);
  const model = await loadModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), null, { boneMap: info.boneMap });
  expect(model.missing).toEqual([]);
  expect(model.bones.chest).toBeDefined();
  expect(new Set(Object.values(model.bones)).size).toBe(Object.values(model.bones).length);
  const rig = prepareRig(model.scene, model.bones), head = model.bones.head!, hips = model.bones.hips!;
  const before = head.getWorldPosition(new THREE.Vector3()).y - hips.getWorldPosition(new THREE.Vector3()).y;
  for (const time of [0, 0.9, 1.8]) {
    applyCanonical(rig, sampleClip(clip('wave'), time));
    const after = head.getWorldPosition(new THREE.Vector3()).y - hips.getWorldPosition(new THREE.Vector3()).y;
    expect(after).toBeGreaterThan(before * 0.7);
    const box = new THREE.Box3().setFromObject(model.scene, true), size = box.getSize(new THREE.Vector3());
    expect(size.y).toBeLessThan(model.height * 1.8);
    expect(size.x).toBeLessThan(model.height * 1.8);
  }
});
