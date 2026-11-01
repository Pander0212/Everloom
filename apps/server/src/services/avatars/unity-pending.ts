import { z } from 'zod';
import { HttpError, type AppContext } from '../../context.js';
import { newId } from '../../security/crypto.js';
import { getKv, setKv } from '../settings.js';
import { getAvatarRow } from './service.js';
import { libraryManifest } from './unity-library.js';

export const UnityPendingSchema = z.object({
  guid: z.string().min(1).max(128), variantGuid: z.string().min(1).max(128),
  name: z.string().min(1).max(120), as: z.enum(['avatar', 'outfit']), target: z.string().max(64).nullable(),
});
type Pending = z.infer<typeof UnityPendingSchema> & { id: string };
const KEY = 'unity-pending';
export const pendingUnity = (ctx: AppContext, owner: string) => getKv<Pending[]>(ctx, owner, KEY, []);
export function queueUnity(ctx: AppContext, owner: string, input: z.infer<typeof UnityPendingSchema>) {
  if (input.as === 'outfit') {
    if (!input.target) throw new HttpError(400, 'Choose an avatar for the pending outfit.');
    getAvatarRow(ctx, owner, input.target);
  }
  const assets = libraryManifest(ctx, owner);
  if (![input.guid, input.variantGuid].every(guid => assets.some(a => a.guid === guid && ['prefab', 'model'].includes(a.kind)))) throw new HttpError(404, 'The Unity item is not in your library.');
  const pending = pendingUnity(ctx, owner);
  const existing = pending.find(p => p.guid === input.guid && p.as === input.as && p.target === input.target);
  if (!existing && pending.length >= 50) throw new HttpError(400, 'Remove a pending import before adding another (50 maximum).');
  const next = { ...input, id: existing?.id ?? newId('up_') };
  setKv(ctx, owner, KEY, [...pending.filter(p => p.id !== next.id), next]);
  return next;
}
export function removePendingUnity(ctx: AppContext, owner: string, id: string) {
  setKv(ctx, owner, KEY, pendingUnity(ctx, owner).filter(p => p.id !== id));
  return { ok: true };
}
