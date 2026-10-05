/** The Vault, wired to the running app: status, turning it on and off, unlocking and locking. */
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { HttpError, type AppContext } from '../context.js';
import { openDb } from '../db/index.js';
import { verifyPassword } from '../security/crypto.js';
import {
  buildSystemDb,
  decryptCopy,
  encryptCopy,
  lockedDb,
  mergeSystemDb,
  newVaultFile,
  openEncryptedDb,
  openSystemDb,
  reconcileFiles,
  rewrapPassphrase,
  shred,
  swapIn,
  unwrapWithSecret,
} from '../vault/vault.js';
import { createBackup } from './backup.js';
import { loadAllExtensions } from './extensions.js';

let busy: string | null = null;
async function exclusive<T>(what: string, f: () => Promise<T>): Promise<T> {
  if (busy) throw new HttpError(409, `The vault is busy (${busy}); try again in a moment`);
  busy = what;
  try {
    return await f();
  } finally {
    busy = null;
  }
}

export function vaultStatus(ctx: AppContext) {
  const f = ctx.vault.file;
  return {
    enabled: ctx.vault.enabled,
    locked: ctx.vault.locked,
    state: f?.state ?? 'off',
    /** Turning it on was interrupted: the passphrase finishes it. */
    resumable: f?.state === 'enabling',
    loginIsPassphrase: !!f?.loginIsPassphrase,
    idleMinutes: f?.idleMinutes ?? 30,
    busy,
    plaintextBackups: f?.state === 'on' ? plaintextBackups(ctx).length : 0,
  };
}

