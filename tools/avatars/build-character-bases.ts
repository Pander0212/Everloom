/**
 * The character creator's own bases (CC0, from MakeHuman's data in the bundled core pack): an
 * adult woman and an adult man, reshaped toward anime proportions (larger eyes, smaller nose and
 * mouth, a softer jaw, longer legs), with
 *   - shape keys for the body and face sliders (each slider a pair: Name_Up / Name_Down style),
 *   - the face units for blinking, talking and smiling,
 *   - the game-engine skeleton with breast bones, plus two butt bones weighted from MakeHuman's
 *     buttock target, so breast and butt physics and the bone sliders work (Part 4 roles),
 *   - a plain skin texture in the MakeHuman UV layout (the creator paints on it).
 * Morphs are stored sparse and the file is meshopt-compressed. Run:
 *
 *   npx tsx tools/avatars/build-character-bases.ts
 *
 * Output: apps/web/public/avatar/bases/{anime-f,anime-m}.glb (+ LICENSE.txt). The bodies are
 * smooth, like a mannequin: no anatomy (that comes from a separate pack, never this repo).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, sparse } from '@gltf-transform/functions';
import { gunzipSync, strFromU8, unzipSync } from 'fflate';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { blendTargets, parseHumanObj, parseHumanRig, parseTarget, type HumanObj, type Target } from '../../packages/engine/src/avatar/makehuman-data.js';
import { writeGlb, type GlbBone, type GlbMesh } from './glb-writer.js';

const OUT = 'apps/web/public/avatar/bases';
const zip = unzipSync(readFileSync('apps/web/public/avatar/makehuman-core.zip'));
const files = new Map(Object.entries(zip).map(([k, v]) => [k.replace(/^mpfb2-[0-9a-f]+\/src\/mpfb\/data\/|^everloom\/src\/mpfb\/data\//, ''), v]));
const text = (path: string) => {
  const bytes = files.get(path) ?? files.get(`${path}.gz`);
  if (!bytes) throw new Error(`Missing in the MakeHuman pack: ${path}`);
  return strFromU8(bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes);
};
const has = (path: string) => files.has(path) || files.has(`${path}.gz`);
const obj: HumanObj = parseHumanObj(text('3dobjs/base.obj'));
const N = obj.vertices.length / 3;
const target = (path: string): Target => parseTarget(text(path), N);
const dense = (t: Target, scale = 1) => { const d = new Float32Array(N * 3); t.indices.forEach((v, i) => { for (let a = 0; a < 3; a++) d[v * 3 + a] += t.offsets[i * 3 + a]! * scale; }); return d; };
const sum = (...ds: Float32Array[]) => { const out = new Float32Array(N * 3); for (const d of ds) for (let i = 0; i < out.length; i++) out[i] += d[i]!; return out; };
const sub = (a: Float32Array, b: Float32Array) => a.map((x, i) => x - b[i]!);
const T = (p: string, scale = 1) => dense(target(`targets/${p}.target`), scale);
/** A left/right pair of targets (`l-…`, `r-…`) as one. */
const LR = (group: string, name: string, scale = 1) => sum(T(`${group}/l-${name}`, scale), T(`${group}/r-${name}`, scale));

type Sex = 'female' | 'male';

