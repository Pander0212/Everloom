import { describe, expect, it } from 'vitest';
import { buildTemplateRig, checkPuppet, keyBackground, mapLayers, parsePuppet, rectMesh, tagForLayerName, type LayerImage } from '../src/index.js';

const W = 200, H = 400;
/** A full-canvas layer with filled ellipses of one colour. */
function layer(name: string, shapes: Array<[number, number, number, number]>, rgb: [number, number, number] = [200, 150, 120]): LayerImage {
  const a = new Uint8Array(W * H * 4);
  for (const [cx, cy, rx, ry] of shapes) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) { const i = (y * W + x) * 4; a[i] = rgb[0]; a[i + 1] = rgb[1]; a[i + 2] = rgb[2]; a[i + 3] = 255; }
  return { name, rgba: a };
}

describe('a layered picture to puppet parts', () => {
  const pic = {
    width: W, height: H,
    layers: [
      layer('back hair', [[100, 80, 50, 70]], [240, 210, 90]),
      layer('handwear', [[45, 150, 12, 40], [155, 150, 12, 40]]),
      layer('legwear', [[80, 300, 15, 80], [120, 300, 15, 80]]),
      layer('topwear', [[100, 150, 40, 50]], [30, 30, 30]),
      layer('bottomwear', [[100, 215, 42, 25]], [40, 60, 160]),
      layer('face', [[100, 60, 30, 36]]),
      layer('eyewhite', [[88, 58, 6, 4], [112, 58, 6, 4]], [255, 255, 255]),
      layer('irides', [[88, 58, 3, 3], [112, 58, 3, 3]], [40, 90, 200]),
      layer('eyelash', [[88, 54, 7, 2], [112, 54, 7, 2]], [20, 20, 20]),
      layer('eyebrow', [[88, 46, 7, 1.5], [112, 46, 7, 1.5]], [120, 90, 40]),
      layer('mouth', [[100, 82, 5, 1.5]], [150, 60, 60]),
      layer('front hair', [[100, 40, 34, 20], [72, 110, 6, 40], [128, 110, 6, 40]], [240, 210, 90]),
    ],
  };
  const m = mapLayers(pic);

  it('maps tags to slots, splits left and right at the face, and adds closed eyes and mouths', () => {
    const slots = new Set(m.parts.map((p) => p.slot));
    for (const s of ['hair.back', 'hair.front', 'hair.side', 'face', 'eye.l.white', 'eye.r.iris', 'eye.l.lash', 'eye.l.closed', 'brow.r', 'mouth.open', 'top', 'bottom', 'legwear', 'arm.l', 'arm.r']) expect(slots).toContain(s);
    // The character's left eye is on the picture's right.
    expect(m.landmarks.eyeL.cx).toBeGreaterThan(m.landmarks.eyeR.cx);
    expect(Math.abs(m.landmarks.head.cx - 100)).toBeLessThan(1.5);
    // Shoulders from the arms' tops.
    expect(m.landmarks.shoulderL[0]).toBeGreaterThan(140);
  });

  it("keeps the picture's draw order for the body: arms behind the top, the bottoms over it", () => {
    const z = Object.fromEntries(m.parts.filter((p) => p.z !== undefined).map((p) => [p.id, p.z!]));
    expect(z['arm-l']).toBeLessThan(z.topwear!);
    expect(z.bottomwear).toBeGreaterThan(z.topwear!);
  });

  it('recovers what no layer holds below the hips (a dropped tag), but not specks or edge background', () => {
    const src = new Uint8Array(W * H * 4);
    for (const l of pic.layers) for (let i = 0; i < src.length; i += 4) if (l.rgba[i + 3]! > 0) { src.set(l.rgba.subarray(i, i + 4), i); }
    // Shoes See-through dropped (a solid block under the legs), a speck, and a band along the bottom edge.
    const fill = (x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) src.set([250, 250, 250, 255], (y * W + x) * 4); };
    fill(10, 381, 190, 397); fill(20, 300, 24, 304); fill(0, 399, W, H);
    const r = mapLayers({ ...pic, source: src });
    const shoes = r.parts.filter((p) => p.slot === 'shoes');
    expect(shoes).toHaveLength(1);
    const a = shoes[0]!.rgba;
    expect(a[(385 * W + 100) * 4 + 3]).toBe(255);
    expect(a[(302 * W + 22) * 4 + 3]).toBe(0);
    expect(a[(399 * W + 5) * 4 + 3]).toBe(0);
    expect(shoes[0]!.z).toBeGreaterThan(r.parts.find((p) => p.id === 'legwear')!.z!);
  });

  it('rigs into a valid puppet', () => {
    const parts = m.parts.map((p, i) => ({ id: p.id, slot: p.slot, texture: 0, mesh: rectMesh(i, i, 10, 10), z: p.z }));
    const model = buildTemplateRig(m.landmarks, parts, { id: 't', name: 'T', template: 'everloom-f', textures: ['page0.png'], colors: m.colors });
    expect(checkPuppet(model).ok).toBe(true);
    // And within the format's own limits (the chest warp once came out 32 rows tall).
    expect(() => parsePuppet(JSON.parse(JSON.stringify(model)))).not.toThrow();
  });
});

describe('background removal', () => {
  it('keys a flat background and a gradient one, keeps the figure and an existing transparency', () => {
    const make = (grad: boolean) => {
      const a = new Uint8Array(W * H * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, inside = ((x - 100) / 40) ** 2 + ((y - 200) / 120) ** 2 <= 1, edge = Math.abs(((x - 100) / 40) ** 2 + ((y - 200) / 120) ** 2 - 1) < 0.08;
        const bg = grad ? 120 + Math.round((y / H) * 90) : 150;
        const v = edge ? 20 : inside ? 230 : bg;
        a[i] = v; a[i + 1] = inside && !edge ? 180 : v; a[i + 2] = v; a[i + 3] = 255;
      }
      return a;
    };
    for (const grad of [false, true]) {
      const k = keyBackground(make(grad), W, H);
      expect(k[(5 * W + 5) * 4 + 3]).toBe(0);
      expect(k[(200 * W + 100) * 4 + 3]).toBe(255);
    }
    const t = make(false);
    for (let i = 3; i < t.length; i += 8) t[i] = 0;
    expect(keyBackground(t, W, H)).toBe(t);
  });
});

describe('layer names from drawing programs', () => {
  it('maps English and Japanese part names, folders and copies to the mapper’s tags', () => {
    const cases: Record<string, string | null> = {
      'Hair/Front': 'front hair', 'Hair/Back': 'back hair', '前髪': 'front hair', '後ろ髪': 'back hair', Hair: 'front hair',
      Face: 'face', '顔': 'face', 'eye white L': 'eyewhite', Iris_R: 'irides', 'まつげ 左': 'eyelash', '眉': 'eyebrow',
      'Body/Shirt Copy 2': 'topwear', Skirt: 'bottomwear', necklace: 'neckwear', Neck: 'neck', 'arm-l': 'handwear',
      Shoes: 'footwear', Glasses: 'eyewear', 'Folder/Mouth': 'mouth', 'Layer 1': null, topwear: 'topwear',
    };
    for (const [name, tag] of Object.entries(cases)) expect(tagForLayerName(name), name).toBe(tag);
  });
});
