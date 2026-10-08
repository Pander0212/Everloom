/**
 * Builds the custom-base test models from MakeHuman's CC0 data (the bundled core pack):
 *
 * - `morph-base.glb`: a rigged adult female body (game-engine rig with breast bones) whose body
 *   shapes are kept as named morph targets, the way a base exported from Blender with shape keys
 *   comes in: Breast_Large/Small, Hips_Wide/Narrow, Waist_Wide/Thin, Butt_Big/Small, Belly_Out/In,
 *   Shoulders_Wide/Narrow, Thighs_Thick/Thin, Muscular, Weight_Heavy/Thin, plus a few CC0 face units
 *   (blinks, jaw, smile) for expressions. A plain skin texture so skin layers have something to
 *   paint on, and simple eyes.
 * - `plain-base.glb`: the same body with no morph targets (the "base without morphs" case).
 *
 * Both are CC0 (MakeHuman/MPFB data; Mika Suominen's Face Units). Run:
 *   npx tsx tools/avatars/build-test-base.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8, gunzipSync } from 'fflate';
import sharp from 'sharp';
import { blendTargets, parseHumanObj, parseHumanRig, parseTarget, type HumanObj, type Target } from '../../packages/engine/src/avatar/makehuman-data.js';
import { writeGlb, type GlbBone, type GlbMesh } from './glb-writer.js';

const zip = unzipSync(readFileSync('apps/web/public/avatar/makehuman-core.zip'));
const files = new Map(Object.entries(zip).map(([k, v]) => [k.replace(/^mpfb2-[0-9a-f]+\/src\/mpfb\/data\/|^everloom\/src\/mpfb\/data\//, ''), v]));
const text = (path: string) => {
  const bytes = files.get(path) ?? files.get(`${path}.gz`);
  if (!bytes) throw new Error(`Missing in the MakeHuman pack: ${path}`);
  return strFromU8(bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes);
};
const obj: HumanObj = parseHumanObj(text('3dobjs/base.obj'));
const N = obj.vertices.length / 3;
const target = (path: string): Target => parseTarget(text(path), N);
const dense = (t: Target, scale = 1) => { const d = new Float32Array(N * 3); t.indices.forEach((v, i) => { for (let a = 0; a < 3; a++) d[v * 3 + a] += t.offsets[i * 3 + a]! * scale; }); return d; };
const add = (...ds: Float32Array[]) => { const out = new Float32Array(N * 3); for (const d of ds) for (let i = 0; i < out.length; i++) out[i] += d[i]!; return out; };
const sub = (a: Float32Array, b: Float32Array) => a.map((x, i) => x - b[i]!);

// A young adult woman with average muscle and weight (MakeHuman's macro targets for that mix).
const macro = ['targets/macrodetails/female-young.target', 'targets/macrodetails/universal-female-young-averagemuscle-averageweight.target', 'targets/breast/female-young-averagemuscle-averageweight-averagecup-averagefirmness.target'];
const bodyBase = blendTargets(obj.vertices, macro.filter((p) => files.has(p) || files.has(`${p}.gz`)).map((p) => ({ target: target(p), value: 1 })));

const T = (p: string) => dense(target(`targets/${p}.target`));
const universal = (m: string, w: string) => dense(target(`targets/macrodetails/universal-female-young-${m}-${w}.target`));
const breast = (cup: string) => { const p = `breast/female-young-averagemuscle-averageweight-${cup}-averagefirmness`; return files.has(`targets/${p}.target.gz`) || files.has(`targets/${p}.target`) ? T(p) : null; };
const avgUniversal = universal('averagemuscle', 'averageweight');
const morphs: Record<string, Float32Array> = {};
const bigCup = breast('maxcup'), smallCup = breast('mincup'), avgCup = breast('averagecup');
if (bigCup) morphs.Breast_Large = avgCup ? sub(bigCup, avgCup) : bigCup;
if (smallCup) morphs.Breast_Small = avgCup ? sub(smallCup, avgCup) : smallCup;
Object.assign(morphs, {
  Hips_Wide: T('hip/hip-scale-horiz-incr'), Hips_Narrow: T('hip/hip-scale-horiz-decr'),
  Waist_Wide: T('torso/measure-waist-circ-incr'), Waist_Thin: T('torso/measure-waist-circ-decr'),
  Butt_Big: T('buttocks/buttocks-volume-incr'), Butt_Small: T('buttocks/buttocks-volume-decr'),
  Belly_Out: T('stomach/stomach-pregnant-incr'), Belly_In: T('stomach/stomach-pregnant-decr'),
  Shoulders_Wide: T('torso/measure-shoulder-dist-incr'), Shoulders_Narrow: T('torso/measure-shoulder-dist-decr'),
  Thighs_Thick: add(T('legs/l-upperleg-fat-incr'), T('legs/r-upperleg-fat-incr')), Thighs_Thin: add(T('legs/l-upperleg-fat-decr'), T('legs/r-upperleg-fat-decr')),
  Muscular: sub(universal('maxmuscle', 'averageweight'), avgUniversal),
  Weight_Heavy: sub(universal('averagemuscle', 'maxweight'), avgUniversal), Weight_Thin: sub(universal('averagemuscle', 'minweight'), avgUniversal),
});
for (const name of ['eyeBlinkLeft', 'eyeBlinkRight', 'jawOpen', 'mouthSmileLeft', 'mouthSmileRight', 'mouthFunnel', 'mouthPucker', 'browInnerUp']) morphs[name] = dense(parseTarget(text(`faceunits/${name}.target`), N));

// Rig: bone heads from MakeHuman's joint groups, weights from the matching weight file.
const rigText = text('rigs/standard/rig.game_engine_with_breast.json');
const rig = parseHumanRig(rigText, N);
const head = (name: string): [number, number, number] => {
  const def = rig.bones[name]!.head;
  const ids = def.strategy === 'CUBE' ? [...(obj.groups.get(def.cube_name ?? '') ?? [])] : def.vertex_indices ?? [];
  if (!ids.length) { const p = def.default_position; return [p[0]!, p[2]!, -p[1]!]; }
  const s = [0, 0, 0];
  for (const v of ids) for (let a = 0; a < 3; a++) s[a] += bodyBase[v * 3 + a]!;
  return [(s[0]! / ids.length) * 0.1, (s[1]! / ids.length) * 0.1, (s[2]! / ids.length) * 0.1];
};
const order: string[] = [];
const visit = (name: string) => { if (order.includes(name)) return; const p = rig.bones[name]!.parent; if (p) visit(p); order.push(name); };
for (const name of Object.keys(rig.bones)) visit(name);
const bones: GlbBone[] = order.map((name) => ({ name, parent: rig.bones[name]!.parent || null, at: head(name) }));
const weightsJson = JSON.parse(text('rigs/standard/weights.game_engine_with_breast.json')).weights as Record<string, Array<[number, number]>>;
const perVertex: Array<Array<[number, number]>> = Array.from({ length: N }, () => []);
order.forEach((name, bi) => { for (const [v, w] of weightsJson[name] ?? []) perVertex[v]?.push([bi, w]); });

/** One mesh from some of the OBJ's faces (corners split by UV, like the browser's MakeHuman builder). */
function mesh(name: string, keep: (f: HumanObj['faces'][number]) => boolean, color: string, opts: { morphs?: boolean; texture?: Buffer; bone?: number; offset?: number } = {}): GlbMesh {
  const p: number[] = [], uv: number[] = [], src: number[] = [], idx: number[] = [];
  const at = new Map<string, number>();
  for (const f of obj.faces) {
    if (!keep(f)) continue;
    const refs = f.vertices.map((v, i) => {
      const key = `${v}:${f.uv[i]}`;
      let k = at.get(key);
      if (k === undefined) { k = src.length; at.set(key, k); src.push(v); p.push(bodyBase[v * 3]! * 0.1, bodyBase[v * 3 + 1]! * 0.1, bodyBase[v * 3 + 2]! * 0.1); const t = obj.uv[f.uv[i]!] ?? [0, 0]; uv.push(t[0], 1 - t[1]); }
      return k;
    });
    for (let i = 1; i < refs.length - 1; i++) idx.push(refs[0]!, refs[i]!, refs[i + 1]!);
  }
  const positions = Float32Array.from(p), indices = Uint32Array.from(idx);
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t]! * 3, indices[t + 1]! * 3, indices[t + 2]! * 3];
    const ux = positions[b]! - positions[a]!, uy = positions[b + 1]! - positions[a + 1]!, uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!, vy = positions[c + 1]! - positions[a + 1]!, vz = positions[c + 2]! - positions[a + 2]!;
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const k of [a, b, c]) for (let x = 0; x < 3; x++) normals[k + x] += n[x]!;
  }
  for (let i = 0; i < normals.length; i += 3) { const l = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!) || 1; normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l; }
  if (opts.offset) for (let i = 0; i < positions.length; i++) positions[i] += normals[i]! * opts.offset;
  const skinIndex = new Uint16Array(src.length * 4), skinWeight = new Float32Array(src.length * 4);
  src.forEach((v, i) => {
    const top = opts.bone !== undefined ? [[opts.bone, 1] as [number, number]] : [...perVertex[v]!].sort((x, y) => y[1] - x[1]).slice(0, 4);
    const sum = top.reduce((s, x) => s + x[1], 0) || 1;
    top.forEach(([b, w], k) => { skinIndex[i * 4 + k] = b; skinWeight[i * 4 + k] = w / sum; });
    if (!top.length) skinWeight[i * 4] = 1;
  });
  const out: GlbMesh = { name, positions, normals, indices, skinIndex, skinWeight, uvs: Float32Array.from(uv), color, roughness: 0.6, ...(opts.texture ? { texture: opts.texture } : {}) };
  if (opts.morphs) {
    out.morphs = {};
    for (const [k, d] of Object.entries(morphs)) {
      const m = new Float32Array(src.length * 3);
      src.forEach((v, i) => { for (let a = 0; a < 3; a++) m[i * 3 + a] = d[v * 3 + a]! * 0.1; });
      out.morphs[k] = m;
    }
  }
  return out;
}

