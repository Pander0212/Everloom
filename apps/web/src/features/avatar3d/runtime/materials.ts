/**
 * The two looks a model can have, switchable at any time:
 *
 * - Toon: MToon (the anime shader VRM uses): a shading ramp instead of soft PBR falloff, a tinted
 *   shadow colour taken from the base texture, a soft parametric rim light, and inverted-hull
 *   outlines whose width is set in screen space (so they stay crisp at any distance).
 * - PBR: physically based materials for realistic or stylized-realistic models.
 *
 * Models that already use MToon (most VRMs) keep the author's settings in toon mode.
 */
import * as THREE from 'three';
import { MToonMaterial, MToonMaterialOutlineWidthMode } from '@pixiv/three-vrm';
import type { AvatarConfig } from '@everloom/engine';

export type Look = 'toon' | 'pbr';
export interface LookOptions {
  outlines: boolean;
  /** Tint mixed into shadows (scene mood: warm tavern, cold night). */
  shadeTint?: THREE.Color;
  /** Outline width relative to the screen (0.003 is a good anime line). */
  outlineWidth?: number;
}

interface Originals {
  materials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  groups: Map<THREE.BufferGeometry, Array<{ start: number; count: number; materialIndex?: number }>>;
}
const ORIGINALS = new WeakMap<THREE.Object3D, Originals>();

function originalsOf(root: THREE.Object3D): Originals {
  let o = ORIGINALS.get(root);
  if (!o) {
    o = { materials: new Map(), groups: new Map() };
    root.traverse((x) => {
      const m = x as THREE.Mesh;
      if (!m.isMesh) return;
      o!.materials.set(m, m.material);
      o!.groups.set(m.geometry, m.geometry.groups.map((g) => ({ ...g })));
    });
    ORIGINALS.set(root, o);
  }
  return o;
}

/** How dark the shadow side is, before the scene's tint. */
const SHADE = 0.6;

const isMToon = (m: THREE.Material): m is MToonMaterial => (m as MToonMaterial).isMToonMaterial === true;

function toonFrom(src: THREE.Material, tint: THREE.Color): MToonMaterial {
  if (isMToon(src)) return src;
  const s = src as THREE.MeshStandardMaterial;
  const color = s.color ? s.color.clone() : new THREE.Color(1, 1, 1);
  const m = new MToonMaterial({
    color,
    map: s.map ?? undefined,
    normalMap: s.normalMap ?? undefined,
    emissive: s.emissive ? s.emissive.clone() : undefined,
    emissiveMap: s.emissiveMap ?? undefined,
    emissiveIntensity: s.emissiveIntensity ?? 1,
    // Shadows are the base texture times a tinted, darker version of the colour.
    shadeColorFactor: color.clone().multiply(tint).multiplyScalar(SHADE),
    shadeMultiplyTexture: s.map ?? undefined,
    shadingShiftFactor: 0.05,
    shadingToonyFactor: 0.88,
    giEqualizationFactor: 0.55,
    parametricRimColorFactor: new THREE.Color(0.3, 0.3, 0.34),
    parametricRimFresnelPowerFactor: 3.5,
    parametricRimLiftFactor: 0.08,
    rimLightingMixFactor: 1,
    transparent: s.transparent,
    alphaTest: s.alphaTest,
    side: s.side,
    depthWrite: s.depthWrite,
  });
  m.name = `${s.name || 'material'} (toon)`;
  if ((src as THREE.MeshStandardMaterial).vertexColors) m.vertexColors = true;
  keepOffset(src, m);
  return m;
}

/** Decals drawn on a surface (a code-made face) keep their depth offset in every look. */
function keepOffset(src: THREE.Material, m: THREE.Material) {
  m.polygonOffset = src.polygonOffset;
  m.polygonOffsetFactor = src.polygonOffsetFactor;
  m.polygonOffsetUnits = src.polygonOffsetUnits;
}

function pbrFrom(src: THREE.Material): THREE.Material {
  if (!isMToon(src)) return src;
  const m = new THREE.MeshStandardMaterial({ color: src.color, map: src.map ?? null, normalMap: src.normalMap ?? null, emissive: src.emissive, emissiveMap: src.emissiveMap ?? null, roughness: 0.75, metalness: 0, transparent: src.transparent, alphaTest: src.alphaTest, side: src.side });
  m.name = `${src.name} (pbr)`;
  m.vertexColors = src.vertexColors;
  keepOffset(src, m);
  return m;
}

