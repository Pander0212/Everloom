/**
 * Builds a character from its recipe on one of Everloom's own bases, and keeps it live while the
 * owner edits: slider changes only move shape keys and bones; hair, clothes and textures are
 * rebuilt only when their part of the recipe changes. `exportGlb` writes the finished model (with
 * the recipe inside, so the server stores it with the avatar and it can be edited again).
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { CHARACTER_BASES, sliderWeights, type AvatarConfig, type CharacterSpec } from '@everloom/engine';
import { buildClothes } from './clothes';
import { buildHair, fitHead, type HeadShape } from './hair';
import { canvasTexture, eyeUVs, measure, paintEye, paintSkin, type Landmarks } from './paint';

const baseBytes = new Map<string, Promise<ArrayBuffer>>();
function fetchBase(id: CharacterSpec['base']): Promise<ArrayBuffer> {
  const file = CHARACTER_BASES.find((b) => b.id === id)!.file;
  let p = baseBytes.get(file);
  if (!p) {
    p = fetch(file).then((r) => { if (!r.ok) throw new Error(`The ${id} base could not be loaded (HTTP ${r.status}).`); return r.arrayBuffer(); });
    p.catch(() => baseBytes.delete(file));
    baseBytes.set(file, p);
  }
  return p;
}

export interface CharacterModel {
  root: THREE.Group;
  body: THREE.SkinnedMesh;
  /** Applies a recipe: only what changed since the last call is rebuilt. */
  apply(spec: CharacterSpec): void;
  /** The materials as built (the viewer swaps them for its look; export uses these). */
  sourceMaterials: Map<THREE.Mesh, THREE.Material>;
  exportGlb(config: Partial<AvatarConfig>): Promise<ArrayBuffer>;
  dispose(): void;
}

const key = (x: unknown) => JSON.stringify(x);

