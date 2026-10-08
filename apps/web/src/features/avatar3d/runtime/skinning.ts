/**
 * Where a skinned mesh's vertices really are at rest. Raw geometry positions can't be trusted for
 * that: optimized files store them quantized (KHR_mesh_quantization), and for skinned meshes the
 * scale back lives in the inverse bind matrices, not in the node. So positions, normals and morph
 * offsets go through the same path the GPU uses: bind matrix, bone matrices blended by the skin
 * weights, and back.
 */
import * as THREE from 'three';

/**
 * Per-vertex rest matrices for `mesh`, into the space `toSpace` maps world to. Call with the bones
 * in their rest pose and world matrices up to date.
 */
export function restMatrices(mesh: THREE.SkinnedMesh, toSpace: THREE.Matrix4) {
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  const pre = toSpace.clone().multiply(mesh.matrixWorld).multiply(mesh.bindMatrixInverse);
  const post = mesh.bindMatrix;
  const bm = mesh.skeleton.boneMatrices ?? new Float32Array(16 * mesh.skeleton.bones.length);
  const si = mesh.geometry.getAttribute('skinIndex'), sw = mesh.geometry.getAttribute('skinWeight');
  const blend = new THREE.Matrix4(), e = blend.elements;
  return (i: number, out: THREE.Matrix4) => {
    e.fill(0);
    let total = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw ? sw.getComponent(i, k) : k === 0 ? 1 : 0;
      if (w <= 0) continue;
      const o = (si ? si.getComponent(i, k) : 0) * 16;
      for (let j = 0; j < 16; j++) e[j]! += bm[o + j]! * w;
      total += w;
    }
    if (total <= 0) blend.identity();
    else if (Math.abs(total - 1) > 1e-6) blend.multiplyScalar(1 / total);
    return out.copy(pre).multiply(blend).multiply(post);
  };
}

/** Rest positions (and, if asked, normals) of every vertex, in `toSpace`. */
export function restGeometry(mesh: THREE.SkinnedMesh, toSpace: THREE.Matrix4, withNormals = false) {
  const pos = mesh.geometry.getAttribute('position'), nrm = mesh.geometry.getAttribute('normal');
  const at = restMatrices(mesh, toSpace);
  const m = new THREE.Matrix4(), n3 = new THREE.Matrix3(), v = new THREE.Vector3();
  const positions = new Float32Array(pos.count * 3), normals = withNormals && nrm ? new Float32Array(pos.count * 3) : null;
  for (let i = 0; i < pos.count; i++) {
    at(i, m);
    v.fromBufferAttribute(pos, i).applyMatrix4(m);
    positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
    if (normals) {
      v.fromBufferAttribute(nrm!, i).applyMatrix3(n3.getNormalMatrix(m)).normalize();
      normals[i * 3] = v.x; normals[i * 3 + 1] = v.y; normals[i * 3 + 2] = v.z;
    }
  }
  return { positions, normals, matrixAt: at };
}