// A plain warm skin tone (skin layers paint on it in the body's UV layout).
const S = 1024, skin = Buffer.alloc(S * S * 4);
for (let i = 0; i < S * S; i++) { skin[i * 4] = 228; skin[i * 4 + 1] = 188; skin[i * 4 + 2] = 162; skin[i * 4 + 3] = 255; }
const skinPng = await sharp(skin, { raw: { width: S, height: S, channels: 4 } }).png().toBuffer();
const headBone = order.indexOf('head');
const isBody = (f: HumanObj['faces'][number]) => f.group === 'body';
const isEye = (f: HumanObj['faces'][number]) => f.group === 'helper-l-eye' || f.group === 'helper-r-eye';
// Iris: the eye faces looking forward, a hair in front of the white.
const forward = (f: HumanObj['faces'][number]) => {
  const ids = f.vertices;
  const c = [0, 0, 0];
  for (const v of ids) for (let a = 0; a < 3; a++) c[a] += bodyBase[v * 3 + a]! / ids.length;
  const group = obj.groups.get(f.group)!;
  const m = [0, 0, 0];
  for (const v of group) for (let a = 0; a < 3; a++) m[a] += bodyBase[v * 3 + a]! / group.size;
  const d = [c[0]! - m[0]!, c[1]! - m[1]!, c[2]! - m[2]!], l = Math.hypot(...d) || 1;
  return d[2]! / l > 0.86;
};

