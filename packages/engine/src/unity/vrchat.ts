/**
 * VRChat, Dynamic Bone and Modular Avatar components, read from a resolved prefab.
 *
 * Components live in DLLs or scripts whose GUIDs differ between SDK and package versions, so each
 * one is recognised by the fields it serializes (a PhysBone always has `rootTransform`, `pull` and
 * `spring`; an avatar descriptor `VisemeBlendShapes` and `ViewPosition`; …), with a few known script
 * GUIDs as a shortcut. Field names follow what these components write into prefabs.
 */
import { asList, asMap, asNum, asRef, asStr, type UnityRef, type YamlMap, type YamlValue } from './yaml';
import type { ResolvedScene, SceneComp } from './scene';
import type { ChainKind, SpringSettings } from '../avatar/physics.js';

export type ComponentKind =
  | 'avatarDescriptor'
  | 'physBone'
  | 'physBoneCollider'
  | 'contact'
  | 'dynamicBone'
  | 'dynamicBoneCollider'
  | 'maMergeArmature'
  | 'maObjectToggle'
  | 'maMenuItem'
  | 'maBlendshapeSync'
  | 'maBoneProxy'
  | 'maOther'
  | 'pipeline'
  | 'unknown';

type MB = Extract<SceneComp, { type: 'MonoBehaviour' }>;

const has = (f: YamlMap, ...keys: string[]) => keys.every((k) => k in f);

/**
 * Known script identities, "guid:fileID" (DLL types share their assembly's GUID; loose scripts use
 * fileID 11500000). From watari-basis' KnownScriptIdentities (MIT, see CREDITS.md).
 */
const KNOWN: Record<string, ComponentKind> = {
  '2a2c05204084d904aa4945ccff20d8e5:1661641543': 'physBone',
  '2a2c05204084d904aa4945ccff20d8e5:-1631200402': 'physBoneCollider',
  '67cc4cb7839cd3741b63733d5adf0442:542108242': 'avatarDescriptor',
  '80f1b8067b0760e4bb45023bc2e9de66:-1450912254': 'contact',
  '80f1b8067b0760e4bb45023bc2e9de66:-802764141': 'contact',
  '4ecd63eff847044b68db9453ce219299:-1427037861': 'pipeline',
  'f9ac8d30c6a0d9642a11e5be4c440740:11500000': 'dynamicBone',
  'baedd976e12657241bf7ff2d1c685342:11500000': 'dynamicBoneCollider',
  '4e535bdf3689369408cc4d078260ef6a:11500000': 'dynamicBoneCollider',
  '2df373bf91cf30b4bbd495e11cb1a2ec:11500000': 'maMergeArmature',
  '42581d8044b64899834d3d515ab3a144:11500000': 'maBoneProxy',
  '6fd7cab7d93b403280f2f9da978d8a4f:11500000': 'maBlendshapeSync',
  'a162bb8ec7e24a5abcf457887f1df3fa:11500000': 'maObjectToggle',
  '3b29d45007c5493d926d2cd45a489529:11500000': 'maMenuItem',
};

