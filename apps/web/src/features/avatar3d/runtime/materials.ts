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
  return m;
}

function pbrFrom(src: THREE.Material): THREE.Material {
  if (!isMToon(src)) return src;
  const m = new THREE.MeshStandardMaterial({ color: src.color, map: src.map ?? null, normalMap: src.normalMap ?? null, emissive: src.emissive, emissiveMap: src.emissiveMap ?? null, roughness: 0.75, metalness: 0, transparent: src.transparent, alphaTest: src.alphaTest, side: src.side });
  m.name = `${src.name} (pbr)`;
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
