/**
 * The hair system: each hair part (front, back, side) is lock groups (HAIR_PARTS in the engine);
 * each lock is a guide curve grown from the scalp, combed by gravity, lift, sweep, curl and tip
 * curve, then turned into a ribbon (a hair card with a ridge, so it has some body). Long locks get
 * a chain of bones (hair_<part>_<n>_<k>) that the runtime's spring physics swings; short ones
 * follow the head. A scalp cap in the hair colour covers the skull between the locks.
 */
import * as THREE from 'three';
import { hairPart, type HairLocks, type HairSpec } from '@everloom/engine';
import { canvasTexture } from './paint';

export interface HeadShape {
  centre: THREE.Vector3;
  radii: THREE.Vector3;
  /** Height of the eyes (the hairline sits above them). */
  eyeY: number;
}

/** The skull as an ellipsoid, from the head-weighted vertices above the eyes. */
export function fitHead(body: THREE.SkinnedMesh, eyeY: number): HeadShape {
  const headIndex = body.skeleton.bones.findIndex((b) => b.name === 'head');
  const p = body.geometry.attributes.position!, si = body.geometry.attributes.skinIndex!, sw = body.geometry.attributes.skinWeight!;
  const pts: THREE.Vector3[] = [];
  for (let v = 0; v < p.count; v++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (si.getComponent(v, k) === headIndex) w += sw.getComponent(v, k);
    if (w > 0.9 && p.getY(v) > eyeY) pts.push(new THREE.Vector3(p.getX(v), p.getY(v), p.getZ(v)));
  }
  const box = new THREE.Box3().setFromPoints(pts);
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  // The box above the eyes is the top half of the skull: its centre sits at eye level, a little up.
  centre.y = eyeY + size.y * 0.12;
  return { centre, radii: new THREE.Vector3(size.x / 2, size.y * 0.98, size.z / 2), eyeY };
}

const deg = (d: number) => (d * Math.PI) / 180;