/** What a MonoBehaviour is: by its script's identity, else by the fields it serializes. */
export function identify(c: MB): ComponentKind {
  const known = c.script?.guid ? KNOWN[`${c.script.guid}:${c.script.fileID}`] : undefined;
  if (known) return known;
  const f = c.fields;
  if (has(f, 'VisemeBlendShapes') || has(f, 'ViewPosition', 'lipSync')) return 'avatarDescriptor';
  if (has(f, 'rootTransform', 'pull', 'spring') || has(f, 'rootTransform', 'integrationType')) return 'physBone';
  if (has(f, 'shapeType', 'radius', 'height') && ('rootTransform' in f || 'insideBounds' in f)) return 'physBoneCollider';
  if (has(f, 'collisionTags') || has(f, 'allowSelf', 'allowOthers')) return 'contact';
  if (has(f, 'm_Root', 'm_Damping', 'm_Elasticity')) return 'dynamicBone';
  if (has(f, 'm_Bound', 'm_Radius') && ('m_Direction' in f || 'm_Height' in f)) return 'dynamicBoneCollider';
  if (has(f, 'mergeTarget') || has(f, 'mergeTargetObject')) return 'maMergeArmature';
  if (has(f, 'm_objects') || has(f, 'Objects', 'Inverted')) return 'maObjectToggle';
  if (has(f, 'Control') && ('MenuSource' in f || 'label' in f || 'isSynced' in f)) return 'maMenuItem';
  if (has(f, 'Bindings') && JSON.stringify(f.Bindings ?? '').includes('Blendshape')) return 'maBlendshapeSync';
  if (has(f, 'target', 'attachmentMode') || has(f, 'boneReference', 'subPath')) return 'maBoneProxy';
  if (has(f, 'launchedFromSDKPipeline') || has(f, 'blueprintId')) return 'pipeline';
  if (Object.keys(f).some((k) => /^(menuToAppend|installTarget|parameters|mergeAnimator|layerType|pathMode)$/.test(k))) return 'maOther';
  return 'unknown';
}

export function behaviours(scene: ResolvedScene): (MB & { kind: ComponentKind })[] {
  const out: (MB & { kind: ComponentKind })[] = [];
  for (const c of scene.comps.values()) if (c.type === 'MonoBehaviour') out.push({ ...c, kind: identify(c) });
  return out;
}

/** The node a field's reference points at (a Transform or GameObject), or null. */
export function refNode(scene: ResolvedScene, v: YamlValue | undefined): string | null {
  const r = asRef(v);
  if (!r) return null;
  const k = scene.keyOf(r.fileID);
  if (!k) return null;
  if (scene.nodes.has(k)) return k;
  return scene.comps.get(k)?.node ?? null;
}

// ------------------------------------------------------------------ the avatar descriptor

export const VRC_VISEMES = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'ih', 'oh', 'ou'] as const;

export interface AvatarDescriptor {
  node: string;
  /** Eye height, in the avatar's units. */
  viewPosition: { x: number; y: number; z: number };
  /** The face mesh's node, and blendshape names per VRChat viseme. */
  visemeMesh: string | null;
  visemes: Partial<Record<(typeof VRC_VISEMES)[number], string>>;
  eyes: { left: string | null; right: string | null };
  /** The eyelid mesh and the blendshape indices for blink, looking up and down. */
  eyelids: { mesh: string | null; blink: number | null; up: number | null; down: number | null };
  /** Animator controllers by layer (Base, Additive, Gesture, Action, FX…). */
  layers: { type: number; controller: UnityRef | null }[];
  menu: UnityRef | null;
  parameters: UnityRef | null;
}

export function readDescriptor(scene: ResolvedScene, c: MB): AvatarDescriptor {
  const f = c.fields;
  const names = asList(f.VisemeBlendShapes).map((v) => asStr(v));
  const visemes: AvatarDescriptor['visemes'] = {};
  VRC_VISEMES.forEach((v, i) => {
    if (names[i]) visemes[v] = names[i];
  });
  const eye = asMap(f.customEyeLookSettings);
  const lids = intList(eye.eyelidsBlendshapes);
  const vp = asMap(f.ViewPosition);
  return {
    node: c.node,
    viewPosition: { x: asNum(vp.x), y: asNum(vp.y), z: asNum(vp.z) },
    visemeMesh: refNode(scene, f.VisemeSkinnedMesh),
    visemes,
    eyes: { left: refNode(scene, eye.leftEye), right: refNode(scene, eye.rightEye) },
    eyelids: {
      mesh: refNode(scene, eye.eyelidsSkinnedMesh),
      blink: lids[0] !== undefined && lids[0] >= 0 ? lids[0] : null,
      up: lids[1] !== undefined && lids[1] >= 0 ? lids[1] : null,
      down: lids[2] !== undefined && lids[2] >= 0 ? lids[2] : null,
    },
    layers: [...asList(f.baseAnimationLayers), ...asList(f.specialAnimationLayers)].map(asMap).map((l) => ({ type: asNum(l.type), controller: asRef(l.animatorController) })),
    menu: asRef(f.expressionsMenu),
    parameters: asRef(f.expressionParameters),
  };
}

