/**
 * Makes a model ready for phones: smaller textures (KTX2, which stays compressed on the graphics
 * card, or WebP when that isn't possible), compressed geometry (meshopt), duplicates and unused
 * data removed, and a low-detail version (simplified meshes, 512px textures) for weak devices.
 *
 * Plain GLB goes through glTF-Transform. VRM keeps its file exactly as written apart from the
 * texture bytes, because a general glTF library would drop the VRM extensions.
 */
import { Document, Logger, NodeIO, type Texture, type Transform } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP, KHRTextureBasisu } from '@gltf-transform/extensions';
import { dedup, getTextureColorSpace, listTextureSlots, meshopt, prune, resample, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { parseGlb, replaceViews, viewBytes, writeGlb } from './glb.js';
import type { ModelFormat } from './inspect.js';

export interface OptimizeOptions {
  format: ModelFormat;
  /** Largest texture side for the main version. */
  maxTexture?: number;
  /** KTX2 textures (off: WebP). */
  ktx2?: boolean;
  /** Seconds to spend on KTX2 before the remaining textures fall back to WebP. */
  ktx2Budget?: number;
  /** Simplification ratio for the low-detail version. */
  lowRatio?: number;
}

export interface OptimizeResult {
  main: Buffer;
  low: Buffer;
  report: { before: number; after: number; low: number; textures: string; ktx2: number; webp: number; ms: number; notes: string[] };
}

type Encoded = { data: Buffer; mime: 'image/ktx2' | 'image/webp' | 'image/png' | 'image/jpeg' };

/** The Basis encoder prints progress to stdout; keep it out of the server log. */
async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const write = process.stdout.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    return await fn();
  } finally {
    process.stdout.write = write;
  }
}

let encodeKtx2: ((b: Uint8Array, o: Record<string, unknown>) => Promise<Uint8Array>) | null | undefined;
async function ktx2Encoder() {
  if (encodeKtx2 === undefined) {
    try {
      encodeKtx2 = (await import('ktx2-encoder')).encodeToKTX2 as never;
    } catch {
      encodeKtx2 = null;
    }
  }
  return encodeKtx2;
}

