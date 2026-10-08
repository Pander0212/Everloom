/**
 * Skin layers, baked: the body's skin texture is copied once (whatever its format, KTX2 included, by
 * drawing it through the GPU), then a skin tone and the layer stack (makeup, paint, tattoos, tight
 * clothing, stockings, scars) are painted over it on a canvas, and the result replaces the skin's
 * colour map. It's redone only when the stack changes, so layers cost nothing per frame. Decals are
 * stamped in texture space, so they bend with every pose, slider and animation like the skin itself.
 *
 * Also here: hair colour (a root-to-tip gradient and a highlight) and eye colour, set on materials.
 */
import * as THREE from 'three';
import { stackOrder, type Appearance, type Decal, type SkinLayer } from '@everloom/engine';
import { NOT_SKIN } from './fit/extract';

export interface ImageSource { width: number; height: number }
type Canvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const canvas = (w: number, h: number): Canvas => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
const ctx2d = (c: Canvas) => c.getContext('2d') as Ctx;

/**
 * The canvas transform that stamps a decal image (iw × ih pixels) into a texture (W × H) at the
 * decal's spot: centred there, `size` cm wide on the skin, turned by `rotation` degrees.
 * Returns [a, b, c, d, e, f] for setTransform.
 */
export function decalTransform(decal: Pick<Decal, 'u' | 'v' | 'size' | 'rotation' | 'right' | 'up'>, iw: number, ih: number, W: number, H: number): [number, number, number, number, number, number] {
  const sizeW = decal.size, sizeH = decal.size * (ih / iw);
  const t = (decal.rotation * Math.PI) / 180, cos = Math.cos(t), sin = Math.sin(t);
  const map = (px: number, py: number) => {
    // Image pixels → centimetres on the skin (image y runs down, the skin's up runs up), turned.
    const x = (px / iw - 0.5) * sizeW, y = (0.5 - py / ih) * sizeH;
    const xr = x * cos + y * sin, yr = -x * sin + y * cos;
    const u = decal.u + decal.right[0] * xr + decal.up[0] * yr;
    const v = decal.v + decal.right[1] * xr + decal.up[1] * yr;
    return [u * W, v * H] as const;
  };
  const [ox, oy] = map(0, 0), [ax, ay] = map(1, 0), [bx, by] = map(0, 1);
  return [ax - ox, ay - oy, bx - ox, by - oy, ox, oy];
}

/** Paints the stack onto a copy of the base image. Exported for tests (works on any 2D context). */
export function paintStack(ctx: Ctx, W: number, H: number, base: CanvasImageSource | null, tone: string | null, layers: Array<{ layer: SkinLayer; image: CanvasImageSource & ImageSource | null }>) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  if (base) ctx.drawImage(base, 0, 0, W, H);
  else { ctx.fillStyle = '#e6c2a8'; ctx.fillRect(0, 0, W, H); }
  if (tone) {
    // A multiplied wash keeps the skin's detail.
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = tone;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }
  for (const { layer, image } of layers) {
    ctx.globalAlpha = layer.opacity;
    let src: CanvasImageSource & ImageSource | null = image;
    if (src && layer.tint) src = tinted(src, layer.tint);
    if (!src) {
      if (!layer.tint) continue;
      // A plain tint over the whole body (a paint wash).
      ctx.fillStyle = layer.tint;
      ctx.fillRect(0, 0, W, H);
    } else if (layer.decal) {
      ctx.setTransform(...decalTransform(layer.decal, src.width, src.height, W, H));
      ctx.drawImage(src, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else ctx.drawImage(src, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

/** The image multiplied by a colour, keeping its transparency. */
function tinted(image: CanvasImageSource & ImageSource, tint: string): Canvas {
  const c = canvas(image.width, image.height), g = ctx2d(c);
  g.drawImage(image, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = tint;
  g.fillRect(0, 0, image.width, image.height);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(image, 0, 0);
  return c;
}

/** Any texture (compressed ones too) as plain sRGB pixels, by drawing it through the GPU. */
export function textureToCanvas(renderer: THREE.WebGLRenderer, texture: THREE.Texture, maxSize: number): Canvas {
  const img = texture.image as ImageSource | undefined;
  const w0 = img?.width || (texture as THREE.CompressedTexture).mipmaps?.[0]?.width || 1024, h0 = img?.height || (texture as THREE.CompressedTexture).mipmaps?.[0]?.height || 1024;
  const scale = Math.min(1, maxSize / Math.max(w0, h0));
  const W = Math.max(1, Math.round(w0 * scale)), H = Math.max(1, Math.round(h0 * scale));
  const target = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, colorSpace: THREE.NoColorSpace, depthBuffer: false });
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: texture }, srgb: { value: texture.colorSpace === THREE.SRGBColorSpace ? 1 : 0 }, flip: { value: texture.flipY ? 1 : 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }',
    // Sampling an sRGB texture gives linear values: encode back, so the canvas holds the file's own colours.
    fragmentShader: 'uniform sampler2D map; uniform float srgb; uniform float flip; varying vec2 vUv; vec3 enc(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); } void main() { vec2 uv = vec2(vUv.x, flip > 0.5 ? 1.0 - vUv.y : vUv.y); vec4 t = texture2D(map, uv); gl_FragColor = vec4(srgb > 0.5 ? enc(t.rgb) : t.rgb, t.a); }',
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  const scene = new THREE.Scene(); scene.add(quad);
  const camera = new THREE.Camera();
  const prevTarget = renderer.getRenderTarget(), prevColorSpace = renderer.outputColorSpace, prevTone = renderer.toneMapping;
  const pixels = new Uint8Array(W * H * 4);
  try {
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, W, H, pixels);
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.outputColorSpace = prevColorSpace;
    renderer.toneMapping = prevTone;
    target.dispose(); material.dispose(); quad.geometry.dispose();
  }
  const out = canvas(W, H), g = ctx2d(out);
  // Rows are read bottom-up, and the quad drew the image's first row at the bottom: canvas row r is image row r.
  g.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), W, H), 0, 0);
  return out;
}

