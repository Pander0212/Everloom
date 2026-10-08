/**
 * Body colliders made from the body's own proportions: a sphere for the head and the hips, capsules
 * along the spine, across the shoulders, and down the upper arms and legs. Each radius is measured
 * from the skin around that bone (the median distance of the vertices it moves most), so hair and
 * skirts slide along the real body. The owner can scale, move or switch off each one.
 */
import * as THREE from 'three';
import type { ColliderEdit, HumanBone } from '@everloom/engine';
import { withRestPose, type LoadedModel } from '../loader';
import { makeCollider, type Collider } from './solver';
import { NOT_SKIN } from '../fit/extract';
import { restMatrices } from '../skinning';

interface Spec { bone: HumanBone; to?: HumanBone | 'shoulders'; fallback: number; kind: 'sphere' | 'capsule'; up?: number }
const SPECS: Spec[] = [
  { bone: 'head', kind: 'sphere', fallback: 0.06, up: 0.045 },
  { bone: 'spine', to: 'neck', kind: 'capsule', fallback: 0.075 },
  { bone: 'upperChest', to: 'shoulders', kind: 'capsule', fallback: 0.045 },
  { bone: 'hips', kind: 'sphere', fallback: 0.09 },
  { bone: 'leftUpperLeg', to: 'leftLowerLeg', kind: 'capsule', fallback: 0.055 },
  { bone: 'rightUpperLeg', to: 'rightLowerLeg', kind: 'capsule', fallback: 0.055 },
  { bone: 'leftLowerLeg', to: 'leftFoot', kind: 'capsule', fallback: 0.04 },
  { bone: 'rightLowerLeg', to: 'rightFoot', kind: 'capsule', fallback: 0.04 },
  { bone: 'leftUpperArm', to: 'leftLowerArm', kind: 'capsule', fallback: 0.035 },
  { bone: 'rightUpperArm', to: 'rightLowerArm', kind: 'capsule', fallback: 0.035 },
];

const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };

/** Measures and builds the colliders (in the file's rest pose; the current pose is kept). */
export function generateColliders(model: LoadedModel, edits: readonly ColliderEdit[] = []): Collider[] {
  return withRestPose(model, () => measure(model, edits));
}

