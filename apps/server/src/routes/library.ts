/** Connections, characters, personas, lorebooks, presets, settings, media. */
import {
  emptyCardData, exportSillyTavernPreset, importSillyTavernPreset, normalizeBook, worldFromSillyTavern, worldToSillyTavern,
  DEFAULT_PRESET, type CardData, type PromptPreset,
} from '@everloom/engine';
import { createReadStream } from 'node:fs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { listModels, testConnection } from '../llm/providers.js';
import { batch } from '../services/charlib.js';
import * as chars from '../services/characters.js';
import * as conns from '../services/connections.js';
import * as lore from '../services/lorebooks.js';
import { deleteMedia, getMedia, listMedia, mediaUrl, saveMedia } from '../services/media.js';
import * as personas from '../services/personas.js';
import * as presets from '../services/presets.js';
import { ensureEmbeddings } from '../services/semantic.js';
import { getSettings, updateSettings } from '../services/settings.js';
import { testImageConnection } from '../media/imagegen.js';
import { listVoices } from '../media/tts.js';
import { parse } from '../util/validate.js';

const connectionInput = z.object({
  name: z.string().trim().min(1).max(80),
  provider: z.enum(['openai', 'anthropic', 'gemini', 'textgen', 'tts-openai', 'tts-elevenlabs', 'img-openai', 'img-openrouter', 'img-pollinations', 'img-comfyui', 'img-a1111']),
  baseUrl: z.string().trim().max(500).optional(),
  model: z.string().trim().max(200).optional(),
  apiKey: z.string().max(2000).nullable().optional(),
  params: z.record(z.string(), z.any()).optional(),
});

const personaInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(20000).optional(),
  title: z.string().max(120).optional(),
  age: z.number().int().min(0).max(100000).nullable().optional(),
  ageStage: z.string().max(40).optional(),
  phone: z.string().max(40).optional(),
  isDefault: z.boolean().optional(),
  avatar: z.string().max(80).nullable().optional(),
  data: z.record(z.string(), z.any()).optional(),
});

