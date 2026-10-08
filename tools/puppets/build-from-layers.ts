/**
 * A See-through result folder → a rigged puppet, with the same code the server's "make a puppet
 * from a picture" job uses (apps/server/src/services/puppets/build.ts):
 *
 *   npx tsx tools/puppets/build-from-layers.ts <result dir> <name> <out dir> [--title X] [--rating 18+] [--bounce 1.3]
 *
 * The result dir holds `<name>/layers.json` + layer PNGs (the worker writes them; for an older
 * result, `python3 tools/puppets/export-layers.py <psd> <result dir>/<name>` does) and optionally
 * `<name>/topwear_depth.png`. Output is art: keep it out of the repository.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { puppetFromLayers } from '../../apps/server/src/services/puppets/build.js';

const { values: o, positionals: [root, name, out] } = parseArgs({ allowPositionals: true, options: { title: { type: 'string' }, rating: { type: 'string' }, bounce: { type: 'string' } } });
if (!root || !name || !out) { console.error('usage: build-from-layers.ts <result dir> <name> <out dir> [--title X] [--rating 18+] [--bounce 1.3]'); process.exit(1); }
const read = (p: string) => { const f = path.join(root, p); return existsSync(f) ? readFileSync(f) : null; };
const t0 = Date.now();
const r = await puppetFromLayers(read, name, { id: name, title: o.title ?? name, rating: o.rating === '18+' ? '18+' : 'all-ages', bounce: o.bounce ? Number(o.bounce) : undefined });
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'puppet.json'), r.json);
r.pages.forEach((p, i) => writeFileSync(path.join(out, `page${i}.png`), p));
console.log(`${name}: ${r.model.parts.length} parts, ${r.pages.length} page(s), tags ${r.tags.join(', ')}; ${Date.now() - t0} ms`);