/** A point on the scalp: `theta` around the head (0 front, 90 the character's left), `phi` from the crown. */
function scalp(h: HeadShape, theta: number, phi: number, out = 1.04): { at: THREE.Vector3; normal: THREE.Vector3 } {
  const dir = new THREE.Vector3(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
  const at = new THREE.Vector3(dir.x * h.radii.x, dir.y * h.radii.y, dir.z * h.radii.z).multiplyScalar(out).add(h.centre);
  const normal = new THREE.Vector3(dir.x / h.radii.x, dir.y / h.radii.y, dir.z / h.radii.z).normalize();
  return { at, normal };
}

/** How far down from the crown the hairline sits, by direction: low at the nape, higher at the forehead. */
const hairline = (theta: number) => deg(62 + 46 * (1 - Math.cos(theta)) / 2);

/** Pushes a point out of the head ellipsoid (scaled by `pad`). */
function keepOut(h: HeadShape, p: THREE.Vector3, pad: number) {
  const d = new THREE.Vector3((p.x - h.centre.x) / (h.radii.x * pad), (p.y - h.centre.y) / (h.radii.y * pad), (p.z - h.centre.z) / (h.radii.z * pad));
  const l = d.length();
  if (l < 1 && l > 1e-6) p.set(h.centre.x + (d.x / l) * h.radii.x * pad, h.centre.y + (d.y / l) * h.radii.y * pad, h.centre.z + (d.z / l) * h.radii.z * pad);
}

/** The shoulders and back as an ellipsoid below the head: long hair rests on them, not in them. */
function keepOffBody(h: HeadShape, p: THREE.Vector3) {
  const c = new THREE.Vector3(h.centre.x, h.centre.y - h.radii.y * 3.4, h.centre.z - h.radii.z * 0.2);
  const r = new THREE.Vector3(h.radii.x * 2.3, h.radii.y * 2.6, h.radii.z * 1.3);
  const d = new THREE.Vector3((p.x - c.x) / r.x, (p.y - c.y) / r.y, (p.z - c.z) / r.z);
  const l = d.length();
  if (l < 1 && l > 1e-6) p.set(c.x + (d.x / l) * r.x, c.y + (d.y / l) * r.y, c.z + (d.z / l) * r.z);
}

interface Strand { points: THREE.Vector3[]; normals: THREE.Vector3[]; width: number; chain: boolean; tieAt: number }

function growLock(h: HeadShape, lock: HairLocks, spec: HairSpec, out: Strand[], kind: 'front' | 'back' | 'side') {
  const n = Math.max(1, lock.count);
  const lengthK = 1 + spec.length * 0.6;
  const volume = 1 + spec.volume * 0.5;
  const curl = Math.min(1, (lock.curl ?? 0) + spec.curl);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const theta = deg(lock.from + (lock.to - lock.from) * t);
    const phi = Math.max(0.05, lock.root * hairline(theta));
    const root = scalp(h, theta, phi, 1.02);
    const L = lock.length * lengthK;
    const segs = Math.max(4, Math.min(14, Math.round(L / 0.03)));
    const step = L / segs;
    const pts = [root.at.clone()], nrm = [root.normal.clone()];
    let p = root.at.clone();
    let tieAt = 0;
    if (lock.tie) {
      // To the tie, along the scalp; from there the tail hangs.
      // Each strand meets the tie a little apart from the others, so the tail has some thickness.
      const spread = 0.022 * (1 + spec.volume * 0.4);
      const a = (i / Math.max(1, n)) * Math.PI * 2;
      const tie = new THREE.Vector3(h.centre.x + lock.tie.side * h.radii.x * 0.92 + Math.cos(a) * spread * 0.6, h.centre.y + lock.tie.height + Math.sin(a) * spread, h.centre.z - h.radii.z * 0.9 - lock.tie.back * 0.2 + Math.cos(a) * spread * 0.4);
      for (let k = 1; k <= 4; k++) { const q = p.clone().lerp(tie, k / 4); keepOut(h, q, 1.03); pts.push(q); nrm.push(q.clone().sub(h.centre).normalize()); }
      p = pts[pts.length - 1]!.clone();
      tieAt = pts.length - 1;
    }
    let dir = lock.tie ? new THREE.Vector3(lock.tie.side * 0.6 + Math.cos((i / Math.max(1, n)) * Math.PI * 2) * 0.25, -0.4, -0.5 + Math.sin((i / Math.max(1, n)) * Math.PI * 2) * 0.2).normalize() : root.normal.clone().multiplyScalar(0.35 + lock.lift * 0.6).add(new THREE.Vector3(0, -1, 0)).normalize();
    for (let k = 1; k <= segs; k++) {
      const f = k / segs;
      // Gravity pulls the comb down; lift keeps it off the head.
      // Back hair is combed down and behind the shoulders; the sides follow the head's curve.
      const gravity = kind === 'back' && !lock.tie ? new THREE.Vector3(Math.sin(theta) * 0.15, -1, -0.55 * Math.abs(Math.sin(theta)) - 0.15).normalize() : new THREE.Vector3(0, -1, 0);
      dir.lerp(gravity, 0.22 * (1 - lock.lift * 0.6)).normalize();
      if (lock.tipCurve && f > 0.65) {
        const inward = h.centre.clone().sub(p).setY(0).normalize();
        dir.lerp(inward.multiplyScalar(Math.sign(lock.tipCurve)), Math.abs(lock.tipCurve) * 0.35).normalize();
      }
      p = p.clone().addScaledVector(dir, step);
      if (lock.sweep) p.x += (lock.sweep * step) / L;
      if (curl > 0) {
        const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1)).normalize();
        const a = f * Math.PI * 2 * (1.5 + curl * 2.5);
        p.addScaledVector(side, Math.sin(a) * curl * 0.012).z += Math.cos(a) * curl * 0.012;
      }
      keepOut(h, p, 1.03 + lock.lift * 0.06 * volume + (lock.tie ? 0 : f * 0.04 * volume));
      keepOffBody(h, p);
      pts.push(p.clone());
      nrm.push(p.clone().sub(h.centre).normalize());
    }
    // Cards wide enough to overlap, so the locks read as one mass of hair.
    out.push({ points: pts, normals: nrm, width: lock.width * 1.8 * (0.85 + volume * 0.15) * (lock.tie ? 1.3 : 1), chain: L > 0.12 && spec.physics, tieAt });
  }
}