const imageDecoder = async (buf: Uint8Array) => {
  const { data, info } = await sharp(Buffer.from(buf)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
};

interface TexJob {
  data: Buffer;
  maxDim: number;
  /** Normal maps and other data textures need the higher-quality mode and no sRGB. */
  linear: boolean;
  normal: boolean;
  deadline: number;
  allowKtx2: boolean;
}

/** One texture: resized to fit, then KTX2 (before the deadline) or WebP. */
async function encodeTexture(t: TexJob): Promise<Encoded> {
  const img = sharp(t.data, { limitInputPixels: 64_000_000 });
  const md = await img.metadata();
  const w = md.width ?? 0;
  const h = md.height ?? 0;
  const scale = Math.min(1, t.maxDim / Math.max(w, h, 1));
  // Power-of-two sides keep mipmaps clean and are required by some phones for KTX2.
  const pot = (n: number) => 2 ** Math.max(2, Math.round(Math.log2(Math.max(4, n))));
  const tw = Math.min(pot(w * scale), t.maxDim);
  const th = Math.min(pot(h * scale), t.maxDim);
  const resized = await sharp(t.data).resize(tw, th, { fit: 'fill' }).png().toBuffer();
  const enc = t.allowKtx2 && Date.now() < t.deadline ? await ktx2Encoder() : null;
  if (enc) {
    try {
      const out = await quiet(() =>
        enc(new Uint8Array(resized), t.normal ? { isUASTC: true, uastcLDRQualityLevel: 1, needSupercompression: true, generateMipmap: true, isNormalMap: true, isKTX2File: true, isSetKTX2SRGBTransferFunc: false, imageDecoder } : { isUASTC: false, qualityLevel: 160, compressionLevel: 2, generateMipmap: true, isKTX2File: true, isSetKTX2SRGBTransferFunc: !t.linear, imageDecoder }),
      );
      if (out.length > 32) return { data: Buffer.from(out), mime: 'image/ktx2' };
    } catch {
      /* fall through to WebP */
    }
  }
  const alpha = md.hasAlpha === true;
  // Data textures (normals, roughness) stay lossless; colour textures use quality 88.
  return { data: await sharp(resized).webp(t.linear ? { lossless: true } : { quality: 88, alphaQuality: alpha ? 95 : 100 }).toBuffer(), mime: 'image/webp' };
}

function textureTransform(maxDim: number, opts: { ktx2: boolean; deadline: number }, counts: { ktx2: number; webp: number }): Transform {
  const fn = async (doc: Document) => {
    const basisu = doc.createExtension(KHRTextureBasisu);
    const webp = doc.createExtension(EXTTextureWebP);
    let usedKtx2 = false;
    let usedWebp = false;
    for (const tex of doc.getRoot().listTextures()) {
      const image = tex.getImage();
      if (!image || !/png|jpeg|webp/.test(tex.getMimeType())) continue;
      const slots = listTextureSlots(tex);
      const normal = slots.some((s) => /normal/i.test(s));
      const linear = getTextureColorSpace(tex) !== 'srgb';
      const out = await encodeTexture({ data: Buffer.from(image), maxDim, linear, normal, deadline: opts.deadline, allowKtx2: opts.ktx2 });
      setImage(tex, out);
      if (out.mime === 'image/ktx2') (usedKtx2 = true), counts.ktx2++;
      else (usedWebp = true), counts.webp++;
    }
    if (usedKtx2) basisu.setRequired(true);
    else basisu.dispose();
    if (usedWebp) webp.setRequired(true);
    else webp.dispose();
  };
  Object.defineProperty(fn, 'name', { value: 'everloomTextures' });
  return fn;
}
function setImage(tex: Texture, out: Encoded) {
  tex.setImage(new Uint8Array(out.data));
  tex.setMimeType(out.mime);
  const uri = tex.getURI();
  if (uri) tex.setURI(uri.replace(/\.\w+$/, out.mime === 'image/ktx2' ? '.ktx2' : '.webp'));
}

const QUIET = new Logger(Logger.Verbosity.ERROR);

async function io() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  return new NodeIO().setLogger(QUIET).registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

async function optimizeGlb(bytes: Buffer, o: Required<Omit<OptimizeOptions, 'format'>>, notes: string[], counts: { ktx2: number; webp: number }) {
  const nio = await io();
  const deadline = Date.now() + o.ktx2Budget * 1000;
  const base = [dedup(), prune({ keepLeaves: true, keepExtras: true }), resample()];
  const main = await nio.readBinary(new Uint8Array(bytes));
  main.setLogger(QUIET);
  await main.transform(...base, textureTransform(o.maxTexture, { ktx2: o.ktx2, deadline }, counts), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const mainOut = Buffer.from(await nio.writeBinary(main));

  const lowCounts = { ktx2: 0, webp: 0 };
  const low = await nio.readBinary(new Uint8Array(bytes));
  low.setLogger(QUIET);
  try {
    await low.transform(...base, weld(), simplify({ simplifier: MeshoptSimplifier, ratio: o.lowRatio, error: 0.002, lockBorder: true }), textureTransform(512, { ktx2: o.ktx2, deadline: Date.now() + 60_000 }, lowCounts), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  } catch (e) {
    notes.push(`Low-detail simplification skipped: ${(e as Error).message}`);
  }
  const lowOut = Buffer.from(await nio.writeBinary(low));
  return { main: mainOut, low: lowOut };
}

/** VRM: only the texture bytes change; every extension, node and material stays as written. */
async function optimizeVrm(bytes: Buffer, o: Required<Omit<OptimizeOptions, 'format'>>, counts: { ktx2: number; webp: number }, maxDim: number, allowKtx2: boolean) {
  const g = parseGlb(bytes);
  const json = g.json;
  const replace = new Map<number, Buffer>();
  const deadline = Date.now() + o.ktx2Budget * 1000;
  // Which images are normal maps (by material slot) or data (not colour).
  const normalImages = new Set<number>();
  const colorImages = new Set<number>();
  const texSource = (ti: number | undefined) => (ti === undefined ? undefined : json.textures?.[ti]?.source);
  for (const m of (json.materials ?? []) as Array<Record<string, any>>) {
    const n = texSource(m.normalTexture?.index);
    if (n !== undefined) normalImages.add(n);
    for (const k of ['baseColorTexture']) {
      const s = texSource(m.pbrMetallicRoughness?.[k]?.index);
      if (s !== undefined) colorImages.add(s);
    }
    const e = texSource(m.emissiveTexture?.index);
    if (e !== undefined) colorImages.add(e);
    // MToon (VRM 1.0) colour slots.
    const mt = m.extensions?.VRMC_materials_mtoon;
    for (const k of ['shadeMultiplyTexture', 'matcapTexture', 'rimMultiplyTexture']) {
      const s = texSource(mt?.[k]?.index);
      if (s !== undefined) colorImages.add(s);
    }
  }
  // VRM 0.x MToon keeps texture indices in its own material list.
  for (const m of (json.extensions?.VRM?.materialProperties ?? []) as Array<{ textureProperties?: Record<string, number> }>) {
    for (const [k, ti] of Object.entries(m.textureProperties ?? {})) {
      const s = texSource(ti);
      if (s === undefined) continue;
      if (/BumpMap|Normal/i.test(k)) normalImages.add(s);
      else if (/MainTex|ShadeTexture|SphereAdd|RimTexture|EmissionMap/.test(k)) colorImages.add(s);
    }
  }
  const thumb = new Set<number>();
  const metaTex = json.extensions?.VRMC_vrm?.meta?.thumbnailImage ?? texSource(json.extensions?.VRM?.meta?.texture);
  if (typeof metaTex === 'number') thumb.add(metaTex);
  const ktx2Images = new Set<number>();
  for (const [i, img] of (json.images ?? []).entries()) {
    if (img.bufferView === undefined || !/png|jpeg/.test(img.mimeType ?? '')) continue;
    const isThumb = thumb.has(i);
    const out = await encodeTexture({
      data: Buffer.from(viewBytes(g, img.bufferView)),
      maxDim: isThumb ? 256 : maxDim,
      linear: !colorImages.has(i) && !isThumb,
      normal: normalImages.has(i),
      deadline,
      // The thumbnail is read as a plain image by other apps; keep it one.
      allowKtx2: allowKtx2 && !isThumb,
    });
    // VRM 0.x readers don't know WebP: keep PNG/JPEG when KTX2 isn't used.
    let data = out.data;
    let mime: string = out.mime;
    if (mime === 'image/webp') {
      const png = img.mimeType === 'image/jpeg' ? await sharp(out.data).jpeg({ quality: 88 }).toBuffer() : await sharp(out.data).png({ compressionLevel: 9, palette: false }).toBuffer();
      data = png;
      mime = img.mimeType!;
      counts.webp++;
    } else counts.ktx2++;
    replace.set(img.bufferView, data);
    if (mime === 'image/ktx2') ktx2Images.add(i);
    img.mimeType = mime;
  }
  if (ktx2Images.size) {
    for (const t of json.textures ?? []) {
      if (t.source === undefined || !ktx2Images.has(t.source)) continue;
      t.extensions = { ...(t.extensions ?? {}), KHR_texture_basisu: { source: t.source } };
      delete t.source;
    }
    json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'KHR_texture_basisu'])];
    json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), 'KHR_texture_basisu'])];
  }
  return writeGlb(replaceViews(g, replace));
}

