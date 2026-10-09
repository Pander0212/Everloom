/**
 * Builds an Everloom model from a Unity package or extracted Unity files, in the browser: the FBX
 * is loaded with three.js, the plan's materials, blendshape presets and hidden objects applied, and
 * the result exported as a GLB, with the avatar settings the plan gives (humanoid map, lip-sync and
 * blink, spring chains, wardrobe parts) and the import report. An outfit's bones are renamed to
 * the avatar's so it binds to them as a garment.
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { linearColor, matchOutfitBone, planImport, projectFromFiles, projectFromPackage, summarize, type ImportReport, type MaterialSpec, type PackageSummary, type UnityPlan, type UnityProject } from '@everloom/engine/unity';
import type { AvatarConfig, AvatarPart } from '@everloom/engine';
import type { UnpackReply, UnpackRequest } from './worker';

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
      const req: UnpackRequest = { files: files.map((f) => ({ name: f.name, path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, file: f })) };
      worker.postMessage(req);
    });
    if (!reply.ok) throw new Error(reply.error);
    progress('Reading the Unity files…');
    return reply.kind === 'package' ? projectFromPackage(reply.entries.map((e) => ({ ...e, size: e.data.length }))) : projectFromFiles(stripTop(reply.files));
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
  } else return null; // PSD and other formats: reported, the material keeps its colour
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
    if (!cache.has(key)) cache.set(key, info ? await texture(project, info.guid, info.srgb, urls) : null);
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
    const byName = new Map(project.all('texture').map((a) => [a.path.split('/').pop()!.toLowerCase(), a]));
    manager.setURLModifier((url) => {
      if (/^(blob:|data:)/.test(url)) return url;
      const a = byName.get(decodeURIComponent(url).replace(/\\/g, '/').split('/').pop()!.toLowerCase());
      if (!a?.data || !/\.(png|jpe?g|webp|gif|bmp)$/i.test(a.path)) return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
      const u = URL.createObjectURL(new Blob([a.data as BlobPart]));
      urls.push(u);
      return u;
    });
    const root = new FBXLoader(manager).parse(bodyAsset.data.buffer.slice(bodyAsset.data.byteOffset, bodyAsset.data.byteOffset + bodyAsset.data.byteLength) as ArrayBuffer, '');
    root.name = sanitize(body.path.split('/').pop()!.replace(/\.[^.]+$/, ''));
    // Accessory models (a hair FBX, a prop) placed in the prefab.
    for (const extra of plan.models.slice(1)) {
      const a = project.get(extra.guid);
      if (!a?.data || !/\.fbx$/i.test(a.path)) {
        report.skipped.push({ what: 'Model', detail: `${extra.path.split('/').pop()}: not an FBX, left out.` });
        continue;
      }
      const sub = new FBXLoader(manager).parse(a.data.buffer.slice(a.data.byteOffset, a.data.byteOffset + a.data.byteLength) as ArrayBuffer, '');
      sub.name = sanitize(a.path.split('/').pop()!.replace(/\.[^.]+$/, ''));
      (find(root, [root.name, ...extra.at.slice(1)]) ?? root).add(sub);
    }

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
    if (psd) report.approximated.push({ what: 'Textures', detail: `${psd} Photoshop textures: their materials show their colour until a PNG is linked.` });

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
      if (!matched) throw new Error('None of this outfit’s bones match the avatar’s. Is it made for this avatar?');
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

    progress('Writing the model…');
    const glb = (await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false, maxTextureSize: 4096 })) as ArrayBuffer;
    const file = new File([glb], `${plan.name}.glb`, { type: 'model/gltf-binary' });
    return { file, plan, config, report, presets };
  } finally {
    for (const u of urls) URL.revokeObjectURL(u);
  }
}