function hairTexture(spec: HairSpec): THREE.CanvasTexture {
  const W = 128, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  const base = new THREE.Color(spec.color);
  grad.addColorStop(0, base.clone().multiplyScalar(0.8).getStyle());
  grad.addColorStop(0.5, base.getStyle());
  grad.addColorStop(1, (spec.tips ? new THREE.Color(spec.tips) : base.clone().multiplyScalar(1.05)).getStyle());
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // Strand lines and a shine band, as anime hair is drawn.
  g.globalAlpha = 0.25;
  g.strokeStyle = base.clone().multiplyScalar(0.55).getStyle();
  for (let x = 6; x < W; x += 11) { g.lineWidth = 1 + (x % 3); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 3, H); g.stroke(); }
  if (spec.highlight > 0) {
    g.globalAlpha = 0.35 + spec.highlight * 0.45;
    const shine = g.createLinearGradient(0, H * 0.18, 0, H * 0.32);
    shine.addColorStop(0, 'rgba(255,255,255,0)');
    shine.addColorStop(0.5, base.clone().lerp(new THREE.Color(1, 1, 1), 0.65).getStyle());
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = shine;
    g.fillRect(0, H * 0.18, W, H * 0.14);
  }
  return canvasTexture(c);
}

export interface BuiltHair { meshes: THREE.Object3D[]; bones: THREE.Bone[] }

/**
 * Builds the hair for `spec` on a body in its rest pose. The new bones hang under the head bone, so
 * a head-size change or a turn of the head moves the hair with it.
 */
