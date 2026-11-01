/**
 * Builds an Everloom model from a Unity package or extracted Unity files, in the browser: the FBX
 * is loaded with three.js, the plan's materials, blendshape presets and hidden objects applied, and
 * the result exported as a GLB, with the avatar settings the plan gives (humanoid map, lip-sync and
 * blink, spring chains, wardrobe parts) and the import report. An outfit's bones are renamed to
 * the avatar's so it binds to them as a garment.
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { mergeFbxSubBones } from '../import';
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { linearColor, matchOutfitBone, planImport, projectFromFiles, projectFromPackage, summarize, type ImportReport, type MaterialSpec, type PackageSummary, type UnityPlan, type UnityProject } from '@everloom/engine/unity';
import type { AvatarConfig, AvatarPart } from '@everloom/engine';
import type { UnpackReply, UnpackRequest } from './worker';
import { readAnim } from '@everloom/engine/unity';
import { convertMotion } from '../convert';
import type { ClipJSON } from '../clip';

export type Progress = (step: string) => void;

/** Files a Unity import accepts (a package, an archive of an extracted folder, or the loose files). */
export const UNITY_FILE = /\.(unitypackage|prefab|mat|anim|controller|asset|unity|meta|overrideController)$/i;
export const isUnityInput = (files: File[]) => files.some((f) => /\.unitypackage$/i.test(f.name)) || files.some((f) => /\.(prefab|meta)$/i.test(f.name));

/** Unpacks in a worker and reads the project (GUIDs, paths, .meta settings). */
export async function readUnity(files: File[], progress: Progress = () => {}): Promise<UnityProject> {
  progress('Unpacking…');
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'unity-unpack' });
  try {
    const reply = await new Promise<Extract<UnpackReply, { ok: boolean }>>((resolve) => {
      worker.onmessage = (e: MessageEvent<UnpackReply>) => {
        if ('progress' in e.data) progress(e.data.progress);
        else resolve(e.data);
      };
      worker.onerror = (e) => resolve({ ok: false, error: e.message || 'The unpacker stopped.' });
      const req: UnpackRequest = { files: files.map((f) => ({ name: f.name, path: (f as File & { relPath?: string }).relPath || (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, file: f })) };
      worker.postMessage(req);
    });
    if (!reply.ok) throw new Error(reply.error);
    progress('Reading the Unity files…');
    const project = projectFromPackage(reply.entries.map((e) => ({ ...e, size: e.data.length })));
    for (const asset of projectFromFiles(stripTop(reply.files)).all()) project.add(asset);
    return project;
  } finally {
    worker.terminate();
  }
}

/** "MyAvatar/Assets/…" from a zipped or uploaded folder → "Assets/…"; other paths stay as they are. */
function stripTop(files: { path: string; data: Uint8Array }[]) {
  return files.map((f) => {
    const p = f.path.replace(/\\/g, '/');
    const i = p.indexOf('/Assets/');
    return { ...f, path: i >= 0 ? p.slice(i + 1) : p };
  });
}

export { summarize, type PackageSummary };

export interface UnityBuild {
  file: File;
  plan: UnityPlan;
  /** Settings for an avatar (merged into the processed model's own). */
  config: Partial<AvatarConfig>;
  report: ImportReport;
  /** Blendshape values set in the prefab, by name (0–1): they become the avatar's slider values. */
  presets: Record<string, number>;
  /** Body animations converted to Everloom motions (saved to the motion library). */
  clips: { label: string; clip: ClipJSON; loop: boolean }[];
}

/**
 * A Unity clip's transform curves as a three.js clip on the model's bones. Unity is left-handed:
 * mirroring the X axis turns its rotations (x, y, z, w) into (x, −y, −z, w) and positions into (−x, y, z).
 */