const imageCache = new Map<string, Promise<ImageBitmap | null>>();
async function loadImage(media: string | null): Promise<ImageBitmap | null> {
  if (!media) return null;
  let p = imageCache.get(media);
  if (!p) {
    p = fetch(`/media/${media}`, { credentials: 'same-origin' }).then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? createImageBitmap(b) : null)).catch(() => null);
    imageCache.set(media, p);
  }
  return p;
}

interface SkinTarget { material: THREE.MeshStandardMaterial; original: THREE.Texture | null; base: Canvas | null; baked: THREE.CanvasTexture | null }

/** Paints skin layers onto an avatar's skin materials. */
export class SkinPainter {
  private targets: SkinTarget[] = [];
  private key = '';
  private seq = 0;

  constructor(private root: THREE.Object3D, private renderer: THREE.WebGLRenderer | null, private maxSize = 2048) {}

  /** The skin materials: of the listed meshes, else every skinned mesh that isn't eyes, hair or teeth. */
  private skin(meshNames: readonly string[]) {
    const mats = new Set<THREE.MeshStandardMaterial>();
    this.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh || /^garment:/.test(m.parent?.name ?? '')) return;
      if (meshNames.length ? !meshNames.includes(m.name) : !m.isSkinnedMesh || NOT_SKIN.test(m.name)) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) if ('map' in mat) mats.add(mat as THREE.MeshStandardMaterial);
    });
    return [...mats];
  }

  /** Bakes the tone and layers (or restores the plain skin when there are none). */
  async apply(layers: readonly SkinLayer[], tone: string | null, meshNames: readonly string[]) {
    const key = JSON.stringify([layers, tone, meshNames]);
    if (key === this.key) return;
    this.key = key;
    const ticket = ++this.seq;
    const mats = this.skin(meshNames);
    for (const m of mats) if (!this.targets.some((t) => t.material === m)) this.targets.push({ material: m, original: m.map, base: null, baked: null });
    const ordered = stackOrder(layers);
    const images = await Promise.all(ordered.map((l) => loadImage(l.image)));
    if (ticket !== this.seq) return;
    for (const t of this.targets) {
      if (!ordered.length && !tone) { this.restore(t); continue; }
      if (!t.base && t.original && this.renderer) {
        try { t.base = textureToCanvas(this.renderer, t.original, this.maxSize); } catch { t.base = null; }
      }
      const W = t.base?.width ?? Math.min(this.maxSize, 1024), H = t.base?.height ?? Math.min(this.maxSize, 1024);
      const out = t.baked?.image as Canvas | undefined;
      const c = out && out.width === W && out.height === H ? out : canvas(W, H);
      paintStack(ctx2d(c), W, H, t.base, tone, ordered.map((layer, i) => ({ layer, image: images[i] ?? null })));
      if (!t.baked || t.baked.image !== c) {
        t.baked?.dispose();
        t.baked = new THREE.CanvasTexture(c as HTMLCanvasElement);
        t.baked.colorSpace = THREE.SRGBColorSpace;
        t.baked.flipY = false;
        t.baked.wrapS = t.original?.wrapS ?? THREE.RepeatWrapping;
        t.baked.wrapT = t.original?.wrapT ?? THREE.RepeatWrapping;
        t.baked.anisotropy = 4;
        // Without a map before, the material's colour was the skin: the baked texture carries it now.
        if (!t.original) t.material.color.set('#ffffff');
      }
      t.baked.needsUpdate = true;
      t.material.map = t.baked;
      t.material.needsUpdate = true;
    }
  }

  private restore(t: SkinTarget) {
    if (t.material.map === t.baked) t.material.map = t.original;
    t.baked?.dispose();
    t.baked = null;
    t.material.needsUpdate = true;
  }

  dispose() {
    this.seq++;
    for (const t of this.targets) this.restore(t);
    this.targets = [];
    this.key = '';
  }
}

