/** 3D avatars: import, settings, outfits, thumbnails; motion clips; the Blender worker's status. */
import type { FastifyInstance } from 'fastify';
import { unzipSync } from 'fflate';
import { z } from 'zod';
import { ClipSchema, EMOTE_CATEGORIES, EMOTE_ID } from '@everloom/engine';
import { HttpError, owner, type AppContext } from '../context.js';
import { findBlender, runBlenderJob, setBlenderPath } from '../services/blender.js';
import { addOutfitModel, avatarDetail, garmentLibrary, createAvatar, deleteAvatar, getAvatarRow, listAvatars, reprocessAvatar, setAvatarThumbnail, updateAvatar } from '../services/avatars/service.js';
import { createCodeAvatar, createPartsAvatar, fillRecipe, garmentForItem } from '../services/avatars/recipes.js';
import { deletePack, importPack, listPacks, setPackEnabled } from '../services/avatars/packs.js';
import { getCharacter } from '../services/characters.js';
import { parse } from '../util/validate.js';

const MOTION_TYPES: Record<string, string> = { fbx: 'fbx', bvh: 'bvh', vmd: 'vmd', glb: 'glb', gltf: 'glb', vrma: 'glb' };

export function registerAvatarRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/avatars', async (req) => listAvatars(ctx, owner(req)));

  /** The model file as the request body; name and file name in the query. */
  app.post('/api/avatars', { bodyLimit: 200 * 1024 * 1024 }, async (req) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body)) throw new HttpError(400, 'Send the model file as the request body');
    const q = parse(z.object({ name: z.string().max(80).optional(), filename: z.string().max(200).optional() }), req.query ?? {});
    return createAvatar(ctx, owner(req), body, q);
  });

  /** A code-made character: a recipe, no model file. */
  app.post('/api/avatars/code', async (req) => {
    const b = parse(z.object({ name: z.string().max(80).optional(), recipe: z.unknown() }), req.body ?? {});
    return createCodeAvatar(ctx, owner(req), b);
  });

  /** A character from the parts maker (the body and parts stay in the pack; the choices are saved). */
  app.post('/api/avatars/parts', async (req) => {
    const b = parse(z.object({ name: z.string().max(80).optional(), config: z.unknown() }), req.body ?? {});
    return createPartsAvatar(ctx, owner(req), b);
  });

  /** A recipe from a character's description (the utility model when available, else the text alone). */
  app.post('/api/avatars/recipe', async (req) => {
    const b = parse(z.object({ characterId: z.string().max(64).optional(), name: z.string().max(80).optional(), text: z.string().max(20_000).optional() }), req.body ?? {});
    let name = b.name ?? '';
    let text = b.text ?? '';
    if (b.characterId) {
      const c = getCharacter(ctx, owner(req), b.characterId);
      name ||= c.name;
      text ||= [c.card.description, c.card.personality].filter(Boolean).join('\n\n');
    }
    return fillRecipe(ctx, owner(req), { name: name || 'Someone', text });
  });

  /** What items look like on code-made characters (rules, else the utility model once per item). */
  app.post('/api/avatars/garments', async (req) => {
    const item = z.object({ name: z.string().min(1).max(120), desc: z.string().max(2000).optional(), category: z.string().max(40).optional(), slot: z.string().max(20).nullable().optional(), tags: z.array(z.string().max(40)).max(20).optional() });
    const b = parse(z.object({ items: z.array(item).max(12) }), req.body ?? {});
    const out = [];
    for (const it of b.items) out.push({ name: it.name, ...(await garmentForItem(ctx, owner(req), it)) });
    return out;
  });

  // ---- Part packs (the parts maker) -------------------------------------------------------------
  app.get('/api/avatar-packs', async (req) => listPacks(ctx, owner(req)));
  /** A zip in the CharacterStudio pack layout as the request body. */
  app.post('/api/avatar-packs', { bodyLimit: 300 * 1024 * 1024 }, async (req) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body)) throw new HttpError(400, 'Send the pack (a zip) as the request body');
    const q = parse(z.object({ name: z.string().max(80).optional() }), req.query ?? {});
    return importPack(ctx, owner(req), body, q);
  });
  app.patch('/api/avatar-packs/:id', async (req) => {
    const b = parse(z.object({ enabled: z.boolean() }), req.body ?? {});
    return setPackEnabled(ctx, owner(req), (req.params as { id: string }).id, b.enabled);
  });
  app.delete('/api/avatar-packs/:id', async (req) => deletePack(ctx, owner(req), (req.params as { id: string }).id));

  /** Garments that fit a body family, from all the owner's avatars. */
  app.get('/api/avatar-garments', async (req) => {
    const q = parse(z.object({ family: z.string().min(1).max(40) }), req.query ?? {});
    return garmentLibrary(ctx, owner(req), q.family);
  });

  app.get('/api/avatars/:id', async (req) => avatarDetail(getAvatarRow(ctx, owner(req), (req.params as { id: string }).id)));

  app.patch('/api/avatars/:id', async (req) => {
    const b = parse(z.object({ name: z.string().max(80).optional(), config: z.unknown().optional() }), req.body ?? {});
    return updateAvatar(ctx, owner(req), (req.params as { id: string }).id, b);
  });

  app.delete('/api/avatars/:id', async (req) => deleteAvatar(ctx, owner(req), (req.params as { id: string }).id));

  /** Optimize again with other settings (texture size, KTX2, how simple the low-detail copy is). */
  app.post('/api/avatars/:id/reprocess', async (req) => {
    const b = parse(z.object({ maxTexture: z.union([z.literal(512), z.literal(1024), z.literal(2048), z.literal(4096)]).optional(), ktx2: z.boolean().optional(), lowRatio: z.number().min(0.1).max(1).optional() }), req.body ?? {});
    return reprocessAvatar(ctx, owner(req), (req.params as { id: string }).id, b);
  });

  /** A picture of the avatar, rendered by the browser. */
  app.post('/api/avatars/:id/thumbnail', { bodyLimit: 8 * 1024 * 1024 }, async (req) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body)) throw new HttpError(400, 'Send the picture as the request body');
    return setAvatarThumbnail(ctx, owner(req), (req.params as { id: string }).id, body);
  });

  /** A whole-model outfit with the same skeleton (wardrobe level 1). */
  app.post('/api/avatars/:id/outfit-model', { bodyLimit: 200 * 1024 * 1024 }, async (req) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body)) throw new HttpError(400, 'Send the model file as the request body');
    const q = parse(z.object({ filename: z.string().max(200).optional() }), req.query ?? {});
    return addOutfitModel(ctx, owner(req), (req.params as { id: string }).id, body, q.filename ?? '');
  });

  // ---- Motion clips -------------------------------------------------------------------------

  app.get('/api/avatar-clips', async (req) => {
    const rows = ctx.db.prepare('SELECT emote, label, category, source, created_at FROM avatar_clips WHERE owner_id = ? ORDER BY label').all(owner(req)) as Array<{ emote: string; label: string; category: string; source: string; created_at: number }>;
    return rows.map((r) => ({ id: r.emote, label: r.label, category: r.category, source: r.source, createdAt: r.created_at }));
  });

  app.get('/api/avatar-clips/:emote', async (req, reply) => {
    const r = ctx.db.prepare('SELECT data FROM avatar_clips WHERE owner_id = ? AND emote = ?').get(owner(req), (req.params as { emote: string }).emote) as { data: string } | undefined;
    if (!r) throw new HttpError(404, 'No such clip');
    return reply.header('content-type', 'application/json').header('cache-control', 'no-store').send(r.data);
  });

  app.put('/api/avatar-clips/:emote', { bodyLimit: 8 * 1024 * 1024 }, async (req) => {
    const emote = (req.params as { emote: string }).emote;
    if (!EMOTE_ID.test(emote)) throw new HttpError(400, 'Emote names use lowercase letters, digits and _');
    const b = parse(z.object({ label: z.string().trim().min(1).max(40), category: z.enum(EMOTE_CATEGORIES), clip: ClipSchema, source: z.string().max(200).default('') }), req.body ?? {});
    const data = JSON.stringify({ ...b.clip, id: emote });
    ctx.db
      .prepare('INSERT INTO avatar_clips (id, owner_id, emote, label, category, data, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, emote) DO UPDATE SET label = excluded.label, category = excluded.category, data = excluded.data, source = excluded.source')
      .run(`${owner(req)}:${emote}`, owner(req), emote, b.label, b.category, data, b.source, Date.now());
    return { id: emote, label: b.label, category: b.category };
  });

  app.delete('/api/avatar-clips/:emote', async (req) => {
    ctx.db.prepare('DELETE FROM avatar_clips WHERE owner_id = ? AND emote = ?').run(owner(req), (req.params as { emote: string }).emote);
    return { ok: true };
  });

  /** FBX, BVH or VMD motion → GLB (via Blender), for the browser to retarget into a clip. */
  app.post('/api/avatar-clips/convert', { bodyLimit: 100 * 1024 * 1024 }, async (req, reply) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body)) throw new HttpError(400, 'Send the motion file as the request body');
    const q = parse(z.object({ filename: z.string().max(200) }), req.query ?? {});
    const kind = q.filename.split('.').pop()!.toLowerCase();
    // VMD comes zipped with the PMX/PMD model it was made for (MMD motions need their model).
    if (kind === 'zip') {
      let files: Record<string, Uint8Array>;
      try {
        files = unzipSync(body);
      } catch {
        throw new HttpError(400, 'That is not a zip file');
      }
      const motion = Object.keys(files).find((n) => /\.vmd$/i.test(n));
      const model = Object.keys(files).find((n) => /\.pm[xd]$/i.test(n));
      if (!motion || !model) throw new HttpError(400, 'A VMD motion needs its PMX model alongside it');
      const mext = model.toLowerCase().endsWith('.pmd') ? 'pmd' : 'pmx';
      const r = await runBlenderJob(ctx, owner(req), { op: 'motion', files: { 'input.vmd': Buffer.from(files[motion]!), [`model.${mext}`]: Buffer.from(files[model]!) }, input: 'input.vmd', output: 'motion.glb', timeoutMs: 3 * 60_000, extra: { model: `model.${mext}` } });
      return reply.header('content-type', 'model/gltf-binary').header('cache-control', 'no-store').send(r.output);
    }
    const ext = MOTION_TYPES[kind];
    if (!ext || ext === 'glb') throw new HttpError(415, 'Convert FBX, BVH or VMD files here; GLB and VRMA load directly');
    if (ext === 'vmd') throw new HttpError(400, 'A VMD motion needs its PMX model: choose both files together');
    const r = await runBlenderJob(ctx, owner(req), { op: 'motion', files: { [`input.${ext}`]: body }, input: `input.${ext}`, output: 'motion.glb', timeoutMs: 3 * 60_000 });
    return reply.header('content-type', 'model/gltf-binary').header('cache-control', 'no-store').send(r.output);
  });

  // ---- Blender --------------------------------------------------------------------------------

  app.get('/api/blender', async (req) => findBlender(ctx, owner(req), { refresh: (req.query as { refresh?: string }).refresh === '1' }));
  app.put('/api/blender', async (req) => {
    const b = parse(z.object({ path: z.string().max(500).nullable() }), req.body ?? {});
    setBlenderPath(ctx, owner(req), b.path);
    return findBlender(ctx, owner(req), { refresh: true });
  });
}
