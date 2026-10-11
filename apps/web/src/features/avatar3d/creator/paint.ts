/**
 * The creator's textures, painted in code: the skin (tone, blush, lips, eye shadow, eyeliner,
 * eyebrows, nails) in the body's own UV layout, and anime eyes. Regions come from the base itself:
 * the lips are where the pucker shape key moves the face, the eyelids where the blink keys do, the
 * cheeks and brows sit at fixed offsets from the eyes, nails on the last finger segments.
 */
import * as THREE from 'three';
import type { CharacterSpec } from '@everloom/engine';

export const SKIN_SIZE = 1024;

/** Where things are on this base, measured once from its rest shape. */
export interface Landmarks {
  eyes: { l: THREE.Vector3; r: THREE.Vector3; radius: number };
  /** Per body vertex, 0…1: lips, upper eyelids, nails. */
  lips: Float32Array;
  lids: Float32Array;
  nails: Float32Array;
}

const colour = (hex: string) => new THREE.Color(hex);

function morphMagnitude(body: THREE.SkinnedMesh, names: string[]): Float32Array {
  const n = body.geometry.attributes.position!.count;
  const out = new Float32Array(n);
  const dict = body.morphTargetDictionary ?? {};
  for (const name of names) {
    const i = dict[name];
    const a = i !== undefined ? body.geometry.morphAttributes.position?.[i] : undefined;
    if (!a) continue;
    for (let v = 0; v < n; v++) out[v] = Math.max(out[v]!, Math.hypot(a.getX(v), a.getY(v), a.getZ(v)));
  }
  let max = 0;
  for (const x of out) max = Math.max(max, x);
  if (max > 0) for (let v = 0; v < n; v++) out[v] /= max;
  return out;
}

export function measure(body: THREE.SkinnedMesh, eyes: THREE.Mesh): Landmarks {
  const p = eyes.geometry.attributes.position!;
  const l = new THREE.Vector3(), r = new THREE.Vector3();
  let nl = 0, nr = 0, radius = 0;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); if (x > 0) { l.x += x; l.y += p.getY(i); l.z += p.getZ(i); nl++; } else { r.x += x; r.y += p.getY(i); r.z += p.getZ(i); nr++; } }
  l.divideScalar(Math.max(1, nl)); r.divideScalar(Math.max(1, nr));
  for (let i = 0; i < p.count; i++) { const c = p.getX(i) > 0 ? l : r; radius = Math.max(radius, Math.hypot(p.getX(i) - c.x, p.getY(i) - c.y, p.getZ(i) - c.z)); }
  // The lips: what the pucker moves, kept to the mouth (near the middle, below the eyes).
  const lips = morphMagnitude(body, ['mouthPucker', 'mouthFunnel']);
  const bp = body.geometry.attributes.position!;
  const eyeY = (l.y + r.y) / 2, iod = l.x - r.x;
  for (let v = 0; v < bp.count; v++) {
    const x = bp.getX(v), y = bp.getY(v);
    const inMouth = Math.abs(x) < iod * 0.42 && y < eyeY - iod * 0.8 && y > eyeY - iod * 1.2;
    lips[v] = inMouth ? Math.min(1, Math.max(0, (lips[v]! - 0.72) / 0.15)) : 0;
  }
  // The upper eyelids: what blinking moves, above the eye's centre.
  const lids = morphMagnitude(body, ['eyeBlinkLeft', 'eyeBlinkRight']);
  for (let v = 0; v < bp.count; v++) lids[v] = bp.getY(v) > eyeY - radius * 0.1 ? Math.min(1, lids[v]! * 1.4) : 0;
  // Nails: the last segment of each finger, on the back of the hand.
  const nails = new Float32Array(bp.count);
  const bones = body.skeleton.bones;
  const tips = new Set(bones.map((b, i) => (/_03_[lr]$/.test(b.name) ? i : -1)).filter((i) => i >= 0));
  const si = body.geometry.attributes.skinIndex!, sw = body.geometry.attributes.skinWeight!, nrm = body.geometry.attributes.normal!;
  for (let v = 0; v < bp.count; v++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (tips.has(si.getComponent(v, k))) w += sw.getComponent(v, k);
    if (w > 0.85 && nrm.getY(v) > 0.45) nails[v] = 1;
  }
  return { eyes: { l, r, radius }, lips, lids, nails };
}

