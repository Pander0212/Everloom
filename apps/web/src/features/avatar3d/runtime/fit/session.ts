/**
 * Fitting a garment in the browser, start to finish:
 *
 *   A. **Place** it on the body standing in its rest pose: a gizmo or big buttons move, turn and
 *      size it; snap buttons put it on the chest, hips, feet or head; mirror; reset; auto-align.
 *   B–D. **Rig** it in a worker: the transform is baked into the geometry, weights and morphs are
 *      transferred, and (for skirts and hair) swing chains are generated.
 *   Review: wear it in test poses and at slider extremes, see flagged vertices and covered skin.
 *   Save: a GLB with the body's skeleton, ready to bind to any avatar of this base.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GarmentPhysics, GarmentSlot } from '@everloom/engine';
import { jointSettings, type Avatar } from '../avatar';
import { bindGarment, pinnedTriangles, restPositions, swingingBones } from '../garments';
import { applyRestPose, disposeScene, type LoadedModel } from '../loader';
import { coverInWorker, transferInWorker } from './client';
import { FLAG, type TransferResult } from './core';
import { bodySurface, buildGarmentScene, type BodySurface, type FittedPiece } from './extract';

/** Where each slot sits, as fractions of the body's height (bottom, top). */
export const SLOT_RANGE: Record<GarmentSlot, [number, number]> = { top: [0.52, 0.85], outer: [0.45, 0.86], bottom: [0.08, 0.6], full: [0.3, 0.85], underwear: [0.47, 0.8], feet: [0, 0.07], socks: [0, 0.25], hands: [0.4, 0.55], head: [0.85, 1], hair: [0.55, 1.02] };

export type SnapTarget = 'chest' | 'hips' | 'feet' | 'head';

export interface PieceInfo { name: string; vertices: number; on: boolean }

const UNIT_GUESSES = [1, 0.01, 0.1, 0.001, 0.0254];

/** True when a non-indexed geometry's normals are one per face (every triangle's three agree). */
export function flatNormals(g: THREE.BufferGeometry): boolean {
  const n = g.getAttribute('normal');
  if (!n || n.count % 3) return false;
  for (let t = 0; t < n.count; t += 3) for (let c = 1; c < 3; c++) {
    if (Math.abs(n.getX(t) - n.getX(t + c)) > 1e-5 || Math.abs(n.getY(t) - n.getY(t + c)) > 1e-5 || Math.abs(n.getZ(t) - n.getZ(t + c)) > 1e-5) return false;
  }
  return true;
}

export class FittingSession {
  /** Holds the garment while it's placed: a child of the model, in the body's own space. */
  readonly placer = new THREE.Group();
  private content = new THREE.Group();
  private pieces: Array<FittedPiece & { mesh: THREE.Mesh; on: boolean }> = [];
  private start = new THREE.Matrix4();
  private surface: BodySurface | null = null;
  result: TransferResult | null = null;
  rigged: THREE.Object3D | null = null;
  private worn: { root: THREE.Group; adopted: Map<THREE.Object3D, THREE.Object3D>; chains: number[] } | null = null;
  private flagMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  /** File units → the body's units (picked from the garment's size). */
  unitFactor = 1;
  unitNote = '';

