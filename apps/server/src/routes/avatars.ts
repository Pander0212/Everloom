/** 3D avatars: import, settings, outfits, thumbnails; motion clips; the Blender worker's status. */
import type { FastifyInstance } from 'fastify';
import { unzipSync } from 'fflate';
import { z } from 'zod';
import { AvatarConfigSchema, BoneMapSchema, RigMappingSchema, BUILTIN_EMOTES, BUILTIN_PAIRED, ClipSchema, EMOTE_CATEGORIES, EMOTE_ID, GARMENT_SLOTS, PAIRED_ID, PairedClipSchema } from '@everloom/engine';
import { parseGlb } from '../services/avatars/glb.js';
import { HttpError, owner, type AppContext } from '../context.js';
import { blenderJobs, findBlender, runBlenderJob, setBlenderPath } from '../services/blender.js';
import { addOutfitModel, cleanupAvatar, fitGarment, renderTurntable, avatarDetail, garmentLibrary, morphPresetLibrary, pairedFor, createAvatar, deleteAvatar, getAvatarRow, listAvatars, reprocessAvatar, setAvatarThumbnail, updateAvatar } from '../services/avatars/service.js';
import { createCodeAvatar, createPartsAvatar, fillRecipe, garmentForItem } from '../services/avatars/recipes.js';
import { deletePack, importPack, listPacks, setPackEnabled } from '../services/avatars/packs.js';
import { discardModel3dJob, getModel3dJob, startModel3dJob } from '../services/avatars/model3d.js';
import { generateTexture } from '../services/avatars/textures.js';
import { blendJobFiles, zipHasBlend } from '../services/avatars/blendfile.js';
import { export3d, import3d, list3d, setTags3d } from '../services/avatars/library3d.js';
import { createRealisticAvatar, installMpfb, mpfbInstalledInfo, mpfbStatus, removeMpfb } from '../services/avatars/mpfb.js';
import { getCharacter } from '../services/characters.js';
import { readMedia, saveModelFile } from '../services/media.js';
import { ownerForToken } from '../services/bridge.js';
import { parse } from '../util/validate.js';
import { installMakeHuman, makeHumanStatus, importHumanAssets } from '../services/avatars/makehuman.js';
import { exportBrowserModel } from '../services/avatars/browser-export.js';
import { replaceNativeBody } from '../services/avatars/service.js';
import { assertAdultAvatar } from '../services/avatars/adult.js';

const MOTION_TYPES: Record<string, string> = { fbx: 'fbx', bvh: 'bvh', vmd: 'vmd', glb: 'glb', gltf: 'glb', vrma: 'glb', blend: 'blend' };

