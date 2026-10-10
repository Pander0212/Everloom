/**
 * Texture files the browser can't show by itself (TGA, Photoshop PSD, DirectDraw DDS, KTX2),
 * turned into PNG so they can be stored and used like any other texture.
 */
import * as THREE from 'three';

export const WEB_IMAGE = /\.(png|jpe?g|webp)$/i;
export const TEXTURE = /\.(png|jpe?g|webp|tga|psd|dds|ktx2)$/i;

function canvasOf(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray, flip = false): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const img = new ImageData(width, height);
  if (!flip) img.data.set(rgba.subarray(0, width * height * 4));
  else for (let y = 0; y < height; y++) img.data.set(rgba.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

const png = (c: HTMLCanvasElement, name: string) =>
  new Promise<File>((resolve, reject) => c.toBlob((b) => (b ? resolve(new File([b], name.replace(/\.[^.]+$/, '.png'), { type: 'image/png' })) : reject(new Error(`${name} could not be converted.`))), 'image/png'));

// BC1-3 (DXT1/3/5) block decoding: what nearly all DDS textures from games and Unity use.
function rgb565(v: number): [number, number, number] {
  return [((v >> 11) & 31) * 255 / 31, ((v >> 5) & 63) * 255 / 63, (v & 31) * 255 / 31];
}
function decodeBC(data: Uint8Array, width: number, height: number, kind: 1 | 3 | 5): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const bw = Math.ceil(width / 4), bh = Math.ceil(height / 4), size = kind === 1 ? 8 : 16;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const o = (by * bw + bx) * size;
    if (o + size > data.length) continue;
    const c = kind === 1 ? o : o + 8;
    const c0 = dv.getUint16(c, true), c1 = dv.getUint16(c + 2, true), bits = dv.getUint32(c + 4, true);
    const p0 = rgb565(c0), p1 = rgb565(c1);
    const pal: number[][] = [[...p0, 255], [...p1, 255]];
    if (c0 > c1 || kind !== 1) {
      pal.push([0, 1, 2].map((i) => (2 * p0[i]! + p1[i]!) / 3).concat(255), [0, 1, 2].map((i) => (p0[i]! + 2 * p1[i]!) / 3).concat(255));
    } else pal.push([0, 1, 2].map((i) => (p0[i]! + p1[i]!) / 2).concat(255), [0, 0, 0, 0]);
    let alpha: number[] | null = null;
    if (kind === 3) {
      alpha = [];
      for (let i = 0; i < 16; i++) alpha.push(((data[o + (i >> 1)]! >> ((i & 1) * 4)) & 15) * 17);
    } else if (kind === 5) {
      const a0 = data[o]!, a1 = data[o + 1]!;
      const ap = [a0, a1];
      if (a0 > a1) for (let i = 1; i < 7; i++) ap.push(((7 - i) * a0 + i * a1) / 7);
      else { for (let i = 1; i < 5; i++) ap.push(((5 - i) * a0 + i * a1) / 5); ap.push(0, 255); }
      let abits = 0n;
      for (let i = 0; i < 6; i++) abits |= BigInt(data[o + 2 + i]!) << BigInt(8 * i);
      alpha = [];
      for (let i = 0; i < 16; i++) alpha.push(ap[Number((abits >> BigInt(3 * i)) & 7n)]!);
    }
    for (let i = 0; i < 16; i++) {
      const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2);
      if (x >= width || y >= height) continue;
      const px = pal[(bits >> (2 * i)) & 3]!;
      const t = (y * width + x) * 4;
      out[t] = px[0]!; out[t + 1] = px[1]!; out[t + 2] = px[2]!; out[t + 3] = alpha ? alpha[i]! : px[3]!;
    }
  }
  return out;
}

async function dds(buf: ArrayBuffer, name: string): Promise<HTMLCanvasElement> {
  const { DDSLoader } = await import('three/examples/jsm/loaders/DDSLoader.js');
  const d = new DDSLoader().parse(buf, false) as unknown as { width: number; height: number; format: number; mipmaps: { data: Uint8Array; width: number; height: number }[] };
  const m = d.mipmaps[0];
  if (!m) throw new Error(`${name} could not be read as a DDS texture.`);
  const kind = d.format === THREE.RGB_S3TC_DXT1_Format ? 1 : d.format === THREE.RGBA_S3TC_DXT3_Format ? 3 : d.format === THREE.RGBA_S3TC_DXT5_Format ? 5 : d.format === THREE.RGBAFormat ? 0 : null;
  if (kind === null) throw new Error(`${name} uses a DDS compression Everloom can't read (BC4–BC7 or ETC). Save it as PNG or TGA in an image editor first.`);
  return canvasOf(m.width, m.height, kind === 0 ? m.data : decodeBC(m.data, m.width, m.height, kind));
}

/** KTX2 (Basis) textures are transcoded on the graphics card and drawn into a canvas. */
async function ktx2(buf: ArrayBuffer, name: string): Promise<HTMLCanvasElement> {
  const { ktx2Loader } = await import('./loader');
  const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), alpha: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
  try {
    const tex = await new Promise<THREE.Texture>((resolve, reject) => ktx2Loader(renderer).parse(buf, resolve as never, reject));
    const img = tex.image as { width: number; height: number };
    const w = Math.min(img.width, 4096), h = Math.min(img.height, 4096);
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 0);
    tex.colorSpace = THREE.NoColorSpace;
    const scene = new THREE.Scene();
    // KTX2 rows run top-down without a flip on upload: the quad's UVs turn it upright.
    const geo = new THREE.PlaneGeometry(2, 2);
    if (!tex.flipY) { const uv = geo.attributes.uv!; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i)); }
    scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.NoBlending })));
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    out.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
    tex.dispose();
    return out;
  } catch (e) {
    throw new Error(`${name} could not be read as a KTX2 texture: ${(e as Error).message}`);
  } finally {
    renderer.dispose();
  }
}

/** The texture as a PNG (PNG, JPEG and WebP are returned unchanged). */
export async function webTexture(file: File): Promise<File> {
  if (WEB_IMAGE.test(file.name)) return file;
  const ext = file.name.split('.').pop()!.toLowerCase();
  const buf = await file.arrayBuffer();
  let canvas: HTMLCanvasElement;
  if (ext === 'tga') {
    const { TGALoader } = await import('three/examples/jsm/loaders/TGALoader.js');
    const t = new TGALoader().parse(buf) as unknown as { data: Uint8Array; width: number; height: number };
    canvas = canvasOf(t.width, t.height, t.data);
  } else if (ext === 'psd') {
    // Photoshop: the flattened image (ag-psd, MIT).
    const { readPsd } = await import('ag-psd');
    const psd = readPsd(buf, { skipLayerImageData: true, skipThumbnail: true });
    if (!psd.canvas) throw new Error(`${file.name} has no flattened image. In Photoshop, save it with "Maximize compatibility" on, or export a PNG.`);
    canvas = psd.canvas as HTMLCanvasElement;
  } else if (ext === 'dds') canvas = await dds(buf, file.name);
  else if (ext === 'ktx2') canvas = await ktx2(buf, file.name);
  else throw new Error(`${file.name}: textures can be PNG, JPEG, WebP, TGA, PSD, DDS or KTX2.`);
  return png(canvas, file.name);
}
