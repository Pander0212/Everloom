/** Local morphs for exported humanoids, derived once from immutable bind-pose geometry. */
import * as THREE from 'three';
import type { AvatarConfig, HumanBone } from '@everloom/engine';
import { detectFacing } from './canonical';
import { restMatrices } from './skinning';
type Shape = NonNullable<AvatarConfig['bodyShape']>;
export const SHAPE_KEYS = ['chest', 'buttocks', 'hips', 'waist', 'thighs', 'shoulders'] as const;
const PREFIX = 'EverloomBody_';
export type BodyMorphWeights = Map<THREE.Mesh, Map<number, number>>;
const smooth = (v: number) => { const t = THREE.MathUtils.clamp(v, 0, 1); return t * t * (3 - 2 * t); };

export function createBodyMorphs(scene: THREE.Object3D, bones: Partial<Record<HumanBone, THREE.Object3D>>, shape?: Shape): BodyMorphWeights {
  const weights: BodyMorphWeights = new Map();
  const meshes: THREE.Mesh[] = [];
  scene.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh && mesh.geometry.getAttribute('position')) meshes.push(mesh); });
  const count = meshes.reduce((n, mesh) => n + mesh.geometry.getAttribute('position').count, 0);
  if (count > 200000) throw new Error('This model has too many vertices for live body adjusters. Use a lighter GLB export.');
  scene.updateMatrixWorld(true);
  const inverse = scene.matrixWorld.clone().invert(), facing = detectFacing(scene, bones), frame = new THREE.Matrix4().makeRotationFromQuaternion(facing.clone().invert());
  const toFrame = frame.clone().multiply(inverse);
  // Each vertex's map from its stored position into the model's facing frame. Skinned meshes go
  // through their bones (optimized files keep positions quantized, scaled back in the bind matrices).
  const vertexMatrix = new Map<THREE.Mesh, (i: number, out: THREE.Matrix4) => THREE.Matrix4>();
  for (const mesh of meshes) {
    const skinned = mesh as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh && skinned.skeleton && mesh.geometry.getAttribute('skinWeight')) vertexMatrix.set(mesh, restMatrices(skinned, toFrame));
    else { const m = toFrame.clone().multiply(mesh.matrixWorld); vertexMatrix.set(mesh, (_i, out) => out.copy(m)); }
  }
  const box = new THREE.Box3(), point = new THREE.Vector3(), matrix = new THREE.Matrix4();
  for (const mesh of meshes) { const positions = mesh.geometry.getAttribute('position'), at = vertexMatrix.get(mesh)!; for (let i = 0; i < positions.count; i++) box.expandByPoint(point.fromBufferAttribute(positions, i).applyMatrix4(at(i, matrix))); }
  const height = Math.max(0.01, box.max.y - box.min.y), center = box.getCenter(new THREE.Vector3());
  const locate = (bone: HumanBone, fraction: number) => bones[bone] ? bones[bone]!.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse).applyMatrix4(frame) : new THREE.Vector3(center.x, box.min.y + height * fraction, center.z);
  const hips = locate('hips', 0.52), chest = locate('chest', 0.72);
  const yFalloff = (y: number, mid: number, radius: number) => smooth(1 - Math.abs(y - mid) / radius);
  const back = new THREE.Matrix3();
  for (const mesh of meshes) {
    // Head/hair/accessories only get targets where the same spatial falloff reaches them.
    // Imported primitives can share geometry but need different per-mesh transforms.
    const oldNames = { ...mesh.morphTargetDictionary }, oldValues = [...(mesh.morphTargetInfluences ?? [])];
    const bank = new Map<number, number>();
    const existing = SHAPE_KEYS.map(key => oldNames[PREFIX + key]);
    if (existing.every(index => index !== undefined)) {
      for (let k = 0; k < SHAPE_KEYS.length; k++) bank.set(existing[k]!, shape?.[SHAPE_KEYS[k]] ?? oldValues[existing[k]!] ?? 0);
      weights.set(mesh, bank); continue;
    }
    mesh.geometry = mesh.geometry.clone();
    const geometry = mesh.geometry, position = geometry.getAttribute('position'), at = vertexMatrix.get(mesh)!;
    if (geometry.morphAttributes.position?.length && !geometry.morphTargetsRelative) continue;
    geometry.morphTargetsRelative = true;
    const attributes = geometry.morphAttributes.position ??= [];
    const normals = geometry.morphAttributes.normal;
    const indices: number[] = [];
    // The inverse linear map per vertex takes an offset in the frame back to stored units.
    const backMaps = new Float32Array(position.count * 9);
    for (let i = 0; i < position.count; i++) backMaps.set(back.setFromMatrix4(at(i, matrix)).invert().elements, i * 9);
    const frameAt = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) { point.fromBufferAttribute(position, i).applyMatrix4(at(i, matrix)); frameAt[i * 3] = point.x; frameAt[i * 3 + 1] = point.y; frameAt[i * 3 + 2] = point.z; }
    for (const key of SHAPE_KEYS) {
      const delta = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        point.set(frameAt[i * 3]!, frameAt[i * 3 + 1]!, frameAt[i * 3 + 2]!);
        const x = point.x - hips.x, original = point.clone();
        const width = smooth(1 - Math.abs(x) / (height * 0.22));
        if (key === 'chest') {
          const lobes = Math.max(smooth(1 - Math.abs(x - height * 0.06) / (height * 0.085)), smooth(1 - Math.abs(x + height * 0.06) / (height * 0.085)));
          const f = yFalloff(point.y, chest.y - height * 0.025, height * 0.075) * lobes * smooth((point.z - chest.z) / (height * 0.04));
          point.z += height * 0.12 * f;
        } else if (key === 'buttocks') {
          const f = yFalloff(point.y, hips.y - height * 0.025, height * 0.095) * width * smooth((hips.z - point.z) / (height * 0.035));
          point.z -= height * 0.10 * f;
        } else if (key === 'hips') point.x += x * yFalloff(point.y, hips.y, height * 0.13) * width;
        else if (key === 'waist') point.x += x * yFalloff(point.y, hips.y + height * 0.13, height * 0.09) * width;
        else if (key === 'thighs') point.x += Math.sign(x) * height * 0.05 * yFalloff(point.y, hips.y - height * 0.16, height * 0.15) * width;
        else point.x += x * yFalloff(point.y, chest.y + height * 0.09, height * 0.08) * width;
        point.sub(original).applyMatrix3(back.fromArray(backMaps, i * 9));
        delta[i * 3] = point.x; delta[i * 3 + 1] = point.y; delta[i * 3 + 2] = point.z;
      }
      const attribute = new THREE.Float32BufferAttribute(delta, 3); attribute.name = PREFIX + key;
      indices.push(attributes.length); attributes.push(attribute);
      if (normals) normals.push(new THREE.Float32BufferAttribute(new Float32Array(position.count * 3), 3));
    }
    // Loaders keep morph names on the mesh, not the attributes: name them, or rebuilding the
    // dictionary would add "0", "1"… aliases for every morph the file had.
    for (const [name, index] of Object.entries(oldNames)) if (attributes[index] && !attributes[index]!.name) attributes[index]!.name = name;
    mesh.updateMorphTargets();
    mesh.morphTargetDictionary = { ...mesh.morphTargetDictionary, ...oldNames };
    for (let i = 0; i < oldValues.length; i++) mesh.morphTargetInfluences![i] = oldValues[i];
    for (let k = 0; k < SHAPE_KEYS.length; k++) bank.set(indices[k], shape?.[SHAPE_KEYS[k]] ?? 0);
    weights.set(mesh, bank);
  }
  setBodyMorphs(weights, shape);
  return weights;
}
export function setBodyMorphs(weights: BodyMorphWeights, shape?: Shape) {
  for (const [mesh, bank] of weights) for (const [index, value] of bank) {
    const key = SHAPE_KEYS.find(key => mesh.morphTargetDictionary?.[PREFIX + key] === index)!;
    const next = shape ? THREE.MathUtils.clamp(shape[key] ?? 0, -0.35, 0.35) : value;
    bank.set(index, next); if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = next;
  }
}
