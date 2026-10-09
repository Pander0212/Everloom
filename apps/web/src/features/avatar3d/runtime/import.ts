/** Local browser conversion; companion files never trigger requests to third-party hosts. */
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export const BLEND_HELP = 'Opening a .blend needs Blender, and none was found on your Everloom server. Choose one: install the headless Blender converter (Settings › 3D characters › Blender, about 1 GB of disk and 2 GB of RAM, no graphics card needed); point Everloom at a Blender you already have (the Windows app finds a local Blender by itself); or export the character from Blender as GLB (File › Export › glTF 2.0, with skinning and shape keys) and drop that here.';
export const VROID_HELP = 'This is a VRoid Studio project or custom item, rather than an exported character. Open it in VRoid Studio and export a .vrm, or export the clothing texture as a PNG and add it to a clothing slot.';
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
/** A 1×1 white PNG standing in for a texture that wasn't selected. */
const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
export type ImportProgress = (step: string) => void;

/** Whether an image has cut-out areas: a sample of its pixels (at most 64×64) with some nearly clear. */
function cutOut(image: unknown): boolean {
  const img = image as (CanvasImageSource & { width?: number; height?: number }) | undefined;
  if (!img?.width || !img.height || typeof document === 'undefined') return false;
  const size = 64, c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return false;
  try { g.drawImage(img, 0, 0, size, size); } catch { return false; }
  const data = g.getImageData(0, 0, size, size).data;
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 128) clear++;
  // A few soft edge pixels aren't a cut-out; a tenth of the texture is.
  return clear > (size * size) / 10;
}

/** Names inside a zip (read without unpacking): does it hold a .blend? */
export async function zipHasBlend(f: File): Promise<boolean> {
  const { unzipSync } = await import('fflate');
  let found = false;
  try {
    unzipSync(new Uint8Array(await f.arrayBuffer()), { filter: (e) => { if (/\.blend$/i.test(e.name) && !e.name.startsWith('__MACOSX/')) found = true; return false; } });
  } catch {
    return false;
  }
  return found;
}