function threeClip(text: string, root: THREE.Object3D): THREE.AnimationClip | null {
  const a = readAnim(text);
  if (!a) return null;
  const tracks: THREE.KeyframeTrack[] = [];
  const bone = (path: string) => {
    const name = path.split('/').pop() ?? '';
    const o = root.getObjectByName(name) ?? root.getObjectByName(sanitize(name));
    return o?.name ?? null;
  };
  for (const c of a.rotations) {
    const b = bone(c.path);
    if (b && c.keys.length) tracks.push(new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, c.keys.map((k) => k.t), c.keys.flatMap((k) => [k.v[0], -k.v[1], -k.v[2], k.v[3]])));
  }
  for (const c of a.eulers) {
    const b = bone(c.path);
    if (!b || !c.keys.length) continue;
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    // Unity applies Euler angles Z, then X, then Y (degrees).
    tracks.push(new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, c.keys.map((k) => k.t), c.keys.flatMap((k) => {
      e.set(THREE.MathUtils.degToRad(k.v[0]), THREE.MathUtils.degToRad(-k.v[1]), THREE.MathUtils.degToRad(-k.v[2]), 'YXZ');
      q.setFromEuler(e);
      return [q.x, q.y, q.z, q.w];
    })));
  }
  for (const c of a.positions) {
    const b = bone(c.path);
    if (b && c.keys.length) tracks.push(new THREE.VectorKeyframeTrack(`${b}.position`, c.keys.map((k) => k.t), c.keys.flatMap((k) => [-k.v[0], k.v[1], k.v[2]])));
  }
  return tracks.length ? new THREE.AnimationClip(a.name, a.length || -1, tracks) : null;
}

const sanitize = (n: string) => THREE.PropertyBinding.sanitizeNodeName(n);

/** Finds the object a plan path names, below the model's root (path[0] is the root itself). */
function find(root: THREE.Object3D, path: string[]): THREE.Object3D | null {
  let cur: THREE.Object3D | null = root;
  for (const name of path.slice(1)) {
    if (!cur) return null;
    const want = sanitize(name);
    let hit: THREE.Object3D | null = null;
    cur.traverse((o) => {
      if (!hit && o !== cur && (o.name === name || o.name === want)) hit = o;
    });
    cur = hit;
  }
  return cur;
}