// Skin-layer test images (CC0, made here): underwear painted in this body's UV layout, and a tattoo.
{
  const body = mesh('Body', isBody, '#ffffff');
  const boneOf = (name: string) => order.indexOf(name);
  const pelvis = boneOf('pelvis'), thighs = [boneOf('thigh_l'), boneOf('thigh_r')], spine = [boneOf('spine_01'), boneOf('spine_02'), boneOf('spine_03')], breasts = [boneOf('breast_l'), boneOf('breast_r')];
  const hipY = (head('thigh_l')[1] + head('thigh_r')[1]) / 2;
  const breastLow = Math.min(head('breast_l')[1], head('breast_r')[1]);
  const n = body.positions.length / 3;
  const alpha = new Float32Array(n), shade = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const y = body.positions[v * 3 + 1]!, top = body.skinIndex[v * 4]!;
    // Briefs: the hips and the tops of the thighs; a bra: the breasts and a band under them.
    const briefs = (top === pelvis || thighs.includes(top) || top === spine[0]) && y > hipY - 0.085 && y < hipY + 0.03;
    const bra = (breasts.includes(top) || spine.includes(top)) && y > breastLow - 0.04 && y < breastLow + 0.1;
    alpha[v] = briefs || bra ? 1 : 0;
    shade[v] = bra ? 0.85 : 1;
  }
  const S2 = 1024, rgba = Buffer.alloc(S2 * S2 * 4);
  const uvs = body.uvs!, idx = body.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
    if (!alpha[a] && !alpha[b] && !alpha[c]) continue;
    const P = [a, b, c].map((i) => [uvs[i * 2]! * S2, uvs[i * 2 + 1]! * S2]);
    const minX = Math.max(0, Math.floor(Math.min(P[0]![0]!, P[1]![0]!, P[2]![0]!))), maxX = Math.min(S2 - 1, Math.ceil(Math.max(P[0]![0]!, P[1]![0]!, P[2]![0]!)));
    const minY = Math.max(0, Math.floor(Math.min(P[0]![1]!, P[1]![1]!, P[2]![1]!))), maxY = Math.min(S2 - 1, Math.ceil(Math.max(P[0]![1]!, P[1]![1]!, P[2]![1]!)));
    const det = (P[1]![1]! - P[2]![1]!) * (P[0]![0]! - P[2]![0]!) + (P[2]![0]! - P[1]![0]!) * (P[0]![1]! - P[2]![1]!);
    if (Math.abs(det) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((P[1]![1]! - P[2]![1]!) * (px - P[2]![0]!) + (P[2]![0]! - P[1]![0]!) * (py - P[2]![1]!)) / det;
      const w1 = ((P[2]![1]! - P[0]![1]!) * (px - P[2]![0]!) + (P[0]![0]! - P[2]![0]!) * (py - P[2]![1]!)) / det;
      const w2 = 1 - w0 - w1;
      if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
      const al = alpha[a]! * w0 + alpha[b]! * w1 + alpha[c]! * w2;
      if (al < 0.5) continue;
      const sh = shade[a]! * w0 + shade[b]! * w1 + shade[c]! * w2;
      const o = (y * S2 + x) * 4;
      rgba[o] = Math.round(38 * sh); rgba[o + 1] = Math.round(52 * sh); rgba[o + 2] = Math.round(92 * sh); rgba[o + 3] = 255;
    }
  }
  mkdirSync('tests/fixtures/avatars/layers', { recursive: true });
  writeFileSync('tests/fixtures/avatars/layers/underwear-uv.png', await sharp(rgba, { raw: { width: S2, height: S2, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer());
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><g fill="none" stroke="#1d2a3a" stroke-width="9" stroke-linecap="round"><circle cx="128" cy="128" r="70"/><path d="M128 30 L150 105 L226 105 L165 150 L188 226 L128 180 L68 226 L91 150 L30 105 L106 105 Z" stroke="#7a1f2b" stroke-width="7"/></g><circle cx="128" cy="128" r="16" fill="#7a1f2b"/></svg>`;
  writeFileSync('tests/fixtures/avatars/layers/tattoo.png', await sharp(Buffer.from(svg)).png().toBuffer());
  console.log('layers: underwear-uv.png, tattoo.png');
}

for (const [file, withMorphs] of [['morph-base', true], ['plain-base', false]] as const) {
  const meshes = [
    mesh('Body', isBody, '#ffffff', { morphs: withMorphs, texture: skinPng }),
    mesh('Eyes', isEye, '#f4f1ec', { bone: headBone }),
    mesh('Iris', (f) => isEye(f) && forward(f), '#4a3527', { bone: headBone, offset: 0.0004 }),
  ];
  const glb = writeGlb(bones, meshes, { generator: 'Everloom test base (MakeHuman CC0 data)', extras: { license: 'CC0-1.0', source: 'MakeHuman / MPFB base mesh, targets, game-engine rig; Face Units 01 by Mika Suominen' } });
  writeFileSync(`tests/fixtures/avatars/models/${file}.glb`, glb);
  console.log(`${file}.glb: ${(glb.length / 1048576).toFixed(1)} MB, ${meshes[0]!.positions.length / 3} body vertices, ${withMorphs ? Object.keys(morphs).length : 0} morphs, ${bones.length} bones`);
}
