/**
 * What to do with a Unity package or folder: find the avatars and outfits in it, and for one of them
 * gather everything the browser needs to build the model (which model files, which nodes are on,
 * materials and textures, blendshape presets, the humanoid map, visemes, physics, toggles) plus a
 * report of what was imported, approximated and skipped.
 */
import { asMap, asStr, type UnityRef } from './yaml';
import { baseName, dirName, importer, stem, text, type UnityAsset, type UnityKind, type UnityProject } from './project';
import { activeInHierarchy, nodePath, resolvePrefab, type ResolvedScene } from './scene';
import { readMaterial, type MaterialSpec } from './material';
import { readHumanoid, type UnityHumanoid } from './humanoid';
import { behaviours, readBlendshapeSync, readDescriptor, readDynamicBone, readMergeArmature, readObjectToggle, readPhysBone, visemeExpressions, type AvatarDescriptor, type ChainFromUnity, type ComponentKind } from './vrchat';
import type { ChainKind, SpringSettings } from '../avatar/physics.js';
import type { HumanBone } from '../avatar/skeleton.js';

export interface ReportLine {
  what: string;
  detail?: string;
}
export interface ImportReport {
  source: string;
  imported: ReportLine[];
  approximated: ReportLine[];
  skipped: ReportLine[];
  /** The package's own license or readme files, if any. */
  license: { path: string; text: string }[];
  /** Third-party content bought or downloaded by the owner: personal use, never in exports or shares. */
  thirdParty: boolean;
  /** Links between files that had to be guessed (no .meta files). */
  guessed: { from: string; to: string; how: string }[];
}

export interface Candidate {
  guid: string;
  path: string;
  name: string;
  kind: 'avatar' | 'outfit' | 'model';
  /** Why it was put in that group. */
  reason: string;
}

export interface PackageSummary {
  avatars: Candidate[];
  outfits: Candidate[];
  counts: Partial<Record<UnityKind, number>>;
  license: { path: string; text: string }[];
  exact: boolean;
}

/** Looks for avatars (a VRChat descriptor, or a humanoid model) and outfits (Merge Armature, or a model without a humanoid). */
export function summarize(project: UnityProject): PackageSummary {
  const avatars: Candidate[] = [];
  const outfits: Candidate[] = [];
  const counts: Partial<Record<UnityKind, number>> = {};
  for (const a of project.all()) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
  const modelsUsed = new Set<string>();
  for (const p of project.all('prefab')) {
    let scene: ResolvedScene;
    try {
      scene = resolvePrefab(project, p.guid);
    } catch {
      continue;
    }
    for (const m of scene.models) modelsUsed.add(m);
    const kinds = new Set(behaviours(scene).map((b) => b.kind));
    const name = stem(p.path);
    if (kinds.has('avatarDescriptor')) avatars.push({ guid: p.guid, path: p.path, name, kind: 'avatar', reason: 'Has a VRChat avatar descriptor.' });
    else if (kinds.has('maMergeArmature')) outfits.push({ guid: p.guid, path: p.path, name, kind: 'outfit', reason: 'Has a Modular Avatar Merge Armature.' });
    else if ([...scene.models].some((g) => readHumanoid(project.get(g)?.meta)?.animationType === 3)) avatars.push({ guid: p.guid, path: p.path, name, kind: 'avatar', reason: 'Built on a humanoid model.' });
    else if (scene.models.size && [...scene.comps.values()].some((c) => c.type === 'SkinnedMeshRenderer')) outfits.push({ guid: p.guid, path: p.path, name, kind: 'outfit', reason: 'Skinned meshes without a humanoid: clothing or hair.' });
    else if (scene.models.size && [...scene.models].every((g) => !project.get(g)?.meta)) avatars.push({ guid: p.guid, path: p.path, name, kind: 'avatar', reason: 'Built on a model whose Unity settings are missing: details are guessed; import it as an avatar or as clothing.' });
  }
  // Models no prefab uses: offered on their own.
  for (const m of project.all('model')) {
    if (modelsUsed.has(m.guid) || !/\.fbx$/i.test(m.path)) continue;
    const h = readHumanoid(m.meta);
    const c: Candidate = { guid: m.guid, path: m.path, name: stem(m.path), kind: 'model', reason: h?.animationType === 3 ? 'A humanoid model.' : 'A model file.' };
    if (h?.animationType === 3) avatars.push(c);
    else outfits.push(c);
  }
  // Variants of the same avatar: the prefab with the most specific name first.
  avatars.sort((a, b) => Number(/variant|quest|pc/i.test(a.name)) - Number(/variant|quest|pc/i.test(b.name)) || a.path.length - b.path.length);
  return { avatars, outfits, counts, license: licenseFiles(project), exact: project.exact };
}