export function buildHair(body: THREE.SkinnedMesh, head: HeadShape, spec: HairSpec): BuiltHair {
  const headBone = body.skeleton.bones.find((b) => b.name === 'head')!;
  headBone.updateWorldMatrix(true, false);
  const strands: Strand[] = [];
  for (const kind of ['back', 'side', 'front'] as const) for (const lock of hairPart(kind, spec[kind]).locks) growLock(head, lock, spec, strands, kind);
  const material = new THREE.MeshStandardMaterial({ name: 'Hair', map: hairTexture(spec), side: THREE.DoubleSide, roughness: 0.55, metalness: 0 });
  const meshes: THREE.Object3D[] = [];
  const bones: THREE.Bone[] = [];
  if (!strands.length) return { meshes, bones };
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [], skI: number[] = [], skW: number[] = [];
  const skeletonBones: THREE.Bone[] = [headBone];
  const toHead = new THREE.Matrix4().copy(headBone.matrixWorld).invert();
  strands.forEach((s, si) => {
    // A chain of bones along the hanging part of the strand.
    const chain: { bone: number; at: number }[] = [];
    if (s.chain) {
      const from = s.tieAt, count = Math.max(2, Math.min(5, Math.round((s.points.length - from) / 3)));
      let parent: THREE.Object3D = headBone;
      for (let k = 0; k < count; k++) {
        const at = from + Math.round(((s.points.length - 1 - from) * k) / count);
        const bone = new THREE.Bone();
        bone.name = `hair_${si}_${k}`;
        const world = s.points[at]!.clone();
        const local = world.clone().applyMatrix4(parent === headBone ? toHead : new THREE.Matrix4().copy(parent.matrixWorld).invert());
        bone.position.copy(local);
        parent.add(bone);
        bone.updateWorldMatrix(true, false);
        parent = bone;
        bones.push(bone);
        skeletonBones.push(bone);
        chain.push({ bone: skeletonBones.length - 1, at });
      }
    }
    const base = pos.length / 3;
    const n = s.points.length;
    for (let k = 0; k < n; k++) {
      const p = s.points[k]!, out = s.normals[k]!;
      const next = s.points[Math.min(n - 1, k + 1)]!, prev = s.points[Math.max(0, k - 1)]!;
      const along = next.clone().sub(prev).normalize();
      const side = new THREE.Vector3().crossVectors(along, out).normalize();
      const f = k / (n - 1);
      const w = s.width * (1 - f * 0.55) * 0.5;
      // Three across: the edges, and a ridge lifted off the head for body.
      for (const [o, lift, u] of [[-1, 0, 0], [0, 1, 0.5], [1, 0, 1]] as const) {
        const q = p.clone().addScaledVector(side, o * w).addScaledVector(out, lift * w * 0.35);
        pos.push(q.x, q.y, q.z);
        nor.push(out.x, out.y, out.z);
        uv.push(u, f);
        // Weights: the head near the root (and up to the tie), then along the chain.
        let b0 = 0, b1 = 0, t = 0;
        if (chain.length && k >= chain[0]!.at) {
          let c = 0;
          while (c < chain.length - 1 && k >= chain[c + 1]!.at) c++;
          const a = chain[c]!, b = chain[c + 1];
          b0 = a.bone; b1 = b ? b.bone : a.bone;
          t = b ? (k - a.at) / Math.max(1, b.at - a.at) : 0;
        }
        skI.push(b0, b1, 0, 0);
        skW.push(1 - t, t, 0, 0);
      }
      if (k < n - 1) {
        const r = base + k * 3, q = r + 3;
        // Wound so the outward side is the front face (the side the camera usually sees).
        idx.push(r, r + 1, q, r + 1, q + 1, q, r + 1, r + 2, q + 1, r + 2, q + 2, q + 1);
      }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skI, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skW, 4));
  geo.setIndex(idx);
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.name = 'Hair';
  mesh.frustumCulled = false;
  mesh.bind(new THREE.Skeleton(skeletonBones), body.bindMatrix);
  meshes.push(mesh);
  meshes.push(scalpCap(body, head, material));
  return { meshes, bones };
}

/** The skull above the hairline, a few millimetres out, in the hair material: no skin between locks. */
function scalpCap(body: THREE.SkinnedMesh, h: HeadShape, material: THREE.Material): THREE.SkinnedMesh {
  const p = body.geometry.attributes.position!, nrm = body.geometry.attributes.normal!, idx = body.geometry.index!;
  const inside = (v: number) => {
    const d = new THREE.Vector3((p.getX(v) - h.centre.x) / h.radii.x, (p.getY(v) - h.centre.y) / h.radii.y, (p.getZ(v) - h.centre.z) / h.radii.z);
    if (d.length() < 0.75) return false;
    const theta = Math.atan2(d.x, d.z), phi = Math.acos(Math.max(-1, Math.min(1, d.normalize().y)));
    return phi < hairline(theta) * 0.98;
  };
  const keep = new Uint8Array(p.count);
  for (let v = 0; v < p.count; v++) keep[v] = inside(v) ? 1 : 0;
  const map = new Map<number, number>();
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], skI: number[] = [], skW: number[] = [], out: number[] = [];
  const si = body.geometry.attributes.skinIndex!, sw = body.geometry.attributes.skinWeight!;
  const use = (v: number) => {
    let k = map.get(v);
    if (k !== undefined) return k;
    k = pos.length / 3;
    map.set(v, k);
    pos.push(p.getX(v) + nrm.getX(v) * 0.003, p.getY(v) + nrm.getY(v) * 0.003, p.getZ(v) + nrm.getZ(v) * 0.003);
    nor.push(nrm.getX(v), nrm.getY(v), nrm.getZ(v));
    uv.push(0.5, 0.15);
    for (let c = 0; c < 4; c++) { skI.push(si.getComponent(v, c)); skW.push(sw.getComponent(v, c)); }
    return k;
  };
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    if (keep[a] && keep[b] && keep[c]) out.push(use(a), use(b), use(c));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skI, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skW, 4));
  geo.setIndex(out);
  const cap = new THREE.SkinnedMesh(geo, material);
  cap.name = 'HairCap';
  cap.bind(body.skeleton, body.bindMatrix);
  return cap;
}