/** Slider shape keys: name → displacement (relative to the reshaped neutral body). */
function shapeKeys(sex: Sex): Record<string, Float32Array> {
  const universal = (m: string, w: string) => T(`macrodetails/universal-${sex}-young-${m}-${w}`);
  const avg = universal('averagemuscle', 'averageweight');
  const k: Record<string, Float32Array> = {};
  if (sex === 'female') {
    // The average cup and firmness is MakeHuman's neutral breast (it has no target of its own).
    const B = (c: string, f: string) => T(`breast/female-young-averagemuscle-averageweight-${c}-${f}`);
    k.Breast_Large = B('maxcup', 'averagefirmness');
    k.Breast_Small = B('mincup', 'averagefirmness');
    k.Breast_Firm = B('averagecup', 'maxfirmness');
    k.Breast_Soft = B('averagecup', 'minfirmness');
  } else {
    k.Chest_Broad = T('torso/torso-muscle-pectoral-incr');
  }
  Object.assign(k, {
    Breast_Point: T('breast/breast-point-incr'), Breast_Round: T('breast/breast-point-decr'),
    Breast_Up: T('breast/breast-trans-up'), Breast_Down: T('breast/breast-trans-down'),
    Breast_Apart: T('breast/breast-dist-incr'), Breast_Together: T('breast/breast-dist-decr'),
    Waist_Wide: T('torso/measure-waist-circ-incr'), Waist_Thin: T('torso/measure-waist-circ-decr'),
    Hips_Wide: T('hip/hip-scale-horiz-incr'), Hips_Narrow: T('hip/hip-scale-horiz-decr'),
    Butt_Big: T('buttocks/buttocks-volume-incr'), Butt_Small: T('buttocks/buttocks-volume-decr'),
    Belly_Out: T('stomach/stomach-pregnant-incr', 0.6), Belly_In: T('stomach/stomach-pregnant-decr'),
    Shoulders_Wide: T('torso/measure-shoulder-dist-incr'), Shoulders_Narrow: T('torso/measure-shoulder-dist-decr'),
    Thighs_Thick: LR('legs', 'upperleg-fat-incr'), Thighs_Thin: LR('legs', 'upperleg-fat-decr'),
    Legs_Long: sum(T('legs/upperlegs-height-incr'), T('legs/lowerlegs-height-incr')), Legs_Short: sum(T('legs/upperlegs-height-decr'), T('legs/lowerlegs-height-decr')),
    Arms_Thick: sum(LR('arms', 'upperarm-fat-incr'), LR('arms', 'lowerarm-fat-incr')), Arms_Thin: sum(LR('arms', 'upperarm-fat-decr'), LR('arms', 'lowerarm-fat-decr')),
    Hands_Big: LR('hands', 'hand-scale-incr'), Hands_Small: LR('hands', 'hand-scale-decr'),
    Neck_Long: T('neck/neck-scale-vert-incr'), Neck_Short: T('neck/neck-scale-vert-decr'),
    Muscular: sub(universal('maxmuscle', 'averageweight'), avg),
    Weight_Heavy: sub(universal('averagemuscle', 'maxweight'), avg), Weight_Thin: sub(universal('averagemuscle', 'minweight'), avg),
    // Face
    Face_Round: T('head/head-round'), Face_Oval: T('head/head-oval'), Face_Square: T('head/head-square'), Face_Heart: T('head/head-invertedtriangular'),
    Face_Wide: T('head/head-scale-horiz-incr'), Face_Narrow: T('head/head-scale-horiz-decr'),
    Jaw_Wide: T('chin/chin-width-incr'), Jaw_Narrow: T('chin/chin-width-decr'),
    Chin_Long: T('chin/chin-height-incr'), Chin_Short: T('chin/chin-height-decr'),
    Cheeks_Full: LR('cheek', 'cheek-volume-incr'), Cheeks_Hollow: LR('cheek', 'cheek-volume-decr'),
    Cheekbones_High: LR('cheek', 'cheek-bones-incr'), Cheekbones_Low: LR('cheek', 'cheek-bones-decr'),
    Eyes_Big: LR('eyes', 'eye-scale-incr'), Eyes_Small: LR('eyes', 'eye-scale-decr'),
    Eyes_Apart: LR('eyes', 'eye-trans-out'), Eyes_Close: LR('eyes', 'eye-trans-in'),
    Eyes_Up: LR('eyes', 'eye-trans-up'), Eyes_Down: LR('eyes', 'eye-trans-down'),
    Eyes_Tilt_Up: LR('eyes', 'eye-eyefold-angle-up'), Eyes_Tilt_Down: LR('eyes', 'eye-eyefold-angle-down'),
    Eyes_Tall: sum(LR('eyes', 'eye-height2-incr'), LR('eyes', 'eye-height1-incr', 0.5)), Eyes_Narrow: sum(LR('eyes', 'eye-height2-decr'), LR('eyes', 'eye-height1-decr', 0.5)),
    Brows_Up: T('eyebrows/eyebrows-trans-up'), Brows_Down: T('eyebrows/eyebrows-trans-down'),
    Brows_Angle_Up: T('eyebrows/eyebrows-angle-up'), Brows_Angle_Down: T('eyebrows/eyebrows-angle-down'),
    Nose_Big: T('nose/nose-volume-incr'), Nose_Small: T('nose/nose-volume-decr'),
    Nose_Up: T('nose/nose-trans-up'), Nose_Down: T('nose/nose-trans-down'),
    Nose_Wide: T('nose/nose-scale-horiz-incr'), Nose_Narrow: T('nose/nose-scale-horiz-decr'),
    Nose_Point_Up: T('nose/nose-point-up'), Nose_Point_Down: T('nose/nose-point-down'),
    Mouth_Wide: T('mouth/mouth-scale-horiz-incr'), Mouth_Narrow: T('mouth/mouth-scale-horiz-decr'),
    Mouth_Up: T('mouth/mouth-trans-up'), Mouth_Down: T('mouth/mouth-trans-down'),
    Lips_Full: sum(T('mouth/mouth-upperlip-volume-incr'), T('mouth/mouth-lowerlip-volume-incr')), Lips_Thin: sum(T('mouth/mouth-upperlip-volume-decr'), T('mouth/mouth-lowerlip-volume-decr')),
    Mouth_Corners_Up: T('mouth/mouth-angles-up'), Mouth_Corners_Down: T('mouth/mouth-angles-down'),
    Ears_Big: LR('ears', 'ear-scale-incr'), Ears_Small: LR('ears', 'ear-scale-decr'),
    Ears_Pointed: LR('ears', 'ear-shape-pointed'), Ears_Round: LR('ears', 'ear-shape-round'),
  });
  // Expressions (face units, CC0, Mika Suominen).
  for (const name of ['eyeBlinkLeft', 'eyeBlinkRight', 'eyeWideLeft', 'eyeWideRight', 'jawOpen', 'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthFunnel', 'mouthPucker', 'mouthStretchLeft', 'mouthStretchRight', 'browInnerUp', 'browDownLeft', 'browDownRight']) {
    if (has(`faceunits/${name}.target`)) k[name] = dense(parseTarget(text(`faceunits/${name}.target`), N));
  }
  return k;
}