function outlineFrom(surface: MToonMaterial, width: number): MToonMaterial {
  const o = surface.clone() as MToonMaterial;
  o.isOutline = true;
  o.outlineWidthMode = MToonMaterialOutlineWidthMode.ScreenCoordinates;
  o.outlineWidthFactor = width;
  // A line a little darker than the surface reads softer than pure black.
  o.outlineColorFactor = surface.color.clone().multiplyScalar(0.18);
  o.outlineLightingMixFactor = 0.6;
  o.side = THREE.BackSide;
  return o;
}

const cache = new WeakMap<THREE.Material, { toon?: MToonMaterial; pbr?: THREE.Material; outline?: MToonMaterial }>();
const cached = (m: THREE.Material) => {
  let c = cache.get(m);
  if (!c) cache.set(m, (c = {}));
  return c;
};

type Surface = THREE.MeshStandardMaterial & { shadeMultiplyTexture?: THREE.Texture | null; shadeColorFactor?: THREE.Color; isOutline?: boolean; outlineColorFactor?: THREE.Color };
const baselines = new WeakMap<THREE.Material, { color: THREE.Color; map: THREE.Texture | null; shadeMap: THREE.Texture | null; shade: THREE.Color | null; transparent: boolean; alphaTest: number; depthWrite: boolean }>();
const textureCaches = new WeakMap<THREE.Object3D, Map<string, Promise<THREE.Texture>>>();
const materialGeneration = new WeakMap<THREE.Object3D, number>();
const materialKeys = new WeakMap<THREE.Object3D, string>();
/** Texture changes follow the same resolved outfit as geometry, so story rollback remains shared. */
export async function configureMaterials(root: THREE.Object3D, overrides: AvatarConfig['materialOverrides']) {
  const key = JSON.stringify(overrides); if (materialKeys.get(root) === key) return;
  materialKeys.set(root, key);
  const generation = (materialGeneration.get(root) ?? 0) + 1; materialGeneration.set(root, generation);
  let textures = textureCaches.get(root); if (!textures) textureCaches.set(root, textures = new Map());
  const load = (id: string) => {
    if (!textures!.has(id)) textures!.set(id, new THREE.TextureLoader().loadAsync(`/media/${id}`).then(texture => {
      texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false;
      if (!root.userData.disposables) Object.defineProperty(root.userData, 'disposables', { value: [] as THREE.Texture[], writable: true, enumerable: false });
      const owned = root.userData.disposables as THREE.Texture[]; owned.push(texture);
      return texture;
    }).catch(e => { textures!.delete(id); throw e; }));
    return textures!.get(id)!;
  };
  const downloaded = new Map<string, THREE.Texture>();
  try { for (const value of Object.values(overrides)) for (const id of [value.texture, value.shadeTexture]) if (id && !downloaded.has(id)) downloaded.set(id, await load(id)); }
  catch (e) { if (materialKeys.get(root) === key) materialKeys.delete(root); throw e; }
  if (materialGeneration.get(root) !== generation) return;
  for (const original of originalsOf(root).materials.values()) for (const source of Array.isArray(original) ? original : [original]) {
    const src = source as Surface; if (!src.color) continue;
    let base = baselines.get(source);
    if (!base) baselines.set(source, base = { color: src.color.clone(), map: src.map, shadeMap: src.shadeMultiplyTexture ?? null, shade: src.shadeColorFactor?.clone() ?? null, transparent: src.transparent, alphaTest: src.alphaTest, depthWrite: src.depthWrite });
    const change = overrides[source.name] ?? {};
    const color = change.color ? new THREE.Color(change.color) : base.color;
    const map = change.texture ? downloaded.get(change.texture)! : base.map;
    const shadeMap = change.shadeTexture ? downloaded.get(change.shadeTexture)! : change.texture ? map : base.shadeMap;
    const derived = cached(source), toon = derived.toon;
    const targets = new Set<THREE.Material>([source, ...[derived.pbr, toon, derived.outline, toon && cached(toon).outline].filter((m): m is THREE.Material => !!m)]);
    for (const target of targets) {
      const material = target as Surface;
      material.color?.copy(color); material.map = map;
      if ('shadeMultiplyTexture' in material) material.shadeMultiplyTexture = shadeMap;
      if (material.shadeColorFactor && base.shade) material.shadeColorFactor.setRGB(base.shade.r * color.r / Math.max(0.01, base.color.r), base.shade.g * color.g / Math.max(0.01, base.color.g), base.shade.b * color.b / Math.max(0.01, base.color.b));
      if (material.isOutline) material.outlineColorFactor?.copy(color).multiplyScalar(0.18);
      material.transparent = change.alpha ? change.alpha === 'blend' : base.transparent;
      material.alphaTest = change.alpha ? change.alpha === 'mask' ? 0.5 : 0 : base.alphaTest;
      material.depthWrite = change.alpha ? change.alpha !== 'blend' : base.depthWrite;
      material.needsUpdate = true;
    }
  }
}

