/**
 * Code-made avatars: a recipe instead of a model file. The utility model can fill a recipe in from
 * a character's description; whatever it returns is checked field by field against the schema,
 * and anything unusable keeps the value worked out from the text without a model.
 */
import { AvatarConfigSchema, AvatarRecipeSchema, AGE_STAGES, BOTTOMS, EXTRAS, garmentFromItem, GarmentRecipeSchema, HAIR_STYLES, HATS, PATTERNS, recipeFromText, SHOES, TOPS, type AvatarRecipe, type GarmentRecipe } from '@everloom/engine';
import { HttpError, type AppContext } from '../../context.js';
import { newId } from '../../security/crypto.js';
import { utilityJson } from '../utility.js';
import { avatarSummary, getAvatarRow } from './service.js';

export function createCodeAvatar(ctx: AppContext, owner: string, opts: { name?: string; recipe: unknown }) {
  const recipe = AvatarRecipeSchema.safeParse(opts.recipe ?? {});
  if (!recipe.success) throw new HttpError(400, `Invalid recipe: ${recipe.error.issues[0]?.path.join('.')} ${recipe.error.issues[0]?.message}`);
  const id = newId('av_');
  const now = Date.now();
  const config = AvatarConfigSchema.parse({ recipe: recipe.data, look: 'toon' });
  ctx.db
    .prepare('INSERT INTO avatars (id, owner_id, name, kind, status, format, config, info, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, owner, (opts.name ?? '').trim().slice(0, 80) || 'Code-made character', 'code', 'ready', 'code', JSON.stringify(config), '{}', now, now);
  return avatarSummary(getAvatarRow(ctx, owner, id));
}

const SYSTEM = `You describe how a story character looks, for a simple stylised 3D figure. Reply with JSON only, in this shape (every field optional; use only the listed words):
{"body":{"age":${list(AGE_STAGES)},"height":metres 0.8-2.3,"build":0-1 (slender to heavy),"frame":0-1 (0 narrow shoulders and wide hips, 1 broad shoulders),"chest":0-1,"skin":"#rrggbb"},
"face":{"eyes":"#rrggbb","eyeSize":0-1,"blush":true|false},
"hair":{"style":${list(HAIR_STYLES)},"color":"#rrggbb","length":0-1},
"top":{"kind":${list(TOPS)},"color":"#rrggbb","sleeve":0-1},
"bottom":{"kind":${list(BOTTOMS)},"color":"#rrggbb","length":0-1},
"shoes":{"kind":${list(SHOES)},"color":"#rrggbb"},
"hat":{"kind":${list(HATS)},"color":"#rrggbb"},
"extras":[{"kind":${list(EXTRAS)},"color":"#rrggbb"}]}
Pick what the description says; where it says nothing, choose something that suits the character. Children are "child", under 18 "teen".`;

function list(xs: readonly string[]) {
  return xs.map((x) => `"${x}"`).join('|');
}

/** Keeps every part of `candidate` that is valid on its own; the rest comes from `base`. */
export function mergeRecipe(base: AvatarRecipe, candidate: unknown): AvatarRecipe {
  if (!candidate || typeof candidate !== 'object') return base;
  let out: AvatarRecipe = base;
  for (const [k, v] of Object.entries(candidate as Record<string, unknown>)) {
    if (!(k in base) || k === 'v') continue;
    const cur = out[k as keyof AvatarRecipe];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      // Field by field, so one bad colour doesn't lose the rest.
      for (const [f, fv] of Object.entries(v as Record<string, unknown>)) {
        const r = AvatarRecipeSchema.safeParse({ ...out, [k]: { ...(out[k as keyof AvatarRecipe] as object), [f]: fv } });
        if (r.success) out = r.data;
      }
    } else {
      const r = AvatarRecipeSchema.safeParse({ ...out, [k]: v });
      if (r.success) out = r.data;
    }
  }
  return out;
}

/** A recipe for a character: from the utility model when one is set up, else from the text alone. */
export async function fillRecipe(ctx: AppContext, owner: string, input: { name: string; text: string }): Promise<{ recipe: AvatarRecipe; source: 'model' | 'text' }> {
  const base = recipeFromText(input.name, input.text);
  try {
    const j = await utilityJson<unknown>(ctx, owner, SYSTEM, `Character: ${input.name}\n\n${input.text.slice(0, 6000)}`, 700, '3D character look');
    return { recipe: mergeRecipe(base, j), source: 'model' };
  } catch {
    return { recipe: base, source: 'text' };
  }
}