/** The neutral body: a young adult of `sex`, ideal proportions, then nudged toward anime proportions. */
function neutral(sex: Sex): Float32Array {
  // MakeHuman's default: the three ethnic macros mixed equally, then the universal and proportion ones.
  const macro: [string, number][] = [
    ...['african', 'asian', 'caucasian'].map((e) => [`targets/macrodetails/${e}-${sex}-young.target`, 1 / 3] as [string, number]),
    [`targets/macrodetails/universal-${sex}-young-averagemuscle-averageweight.target`, 1],
    [`targets/macrodetails/proportions/${sex}-young-averagemuscle-averageweight-idealproportions.target`, 1],
  ];
  for (const [p] of macro) if (!has(p)) throw new Error(`Missing macro target ${p}`);
  const base = blendTargets(obj.vertices, macro.map(([p, value]) => ({ target: target(p), value })));
  const f = sex === 'female';
  const anime: [string, number][] = [
    ['eyes/l-eye-scale-incr', f ? 0.7 : 0.45], ['eyes/r-eye-scale-incr', f ? 0.7 : 0.45],
    ['eyes/l-eye-height2-incr', f ? 0.4 : 0.2], ['eyes/r-eye-height2-incr', f ? 0.4 : 0.2],
    ['nose/nose-volume-decr', f ? 0.6 : 0.35], ['nose/nose-scale-horiz-decr', 0.3],
    ['mouth/mouth-scale-horiz-decr', f ? 0.35 : 0.15], ['chin/chin-width-decr', f ? 0.45 : 0.15],
    ['head/head-oval', f ? 0.5 : 0.25], ['cheek/l-cheek-bones-decr', 0.3], ['cheek/r-cheek-bones-decr', 0.3],
    ['legs/upperlegs-height-incr', 0.35], ['legs/lowerlegs-height-incr', 0.35],
    ['neck/neck-scale-vert-incr', f ? 0.25 : 0.1],
  ];
  for (const [p, w] of anime) {
    const d = T(p, w);
    for (let i = 0; i < base.length; i++) base[i] += d[i]!;
  }
  return base;
}

