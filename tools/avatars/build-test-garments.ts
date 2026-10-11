/**
 * Unrigged test garments for browser fitting, from MakeHuman's CC0 system assets (the bundled pack)
 * plus one made here: a shirt and trousers cut from a casual suit at the waist, shoes, long hair,
 * and a flared skirt. They're written the way garments bought elsewhere arrive: OBJ in centimetres,
 * centred on their own origin, with no skeleton, so they have to be placed by hand.
 *
 *   npx tsx tools/avatars/build-test-garments.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import sharp from 'sharp';

const pack = unzipSync(readFileSync('apps/web/public/avatar/makehuman-system.zip'));
const core = unzipSync(readFileSync('apps/web/public/avatar/makehuman-core.zip'));
const coreText = (suffix: string) => strFromU8(Object.entries(core).find(([k]) => k.endsWith(suffix))![1]);
const file = (path: string) => { const f = pack[path]; if (!f) throw new Error(`Missing in the system pack: ${path}`); return f; };

interface Obj { v: number[][]; vt: number[][]; f: Array<Array<[number, number]>> }
function parse(text: string): Obj {
  const o: Obj = { v: [], vt: [], f: [] };
  for (const line of text.split(/\r?\n/)) {
    const [k, ...p] = line.trim().split(/\s+/);
    if (k === 'v') o.v.push(p.slice(0, 3).map(Number));
    else if (k === 'vt') o.vt.push(p.slice(0, 2).map(Number));
    else if (k === 'f') o.f.push(p.map((s) => { const [a, b] = s.split('/'); return [Number(a) - 1, b ? Number(b) - 1 : -1] as [number, number]; }));
  }
  return o;
}

// The body these were made for (MakeHuman's base, decimetres): where its waist and knees are.
const base = parse(coreText('3dobjs/base.obj'));
const ys = base.v.map((p) => p[1]!);
const floor = Math.min(...ys), height = Math.max(...ys) - floor;
const waist = floor + height * 0.585;

function write(name: string, o: Obj, faces: Obj['f'], material: { texture?: Uint8Array; color?: string }) {
  // Only the vertices these faces use, in centimetres, centred on the garment's own middle.
  const used = [...new Set(faces.flat().map(([v]) => v))];
  const remap = new Map(used.map((v, i) => [v, i]));
  const pts = used.map((v) => o.v[v]!.map((x) => x * 10));
  const mid = [0, 1, 2].map((a) => (Math.min(...pts.map((p) => p[a]!)) + Math.max(...pts.map((p) => p[a]!))) / 2);
  const out = [`# ${name}: test garment for Everloom's browser fitting. CC0 (MakeHuman system assets or made by Everloom).`, `mtllib ${name}.mtl`, `o ${name}`];
  for (const p of pts) out.push(`v ${(p[0]! - mid[0]!).toFixed(3)} ${(p[1]! - mid[1]!).toFixed(3)} ${(p[2]! - mid[2]!).toFixed(3)}`);
  for (const t of o.vt) out.push(`vt ${t[0]!.toFixed(5)} ${t[1]!.toFixed(5)}`);
  out.push(`usemtl ${name}`);
  for (const f of faces) out.push(`f ${f.map(([v, t]) => (t >= 0 ? `${remap.get(v)! + 1}/${t + 1}` : `${remap.get(v)! + 1}`)).join(' ')}`);
  const dir = `tests/fixtures/avatars/garments/${name}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${name}.obj`, out.join('\n') + '\n');
  const mtl = [`newmtl ${name}`, `Kd ${material.color ?? '1 1 1'}`];
  if (material.texture) { mtl.push(`map_Kd ${name}.png`); writeFileSync(`${dir}/${name}.png`, material.texture); }
  writeFileSync(`${dir}/${name}.mtl`, mtl.join('\n') + '\n');
  console.log(`${name}: ${used.length} vertices, ${faces.length} faces, ${(Math.max(...pts.map((p) => p[1]!)) - Math.min(...pts.map((p) => p[1]!))).toFixed(1)} cm tall`);
}
const texture = async (path: string) => new Uint8Array(await sharp(Buffer.from(file(path))).resize(512, 512, { fit: 'fill' }).png({ compressionLevel: 9 }).toBuffer());
const centreY = (o: Obj, f: Obj['f'][number]) => f.reduce((s, [v]) => s + o.v[v]![1]!, 0) / f.length;

// Shirt and trousers: the casual suit cut at the waist, with a little overlap.
const suit = parse(strFromU8(file('clothes/female_casualsuit01/female_casualsuit01.obj')));
const suitTex = await texture('clothes/female_casualsuit01/female_casualsuit01_diffuse.png');
write('shirt', suit, suit.f.filter((f) => centreY(suit, f) > waist - 0.25), { texture: suitTex });
write('trousers', suit, suit.f.filter((f) => centreY(suit, f) < waist + 0.25), { texture: suitTex });

// Shoes and long hair as they come.
const shoes = parse(strFromU8(file('clothes/shoes01/shoes01.obj')));
write('shoes', shoes, shoes.f, { texture: await texture('clothes/shoes01/shoes01_diffuse.png') });
const hair = parse(strFromU8(file('hair/long01/long01.obj')));
write('long-hair', hair, hair.f, { texture: await texture('hair/long01/long01_diffuse.png') });

// A flared skirt (made here): a waistband at the suit's waist, flaring out to just above the knee.
{
  const around = 48, down = 12;
  const band = suit.v.filter((p) => Math.abs(p[1]! - waist) < 0.1);
  const cx = band.reduce((s, p) => s + p[0]!, 0) / band.length, cz = band.reduce((s, p) => s + p[2]!, 0) / band.length;
  const rx = Math.max(...band.map((p) => Math.abs(p[0]! - cx))) * 1.04, rz = Math.max(...band.map((p) => Math.abs(p[2]! - cz))) * 1.06;
  const hem = floor + height * 0.36;
  const o: Obj = { v: [], vt: [], f: [] };
  for (let j = 0; j <= down; j++) {
    const t = j / down, y = waist + 0.15 + (hem - waist - 0.15) * t, flare = 1 + 0.75 * t * t * 0.6 + 0.35 * t;
    for (let i = 0; i <= around; i++) {
      const a = (i / around) * Math.PI * 2;
      o.v.push([cx + Math.sin(a) * rx * flare, y, cz + Math.cos(a) * rz * flare]);
      o.vt.push([i / around, 1 - t]);
    }
  }
  for (let j = 0; j < down; j++) for (let i = 0; i < around; i++) {
    const a = j * (around + 1) + i, b = a + 1, c = a + around + 1, d = c + 1;
    o.f.push([[a, a], [c, c], [d, d], [b, b]]);
  }
  write('skirt', o, o.f, { color: '0.55 0.18 0.24' });
}
