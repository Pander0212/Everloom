/**
 * Placing a decal (a tattoo) by tapping the body: a ray from the camera through the tap meets the
 * posed, shaped skin; the texture coordinate there is where the decal is stamped, and the triangle
 * tells how one centimetre to the right and one up on the skin (as seen from the camera) move in the
 * texture. Stamped in texture space, the decal then bends with every pose, slider and animation.
 */
import * as THREE from 'three';
import type { Decal } from '@everloom/engine';
import { NOT_SKIN } from './fit/extract';

export interface SkinHit { decal: Pick<Decal, 'u' | 'v' | 'right' | 'up' | 'mesh'>; point: THREE.Vector3 }

const raycaster = new THREE.Raycaster();

/**
 * The texture-space frame at a point of a triangle: d(uv)/d(position) applied to the given world
 * directions. Exported for tests.
 */
export function uvFrame(p: [THREE.Vector3, THREE.Vector3, THREE.Vector3], uv: [THREE.Vector2, THREE.Vector2, THREE.Vector2], right: THREE.Vector3, up: THREE.Vector3): { right: [number, number]; up: [number, number] } {
  const e1 = p[1].clone().sub(p[0]), e2 = p[2].clone().sub(p[0]);
  const d1 = uv[1].clone().sub(uv[0]), d2 = uv[2].clone().sub(uv[0]);
  const g11 = e1.dot(e1), g12 = e1.dot(e2), g22 = e2.dot(e2), det = g11 * g22 - g12 * g12;
  const map = (d: THREE.Vector3): [number, number] => {
    if (Math.abs(det) < 1e-18) return [0, 0];
    // d ≈ a·e1 + b·e2 (least squares in the triangle's plane), then the same mix of UV edges.
    const r1 = d.dot(e1), r2 = d.dot(e2);
    const a = (r1 * g22 - r2 * g12) / det, b = (r2 * g11 - r1 * g12) / det;
    return [a * d1.x + b * d2.x, a * d1.y + b * d2.y];
  };
  return { right: map(right), up: map(up) };
}

/** Where a tap lands on the skin, or null. `metresPerUnit` converts the scene's units to metres. */
export function pickSkin(camera: THREE.Camera, root: THREE.Object3D, ndc: THREE.Vector2, meshNames: readonly string[], metresPerUnit = 1): SkinHit | null {
  const targets: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible || /^garment:|fitting/.test(m.parent?.name ?? '') || !m.geometry.getAttribute('uv')) return;
    if (meshNames.length ? meshNames.includes(m.name) : (m as THREE.SkinnedMesh).isSkinnedMesh && !NOT_SKIN.test(m.name)) targets.push(m);
  });
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(targets, false)[0];
  if (!hit?.face || !hit.uv) return null;
  const mesh = hit.object as THREE.Mesh;
  const idx = [hit.face.a, hit.face.b, hit.face.c];
  // The triangle as it is now (posed, shaped), in world space.
  const p = idx.map((i) => mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  const uvAttr = mesh.geometry.getAttribute('uv');
  const uv = idx.map((i) => new THREE.Vector2(uvAttr.getX(i), uvAttr.getY(i))) as [THREE.Vector2, THREE.Vector2, THREE.Vector2];
  const normal = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0])).normalize();
  // "Right" as the camera sees it, laid on the skin; "up" across it.
  const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
  const right = camRight.sub(normal.clone().multiplyScalar(camRight.dot(normal))).normalize();
  const up = normal.clone().cross(right).normalize();
  // Per centimetre: world units per cm, then into texture space.
  const cm = 0.01 / metresPerUnit;
  const frame = uvFrame(p, uv, right.multiplyScalar(cm), up.multiplyScalar(cm));
  const clamp = (v: number) => Math.min(1, Math.max(-1, v));
  return { decal: { u: THREE.MathUtils.clamp(hit.uv.x, 0, 1), v: THREE.MathUtils.clamp(hit.uv.y, 0, 1), right: [clamp(frame.right[0]), clamp(frame.right[1])], up: [clamp(frame.up[0]), clamp(frame.up[1])], mesh: mesh.name }, point: hit.point };
}
