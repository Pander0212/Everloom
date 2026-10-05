/** Settings › Privacy › Vault: status, turn on and off, unlock, lock, passphrase, idle time. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { owner, type AppContext } from '../context.js';
import { changePassphrase, deletePlaintextBackups, disableVault, enableVault, lockVault, setIdleMinutes, unlockVault, vaultStatus } from '../services/vault.js';
import { parse } from '../util/validate.js';

const secret = z.object({ passphrase: z.string().min(1).max(1024).optional(), recoveryKey: z.string().min(10).max(200).optional() }).refine((s) => s.passphrase || s.recoveryKey, 'Enter the passphrase or the recovery key');

export function registerVault(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/vault', async () => vaultStatus(ctx));
  app.post('/api/vault/enable', async (req) => {
    const b = parse(z.object({ passphrase: z.string().max(1024).optional(), useLoginPassword: z.string().max(1024).optional(), idleMinutes: z.number().int().min(1).max(1440).optional() }), req.body);
    const r = await enableVault(ctx, owner(req), b);
    return { ...vaultStatus(ctx), recoveryKey: r.recoveryKey };
  });
  app.post('/api/vault/unlock', async (req) => {
    await unlockVault(ctx, parse(secret, req.body));
    return vaultStatus(ctx);
  });
  app.post('/api/vault/lock', async () => {
    lockVault(ctx, 'manual');
    return vaultStatus(ctx);
  });
  app.post('/api/vault/passphrase', async (req) => {
    const b = parse(z.object({ current: secret, next: z.string().min(10).max(1024) }), req.body);
    await changePassphrase(ctx, b.current, b.next, false);
    return vaultStatus(ctx);
  });
  app.post('/api/vault/disable', async (req) => {
    await disableVault(ctx, parse(secret, req.body));
    return vaultStatus(ctx);
  });
  app.put('/api/vault/idle', async (req) => {
    setIdleMinutes(ctx, parse(z.object({ minutes: z.number().int().min(1).max(1440) }), req.body).minutes);
    return vaultStatus(ctx);
  });
  app.post('/api/vault/delete-plaintext-backups', async () => {
    const deleted = deletePlaintextBackups(ctx);
    return { ...vaultStatus(ctx), deleted };
  });
}
