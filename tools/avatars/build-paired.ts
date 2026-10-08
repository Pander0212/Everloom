/**
 * Compiles the authored paired animations (paired.ts) into paired clip files.
 * Run: npx tsx tools/avatars/build-paired.ts
 * Output: apps/web/public/avatar/clips/paired/<id>.json (checked against PairedClipSchema).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PairedClipSchema } from '@everloom/engine';
import { decodeClip, type Clip, type ClipJSON } from '../../apps/web/src/features/avatar3d/runtime/clip';
import { compile } from './author';
import { PAIRED } from './paired';

const CLIPS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../apps/web/public/avatar/clips');
const OUT = path.join(CLIPS, 'paired');
mkdirSync(OUT, { recursive: true });
const clips: Record<string, Clip> = {};
for (const f of readdirSync(CLIPS)) if (f.endsWith('.json') && f !== 'bundled.json' && f !== 'authored.json') clips[f.slice(0, -5)] = decodeClip(JSON.parse(readFileSync(path.join(CLIPS, f), 'utf8')) as ClipJSON);

for (const p of PAIRED) {
  const file = PairedClipSchema.parse({
    v: 1,
    id: p.id,
    label: p.label,
    aliases: p.aliases,
    loop: p.loop,
    adult: false,
    source: 'Everloom (authored, CC0)',
    roles: p.roles.map((r, i) => ({ name: r.name, offset: r.offset, yaw: r.yaw, clip: compile({ ...r.clip, id: `${p.id}_${i}`, loop: p.loop }, clips) })),
    contacts: p.contacts,
  });
  const json = JSON.stringify(file);
  writeFileSync(path.join(OUT, `${p.id}.json`), json);
  console.log(`${p.id} ${file.roles.length} roles ${Math.round(json.length / 1024)} KB`);
}