async function texture(project: UnityProject, guid: string, srgb: boolean, urls: string[]): Promise<THREE.Texture | null> {
  const a = project.get(guid);
  if (!a?.data) return null;
  const ext = a.path.split('.').pop()!.toLowerCase();
  const blob = new Blob([a.data as BlobPart]);
  let t: THREE.Texture;
  if (ext === 'tga') {
    const url = URL.createObjectURL(blob);
    urls.push(url);
    t = await new TGALoader().loadAsync(url);
  } else if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) {
    const url = URL.createObjectURL(blob);
    urls.push(url);
    t = await new THREE.TextureLoader().loadAsync(url);
  } else if (ext === 'psd') {
    // Photoshop files: the flattened image (ag-psd, MIT; loaded only when a package has one).
    const { readPsd } = await import('ag-psd');
    const psd = readPsd(a.data.buffer.slice(a.data.byteOffset, a.data.byteOffset + a.data.byteLength) as ArrayBuffer, { skipLayerImageData: true, skipThumbnail: true });
    if (!psd.canvas) return null;
    t = new THREE.CanvasTexture(psd.canvas as HTMLCanvasElement);
  } else if (ext === 'dds' || ext === 'ktx2') {
    const { webTexture } = await import('../textures');
    const url = URL.createObjectURL(await webTexture(new File([blob], a.path.split('/').pop()!)));
    urls.push(url);
    t = await new THREE.TextureLoader().loadAsync(url);
  } else return null; // other formats: reported, the material keeps its colour
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.name = a.path.split('/').pop()!;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A material from a Unity material: standard material data, plus toon details for Everloom's toon look. */
async function material(project: UnityProject, plan: UnityPlan, spec: MaterialSpec, urls: string[], cache: Map<string, THREE.Texture | null>): Promise<THREE.MeshStandardMaterial> {
  const tex = async (slot?: { ref: { guid?: string }; scale: [number, number]; offset: [number, number] }) => {
    const g = slot?.ref.guid;
    if (!g) return null;
    const info = plan.textures[g];
    const key = `${g}:${info?.srgb ?? true}`;
    if (!cache.has(key)) {
      try {
        const t = info ? await texture(project, info.guid, info.srgb, urls) : null;
        if (!t) throw new Error('missing or unsupported image');
        cache.set(key, t);
      } catch {
        plan.report.approximated.push({ what: 'Texture placeholder', detail: `${info?.path ?? g}: could not decode the image. Relink it in the Materials editor.` });
        cache.set(key, placeholderTexture());
      }
    }
    const t = cache.get(key);
    if (!t) return null;
    if (slot.scale[0] !== 1 || slot.scale[1] !== 1 || slot.offset[0] || slot.offset[1]) {
      const c = t.clone();
      c.repeat.set(slot.scale[0], slot.scale[1]);
      c.offset.set(slot.offset[0], slot.offset[1]);
      return c;
    }
    return t;
  };
  const [r, g, b] = linearColor(spec.color);
  const m = new THREE.MeshStandardMaterial({ name: spec.name, color: new THREE.Color(r, g, b), roughness: 0.9, metalness: 0 });
  m.map = await tex(spec.map);
  if (spec.normalMap) {
    m.normalMap = await tex(spec.normalMap);
    m.normalScale.set(spec.normalScale, spec.normalScale);
  }
  if (spec.emissive) {
    const [er, eg, eb] = linearColor(spec.emissive.color);
    m.emissive = new THREE.Color(er, eg, eb);
    m.emissiveMap = await tex(spec.emissive.map);
  }
  m.side = spec.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
  if (spec.alpha === 'cutout') m.alphaTest = spec.cutoff;
  if (spec.alpha === 'transparent') {
    m.transparent = true;
    m.depthWrite = false;
  }
  // Exported as glTF extras; the toon look reads them (see materials.ts).
  m.userData.everloomToon = {
    family: spec.family,
    shade: spec.shade ? linearColor(spec.shade.color) : null,
    border: spec.shade?.border ?? null,
    rim: spec.rim ? { color: linearColor(spec.rim.color), power: spec.rim.power } : null,
    outline: spec.outline ? { color: linearColor(spec.outline.color), width: spec.outline.width } : null,
  };
  return m;
}

