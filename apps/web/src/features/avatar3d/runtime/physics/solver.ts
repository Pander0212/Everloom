/**
 * Secondary motion: bone chains (hair, tails, skirts, coat tails, the chest) simulated as Verlet
 * springs at a fixed rate inside the render loop. The rule per joint follows the VRM spring bone
 * (VRMC_springBone): the tail keeps its momentum (less drag), is pulled back toward its rest direction
 * (stiffness), falls (gravity) and is blown (wind); then it's held at the bone's length and pushed out
 * of the body's spheres and capsules, and the bone is turned to point at it. Implemented here from
 * the specification, with a fixed step so it behaves the same at any frame rate.
 */
import * as THREE from 'three';

export interface JointSettings {
  stiffness: number;
  /** 0–1: how much motion is lost per 1/60 s. */
  drag: number;
  gravity: number;
  gravityDir: THREE.Vector3;
  wind: number;
  /** Collision radius of the tail, metres. */
  radius: number;
  /** Blend between rest (0) and the simulated turn (1): the chest's strength slider. */
  strength: number;
  /** Largest turn away from rest, radians (Infinity: no limit). */
  maxAngle: number;
}

export interface Collider {
  bone: THREE.Object3D;
  /** In the bone's local space. */
  offset: THREE.Vector3;
  /** Capsules: the far end, in the bone's local space. */
  tail: THREE.Vector3 | null;
  /** World radius, metres. */
  radius: number;
  on: boolean;
  /** For the editor overlay and tests. */
  label: string;
  /** Where it is this step (world). */
  worldA: THREE.Vector3;
  worldB: THREE.Vector3;
}

interface Joint {
  bone: THREE.Object3D;
  /** The tail in the bone's local space at rest (the child's position, or a virtual tail). */
  tailLocal: THREE.Vector3;
  boneAxis: THREE.Vector3;
  length: number;
  rest: THREE.Quaternion;
  prev: THREE.Vector3;
  curr: THREE.Vector3;
  settings: JointSettings;
  colliders: Collider[];
  /**
   * Per collider: how far the tail already sits inside it at rest (metres, 0 when clear). Hair
   * lying on the shoulders or a skirt over the hips starts in contact; pushing it fully out would
   * fling the whole chain away from the body, so it's only kept from going deeper than that.
   */
  slack: number[];
  /** Which chain it belongs to (for removing). */
  chain: number;
  phase: number;
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _head = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();

export const DEFAULT_JOINT: JointSettings = { stiffness: 1, drag: 0.4, gravity: 0.2, gravityDir: new THREE.Vector3(0, -1, 0), wind: 0.5, radius: 0.015, strength: 1, maxAngle: Infinity };

/** Closest point to p on segment ab. */
export function closestOnSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len = abx * abx + aby * aby + abz * abz;
  const t = len > 1e-12 ? Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len)) : 0;
  return out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
}

/** How far p is inside a sphere or capsule (radius + extra), with the collider where its bone is now. */
export function restDepth(p: THREE.Vector3, c: Collider, extra: number): number {
  c.bone.updateWorldMatrix(true, false);
  const a = _v1.copy(c.offset).applyMatrix4(c.bone.matrixWorld);
  const q = c.tail ? closestOnSegment(p, a, _v2.copy(c.tail).applyMatrix4(c.bone.matrixWorld), _v3) : a;
  return Math.max(0, c.radius + extra - p.distanceTo(q));
}

/** Pushes p out of a sphere or capsule (radius + extra); returns true if it moved. */
export function pushOut(p: THREE.Vector3, c: Collider, extra: number): boolean {
  const r = c.radius + extra;
  if (r <= 0) return false;
  const q = c.tail ? closestOnSegment(p, c.worldA, c.worldB, _v3) : _v3.copy(c.worldA);
  const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= r * r) return false;
  const d = Math.sqrt(d2);
  if (d < 1e-9) { p.set(q.x, q.y + r, q.z); return true; }
  p.set(q.x + (dx / d) * r, q.y + (dy / d) * r, q.z + (dz / d) * r);
  return true;
}