export function licenseFiles(project: UnityProject): { path: string; text: string }[] {
  return project
    .all()
    .filter((a) => a.data && /(^|\/)(licen[cs]e|readme|terms|利用規約|規約|readme_jp|お読みください)[^/]*\.(txt|md)$/i.test(a.path) && a.data.length < 200_000)
    .map((a) => ({ path: a.path, text: text(a.data) }));
}

// ------------------------------------------------------------------ one avatar or outfit

export interface TextureRef {
  guid: string;
  path: string;
  /** Colour data (sRGB) or data (normal maps, masks). */
  srgb: boolean;
  normal: boolean;
}

export interface UnityPlan {
  name: string;
  /** Model files (FBX), the first one is the body. `at` is where its root sits in the prefab. */
  models: { guid: string; path: string; at: string[] }[];
  /** Nodes to switch off (inactive in the prefab), by path of names from the model's root. */
  hidden: string[][];
  renderers: { path: string[]; materials: (string | null)[]; blendShapes: Record<number, number> }[];
  materials: Record<string, MaterialSpec & { path: string }>;
  textures: Record<string, TextureRef>;
  humanoid: UnityHumanoid | null;
  /** Everloom bone → bone name, from the model's .meta. */
  boneMap: Partial<Record<HumanBone, string>>;
  descriptor: (Omit<AvatarDescriptor, 'node' | 'visemeMesh' | 'eyes' | 'eyelids'> & { visemeMesh: string[] | null; eyes: { left: string[] | null; right: string[] | null }; eyelids: { mesh: string[] | null; blink: number | null; up: number | null; down: number | null }; mouth: Partial<Record<'aa' | 'ih' | 'ou' | 'ee' | 'oh', string>> }) | null;
  chains: { path: string[]; kind: ChainKind; settings: SpringSettings; ignore: string[][]; source: string }[];
  toggles: { label: string; objects: { path: string[]; active: boolean }[] }[];
  /** For outfits: Merge Armature's settings (bones are matched to the avatar's by name). */
  merge: { root: string[]; prefix: string; suffix: string } | null;
  blendshapeSync: { mesh: string | null; blendshape: string; local: string }[];
  report: ImportReport;
}

const SKIP_WHY: Partial<Record<UnityKind, string>> = {
  script: 'Scripts (C#, DLLs) can’t run outside Unity.',
  shader: 'Shaders are Unity programs; their materials are matched to Everloom’s instead.',
  audio: 'Sounds aren’t used by avatars here.',
  scene: 'Scenes aren’t imported; their avatar prefab is.',
};

