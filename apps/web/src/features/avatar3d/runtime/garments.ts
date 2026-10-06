/**
 * Garments (wardrobe level 3): separate model files rigged to the same body family. When worn, each
 * skinned mesh is bound to the avatar's own bones by name, so it follows every pose and emote. Bones
 * only the garment has (a skirt's chain) hang from the matching avatar bone and swing with physics.
 * Layers stack without flicker (outer layers draw slightly in front); variants recolour or retexture.
 */
import * as THREE from 'three';
import { modelUrl, type Garment } from '@everloom/engine';
import type { VRMSpringBoneJoint } from '@pixiv/three-vrm';
import type { Avatar } from './avatar';
import { loaderFor, nodeIndex } from './loader';
import { applyLook, type Look } from './materials';

interface Worn {
  key: string;
  root: THREE.Object3D;
  joints: VRMSpringBoneJoint[];
}

export class Garments {
  private worn = new Map<string, Worn>();
  private pending = new Map<string, Promise<void>>();

  constructor(
    private avatar: Avatar,
    private renderer: THREE.WebGLRenderer | null,
  ) {}

  /** Wears exactly these garments (loading new ones, taking off the rest). */
  async set(list: Array<{ garment: Garment; variant: string | null }>, look: Look, outlines: boolean, low: boolean) {
    const want = new Map(list.map((x) => [x.garment.id, x]));
    for (const [id, w] of this.worn) {
      const x = want.get(id);
      if (!x || w.key !== keyOf(x.garment, low)) this.remove(id);
      else this.recolour(w.root, x.garment, x.variant);
    }
    await Promise.all(
      list.map(async ({ garment, variant }) => {
        if (this.worn.has(garment.id)) return;
        const key = keyOf(garment, low);
        const already = this.pending.get(key);
        if (already) return already;
        const p = this.load(garment, variant, key, look, outlines, low).finally(() => this.pending.delete(key));
        this.pending.set(key, p);
        return p;
      }),
    );
  }

  private async load(g: Garment, variant: string | null, key: string, look: Look, outlines: boolean, low: boolean) {
    const gltf = await loaderFor(this.renderer).loadAsync(modelUrl((low && g.modelLow) || g.model));
    // Taken off (or changed) while loading.
    if (this.worn.has(g.id)) return;
    const { root, adopted } = bindGarment(gltf.scene, this.avatar.model.scene, g.layer);
    root.name = `garment:${g.id}`;
    const chains: THREE.Object3D[][] = [];
    // Chains that start at an adopted bone (skirt, cape) swing.
    if (g.springs) {
      for (const b of adopted.keys()) {
        if (b.parent && adopted.has(b.parent)) continue;
        const chain = [b];
        let cur = b;
        while (cur.children.length && chain.length < 12) {
          const next = cur.children.find((c) => (c as THREE.Bone).isBone);
          if (!next) break;
          chain.push(next);
          cur = next;
        }
        chains.push(chain);
      }
    }
    applyLook(root, look, { outlines });
    this.recolour(root, g, variant);
    this.avatar.model.scene.add(root);
    const joints = chains.length && this.avatar.options.physics ? this.avatar.addSpringChains(chains) : [];
    this.worn.set(g.id, { key, root, joints });
    (root.userData as { adopted?: THREE.Object3D[] }).adopted = [...adopted.keys()];
  }

