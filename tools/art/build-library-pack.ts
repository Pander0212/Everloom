/**
 * Builds the parts-library packs from the processed Tripo parts (tools/art/tripo-process.py): one
 * pack per base body, in the CharacterStudio layout the parts maker imports (Settings › Part packs).
 * The packs hold the owner's Tripo outputs and stay private: they are written to
 * ~/Everloom-Tripo/packs, never the repository.
 *
 *   npx tsx tools/art/build-library-pack.ts [--rating all-ages|adult] [--in ~/Everloom-Tripo/processed] [--out ~/Everloom-Tripo/packs]
 *
 * A part is in a pack when it was processed for that base and is kept in docs/art/TRIPO_LEDGER.md
 * ("yes"; --pending also takes items still under review); 18+ parts (the queue's `adult` flag) go only into the adult pack, which also carries
 * every all-ages part.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { PackManifestSchema, packProblems, type PackManifest } from '@everloom/engine';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const home = os.homedir();
const IN = path.resolve(arg('in', path.join(home, 'Everloom-Tripo', 'processed')));
const OUT = path.resolve(arg('out', path.join(home, 'Everloom-Tripo', 'packs')));
const RATING = arg('rating', 'all-ages');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASES = ['anime-f', 'anime-m'];

// Trait groups by slot, in the order the maker lists them.
const GROUP: Record<string, { trait: string; name: string }> = {
  hair: { trait: 'HAIR', name: 'Hair' },
  head: { trait: 'HEAD', name: 'Hats and headwear' },
  top: { trait: 'TOP', name: 'Tops' },
  outer: { trait: 'OUTER', name: 'Jackets and coats' },
  full: { trait: 'FULL', name: 'Dresses and suits' },
  bottom: { trait: 'BOTTOM', name: 'Skirts and trousers' },
  feet: { trait: 'FEET', name: 'Shoes' },
  hands: { trait: 'HANDS', name: 'Gloves' },
};

/** Ledger rows: item → kept. */
function kept(): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const line of readFileSync(path.join(ROOT, 'docs/art/TRIPO_LEDGER.md'), 'utf8').split('\n')) {
    const c = line.split('|').map((s) => s.trim());
    if (/^\d+$/.test(c[1] ?? '')) out.set(c[3]!, /^yes/i.test(c[7] ?? ''));
  }
  return out;
}

const queue = JSON.parse(readFileSync(path.join(ROOT, 'docs/art/parts-queue.json'), 'utf8')) as { items: Array<{ id: string; category: string; subject: string; adult?: boolean }> };
const title = (id: string) => id.replace(/^[a-z]+-/, '').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

async function main() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const keep = kept();
  mkdirSync(OUT, { recursive: true });
  for (const base of BASES) {
    const files: Record<string, Uint8Array> = {};
    const groups = new Map<string, PackManifest['traits'][number]>();
    files[`body/${base}.glb`] = readFileSync(path.join(ROOT, 'apps/web/public/avatar/bases', `${base}.glb`));
    const skipped: string[] = [];
    for (const name of readdirSync(IN).sort()) {
      const report = path.join(IN, name, `${base}.json`);
      if (!existsSync(report)) continue;
      const r = JSON.parse(readFileSync(report, 'utf8')) as { slot: string; colour?: string; chains?: number };
      const q = queue.items.find((x) => x.id === name);
      if (!keep.get(name) && !(process.argv.includes("--pending") && keep.has(name))) { skipped.push(`${name} (not kept in the ledger)`); continue; }
      if (q?.adult && RATING !== 'adult') continue;
      const g = GROUP[r.slot];
      if (!g) { skipped.push(`${name} (slot ${r.slot})`); continue; }
      const doc = await io.read(path.join(IN, name, `${base}.glb`));
      await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
      files[`${g.trait.toLowerCase()}/${name}.glb`] = await io.writeBinary(doc);
      files[`thumbnails/${name}.webp`] = await sharp(path.join(IN, name, `${base}.png`)).resize(256, 256).webp({ quality: 82 }).toBuffer();
      if (!groups.has(g.trait)) groups.set(g.trait, { trait: g.trait, name: g.name, collection: [] } as never);
      groups.get(g.trait)!.collection.push({ id: name, name: q?.subject ? title(name) : name, directory: `${g.trait.toLowerCase()}/${name}.glb`, thumbnail: `thumbnails/${name}.webp`, type: q?.adult ? ['adult'] : [] } as never);
    }
    if (!groups.size) { console.log(`${base}: no kept parts yet`); continue; }
    const order = Object.values(GROUP).map((g) => g.trait);
    const manifest: PackManifest = PackManifestSchema.parse({
      traitsDirectory: './',
      thumbnailsDirectory: './',
      traits: [{ trait: 'BODY', name: 'Body', collection: [{ id: base, name: base === 'anime-f' ? 'Anime (feminine)' : 'Anime (masculine)', directory: `body/${base}.glb` }] }, ...[...groups.values()].sort((a, b) => order.indexOf(a.trait) - order.indexOf(b.trait))],
      everloom: {
        name: `Everloom Library — ${base}${RATING === 'adult' ? ' (18+)' : ''}`,
        license: 'Private: the owner’s Tripo AI outputs (Tripo terms §5.2.2). Not for redistribution.',
        credits: 'Reference images from NanoGPT (free models); 3D by Tripo AI Studio; fitted, rigged and given swing chains by tools/art/tripo-process.py.',
        slots: Object.fromEntries(Object.entries(GROUP).map(([slot, g]) => [g.trait, slot])),
        bodyGroup: 'BODY',
      },
    });
    const problems = packProblems(manifest, (p) => p in files);
    if (problems.length) throw new Error(`${base}: ${problems.join('; ')}`);
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 1));
    const zip = zipSync(files, { level: 0 });
    const out = path.join(OUT, `everloom-library-${base}${RATING === 'adult' ? '-18plus' : ''}.zip`);
    writeFileSync(out, zip);
    const parts = [...groups.values()].reduce((a, g) => a + g.collection.length, 0);
    console.log(`${out}: ${parts} parts, ${(zip.length / 1e6).toFixed(1)} MB${skipped.length ? `; skipped ${skipped.join(', ')}` : ''}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