/** Backups made before the vault was on hold readable copies of everything. */
function plaintextBackups(ctx: AppContext): string[] {
  if (!existsSync(ctx.cfg.backupDir)) return [];
  const since = ctx.vault.file?.createdAt ?? 0;
  return readdirSync(ctx.cfg.backupDir).filter((n) => {
    if (!/\.(zip|db)$/.test(n)) return false;
    const m = /(\d{8})-(\d{6})/.exec(n);
    if (!m) return n.startsWith('pre-migration-');
    const d = m[1]!;
    const t = m[2]!;
    const at = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4)}`).getTime();
    return at <= since + 120_000;
  });
}

export function deletePlaintextBackups(ctx: AppContext): number {
  const list = plaintextBackups(ctx);
  for (const n of list) shred(path.join(ctx.cfg.backupDir, n));
  return list.length;
}

/** After unlocking: open the content database and finish any interrupted file sealing. */
function afterUnlock(ctx: AppContext) {
  ctx.db = openEncryptedDb(ctx.cfg.dbPath, ctx.vault.dbKeyHex());
  ctx.vault.lastActivity = Date.now();
  // Files still plain (an interrupted turn-on, or files written by an older copy) get sealed now.
  setTimeout(() => {
    try {
      if (ctx.vault.unlocked && ctx.vault.file?.state === 'on') reconcileFiles(ctx.cfg, ctx.vault.dataKey(), 'seal');
    } catch (e) {
      console.error('Vault: sealing files failed:', (e as Error).name);
    }
  }, 0);
  ctx.bus.publishAll('vault.state', { locked: false });
  try {
    loadAllExtensions(ctx);
  } catch {
    /* extensions are optional */
  }
}

/**
 * Turn the vault on: a plain backup first, then the keys (saved before anything else, so an
 * interruption can be resumed with the passphrase), the system store, an encrypted copy of the
 * database verified against the original, the swap, and finally the media files.
 */
export async function enableVault(ctx: AppContext, owner: string, opts: { passphrase?: string; useLoginPassword?: string; idleMinutes?: number }) {
  return exclusive('turning on', async () => {
    if (ctx.vault.enabled) throw new HttpError(400, 'The vault is already on');
    let passphrase = opts.passphrase ?? '';
    const loginIsPassphrase = !!opts.useLoginPassword;
    if (loginIsPassphrase) {
      const u = ctx.sys.prepare('SELECT pass_hash FROM users WHERE id = ?').get(owner) as { pass_hash: string } | undefined;
      if (!u || !(await verifyPassword(opts.useLoginPassword!, u.pass_hash))) throw new HttpError(400, 'That is not your current password');
      passphrase = opts.useLoginPassword!;
    }
    if (passphrase.length < 10) throw new HttpError(400, 'Use a passphrase of at least 10 characters');
    let recoveryKey: string | null = null;
    let key: Buffer;
    const resumed = ctx.vault.file?.state === 'enabling';
    if (resumed) {
      const k = await unwrapWithSecret(ctx.vault.file!, { passphrase });
      if (!k) throw new HttpError(401, 'Wrong passphrase', 'vault_wrong');
      key = k;
    } else {
      await createBackup(ctx, 'prevault');
      const made = await newVaultFile(passphrase, loginIsPassphrase, opts.idleMinutes ?? 30);
      ctx.vault.save(made.file);
      key = made.key;
      recoveryKey = made.recoveryKey;
    }
    ctx.vault.setKey(key);
    const hex = ctx.vault.dbKeyHex();
    try {
      buildSystemDb(ctx.db, ctx.vault.systemPath);
      ctx.db.pragma('wal_checkpoint(TRUNCATE)');
      const copy = encryptCopy(ctx.db, ctx.cfg.dbPath, hex);
      // Swap: close the plain database, put the verified encrypted copy in its place.
      const plain = ctx.db;
      const sys = openSystemDb(ctx.vault.systemPath);
      plain.close();
      const old = `${ctx.cfg.dbPath}.plain-old`;
      swapIn(copy, ctx.cfg.dbPath, old);
      ctx.vault.save({ ...ctx.vault.file!, state: 'on' });
      ctx.sys = sys;
      ctx.db = openEncryptedDb(ctx.cfg.dbPath, hex);
      shred(old);
      reconcileFiles(ctx.cfg, key, 'seal');
    } catch (e) {
      // Nothing was swapped (or the swap itself failed): the plain database is still in charge.
      if (ctx.vault.file?.state !== 'on') {
        ctx.vault.setKey(null);
        if (!ctx.db.open) {
          ctx.db = openDb(ctx.cfg.dbPath);
          ctx.sys = ctx.db;
        }
      }
      throw new HttpError(500, `Turning the vault on stopped safely: ${(e as Error).message}. Your data is unchanged; try again.`, 'vault_failed');
    }
    ctx.vault.lastActivity = Date.now();
    return { recoveryKey, resumed };
  });
}

export async function unlockVault(ctx: AppContext, secret: { passphrase?: string; recoveryKey?: string }) {
  const f = ctx.vault.file;
  if (!f || !ctx.vault.enabled) throw new HttpError(400, 'The vault is off');
  if (ctx.vault.unlocked) return { ok: true };
  const key = await unwrapWithSecret(f, secret);
  if (!key) throw new HttpError(401, secret.recoveryKey ? 'That recovery key is not right' : 'Wrong passphrase', 'vault_wrong');
  ctx.vault.setKey(key);
  try {
    afterUnlock(ctx);
  } catch (e) {
    ctx.vault.setKey(null);
    ctx.db = lockedDb();
    throw new HttpError(500, `The database could not be opened: ${(e as Error).name}`, 'vault_failed');
  }
  return { ok: true };
}

/** Lock: close the database and forget the key. */
export function lockVault(ctx: AppContext, reason: 'manual' | 'idle' | 'logout') {
  if (!ctx.vault.enabled || !ctx.vault.unlocked || busy) return false;
  try {
    ctx.db.close();
  } catch {
    /* already closed */
  }
  ctx.db = lockedDb();
  ctx.vault.setKey(null);
  ctx.bus.publishAll('vault.state', { locked: true, reason });
  return true;
}

export async function changePassphrase(ctx: AppContext, current: { passphrase?: string; recoveryKey?: string }, next: string, loginIsPassphrase = false) {
  const f = ctx.vault.file;
  if (!f) throw new HttpError(400, 'The vault is off');
  if (next.length < 10) throw new HttpError(400, 'Use a passphrase of at least 10 characters');
  const key = await unwrapWithSecret(f, current);
  if (!key) throw new HttpError(401, 'The current passphrase is not right', 'vault_wrong');
  ctx.vault.save(await rewrapPassphrase(f, key, next, loginIsPassphrase));
  key.fill(0);
}

/** Login password changed while it is also the passphrase: rewrap with the new one. */
export async function onPasswordChanged(ctx: AppContext, oldPassword: string, newPassword: string) {
  if (ctx.vault.file?.loginIsPassphrase) await changePassphrase(ctx, { passphrase: oldPassword }, newPassword, true);
}

/**
 * Turn the vault off: files decrypted first (while the key is known), then a decrypted copy of the
 * database verified and swapped in, the accounts merged back, and the key file removed.
 */
export async function disableVault(ctx: AppContext, secret: { passphrase?: string; recoveryKey?: string }) {
  return exclusive('turning off', async () => {
    const f = ctx.vault.file;
    if (!f || f.state !== 'on') throw new HttpError(400, 'The vault is off');
    const key = await unwrapWithSecret(f, secret);
    if (!key) throw new HttpError(401, 'Wrong passphrase', 'vault_wrong');
    if (!ctx.vault.unlocked) {
      ctx.vault.setKey(key);
      afterUnlock(ctx);
    }
    ctx.vault.save({ ...f, state: 'disabling' });
    try {
      reconcileFiles(ctx.cfg, key, 'unseal');
      const hex = ctx.vault.dbKeyHex();
      ctx.db.pragma('wal_checkpoint(TRUNCATE)');
      const copy = decryptCopy(ctx.db, ctx.cfg.dbPath, hex);
      ctx.db.close();
      const old = `${ctx.cfg.dbPath}.enc-old`;
      swapIn(copy, ctx.cfg.dbPath, old);
      const plain = openDb(ctx.cfg.dbPath);
      mergeSystemDb(ctx.vault.systemPath, plain);
      try {
        ctx.sys.close();
      } catch {
        /* closed */
      }
      ctx.db = plain;
      ctx.sys = plain;
      ctx.vault.save(null);
      ctx.vault.setKey(null);
      unlinkSync(old);
      for (const s of ['', '-wal', '-shm']) if (existsSync(ctx.vault.systemPath + s)) unlinkSync(ctx.vault.systemPath + s);
    } catch (e) {
      if (ctx.vault.file) ctx.vault.save({ ...ctx.vault.file, state: 'on' });
      if (!ctx.db.open) ctx.db = openEncryptedDb(ctx.cfg.dbPath, ctx.vault.dbKeyHex());
      throw new HttpError(500, `Turning the vault off stopped safely: ${(e as Error).message}. It is still on; try again.`, 'vault_failed');
    }
  });
}

export function setIdleMinutes(ctx: AppContext, minutes: number) {
  if (!ctx.vault.file) throw new HttpError(400, 'The vault is off');
  ctx.vault.save({ ...ctx.vault.file, idleMinutes: Math.max(1, Math.min(24 * 60, Math.round(minutes))) });
}

/** Locks after the chosen idle time. */
export function startVaultTimer(ctx: AppContext): () => void {
  const t = setInterval(() => {
    const f = ctx.vault.file;
    if (f && ctx.vault.unlocked && Date.now() - ctx.vault.lastActivity > f.idleMinutes * 60_000) lockVault(ctx, 'idle');
  }, 15_000);
  t.unref?.();
  return () => clearInterval(t);
}
