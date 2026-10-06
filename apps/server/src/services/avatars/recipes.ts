/**
 * Code-made avatars: a recipe instead of a model file. The utility model can fill a recipe in from
 * a character's description; whatever it returns is checked field by field against the schema,
 * and anything unusable keeps the value worked out from the text without a model.
 */
import { AvatarConfigSchema, AvatarRecipeSchema, AGE_STAGES, BOTTOMS, EXTRAS, HAIR_STYLES, HATS, recipeFromText, SHOES, TOPS, type AvatarRecipe } from '@everloom/engine';
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
