/**
 * Settings › Extensions: look at a package before installing, install from a zip, a Git address or
 * (for development) a folder on the server, update, approve, turn on and off, uninstall, read the
 * error log; and the app's view of approved extensions (entry files for the sandbox, server routes).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import * as ext from '../services/extensions.js';
import { parse } from '../util/validate.js';

/** Packages under review, so the install button installs exactly what the owner looked at. */
const staged = new Map<string, { owner: string; at: number; pkg: ReturnType<typeof ext.readZip>; source: string }>();
function stage(o: string, pkg: ReturnType<typeof ext.readZip>, source: string) {
  const now = Date.now();
  for (const [k, v] of staged) if (now - v.at > 30 * 60_000) staged.delete(k);
  const token = `${now.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  staged.set(token, { owner: o, at: now, pkg, source });
  return token;
}

export function registerExtensions(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/extensions', async (req) => ({ items: ext.listExtensions(ctx, owner(req)), serverAllowed: ext.serverExtensionsAllowed() && ext.isServerOwner(ctx, owner(req)) }));
  app.get('/api/extensions/ui', async (req) => ext.extensionUi(ctx, owner(req)));

  // Step 1: read a package (zip body, or a Git address) and say what it is and asks for.
  app.post('/api/extensions/preview', async (req) => {
    const o = owner(req);
    let pkg: ReturnType<typeof ext.readZip>;
    let source: string;
    if (Buffer.isBuffer(req.body)) {
      pkg = ext.readZip(req.body);
      source = 'zip';
    } else {
      const b = parse(z.object({ url: z.string().url().max(500) }), req.body);
      pkg = await ext.fetchFromGit(b.url);
      source = b.url;
    }
    return { token: stage(o, pkg, source), ...ext.describePackage(ctx, o, pkg) };
  });
  // Step 2: install what was shown.
  app.post('/api/extensions/install', async (req) => {
    const b = parse(z.object({ token: z.string() }), req.body);
    const s = staged.get(b.token);
    if (!s || s.owner !== owner(req)) throw new HttpError(410, 'That preview expired; open the package again');
    staged.delete(b.token);
    const out = ext.installPackage(ctx, owner(req), s.pkg, s.source, { approve: true });
    ctx.bus.publish(owner(req), 'extension.changed', { id: out.id }, req.clientId);
    return out;
  });
  app.post('/api/extensions/dev', async (req) => {
    const b = parse(z.object({ folder: z.string().min(1).max(1000) }), req.body);
    const out = ext.installDevFolder(ctx, owner(req), b.folder);
    ctx.bus.publish(owner(req), 'extension.changed', { id: out.id }, req.clientId);
    return out;
  });
  /** Updates from where it came from (a Git address); shows the changes before installing. */
  app.post('/api/extensions/:id/check-update', async (req) => {
    const o = owner(req);
    const cur = ext.getExtension(ctx, o, (req.params as any).id);
    if (!/^https:\/\//.test(cur.source)) throw new HttpError(400, 'Installed from a file: install the new zip to update it');
    const pkg = await ext.fetchFromGit(cur.source);
    if (pkg.manifest.id !== cur.id) throw new HttpError(400, 'The package at that address is a different extension now');
    return { token: stage(o, pkg, cur.source), ...ext.describePackage(ctx, o, pkg) };
  });
  app.post('/api/extensions/:id/approve', async (req) => {
    ext.approveExtension(ctx, owner(req), (req.params as any).id);
    ctx.bus.publish(owner(req), 'extension.changed', { id: (req.params as any).id }, req.clientId);
    return ext.getExtension(ctx, owner(req), (req.params as any).id);
  });
  app.patch('/api/extensions/:id', async (req) => {
    const b = parse(z.object({ enabled: z.boolean() }), req.body);
    ext.setExtensionEnabled(ctx, owner(req), (req.params as any).id, b.enabled);
    ctx.bus.publish(owner(req), 'extension.changed', { id: (req.params as any).id }, req.clientId);
    return ext.getExtension(ctx, owner(req), (req.params as any).id);
  });
  app.delete('/api/extensions/:id', async (req) => {
    const keep = (req.query as any).keepData === '1';
    ext.uninstallExtension(ctx, owner(req), (req.params as any).id, keep);
    ctx.bus.publish(owner(req), 'extension.changed', { id: (req.params as any).id, removed: true }, req.clientId);
    return { ok: true };
  });
  app.post('/api/extensions/:id/errors', async (req) => {
    const b = parse(z.object({ where: z.string().max(80), message: z.string().max(2000) }), req.body);
    ext.recordExtensionError(ctx, owner(req), (req.params as any).id, b.where, b.message);
    return { ok: true };
  });
  app.delete('/api/extensions/:id/errors', async (req) => {
    ext.clearExtensionErrors(ctx, owner(req), (req.params as any).id);
    return { ok: true };
  });
  /** An entry file, ready for a sandboxed frame. */
  app.get('/api/extensions/:id/entry', async (req) => {
    const q = parse(z.object({ file: z.string().max(200) }), req.query);
    return ext.entryDocument(ctx, owner(req), (req.params as any).id, q.file);
  });

  // Server parts: /api/ext/<id>/<path> goes to the extension's own process.
  app.all('/api/ext/:id/*', async (req, reply) => {
    const o = owner(req);
    const id = (req.params as any).id;
    const d = ext.getExtension(ctx, o, id);
    if (!d.enabled || !d.approved) throw new HttpError(403, 'This extension is off or waiting for approval');
    const sub = (req.params as any)['*'] as string;
    const r = await ext.callServerPart(o, id, { method: req.method, path: `/${sub}`, query: req.query as Record<string, unknown>, body: Buffer.isBuffer(req.body) ? null : req.body ?? null });
    return reply.code(r.status).send(r.body);
  });
}