/** Plans one prefab (avatar or outfit) or a bare model. */
export function planImport(project: UnityProject, guid: string, source = 'package'): UnityPlan {
  const asset = project.get(guid);
  if (!asset) throw new Error('That file isn’t in the package.');
  const report: ImportReport = { source, imported: [], approximated: [], skipped: [], license: licenseFiles(project), thirdParty: true, guessed: [] };
  const plan: UnityPlan = { name: stem(asset.path), models: [], hidden: [], renderers: [], materials: {}, textures: {}, humanoid: null, boneMap: {}, descriptor: null, chains: [], toggles: [], merge: null, blendshapeSync: [], report };

  if (asset.kind === 'model') {
    plan.models.push({ guid, path: asset.path, at: [] });
    plan.humanoid = readHumanoid(asset.meta);
    plan.boneMap = plan.humanoid?.bones ?? {};
    addModelMaterials(project, plan, asset);
    finishReport(project, plan);
    return plan;
  }

  const scene = resolvePrefab(project, guid);
  report.approximated.push(...scene.notes.map((n) => ({ what: 'Reference', detail: n })));
  const path = (k: string) => nodePath(scene, k);
  // Model files, the body first (the one with the most renderers).
  const modelNodes = [...scene.nodes.values()].filter((n) => n.model && n.model.node === stem(project.get(n.model.guid)?.path ?? ''));
  const rendererCount = (g: string) => [...scene.comps.values()].filter((c) => (c.type === 'SkinnedMeshRenderer' || c.type === 'MeshRenderer') && scene.nodes.get(c.node)?.model?.guid === g).length;
  for (const n of modelNodes.sort((a, b) => rendererCount(b.model!.guid) - rendererCount(a.model!.guid))) {
    const m = project.get(n.model!.guid)!;
    plan.models.push({ guid: m.guid, path: m.path, at: path(n.key).slice(0, -1) });
  }
  const body = plan.models[0] ? project.get(plan.models[0].guid) : undefined;
  plan.humanoid = body ? readHumanoid(body.meta) : null;
  plan.boneMap = plan.humanoid?.bones ?? {};
  if (plan.humanoid?.animationType === 3 && Object.keys(plan.boneMap).length) report.imported.push({ what: 'Humanoid mapping', detail: `${Object.keys(plan.boneMap).length} bones, from the model’s Unity settings.` });

  // Nodes switched off in the prefab (outfit variants are often just that).
  for (const n of scene.nodes.values()) if (!n.active && (!n.parent || activeInHierarchy(scene, n.parent))) plan.hidden.push(path(n.key));

  // Renderers: materials and blendshape values set in the prefab.
  let presets = 0;
  for (const c of scene.comps.values()) {
    if (c.type !== 'SkinnedMeshRenderer' && c.type !== 'MeshRenderer') continue;
    const mats = c.materials.map((r) => matGuid(project, r, plan, report));
    const bs = Object.fromEntries(Object.entries(c.blendShapes).filter(([, v]) => v !== 0)) as Record<number, number>;
    presets += Object.keys(bs).length;
    plan.renderers.push({ path: path(c.node), materials: mats, blendShapes: bs });
  }
  if (presets) report.imported.push({ what: 'Blendshape presets', detail: `${presets} values set in the prefab (body and face shape).` });
  // Model materials not overridden by the prefab.
  for (const m of plan.models) addModelMaterials(project, plan, project.get(m.guid)!);

  // Components.
  const counts: Partial<Record<ComponentKind, number>> = {};
  const mbs = behaviours(scene);
  for (const b of mbs) counts[b.kind] = (counts[b.kind] ?? 0) + 1;
  const desc = mbs.find((b) => b.kind === 'avatarDescriptor');
  if (desc) {
    const d = readDescriptor(scene, desc);
    plan.descriptor = {
      viewPosition: d.viewPosition,
      visemes: d.visemes,
      layers: d.layers,
      menu: d.menu,
      parameters: d.parameters,
      visemeMesh: d.visemeMesh ? path(d.visemeMesh) : null,
      eyes: { left: d.eyes.left ? path(d.eyes.left) : null, right: d.eyes.right ? path(d.eyes.right) : null },
      eyelids: { mesh: d.eyelids.mesh ? path(d.eyelids.mesh) : null, blink: d.eyelids.blink, up: d.eyelids.up, down: d.eyelids.down },
      mouth: visemeExpressions(d),
    };
    const mouth = Object.keys(plan.descriptor.mouth).length;
    report.imported.push({ what: 'VRChat avatar descriptor', detail: `${mouth ? `${mouth} mouth shapes for lip-sync` : 'no visemes'}${d.eyelids.blink !== null ? ', blink' : ''}, eye height ${d.viewPosition.y.toFixed(2)}.` });
    const gestures = d.layers.filter((l) => l.controller && (l.type === 3 || l.type === 5)).length;
    if (gestures) report.approximated.push({ what: 'Gesture and FX layers', detail: 'Their states are listed as emotes; hand gestures aren’t tracked here.' });
  }
  const chains: ChainFromUnity[] = [];
  for (const b of mbs) {
    const c = b.kind === 'physBone' ? readPhysBone(scene, b) : b.kind === 'dynamicBone' ? readDynamicBone(scene, b) : null;
    if (c && b.enabled && activeInHierarchy(scene, b.node)) chains.push(c);
  }
  plan.chains = chains.map((c) => ({ path: path(c.root), kind: c.kind, settings: c.settings, ignore: c.ignore.map(path), source: c.source }));
  if (chains.length) {
    report.imported.push({ what: 'Physics', detail: `${chains.filter((c) => c.source === 'physBone').length} PhysBones and ${chains.filter((c) => c.source === 'dynamicBone').length} Dynamic Bones as spring chains.` });
    const notes = [...new Set(chains.flatMap((c) => c.notes))];
    if (notes.length) report.approximated.push({ what: 'Physics', detail: notes.join(' ') });
  }
  if (counts.physBoneCollider || counts.dynamicBoneCollider) report.approximated.push({ what: 'Physics colliders', detail: `${(counts.physBoneCollider ?? 0) + (counts.dynamicBoneCollider ?? 0)} colliders replaced by colliders made from the body.` });
  if (counts.contact) report.skipped.push({ what: 'Contacts', detail: `${counts.contact} VRChat contacts (touch triggers) have no meaning here.` });

  // Modular Avatar.
  const menus = mbs.filter((b) => b.kind === 'maMenuItem');
  for (const t of mbs.filter((b) => b.kind === 'maObjectToggle')) {
    const ot = readObjectToggle(scene, t, menus.find((m) => m.node === t.node));
    plan.toggles.push({ label: ot.label, objects: ot.objects.filter((o) => o.node).map((o) => ({ path: path(o.node!), active: o.active })) });
  }
  if (plan.toggles.length) report.imported.push({ what: 'Toggles', detail: `${plan.toggles.length} Modular Avatar object toggles as wardrobe parts.` });
  const merge = mbs.find((b) => b.kind === 'maMergeArmature');
  if (merge) {
    const ma = readMergeArmature(scene, merge);
    plan.merge = { root: path(ma.node), prefix: ma.prefix, suffix: ma.suffix };
    report.imported.push({ what: 'Merge Armature', detail: `Bones matched to the avatar’s by name${ma.prefix ? ` (prefix “${ma.prefix}”)` : ''}${ma.suffix ? ` (suffix “${ma.suffix}”)` : ''}.` });
  }
  for (const s of mbs.filter((b) => b.kind === 'maBlendshapeSync')) plan.blendshapeSync.push(...readBlendshapeSync(s).bindings.map((x) => ({ mesh: x.meshPath, blendshape: x.blendshape, local: x.local })));
  if (plan.blendshapeSync.length) report.imported.push({ what: 'Blendshape Sync', detail: `${plan.blendshapeSync.length} body shapes copied onto the outfit.` });
  if (counts.maOther) report.skipped.push({ what: 'Modular Avatar menus and animators', detail: `${counts.maOther} components that build VRChat menus and animators.` });
  if (counts.unknown) report.skipped.push({ what: 'Other components', detail: `${counts.unknown} components Everloom doesn’t know.` });

  finishReport(project, plan);
  return plan;
}