export async function optimizeModel(bytes: Buffer, opts: OptimizeOptions): Promise<OptimizeResult> {
  const t0 = Date.now();
  const o = { maxTexture: opts.maxTexture ?? 2048, ktx2: opts.ktx2 ?? true, ktx2Budget: opts.ktx2Budget ?? 120, lowRatio: opts.lowRatio ?? 0.5 };
  const notes: string[] = [];
  const counts = { ktx2: 0, webp: 0 };
  let main: Buffer;
  let low: Buffer;
  if (opts.format === 'glb') ({ main, low } = await optimizeGlb(bytes, o, notes, counts));
  else {
    main = await optimizeVrm(bytes, o, counts, o.maxTexture, o.ktx2);
    low = await optimizeVrm(bytes, { ...o, ktx2Budget: 60 }, { ktx2: 0, webp: 0 }, 512, o.ktx2);
    notes.push('VRM geometry is kept as written (only textures were recompressed), so its expressions, springs and materials survive.');
  }
  // Never make a model bigger than it was.
  if (main.length > bytes.length && opts.format !== 'glb') {
    main = bytes;
    notes.push('The original was already smaller; it is used as is.');
  }
  const kinds = [counts.ktx2 && `${counts.ktx2} KTX2`, counts.webp && `${counts.webp} ${opts.format === 'glb' ? 'WebP' : 'PNG/JPEG'}`].filter(Boolean).join(', ');
  return { main, low, report: { before: bytes.length, after: main.length, low: low.length, textures: kinds || 'none', ktx2: counts.ktx2, webp: counts.webp, ms: Date.now() - t0, notes } };
}
