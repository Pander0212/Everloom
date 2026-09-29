import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { owner, type AppContext } from '../context.js';
import { newId } from '../security/crypto.js';
import { extractZip } from '../services/backup.js';
import { resolveStRoot, runSillyTavernImport, scanSillyTavern } from '../services/stimport.js';
import { parse } from '../util/validate.js';
import { bodyToTempFile } from './system.js';

/** SillyTavern migration: scan a folder (or an uploaded zip), then import what the user picks. */
export function registerImport(app: FastifyInstance, ctx: AppContext) {
  const uploads = path.join(ctx.cfg.dataDir, 'imports');
  mkdirSync(uploads, { recursive: true });

  app.post('/api/import/sillytavern/scan', async (req) => {
    owner(req);
    const b = parse(z.object({ path: z.string().min(1).max(1000) }), req.body);
    return scanSillyTavern(resolveStRoot(ctx, b.path, [uploads]));
  });

  app.post('/api/import/sillytavern/run', async (req) => {
    const b = parse(
      z.object({
        path: z.string().min(1).max(1000),
        include: z.object({ characters: z.boolean(), chats: z.boolean(), groups: z.boolean(), personas: z.boolean(), worlds: z.boolean(), backgrounds: z.boolean(), presets: z.boolean() }).partial().default({}),
      }),
      req.body,
    );
    const root = resolveStRoot(ctx, b.path, [uploads]);
    const result = await runSillyTavernImport(ctx, owner(req), root, b.include);
    ctx.bus.publish(owner(req), 'chat.created', {});
    return result;
  });

  app.post('/api/import/sillytavern/upload', async (req) => {
    owner(req);
    const file = await bodyToTempFile(req, 4 * 1024 * 1024 * 1024);
    const dest = path.join(uploads, newId('st_'));
    try {
      // Only the folders the importer reads are extracted.
      await extractZip(file, dest, { filter: (n) => /(^|\/)(characters|chats|groups|group chats|worlds|backgrounds|OpenAI Settings|User Avatars)\/|(^|\/)settings\.json$/.test(n) });
    } catch (e) {
      rmSync(dest, { recursive: true, force: true });
      throw e;
    } finally {
      rmSync(file, { force: true });
    }
    // Find the folder that actually holds "characters/".
    const root = findDataRoot(dest);
    return { path: root };
  });
}

import { existsSync, readdirSync, statSync } from 'node:fs';
function findDataRoot(dir: string, depth = 0): string {
  if (existsSync(path.join(dir, 'characters')) || existsSync(path.join(dir, 'settings.json'))) return dir;
  if (depth > 4) return dir;
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) {
      const found = findDataRoot(p, depth + 1);
      if (found !== p || existsSync(path.join(p, 'characters'))) return found;
    }
  }
  return dir;
}