export class SpringSolver {
  private joints: Joint[] = [];
  colliders: Collider[] = [];
  /** Steps per second (30 on low quality, 60 otherwise). */
  hz = 60;
  /** Cap on simulated joints (quality levels); joints beyond it stay as they are animated. */
  maxPoints = 160;
  windDir = new THREE.Vector3(0.3, 0, 1).normalize();
  windStrength = 0;
  private time = 0;
  private acc = 0;
  private nextChain = 1;
  /** Joints left out because of the cap (shown in the editor). */
  dropped = 0;

  get size() { return this.joints.length; }

  /**
   * Adds a chain: each bone swings around its parent, pointing at the next (the last at a virtual tail
   * along its own direction, or `tail` if given). Returns an id for removing it.
   */
  addChain(bones: THREE.Object3D[], settings: Partial<JointSettings>, colliders: Collider[] = this.colliders, tail?: THREE.Vector3): number {
    const chain = this.nextChain++;
    const s: JointSettings = { ...DEFAULT_JOINT, ...settings, gravityDir: (settings.gravityDir ?? DEFAULT_JOINT.gravityDir).clone() };
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i]!;
      const child = bones[i + 1];
      let tailLocal: THREE.Vector3;
      if (child && child.parent === bone) tailLocal = child.position.clone();
      else if (i === bones.length - 1 && tail) tailLocal = tail.clone();
      else if (i > 0 && bones[i - 1] === bone.parent) {
        // The last bone: continue in its own direction, as long as the one before it.
        tailLocal = bone.position.clone().normalize().multiplyScalar(Math.max(1e-4, bone.position.length() * 0.7));
        if (bone.position.lengthSq() < 1e-12) tailLocal.set(0, -0.05, 0);
      } else tailLocal = tail?.clone() ?? new THREE.Vector3(0, -0.05, 0);
      if (tailLocal.lengthSq() < 1e-12) continue;
      if (this.joints.length >= this.maxPoints) { this.dropped++; continue; }
      bone.updateWorldMatrix(true, false);
      const curr = tailLocal.clone().applyMatrix4(bone.matrixWorld);
      const head = _head.setFromMatrixPosition(bone.matrixWorld);
      this.joints.push({ bone, tailLocal, boneAxis: tailLocal.clone().normalize(), length: curr.distanceTo(head), rest: bone.quaternion.clone(), prev: curr.clone(), curr, settings: s, colliders, slack: colliders.map((c) => restDepth(curr, c, s.radius)), chain, phase: Math.random() * Math.PI * 2 });
    }
    return chain;
  }

  removeChain(chain: number) {
    for (const j of this.joints) if (j.chain === chain) j.bone.quaternion.copy(j.rest);
    this.joints = this.joints.filter((j) => j.chain !== chain);
  }

  /** Every chain's id. */
  chainIds(): number[] {
    return [...new Set(this.joints.map((j) => j.chain))];
  }

  /** Changes settings for every joint of a chain (live editing). */
  setChainSettings(chain: number, settings: Partial<JointSettings>) {
    for (const j of this.joints) if (j.chain === chain) Object.assign(j.settings, settings);
  }

  /** Starts over from the current pose (after a teleport or a reset), every chain or one. */
  reset(chain?: number) {
    for (const j of this.joints) {
      if (chain !== undefined && j.chain !== chain) continue;
      j.bone.updateWorldMatrix(true, false);
      j.curr.copy(j.tailLocal).applyMatrix4(j.bone.matrixWorld);
      j.prev.copy(j.curr);
    }
    this.acc = 0;
  }

  /** Puts every simulated bone back at rest (physics off). */
  rest() {
    for (const j of this.joints) j.bone.quaternion.copy(j.rest);
  }

  /** Advances by dt seconds of real time in fixed steps (at most four per frame). */
  update(dt: number) {
    if (!this.joints.length || this.hz <= 0) return;
    const h = 1 / this.hz;
    this.acc = Math.min(this.acc + dt, h * 4);
    let steps = 0;
    while (this.acc >= h && steps < 4) { this.step(h); this.acc -= h; steps++; }
  }

  private updateColliders() {
    const seen = new Set<Collider>();
    for (const j of this.joints) for (const c of j.colliders) {
      if (seen.has(c)) continue;
      seen.add(c);
      c.bone.updateWorldMatrix(true, false);
      c.worldA.copy(c.offset).applyMatrix4(c.bone.matrixWorld);
      if (c.tail) c.worldB.copy(c.tail).applyMatrix4(c.bone.matrixWorld);
    }
  }

  /** One fixed step for every joint, parents before children. */
  step(h: number) {
    this.time += h;
    this.updateColliders();
    for (const j of this.joints) {
      const s = j.settings;
      const parent = j.bone.parent;
      if (!parent) continue;
      parent.updateWorldMatrix(true, false);
      // The bone's world transform with its rest rotation (the pose without this joint's own swing).
      _m.compose(j.bone.position, j.rest, j.bone.scale).premultiply(parent.matrixWorld);
      const head = _head.setFromMatrixPosition(_m);
      const restTail = _v1.copy(j.tailLocal).applyMatrix4(_m);
      const restDir = restTail.sub(head).normalize();
      // Drag per step, the same at 30 or 60 steps a second.
      const keep = Math.pow(1 - s.drag, h * 60);
      const next = _v2.copy(j.curr).sub(j.prev).multiplyScalar(keep).add(j.curr);
      next.addScaledVector(restDir, s.stiffness * h);
      next.addScaledVector(s.gravityDir, s.gravity * h);
      if (this.windStrength > 0 && s.wind > 0) {
        const gust = 0.6 + 0.4 * Math.sin(this.time * 1.7 + j.phase) * Math.sin(this.time * 0.63 + j.phase * 0.5);
        next.addScaledVector(this.windDir, this.windStrength * s.wind * gust * h * 0.6);
      }
      // Bone length, then the body, then the length again (a pushed point mustn't stretch the bone).
      // Holding the length can nudge the point back in, so repeat; the body wins the last word.
      next.sub(head).normalize().multiplyScalar(j.length).add(head);
      for (let it = 0; it < 4; it++) {
        let moved = false;
        for (let ci = 0; ci < j.colliders.length; ci++) { const c = j.colliders[ci]!; if (c.on && pushOut(next, c, s.radius - j.slack[ci]!)) moved = true; }
        if (!moved) break;
        if (it < 3) next.sub(head).normalize().multiplyScalar(j.length).add(head);
      }
      j.prev.copy(j.curr);
      j.curr.copy(next);
      // Turn the bone toward the tail: rotation from the rest direction to the new one, in parent space.
      parent.getWorldQuaternion(_q1);
      const restWorld = _q2.copy(_q1).multiply(j.rest);
      const toTail = _v1.copy(next).sub(head).normalize().applyQuaternion(restWorld.invert());
      const swing = _q2.setFromUnitVectors(j.boneAxis, toTail);
      if (Number.isFinite(s.maxAngle)) {
        const angle = 2 * Math.acos(Math.min(1, Math.abs(swing.w)));
        if (angle > s.maxAngle) swing.slerp(_q1.identity(), 1 - s.maxAngle / angle);
      }
      if (s.strength < 1) swing.slerp(_q1.identity(), 1 - Math.max(0, s.strength));
      j.bone.quaternion.copy(j.rest).multiply(swing);
      j.bone.updateWorldMatrix(false, true);
    }
  }

  /** The simulated tails (for the editor overlay and tests). */
  tails(): THREE.Vector3[] {
    return this.joints.map((j) => j.curr.clone());
  }
}

/** A collider factory for code that builds them (the generator, VRM conversion, tests). */
export function makeCollider(bone: THREE.Object3D, radius: number, offset = new THREE.Vector3(), tail: THREE.Vector3 | null = null, label = bone.name): Collider {
  return { bone, offset, tail, radius, on: true, label, worldA: new THREE.Vector3(), worldB: new THREE.Vector3() };
}