  constructor(readonly avatar: Avatar, readonly model: LoadedModel, garment: THREE.Object3D, readonly slot: GarmentSlot) {
    this.placer.name = 'fitting';
    this.placer.add(this.content);
    garment.updateMatrixWorld(true);
    // Every mesh flattened to plain geometry in the file's space (skinned ones in their rest pose).
    garment.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry.getAttribute('position')) return;
      let g = m.geometry.clone();
      for (const k of ['skinIndex', 'skinWeight']) g.deleteAttribute(k);
      g.morphAttributes = {};
      g.applyMatrix4(m.matrixWorld);
      // OBJ and some exporters give every face its own corners: weld identical ones (UV seams and
      // hard edges stay split), so a 20,000-vertex garment is rigged and saved as 20,000, not 120,000.
      if (g.groups.length <= 1) {
        const before = g.getAttribute('position').count;
        // Normals made per face by the loader (an OBJ without normals) would keep every corner apart.
        const flat = !g.index && flatNormals(g);
        if (flat) g.deleteAttribute('normal');
        const welded = mergeVertices(g, 1e-6);
        if (flat) welded.computeVertexNormals();
        if (welded.getAttribute('position').count < before) { g.dispose(); g = welded; } else welded.dispose();
      }
      const mesh = new THREE.Mesh(g, m.material);
      mesh.name = m.name;
      this.content.add(mesh);
      this.pieces.push({ name: m.name || `Piece ${this.pieces.length + 1}`, geometry: g, material: m.material, mesh, on: true });
    });
    if (!this.pieces.length) throw new Error('The file has no mesh to fit.');
    this.guessUnits();
    this.model.scene.add(this.placer);
    this.avatar.restPose = true;
    this.avatar.morphs.neutral = true;
    this.autoPlace(false);
    this.start.copy(this.placer.matrix);
  }

  /** The body's height in its own units, and its floor and centre. */
  private bodyBox() {
    applyRestPose(this.model);
    const box = new THREE.Box3();
    const inv = this.model.scene.matrixWorld.clone().invert();
    for (const m of this.model.meshes) {
      if (m.parent === this.content || /^garment:|fitting/.test(m.parent?.name ?? '')) continue;
      const b = new THREE.Box3().setFromObject(m).applyMatrix4(inv);
      if (!b.isEmpty()) box.union(b);
    }
    return box;
  }

  private contentBox() {
    this.content.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const p of this.pieces) if (p.on) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox!); }
    return box;
  }

  /** Centimetres, millimetres, inches or decimetres: the factor that makes the garment a believable size. */
  private guessUnits() {
    const body = this.bodyBox(), H = body.max.y - body.min.y;
    const size = this.contentBox().getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z);
    const [lo, hi] = this.slot === 'feet' || this.slot === 'hands' ? [0.04, 0.6] : [0.08, 1.3];
    // In metres: the body's height, and the garment's size for each guess at its file's units.
    const bodyMetres = H * this.model.scale;
    const pick = UNIT_GUESSES.find((f) => extent * f >= lo * bodyMetres && extent * f <= hi * bodyMetres) ?? 1;
    this.unitFactor = pick;
    this.unitNote = pick === 1 ? 'The file is in metres.' : pick === 0.01 ? 'The file looks like centimetres; scaled to metres.' : pick === 0.001 ? 'The file looks like millimetres; scaled to metres.' : pick === 0.0254 ? 'The file looks like inches; scaled to metres.' : 'The file looks like decimetres; scaled to metres.';
    // Garment metres → the body's own units.
    this.content.scale.setScalar(pick / this.model.scale);
  }

  /** Puts it where its slot is, keeping its size (or, with `fitSize`, scaling it to the slot's height). */
  autoPlace(fitSize: boolean) {
    const body = this.bodyBox(), H = body.max.y - body.min.y;
    const [b, t] = SLOT_RANGE[this.slot];
    this.placer.position.set(0, 0, 0); this.placer.quaternion.identity(); this.placer.scale.setScalar(1);
    this.placer.updateMatrixWorld(true);
    if (fitSize) {
      const box = this.contentBox().applyMatrix4(this.content.matrix);
      const h = box.max.y - box.min.y;
      if (h > 1e-6) this.placer.scale.setScalar((H * (t - b)) / h);
    }
    const centre = body.getCenter(new THREE.Vector3());
    this.moveCentreTo(new THREE.Vector3(centre.x, body.min.y + H * (b + t) * 0.5, centre.z), this.slot === 'feet' ? body.min.y : null);
    // Then onto the landmark the slot hangs from (a top's upper edge at the neck, a waistband at the hips…).
    const landmark: Partial<Record<GarmentSlot, SnapTarget>> = { top: 'chest', outer: 'chest', full: 'chest', bottom: 'hips', feet: 'feet', socks: 'feet', head: 'head', hair: 'head' };
    if (landmark[this.slot]) this.snap(landmark[this.slot]!);
    else if (this.slot === 'underwear') this.snapCrotch();
  }

  /** Underwear: its lower edge just under the hip joints (where the crotch is), centred on the body. */
  snapCrotch() {
    applyRestPose(this.model);
    const inv = this.model.scene.matrixWorld.clone().invert();
    const b = this.model.bones, body = this.bodyBox(), H = body.max.y - body.min.y;
    const legs = [b.leftUpperLeg, b.rightUpperLeg].filter(Boolean).map((o) => o!.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv));
    const joint = legs.length ? legs.reduce((s, p) => s + p.y, 0) / legs.length : body.min.y + H * 0.5;
    const crotch = joint - H * 0.045;
    const box = this.placedBox(), gc = box.getCenter(new THREE.Vector3());
    const m = this.bodySlice(crotch + H * 0.06) ?? body.getCenter(new THREE.Vector3());
    this.placer.position.add(new THREE.Vector3(m.x - gc.x, crotch - box.min.y, m.z - gc.z));
    this.placer.updateMatrixWorld(true);
  }

  private placedBox() {
    this.placer.updateMatrix();
    return this.contentBox().applyMatrix4(this.content.matrix).applyMatrix4(this.placer.matrix);
  }

  /** Moves the garment so its middle (or, for feet, its sole) lands on the point. */
  private moveCentreTo(p: THREE.Vector3, floor: number | null) {
    const box = this.placedBox(), c = box.getCenter(new THREE.Vector3());
    this.placer.position.add(new THREE.Vector3(p.x - c.x, floor !== null ? floor - box.min.y : p.y - c.y, p.z - c.z));
    this.placer.updateMatrixWorld(true);
  }

  /**
   * Snaps to a part of the body, found from its bones: a top's upper edge to the base of the neck, a
   * waistband just above the hip joints, soles to the floor under the feet, a hat or hair to the top
   * of the head. Sideways and front-to-back it centres on the body at that height.
   */
  snap(to: SnapTarget) {
    applyRestPose(this.model);
    const inv = this.model.scene.matrixWorld.clone().invert();
    const at = (o?: THREE.Object3D) => (o ? o.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv) : null);
    const b = this.model.bones, body = this.bodyBox(), centre = body.getCenter(new THREE.Vector3()), H = body.max.y - body.min.y;
    const box = this.placedBox(), gc = box.getCenter(new THREE.Vector3());
    const shift = new THREE.Vector3();
    const middleAt = (y: number) => this.bodySlice(y) ?? centre;
    if (to === 'feet') {
      const l = at(b.leftFoot), r = at(b.rightFoot);
      const mid = l && r ? l.add(r).multiplyScalar(0.5) : centre;
      shift.set(mid.x - gc.x, body.min.y - box.min.y, middleAt(body.min.y + H * 0.03).z - gc.z);
    } else if (to === 'chest') {
      const neck = at(b.neck) ?? at(b.head)?.addScaledVector(new THREE.Vector3(0, -1, 0), H * 0.05) ?? new THREE.Vector3(centre.x, body.min.y + H * 0.82, centre.z);
      const m = middleAt(neck.y - H * 0.12);
      shift.set(m.x - gc.x, neck.y + H * 0.005 - box.max.y, m.z - gc.z);
    } else if (to === 'hips') {
      const hips = at(b.hips) ?? new THREE.Vector3(centre.x, body.min.y + H * 0.52, centre.z);
      const top = Math.max(hips.y, at(b.leftUpperLeg)?.y ?? hips.y) + H * 0.06;
      const m = middleAt(top - H * 0.05);
      shift.set(m.x - gc.x, top - box.max.y, m.z - gc.z);
    } else {
      const head = at(b.head) ?? new THREE.Vector3(centre.x, body.max.y - H * 0.08, centre.z);
      const m = middleAt(head.y + H * 0.03);
      shift.set(m.x - gc.x, body.max.y + H * 0.01 - box.max.y, m.z - gc.z);
    }
    this.placer.position.add(shift);
    this.placer.updateMatrixWorld(true);
  }

  /** The middle of the body's cross-section at a height (rest pose, its own space). */
  private bodySlice(y: number): THREE.Vector3 | null {
    this.surface ??= bodySurface(this.model);
    const s = this.surface.input, p = s.positions, band = (s.height || 1) * 0.02;
    let n = 0, x = 0, zMin = Infinity, zMax = -Infinity, xMin = Infinity, xMax = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      if (Math.abs(p[i + 1]! - y) > band) continue;
      n++; x += p[i]!; xMin = Math.min(xMin, p[i]!); xMax = Math.max(xMax, p[i]!); zMin = Math.min(zMin, p[i + 2]!); zMax = Math.max(zMax, p[i + 2]!);
    }
    return n ? new THREE.Vector3((xMin + xMax) / 2, y, (zMin + zMax) / 2) : null;
  }

  mirror() {
    this.placer.scale.x *= -1;
    this.placer.updateMatrixWorld(true);
  }

  reset() {
    this.placer.matrix.copy(this.start);
    this.placer.matrix.decompose(this.placer.position, this.placer.quaternion, this.placer.scale);
    this.placer.updateMatrixWorld(true);
  }

  setPieceOn(index: number, on: boolean) {
    const p = this.pieces[index];
    if (!p) return;
    p.on = on;
    p.mesh.visible = on;
  }

  get pieceInfo(): PieceInfo[] {
    return this.pieces.map((p) => ({ name: p.name, vertices: p.geometry.getAttribute('position').count, on: p.on }));
  }

  /** Nudges: position in centimetres, rotation in degrees, size as a factor. */
  nudge(kind: 'move' | 'turn' | 'size', axis: 'x' | 'y' | 'z' | 'all', amount: number) {
    const cm = 0.01 / this.model.scale;
    if (kind === 'move' && axis !== 'all') this.placer.position[axis] += amount * cm;
    // Turns about the body's own axes (the garment's parent), whatever way it's already turned.
    else if (kind === 'turn' && axis !== 'all') this.placer.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0), THREE.MathUtils.degToRad(amount)));
    else if (kind === 'size') {
      const f = 1 + amount;
      if (axis === 'all') this.placer.scale.multiplyScalar(f);
      else this.placer.scale[axis] *= f;
    }
    this.placer.updateMatrixWorld(true);
  }

  /** The placement as numbers (centimetres, degrees, percent) for the fields, and back. */
  get transform() {
    const cm = 100 * this.model.scale;
    const e = new THREE.Euler().setFromQuaternion(this.placer.quaternion);
    return { position: this.placer.position.toArray().map((v) => v * cm) as [number, number, number], rotation: [e.x, e.y, e.z].map((r) => THREE.MathUtils.radToDeg(r)) as [number, number, number], scale: this.placer.scale.toArray().map((s) => s * 100) as [number, number, number] };
  }
  setTransform(t: { position?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] }) {
    const cm = 100 * this.model.scale;
    if (t.position) this.placer.position.fromArray(t.position.map((v) => v / cm));
    if (t.rotation) this.placer.rotation.set(...(t.rotation.map((d) => THREE.MathUtils.degToRad(d)) as [number, number, number]));
    if (t.scale) this.placer.scale.fromArray(t.scale.map((s) => (Math.abs(s) < 0.1 ? 0.1 : s) / 100));
    this.placer.updateMatrixWorld(true);
  }

  /** Bakes the placement into the geometry (body space), so rigging works in the body's own space. */
  private baked(): FittedPiece[] {
    this.placer.updateMatrix();
    this.content.updateMatrix();
    const m = this.placer.matrix.clone().multiply(this.content.matrix);
    const flip = m.determinant() < 0;
    return this.pieces.filter((p) => p.on).map((p) => {
      const g = p.geometry.clone().applyMatrix4(m);
      if (flip) {
        // A mirrored garment turns inside out: swap the winding back.
        if (!g.index) g.setIndex([...Array(g.getAttribute('position').count).keys()]);
        const idx = g.index!.array as Uint32Array | Uint16Array;
        for (let i = 0; i < idx.length; i += 3) { const a = idx[i + 1]!; idx[i + 1] = idx[i + 2]!; idx[i + 2] = a; }
        g.index!.needsUpdate = true;
      }
      return { name: p.name, geometry: g, material: p.material };
    });
  }

  /** Steps B–D in the worker. */
  async rig(opts: { pushOut: boolean; physics: GarmentPhysics | null; progress?: (f: number, step: string) => void; signal?: AbortSignal }) {
    this.unwear();
    const pieces = this.baked();
    opts.progress?.(0.02, 'Reading the body…');
    this.surface ??= bodySurface(this.model);
    const unit = 1 / this.model.scale; // metres → body units
    const anchor = opts.physics?.mode === 'hair' ? this.model.bones.head : this.model.bones.hips;
    applyRestPose(this.model);
    const centre = anchor ? anchor.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.model.scene.matrixWorld.clone().invert()) : new THREE.Vector3();
    const swing = opts.physics && opts.physics.mode !== 'none' ? { mode: opts.physics.mode, pinStart: opts.physics.pinStart, pinEnd: opts.physics.pinEnd, chains: opts.physics.chains, segments: opts.physics.segments, prefix: `EvSwing${Math.random().toString(36).slice(2, 7)}`, center: centre.toArray() as [number, number, number] } : null;
    opts.progress?.(0.08, 'Copying weights and shapes in the background…');
    const result = await transferInWorker(this.surface.input, pieces.map((p) => ({ positions: Float32Array.from(p.geometry.getAttribute('position').array as Float32Array), indices: p.geometry.index ? Uint32Array.from(p.geometry.index.array as ArrayLike<number>) : null })), { maxDistance: 0.06 * unit, offset: 0.004 * unit, pushOut: opts.pushOut, swing }, (f) => opts.progress?.(0.08 + f * 0.82, 'Copying weights and shapes in the background…'), opts.signal);
    opts.progress?.(0.92, 'Building the rigged garment…');
    // Let the page show that step before the (short) main-thread work starts.
    await new Promise((r) => setTimeout(r, 30));
    this.result = result;
    if (this.rigged) disposeScene(this.rigged);
    this.rigged = buildGarmentScene(this.model, this.surface, pieces, result);
    this.placer.visible = false;
    opts.progress?.(1, 'Done');
    return result;
  }

  /** Wears the rigged garment for review: posed, with physics, morphs and covered skin. */
  async wear(physics: GarmentPhysics | null) {
    if (!this.rigged) return;
    this.unwear();
    this.avatar.restPose = false;
    this.avatar.morphs.neutral = false;
    const copy = this.rigged.clone(true);
    // Skinned meshes need their own skeleton after cloning: rebind by name, as wearing does.
    const sourceMeshes: THREE.SkinnedMesh[] = [], copyMeshes: THREE.SkinnedMesh[] = [];
    this.rigged.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && sourceMeshes.push(o as THREE.SkinnedMesh));
    copy.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && copyMeshes.push(o as THREE.SkinnedMesh));
    const byName = new Map<string, THREE.Object3D>(); copy.traverse((o) => { if (!byName.has(o.name)) byName.set(o.name, o); });
    copyMeshes.forEach((m, i) => m.bind(new THREE.Skeleton(sourceMeshes[i]!.skeleton.bones.map((b) => byName.get(b.name) as THREE.Bone), sourceMeshes[i]!.skeleton.boneInverses), sourceMeshes[i]!.bindMatrix));
    copy.updateMatrixWorld(true);
    const { root, adopted } = bindGarment(copy, this.model.scene, 1);
    root.name = 'garment:fitting-review';
    this.model.scene.add(root);
    const chains: THREE.Object3D[][] = [];
    for (const b of adopted.keys()) {
      if (b.parent && adopted.has(b.parent)) continue;
      const chain = [b];
      for (let cur = b; chain.length < 12;) { const next = cur.children.find((c) => (c as THREE.Bone).isBone); if (!next) break; chain.push(next); cur = next; }
      chains.push(chain);
    }
    const ids = chains.length ? this.avatar.addSpringChains(chains, physics ? jointSettings(physics.settings, this.avatar.options.stiffness, this.avatar.options.gravity, physics.mode === 'hair' ? 'hair' : 'cloth') : undefined) : [];
    this.worn = { root, adopted, chains: ids };
    this.avatar.morphs.register(root);
    // Hair is mostly see-through cards: the scalp under it stays.
    if (this.slot !== 'hair' && physics?.mode !== 'hair') await this.cover(root);
    else this.coveredTriangles = 0;
  }

  /** Hides the skin under the garment (and returns how many triangles). */
  private async cover(root: THREE.Object3D) {
    const wardrobe = this.avatar.wardrobe;
    if (!wardrobe?.hasBody) return 0;
    const meshes: THREE.SkinnedMesh[] = [];
    root.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && meshes.push(o as THREE.SkinnedMesh));
    const saved = [...(this.model.restPose?.keys() ?? [])].map((b) => [b, b.quaternion.clone(), b.position.clone()] as const);
    applyRestPose(this.model);
    root.userData.adopted = [...(this.worn?.adopted.keys() ?? [])];
    const swinging = swingingBones(root);
    const parts = meshes.map((m) => ({ positions: restPositions(m, this.model.scene), indices: pinnedTriangles(m, swinging) }));
    for (const [b, q, p] of saved) { b.quaternion.copy(q); b.position.copy(p); }
    let n = 0; for (const p of parts) n += p.positions.length / 3;
    const positions = new Float32Array(n * 3), indices: number[] = [];
    let o = 0;
    for (const p of parts) { positions.set(p.positions, o * 3); for (const i of p.indices) indices.push(i + o); o += p.positions.length / 3; }
    let hidden = 0;
    for (const body of wardrobe.bodyRest()) {
      const covered = await coverInWorker({ positions: body.positions, indices: body.indices }, { positions, indices: Uint32Array.from(indices) }, Math.max(0.01, this.model.height * 0.025) / this.model.scale);
      wardrobe.setCoverage('fitting-review', body.mesh, covered);
      hidden += covered.reduce((s, x) => s + x, 0);
    }
    this.coveredTriangles = hidden;
    return hidden;
  }
  coveredTriangles = 0;

  /** Colours flagged vertices: red where weights were filled in or mixed left and right, amber where pushed out. */
  showFlags(on: boolean) {
    if (!this.worn || !this.result) return;
    let i = 0;
    this.worn.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      const flags = this.result!.meshes[i++]?.flags;
      if (!flags) return;
      if (on) {
        const colors = new Float32Array(flags.length * 3);
        for (let v = 0; v < flags.length; v++) {
          const f = flags[v]!;
          const c = f & (FLAG.mixedLimbs | FLAG.far) ? [0.95, 0.15, 0.15] : f & FLAG.filled ? [0.95, 0.45, 0.2] : f & FLAG.pushed ? [0.95, 0.8, 0.2] : [0.75, 0.82, 0.9];
          colors.set(c, v * 3);
        }
        m.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        if (!this.flagMaterials.has(m)) this.flagMaterials.set(m, m.material);
        m.material = new THREE.MeshBasicMaterial({ vertexColors: true });
      } else if (this.flagMaterials.has(m)) {
        (m.material as THREE.Material).dispose();
        m.material = this.flagMaterials.get(m)!;
        this.flagMaterials.delete(m);
      }
    });
  }

  /** Back to placing (after a review). */
  adjust() {
    this.unwear();
    this.placer.visible = true;
    this.avatar.restPose = true;
    this.avatar.morphs.neutral = true;
    this.avatar.override = null;
  }

  private unwear() {
    if (!this.worn) return;
    this.showFlags(false);
    this.avatar.removeSpringJoints(this.worn.chains);
    this.avatar.morphs.unregister(this.worn.root);
    this.avatar.wardrobe?.clearCoverage('fitting-review');
    for (const b of this.worn.adopted.keys()) b.removeFromParent();
    this.worn.root.removeFromParent();
    this.worn = null;
  }

  /** The rigged garment as a GLB, with what the fitting found in its extras. */
  async export(meta: Record<string, unknown>): Promise<ArrayBuffer> {
    if (!this.rigged) throw new Error('Fit the garment first.');
    this.rigged.userData = { everloom: { fitted: true, ...meta } };
    return (await new GLTFExporter().parseAsync(this.rigged, { binary: true, onlyVisible: false })) as ArrayBuffer;
  }

  /** Mesh names that are the body's skin (so covered skin can hide when it's worn). */
  get skinMeshes() {
    this.surface ??= bodySurface(this.model);
    return this.surface.names;
  }

  dispose() {
    this.unwear();
    this.placer.removeFromParent();
    for (const p of this.pieces) p.geometry.dispose();
    if (this.rigged) disposeScene(this.rigged);
    this.avatar.restPose = false;
    this.avatar.morphs.neutral = false;
    this.avatar.override = null;
  }
}
