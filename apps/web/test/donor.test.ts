import { expect, it } from 'vitest';
import * as THREE from 'three';
import { copyDonorPart, donorParts } from '../src/features/avatar3d/runtime/donor';
import type { LoadedModel } from '../src/features/avatar3d/runtime/loader';

function model(headHeight: number, withHair: boolean): LoadedModel {
  const scene = new THREE.Group(), hips = new THREE.Bone(), head = new THREE.Bone(); hips.name = 'hips'; head.name = 'head'; head.position.y = headHeight; scene.add(hips); hips.add(head);
  const meshes: THREE.Mesh[] = [];
  if (withHair) {
    const hair = new THREE.Bone(); hair.name = 'hair01'; head.add(hair);
    hair.userData.everloomSpring = { stiffness: 1.4, gravityPower: 0.2, dragForce: 0.5 };
    const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2); geometry.translate(0, headHeight, 0);
    const count = geometry.getAttribute('position').count, indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) { indices[i * 4] = 2; weights[i * 4] = 1; }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4)); geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    const material = new THREE.MeshStandardMaterial(); material.name = 'Hair material';
    const mesh = new THREE.SkinnedMesh(geometry, material); mesh.name = 'Hair'; scene.add(mesh); scene.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton([hips, head, hair])); meshes.push(mesh);
  }
  scene.updateMatrixWorld(true); return { scene, meshes, bones: { hips, head }, vrm: null } as LoadedModel;
}
it('copies one donor material, adapts to head height, and keeps secondary bones without changing the donor', () => {
  const body = model(1.6, false), donor = model(1.3, true), part = donorParts(donor)[0], before = Array.from(part.mesh.geometry.getAttribute('position').array);
  const result = copyDonorPart(body, donor, part); result.updateMatrixWorld(true);
  let mesh: THREE.SkinnedMesh | undefined; result.traverse(object => { if ((object as THREE.SkinnedMesh).isSkinnedMesh) mesh = object as THREE.SkinnedMesh; });
  expect(mesh).toBeDefined(); expect(mesh!.skeleton.bones.some(bone => bone.name === 'hair01')).toBe(true);
  expect(mesh!.skeleton.bones.find(bone => bone.name === 'hair01')!.userData.everloomSpring.stiffness).toBe(1.4);
  expect(mesh!.geometry.getAttribute('position').getY(0) - part.mesh.geometry.getAttribute('position').getY(0)).toBeCloseTo(0.3);
  const head = mesh!.skeleton.bones.find(bone => bone.name === 'head')!; head.position.x += 0.2; result.updateMatrixWorld(true);
  const posed = mesh!.getVertexPosition(0, new THREE.Vector3()); expect(posed.x - mesh!.geometry.getAttribute('position').getX(0)).toBeCloseTo(0.2);
  expect(Array.from(part.mesh.geometry.getAttribute('position').array)).toEqual(before); expect(donor.bones.head!.position.y).toBe(1.3);
});