export async function createCharacter(first: CharacterSpec, textures: Map<string, THREE.Texture> = new Map()): Promise<CharacterModel> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(await fetchBase(first.base), '');
  const root = new THREE.Group();
  root.name = 'Character';
  const model = gltf.scene;
  root.add(model);
  let body: THREE.SkinnedMesh | null = null, eyes: THREE.Mesh | null = null;
  model.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && o.name === 'Body') body = o as THREE.SkinnedMesh;
    else if ((o as THREE.Mesh).isMesh && o.name === 'Eyes') eyes = o as THREE.Mesh;
  });
  const iris = model.getObjectByName('Iris');
  iris?.removeFromParent();
  if (!body || !eyes) throw new Error('The base is missing its body or eyes.');
  const B = body as THREE.SkinnedMesh, E = eyes as THREE.Mesh;
  B.frustumCulled = E.frustumCulled = false;
  const lm: Landmarks = measure(B, E);
  eyeUVs(E, lm);
  const head: HeadShape = fitHead(B, (lm.eyes.l.y + lm.eyes.r.y) / 2);
  const headBone = B.skeleton.bones.find((b) => b.name === 'head')!;
  const baseHeight = CHARACTER_BASES.find((b) => b.id === first.base)!.height;
  const sourceMaterials = new Map<THREE.Mesh, THREE.Material>();
  const setMaterial = (mesh: THREE.Mesh, m: THREE.Material) => { const old = sourceMaterials.get(mesh); if (old && old !== m) { (old as THREE.MeshStandardMaterial).map?.dispose(); old.dispose(); } mesh.material = m; sourceMaterials.set(mesh, m); };
  setMaterial(B, new THREE.MeshStandardMaterial({ name: 'Skin', roughness: 0.62 }));
  setMaterial(E, new THREE.MeshStandardMaterial({ name: 'Eyes', roughness: 0.1 }));
  let hair: THREE.Object3D[] = [], hairBones: THREE.Bone[] = [], clothes: THREE.SkinnedMesh[] = [];
  const last: Record<string, string> = {};

  /** Hair and clothes are built on the rest shape: no head or height scaling while they are made. */
  const atRest = <T>(fn: () => T): T => {
    const s = root.scale.clone(), h = headBone.scale.clone();
    root.scale.set(1, 1, 1); headBone.scale.set(1, 1, 1);
    root.updateMatrixWorld(true);
    try { return fn(); } finally { root.scale.copy(s); headBone.scale.copy(h); root.updateMatrixWorld(true); }
  };

  const apply = (spec: CharacterSpec) => {
    if (spec.base !== first.base) throw new Error('A different base needs a new character.');
    // Shape keys (body, face) and the clothes that carry them.
    const k = key([spec.body.sliders, spec.face.sliders]);
    if (k !== last.shape) {
      last.shape = k;
      const w = sliderWeights({ ...spec.body.sliders, ...spec.face.sliders }, spec.base);
      const dict = B.morphTargetDictionary ?? {};
      const inf = B.morphTargetInfluences!;
      for (const name of Object.keys(dict)) if (!/^(eye|jaw|mouth|brow)[A-Z]/.test(name)) inf[dict[name]!] = w[name] ?? 0;
      for (const c of clothes) if (c.morphTargetInfluences) c.morphTargetInfluences.splice(0, inf.length, ...inf);
    }
    root.scale.setScalar(spec.body.height / baseHeight);
    headBone.scale.setScalar(spec.body.head);
    // Skin and makeup, and the eyes.
    const sk = key([spec.skin, spec.eyes.lashes, spec.eyes.style, spec.hair.color]);
    if (sk !== last.skin) {
      last.skin = sk;
      setMaterial(B, new THREE.MeshStandardMaterial({ name: 'Skin', map: canvasTexture(paintSkin(B, lm, spec, spec.hair.color)), roughness: 0.62 }));
    }
    const ek = key(spec.eyes);
    if (ek !== last.eyes) {
      last.eyes = ek;
      setMaterial(E, new THREE.MeshStandardMaterial({ name: 'Eyes', map: canvasTexture(paintEye(spec.eyes)), roughness: 0.08 }));
    }
    // Hair.
    const hk = key(spec.hair);
    if (hk !== last.hair) {
      last.hair = hk;
      for (const h of hair) { h.removeFromParent(); const m = h as THREE.Mesh; if (m.geometry !== B.geometry) m.geometry?.dispose(); sourceMaterials.delete(m); }
      for (const b of hairBones) b.removeFromParent();
      const built = atRest(() => buildHair(B, head, spec.hair));
      hair = built.meshes; hairBones = built.bones;
      for (const h of hair) { model.add(h); sourceMaterials.set(h as THREE.Mesh, (h as THREE.Mesh).material as THREE.Material); }
    }
    // Clothes.
    const ck = key(spec.clothes);
    if (ck !== last.clothes) {
      last.clothes = ck;
      for (const c of clothes) { c.removeFromParent(); c.geometry.dispose(); sourceMaterials.delete(c); }
      clothes = atRest(() => buildClothes(B, spec.clothes, textures));
      for (const c of clothes) { model.add(c); sourceMaterials.set(c, c.material as THREE.Material); }
    }
    root.updateMatrixWorld(true);
  };
  apply(first);

  return {
    root,
    body: B,
    apply,
    sourceMaterials,
    async exportGlb(config) {
      // Export the built materials (not the viewer's look), with the recipe in the scene's extras.
      const shown = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
      for (const [mesh, m] of sourceMaterials) { shown.set(mesh, mesh.material); mesh.material = m; }
      model.userData = { everloom: { config } };
      try {
        return (await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true })) as ArrayBuffer;
      } finally {
        for (const [mesh, m] of shown) mesh.material = m;
        model.userData = {};
      }
    },
    dispose() {
      root.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; m.geometry.dispose(); for (const mat of [m.material].flat()) { (mat as THREE.MeshStandardMaterial).map?.dispose(); mat.dispose(); } });
    },
  };
}