/** Unity writes int arrays as a list or as a hex blob of little-endian int32s ("0c0000000d000000"). */
export function intList(v: YamlValue | undefined): number[] {
  if (Array.isArray(v)) return v.map((x) => asNum(x, -1));
  const s = asStr(v);
  if (!/^([0-9a-f]{8})+$/i.test(s)) return [];
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 8) {
    const b = s.slice(i, i + 8).match(/../g)!.map((h) => parseInt(h, 16));
    out.push((b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >> 0);
  }
  return out;
}

/** VRChat viseme blendshapes onto Everloom's five mouth shapes. */
export function visemeExpressions(d: AvatarDescriptor): Partial<Record<'aa' | 'ih' | 'ou' | 'ee' | 'oh', string>> {
  const v = d.visemes;
  const out: Partial<Record<'aa' | 'ih' | 'ou' | 'ee' | 'oh', string>> = {};
  if (v.aa) out.aa = v.aa;
  if (v.ih) out.ih = v.ih;
  if (v.ou) out.ou = v.ou;
  if (v.E) out.ee = v.E;
  if (v.oh) out.oh = v.oh;
  return out;
}

// ------------------------------------------------------------------ physics

export interface ChainFromUnity {
  /** Node of the chain's root bone. */
  root: string;
  kind: ChainKind;
  settings: SpringSettings;
  /** Nodes that don't move with it. */
  ignore: string[];
  source: 'physBone' | 'dynamicBone';
  notes: string[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A chain's kind from its bone names (Part 4's roles refine this). */
export function chainKindFromName(name: string): ChainKind {
  const n = name.normalize('NFKC').toLowerCase();
  if (/breast|bust|boob|oppai|chest_?(l|r)|胸|乳|おっぱい|バスト/.test(n)) return 'chest';
  if (/tail|しっぽ|尻尾|尾/.test(n)) return 'tail';
  if (/butt|glute|oshiri|hip_?cheek|お尻|ケツ|尻/.test(n)) return 'butt';
  if (/hair|bang|ahoge|ponytail|twintail|髪|前髪|後髪|横髪|もみあげ|アホ毛/.test(n)) return 'hair';
  if (/skirt|dress|coat|cape|cloak|ribbon|sleeve|hood|frill|スカート|袖|リボン|マント|コート/.test(n)) return 'cloth';
  return 'accessory';
}

/**
 * PhysBone → spring chain. PhysBone's pull (back to rest) and stiffness become stiffness; its
 * spring (bounciness) becomes low damping; gravity 0–1 maps onto Everloom's 0–2.
 */
export function readPhysBone(scene: ResolvedScene, c: MB): ChainFromUnity | null {
  const f = c.fields;
  const root = refNode(scene, f.rootTransform) ?? c.node;
  if (!scene.nodes.has(root)) return null;
  const pull = asNum(f.pull, 0.2);
  const spring = asNum(f.spring, asNum(f.momentum, 0.2));
  const stiff = asNum(f.stiffness, 0.2);
  const notes: string[] = [];
  if (asList(f.colliders).length) notes.push('Its colliders were replaced by colliders made from the body.');
  if (asNum(f.limitType) !== 0) notes.push('Its angle limits are approximated by stiffness.');
  if (asList(f.pullCurve ? asMap(f.pullCurve).m_Curve : undefined).length > 1) notes.push('Curves along the chain use their average.');
  const name = scene.nodes.get(root)!.name;
  return {
    root,
    kind: chainKindFromName(name),
    settings: {
      stiffness: clamp(pull * 4 + stiff * 2, 0, 8),
      damping: clamp(1 - spring * 0.8, 0.05, 1),
      gravity: clamp(asNum(f.gravity, 0) * 2, 0, 4),
      wind: 0.5,
      radius: clamp(asNum(f.radius, 0), 0, 0.2),
    },
    ignore: asList(f.ignoreTransforms).map((v) => refNode(scene, v)).filter((x): x is string => !!x),
    source: 'physBone',
    notes,
  };
}

/** Dynamic Bone → spring chain. */
export function readDynamicBone(scene: ResolvedScene, c: MB): ChainFromUnity | null {
  const f = c.fields;
  const root = refNode(scene, f.m_Root) ?? c.node;
  if (!scene.nodes.has(root)) return null;
  const g = asMap(f.m_Gravity);
  const notes: string[] = [];
  if (asList(f.m_Colliders).length) notes.push('Its colliders were replaced by colliders made from the body.');
  return {
    root,
    kind: chainKindFromName(scene.nodes.get(root)!.name),
    settings: {
      stiffness: clamp(asNum(f.m_Elasticity, 0.1) * 4 + asNum(f.m_Stiffness, 0.1) * 2, 0, 8),
      damping: clamp(asNum(f.m_Damping, 0.1), 0.05, 1),
      gravity: clamp(-asNum(g.y) * 4, 0, 4),
      wind: 0.5,
      radius: clamp(asNum(f.m_Radius, 0), 0, 0.2),
    },
    ignore: asList(f.m_Exclusions).map((v) => refNode(scene, v)).filter((x): x is string => !!x),
    source: 'dynamicBone',
    notes,
  };
}

// ------------------------------------------------------------------ Modular Avatar

export interface MergeArmature {
  /** The outfit's armature root (the component's node). */
  node: string;
  /** Path of the avatar's armature it merges into ("Armature"), when given by path. */
  targetPath: string | null;
  targetNode: string | null;
  prefix: string;
  suffix: string;
}

export function readMergeArmature(scene: ResolvedScene, c: MB): MergeArmature {
  const f = c.fields;
  const t = asMap(f.mergeTarget);
  return {
    node: c.node,
    targetPath: asStr(t.referencePath) || null,
    targetNode: refNode(scene, t.targetObject) ?? refNode(scene, f.mergeTargetObject),
    prefix: asStr(f.prefix),
    suffix: asStr(f.suffix),
  };
}

export interface ObjectToggle {
  node: string;
  label: string;
  objects: { path: string | null; node: string | null; active: boolean }[];
}

export function readObjectToggle(scene: ResolvedScene, c: MB, menu?: MB): ObjectToggle {
  const f = c.fields;
  const objs = asList(f.m_objects ?? f.Objects).map(asMap);
  const label = menu ? asStr(asMap(menu.fields.Control).name) || asStr(menu.fields.label) : '';
  return {
    node: c.node,
    label: label || scene.nodes.get(c.node)?.name || 'Toggle',
    objects: objs.map((o) => {
      const ref = asMap(o.Object);
      return { path: asStr(ref.referencePath) || null, node: refNode(scene, ref.targetObject), active: asNum(o.Active, 1) !== 0 };
    }),
  };
}

export interface BlendshapeSync {
  node: string;
  bindings: { meshPath: string | null; blendshape: string; local: string }[];
}

export function readBlendshapeSync(c: MB): BlendshapeSync {
  return {
    node: c.node,
    bindings: asList(c.fields.Bindings).map(asMap).map((b) => ({ meshPath: asStr(asMap(b.ReferenceMesh).referencePath) || null, blendshape: asStr(b.Blendshape), local: asStr(b.LocalBlendshape) || asStr(b.Blendshape) })),
  };
}

/**
 * Bone names of an outfit's armature onto the avatar's: Merge Armature's prefix and suffix are
 * removed, then names are compared loosely (case, separators, ".001"-style numbering).
 */
export function matchOutfitBone(outfitBone: string, avatarBones: Set<string>, prefix = '', suffix = ''): string | null {
  let n = outfitBone;
  if (prefix && n.startsWith(prefix)) n = n.slice(prefix.length);
  if (suffix && n.endsWith(suffix)) n = n.slice(0, -suffix.length);
  if (avatarBones.has(n)) return n;
  const loose = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\.\d{3}$/, '').replace(/[\s_.\-:|]+/g, '');
  const want = loose(n);
  for (const b of avatarBones) if (loose(b) === want) return b;
  return null;
}