  private recolour(root: THREE.Object3D, g: Garment, variant: string | null) {
    const v = g.variants.find((x) => x.id === variant) ?? null;
    // A colour variant replaces the garment's base colour (its texture still shows through).
    const tint = v?.tint ? new THREE.Color(v.tint) : null;
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        const c = (mat as THREE.MeshStandardMaterial).color;
        if (!c) continue;
        const ud = mat.userData as { baseColor?: THREE.Color; baseShade?: THREE.Color };
        const base = (ud.baseColor ??= c.clone());
        c.copy(tint ?? base);
        // Toon shading keeps its own shadow colour: keep it in proportion.
        const shade = (mat as unknown as { shadeColorFactor?: THREE.Color }).shadeColorFactor;
        if (shade) {
          const baseShade = (ud.baseShade ??= shade.clone());
          if (!tint) shade.copy(baseShade);
          else shade.setRGB(tint.r * (baseShade.r / Math.max(0.01, base.r)), tint.g * (baseShade.g / Math.max(0.01, base.g)), tint.b * (baseShade.b / Math.max(0.01, base.b)));
        }
      }
    });
    if (v?.texture) {
      void new THREE.TextureLoader().loadAsync(`/media/${v.texture}`).then((tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;
        if (v.repeat && v.repeat !== 1) {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.repeat.set(v.repeat, v.repeat);
        }
        root.traverse((o) => {
          const m = (o as THREE.Mesh).material;
          if (!m) return;
          for (const mat of Array.isArray(m) ? m : [m]) if ('map' in mat) ((mat as THREE.MeshStandardMaterial).map = tex), (mat.needsUpdate = true);
        });
      });
    }
  }

  private remove(id: string) {
    const w = this.worn.get(id);
    if (!w) return;
    this.avatar.removeSpringJoints(w.joints);
    for (const b of (w.root.userData as { adopted?: THREE.Object3D[] }).adopted ?? []) b.removeFromParent();
    w.root.removeFromParent();
    w.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
    });
    this.worn.delete(id);
  }

  /** Re-apply the look (toon or PBR) after it changes. */
  relook(look: Look, outlines: boolean) {
    for (const w of this.worn.values()) applyLook(w.root, look, { outlines });
  }

  dispose() {
    for (const id of [...this.worn.keys()]) this.remove(id);
  }
}

/**
 * Binds a garment file's skinned meshes to an avatar's bones (matched by name). Bones the avatar
 * doesn't have are moved under the avatar bone matching their nearest ancestor. Returns the meshes
 * (in a group) and those adopted bones.
 */
export function bindGarment(garment: THREE.Object3D, avatarRoot: THREE.Object3D, layer = 1): { root: THREE.Group; adopted: Map<THREE.Object3D, THREE.Object3D> } {
  const root = new THREE.Group();
  const avatarNodes: THREE.Object3D[] = [];
  avatarRoot.traverse((o) => avatarNodes.push(o));
  const find = nodeIndex(avatarNodes);
  garment.updateMatrixWorld(true);
  const meshes: THREE.SkinnedMesh[] = [];
  garment.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && meshes.push(o as THREE.SkinnedMesh));
  if (!meshes.length) throw new Error('The garment has no rigged mesh');
  const adopted = new Map<THREE.Object3D, THREE.Object3D>();
  for (const mesh of meshes) {
    const bones = mesh.skeleton.bones.map((b) => {
      const mine = find(b.name);
      if (mine) return mine;
      // A bone only the garment has: hang it from the avatar's matching ancestor, same local offset.
      // Bones under another garment-only bone come along with it (a skirt chain stays a chain).
      const parentIsGarmentBone = !!b.parent && (b.parent as THREE.Bone).isBone && !find(b.parent.name);
      if (!adopted.has(b) && !parentIsGarmentBone) {
        let parent: THREE.Object3D | null = b.parent;
        let target: THREE.Object3D | undefined;
        while (parent && !(target = find(parent.name))) parent = parent.parent;
        if (target) {
          const local = b.matrix.clone();
          target.add(b);
          b.matrix.copy(local);
          b.matrix.decompose(b.position, b.quaternion, b.scale);
          adopted.set(b, target);
        }
      }
      return b;
    });
    const skel = new THREE.Skeleton(bones as THREE.Bone[], mesh.skeleton.boneInverses);
    mesh.bind(skel, mesh.bindMatrix);
    // Bound to moving bones: the garment's own box doesn't follow, so never cull it.
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      // Outer layers win where they meet the layers under them.
      m.polygonOffset = true;
      m.polygonOffsetFactor = -layer;
      m.polygonOffsetUnits = -layer;
    }
    root.add(mesh);
  }
  return { root, adopted };
}

const keyOf = (g: Garment, low: boolean) => `${g.model}:${low ? g.modelLow ?? '' : ''}`;