export function registerLibrary(app: FastifyInstance, ctx: AppContext) {
  // ---------------- settings
  app.get('/api/settings', async (req) => getSettings(ctx, owner(req)));
  app.patch('/api/settings', async (req) => {
    const s = updateSettings(ctx, owner(req), (req.body ?? {}) as any);
    ctx.bus.publish(owner(req), 'settings.updated', s, req.clientId);
    return s;
  });

  // ---------------- connections
  app.get('/api/connections', async (req) => conns.listConnections(ctx, owner(req)));
  app.post('/api/connections', async (req) => conns.saveConnection(ctx, owner(req), parse(connectionInput, req.body)));
  app.put('/api/connections/:id', async (req) => conns.saveConnection(ctx, owner(req), parse(connectionInput, req.body), (req.params as any).id));
  app.delete('/api/connections/:id', async (req) => {
    conns.deleteConnection(ctx, owner(req), (req.params as any).id);
    return { ok: true };
  });
  app.post('/api/connections/:id/test', async (req) => {
    const conn = conns.resolveConnection(ctx, owner(req), (req.params as any).id);
    if (conn.provider.startsWith('img-')) return testImageConnection(conn);
    if (conn.provider.startsWith('tts-')) {
      try {
        const voices = await listVoices(conn);
        return { ok: true, message: `${voices.length} voices available` };
      } catch (e) {
        return { ok: false, message: (e as Error).message };
      }
    }
    return testConnection(conn);
  });
  app.get('/api/connections/:id/models', async (req) => ({ models: await listModels(conns.resolveConnection(ctx, owner(req), (req.params as any).id)) }));

  // ---------------- media
  app.post('/api/media', async (req) => {
    const q = req.query as { kind?: string; characterId?: string };
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body)) throw new HttpError(400, 'Send the file as the request body');
    const row = await saveMedia(ctx, owner(req), body, { kind: (q.kind ?? 'upload').slice(0, 20), characterId: q.characterId ?? null });
    return { id: row.id, url: mediaUrl(row.id), mime: row.mime, width: row.width, height: row.height };
  });
  app.get('/api/media', async (req) => listMedia(ctx, owner(req), req.query as any));
  app.delete('/api/media/:id', async (req) => {
    deleteMedia(ctx, owner(req), (req.params as any).id);
    return { ok: true };
  });
  app.get('/media/:id', async (req, reply) => {
    const { row, file } = getMedia(ctx, owner(req), (req.params as any).id);
    reply.header('content-type', row.mime);
    reply.header('cache-control', 'private, max-age=31536000, immutable');
    reply.header('content-disposition', 'inline');
    reply.header('accept-ranges', 'bytes');
    // Byte ranges, so video and audio can seek (iOS needs this to play at all).
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range && (range[1] || range[2])) {
      const size = row.size;
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        reply.code(416).header('content-range', `bytes */${size}`);
        return reply.send();
      }
      reply.code(206).header('content-range', `bytes ${start}-${end}/${size}`).header('content-length', end - start + 1);
      return reply.send(createReadStream(file, { start, end }));
    }
    return reply.send(createReadStream(file));
  });

  // ---------------- characters
  app.get('/api/characters', async (req) => chars.listCharacters(ctx, owner(req)));
  app.get('/api/characters/:id', async (req) => chars.getCharacter(ctx, owner(req), (req.params as any).id));
  /** Other tabs and devices refresh their library when a character changes. */
  const changed = <T>(req: FastifyRequest, result: T): T => {
    ctx.bus.publish(owner(req), 'characters.changed', {}, req.clientId);
    return result;
  };
  app.post('/api/characters', async (req) => {
    const body = (req.body ?? {}) as { card?: Partial<CardData>; avatar?: string };
    const card = { ...emptyCardData(), ...(body.card ?? {}) } as CardData;
    if (!card.name?.trim()) throw new HttpError(400, 'Name is required');
    return changed(req, chars.createCharacter(ctx, owner(req), card, { avatar: body.avatar ?? null }));
  });
  app.patch('/api/characters/:id', async (req) => changed(req, chars.updateCharacter(ctx, owner(req), (req.params as any).id, (req.body ?? {}) as any)));
  app.delete('/api/characters/:id', async (req) => {
    // Kept in the trash for a day, so the delete can be undone.
    const r = batch(ctx, owner(req), [(req.params as any).id], { action: 'delete' });
    return changed(req, { ok: true, undoId: r.undoId });
  });
  app.post('/api/characters/:id/duplicate', async (req) => changed(req, chars.duplicateCharacter(ctx, owner(req), (req.params as any).id)));
  app.post('/api/characters/import', async (req) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body)) throw new HttpError(400, 'Send the card file as the request body');
    return changed(req, await chars.importCard(ctx, owner(req), body));
  });
  app.get('/api/characters/:id/export', async (req, reply) => {
    const id = (req.params as any).id;
    const format = (req.query as any).format === 'json' ? 'json' : 'png';
    const c = chars.getCharacter(ctx, owner(req), id);
    const safe = c.name.replace(/[^\w\s.-]+/g, '').trim().slice(0, 60) || 'character';
    if (format === 'json') {
      reply.header('content-type', 'application/json');
      reply.header('content-disposition', `attachment; filename="${safe}.json"`);
      return JSON.stringify(chars.exportCardJson(ctx, owner(req), id), null, 2);
    }
    reply.header('content-type', 'image/png');
    reply.header('content-disposition', `attachment; filename="${safe}.png"`);
    return reply.send(await chars.exportCardPng(ctx, owner(req), id));
  });

  // ---------------- personas
  app.get('/api/personas', async (req) => personas.listPersonas(ctx, owner(req)));
  app.post('/api/personas', async (req) => personas.savePersona(ctx, owner(req), parse(personaInput, req.body) as any));
  app.put('/api/personas/:id', async (req) => personas.savePersona(ctx, owner(req), parse(personaInput, req.body) as any, (req.params as any).id));
  app.delete('/api/personas/:id', async (req) => {
    personas.deletePersona(ctx, owner(req), (req.params as any).id);
    return { ok: true };
  });

  // ---------------- lorebooks
  app.get('/api/lorebooks', async (req) => lore.listLorebooks(ctx, owner(req), req.query as any));
  app.get('/api/lorebooks/:id', async (req) => lore.getLorebook(ctx, owner(req), (req.params as any).id));
  app.post('/api/lorebooks', async (req) => {
    const b = parse(z.object({ name: z.string().trim().min(1).max(120), scope: z.enum(['global', 'character', 'chat']).optional(), scopeId: z.string().nullable().optional(), book: z.any().optional() }), req.body);
    return lore.createLorebook(ctx, owner(req), { ...b, book: b.book ? normalizeBook(b.book, b.name) : undefined });
  });
  app.put('/api/lorebooks/:id', async (req) => {
    const b = parse(z.object({ name: z.string().trim().min(1).max(120).optional(), scope: z.enum(['global', 'character', 'chat']).optional(), scopeId: z.string().nullable().optional(), enabled: z.boolean().optional(), book: z.any().optional() }), req.body);
    return lore.updateLorebook(ctx, owner(req), (req.params as any).id, b);
  });
  app.delete('/api/lorebooks/:id', async (req) => {
    lore.deleteLorebook(ctx, owner(req), (req.params as any).id);
    return { ok: true };
  });
  app.post('/api/lorebooks/import', async (req) => {
    const q = req.query as { name?: string; scope?: 'global' | 'character' | 'chat'; scopeId?: string };
    const raw = Buffer.isBuffer(req.body) ? JSON.parse((req.body as Buffer).toString('utf8')) : req.body;
    const name = q.name || raw?.name || 'Imported world';
    return lore.createLorebook(ctx, owner(req), { name, scope: q.scope ?? 'global', scopeId: q.scopeId ?? null, book: worldFromSillyTavern(raw, name) });
  });
  app.get('/api/lorebooks/:id/export', async (req, reply) => {
    const b = lore.getLorebook(ctx, owner(req), (req.params as any).id);
    reply.header('content-type', 'application/json');
    reply.header('content-disposition', `attachment; filename="${b.name.replace(/[^\w\s.-]+/g, '').slice(0, 60) || 'world'}.json"`);
    return JSON.stringify(worldToSillyTavern(b.book), null, 2);
  });
  app.post('/api/lorebooks/embed', async (req) => ({ embedded: await ensureEmbeddings(ctx, owner(req), lore.listLorebooks(ctx, owner(req)).filter((b) => b.enabled)) }));

  // ---------------- presets
  app.get('/api/presets', async (req) => presets.listPresets(ctx, owner(req)));
  app.get('/api/presets/default', async () => DEFAULT_PRESET);
  app.post('/api/presets', async (req) => {
    const b = parse(z.object({ name: z.string().trim().min(1).max(120), preset: z.any() }), req.body);
    return presets.savePreset(ctx, owner(req), b.name, (b.preset ?? DEFAULT_PRESET) as PromptPreset);
  });
  app.put('/api/presets/:id', async (req) => {
    const b = parse(z.object({ name: z.string().trim().min(1).max(120), preset: z.any() }), req.body);
    return presets.savePreset(ctx, owner(req), b.name, b.preset as PromptPreset, (req.params as any).id);
  });
  app.delete('/api/presets/:id', async (req) => {
    presets.deletePreset(ctx, owner(req), (req.params as any).id);
    return { ok: true };
  });
  app.post('/api/presets/import', async (req) => {
    const raw = Buffer.isBuffer(req.body) ? JSON.parse((req.body as Buffer).toString('utf8')) : req.body;
    const name = String((req.query as any).name || raw?.name || 'Imported preset').slice(0, 120);
    const isOurs = Array.isArray(raw?.blocks);
    const preset = isOurs ? (raw as PromptPreset) : importSillyTavernPreset(raw, name).preset;
    return presets.savePreset(ctx, owner(req), name, preset);
  });
  app.get('/api/presets/:id/export', async (req, reply) => {
    const p = presets.getPreset(ctx, owner(req), (req.params as any).id);
    const st = (req.query as any).format === 'sillytavern';
    reply.header('content-type', 'application/json');
    reply.header('content-disposition', `attachment; filename="${p.name.replace(/[^\w\s.-]+/g, '').slice(0, 60) || 'preset'}.json"`);
    return JSON.stringify(st ? exportSillyTavernPreset(p.preset) : p.preset, null, 2);
  });
}
