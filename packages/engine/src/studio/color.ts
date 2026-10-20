/**
 * Recolouring that keeps the painted shading. Hair and eyes use a gradient map: each pixel's
 * luminance relative to the painted base colour picks a tone on a ramp built around the new colour
 * (cooler, darker shadows; warmer, lighter highlights), so any colour looks painted. Skin uses a
 * shift in Lab space (the difference between the base skin and the new skin), so blush, lips and
 * nipples keep their relation to the skin around them.
 */

export type RGB = [number, number, number];

export const hexToRgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const rgbToHex = (c: RGB) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gam = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255;

export function rgbToLab([r, g, b]: RGB): RGB {
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export function labToRgb([L, a, b]: RGB): RGB {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const x = inv(fx) * 0.95047, y = inv(fy), z = inv(fz) * 1.08883;
  const R = x * 3.2406 + y * -1.5372 + z * -0.4986;
  const G = x * -0.9689 + y * 1.8758 + z * 0.0415;
  const B = x * 0.0557 + y * -0.204 + z * 1.057;
  return [gam(Math.max(0, R)), gam(Math.max(0, G)), gam(Math.max(0, B))];
}

/** Relative luminance 0…1 (sRGB weights on gamma values: matches how painted shading reads). */
export const luma = ([r, g, b]: RGB) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

/**
 * A 256-entry ramp (RGB triplets) for a target colour: index = luminance × 255 of the source pixel
 * relative to the painted base colour (`baseLuma` maps to the target itself). Shadows shift a little
 * toward blue-violet, highlights toward warm, as painted anime hair does.
 */
export function gradientRamp(target: string, baseLuma: number): Uint8ClampedArray {
  const t = rgbToLab(hexToRgb(target));
  const ramp = new Uint8ClampedArray(256 * 3);
  const b0 = Math.max(0.05, Math.min(0.95, baseLuma));
  for (let i = 0; i < 256; i++) {
    const l = i / 255;
    // Position relative to the base: −1 deepest shadow, 0 base, +1 brightest highlight.
    const k = l < b0 ? (l - b0) / b0 : (l - b0) / (1 - b0);
    const L = k < 0 ? t[0] * (1 + k * 0.85) : t[0] + (100 - t[0]) * k * 0.9;
    const a = t[1] * (1 - Math.abs(k) * 0.35) + (k < 0 ? 4 * -k : -2 * k);
    const bb = t[2] * (1 - Math.abs(k) * 0.35) + (k < 0 ? -10 * -k : 8 * k);
    const c = labToRgb([Math.max(0, Math.min(100, L)), a, bb]);
    ramp.set(c.map((v) => Math.round(v)) as unknown as number[], i * 3);
  }
  return ramp;
}

/**
 * Recolours RGBA pixels in place. `mask` (one byte per pixel, 0…255) limits and feathers it;
 * absent means every pixel. Hair/eyes/highlight: gradient map; skin: Lab shift.
 */
export function recolorPixels(rgba: Uint8ClampedArray, kind: 'hair' | 'highlight' | 'eyes' | 'skin', base: string, target: string, mask?: Uint8Array): void {
  const n = rgba.length / 4;
  if (kind === 'skin') {
    const d = rgbToLab(hexToRgb(target)).map((v, i) => v - rgbToLab(hexToRgb(base))[i]!) as RGB;
    for (let p = 0; p < n; p++) {
      const m = mask ? mask[p]! / 255 : 1;
      if (m <= 0 || rgba[p * 4 + 3] === 0) continue;
      const src: RGB = [rgba[p * 4]!, rgba[p * 4 + 1]!, rgba[p * 4 + 2]!];
      const lab = rgbToLab(src);
      const out = labToRgb([lab[0] + d[0], lab[1] + d[1], lab[2] + d[2]]);
      for (let c = 0; c < 3; c++) rgba[p * 4 + c] = src[c]! + (out[c]! - src[c]!) * m;
    }
    return;
  }
  const ramp = gradientRamp(target, luma(hexToRgb(base)));
  for (let p = 0; p < n; p++) {
    const m = mask ? mask[p]! / 255 : 1;
    if (m <= 0 || rgba[p * 4 + 3] === 0) continue;
    const src: RGB = [rgba[p * 4]!, rgba[p * 4 + 1]!, rgba[p * 4 + 2]!];
    const i = Math.round(luma(src) * 255) * 3;
    for (let c = 0; c < 3; c++) rgba[p * 4 + c] = src[c]! + (ramp[i + c]! - src[c]!) * m;
  }
}

/** Mean colour difference (ΔE76) between two RGBA buffers over opaque pixels: the colour-drift gate. */
export function colorDrift(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0, n = 0;
  for (let p = 0; p < a.length; p += 4) {
    if (a[p + 3]! < 128) continue;
    const la = rgbToLab([a[p]!, a[p + 1]!, a[p + 2]!]), lb = rgbToLab([b[p]!, b[p + 1]!, b[p + 2]!]);
    sum += Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
    n++;
  }
  return n ? sum / n : 0;
}
