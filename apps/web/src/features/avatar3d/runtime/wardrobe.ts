/**
 * Dressing a loaded model: parts shown or hidden (meshes by name), body regions hidden under
 * clothes, and rigid accessories (a sword, a hat) attached to bones.
 *
 * Regions: every vertex of a body mesh belongs to the region of the canonical bone that moves it
 * most. Hiding a region swaps its triangles for empty (degenerate) ones in place, so the index
 * ranges other code relies on (material groups, outlines) never change.
 */
import * as THREE from 'three';
import { BODY_REGIONS, HUMAN_PARENT, regionMask, regionOfBone, type AvatarAccessory, type AvatarConfig, type HumanBone, type WardrobeState } from '@everloom/engine';
import type { Avatar } from './avatar';
import { Garments } from './garments';
import { loaderFor, nodeIndex, type LoadedModel } from './loader';

interface BodyMesh {
  mesh: THREE.Mesh;
  /** Region index of every vertex. */
  region: Uint8Array;
  original: Uint32Array | Uint16Array;
}

export class Wardrobe {
  private body: BodyMesh[] = [];
  private mask = 0;
  private accessories = new Map<string, { obj: THREE.Object3D; key: string }>();
  private find: (name: string) => THREE.Object3D | undefined;

  constructor(
    private model: LoadedModel,
    bodyMeshes: string[],
    private renderer: THREE.WebGLRenderer | null = null,
  ) {
    const all: THREE.Object3D[] = [];
    model.scene.traverse((o) => all.push(o));
    this.find = nodeIndex(all);
    const boneToHuman = new Map<THREE.Object3D, HumanBone>();
    for (const [k, o] of Object.entries(model.bones)) if (o) boneToHuman.set(o, k as HumanBone);
    // A bone outside the humanoid (a twist bone, a skirt bone) counts as its nearest humanoid ancestor.
    const humanOf = (b: THREE.Object3D | null): HumanBone | null => {
      for (let o = b; o; o = o.parent) {
        const h = boneToHuman.get(o);
        if (h) return h;
      }
      return null;
    };
    const targets = new Set<THREE.Mesh>();
    for (const name of bodyMeshes) {
      const o = this.find(name);
      o?.traverse((x) => (x as THREE.SkinnedMesh).isSkinnedMesh && targets.add(x as THREE.Mesh));
    }
    for (const mesh of targets) {
      const sk = (mesh as THREE.SkinnedMesh).skeleton;
      const g = mesh.geometry;
      const si = g.getAttribute('skinIndex');
      const sw = g.getAttribute('skinWeight');
      if (!sk || !si || !sw) continue;
      if (!g.index) g.setIndex([...Array(g.getAttribute('position').count).keys()]);
      const region = new Uint8Array(si.count);
      const regionOfJoint = sk.bones.map((b) => {
        const h = humanOf(b);
        return h ? BODY_REGIONS.indexOf(regionOfBone(h)) : 255;
      });
      for (let v = 0; v < si.count; v++) {
        let best = 0;
        let w = -1;
        for (let k = 0; k < 4; k++) {
          const wk = sw.getComponent(v, k);
          if (wk > w) {
            w = wk;
            best = si.getComponent(v, k);
          }
        }
        region[v] = regionOfJoint[best] ?? 255;
      }
      const arr = g.index!.array as Uint32Array | Uint16Array;
      this.body.push({ mesh, region, original: arr.slice() as Uint32Array | Uint16Array });
    }
  }

  get hasBody() {
    return this.body.length > 0;
  }

  /** Shows parts, hides covered regions, attaches accessories. */
  apply(cfg: Pick<AvatarConfig, 'parts'>, state: WardrobeState, mask: number) {
    for (const p of cfg.parts) for (const m of p.meshes) this.find(m)?.traverse((o) => void (o.visible = state.parts[p.id] !== false));
    if (mask !== this.mask) this.hideRegions(mask);
    void this.setAccessories(state.accessories);
  }

