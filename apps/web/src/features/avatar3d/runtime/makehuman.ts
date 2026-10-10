/** MakeHuman geometry, proxy fitting and skinning, using only browser JavaScript and CC0 data. */
import * as THREE from 'three';
import { skinDetail, longHairMotion } from './native-materials';
import { gunzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { resolveHumanPath, type AvatarConfig } from '@everloom/engine';
import { get } from '@/lib/api';
import { onVaultLocked } from '@/lib/vaultMode';
import { usePrefs3D } from '@/features/avatars/prefs';
import { blendTargets, fitProxy, parseHumanMaterial, parseHumanObj, parseHumanRig, parseProxy, parseTarget, type HumanObj, type HumanRig } from './makehuman-data';
export type HumanProfile = NonNullable<AvatarConfig['makehuman']>;
export interface HumanLibrary { adultEnabled?: boolean; core: { installed: boolean; files: Record<string, string> }; system: { installed: boolean; files: Record<string, string> } }
const cached = new Map<string, Promise<string>>();
onVaultLocked(() => cached.clear());
async function data(url: string) {
  if (!cached.has(url)) cached.set(url, (async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`MakeHuman data could not be read (HTTP ${res.status}).`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return new TextDecoder().decode(bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes);
  })().catch(e => { cached.delete(url); throw e; }));
  return cached.get(url)!;
}
const basename = (path: string) => path.split('/').pop()!;
export function resolveHumanAsset(files: Record<string, string>, parent: string, relative: string) {
  return resolveHumanPath(Object.keys(files), parent, relative);
}
const triangle = (v: number, low: string, mid: string, high: string) => ({ [low]: Math.max(0, 1 - v * 2), [mid]: 1 - Math.abs(v - 0.5) * 2, [high]: Math.max(0, v * 2 - 1) });
export function macroTargetWeights(paths: string[], profile: HumanProfile): Record<string, number> {
  const m = profile.macro, race = m.race, total = race.african + race.asian + race.caucasian || 1;
  const age = m.age < 0.1875 ? { baby: 1 - m.age / 0.1875, child: m.age / 0.1875, young: 0, old: 0 } : m.age < 0.5 ? { baby: 0, child: 1 - (m.age - 0.1875) / 0.3125, young: (m.age - 0.1875) / 0.3125, old: 0 } : { baby: 0, child: 0, young: 1 - (m.age - 0.5) * 2, old: (m.age - 0.5) * 2 };
  const factors: Record<string, number> = { female: 1 - m.gender, male: m.gender, ...age, african: race.african / total, asian: race.asian / total, caucasian: race.caucasian / total,
    ...triangle(m.muscle, 'minmuscle', 'averagemuscle', 'maxmuscle'), ...triangle(m.weight, 'minweight', 'averageweight', 'maxweight'),
    ...triangle(profile.cupsize, 'mincup', 'averagecup', 'maxcup'), ...triangle(profile.firmness, 'minfirmness', 'averagefirmness', 'maxfirmness'),
    minheight: Math.max(0, 1 - m.height * 2), maxheight: Math.max(0, m.height * 2 - 1), uncommonproportions: Math.max(0, 1 - m.proportions * 2), idealproportions: Math.max(0, m.proportions * 2 - 1) };
  const out: Record<string, number> = { ...profile.targets };
  for (const path of paths) {
    if (!/\.target(?:\.gz)?$/.test(path) || !/targets\/(macrodetails|breast)\//.test(path)) continue;
    const tokens = basename(path).replace(/\.target(?:\.gz)?$/, '').split('-');
    if (!tokens.some(t => t === 'male' || t === 'female')) continue;
    let w = 1;
    for (const t of tokens) if (t in factors) w *= factors[t];
    if (w > 0.00001) out[path] = w;
  }
  return out;
}

function geometry(obj: HumanObj, positions: Float32Array, keep: (face: HumanObj['faces'][number]) => boolean) {
  const p: number[] = [], uv: number[] = [], original: number[] = [], index: number[] = [];
  const byRef = new Map<string, number>();
  for (const face of obj.faces) {
    if (!keep(face)) continue;
    const refs = face.vertices.map((v, i) => {
      const key = `${v}:${face.uv[i]}`;
      if (!byRef.has(key)) { byRef.set(key, original.length); original.push(v); p.push(positions[v * 3] * 0.1, positions[v * 3 + 1] * 0.1, positions[v * 3 + 2] * 0.1); uv.push(...(obj.uv[face.uv[i]] ?? [0, 0])); }
      return byRef.get(key)!;
    });
    for (let i = 1; i < refs.length - 1; i++) index.push(refs[0], refs[i], refs[i + 1]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setAttribute('_mh_vertex', new THREE.Float32BufferAttribute(original, 1)); geo.setIndex(index); geo.computeVertexNormals();
  return geo;
}
function skeleton(obj: HumanObj, positions: Float32Array, rig: HumanRig) {
  const bones = Object.fromEntries(Object.keys(rig).map(name => { const bone = new THREE.Bone(); bone.name = name; return [name, bone]; }));
  const heads = new Map<string, THREE.Vector3>();
  for (const [name, def] of Object.entries(rig)) {
    const ids = def.head.strategy === 'CUBE' ? [...(obj.groups.get(def.head.cube_name ?? '') ?? [])] : def.head.vertex_indices ?? [];
    const head = new THREE.Vector3();
    if (ids.length) { for (const id of ids) head.add(new THREE.Vector3().fromArray(positions, id * 3)); head.multiplyScalar(0.1 / ids.length); }
    else { const p = def.head.default_position; head.set(p[0], p[2], -p[1]); }
    heads.set(name, head);
  }
  const root = new THREE.Group(); root.name = 'MakeHumanRig';
  for (const [name, def] of Object.entries(rig)) {
    const bone = bones[name], parent = bones[def.parent];
    bone.position.copy(heads.get(name)!);
    if (parent) { bone.position.sub(heads.get(def.parent)!); parent.add(bone); } else root.add(bone);
  }
  root.updateMatrixWorld(true);
  return { root, bones: Object.values(bones), skeleton: new THREE.Skeleton(Object.values(bones)) };
}
function skin(geo: THREE.BufferGeometry, weights: Array<Map<number, number>>, indices?: Array<{ vertices: number[]; weights: number[] }>) {
  const original = geo.getAttribute('_mh_vertex'), joint: number[] = [], influence: number[] = [];
  for (let i = 0; i < original.count; i++) {
    const v = original.getX(i), merged = new Map<number, number>();
    const refs = indices?.[v] ?? { vertices: [v], weights: [1] };
    refs.vertices.forEach((vertex, j) => weights[vertex]?.forEach((w, bone) => merged.set(bone, (merged.get(bone) ?? 0) + w * refs.weights[j])));
    const top = [...merged].filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).slice(0, 4), total = top.reduce((n, pair) => n + pair[1], 0) || 1;
    for (let k = 0; k < 4; k++) { joint.push(top[k]?.[0] ?? 0); influence.push(top[k] ? top[k][1] / total : top.length ? 0 : k === 0 ? 1 : 0); }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joint, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(influence, 4));
}

export async function buildHuman(profile: HumanProfile, library?: HumanLibrary, content?: AvatarConfig['content']) {
  const lib = library ?? await get<HumanLibrary>('/api/makehuman');
  if (!lib.core.installed || !lib.system.installed) throw new Error('Install MakeHuman core and system assets first.');
  const files = { ...lib.core.files, ...lib.system.files };
  const read = (path: string) => { if (!files[path]) throw new Error(`MakeHuman asset is not installed: ${path}`); return data(files[path]); };
  const base = parseHumanObj(await read('3dobjs/base.obj'));
  const selected = Object.entries(macroTargetWeights(Object.keys(lib.core.files), profile)).filter(([, value]) => value !== 0);
  const targets = [];
  // Limit concurrent decoding and downloads on phones.
  for (let i = 0; i < selected.length; i += 6) targets.push(...await Promise.all(selected.slice(i, i + 6).map(async ([path, value]) => ({ target: parseTarget(await read(path), base.vertices.length / 3), value }))));
  const body = blendTargets(base.vertices, targets);
  const facialPaths = Object.keys(files).filter(path => /^faceunits\/[^/]+\.target$/.test(path));
  const facialBodies: Array<{ name: string; positions: Float32Array }> = [];
  for (let i = 0; i < facialPaths.length; i += 6) {
    facialBodies.push(...await Promise.all(facialPaths.slice(i, i + 6).map(async path => ({ name: basename(path).replace('.target', ''), positions: blendTargets(body, [{ target: parseTarget(await read(path), body.length / 3), value: 1 }]) }))));
  }
  // The same proxy bindings carry eyelids, brows, lashes and teeth through each
  // expression. Targets stay on the GPU during blinking, lip-sync and emotes.
  const faceMorphs = (geo: THREE.BufferGeometry, rest: Float32Array, bind?: ReturnType<typeof parseProxy>) => {
    const vertex = geo.getAttribute('_mh_vertex'), attributes: THREE.Float32BufferAttribute[] = [];
    for (const face of facialBodies) {
      const moved = bind ? fitProxy(face.positions, bind) : face.positions;
      const delta = new Float32Array(vertex.count * 3); let changed = false;
      for (let i = 0; i < vertex.count; i++) for (let axis = 0; axis < 3; axis++) {
        const v = vertex.getX(i) * 3 + axis, value = (moved[v] - rest[v]) * 0.1;
        delta[i * 3 + axis] = value; if (Math.abs(value) > 1e-7) changed = true;
      }
      if (changed) { const attr = new THREE.Float32BufferAttribute(delta, 3); attr.name = face.name; attributes.push(attr); }
    }
    if (attributes.length) { geo.morphTargetsRelative = true; geo.morphAttributes.position = attributes; }
  };
  const rig = parseHumanRig(await read(profile.rig), base.vertices.length / 3);
  const sk = skeleton(base, body, rig.bones);
  const weightPath = rig.weightsFile ? resolveHumanAsset(files, profile.rig, rig.weightsFile) : profile.rig.replace('/rig.', '/weights.');
  const weightData = JSON.parse(await read(weightPath)).weights as Record<string, Array<[number, number]>>;
  const weights = Array.from({ length: base.vertices.length / 3 }, () => new Map<number, number>());
  sk.bones.forEach((bone, index) => { for (const [vertex, weight] of weightData[bone.name] ?? []) weights[vertex]?.set(index, weight); });
  const scene = new THREE.Group(); scene.name = 'MakeHuman'; scene.add(sk.root);
  // Runtime texture ownership must never become serialized glTF extras.
  Object.defineProperty(scene.userData, 'disposables', { value: [] as THREE.Texture[], writable: true, enumerable: false });
  const hidden = new Set<number>();
  const material = async (path: string, kind: 'skin' | 'hair' | 'cloth' | 'eye') => {
    const spec = parseHumanMaterial(await read(path));
    const texture = async (key: string) => {
      if (typeof spec[key] !== 'string' || !spec[key]) return null;
      const asset = resolveHumanAsset(files, path, spec[key] as string);
      const map: THREE.Texture = await new THREE.TextureLoader().loadAsync(files[asset]);
      const quality = usePrefs3D.getState().quality, max = quality === 'low' ? 512 : quality === 'high' ? 4096 : window.innerWidth < 700 ? 1024 : 2048;
      const image = map.image as HTMLImageElement;
      if (Math.max(image.width, image.height) > max) {
        const canvas = document.createElement('canvas'), scale = max / Math.max(image.width, image.height);
        canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
        const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        map.source.data = canvas; map.needsUpdate = true;
      }
      map.colorSpace = key === 'diffuseTexture' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      ((scene.userData.disposables ??= []) as THREE.Texture[]).push(map);
      return map;
    };
    const map = await texture('diffuseTexture'), normalMap = await texture('normalmapTexture');
    const result = new THREE.MeshPhysicalMaterial({ name: String(spec.name ?? kind), color: Array.isArray(spec.diffuseColor) ? new THREE.Color(...spec.diffuseColor as [number, number, number]) : new THREE.Color(1, 1, 1), map, normalMap, roughness: kind === 'eye' ? 0.12 : kind === 'skin' ? 0.52 : kind === 'hair' ? 0.4 : 0.8, sheen: kind === 'cloth' ? 0.35 : 0, sheenRoughness: 0.7, anisotropy: kind === 'hair' ? 0.6 : 0, clearcoat: kind === 'eye' ? 1 : kind === 'skin' ? 0.08 : 0, clearcoatRoughness: kind === 'eye' ? 0.06 : 0.45, ior: kind === 'eye' ? 1.38 : 1.5, alphaTest: kind === 'hair' ? 0.35 : 0, alphaToCoverage: kind === 'hair', side: kind === 'hair' ? THREE.DoubleSide : THREE.FrontSide });
    if (kind === 'skin') skinDetail(result, scene.userData.disposables as THREE.Texture[]);
    return result;
  };
  const adult = lib.adultEnabled === true && !(content?.age != null && content.age < 18);
  if (!adult && !profile.proxies.some(path => /casualsuit|sportsuit|worksuit|elegantsuit/.test(path))) throw new Error('Choose a starter suit to keep the native character clothed.');
  for (const path of profile.proxies) {
    const proxy = parseProxy(await read(path), base.vertices.length / 3);
    proxy.hidden.forEach(v => hidden.add(v));
    const objPath = resolveHumanAsset(files, path, proxy.obj), obj = parseHumanObj(await read(objPath));
    if (obj.vertices.length / 3 !== proxy.bindings.length) throw new Error(`The garment ${proxy.name} does not match its OBJ vertex count.`);
    const fitted = fitProxy(body, proxy), geo = geometry(obj, fitted, () => true); skin(geo, weights, proxy.bindings); faceMorphs(geo, fitted, proxy);
    const matPath = proxy.material ? resolveHumanAsset(files, path, proxy.material) : null;
    const mesh = new THREE.SkinnedMesh(geo, matPath ? await material(matPath, path.startsWith('eyes/') ? 'eye' : /hair|brow|lash/.test(path) ? 'hair' : 'cloth') : new THREE.MeshStandardMaterial({ color: 0x6b8094, roughness: 0.8 }));
    mesh.name = proxy.name; mesh.userData.makehumanProxy = path; scene.add(mesh);
    if (/^hair\/(?:long|braid|ponytail)/.test(path)) longHairMotion(mesh, scene, sk.skeleton);
    mesh.bind(sk.skeleton);
  }
  const geo = geometry(base, body, face => face.group === 'body' && !face.vertices.some(v => hidden.has(v)));
  skin(geo, weights);
  faceMorphs(geo, body);
  const mesh = new THREE.SkinnedMesh(geo, await material(profile.skin, 'skin')); mesh.name = 'Body'; scene.add(mesh); mesh.bind(sk.skeleton);
  scene.updateMatrixWorld(true);
  return scene;
}
