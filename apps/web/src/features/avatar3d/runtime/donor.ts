/** Material-level donor extraction and humanoid rest-surface rebinding. */
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { HumanBone } from '@everloom/engine';
import type { LoadedModel } from './loader';

export interface DonorPart { id: string; label: string; mesh: THREE.Mesh; material: number }
export function donorParts(model: LoadedModel): DonorPart[] {
  return model.meshes.flatMap((mesh, index) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).flatMap((material, slot) => (material as THREE.Material & { isOutline?: boolean }).isOutline ? [] : [{ id: `${index}:${slot}`, label: `${mesh.name || 'Mesh'} · ${material.name || `material ${slot + 1}`}`, mesh, material: slot }]));
}

export function copyDonorPart(body: LoadedModel, donor: LoadedModel, part: DonorPart) {
  if (!(part.mesh as THREE.SkinnedMesh).isSkinnedMesh) throw new Error('Choose a rigged donor part, or fit this static mesh as a garment.');
  body.scene.updateMatrixWorld(true); donor.scene.updateMatrixWorld(true);
  const output = clone(body.scene), oldMeshes: THREE.Mesh[] = [];
  output.traverse(object => { if ((object as THREE.Mesh).isMesh) oldMeshes.push(object as THREE.Mesh); });
  for (const mesh of oldMeshes) { for (const child of [...mesh.children]) output.attach(child); mesh.removeFromParent(); }
  output.userData = {}; output.updateMatrixWorld(true);
  const targetNames = new Map<string, THREE.Object3D>(); output.traverse(object => targetNames.set(object.name, object));
  const canonical = new Map<THREE.Object3D, THREE.Object3D>();
  for (const [key, bone] of Object.entries(donor.bones)) {
    const target = body.bones[key as HumanBone], copied = target && targetNames.get(target.name);
    if (bone && copied) canonical.set(bone, copied);
  }
  const adopted = new Map<THREE.Object3D, THREE.Object3D>();
  const rebind = (bone: THREE.Object3D): THREE.Object3D => {
    const existing = canonical.get(bone) ?? targetNames.get(bone.name) ?? adopted.get(bone);
    if (existing) return existing;
    const parent = bone.parent && ((bone.parent as THREE.Bone).isBone || canonical.has(bone.parent)) ? rebind(bone.parent) : output;
    const copied = new THREE.Bone(); copied.name = bone.name; copied.position.copy(bone.position); copied.quaternion.copy(bone.quaternion); copied.scale.copy(bone.scale);
    if (bone.userData.everloomSpring) copied.userData.everloomSpring = { ...bone.userData.everloomSpring };
    parent.add(copied); adopted.set(bone, copied); return copied;
  };
  const source = part.mesh as THREE.SkinnedMesh, bones = source.skeleton.bones.map(rebind) as THREE.Bone[];
  for (const joint of donor.vrm?.springBoneManager?.joints ?? []) {
    const copied = adopted.get(joint.bone); if (!copied) continue;
    const settings = joint.settings;
    copied.userData.everloomSpring = { hitRadius: settings.hitRadius, stiffness: settings.stiffness, gravityPower: settings.gravityPower, dragForce: settings.dragForce, gravityDir: settings.gravityDir.toArray() };
  }
  output.updateMatrixWorld(true); const inverse = output.matrixWorld.clone().invert();
  const geometry = source.geometry.clone(), position = geometry.getAttribute('position'), skinIndex = geometry.getAttribute('skinIndex'), skinWeight = geometry.getAttribute('skinWeight');
  delete geometry.morphAttributes.position; delete geometry.morphAttributes.normal;
  // Keep only triangles belonging to the selected clothing/hair material.
  const selected: number[] = [], index = geometry.index;
  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: index?.count ?? position.count, materialIndex: 0 }];
  for (const group of groups) if ((group.materialIndex ?? 0) === part.material) for (let i = group.start; i < group.start + group.count; i++) selected.push(index ? index.getX(i) : i);
  if (!selected.length) throw new Error('This material has no triangles to copy.');
  geometry.setIndex(selected); geometry.clearGroups();
  const local = new THREE.Vector3(), transformed = new THREE.Vector3(), result = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    THREE.Mesh.prototype.getVertexPosition.call(source, i, local); local.applyMatrix4(source.bindMatrix);
    result.set(0, 0, 0); let total = 0;
    for (let channel = 0; channel < 4; channel++) {
      const joint = skinIndex.getComponent(i, channel), weight = skinWeight.getComponent(i, channel);
      if (weight <= 0 || !bones[joint]) continue;
      transformed.copy(local).applyMatrix4(source.skeleton.boneInverses[joint]).applyMatrix4(bones[joint].matrixWorld);
      result.addScaledVector(transformed, weight); total += weight;
    }
    if (total > 0) result.divideScalar(total); else result.copy(local).applyMatrix4(source.matrixWorld);
    result.applyMatrix4(inverse); position.setXYZ(i, result.x, result.y, result.z);
  }
  geometry.computeVertexNormals();
  const material = (Array.isArray(source.material) ? source.material[part.material] : source.material) as THREE.MeshStandardMaterial;
  const portable = new THREE.MeshStandardMaterial({ name: material.name, color: material.color ?? 0xffffff, map: material.map ?? null, normalMap: material.normalMap ?? null, transparent: material.transparent, opacity: material.opacity, alphaTest: material.alphaTest, side: material.side, roughness: 0.7 });
  const mesh = new THREE.SkinnedMesh(geometry, portable); mesh.name = `${source.name} donor part`; output.add(mesh); output.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
  return output;
}
