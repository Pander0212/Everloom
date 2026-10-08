/**
 * Body and face sliders at runtime. One controller per avatar drives morph targets by name on every
 * mesh that has them (the body, the face, lashes, and every fitted garment that carried the body's
 * morphs over), so clothes change shape with the body and never fall behind. Values move smoothly
 * toward their targets inside the render loop.
 */
import * as THREE from 'three';

export class MorphController {
  private meshes = new Set<THREE.Mesh>();
  private target = new Map<string, number>();
  private current = new Map<string, number>();
  /** While fitting a garment: everything at zero (the shape weights are transferred from). */
  neutral = false;
  /** Morph name → meshes with it, rebuilt when meshes come or go. */
  private index: Map<string, Array<{ mesh: THREE.Mesh; slot: number }>> | null = null;

  constructor(root?: THREE.Object3D) {
    if (root) this.register(root);
  }

  register(root: THREE.Object3D) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.morphTargetDictionary && Object.keys(m.morphTargetDictionary).length) this.meshes.add(m);
    });
    this.index = null;
    // A garment put on mid-way takes the current shape at once.
    this.write(true);
  }

  unregister(root: THREE.Object3D) {
    root.traverse((o) => this.meshes.delete(o as THREE.Mesh));
    this.index = null;
  }

  /** Every morph name any registered mesh has. */
  names(): string[] {
    return [...this.lookup().keys()];
  }

  /** Sets where morphs are heading (names not listed keep their target). `snap` jumps there at once. */
  set(weights: Readonly<Record<string, number>>, snap = false) {
    for (const [k, v] of Object.entries(weights)) {
      this.target.set(k, v);
      if (snap) this.current.set(k, v);
    }
    if (snap) this.write(true);
  }

  /** Clears the targets for names no longer driven (so they fall back to 0). */
  release(names: Iterable<string>) {
    for (const n of names) this.target.set(n, 0);
  }

  get moving() {
    for (const [k, t] of this.target) if (Math.abs((this.current.get(k) ?? 0) - (this.neutral ? 0 : t)) > 1e-3) return true;
    return false;
  }

  /** Steps toward the targets; returns true while anything is still moving. */
  update(dt: number): boolean {
    let moving = false;
    const k = 1 - Math.exp(-14 * dt);
    for (const [name, t] of this.target) {
      const goal = this.neutral ? 0 : t;
      const now = this.current.get(name) ?? 0;
      if (Math.abs(goal - now) < 1e-4) { if (now !== goal) this.current.set(name, goal); continue; }
      this.current.set(name, now + (goal - now) * k);
      moving = true;
    }
    this.write(false);
    return moving;
  }

  private lookup() {
    if (this.index) return this.index;
    const index = new Map<string, Array<{ mesh: THREE.Mesh; slot: number }>>();
    for (const mesh of this.meshes) for (const [name, slot] of Object.entries(mesh.morphTargetDictionary ?? {})) {
      let list = index.get(name);
      if (!list) index.set(name, (list = []));
      list.push({ mesh, slot });
    }
    return (this.index = index);
  }

  private write(_all: boolean) {
    const index = this.lookup();
    for (const [name] of this.target) {
      const value = this.neutral ? 0 : this.current.get(name) ?? 0;
      for (const { mesh, slot } of index.get(name) ?? []) if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[slot] = value;
    }
  }
}
