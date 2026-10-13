/** Keep the garment's weighted secondary chains while replacing its humanoid weights. */
import * as THREE from 'three';
import type { HumanBone } from '@everloom/engine';
import type { LoadedModel } from '../loader';
import type { BodySurface, FittedPiece } from './extract';
import type { TransferResult } from './core';

export function preserveSecondary(source: THREE.Bone[], roles: Partial<Record<HumanBone, string>>, transform: THREE.Matrix4, model: LoadedModel, surface: BodySurface, pieces: FittedPiece[], result: TransferResult) {
  const mapped = new Map(Object.entries(roles).map(([role, name]) => [name, role as HumanBone]));
  const needed = new Set<THREE.Bone>();
  const anchor = (bone: THREE.Object3D | null): number | undefined => {
    for (let b = bone; b; b = b.parent) {
      const role = mapped.get(b.name), target = role && model.bones[role];
      for (let t = target || null; t; t = t.parent) {
        const index = surface.bones.indexOf(t); if (index >= 0) return index;
      }
    }
    return undefined;
  };
  for (const p of pieces) {
    const joints = p.geometry.getAttribute('fitJoints'), weights = p.geometry.getAttribute('fitWeights');
    if (!joints || !weights) continue;
    for (let v = 0; v < joints.count; v++) for (let k = 0; k < 4; k++) {
      let bone: THREE.Object3D | null = source[joints.getComponent(v, k)] ?? null;
      if (!bone || weights.getComponent(v, k) <= 0 || mapped.has(bone.name) || anchor(bone) === undefined) continue;
      while (bone && (bone as THREE.Bone).isBone && !mapped.has(bone.name)) { needed.add(bone as THREE.Bone); bone = bone.parent; }
    }
  }
  // Do not silently cut a connected chain in half. Oversized rigs keep surface weights.
  if (needed.size > 64 || surface.bones.length + result.bones.length + needed.size > 256) return { preserved: 0, skipped: needed.size };
  const indices = new Map<THREE.Bone, number>(), names = new Map<THREE.Bone, string>();
  const add = (b: THREE.Bone): number => {
    const existing = indices.get(b); if (existing !== undefined) return existing;
    const parentBone = b.parent as THREE.Bone | null;
    if (parentBone && needed.has(parentBone)) add(parentBone);
    const parent = parentBone && names.get(parentBone) || anchor(b)!;
    const name = `EvOriginal_${indices.size}_${b.name.replace(/[^a-z0-9_]/gi, '_').slice(0, 60)}`;
    const index = surface.bones.length + result.bones.length;
    const position = b.getWorldPosition(new THREE.Vector3()).applyMatrix4(transform).toArray() as [number, number, number];
    result.bones.push({ name, parent, position }); indices.set(b, index); names.set(b, name);
    return index;
  };
  needed.forEach(add);
  pieces.forEach((p, i) => {
    const joints = p.geometry.getAttribute('fitJoints'), weights = p.geometry.getAttribute('fitWeights');
    if (!joints || !weights) return;
    const out = result.meshes[i]!;
    for (let v = 0; v < joints.count; v++) {
      const extra = new Map<number, number>();
      for (let k = 0; k < 4; k++) {
        const bone = source[joints.getComponent(v, k)], index = bone && indices.get(bone), weight = weights.getComponent(v, k);
        if (index !== undefined && weight > 0) extra.set(index, (extra.get(index) ?? 0) + weight);
      }
      if (!extra.size) continue;
      const total = Math.min(1, [...extra.values()].reduce((a, b) => a + b, 0));
      for (let k = 0; k < 4; k++) {
        const index = out.joints[v * 4 + k]!, weight = out.weights[v * 4 + k]! * (1 - total);
        if (weight > 0) extra.set(index, (extra.get(index) ?? 0) + weight);
      }
      const best = [...extra].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = best.reduce((a, b) => a + b[1], 0);
      for (let k = 0; k < 4; k++) { out.joints[v * 4 + k] = best[k]?.[0] ?? 0; out.weights[v * 4 + k] = (best[k]?.[1] ?? 0) / sum; }
    }
  });
  return { preserved: needed.size, skipped: 0 };
}