/** Hair: a colour, an optional tip colour (a root-to-tip gradient by height) and a highlight. */
export function applyHairColour(root: THREE.Object3D, hair: Appearance['hair']) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && (hair.meshes.length ? hair.meshes.includes(m.name) || hair.meshes.includes(m.parent?.name ?? '') : /hair|ponytail|braid|bang|髪/i.test(m.name) && !/brow|lash/i.test(m.name))) meshes.push(m);
  });
  for (const m of meshes) {
    m.geometry.computeBoundingBox();
    const box = m.geometry.boundingBox!;
    for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
      const ud = mat.userData as { hairBase?: THREE.Color; hairUniforms?: Record<string, THREE.IUniform> };
      ud.hairBase ??= mat.color?.clone() ?? new THREE.Color(1, 1, 1);
      const root = hair.color ? new THREE.Color(hair.color) : ud.hairBase;
      const tip = hair.tip ? new THREE.Color(hair.tip) : root;
      if (!mat.color) continue;
      mat.color.copy(hair.tip ? new THREE.Color(1, 1, 1) : root);
      if (hair.tip) {
        if (!ud.hairUniforms) {
          ud.hairUniforms = { hairRoot: { value: root.clone() }, hairTip: { value: tip.clone() }, hairTop: { value: box.max.y }, hairBottom: { value: box.min.y } };
          const uniforms = ud.hairUniforms;
          mat.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, uniforms);
            shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float hairTop; uniform float hairBottom; varying float vHairT;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvHairT = clamp((hairTop - position.y) / max(1e-5, hairTop - hairBottom), 0.0, 1.0);');
            shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 hairRoot; uniform vec3 hairTip; varying float vHairT;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(hairRoot, hairTip, smoothstep(0.15, 0.95, vHairT));');
          };
          mat.customProgramCacheKey = () => 'everloom-hair-gradient';
          mat.needsUpdate = true;
        } else {
          (ud.hairUniforms.hairRoot!.value as THREE.Color).copy(root);
          (ud.hairUniforms.hairTip!.value as THREE.Color).copy(tip);
        }
      } else if (ud.hairUniforms) {
        mat.onBeforeCompile = () => {};
        mat.customProgramCacheKey = () => 'everloom-hair-plain';
        ud.hairUniforms = undefined;
        mat.needsUpdate = true;
      }
      // The highlight: a sheen on realistic hair, the rim on toon hair.
      const physical = mat as unknown as THREE.MeshPhysicalMaterial;
      if ('sheen' in physical && physical.isMeshPhysicalMaterial) { physical.sheen = hair.highlight ? 0.8 : 0; if (hair.highlight) physical.sheenColor.set(hair.highlight); }
      const toon = mat as unknown as { parametricRimColorFactor?: THREE.Color; parametricRimFresnelPowerFactor?: number };
      if (toon.parametricRimColorFactor) { toon.parametricRimColorFactor.set(hair.highlight ?? '#000000'); toon.parametricRimFresnelPowerFactor = 3; }
    }
  }
  return meshes.length;
}

/** Eyes: the iris colour on the eye meshes (an "iris" mesh if there is one, else the eyes). */
export function applyEyeColour(root: THREE.Object3D, eyes: Appearance['eyes']) {
  const all: THREE.Mesh[] = [];
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) all.push(m); });
  const named = eyes.meshes.length ? all.filter((m) => eyes.meshes.includes(m.name)) : all.filter((m) => /iris|pupil/i.test(m.name));
  const meshes = named.length ? named : all.filter((m) => /eye/i.test(m.name) && !/brow|lash|lid/i.test(m.name));
  for (const m of meshes) for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
    if (!mat.color) continue;
    const ud = mat.userData as { eyeBase?: THREE.Color };
    ud.eyeBase ??= mat.color.clone();
    mat.color.copy(eyes.color ? new THREE.Color(eyes.color) : ud.eyeBase);
  }
  return meshes.length;
}