function matGuid(project: UnityProject, r: UnityRef | null, plan: UnityPlan, report: ImportReport): string | null {
  if (!r?.guid) return null;
  const a = project.get(r.guid);
  if (!a?.data || a.kind !== 'material') {
    if (!a) report.skipped.push({ what: 'Material', detail: `A material (${r.guid.slice(0, 8)}…) isn’t in the package.` });
    return null;
  }
  addMaterial(project, plan, a);
  return a.guid;
}

function addMaterial(project: UnityProject, plan: UnityPlan, a: UnityAsset) {
  if (plan.materials[a.guid]) return;
  const spec = readMaterial(text(a.data));
  if (!spec) return;
  plan.materials[a.guid] = { ...spec, path: a.path };
  for (const [slot, t] of Object.entries(spec.raw.textures)) {
    const tex = project.get(t.ref.guid) ?? project.guess(a.path, 'texture', spec.name, slot);
    // Keep the link under the GUID the material asks for, so the browser finds it.
    if (tex && tex.guid !== t.ref.guid) project.links.set(t.ref.guid!, tex.guid);
    if (!tex) continue;
    const ti = importer(tex.meta, 'TextureImporter');
    const normal = Number(ti.textureType ?? (/bump|normal/i.test(slot) ? 1 : 0)) === 1 || /_BumpMap|_NormalMap/.test(slot);
    const srgb = Number(asStr((asMap(ti.mipmaps).sRGBTexture ?? ti.sRGBTexture) as never, '1')) !== 0;
    // Keyed by the GUID the material uses; `guid` is the file actually found.
    plan.textures[t.ref.guid!] = { guid: tex.guid, path: tex.path, srgb: !normal && srgb, normal };
  }
}