async function build(sex: Sex) {
  const body0 = neutral(sex);
  // Feet on the floor (y = 0), the body centred over the origin.
  let floor = Infinity;
  for (let v = 0; v < N; v++) floor = Math.min(floor, body0[v * 3 + 1]!);
  for (let v = 0; v < N; v++) body0[v * 3 + 1] -= floor;
  const keys = shapeKeys(sex);
  // Rig: bone heads from MakeHuman's joint groups, weights from the matching weight file.
  const rig = parseHumanRig(text('rigs/standard/rig.game_engine_with_breast.json'), N);
  const head = (name: string): [number, number, number] => {
    const def = rig.bones[name]!.head;
    const ids = def.strategy === 'CUBE' ? [...(obj.groups.get(def.cube_name ?? '') ?? [])] : def.vertex_indices ?? [];
    if (!ids.length) { const p = def.default_position; return [p[0]!, p[2]!, -p[1]!]; }
    const s = [0, 0, 0];
    for (const v of ids) for (let a = 0; a < 3; a++) s[a] += body0[v * 3 + a]!;
    return [(s[0]! / ids.length) * 0.1, (s[1]! / ids.length) * 0.1, (s[2]! / ids.length) * 0.1];
  };
  const order: string[] = [];
  const visit = (name: string) => { if (order.includes(name)) return; const p = rig.bones[name]!.parent; if (p) visit(p); order.push(name); };
  for (const name of Object.keys(rig.bones)) visit(name);
  const weightsJson = JSON.parse(text('rigs/standard/weights.game_engine_with_breast.json')).weights as Record<string, Array<[number, number]>>;
  const perVertex: Array<Array<[number, number]>> = Array.from({ length: N }, () => []);
  order.forEach((name, bi) => { for (const [v, w] of weightsJson[name] ?? []) perVertex[v]?.push([bi, w]); });
  const bones: GlbBone[] = order.map((name) => ({ name, parent: rig.bones[name]!.parent || null, at: head(name) }));

  // Mannequin-smooth chest: the base mesh's nipples are smoothed away (anatomy comes from a
  // separate pack, never this repo). Around the front-most point of each breast, a few passes of
  // neighbour averaging, fading out over 3.5 cm.
  {
    const nbr: Set<number>[] = Array.from({ length: N }, () => new Set());
    for (const f of obj.faces) for (let i = 0; i < f.vertices.length; i++) { const a = f.vertices[i]!, b = f.vertices[(i + 1) % f.vertices.length]!; nbr[a]!.add(b); nbr[b]!.add(a); }
    for (const side of ['l', 'r'] as const) {
      const bi = order.indexOf(`breast_${side}`);
      let tip = -1;
      for (let v = 0; v < N; v++) {
        const w = perVertex[v]!.find((e) => e[0] === bi)?.[1] ?? 0;
        if (w > 0.5 && (tip < 0 || body0[v * 3 + 2]! > body0[tip * 3 + 2]!)) tip = v;
      }
      if (tip < 0) continue;
      // Taubin smoothing (a shrink step, then an inflate step) removes the small bump and keeps the
      // breast's volume. Full strength within 1.2 cm of the tip, fading out by 2.6 cm.
      // The whole breast (weighted to its bone), fading in from the edge.
      const near: [number, number][] = [];
      for (let v = 0; v < N; v++) { const w = perVertex[v]!.find((e) => e[0] === bi)?.[1] ?? 0; if (w > 0.15) near.push([v, Math.min(1, (w - 0.15) / 0.35)]); }
      for (let pass = 0; pass < 300; pass++) {
        const k = pass % 2 ? -0.53 : 0.5;
        const next = near.map(([v]) => { const c = [0, 0, 0]; for (const n of nbr[v]!) for (let a = 0; a < 3; a++) c[a] += body0[n * 3 + a]! / nbr[v]!.size; return c; });
        near.forEach(([v, w], i2) => { for (let a = 0; a < 3; a++) body0[v * 3 + a] += (next[i2]![a]! - body0[v * 3 + a]!) * w * k; });
      }
    }
  }

  // Butt bones: placed at the centre of each buttock and weighted by how much the buttock target
  // moves each vertex (the rest of the weight stays with the bones it was on).
  const butt = keys.Butt_Big!;
  const pelvis = order.indexOf('pelvis');
  for (const side of ['l', 'r'] as const) {
    const sign = side === 'l' ? 1 : -1;
    let max = 0;
    const mag = new Float32Array(N);
    for (let v = 0; v < N; v++) { if (Math.sign(body0[v * 3]!) !== sign) continue; mag[v] = Math.hypot(butt[v * 3]!, butt[v * 3 + 1]!, butt[v * 3 + 2]!); if (mag[v]! > max) max = mag[v]!; }
    const c = [0, 0, 0];
    let wsum = 0;
    for (let v = 0; v < N; v++) { const w = mag[v]! / max; if (w < 0.25) continue; for (let a = 0; a < 3; a++) c[a] += body0[v * 3 + a]! * 0.1 * w; wsum += w; }
    const at: [number, number, number] = [c[0]! / wsum, c[1]! / wsum, c[2]! / wsum];
    const bi = bones.length;
    bones.push({ name: `butt_${side}`, parent: 'pelvis', at });
    for (let v = 0; v < N; v++) {
      const w = Math.min(1, (mag[v]! / max) * 1.2) * 0.85;
      if (w < 0.05) continue;
      const list = perVertex[v]!;
      for (const e of list) e[1] *= 1 - w;
      list.push([bi, w]);
    }
  }
  void pelvis;

  /** One mesh from some of the OBJ's faces (corners split by UV, like the browser's MakeHuman builder). */
  const mesh = (name: string, keep: (f: HumanObj['faces'][number]) => boolean, color: string, opts: { morphs?: boolean; texture?: Buffer; bone?: number; offset?: number } = {}): GlbMesh => {
    const p: number[] = [], uv: number[] = [], src: number[] = [], idx: number[] = [];
    const at = new Map<string, number>();
    for (const f of obj.faces) {
      if (!keep(f)) continue;
      const refs = f.vertices.map((v, i) => {
        const key = `${v}:${f.uv[i]}`;
        let k = at.get(key);
        if (k === undefined) { k = src.length; at.set(key, k); src.push(v); p.push(body0[v * 3]! * 0.1, body0[v * 3 + 1]! * 0.1, body0[v * 3 + 2]! * 0.1); const t = obj.uv[f.uv[i]!] ?? [0, 0]; uv.push(t[0], 1 - t[1]); }
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
      for (const kk of [a, b, c]) for (let x = 0; x < 3; x++) normals[kk + x] += n[x]!;
    }
    for (let i = 0; i < normals.length; i += 3) { const l = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!) || 1; normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l; }
    if (opts.offset) for (let i = 0; i < positions.length; i++) positions[i] += normals[i]! * opts.offset;
    const skinIndex = new Uint16Array(src.length * 4), skinWeight = new Float32Array(src.length * 4);
    src.forEach((v, i) => {
      const top = opts.bone !== undefined ? [[opts.bone, 1] as [number, number]] : [...perVertex[v]!].sort((x, y) => y[1] - x[1]).slice(0, 4);
      const s = top.reduce((q, x) => q + x[1], 0) || 1;
      top.forEach(([b, w], kk) => { skinIndex[i * 4 + kk] = b; skinWeight[i * 4 + kk] = w / s; });
      if (!top.length) skinWeight[i * 4] = 1;
    });
    const out: GlbMesh = { name, positions, normals, indices, skinIndex, skinWeight, uvs: Float32Array.from(uv), color, roughness: 0.6, ...(opts.texture ? { texture: opts.texture } : {}) };
    if (opts.morphs) {
      out.morphs = {};
      for (const [k, d] of Object.entries(keys)) {
        const m = new Float32Array(src.length * 3);
        src.forEach((v, i) => { for (let a = 0; a < 3; a++) m[i * 3 + a] = d[v * 3 + a]! * 0.1; });
        out.morphs[k] = m;
      }
    }
    return out;
  };

  const S = 1024, skin = Buffer.alloc(S * S * 4);
  for (let i = 0; i < S * S; i++) { skin[i * 4] = 246; skin[i * 4 + 1] = 222; skin[i * 4 + 2] = 206; skin[i * 4 + 3] = 255; }
  const skinPng = await sharp(skin, { raw: { width: S, height: S, channels: 4 } }).png().toBuffer();
  const headBone = order.indexOf('head');
  const isBody = (f: HumanObj['faces'][number]) => f.group === 'body';
  const isEye = (f: HumanObj['faces'][number]) => f.group === 'helper-l-eye' || f.group === 'helper-r-eye';
  const forward = (f: HumanObj['faces'][number]) => {
    const c = [0, 0, 0];
    for (const v of f.vertices) for (let a = 0; a < 3; a++) c[a] += body0[v * 3 + a]! / f.vertices.length;
    const group = obj.groups.get(f.group)!;
    const m = [0, 0, 0];
    for (const v of group) for (let a = 0; a < 3; a++) m[a] += body0[v * 3 + a]! / group.size;
    const d = [c[0]! - m[0]!, c[1]! - m[1]!, c[2]! - m[2]!], l = Math.hypot(...d) || 1;
    return d[2]! / l > 0.86;
  };
  const meshes = [
    mesh('Body', isBody, '#ffffff', { morphs: true, texture: skinPng }),
    mesh('Eyes', isEye, '#f6f4f0', { bone: headBone }),
    mesh('Iris', (f) => isEye(f) && forward(f), '#4a6fb0', { bone: headBone, offset: 0.0004 }),
  ];
  const raw = writeGlb(bones, meshes, { generator: 'Everloom character base (MakeHuman CC0 data)', extras: { license: 'CC0-1.0', source: 'MakeHuman / MPFB base mesh, targets and game-engine rig (CC0); Face Units 01 by Mika Suominen (CC0)', everloomBase: `anime-${sex === 'female' ? 'f' : 'm'}` } });
  // Sparse morphs and meshopt compression keep the file small.
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(raw);
  // No quantization: the creator builds hair and clothes from the body's own positions, which must
  // stay plain floats in the body's space. Meshopt still compresses the buffers (EXT_meshopt).
  await doc.transform(dedup(), prune({ keepSolidTextures: true }), sparse({ ratio: 1 / 3 }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  const out = Buffer.from(await io.writeBinary(doc));
  const file = `${OUT}/anime-${sex === 'female' ? 'f' : 'm'}.glb`;
  writeFileSync(file, out);
  console.log(`${file}: ${(out.length / 1048576).toFixed(1)} MB (${(raw.length / 1048576).toFixed(1)} MB before), ${Object.keys(keys).length} shape keys, ${bones.length} bones`);
}

mkdirSync(OUT, { recursive: true });
await build('female');
await build('male');
writeFileSync(`${OUT}/LICENSE.txt`, `Everloom character bases (anime-f.glb, anime-m.glb)

Made by tools/avatars/build-character-bases.ts from MakeHuman / MPFB data: the base mesh, its
targets and the game-engine rig with weights (CC0 1.0, the MakeHuman team), and the Face Units 01
expression targets (CC0 1.0, Mika Suominen). Everloom's changes (the anime reshaping, the butt
bones and their weights, the skin texture) are also CC0 1.0.

https://creativecommons.org/publicdomain/zero/1.0/
`);