/** Applies a look to every mesh under `root`. Safe to call again to switch looks or outlines. */
export function applyLook(root: THREE.Object3D, look: Look, opts: LookOptions) {
  const orig = originalsOf(root);
  const tint = opts.shadeTint ?? new THREE.Color(0.86, 0.8, 0.92);
  const width = opts.outlineWidth ?? 0.0034;
  for (const [mesh, original] of orig.materials) {
    const list = Array.isArray(original) ? original : [original];
    const groups = orig.groups.get(mesh.geometry) ?? [];
    mesh.geometry.clearGroups();
    for (const g of groups) mesh.geometry.addGroup(g.start, g.count, g.materialIndex);
    if (look === 'pbr') {
      const mats = list.map((m) => (cached(m).pbr ??= pbrFrom(m)));
      mesh.material = Array.isArray(original) ? mats : mats[0]!;
      continue;
    }
    const surfaces = list.map((m) => {
      const c = cached(m);
      c.toon ??= toonFrom(m, tint);
      if (!isMToon(m)) c.toon.shadeColorFactor.copy((m as THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1)).multiply(tint).multiplyScalar(SHADE);
      return c.toon;
    });
    // Transparent and very thin things (eyes, lashes, hair cards with alpha) don't get outlines.
    const wantsOutline = (m: MToonMaterial) => opts.outlines && !m.transparent && m.alphaTest < 0.5 && !/eye|lash|brow|mouth|teeth|tongue|face_?overlay/i.test(`${m.name} ${mesh.name}`);
    if (!surfaces.some(wantsOutline)) {
      mesh.material = Array.isArray(original) ? surfaces : surfaces[0]!;
      continue;
    }
    // Outlines: the geometry is drawn a second time with each outline material (inverted hull).
    const outlines = surfaces.map((s) => {
      const c = cached(s);
      c.outline ??= outlineFrom(s, width);
      c.outline.outlineWidthFactor = width;
      return c.outline;
    });
    const base = groups.length ? groups : [{ start: 0, count: mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position!.count, materialIndex: 0 }];
    mesh.geometry.clearGroups();
    for (const g of base) mesh.geometry.addGroup(g.start, g.count, g.materialIndex ?? 0);
    for (const g of base) if (wantsOutline(surfaces[g.materialIndex ?? 0]!)) mesh.geometry.addGroup(g.start, g.count, surfaces.length + (g.materialIndex ?? 0));
    mesh.material = [...surfaces, ...outlines];
  }
}

/** Per-frame material work (MToon's UV animation clock). */
export function updateLook(root: THREE.Object3D, dt: number) {
  root.traverse((x) => {
    const m = (x as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) if (isMToon(mat)) mat.update(dt);
  });
}

/**
 * 'auto' look: VRM and other anime models (MToon, flat colours, few maps) get toon shading;
 * models with normal and roughness/metal maps were made for realistic light and get PBR.
 */
export function autoLook(root: THREE.Object3D, isVrm: boolean): Look {
  if (isVrm) return 'toon';
  let maps = 0;
  let mats = 0;
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) {
      if (isMToon(x)) return;
      const s = x as THREE.MeshStandardMaterial;
      mats++;
      if (s.normalMap || s.roughnessMap || s.metalnessMap) maps++;
    }
  });
  return mats && maps / mats >= 0.5 ? 'pbr' : 'toon';
}