/** A model's own materials: remapped in its .meta (externalObjects), else found by name next to it. */
function addModelMaterials(project: UnityProject, plan: UnityPlan, model: UnityAsset) {
  const imp = importer(model.meta, 'ModelImporter');
  const ext = (imp.externalObjects ?? []) as unknown[];
  let remapped = 0;
  for (const e of Array.isArray(ext) ? ext : []) {
    const second = (e as { second?: { guid?: string } }).second;
    const g = second?.guid;
    const a = g ? project.get(String(g)) : undefined;
    if (a?.kind === 'material') {
      addMaterial(project, plan, a);
      remapped++;
    }
  }
  // No remapping: Unity's "search by name" finds materials in the model's folder or the one above;
  // the browser matches them to the FBX's material slots by name.
  if (!remapped) {
    const dir = dirName(model.path);
    const up = dirName(dir);
    // (Files picked without their folders all sit at the top: every material counts.)
    for (const a of project.all('material')) if (!dir || a.path.startsWith(dir + '/') || (up && a.path.startsWith(up + '/'))) addMaterial(project, plan, a);
  }
}

function finishReport(project: UnityProject, plan: UnityPlan) {
  const r = plan.report;
  r.guessed = [...project.guessed];
  r.imported.unshift({ what: 'Models', detail: plan.models.map((m) => baseName(m.path)).join(', ') || 'none' });
  const mats = Object.values(plan.materials);
  if (mats.length) {
    const fam = new Map<string, number>();
    for (const m of mats) fam.set(m.family, (fam.get(m.family) ?? 0) + 1);
    r.imported.push({ what: 'Materials', detail: `${mats.length} (${[...fam].map(([k, v]) => `${v} ${k}`).join(', ')}), ${Object.keys(plan.textures).length} textures.` });
    const notes = [...new Set(mats.flatMap((m) => m.notes))];
    for (const n of notes) r.approximated.push({ what: 'Materials', detail: n });
  }
  if (plan.hidden.length) r.imported.push({ what: 'Hidden objects', detail: `${plan.hidden.length} objects switched off in the prefab stay off (they’re wardrobe parts).` });
  for (const [kind, why] of Object.entries(SKIP_WHY)) {
    const n = project.all(kind as UnityKind).length;
    if (n) r.skipped.push({ what: `${n} ${kind === 'script' ? 'scripts' : kind === 'shader' ? 'shaders' : kind === 'audio' ? 'sounds' : 'scenes'}`, detail: why });
  }
  const anims = project.all('anim').length;
  if (anims) r.approximated.push({ what: 'Animations', detail: `${anims} clips: blendshape and transform curves import; humanoid muscle curves need retargeting and are marked so.` });
  if (!project.exact) r.approximated.push({ what: 'Links between files', detail: 'Some .meta files are missing, so materials and textures were matched by name. Check them in “Link missing files”.' });
}
