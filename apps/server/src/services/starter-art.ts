/**
 * Everloom's bundled art: backgrounds, the demo character's expressions and other pictures that
 * ship with the web app (art/starter, listed in manifest.json). Nothing is added on its own: the
 * owner adds the pack to their asset library with one button (then it's ordinary assets they can
 * rename, replace or delete), or adds the demo character, which brings its own expressions.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { emptyCardData, type CharacterDTO } from '@everloom/engine';
import { HttpError, type AppContext } from '../context.js';
import { addAsset, listAssets, type AssetType } from './assets.js';
import { createCharacter } from './characters.js';
import { saveImage } from './media.js';

export interface StarterEntry {
  file: string;
  name: string;
  type: AssetType;
  tags: string[];
  set?: string;
  expression?: string;
  /** The starter pack (backgrounds, portraits), the demo character's expressions, or her avatar. */
  pack: 'starter' | 'demo' | 'avatar';
}
export const STARTER_TAG = 'everloom';

function starterDir(ctx: AppContext) {
  return path.join(ctx.cfg.webDir, 'art', 'starter');
}

export function starterManifest(ctx: AppContext): StarterEntry[] {
  const f = path.join(starterDir(ctx), 'manifest.json');
  if (!existsSync(f)) throw new HttpError(404, 'This build has no bundled art (art/starter is missing)', 'no_starter_art');
  const list = JSON.parse(readFileSync(f, 'utf8')) as StarterEntry[];
  // Only plain file names inside the starter folder.
  return list.filter((e) => typeof e.file === 'string' && /^[a-z0-9/_-]+\.(webp|png|jpg)$/i.test(e.file) && !e.file.includes('..'));
}

function readStarter(ctx: AppContext, file: string): Buffer {
  return readFileSync(path.join(starterDir(ctx), file));
}

/** Adds the pictures of one pack to the asset library; ones already there (same name, tagged everloom) are skipped. */
export async function installStarter(ctx: AppContext, owner: string, pack: 'starter' | 'demo' = 'starter'): Promise<{ added: number; skipped: number; ids: Record<string, string> }> {
  const have = new Map(listAssets(ctx, owner, { tag: STARTER_TAG }).assets.map((a) => [a.name, a.id]));
  const ids: Record<string, string> = {};
  let added = 0;
  let skipped = 0;
  for (const e of starterManifest(ctx).filter((x) => x.pack === pack)) {
    const existing = have.get(e.name);
    if (existing) {
      ids[e.file] = existing;
      skipped++;
      continue;
    }
    const a = await addAsset(ctx, owner, readStarter(ctx, e.file), { name: e.name, type: e.type, tags: [STARTER_TAG, ...e.tags], set: e.set, expression: e.expression });
    ids[e.file] = a.id;
    added++;
  }
  return { added, skipped, ids };
}

/** Mira Vale, an original all-ages demo character with an expression set. */
export async function addDemoCharacter(ctx: AppContext, owner: string): Promise<CharacterDTO> {
  const manifest = starterManifest(ctx);
  const { ids } = await installStarter(ctx, owner, 'demo');
  const expressions: Record<string, string> = {};
  for (const e of manifest) if (e.pack === 'demo' && e.expression && ids[e.file]) expressions[e.expression] = ids[e.file]!;
  const portrait = manifest.find((e) => e.pack === 'avatar') ?? manifest.find((e) => e.pack === 'demo' && e.expression === 'neutral');
  const avatar = portrait ? (await saveImage(ctx, owner, readStarter(ctx, portrait.file), { kind: 'avatar', maxDim: 1536 })).id : null;
  const card = {
    ...emptyCardData('Mira Vale'),
    description:
      "Mira Vale is a travelling cartographer in her late twenties who maps the roads, rivers and half-forgotten paths between towns. She wears a teal travelling coat with a high collar, keeps a brass compass on a cord around her neck and a pencil behind her ear, and carries a satchel of rolled maps. She is curious, warm and a little stubborn; she would rather walk an extra day to check a bridge than draw it from hearsay. She loves good tea, bad puns and the first view from the top of a hill.",
    personality: 'curious, warm, patient, quietly stubborn, observant, gently teasing, honest',
    scenario: "{{user}} has just met Mira at a crossroads inn. She's looking for a travelling companion to help her survey the old north road before the autumn rains.",
    first_mes:
      '*A woman in a teal coat looks up from a map spread across the inn table, pencil between her teeth. She takes it out and smiles.* "You look like someone who knows how to read a road. I\'m Mira — I draw maps, mostly of places people stopped bothering to draw. Care to sit? I\'m trying to decide whether this line is a river or a coffee stain."',
    mes_example:
      '<START>\n{{user}}: Why maps?\n{{char}}: *She turns her compass over in her fingers.* "Because a good map is a promise. It says: someone walked here, and you can too. And because I get lost easily, and this way it\'s my job."',
    creator_notes: "Everloom's demo character. Her pictures and expressions were generated for Everloom (see CREDITS); replace them in the character's editor or the asset library whenever you like.",
    tags: ['demo', 'adventure', 'wholesome', 'fantasy'],
    creator: 'Everloom',
  };
  return createCharacter(ctx, owner, card, { avatar, game: { expressions } });
}