  private hideRegions(mask: number) {
    this.mask = mask;
    for (const b of this.body) {
      const idx = b.mesh.geometry.index!;
      const arr = idx.array as Uint32Array | Uint16Array;
      const hidden = (v: number) => b.region[v]! !== 255 && ((mask >> b.region[v]!) & 1) === 1;
      for (let t = 0; t < b.original.length; t += 3) {
        const a = b.original[t]!;
        const c = b.original[t + 1]!;
        const d = b.original[t + 2]!;
        // Hidden when most of the triangle is covered (edges stay, so seams don't open up).
        const n = (hidden(a) ? 1 : 0) + (hidden(c) ? 1 : 0) + (hidden(d) ? 1 : 0);
        if (n >= 2) arr[t] = arr[t + 1] = arr[t + 2] = a;
        else {
          arr[t] = a;
          arr[t + 1] = c;
          arr[t + 2] = d;
        }
      }
      idx.needsUpdate = true;
    }
  }

  private async setAccessories(list: AvatarAccessory[]) {
    const want = new Map(list.map((a) => [a.id, a]));
    for (const [id, e] of this.accessories) {
      const a = want.get(id);
      if (!a || e.key !== keyOf(a)) {
        e.obj.removeFromParent();
        disposeTree(e.obj);
        this.accessories.delete(id);
      }
    }
    for (const a of list) {
      if (this.accessories.has(a.id)) continue;
      const bone = this.model.bones[a.bone as HumanBone] ?? nearest(this.model, a.bone as HumanBone);
      if (!bone) continue;
      const entry = { obj: new THREE.Group(), key: keyOf(a) };
      this.accessories.set(a.id, entry);
      try {
        const gltf = await loaderFor(this.renderer).loadAsync(`/media/${a.model}`);
        if (this.accessories.get(a.id) !== entry) continue;
        entry.obj.add(gltf.scene);
        // Offsets are in metres and degrees whatever the skeleton's own scale.
        bone.updateWorldMatrix(true, false);
        const s = new THREE.Vector3().setFromMatrixScale(bone.matrixWorld).x || 1;
        entry.obj.position.set(...a.position).divideScalar(s);
        entry.obj.rotation.set(...(a.rotation.map((d) => (d * Math.PI) / 180) as [number, number, number]));
        entry.obj.scale.setScalar(a.scale / s);
        entry.obj.name = `accessory:${a.id}`;
        bone.add(entry.obj);
      } catch {
        this.accessories.delete(a.id);
      }
    }
  }

  dispose() {
    // Give the body its triangles back (a new wardrobe may cover it differently).
    for (const b of this.body) {
      (b.mesh.geometry.index!.array as Uint32Array | Uint16Array).set(b.original);
      b.mesh.geometry.index!.needsUpdate = true;
    }
    this.mask = 0;
    for (const e of this.accessories.values()) {
      e.obj.removeFromParent();
      disposeTree(e.obj);
    }
    this.accessories.clear();
  }
}

const keyOf = (a: AvatarAccessory) => JSON.stringify([a.model, a.bone, a.position, a.rotation, a.scale]);

function nearest(model: LoadedModel, b: HumanBone): THREE.Object3D | undefined {
  for (let p: HumanBone | null = b; p; p = HUMAN_PARENT[p]) if (model.bones[p]) return model.bones[p];
  return undefined;
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
  });
}

/** Dresses an avatar for the current story state (creates its wardrobe the first time). */
export function dress(avatar: Avatar, cfg: AvatarConfig, renderer: THREE.WebGLRenderer | null, state: WardrobeState, opts: { low?: boolean } = {}) {
  avatar.wardrobe ??= new Wardrobe(avatar.model, cfg.body, renderer);
  avatar.wardrobe.apply(cfg, state, regionMask(state.hidden));
  if (state.garments.length || avatar.garments) {
    avatar.garments ??= new Garments(avatar, renderer);
    void avatar.garments.set(state.garments, avatar.options.look, avatar.options.outlines, !!opts.low).catch(() => undefined);
  }
}
