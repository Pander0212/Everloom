/** Character Studio (paper dolls): trait sheets (story characters and random NPCs) and pose/scene templates. See services/studio/store.ts. */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { deleteStudioCharacter, deleteTemplate, fillFromCharacter, getStudioCharacter, installTemplatePack, listStudioCharacters, listTemplates, rollStudioCharacter, saveStudioCharacter, studioForCharacter, templatesDir } from '../services/paperdoll/store.js';
import { parse } from '../util/validate.js';
import { readContentFile } from '../vault/vault.js';

const Save = z.object({ characterId: z.string().max(80).nullable().optional(), sheet: z.unknown() });
const Roll = z.object({ seed: z.number().int().optional(), base: z.unknown().optional(), locks: z.array(z.string().max(30)).max(20).optional(), sex: z.enum(['female', 'male']).optional() });
const FILE = /^[A-Za-z0-9_./-]{1,160}\.(png|webp)$/;

export function registerPaperDoll(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/paperdoll/characters', async (req) => {
    const q = req.query as { page?: string; perPage?: string };
    return listStudioCharacters(ctx, owner(req), { page: Number(q.page) || 0, perPage: Number(q.perPage) || 13 });
  });
  app.get('/api/paperdoll/characters/:id', async (req) => getStudioCharacter(ctx, owner(req), (req.params as { id: string }).id));
  app.get('/api/paperdoll/for/:characterId', async (req) => studioForCharacter(ctx, owner(req), (req.params as { characterId: string }).characterId));
  app.post('/api/paperdoll/characters', async (req) => { const b = parse(Save, req.body); return saveStudioCharacter(ctx, owner(req), { characterId: b.characterId, sheet: b.sheet }); });
  app.put('/api/paperdoll/characters/:id', async (req) => { const b = parse(Save, req.body); return saveStudioCharacter(ctx, owner(req), { id: (req.params as { id: string }).id, characterId: b.characterId, sheet: b.sheet }); });
  app.delete('/api/paperdoll/characters/:id', async (req) => { deleteStudioCharacter(ctx, owner(req), (req.params as { id: string }).id); return { ok: true }; });
  app.post('/api/paperdoll/roll', async (req) => rollStudioCharacter(ctx, owner(req), parse(Roll, req.body ?? {})));
  app.post('/api/paperdoll/fill/:characterId', async (req) => fillFromCharacter(ctx, owner(req), (req.params as { characterId: string }).characterId));

  app.get('/api/paperdoll/templates', async (req) => listTemplates(ctx, owner(req)));
  app.post('/api/paperdoll/templates/import', { bodyLimit: 300 * 1024 * 1024 }, async (req) => {
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Send the template pack (zip) as the request body');
    return installTemplatePack(ctx, owner(req), req.body as Buffer);
  });
  app.delete('/api/paperdoll/templates/:id', async (req) => { deleteTemplate(ctx, owner(req), (req.params as { id: string }).id); return { ok: true }; });
  app.get('/api/paperdoll/templates/:id/*', async (req, reply) => {
    const { id } = req.params as { id: string; '*': string };
    const file = (req.params as Record<string, string>)['*']!;
    if (!FILE.test(file) && file !== 'template.json') throw new HttpError(404, 'Not found');
    if (file.split('/').some((p) => p === '..' || p === '')) throw new HttpError(404, 'Not found');
    const f = path.join(templatesDir(ctx, owner(req), id), file);
    if (!existsSync(f) || statSync(f).isDirectory()) throw new HttpError(404, 'Not found');
    const type = file.endsWith('.json') ? 'application/json' : file.endsWith('.webp') ? 'image/webp' : 'image/png';
    return reply.header('content-type', type).header('cache-control', ctx.vault.enabled ? 'no-store' : 'private, max-age=3600').header('x-content-type-options', 'nosniff').send(readContentFile(ctx.vault, f));
  });
}