function measure(model: LoadedModel, edits: readonly ColliderEdit[]): Collider[] {
  const b = model.bones;
  const h = model.height;
  const chest = b.upperChest ?? b.chest ?? b.spine;
  // Which canonical bone moves each vertex most, and the vertex's rest position (world).
  const human = new Map<THREE.Object3D, HumanBone>();
  for (const [k, o] of Object.entries(b)) if (o) human.set(o, k as HumanBone);
  const owner = (bone: THREE.Object3D) => { for (let o: THREE.Object3D | null = bone; o; o = o.parent) { const k = human.get(o); if (k) return k; } return null; };
  const samples = new Map<HumanBone, THREE.Vector3[]>();
  const v = new THREE.Vector3();
  model.scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || NOT_SKIN.test(m.name) || /^garment:/.test(m.parent?.name ?? '')) return;
    const pos = m.geometry.getAttribute('position'), si = m.geometry.getAttribute('skinIndex'), sw = m.geometry.getAttribute('skinWeight');
    if (!pos || !si || !sw) return;
    const stride = Math.max(1, Math.floor(pos.count / 12000));
    // World rest positions through the skinning path (optimized files store positions quantized).
    const at = restMatrices(m, new THREE.Matrix4()), mat = new THREE.Matrix4();
    for (let i = 0; i < pos.count; i += stride) {
      let best = 0, w = -1;
      for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > w) { w = sw.getComponent(i, k); best = si.getComponent(i, k); }
      const bone = m.skeleton.bones[best];
      const k = bone ? owner(bone) : null;
      if (!k) continue;
      v.fromBufferAttribute(pos, i).applyMatrix4(at(i, mat));
      let list = samples.get(k);
      if (!list) samples.set(k, (list = []));
      list.push(v.clone());
    }
  });
  const world = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
  const out: Collider[] = [];
  const seg = new THREE.Vector3(), q = new THREE.Vector3();
  for (const spec of SPECS) {
    const bone = spec.bone === 'upperChest' ? chest : b[spec.bone];
    if (!bone) continue;
    const edit = edits.find((e) => e.bone === spec.bone);
    const scale = new THREE.Vector3().setFromMatrixScale(bone.matrixWorld).x || 1;
    let a = world(bone), end: THREE.Vector3 | null = null;
    if (spec.to === 'shoulders') {
      if (!b.leftUpperArm || !b.rightUpperArm) continue;
      a = world(b.leftUpperArm); end = world(b.rightUpperArm);
    } else if (spec.to) {
      const to = b[spec.to] ?? (spec.to === 'neck' ? b.head : undefined);
      if (to) end = world(to);
    }
    // Measured radius: the skin moved by this bone (or the bones on either side, across the shoulders).
    const pts = spec.to === 'shoulders' ? [...(samples.get('leftShoulder') ?? []), ...(samples.get('rightShoulder') ?? []), ...(samples.get(spec.bone) ?? samples.get('chest') ?? [])] : spec.bone === 'spine' ? [...(samples.get('spine') ?? []), ...(samples.get('chest') ?? []), ...(samples.get('upperChest') ?? [])] : samples.get(spec.bone) ?? [];
    const dists: number[] = [];
    for (const p of pts) {
      if (end) {
        seg.subVectors(end, a);
        const t = seg.lengthSq() > 1e-10 ? q.subVectors(p, a).dot(seg) / seg.lengthSq() : 0;
        if (t < 0.15 || t > 0.85) continue;
        dists.push(p.distanceTo(q.copy(a).addScaledVector(seg, t)));
      } else dists.push(p.distanceTo(a));
    }
    // Spheres reach from the joint to the surface; keep a little inside so cloth rests on the skin.
    let radius = dists.length >= 8 ? median(dists) * (spec.to === 'shoulders' ? 0.7 : 0.85) : spec.fallback * h;
    radius = THREE.MathUtils.clamp(radius, spec.fallback * h * 0.4, spec.fallback * h * 2.2) * (edit?.radius ?? 1);
    const inv = bone.matrixWorld.clone().invert();
    const offset = (spec.up ? a.clone().add(new THREE.Vector3(0, spec.up * h, 0)) : a).applyMatrix4(inv).add(new THREE.Vector3(...(edit?.offset ?? [0, 0, 0])).divideScalar(scale));
    const tail = end ? end.clone().applyMatrix4(inv) : null;
    const c = makeCollider(bone, radius, offset, tail, spec.bone);
    c.on = edit?.on ?? true;
    out.push(c);
  }
  return out;
}

/** Wireframe spheres and capsules showing where the colliders are (the physics editor). */
export class ColliderOverlay {
  readonly group = new THREE.Group();
  private items: Array<{ c: Collider; mesh: THREE.Mesh }> = [];
  private material = new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true, transparent: true, opacity: 0.55, depthTest: false });
  constructor(colliders: Collider[]) {
    this.group.name = 'collider-overlay';
    this.group.renderOrder = 999;
    for (const c of colliders) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), this.material);
      mesh.userData.label = c.label;
      this.group.add(mesh);
      this.items.push({ c, mesh });
    }
  }
  update() {
    const mid = new THREE.Vector3(), dir = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const { c, mesh } of this.items) {
      mesh.visible = c.on;
      if (!c.tail) {
        mesh.position.copy(c.worldA); mesh.quaternion.identity(); mesh.scale.setScalar(c.radius);
        continue;
      }
      mid.addVectors(c.worldA, c.worldB).multiplyScalar(0.5);
      dir.subVectors(c.worldB, c.worldA);
      const len = dir.length();
      mesh.position.copy(mid);
      mesh.quaternion.setFromUnitVectors(up, dir.normalize());
      // A stretched sphere reads as a capsule well enough for placing it.
      mesh.scale.set(c.radius, len / 2 + c.radius, c.radius);
    }
    if (this.group.parent) this.group.parent.updateMatrixWorld();
  }
  dispose() {
    this.group.removeFromParent();
    for (const { mesh } of this.items) mesh.geometry.dispose();
    this.material.dispose();
  }
}
