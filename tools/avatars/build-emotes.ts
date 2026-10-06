/**
 * Compiles the authored emotes (emotes.ts) into clip files beside the bundled ones, plus the two
 * derived from bundled clips: lie_down (getting up, reversed) and sleep (lying still).
 * Run: npx tsx tools/avatars/build-emotes.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeClip, type Clip, type ClipJSON } from '../../apps/web/src/features/avatar3d/runtime/clip';
import { compile, reversed, still } from './author';
import { AUTHORED } from './emotes';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../apps/web/public/avatar/clips');
const read = (id: string) => JSON.parse(readFileSync(path.join(OUT, `${id}.json`), 'utf8')) as ClipJSON;
const clips: Record<string, Clip> = {};
for (const f of readdirSync(OUT)) if (f.endsWith('.json') && f !== 'bundled.json' && f !== 'authored.json') clips[f.slice(0, -5)] = decodeClip(read(f.slice(0, -5)));

const out: ClipJSON[] = AUTHORED.map((a) => compile(a, clips));
const getUp = read('lie_to_idle');
out.push({ ...reversed('lie_down', getUp), source: 'Everloom (from Quaternius UAL2 LayToIdle, CC0)' });
out.push({ ...still('sleep', getUp, 0), source: 'Everloom (from Quaternius UAL2 LayToIdle, CC0)' });

const index = out.map((c) => {
  const json = JSON.stringify(c);
  writeFileSync(path.join(OUT, `${c.id}.json`), json);
  return { id: c.id, frames: c.frames, seconds: Math.round((c.frames / c.fps) * 100) / 100, bytes: json.length, loop: c.loop };
});
writeFileSync(path.join(OUT, 'authored.json'), JSON.stringify(index, null, 1));
console.log(index.map((i) => `${i.id} ${i.seconds}s ${Math.round(i.bytes / 1024)}KB`).join('\n'));