const GARMENT_SYSTEM = `An item in a story is worn by a simple stylised 3D figure. Say what it looks like as ONE garment. Reply with JSON only, one of:
{"slot":"top","kind":${list(TOPS.filter((t) => t !== 'none'))},"color":"#rrggbb","sleeve":0-1,"looseness":0-1,"collar":true|false,"pattern":${list(PATTERNS)}}
{"slot":"bottom","kind":${list(BOTTOMS.filter((t) => t !== 'none'))},"color":"#rrggbb","length":0-1,"looseness":0-1,"pattern":${list(PATTERNS)}}
{"slot":"shoes","kind":${list(SHOES.filter((t) => t !== 'none'))},"color":"#rrggbb"}
{"slot":"hat","kind":${list(HATS.filter((t) => t !== 'none'))},"color":"#rrggbb"}
{"slot":"extra","kind":${list(EXTRAS)},"color":"#rrggbb"}
or {"none":true} if it isn't worn (a weapon, a ring, a potion).`;

export interface ItemInfo {
  name: string;
  desc?: string;
  category?: string;
  slot?: string | null;
  tags?: string[];
}

const keyOf = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 120);

/**
 * The garment an item makes on a code-made character: the rules when they recognise it; otherwise
 * the utility model, once per item name (saved), validated by the schema. Without a model, the
 * rules' best guess for the slot.
 */
export async function garmentForItem(ctx: AppContext, owner: string, item: ItemInfo): Promise<{ garment: GarmentRecipe | null; source: 'rules' | 'model' | 'slot' }> {
  const ruled = garmentFromItem(item);
  if (ruled.sure) return { garment: ruled.garment, source: 'rules' };
  const key = keyOf(item.name);
  const row = ctx.db.prepare('SELECT recipe, source FROM item_garments WHERE owner_id = ? AND key = ?').get(owner, key) as { recipe: string | null; source: string } | undefined;
  if (row) return { garment: row.recipe ? GarmentRecipeSchema.parse(JSON.parse(row.recipe)) : null, source: 'model' };
  try {
    const j = await utilityJson<Record<string, unknown>>(ctx, owner, GARMENT_SYSTEM, `Item: ${item.name}\nCategory: ${item.category ?? 'unknown'}\nWorn on: ${item.slot ?? 'unknown'}\n${(item.desc ?? '').slice(0, 1500)}`, 300, '3D garment for an item');
    const parsed = j && j.none === true ? null : GarmentRecipeSchema.safeParse(j);
    if (parsed && !parsed.success) throw new Error('invalid');
    const garment = parsed ? parsed.data : null;
    ctx.db.prepare('INSERT OR REPLACE INTO item_garments (owner_id, key, recipe, source, created_at) VALUES (?, ?, ?, ?, ?)').run(owner, key, garment ? JSON.stringify(garment) : null, 'model', Date.now());
    return { garment, source: 'model' };
  } catch {
    // No model, or an answer that fails the schema: the slot's plain garment (not saved, so a
    // model set up later still gets asked).
    return { garment: ruled.garment, source: 'slot' };
  }
}

/** A character made in the parts maker: its body part, the parts it wears, and the selection. */
export function createPartsAvatar(ctx: AppContext, owner: string, opts: { name?: string; config: unknown }) {
  const r = AvatarConfigSchema.safeParse(opts.config);
  if (!r.success) throw new HttpError(400, `Invalid avatar settings: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`);
  if (!r.data.maker) throw new HttpError(400, 'A parts-made character needs its parts');
  const ref = r.data.maker.body;
  const media = /^[\w-]{1,64}$/.test(ref) ? ref : null;
  if (media && !ctx.db.prepare("SELECT 1 FROM media WHERE id = ? AND owner_id = ? AND kind LIKE 'model%'").get(media, owner)) throw new HttpError(400, 'The body part is missing');
  const id = newId('av_');
  const now = Date.now();
  ctx.db
    .prepare('INSERT INTO avatars (id, owner_id, name, kind, status, format, model_media, low_media, config, info, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, owner, (opts.name ?? '').trim().slice(0, 80) || 'Parts-made character', 'parts', 'ready', 'glb', media, media, JSON.stringify(r.data), '{}', now, now);
  return avatarSummary(getAvatarRow(ctx, owner, id));
}
