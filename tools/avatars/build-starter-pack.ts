/**
 * Builds "Everloom Basics", the starter part pack, from the code-made generator: two bodies (with
 * faces), hairstyles, tops, bottoms, shoes and hats, each a separate rigged GLB on the same skeleton,
 * in the CharacterStudio pack layout (manifest.json + files). Everything is made by this code, so
 * the pack is CC0.
 *
 *   npx tsx tools/avatars/build-starter-pack.ts [out dir]   (default apps/web/public/avatar/packs/basics)
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { AvatarRecipeSchema, type AvatarRecipe, type PackManifest } from '@everloom/engine';
import { planBody } from '../../apps/web/src/features/avatar3d/runtime/codemade/body';
import { buildFace, FACE_EXPRESSIONS, FACE_MORPHS } from '../../apps/web/src/features/avatar3d/runtime/codemade/face';
import { skin } from '../../apps/web/src/features/avatar3d/runtime/codemade/geometry';
import { mesh as meshField } from '../../apps/web/src/features/avatar3d/runtime/codemade/mesher';
import { planOutfit, type Part } from '../../apps/web/src/features/avatar3d/runtime/codemade/outfit';
import { writeGlb, type GlbBone, type GlbMesh } from './glb-writer';

const OUT = path.resolve(process.argv[2] ?? 'apps/web/public/avatar/packs/basics');
const BASE = { body: { age: 'adult', height: 1.68, build: 0.4, frame: 0.5, chest: 0.5, skin: '#e8bfa0' }, top: { kind: 'none' }, bottom: { kind: 'none' }, shoes: { kind: 'none' }, hair: { style: 'none' }, hat: { kind: 'none' } } as const;
const recipe = (patch: Record<string, unknown>) => AvatarRecipeSchema.parse({ ...structuredClone(BASE), ...patch });
const GREY = '#d8d4cc';

function skeleton(r: AvatarRecipe, chains: Array<{ name: string; parent: string; points: [number, number, number][] }>) {
  const plan = planBody(r);
  const depth = (k: string) => {
    let d = 0;
    for (let p = plan.parent[k]; p; p = plan.parent[p]) d++;
    return d;
  };
  const bones: GlbBone[] = Object.keys(plan.joints)
    .sort((a, b) => depth(a) - depth(b))
    .map((name) => ({ name, parent: plan.parent[name] ?? null, at: plan.joints[name]! }));
  for (const c of chains) c.points.forEach((at, i) => bones.push({ name: `${c.name}_${i}`, parent: i === 0 ? c.parent : `${c.name}_${i - 1}`, at }));
  return { plan, bones, index: new Map(bones.map((b, i) => [b.name, i])) };
}

function partMeshes(r: AvatarRecipe, names: RegExp, color: string | null) {
  const plan = planBody(r);
  const outfit = planOutfit(plan, r);
  const parts = outfit.parts.filter((p) => names.test(p.name));
  const chains = outfit.chains.filter((c) => parts.some((p) => (p.weights ?? p.field.shapes).some((s) => s.bone.startsWith(`${c.name}_`))));
  const { bones, index } = skeleton(r, chains);
  const meshes: GlbMesh[] = parts.map((p: Part) => {
    const m = meshField(p.field, p.cell * plan.H);
    const sk = skin(m, p.weights ?? [...p.field.shapes, ...plan.shapes], index, (p.sigma ?? 0.016) * plan.H, p.covers ? (p.field.offset ?? 0) : 0);
    return { name: p.name, ...sk, color: color ?? p.color, roughness: p.roughness, metalness: p.metalness };
  });
  return { bones, meshes };
}

async function bodyGlb(r: AvatarRecipe) {
  const { plan, bones, index } = skeleton(r, []);
  const body = meshField({ shapes: plan.shapes, blend: plan.blend }, 0.009 * plan.H);
  const meshes: GlbMesh[] = [{ name: 'Body', ...skin(body, plan.shapes, index, 0.016 * plan.H), color: r.body.skin, roughness: 0.7 }];
  // Underwear is part of every body (all-ages bodies).
  for (const p of planOutfit(plan, r).parts.filter((p) => /^Underwear/.test(p.name))) {
    const m = meshField(p.field, p.cell * plan.H);
    meshes.push({ name: p.name, ...skin(m, plan.shapes, index, 0.016 * plan.H, p.field.offset ?? 0), color: p.color, roughness: 0.85 });
  }
  // The face, with morphs named the way any model's are (visemes, blinks, feelings).
  const f = buildFace(plan, r);
  const fn = f.positions.length / 3;
  const head = index.get('head')!;
  const skinIndex = new Uint16Array(fn * 4);
  const skinWeight = new Float32Array(fn * 4);
  for (let v = 0; v < fn; v++) {
    skinIndex[v * 4] = head;
    skinWeight[v * 4] = 1;
  }
  const morphs: Record<string, Float32Array> = {};
  const NAMES: Record<string, string> = { joy: 'joy', amusement: 'fun', anger: 'angry', sadness: 'sad', surprise: 'surprised', embarrassment: 'shy', fear: 'fear', disgust: 'disgust', confusion: 'confused', love: 'love', pride: 'proud', aa: 'aa', ih: 'ih', ou: 'ou', ee: 'ee', oh: 'oh', blink: 'blink', blinkLeft: 'blinkLeft', blinkRight: 'blinkRight' };
  for (const [canon, name] of Object.entries(NAMES)) {
    const mix = FACE_EXPRESSIONS[canon as keyof typeof FACE_EXPRESSIONS]!;
    const out = new Float32Array(fn * 3);
    for (const { morph, weight } of mix) {
      const d = f.morphs[morph as (typeof FACE_MORPHS)[number]]!;
      for (let i = 0; i < out.length; i++) out[i] += d[i]! * weight;
    }
    morphs[name] = out;
  }
  const png = await sharp(Buffer.from(f.palette), { raw: { width: f.paletteWidth, height: 1, channels: 4 } }).png().toBuffer();
  meshes.push({ name: 'face_overlay', positions: f.positions, normals: f.normals, indices: f.indices, skinIndex, skinWeight, uvs: f.uvs, color: '#ffffff', roughness: 0.9, texture: png, morphs });
  return writeGlb(bones, meshes, { generator: 'Everloom code-made' });
}

type Item = { id: string; name: string; recipe: Record<string, unknown>; parts: RegExp; type?: string[] };
const GROUPS: Array<{ trait: string; name: string; colors: string; items: Item[] }> = [
  {
    trait: 'HAIR',
    name: 'Hair',
    colors: 'HAIR_COLORS',
    items: ['short', 'buzz', 'bob', 'long', 'ponytail', 'bun', 'twintails', 'spiky', 'curly'].map((s) => ({ id: s, name: s[0]!.toUpperCase() + s.slice(1), recipe: { hair: { style: s, color: '#4a3021', length: 0.6 } }, parts: /^Hair$/ })),
  },
  {
    trait: 'TOP',
    name: 'Tops',
    colors: 'CLOTH_COLORS',
    items: [
      { id: 'tshirt', name: 'T-shirt', recipe: { top: { kind: 'tshirt', color: GREY } }, parts: /^Top$/ },
      { id: 'shirt', name: 'Shirt', recipe: { top: { kind: 'shirt', color: GREY, sleeve: 0.9, collar: true } }, parts: /^(Top|Collar)$/ },
      { id: 'tank', name: 'Tank top', recipe: { top: { kind: 'tank', color: GREY } }, parts: /^Top$/ },
      { id: 'sweater', name: 'Sweater', recipe: { top: { kind: 'sweater', color: GREY, looseness: 0.5 } }, parts: /^Top$/ },
      { id: 'jacket', name: 'Jacket', recipe: { top: { kind: 'jacket', color: GREY } }, parts: /^(Top|Collar)$/ },
      { id: 'robe', name: 'Robe', recipe: { top: { kind: 'robe', color: GREY } }, parts: /^(Top|Skirt|Collar)$/ },
      { id: 'armor', name: 'Armour', recipe: { top: { kind: 'armor', color: '#8a8f99' } }, parts: /^(Top|PadL|PadR)$/, type: ['armor'] },
    ],
  },
  {
    trait: 'BOTTOM',
    name: 'Bottoms',
    colors: 'CLOTH_COLORS',
    items: [
      { id: 'pants', name: 'Trousers', recipe: { bottom: { kind: 'pants', color: GREY } }, parts: /^Bottom$/ },
      { id: 'shorts', name: 'Shorts', recipe: { bottom: { kind: 'shorts', color: GREY, length: 0.3 } }, parts: /^Bottom$/ },
      { id: 'skirt', name: 'Skirt', recipe: { bottom: { kind: 'skirt', color: GREY, length: 0.6 } }, parts: /^Skirt$/ },
      { id: 'long_skirt', name: 'Long skirt', recipe: { bottom: { kind: 'long_skirt', color: GREY } }, parts: /^Skirt$/ },
    ],
  },
  {
    trait: 'SHOES',
    name: 'Shoes',
    colors: 'LEATHER_COLORS',
    items: ['shoes', 'boots', 'sandals'].map((k) => ({ id: k, name: k[0]!.toUpperCase() + k.slice(1), recipe: { shoes: { kind: k, color: '#5a4030' } }, parts: /^Shoes$/ })),
  },
  {
    trait: 'HAT',
    name: 'Hats',
    colors: 'CLOTH_COLORS',
    items: ['cap', 'beanie', 'wizard', 'hood', 'crown', 'headband', 'helmet'].map((k) => ({ id: k, name: k[0]!.toUpperCase() + k.slice(1), recipe: { hat: { kind: k, color: k === 'helmet' ? '#8a8f99' : GREY } }, parts: /^Hat$/, ...(['beanie', 'hood', 'helmet', 'cap'].includes(k) ? { type: ['hides-hair'] } : {}) })),
  },
  {
    trait: 'EXTRA',
    name: 'Extras',
    colors: 'CLOTH_COLORS',
    items: [
      { id: 'cape', name: 'Cape', recipe: { extras: [{ kind: 'cape', color: GREY }] }, parts: /^Cape$/ },
      { id: 'scarf', name: 'Scarf', recipe: { extras: [{ kind: 'scarf', color: GREY }] }, parts: /^Scarf$/ },
      { id: 'glasses', name: 'Glasses', recipe: { extras: [{ kind: 'glasses', color: '#2a2a2a' }] }, parts: /^eye_glasses$/ },
      { id: 'apron', name: 'Apron', recipe: { extras: [{ kind: 'apron', color: GREY }] }, parts: /^Apron$/ },
    ],
  },
];

/** meshopt compression (quantized, like the import optimizer does): about a fifth of the size. */
let io: NodeIO | null = null;
async function compress(glb: Buffer): Promise<Buffer> {
  if (!io) {
    await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
    io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  }
  const doc = await io.readBinary(new Uint8Array(glb));
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  return Buffer.from(await io.writeBinary(doc));
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(path.join(OUT, 'traits'), { recursive: true });
  const write = async (rel: string, raw: Buffer) => {
    const buf = await compress(raw);
    mkdirSync(path.dirname(path.join(OUT, 'traits', rel)), { recursive: true });
    writeFileSync(path.join(OUT, 'traits', rel), buf);
    return buf.length;
  };
  let total = 0;
  const bodies = [
    { id: 'soft', name: 'Soft', chest: 0.55, frame: 0.5 },
    { id: 'straight', name: 'Straight', chest: 0.05, frame: 0.5 },
  ];
  for (const b of bodies) total += await write(`body/${b.id}.glb`, await bodyGlb(recipe({ body: { ...BASE.body, chest: b.chest, frame: b.frame } })));
  const manifest: PackManifest & Record<string, unknown> = {
    traitsDirectory: 'traits',
    thumbnailsDirectory: 'thumbnails',
    displayScale: 1,
    initialTraits: { BODY: 'soft', HAIR: 'short', TOP: 'shirt', BOTTOM: 'pants', SHOES: 'shoes' },
    requiredTraits: ['BODY'],
    randomTraits: ['HAIR', 'TOP', 'BOTTOM', 'SHOES'],
    defaultCullingLayer: -1,
    traits: [
      { trait: 'BODY', name: 'Body', cameraTarget: { distance: 3, height: 0.9 }, collection: bodies.map((b) => ({ id: b.id, name: b.name, directory: `body/${b.id}.glb`, thumbnail: `body/${b.id}.png`, colorCollection: 'SKIN_COLORS' })) },
    ],
    colorCollections: [
      { trait: 'SKIN_COLORS', collection: ['#f6d7c3', '#eec1a1', '#e0ac8a', '#c98e6b', '#a8704f', '#8a5a3c', '#6b4329', '#4d2f1d'].map((v, i) => ({ id: `skin${i + 1}`, name: `Skin ${i + 1}`, value: v })) },
      { trait: 'HAIR_COLORS', collection: Object.entries({ black: '#1d1a19', brown: '#4a3021', auburn: '#8a3b22', red: '#a8371f', blonde: '#d9b56c', white: '#ece9e2', blue: '#3b5ba8', pink: '#d37aa0' }).map(([id, value]) => ({ id, name: id[0]!.toUpperCase() + id.slice(1), value })) },
      { trait: 'CLOTH_COLORS', collection: Object.entries({ cream: '#d8d2c4', navy: '#2a3a5a', sky: '#5b7fa6', forest: '#2f4a3a', moss: '#5ba67a', wine: '#8a2a2a', rose: '#a65b5b', ochre: '#a6935b', violet: '#7a5ba6', charcoal: '#3d3a4a', steel: '#8a8f99' }).map(([id, value]) => ({ id, name: id[0]!.toUpperCase() + id.slice(1), value })) },
      { trait: 'LEATHER_COLORS', collection: Object.entries({ brown: '#5a4030', dark: '#2a2220', tan: '#a07850', black: '#1e1c1c' }).map(([id, value]) => ({ id, name: id[0]!.toUpperCase() + id.slice(1), value })) },
    ],
    everloom: { name: 'Everloom Basics', license: 'CC0 1.0', credits: 'Made by Everloom’s code-made character generator (tools/avatars/build-starter-pack.ts).', bodyGroup: 'BODY', slots: { HAIR: 'hair', TOP: 'top', BOTTOM: 'bottom', SHOES: 'feet', HAT: 'head', EXTRA: 'outer' } },
  };
  for (const g of GROUPS) {
    const collection = [];
    for (const it of g.items) {
      const { bones, meshes } = partMeshes(recipe(it.recipe), it.parts, null);
      if (!meshes.length) throw new Error(`${g.trait}/${it.id}: no meshes`);
      total += await write(`${g.trait.toLowerCase()}/${it.id}.glb`, writeGlb(bones, meshes, { generator: 'Everloom code-made' }));
      collection.push({ id: it.id, name: it.name, directory: `${g.trait.toLowerCase()}/${it.id}.glb`, thumbnail: `${g.trait.toLowerCase()}/${it.id}.png`, colorCollection: g.colors, ...(it.type ? { type: it.type } : {}) });
    }
    manifest.traits.push({ trait: g.trait, name: g.name, collection });
  }
  writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(path.join(OUT, 'LICENSE.txt'), 'Everloom Basics part pack\n\nCC0 1.0 Universal (public domain dedication): https://creativecommons.org/publicdomain/zero/1.0/\nGenerated entirely by Everloom code (tools/avatars/build-starter-pack.ts); no third-party assets.\n');
  console.log(`pack written to ${OUT}: ${(total / 1024).toFixed(0)} KB of models`);
}

void main();