/** Fills a body triangle in UV space with a colour weighted per corner. */
function fillTriangles(ctx: CanvasRenderingContext2D, body: THREE.SkinnedMesh, weight: (v: number) => number, rgb: THREE.Color, strength: number) {
  const img = ctx.getImageData(0, 0, SKIN_SIZE, SKIN_SIZE);
  const d = img.data;
  const uv = body.geometry.attributes.uv!, idx = body.geometry.index!;
  const S = SKIN_SIZE;
  const R = rgb.r * 255, G = rgb.g * 255, B = rgb.b * 255;
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    const wa = weight(a), wb = weight(b), wc = weight(c);
    if (wa <= 0 && wb <= 0 && wc <= 0) continue;
    const P = [a, b, c].map((i) => [uv.getX(i) * S, uv.getY(i) * S]) as [number, number][];
    const minX = Math.max(0, Math.floor(Math.min(P[0]![0], P[1]![0], P[2]![0]))), maxX = Math.min(S - 1, Math.ceil(Math.max(P[0]![0], P[1]![0], P[2]![0])));
    const minY = Math.max(0, Math.floor(Math.min(P[0]![1], P[1]![1], P[2]![1]))), maxY = Math.min(S - 1, Math.ceil(Math.max(P[0]![1], P[1]![1], P[2]![1])));
    const det = (P[1]![1] - P[2]![1]) * (P[0]![0] - P[2]![0]) + (P[2]![0] - P[1]![0]) * (P[0]![1] - P[2]![1]);
    if (Math.abs(det) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((P[1]![1] - P[2]![1]) * (px - P[2]![0]) + (P[2]![0] - P[1]![0]) * (py - P[2]![1])) / det;
      const w1 = ((P[2]![1] - P[0]![1]) * (px - P[2]![0]) + (P[0]![0] - P[2]![0]) * (py - P[2]![1])) / det;
      const w2 = 1 - w0 - w1;
      if (w0 < -0.01 || w1 < -0.01 || w2 < -0.01) continue;
      const k = Math.max(0, Math.min(1, (wa * w0 + wb * w1 + wc * w2) * strength));
      if (k <= 0) continue;
      // glTF UVs: v runs down the picture (textures are used with flipY off).
      const o = (y * S + x) * 4;
      d[o] = d[o]! + (R - d[o]!) * k; d[o + 1] = d[o + 1]! + (G - d[o + 1]!) * k; d[o + 2] = d[o + 2]! + (B - d[o + 2]!) * k;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** A soft spot around a point (body space), fading to 0 at `radius`, front-facing only. */
function spot(body: THREE.SkinnedMesh, centre: THREE.Vector3, radius: number): (v: number) => number {
  const p = body.geometry.attributes.position!, n = body.geometry.attributes.normal!;
  return (v) => {
    if (n.getZ(v) < 0.2) return 0;
    const d = Math.hypot(p.getX(v) - centre.x, p.getY(v) - centre.y, (p.getZ(v) - centre.z) * 0.5);
    return d >= radius ? 0 : (1 - d / radius) ** 1.5;
  };
}

/** A band (eyebrow, eyeliner) between two heights over a span of x, front-facing. */
function band(body: THREE.SkinnedMesh, x0: number, x1: number, yAt: (x: number) => number, half: number, zMin: number): (v: number) => number {
  const p = body.geometry.attributes.position!, n = body.geometry.attributes.normal!;
  return (v) => {
    const x = p.getX(v);
    if (x < Math.min(x0, x1) || x > Math.max(x0, x1) || n.getZ(v) < 0.1 || p.getZ(v) < zMin) return 0;
    const d = Math.abs(p.getY(v) - yAt(x));
    const edge = Math.min(Math.abs(x - x0), Math.abs(x - x1)) / Math.abs(x1 - x0);
    return d >= half ? 0 : (1 - d / half) * Math.min(1, edge * 6);
  };
}

/** The skin texture for these settings. */
export function paintSkin(body: THREE.SkinnedMesh, lm: Landmarks, spec: CharacterSpec, hairColor: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SKIN_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = spec.skin.tone;
  ctx.fillRect(0, 0, SKIN_SIZE, SKIN_SIZE);
  const { l, r, radius: er } = lm.eyes;
  const iod = l.x - r.x;
  // Blush: under and outside each eye.
  if (spec.skin.blush > 0) for (const e of [l, r]) fillTriangles(ctx, body, spot(body, new THREE.Vector3(e.x * 1.12, e.y - iod * 0.42, e.z), iod * 0.32), colour(spec.skin.blushColor), spec.skin.blush * 0.55);
  // Lips.
  if (spec.skin.lipColor > 0) fillTriangles(ctx, body, (v) => lm.lips[v]!, colour(spec.skin.lips), spec.skin.lipColor);
  // Eye shadow on the lids.
  if (spec.skin.eyeshadowAmount > 0) fillTriangles(ctx, body, (v) => lm.lids[v]!, colour(spec.skin.eyeshadow), spec.skin.eyeshadowAmount * 0.8);
  // Eyeliner along the upper lid: anime eyes read from a strong upper line.
  const zMin = Math.min(l.z, r.z) - er * 0.6;
  for (const e of [l, r]) {
    const out = e.x > 0 ? 1 : -1;
    const lift = spec.eyes.style === 'sharp' ? 0.35 : spec.eyes.style === 'soft' ? 0.05 : 0.18;
    fillTriangles(ctx, body, band(body, e.x - out * er * 0.95, e.x + out * er * 1.25, (x) => e.y + er * 0.55 + ((x - e.x) * out) * lift, er * 0.16, zMin), colour(spec.eyes.lashes), 1.4);
  }
  // Eyebrows: a soft arc above each eye, in a darker hair colour.
  const brow = colour(hairColor).multiplyScalar(0.75);
  for (const e of [l, r]) {
    const out = e.x > 0 ? 1 : -1;
    fillTriangles(ctx, body, band(body, e.x - out * er * 1.0, e.x + out * er * 1.3, (x) => e.y + er * 1.55 - ((x - e.x) * out) ** 2 * 8, er * 0.14, zMin), brow, 1.2);
  }
  if (spec.skin.nails) fillTriangles(ctx, body, (v) => lm.nails[v]!, colour(spec.skin.nails), 1);
  return canvas;
}

/** An anime eye: sclera, a two-tone iris with a dark rim, the pupil and highlights. */
export function paintEye(spec: CharacterSpec['eyes']): HTMLCanvasElement {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f7f5f2';
  g.fillRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2;
  const rx = (S / 2) * (0.36 + spec.irisSize * 0.42);
  const ry = rx * (spec.style === 'sharp' ? 1.18 : spec.style === 'soft' ? 1.0 : 1.08);
  const grad = g.createLinearGradient(0, cy - ry, 0, cy + ry);
  grad.addColorStop(0, new THREE.Color(spec.iris).multiplyScalar(0.55).getStyle());
  grad.addColorStop(0.35, spec.iris);
  grad.addColorStop(1, spec.iris2);
  g.fillStyle = grad;
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
  g.lineWidth = rx * 0.12;
  g.strokeStyle = new THREE.Color(spec.iris2).multiplyScalar(0.35).getStyle();
  g.beginPath(); g.ellipse(cx, cy, rx * 0.95, ry * 0.95, 0, 0, Math.PI * 2); g.stroke();
  const pr = rx * (0.2 + spec.pupil * 0.35);
  g.fillStyle = '#120d12';
  g.beginPath(); g.ellipse(cx, cy + ry * 0.05, pr, pr * (ry / rx), 0, 0, Math.PI * 2); g.fill();
  if (spec.highlight > 0) {
    g.fillStyle = `rgba(255,255,255,${0.55 + spec.highlight * 0.45})`;
    g.beginPath(); g.ellipse(cx - rx * 0.32, cy - ry * 0.38, rx * 0.26 * (0.6 + spec.highlight * 0.6), ry * 0.2 * (0.6 + spec.highlight * 0.6), -0.4, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(cx + rx * 0.38, cy + ry * 0.36, rx * 0.09 * (0.5 + spec.highlight), 0, Math.PI * 2); g.fill();
  }
  return c;
}

/** Planar UVs for each eyeball facing forward, so the painted eye sits in its centre. */
export function eyeUVs(eyes: THREE.Mesh, lm: Landmarks) {
  const p = eyes.geometry.attributes.position!;
  const uv = new Float32Array(p.count * 2);
  const r = lm.eyes.radius;
  for (let i = 0; i < p.count; i++) {
    const c = p.getX(i) > 0 ? lm.eyes.l : lm.eyes.r;
    uv[i * 2] = 0.5 + (p.getX(i) - c.x) / (2 * r * 0.92);
    uv[i * 2 + 1] = 0.5 - (p.getY(i) - c.y) / (2 * r * 0.92);
  }
  eyes.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** A canvas as a glTF-style texture (flipY off, sRGB). */
export function canvasTexture(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** A fabric pattern as a tile for clothes. */
export function paintPattern(pattern: string, color: string, accent: string): HTMLCanvasElement {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, S, S);
  g.fillStyle = accent;
  g.strokeStyle = accent;
  switch (pattern) {
    case 'stripes': for (let x = 0; x < S; x += 32) g.fillRect(x, 0, 12, S); break;
    case 'checks': for (let y = 0; y < S; y += 32) for (let x = (y / 32) % 2 ? 32 : 0; x < S; x += 64) g.fillRect(x, y, 32, 32); break;
    case 'dots': for (let y = 16; y < S; y += 32) for (let x = (y / 32) % 2 ? 32 : 16; x < S; x += 32) { g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill(); } break;
    case 'plaid': g.globalAlpha = 0.45; for (let x = 0; x < S; x += 64) { g.fillRect(x, 0, 20, S); g.fillRect(0, x, S, 20); } g.globalAlpha = 0.8; for (let x = 40; x < S; x += 64) { g.fillRect(x, 0, 3, S); g.fillRect(0, x, S, 3); } break;
    case 'knit': g.lineWidth = 3; g.globalAlpha = 0.35; for (let y = 0; y < S; y += 12) for (let x = 0; x < S; x += 12) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6, y + 10); g.lineTo(x + 12, y); g.stroke(); } break;
    case 'denim': g.globalAlpha = 0.25; g.lineWidth = 2; for (let k = -S; k < S; k += 6) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + S, S); g.stroke(); } break;
    case 'lace': g.globalAlpha = 0.6; g.lineWidth = 2; for (let y = 16; y < S; y += 32) for (let x = 16; x < S; x += 32) { g.beginPath(); g.arc(x, y, 10, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); } break;
    default: break;
  }
  return c;
}

/** The anatomy pack's areola: drawn where the distance layer is close enough to the nipple (size), in its colour, with a soft edge. */
export function paintAreola(canvas: HTMLCanvasElement, distance: ImageData, a: CharacterSpec['anatomy']) {
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const c = new THREE.Color(a.areolaColor);
  const R = c.r * 255, G = c.g * 255, B = c.b * 255;
  const edge = 1 - (0.25 + a.areolaSize * 0.55);
  const sx = distance.width / canvas.width, sy = distance.height / canvas.height;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const d = distance.data[(Math.floor(y * sy) * distance.width + Math.floor(x * sx)) * 4]! / 255;
    if (d <= edge) continue;
    const k = Math.min(1, (d - edge) / 0.06) * 0.75;
    const o = (y * canvas.width + x) * 4;
    img.data[o] = img.data[o]! + (R - img.data[o]!) * k; img.data[o + 1] = img.data[o + 1]! + (G - img.data[o + 1]!) * k; img.data[o + 2] = img.data[o + 2]! + (B - img.data[o + 2]!) * k;
  }
  g.putImageData(img, 0, 0);
}