/** Builds the model for one avatar, outfit or bare model of the project. */
export async function buildUnity(project: UnityProject, guid: string, opts: { as: 'avatar' | 'outfit'; avatarBones?: string[] } = { as: 'avatar' }, progress: Progress = () => {}): Promise<UnityBuild> {
  if (project.get(guid)?.sourceId) await (await import('./library')).hydrateUnity(project, guid, progress);
  const plan = planImport(project, guid, project.exact ? 'Unity package' : 'Unity files');
  const report = plan.report;
  const urls: string[] = [];
  try {
    const body = plan.models[0];
    if (!body) throw new Error('This prefab has no model file Everloom can read (its FBX isn’t in the package).');
    const bodyAsset = project.get(body.guid);
    if (!bodyAsset?.data) throw new Error(`${body.path} isn’t in the package.`);
    if (!/\.fbx$/i.test(body.path)) throw new Error(`${body.path.split('/').pop()}: only FBX models inside Unity packages are supported.`);
    progress(`Loading ${body.path.split('/').pop()}…`);
    // Textures the FBX names itself come from the package, never from the network.
    const manager = new THREE.LoadingManager();
    let loading = false;
    let finishLoading: () => void = () => {};
    const imagesLoaded = new Promise<void>(resolve => { finishLoading = resolve; });
    manager.onStart = () => { loading = true; };
    manager.onLoad = finishLoading;
    manager.onError = () => report.approximated.push({ what: 'Texture placeholder', detail: 'An FBX image could not be loaded; replace it in Materials.' });
    const byName = new Map(project.all('texture').map((a) => [a.path.split('/').pop()!.toLowerCase(), a]));
    // Decode non-browser formats before FBXLoader requests them. Its URL modifier is synchronous.
    const decoded = new Map<string, string>();
    const { webTexture } = await import('../textures');
    for (const a of byName.values()) {
      if (!a.data || !/\.(tga|psd|dds|ktx2)$/i.test(a.path)) continue;
      try {
        const image = await webTexture(new File([a.data as BlobPart], a.path.split('/').pop()!));
        const url = URL.createObjectURL(image); urls.push(url); decoded.set(a.guid, url);
      } catch { report.approximated.push({ what: 'Texture placeholder', detail: `${a.path}: decoding failed; relink it in Materials.` }); }
    }
    const placeholder = placeholderTexture().image as HTMLCanvasElement;
    const fallbackUrl = placeholder.toDataURL('image/png');
    manager.setURLModifier((url) => {
      if (/^(blob:|data:)/.test(url)) return url;
      const a = byName.get(decodeURIComponent(url).replace(/\\/g, '/').split('/').pop()!.toLowerCase());
      if (a && decoded.has(a.guid)) return decoded.get(a.guid)!;
      if (!a?.data || !/\.(png|jpe?g|webp|gif|bmp)$/i.test(a.path)) {
        report.approximated.push({ what: 'Texture placeholder', detail: `${a?.path ?? url.split('/').pop()}: missing or unreadable image; relink it in Materials.` });
        return fallbackUrl;
      }
      const u = URL.createObjectURL(new Blob([a.data as BlobPart]));
      urls.push(u);
      return u;
    });
    const root = new FBXLoader(manager).parse(bodyAsset.data.buffer.slice(bodyAsset.data.byteOffset, bodyAsset.data.byteOffset + bodyAsset.data.byteLength) as ArrayBuffer, '');
    mergeFbxSubBones(root);
    root.name = sanitize(body.path.split('/').pop()!.replace(/\.[^.]+$/, ''));
    // Accessory models (a hair FBX, a prop) placed in the prefab.
    for (const extra of plan.models.slice(1)) {
      const a = project.get(extra.guid);
      if (!a?.data || !/\.fbx$/i.test(a.path)) {
        report.skipped.push({ what: 'Model', detail: `${extra.path.split('/').pop()}: not an FBX, left out.` });
        continue;
      }
      const sub = new FBXLoader(manager).parse(a.data.buffer.slice(a.data.byteOffset, a.data.byteOffset + a.data.byteLength) as ArrayBuffer, '');
      mergeFbxSubBones(sub);
      sub.name = sanitize(a.path.split('/').pop()!.replace(/\.[^.]+$/, ''));
      (find(root, [root.name, ...extra.at.slice(1)]) ?? root).add(sub);
    }
    if (loading) await imagesLoaded;

    // Materials: the prefab's choice per renderer, else by the FBX material's name.
    progress('Materials…');
    const cache = new Map<string, THREE.Texture | null>();
    const made = new Map<string, THREE.MeshStandardMaterial>();
    const mat = async (g: string) => {
      if (!made.has(g)) made.set(g, await material(project, plan, plan.materials[g]!, urls, cache));
      return made.get(g)!;
    };
    const byMatName = new Map(Object.entries(plan.materials).map(([g, m]) => [m.name.toLowerCase(), g]));
    const overridden = new Set<THREE.Object3D>();
    const presets: Record<string, number> = {};
    for (const r of plan.renderers) {
      const o = find(root, r.path) as THREE.Mesh | null;
      if (!o) continue;
      const mesh = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh) : (o.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh | undefined);
      if (!mesh) continue;
      if (r.materials.some(Boolean)) {
        const slots = Array.isArray(mesh.material) ? [...mesh.material] : [mesh.material];
        for (let i = 0; i < slots.length; i++) {
          const g = r.materials[i] ?? r.materials[r.materials.length - 1];
          if (g && plan.materials[g]) slots[i] = await mat(g);
        }
        mesh.material = Array.isArray(mesh.material) ? slots : slots[0]!;
        overridden.add(mesh);
      }
      // Blendshape values from the prefab (Unity: 0–100).
      if (mesh.morphTargetInfluences) {
        const names = Object.entries(mesh.morphTargetDictionary ?? {});
        for (const [i, v] of Object.entries(r.blendShapes)) {
          if (Number(i) >= mesh.morphTargetInfluences.length) continue;
          const w = Math.max(0, Math.min(1, v / 100));
          mesh.morphTargetInfluences[Number(i)] = w;
          const name = names.find(([, k]) => k === Number(i))?.[0];
          if (name) presets[name] = w;
        }
      }
    }
    const missingMats = new Set<string>();
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    for (const mesh of meshes) {
      if (overridden.has(mesh)) continue;
      const slots = Array.isArray(mesh.material) ? [...mesh.material] : [mesh.material];
      for (let i = 0; i < slots.length; i++) {
        const name = (slots[i]!.name || '').toLowerCase();
        const g = byMatName.get(name) ?? byMatName.get(name.replace(/\.\d{3}$/, ''));
        if (g) slots[i] = await mat(g);
        else if (name) missingMats.add(slots[i]!.name);
      }
      mesh.material = Array.isArray(mesh.material) ? slots : slots[0]!;
    }
    if (missingMats.size) report.approximated.push({ what: 'Materials', detail: `No Unity material for ${[...missingMats].slice(0, 6).join(', ')}${missingMats.size > 6 ? '…' : ''}: the FBX’s own material is used.` });
    const psd = Object.values(plan.textures).filter((t) => /\.psd$/i.test(t.path)).length;
    if (psd) report.approximated.push({ what: 'Textures', detail: `${psd} Photoshop textures, used flattened (their layers merged).` });
    const odd = Object.values(plan.textures).filter((t) => !/\.(png|jpe?g|webp|gif|bmp|tga|psd|dds|ktx2)$/i.test(t.path));
    if (odd.length) report.skipped.push({ what: 'Textures', detail: `${odd.map((t) => t.path.split('/').pop()).slice(0, 4).join(', ')}: a format Everloom can’t read here; those materials show their colour.` });

    // Hidden objects and toggles become wardrobe parts.
    const parts: AvatarPart[] = [];
    const meshNames = (o: THREE.Object3D) => {
      const out: string[] = [];
      o.traverse((c) => {
        if ((c as THREE.Mesh).isMesh && c.name) out.push(c.name);
      });
      return [...new Set(out)].slice(0, 64);
    };
    const partId = (name: string) => `u_${sanitize(name).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 30) || 'part'}_${parts.length}`;
    for (const h of plan.hidden) {
      const o = find(root, h);
      if (!o) continue;
      const names = meshNames(o);
      if (names.length) parts.push({ id: partId(o.name), name: (h.at(-1) ?? 'Part').slice(0, 60), meshes: names, hides: [], on: false, items: [] });
      o.visible = true; // exported visible; the part switches it
    }
    for (const t of plan.toggles) {
      const names = t.objects.flatMap((x) => {
        const o = find(root, x.path);
        return o ? meshNames(o) : [];
      });
      if (!names.length || parts.some((p) => p.meshes.join() === names.join())) continue;
      parts.push({ id: partId(t.label), name: t.label.slice(0, 60), meshes: names.slice(0, 64), hides: [], on: t.objects.every((x) => !plan.hidden.some((h) => h.join('/') === x.path.join('/'))), items: [] });
    }
    const clothing = /shirt|jacket|coat|dress|skirt|pants|trouser|shorts|bra|bikini|underwear|shoe|boot|sock|stocking|glove|hair|hat|ribbon|belt/i;
    root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.name) return;
      if (!parts.some(p => p.meshes.includes(mesh.name)) && parts.length < 64) parts.push({ id: partId(mesh.name), name: mesh.name.slice(0, 60), meshes: [mesh.name], hides: [], on: mesh.visible, items: [] });
      if (Array.isArray(mesh.material) && mesh.material.length > 1) for (const [slot, mat] of mesh.material.entries()) {
        if (!clothing.test(mat.name) || parts.length >= 64) continue;
        parts.push({ id: partId(mat.name), name: mat.name.slice(0, 60), meshes: [mesh.name], materialSlots: [{ mesh: mesh.name, slot, material: mat.name }], hides: [], on: true, items: [] });
      }
    });
    const morphs = new Set<string>();
    root.traverse(o => Object.keys((o as THREE.Mesh).morphTargetDictionary ?? {}).forEach(m => morphs.add(m)));
    const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const part of parts) {
      const matches = [...morphs].filter(m => /^(hide|shrink)[_ .-]/i.test(m) && plain(m.replace(/^(hide|shrink)[_ .-]+/i, '')) === plain(part.name));
      if (matches.length) part.hideMorphs = matches.slice(0, 32).map(morph => ({ morph, weight: 1 }));
    }

    // An outfit: its bones take the avatar's names, so it binds to the avatar as a garment.
    if (opts.as === 'outfit' && opts.avatarBones?.length) {
      const avatar = new Set(opts.avatarBones);
      let matched = 0;
      let total = 0;
      root.traverse((o) => {
        if (!(o as THREE.Bone).isBone) return;
        total++;
        const hit = matchOutfitBone(o.name, avatar, plan.merge?.prefix ?? '', plan.merge?.suffix ?? '') ?? matchOutfitBone(o.name, new Set([...avatar].map(sanitize)), sanitize(plan.merge?.prefix ?? ''), sanitize(plan.merge?.suffix ?? ''));
        if (hit) {
          o.name = hit;
          matched++;
        }
      });
      report.imported.push({ what: 'Outfit bones', detail: `${matched} of ${total} bones matched to the avatar’s; the rest (a skirt, ribbons) move with their parent and physics.` });
      if (!matched) throw new Error('This outfit uses a different skeleton. Choose “Fit to this avatar” to align it and transfer weights.');
    }

    // Avatar settings.
    const config: Partial<AvatarConfig> = {};
    if (opts.as === 'avatar') {
      config.boneMap = plan.boneMap as AvatarConfig['boneMap'];
      const expr: AvatarConfig['expressionMap'] = {};
      for (const [k, morph] of Object.entries(plan.descriptor?.mouth ?? {})) if (morph) expr[k as 'aa'] = [{ morph, weight: 1 }];
      const lids = plan.descriptor?.eyelids;
      if (lids?.mesh && lids.blink !== null) {
        const m = find(root, lids.mesh) as THREE.Mesh | null;
        const dict = m?.morphTargetDictionary ?? (m?.children.find((c) => (c as THREE.Mesh).morphTargetDictionary) as THREE.Mesh | undefined)?.morphTargetDictionary;
        const name = dict ? Object.entries(dict).find(([, i]) => i === lids.blink)?.[0] : undefined;
        if (name) expr.blink = [{ morph: name, weight: 1 }];
      }
      config.expressionMap = expr;
      config.parts = parts;
      const chains = plan.chains.slice(0, 64).map((c) => ({ bone: c.path.at(-1)!, kind: c.kind, on: true, settings: c.settings }));
      if (chains.length) config.physics = { enabled: true, stiffness: 1, gravity: 1, damping: 0.4, wind: 0, chest: { enabled: true, strength: 1 }, chains, colliders: [] };
      if (plan.chains.length > 64) report.approximated.push({ what: 'Physics', detail: `${plan.chains.length} chains; the first 64 are used.` });
      if (Object.values(plan.materials).some((m) => ['liltoon', 'poiyomi', 'mtoon', 'uts'].includes(m.family))) config.look = 'toon';
      const outline = Object.values(plan.materials).find((m) => m.outline);
      if (outline?.outline) config.outlineWidth = Math.min(0.02, outline.outline.width);
    }

    if (opts.as === 'avatar' && Object.keys(plan.expressions).length) config.expressionMap = { ...plan.expressions, ...config.expressionMap } as AvatarConfig['expressionMap'];

    progress('Writing the model…');
    if (plan.sps.length) root.userData.everloomSps = plan.sps;
    // A failed embedded FBX image can leave a Texture with no drawable data. Do not let one
    // image abort GLTFExporter; convert every image to RGBA and replace broken ones individually.
    await exportableTextures(root, report);
    const glb = (await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false, maxTextureSize: 4096 })) as ArrayBuffer;
    const file = new File([glb], `${plan.name}.glb`, { type: 'model/gltf-binary' });

    // Body animations, converted on this model's own skeleton (after the export: it poses the rig).
    const clips: UnityBuild['clips'] = [];
    if (opts.as === 'avatar') {
      for (const a of plan.anims.filter((x) => ['body', 'face', 'humanoid'].includes(x.kind)).slice(0, 20)) {
        const data = project.get(a.guid)?.data;
        if (!data) continue;
        try {
          if (a.kind !== 'body') {
            const { unityMotionText } = await import('./motion');
            const converted = unityMotionText(new TextDecoder().decode(data), { id: `unity_${a.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`.slice(0, 40), loop: a.loop, source: a.path });
            clips.push({ label: a.name.slice(0, 40), loop: a.loop, clip: converted.clip });
            for (const detail of converted.notes) report.approximated.push({ what: a.name, detail });
            continue;
          }
          const clip = threeClip(new TextDecoder().decode(data), root);
          if (!clip) continue;
          const id = `unity_${a.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'clip'}`;
          clips.push({ label: a.name.slice(0, 40), loop: a.loop, clip: convertMotion({ scene: root, animations: [clip], humanoid: plan.boneMap }, clip, { id, loop: a.loop, inPlace: true, source: a.path.slice(0, 200), maxSeconds: 30 }) });
        } catch (e) {
          report.skipped.push({ what: 'Animation', detail: `${a.name}: ${(e as Error).message}` });
        }
      }
    }
    for (const key of ['imported', 'approximated', 'skipped'] as const) {
      const lines = report[key];
      report[key] = (lines.length > 60 ? [...lines.slice(0, 59), { what: 'Additional details', detail: `${lines.length - 59} more entries; source files remain in your library.` }] : lines).map(l => ({ what: l.what.slice(0, 120), ...(l.detail ? { detail: l.detail.slice(0, 600) } : {}) }));
    }
    report.source = report.source.slice(0, 80);
    report.license = report.license.slice(0, 6).map(l => ({ path: l.path.slice(0, 300), text: l.text.slice(0, 6000) }));
    report.guessed = report.guessed.slice(0, 200).map(l => ({ ...l, from: l.from.slice(0, 300), to: l.to.slice(0, 300), how: l.how.slice(0, 120) }));
    return { file, plan, config, report, presets, clips };
  } finally {
    for (const u of urls) URL.revokeObjectURL(u);
  }
}

function placeholderTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#b0b0b0'; ctx.fillRect(0, 0, 2, 2);
  return new THREE.CanvasTexture(canvas);
}

export async function exportableTextures(root: THREE.Object3D, report: ImportReport) {
  const textures = new Set<THREE.Texture>();
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(mat)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  for (const t of textures) {
    try {
      const image = t.image as (CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width: number; height: number; data?: ArrayLike<number> }) | undefined;
      if (!image) throw new Error('Missing image');
      if (image instanceof HTMLImageElement && !image.complete) await image.decode();
      const w = image?.naturalWidth ?? image?.width, h = image?.naturalHeight ?? image?.height;
      if (!w || !h || w * h > 64_000_000) throw new Error('Invalid image dimensions');
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      if (image.data) {
        if (!(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray) || image.data.length !== w * h * 4) throw new Error('Expected decoded RGBA pixels');
        const data = new ImageData(w, h); data.data.set(image.data); ctx.putImageData(data, 0, 0);
      } else ctx.drawImage(image, 0, 0);
      t.image = canvas; t.needsUpdate = true;
    } catch {
      t.image = placeholderTexture().image; t.needsUpdate = true;
      report.approximated.push({ what: 'Texture placeholder', detail: `${t.name || 'Embedded FBX texture'}: invalid image data; relink it in Materials.` });
    }
  }
}
