import { CharacterSpecSchema } from '@everloom/engine';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { HttpError } from '../../context.js';
import { getKv, setKv } from '../settings.js';
import { newId } from '../../security/crypto.js';

export const CreatorPresetSchema = z.object({ name: z.string().trim().min(1).max(60), kind: z.enum(['character', 'body', 'face', 'outfit']), spec: CharacterSpecSchema });
type Preset = z.infer<typeof CreatorPresetSchema> & { id: string };
const KEY = 'creator-presets';
export const creatorPresets = (ctx: AppContext, owner: string) => getKv<Preset[]>(ctx, owner, KEY, []);
export function saveCreatorPreset(ctx: AppContext, owner: string, input: z.infer<typeof CreatorPresetSchema>) {
  const presets = creatorPresets(ctx, owner);
  if (presets.length >= 100) throw new HttpError(400, 'Remove a preset before adding another (100 maximum).');
  // Pictures dropped into the creator are session-local; a preset keeps colours/patterns.
  const spec = structuredClone(input.spec);
  for (const c of spec.clothes) c.texture = null;
  const preset = { ...input, spec, id: newId('cp_') };
  setKv(ctx, owner, KEY, [...presets, preset]);
  return preset;
}
export function deleteCreatorPreset(ctx: AppContext, owner: string, id: string) {
  setKv(ctx, owner, KEY, creatorPresets(ctx, owner).filter(p => p.id !== id));
  return { ok: true };
}
