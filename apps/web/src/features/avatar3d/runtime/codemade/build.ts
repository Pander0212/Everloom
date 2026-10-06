/**
 * Turns a code-made character's geometry into a model the runtime can use like a loaded file:
 * a skeleton with canonical bone names, skinned meshes with plain colours, and a face with morph
 * targets and its own expression map.
 */
import * as THREE from 'three';
import type { AvatarRecipe, HumanBone } from '@everloom/engine';
import type { LoadedModel } from '../loader';
import { FACE_EXPRESSIONS, FACE_MORPHS } from './face';
import { codeGeometry, type BuildOptions, type CodeGeometry, type SkinnedMesh } from './geometry';

export type { BuildOptions } from './geometry';

function geometry(m: SkinnedMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(m.skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(m.skinWeight, 4));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** A small repeating pattern: white with darker marks, multiplied by the garment's colour. */
const patterns = new Map<string, THREE.DataTexture>();
function patternTexture(kind: 'stripes' | 'checks' | 'dots'): THREE.DataTexture {
  let t = patterns.get(kind);
  if (t) return t;
  const N = 32;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dark = kind === 'stripes' ? y < N / 3 : kind === 'checks' ? (x < N / 2) !== (y < N / 2) : Math.hypot(x - N / 2 + 0.5, y - N / 2 + 0.5) < N / 5;
      const i = (y * N + x) * 4;
      const v = dark ? 150 : 255;
      data.set([v, v, v, 255], i);
    }
  t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  patterns.set(kind, t);
  return t;
}

export function assembleCodeModel(g: CodeGeometry): LoadedModel {
  const scene = new THREE.Group();
  scene.name = 'CodeMade';
  const byName = new Map<string, THREE.Bone>();
  const at = new Map<string, THREE.Vector3>();
  for (const b of g.bones) {
    const bone = new THREE.Bone();
    bone.name = b.name;
    const w = new THREE.Vector3(...b.at);
    at.set(b.name, w);
    bone.position.copy(w).sub(b.parent ? at.get(b.parent)! : new THREE.Vector3());
    (b.parent ? byName.get(b.parent)! : scene).add(bone);
    byName.set(b.name, bone);
  }
  scene.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(g.bones.map((b) => byName.get(b.name)!));
  const meshes: THREE.Mesh[] = [];
  const attach = (name: string, m: SkinnedMesh, mat: THREE.Material) => {
    const sm = new THREE.SkinnedMesh(geometry(m), mat);
    sm.name = name;
    sm.frustumCulled = false;
    scene.add(sm);
    sm.bind(skeleton, new THREE.Matrix4());
    meshes.push(sm);
    return sm;
  };
  for (const p of g.parts) {
    const map = p.pattern !== 'plain' && p.uvs ? patternTexture(p.pattern) : null;
    const m = attach(p.name, p, new THREE.MeshStandardMaterial({ name: p.name, color: new THREE.Color(p.color), roughness: p.roughness, metalness: p.metalness, map }));
    if (map) m.geometry.setAttribute('uv', new THREE.BufferAttribute(p.uvs!, 2));
  }

  // The face: features are drawn from a strip of colours (one pair per feature).
  const f = g.face;
  const palette = new THREE.DataTexture(f.palette, f.paletteWidth, 1, THREE.RGBAFormat);
  palette.colorSpace = THREE.SRGBColorSpace;
  palette.magFilter = THREE.LinearFilter;
  palette.minFilter = THREE.LinearFilter;
  palette.needsUpdate = true;
  // Freed with the character (pattern textures are shared and stay).
  scene.userData.disposables = [palette];
  const faceMat = new THREE.MeshStandardMaterial({ name: 'face_overlay', map: palette, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const face = attach('face_overlay', f, faceMat);
  face.geometry.setAttribute('uv', new THREE.BufferAttribute(f.uvs, 2));
  face.geometry.morphAttributes.position = FACE_MORPHS.map((k) => new THREE.BufferAttribute(f.morphs[k]!, 3));
  face.geometry.morphTargetsRelative = true;
  face.updateMorphTargets();
  face.renderOrder = 1;

  const bones: Partial<Record<HumanBone, THREE.Object3D>> = {};
  for (const b of g.bones) if (!b.name.includes('_')) bones[b.name as HumanBone] = byName.get(b.name)!;
  return {
    gltf: null,
    scene,
    vrm: null,
    bones,
    missing: [],
    morphMeshes: [face],
    morphNames: [...FACE_MORPHS],
    expressions: FACE_EXPRESSIONS,
    faceRig: 'named',
    secondaryChains: g.chains.map((c) => c.map((n) => byName.get(n)!)),
    meshes,
    height: g.height,
    rawHeight: g.height,
    scale: 1,
    autoFit: false,
    floor: 0,
  };
}

/** Builds on this thread (tests, the lab). */
export function buildCodeModel(recipe: AvatarRecipe | unknown, opts: BuildOptions = {}): LoadedModel {
  return assembleCodeModel(codeGeometry(recipe, opts));
}

// Geometry is cached by recipe (the same NPC on several stages is built once).
const cache = new Map<string, Promise<CodeGeometry>>();
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (g: CodeGeometry) => void; reject: (e: Error) => void }>();

function inWorker(recipe: unknown, opts: BuildOptions): Promise<CodeGeometry> {
  if (typeof Worker === 'undefined') return Promise.resolve(codeGeometry(recipe, opts));
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'codemade' });
    worker.onmessage = (e: MessageEvent<{ id: number; g?: CodeGeometry; error?: string }>) => {
      const p = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (e.data.g) p?.resolve(e.data.g);
      else p?.reject(new Error(e.data.error ?? 'Could not build the character'));
    };
    worker.onerror = () => {
      // A worker that can't start (old browser, blocked): build here instead.
      for (const [, p] of pending) p.reject(new Error('worker'));
      pending.clear();
      worker = null;
    };
  }
  const id = ++seq;
  return new Promise<CodeGeometry>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, recipe, opts });
  }).catch(() => codeGeometry(recipe, opts));
}

/**
 * Builds a code-made character without blocking the page. Geometry arrays are shared by every copy
 * made from the cache, so each copy gets its own skeleton and materials but not its own buffers.
 */
export async function loadCodeModel(recipe: AvatarRecipe | unknown, opts: BuildOptions = {}): Promise<LoadedModel> {
  const key = JSON.stringify([recipe, !!opts.low]);
  let g = cache.get(key);
  if (!g) {
    g = inWorker(recipe, opts);
    cache.set(key, g);
    g.catch(() => cache.delete(key));
    while (cache.size > 12) cache.delete(cache.keys().next().value!);
  }
  return assembleCodeModel(await g);
}