export function registerAvatarRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/makehuman', async req => makeHumanStatus(ctx, owner(req)));
  app.post('/api/makehuman/assets', { bodyLimit: 100 * 1024 * 1024 }, async req => {
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Send an asset ZIP as binary data.');
    const options = parse(z.object({ kind: z.enum(['clothes', 'hair', 'targets', 'rigs', 'skins', 'eyes', 'eyebrows', 'eyelashes', 'teeth', 'tongue']), label: z.string().min(1).max(80), adult: z.enum(['true', 'false']).transform(v => v === 'true'), rightsConfirmed: z.enum(['true', 'false']).transform(v => v === 'true') }), req.query);
    return importHumanAssets(ctx, owner(req), req.body, options);
  });
  app.post('/api/avatars/native', { bodyLimit: 200 * 1024 * 1024 }, async req => {
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Send the browser-built GLB as binary data.');
    const glb = parseGlb(req.body);
    const input = (glb.json.nodes ?? []).map(node => (node as { extras?: { everloom?: { config?: unknown } } }).extras?.everloom?.config).find(Boolean);
    const config = parse(AvatarConfigSchema, input);
    if (!config.makehuman) throw new HttpError(400, 'The native model is missing its MakeHuman recipe.');
    const q = parse(z.object({ name: z.string().max(80).optional() }), req.query);
    return createAvatar(ctx, owner(req), req.body, { name: q.name, filename: 'makehuman.glb', kind: 'makehuman', config });
  });
  app.post('/api/makehuman/install', async req => {
    const b = parse(z.object({ pack: z.enum(['core', 'system']) }), req.body ?? {});
    return installMakeHuman(ctx, owner(req), b.pack);
  });
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

  // ---- AI-made props and garments (image-to-3D connection) --------------------------------------
  /** JSON {prompt, kind} or a picture as the body with ?prompt=&kind= (a picture is better). */
  app.post('/api/avatars/generate', { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    const raw = Buffer.isBuffer(req.body) ? (req.body as Buffer) : null;
    const b = parse(z.object({ prompt: z.string().trim().min(2).max(600), kind: z.enum(['prop', 'garment']).default('prop') }), raw ? (req.query ?? {}) : (req.body ?? {}));
    return startModel3dJob(ctx, owner(req), { ...b, image: raw ?? undefined });
  });
  app.get('/api/avatars/generate/:job', async (req) => getModel3dJob(owner(req), (req.params as { job: string }).job));
  /** Discard what a job made. */
  app.delete('/api/avatars/generate/:job', async (req) => discardModel3dJob(ctx, owner(req), (req.params as { job: string }).job));

  /** A seamless garment texture from the image connection (or a variant of one with an editing model). */
  app.post('/api/avatars/texture', async (req) => {
    const b = parse(z.object({ prompt: z.string().trim().min(2).max(400), base: z.string().regex(/^[\w-]{1,64}$/).nullable().optional(), adult: z.boolean().optional(), avatarId: z.string().regex(/^[\w-]{1,64}$/).optional() }), req.body ?? {});
    return generateTexture(ctx, owner(req), b);
  });

  // ---- The Blender add-on (tools/blender-addon): device-token uploads ---------------------------
  const tokenOwner = (req: { headers: { authorization?: string } }) => {
    const who = ownerForToken(ctx, req.headers.authorization);
    if (!who) throw new HttpError(401, 'This device token is not known. Make one in Everloom: Settings › Character sources › Browser bridge › Add a device.', 'auth_required');
    return who;
  };
  app.post('/api/addon/ping', async (req) => (tokenOwner(req), { ok: true, name: 'Everloom' }));
  app.post('/api/addon/avatars', async (req) => listAvatars(ctx, tokenOwner(req)).filter((a) => a.kind === 'imported').map((a) => ({ id: a.id, name: a.name })));
  app.post('/api/addon/upload', { bodyLimit: 200 * 1024 * 1024 }, async (req) => {
    const who = tokenOwner(req);
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body)) throw new HttpError(400, 'Send the GLB as the request body');
    const q = parse(z.object({ kind: z.enum(['avatar', 'garment', 'animation']), name: z.string().trim().min(1).max(80), avatar: z.string().max(64).optional(), slot: z.enum(GARMENT_SLOTS).default('top') }), req.query ?? {});
    if (q.kind === 'avatar') {
      const a = createAvatar(ctx, who, body, { name: q.name, filename: `${q.name}.glb` });
      ctx.bus.publish(who, 'avatars.changed', {});
      return { kind: 'avatar', id: a.id, open: `/characters/avatars/${a.id}` };
    }
    if (q.kind === 'garment') {
      if (!q.avatar) throw new HttpError(400, 'Choose the avatar this garment is for');
      const row = getAvatarRow(ctx, who, q.avatar);
      const saved = await addOutfitModel(ctx, who, row.id, body, `${q.name}.glb`);
      const cfg = avatarDetail(row).config;
      const id = `g_${Date.now().toString(36)}`.slice(0, 40);
      updateAvatar(ctx, who, row.id, { config: { ...cfg, garments: [...cfg.garments, { id, name: q.name.slice(0, 60), model: saved.model, modelLow: saved.modelLow, slot: q.slot, family: cfg.family }] } });
      ctx.bus.publish(who, 'avatars.changed', {});
      return { kind: 'garment', id, avatar: row.id, open: `/characters/avatars/${row.id}` };
    }
    // Animations wait in Settings › 3D characters › Motion clips until imported (named and previewed).
    const m = saveModelFile(ctx, who, body, { kind: 'model-motion', ext: 'glb', meta: { name: q.name, from: 'blender' } });
    return { kind: 'animation', id: m.id, open: '/settings/3d' };
  });
  app.get('/api/avatar-motions/inbox', async (req) =>
    (ctx.db.prepare("SELECT id, meta, created_at FROM media WHERE owner_id = ? AND kind = 'model-motion' ORDER BY created_at DESC").all(owner(req)) as Array<{ id: string; meta: string; created_at: number }>).map((r) => ({ id: r.id, name: (JSON.parse(r.meta || '{}') as { name?: string }).name ?? 'Animation', url: `/media/${r.id}`, createdAt: r.created_at })),
  );

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
  app.get('/api/avatar-morph-presets', async (req) => {
    const q = parse(z.object({ base: z.string().min(1).max(80) }), req.query ?? {});
    return morphPresetLibrary(ctx, owner(req), q.base);
  });

  app.get('/api/avatar-garments', async (req) => {
    const q = parse(z.object({ family: z.string().min(1).max(40) }), req.query ?? {});
    return garmentLibrary(ctx, owner(req), q.family);
  });

  app.get('/api/avatars/:id', async (req) => avatarDetail(getAvatarRow(ctx, owner(req), (req.params as { id: string }).id)));
  app.post('/api/avatars/:id/preset-export', async (req, reply) => {
    const who = owner(req), id = (req.params as { id: string }).id;
    getAvatarRow(ctx, who, id);
    const input = parse(z.object({ kind: z.enum(['character', 'rig']), config: AvatarConfigSchema }), req.body);
    assertAdultAvatar(ctx, who, input.config, id);
    const data = input.kind === 'rig' ? { format: 'everloom-rig-map', version: 1, boneMap: input.config.boneMap, physics: input.config.physics, ...(input.config.rig ? { rig: input.config.rig } : {}) } : { format: 'everloom-character-preset', version: 1, family: input.config.family, config: input.config };
    return reply.type('application/json').header('content-disposition', `attachment; filename="${input.kind}-preset.json"`).send(Buffer.from(JSON.stringify(data, null, 2)));
  });
  app.post('/api/avatars/:id/preset-import', { bodyLimit: 1024 * 1024 }, async req => {
    const who = owner(req), id = (req.params as { id: string }).id, avatar = avatarDetail(getAvatarRow(ctx, who, id));
    let value: unknown = req.body;
    if (Buffer.isBuffer(value)) { try { value = JSON.parse(value.toString('utf8')); } catch { throw new HttpError(400, 'The preset is not valid JSON.'); } }
    const preset = parse(z.discriminatedUnion('format', [
      z.object({ format: z.literal('everloom-rig-map'), version: z.literal(1), boneMap: BoneMapSchema, physics: AvatarConfigSchema.shape.physics.optional(), rig: RigMappingSchema.optional() }),
      z.object({ format: z.literal('everloom-character-preset'), version: z.literal(1), family: z.string().max(40).nullable(), config: AvatarConfigSchema }),
    ]), value);
    if (preset.format === 'everloom-character-preset') {
      if (preset.family !== avatar.config.family || !!preset.config.makehuman !== !!avatar.config.makehuman) throw new HttpError(400, 'Choose a preset for the same character kind and body family.');
      assertAdultAvatar(ctx, who, preset.config, id);
    }
    return preset;
  });
  app.put('/api/avatars/:id/native-model', { bodyLimit: 200 * 1024 * 1024 }, async req => {
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Send the native model as binary GLB data.');
    return replaceNativeBody(ctx, owner(req), (req.params as { id: string }).id, req.body);
  });
  app.post('/api/avatars/:id/browser-export', { bodyLimit: 200 * 1024 * 1024 }, async (req, reply) => {
    const q = parse(z.object({ format: z.enum(['glb', 'vrm']) }), req.query);
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Send the browser-built GLB as binary data.');
    const bytes = await exportBrowserModel(ctx, owner(req), (req.params as { id: string }).id, req.body, q.format);
    return reply.type('model/gltf-binary').header('content-disposition', `attachment; filename="character.${q.format}"`).send(bytes);
  });

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

  /** Blender: clean up the model (merge, decimate to a budget, shrink textures), then prepare it again. */
  app.post('/api/avatars/:id/cleanup', async (req) => {
    const b = parse(z.object({ maxTriangles: z.number().int().min(1000).max(500_000).default(60_000), maxTexture: z.union([z.literal(512), z.literal(1024), z.literal(2048), z.literal(4096)]).default(2048) }), req.body ?? {});
    return cleanupAvatar(ctx, owner(req), (req.params as { id: string }).id, b);
  });
  /** Blender: a turntable picture (8 views). */
  app.post('/api/avatars/:id/turntable', async (req) => renderTurntable(ctx, owner(req), (req.params as { id: string }).id));
  app.get('/api/blender/jobs', async (req) => blenderJobs(owner(req)));

  /** A garment mesh fitted to this avatar's body by the Blender worker (experimental). */
  app.post('/api/avatars/:id/fit-garment', { bodyLimit: 100 * 1024 * 1024 }, async (req) => {
    const q = parse(z.object({ filename: z.string().min(3).max(200), slot: z.enum(GARMENT_SLOTS), offset: z.coerce.number().min(0).max(0.05).optional(), media: z.string().regex(/^[\w-]{1,64}$/).optional() }), req.query ?? {});
    // The garment: the request body, or a model file already here (one an AI job made).
    let body = req.body as Buffer;
    if (q.media) {
      const m = readMedia(ctx, owner(req), q.media);
      if (!m.row.kind.startsWith('model')) throw new HttpError(400, 'Not a model file');
      body = m.bytes;
    }
    if (!Buffer.isBuffer(body)) throw new HttpError(400, 'Send the garment file as the request body');
    return fitGarment(ctx, owner(req), (req.params as { id: string }).id, body, q);
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
    const rows = ctx.db.prepare("SELECT emote, label, category, source, created_at FROM avatar_clips WHERE owner_id = ? AND category != 'paired' ORDER BY label").all(owner(req)) as Array<{ emote: string; label: string; category: string; source: string; created_at: number }>;
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

  // Paired and group animations (one clip per participant), in the same table under their own category.
  app.get('/api/avatar-paired', async (req) => pairedFor(ctx, owner(req)));
  app.get('/api/avatar-paired/:id', async (req, reply) => {
    const r = ctx.db.prepare("SELECT data FROM avatar_clips WHERE owner_id = ? AND emote = ? AND category = 'paired'").get(owner(req), (req.params as { id: string }).id) as { data: string } | undefined;
    if (!r) throw new HttpError(404, 'No such paired animation');
    return reply.header('content-type', 'application/json').header('cache-control', 'no-store').send(r.data);
  });
  app.put('/api/avatar-paired/:id', { bodyLimit: 16 * 1024 * 1024 }, async (req) => {
    const id = (req.params as { id: string }).id;
    if (!PAIRED_ID.test(id)) throw new HttpError(400, 'Names use lowercase letters, digits and _');
    if (BUILTIN_PAIRED.some((p) => p.id === id) || BUILTIN_EMOTES.some((e) => e.id === id)) throw new HttpError(409, 'That name is already a built-in animation');
    const clip = parse(PairedClipSchema, { ...(req.body as object), id });
    const existing = ctx.db.prepare('SELECT category FROM avatar_clips WHERE owner_id = ? AND emote = ?').get(owner(req), id) as { category: string } | undefined;
    if (existing && existing.category !== 'paired') throw new HttpError(409, 'An emote already has that name');
    ctx.db
      .prepare("INSERT INTO avatar_clips (id, owner_id, emote, label, category, data, source, created_at) VALUES (?, ?, ?, ?, 'paired', ?, ?, ?) ON CONFLICT(owner_id, emote) DO UPDATE SET label = excluded.label, data = excluded.data, source = excluded.source")
      .run(`${owner(req)}:${id}`, owner(req), id, clip.label, JSON.stringify(clip), clip.source, Date.now());
    return { id, label: clip.label, participants: clip.roles.length };
  });
  app.delete('/api/avatar-paired/:id', async (req) => {
    ctx.db.prepare("DELETE FROM avatar_clips WHERE owner_id = ? AND emote = ? AND category = 'paired'").run(owner(req), (req.params as { id: string }).id);
    return { ok: true };
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
    // A .blend with its armature and action (alone, or zipped with what it links to).
    if (kind === 'blend' || (kind === 'zip' && zipHasBlend(body))) {
      const job = blendJobFiles(body, q.filename);
      const r = await runBlenderJob(ctx, owner(req), { op: 'motion', files: job.files, input: job.input, output: 'motion.glb', timeoutMs: 4 * 60_000 });
      return reply.header('content-type', 'model/gltf-binary').header('cache-control', 'no-store').send(r.output);
    }
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
    if (!ext || ext === 'glb') throw new HttpError(415, 'Convert FBX, BVH, VMD or .blend files here; GLB and VRMA load directly');
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

  // ---- 3D in the asset library ------------------------------------------------------------------

  app.get('/api/assets3d', async (req) => list3d(ctx, owner(req), parse(z.object({ q: z.string().max(200).optional(), type: z.string().max(20).optional(), tag: z.string().max(30).optional() }), req.query ?? {})));
  app.put('/api/assets3d/tags', async (req) => {
    const b = parse(z.object({ key: z.string().max(160), tags: z.array(z.string().max(30)).max(12) }), req.body ?? {});
    return setTags3d(ctx, owner(req), b.key, b.tags);
  });
  app.post('/api/assets3d/export', async (req, reply) => {
    const b = parse(z.object({ keys: z.array(z.string().max(160)).min(1).max(500) }), req.body ?? {});
    const zip = export3d(ctx, owner(req), b.keys);
    reply.header('content-type', 'application/zip');
    reply.header('content-disposition', `attachment; filename="everloom-3d-${new Date().toISOString().slice(0, 10)}.zip"`);
    return reply.send(zip);
  });
  app.post('/api/assets3d/import', { bodyLimit: 512 * 1024 * 1024 }, async (req) => {
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Send the zip as the request body');
    return import3d(ctx, owner(req), req.body);
  });

  // ---- Realistic characters (MPFB) ------------------------------------------------------------

  app.get('/api/mpfb', async (req) => ({ ...(await mpfbStatus(ctx, owner(req), { refresh: (req.query as { refresh?: string }).refresh === '1' })), copy: mpfbInstalledInfo(ctx) }));
  /** Downloads MPFB (GPL-3.0) and MakeHuman's CC0 assets from their official sources. */
  app.post('/api/mpfb/install', async () => installMpfb(ctx));
  app.delete('/api/mpfb', async () => {
    removeMpfb(ctx);
    return { ok: true };
  });
  app.post('/api/avatars/realistic', async (req) => {
    const b = parse(z.object({ name: z.string().max(80).optional(), spec: z.unknown() }), req.body ?? {});
    return createRealisticAvatar(ctx, owner(req), b);
  });
}
