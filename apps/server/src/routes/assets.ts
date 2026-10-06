/** The shared asset library: list and search, add pictures or a zip, rename and tag, delete. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { addAsset, ASSET_TYPES, importAssetZip, listAssets, updateAsset } from '../services/assets.js';
import { deleteMedia } from '../services/media.js';
import { addDemoCharacter, installStarter, starterManifest } from '../services/starter-art.js';
import { parse } from '../util/validate.js';

const tagList = (s?: string) => (s ? s.split(',').map((t) => t.trim()).filter(Boolean) : []);

export function registerAssetRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/assets', async (req) => {
    const q = parse(z.object({ q: z.string().max(200).optional(), type: z.enum(ASSET_TYPES).optional(), tag: z.string().max(30).optional() }), req.query ?? {});
    return listAssets(ctx, owner(req), q);
  });

  /** One picture, sent as the request body; name, type, tags and set travel in the query. */
  app.post('/api/assets', { bodyLimit: 30 * 1024 * 1024 }, async (req) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body)) throw new HttpError(400, 'Send the picture as the request body');
    const q = parse(z.object({ name: z.string().max(120).optional(), type: z.enum(ASSET_TYPES).optional(), tags: z.string().max(400).optional(), set: z.string().max(60).optional(), expression: z.string().max(30).optional() }), req.query ?? {});
    return addAsset(ctx, owner(req), body, { name: q.name, type: q.type, tags: tagList(q.tags), set: q.set, expression: q.expression });
  });

  /** A zip of pictures: folders become tags, emotion-named files become expression sets. */
  app.post('/api/assets/zip', { bodyLimit: 300 * 1024 * 1024 }, async (req) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body)) throw new HttpError(400, 'Send the zip as the request body');
    const q = parse(z.object({ name: z.string().max(120).optional() }), req.query ?? {});
    return importAssetZip(ctx, owner(req), body, q.name);
  });

  /** Everloom's bundled art: what's in it, and adding it to the library (skips what's already there). */
  app.get('/api/assets/starter', async () => {
    try {
      const m = starterManifest(ctx).filter((e) => e.pack === 'starter');
      return { available: true, count: m.length, backgrounds: m.filter((e) => e.type === 'background').length };
    } catch {
      return { available: false, count: 0, backgrounds: 0 };
    }
  });
  app.post('/api/assets/starter', async (req) => {
    const { added, skipped } = await installStarter(ctx, owner(req), 'starter');
    return { added, skipped };
  });
  /** The demo character (Mira Vale) with her expression set. */
  app.post('/api/characters/demo', async (req) => addDemoCharacter(ctx, owner(req)));

  app.patch('/api/assets/:id', async (req) => {
    const b = parse(z.object({ name: z.string().max(120).optional(), type: z.enum(ASSET_TYPES).optional(), tags: z.array(z.string().max(30)).max(20).optional(), set: z.string().max(60).optional(), expression: z.string().max(30).optional() }), req.body);
    return updateAsset(ctx, owner(req), (req.params as { id: string }).id, b);
  });

  app.delete('/api/assets/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    const row = ctx.db.prepare("SELECT id FROM media WHERE id = ? AND owner_id = ? AND kind = 'asset'").get(id, owner(req));
    if (!row) throw new HttpError(404, 'Asset not found');
    deleteMedia(ctx, owner(req), id);
    return { ok: true };
  });
}