export async function browserModel(files: File[], progress: ImportProgress = () => {}): Promise<File> {
  if (!files.length) throw new Error('Choose a model file.');
  if (files.some(f => f.size > MAX_IMPORT_BYTES) || files.reduce((n, f) => n + f.size, 0) > MAX_IMPORT_BYTES) throw new Error('The upload is larger than 200 MB. Choose a smaller export.');
  const main = files.find(f => /\.(vrm|glb|gltf|fbx|pmx|pmd|obj|blend|zip|vroid|vroidcustomitem)$/i.test(f.name)) ?? files[0]!;
  const ext = main.name.split('.').pop()!.toLowerCase();
  // The common upload helper and server open password-protected Everloom exports.
  if (ext === 'evlt') return main;
  if (ext === 'blend' || (ext === 'zip' && await zipHasBlend(main))) {
    // Converted on the server by Blender (meshes, armature, weights, shape keys, materials).
    const info = await fetch('/api/blender', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { found?: boolean } | null;
    if (!info?.found) throw new Error(BLEND_HELP);
    progress('Sending the .blend to Blender on your server…');
    return main;
  }
  if (ext === 'vroid' || ext === 'vroidcustomitem') throw new Error(VROID_HELP);
  if (ext === 'glb' || ext === 'vrm') return main;
  if (!['gltf', 'fbx', 'pmx', 'pmd', 'obj'].includes(ext)) throw new Error('Unsupported model. Choose VRM, GLB, glTF, FBX, PMX, PMD or OBJ. Select any textures and companion files together.');
  progress(`Reading ${ext.toUpperCase()} in this browser…`);
  const urls: string[] = [];
  const byPath = new Map<string, File>();
  const normalize = (s: string) => decodeURIComponent(s).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  for (const f of files) { byPath.set(normalize(f.webkitRelativePath || f.name), f); byPath.set(normalize(f.name), f); }
  const manager = new THREE.LoadingManager();
  let started = false;
  let resourceError: string | null = null;
  let completed: () => void = () => {};
  const resources = new Promise<void>(resolve => { completed = resolve; });
  const start = manager.itemStart.bind(manager);
  manager.itemStart = url => { started = true; start(url); };
  manager.onLoad = () => completed();
  manager.onError = url => { resourceError = `A companion texture could not be read: ${url.startsWith('blob:') ? 'local image' : url.slice(0, 160)}`; };
  // Textures the file names but that weren't selected: the model still comes in (with a plain
  // placeholder), and the owner is told which ones to add.
  const missing = new Set<string>();
  manager.setURLModifier(url => {
    if (/^(blob:|data:)/.test(url)) return url;
    const n = normalize(url);
    const f = byPath.get(n) ?? byPath.get(n.split('/').pop()!);
    if (!f) {
      if (/\.(png|jpe?g|tga|tiff?|bmp|webp|dds|gif)$/i.test(n)) { missing.add(n.split('/').pop()!); return PLACEHOLDER; }
      throw new Error(`Missing companion file: ${n.slice(0, 160)}. Select the model and its files together.`);
    }
    const local = URL.createObjectURL(f); urls.push(local); return local;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = async () => {
      const bytes = await main.arrayBuffer();
      let scene: THREE.Object3D;
      let animations: THREE.AnimationClip[] = [];
      if (ext === 'fbx') {
        const group = new FBXLoader(manager).parse(bytes, ''); scene = group; animations = group.animations;
        // In Blender and Unity a connected colour texture replaces the diffuse colour; FBX files often
        // keep a dark leftover colour that would otherwise multiply the texture.
        group.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshPhongMaterial[]) if (mat.map && mat.color) mat.color.setRGB(1, 1, 1); });
      }
      else if (ext === 'obj') {
        const loader = new OBJLoader(manager);
        const material = files.find(f => /\.mtl$/i.test(f.name));
        if (material) { const creator = new MTLLoader(manager).parse(await material.text(), ''); creator.preload(); loader.setMaterials(creator); }
        scene = loader.parse(await main.text());
      } else if (ext === 'gltf') {
        const { loaderFor } = await import('./loader');
        const gltf = await loaderFor(null, manager).parseAsync(bytes, ''); scene = gltf.scene; animations = gltf.animations;
      } else {
        const { MMDLoader } = await import('./vendor/MMDLoader.js');
        const url = URL.createObjectURL(main); urls.push(url);
        scene = await new MMDLoader(manager).setResourcePath('./').loadAsync(url);
        // MMD's shader cannot be exported to glTF. Preserve colour, alpha and texture in PBR.
        scene.traverse(o => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const convert = (mat: THREE.Material) => {
            const src = mat as THREE.MeshPhongMaterial;
            return new THREE.MeshStandardMaterial({ name: mat.name, color: src.color ?? 0xffffff, map: src.map, opacity: src.opacity, transparent: src.transparent, alphaTest: src.alphaTest, side: src.side, roughness: 0.8 });
          };
          m.material = Array.isArray(m.material) ? m.material.map(convert) : convert(m.material);
        });
      }
      if (started) await resources;
      if (resourceError) throw new Error(resourceError);
      // glTF has no emissive strength below 1: an FBX "white emissive at factor 0" would export as a
      // glowing white garment. Bake the strength into the colour.
      scene.traverse(o => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
          if (!mat.emissive) continue;
          const k = mat.emissiveIntensity ?? 1;
          if (k < 1) { mat.emissive.multiplyScalar(Math.max(0, k)); mat.emissiveIntensity = 1; }
        }
      });
      // OBJ/MTL and FBX rarely say a texture is cut out (hair cards, lace, leaves): a colour texture
      // with real transparency becomes alpha-tested and two-sided, so it exports as glTF's MASK.
      if (ext === 'obj' || ext === 'fbx') scene.traverse(o => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
          if (!mat.map || mat.transparent || mat.alphaTest > 0 || !cutOut(mat.map.image)) continue;
          mat.alphaTest = 0.5; mat.side = THREE.DoubleSide; mat.needsUpdate = true;
        }
      });
      if (missing.size) {
        // Placeholders aren't worth keeping: the material falls back to its own colour.
        scene.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; for (const mat of Array.isArray(m.material) ? m.material : [m.material]) for (const [k, v] of Object.entries(mat)) if ((v as THREE.Texture | null)?.isTexture && /^data:image\/png;base64,iVBORw0KGgo/.test(((v as THREE.Texture).image as HTMLImageElement | undefined)?.src ?? '')) (mat as unknown as Record<string, unknown>)[k] = null; });
        progress(`Imported without ${missing.size} texture${missing.size === 1 ? '' : 's'} (${[...missing].slice(0, 4).join(', ')}). Select them with the model, or set them later in Materials.`);
      }
      progress('Packing meshes, skeleton and textures into GLB…');
      const out = await new GLTFExporter().parseAsync(scene, { binary: true, animations, onlyVisible: true });
      const file = new File([out as ArrayBuffer], main.name.replace(/\.[^.]+$/, '.glb'), { type: 'model/gltf-binary' }) as File & { missingTextures?: string[] };
      file.missingTextures = [...missing];
      return file;
    };
    return await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Browser conversion timed out after 90 seconds. Try a smaller file or export GLB from the source tool.')), 90000); })]);
  } finally { clearTimeout(timer); urls.forEach(url => URL.revokeObjectURL(url)); }
}
