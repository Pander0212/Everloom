/**
 * The Vault: everything with user content encrypted on disk.
 *
 * Files in the data folder:
 *   vault.json   (plain) the wrapped data key, KDF parameters, state. No names, no text.
 *   system.db    (plain) only what's needed before unlocking: accounts, sessions, sign-in throttling.
 *   everloom.db  (encrypted, SQLCipher format) everything else, search index included.
 *   media/…      (encrypted, AES-256-GCM per file, marked with a header)
 *
 * The data key lives only in this process's memory while unlocked; locking (idle, logout, Lock now,
 * restart) drops it and closes the database. Turning the vault on or off works on copies, verifies
 * them, then swaps, so an interruption leaves either the old state or a resumable one.
 */
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync, closeSync, fstatSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import type { Config } from '../config.js';
import { HttpError } from '../context.js';
import { migrate, type DB } from '../db/index.js';
import { decryptBlob, deriveKek, encryptBlob, isEncryptedBlob, KDF, newRecoveryKey, normalizeRecoveryKey, subkey, unwrapKey, wrapKey, type KdfParams, type Wrapped } from './crypto.js';

export interface VaultFile {
  version: 1;
  /** "enabling": keys exist, data not yet encrypted (resumable). "on": encrypted. "disabling": being decrypted. */
  state: 'enabling' | 'on' | 'disabling';
  kdf: KdfParams;
  salt: string;
  wrapped: Wrapped;
  recoverySalt: string;
  wrappedRecovery: Wrapped;
  /** The login password is the passphrase: signing in unlocks. */
  loginIsPassphrase: boolean;
  idleMinutes: number;
  createdAt: number;
}

const SYSTEM_TABLES = ['users', 'sessions', 'auth_failures'];

export class Vault {
  file: VaultFile | null = null;
  private key: Buffer | null = null;
  lastActivity = Date.now();
  constructor(readonly cfg: Config) {
    this.file = readVaultFile(cfg);
  }
  get path() {
    return path.join(this.cfg.dataDir, 'vault.json');
  }
  get systemPath() {
    return path.join(this.cfg.dataDir, 'system.db');
  }
  /** The content is encrypted on disk (or being decrypted). */
  get enabled() {
    return this.file?.state === 'on' || this.file?.state === 'disabling';
  }
  get locked() {
    return this.enabled && !this.key;
  }
  get unlocked() {
    return !!this.key;
  }
  dataKey(): Buffer {
    if (!this.key) throw new HttpError(423, 'The vault is locked', 'locked');
    return this.key;
  }
  mediaKey(): Buffer | null {
    return this.key ? subkey(this.key, 'media') : null;
  }
  dbKeyHex(): string {
    return subkey(this.dataKey(), 'database').toString('hex');
  }
  setKey(k: Buffer | null) {
    if (this.key) this.key.fill(0);
    this.key = k;
  }
  save(f: VaultFile | null) {
    this.file = f;
    if (!f) {
      rmSync(this.path, { force: true });
      return;
    }
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(f, null, 1), { mode: 0o600 });
    renameSync(tmp, this.path);
  }
}

export function readVaultFile(cfg: Config): VaultFile | null {
  const p = path.join(cfg.dataDir, 'vault.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as VaultFile;
  } catch {
    throw new Error(`vault.json in ${cfg.dataDir} is unreadable; restore it from a backup (without it the encrypted data can't be opened).`);
  }
}

// ------------------------------------------------------------------ opening databases

export function keyDb(db: DB, hexKey: string) {
  db.pragma(`cipher='sqlcipher'`);
  db.pragma(`key="x'${hexKey}'"`);
}

/** The encrypted content database, opened with the vault key (throws if the key is wrong). */
export function openEncryptedDb(file: string, hexKey: string): DB {
  const db = new Database(file);
  keyDb(db, hexKey);
  db.prepare('SELECT count(*) FROM sqlite_master').get();
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db, { backupDir: path.join(path.dirname(file), 'backups') });
  return db;
}

export function openSystemDb(file: string): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

/** Stands in for the content database while locked: any use answers "locked". */
export function lockedDb(): DB {
  return new Proxy({} as DB, {
    get(_t, prop) {
      if (prop === 'open') return false;
      if (prop === 'close') return () => undefined;
      if (prop === 'then') return undefined;
      throw new HttpError(423, 'The vault is locked. Unlock it to continue.', 'locked');
    },
  });
}

// ------------------------------------------------------------------ keys

export async function unwrapWithSecret(f: VaultFile, secret: { passphrase?: string; recoveryKey?: string }): Promise<Buffer | null> {
  if (secret.recoveryKey) return unwrapKey(f.wrappedRecovery, await deriveKek(normalizeRecoveryKey(secret.recoveryKey), Buffer.from(f.recoverySalt, 'base64'), f.kdf));
  if (secret.passphrase) return unwrapKey(f.wrapped, await deriveKek(secret.passphrase, Buffer.from(f.salt, 'base64'), f.kdf));
  return null;
}

export async function newVaultFile(passphrase: string, loginIsPassphrase: boolean, idleMinutes: number): Promise<{ file: VaultFile; key: Buffer; recoveryKey: string }> {
  const key = randomBytes(32);
  const salt = randomBytes(16);
  const recoverySalt = randomBytes(16);
  const recoveryKey = newRecoveryKey();
  const file: VaultFile = {
    version: 1,
    state: 'enabling',
    kdf: KDF,
    salt: salt.toString('base64'),
    wrapped: wrapKey(key, await deriveKek(passphrase, salt)),
    recoverySalt: recoverySalt.toString('base64'),
    wrappedRecovery: wrapKey(key, await deriveKek(normalizeRecoveryKey(recoveryKey), recoverySalt)),
    loginIsPassphrase,
    idleMinutes,
    createdAt: Date.now(),
  };
  return { file, key, recoveryKey };
}

export async function rewrapPassphrase(f: VaultFile, key: Buffer, passphrase: string, loginIsPassphrase: boolean): Promise<VaultFile> {
  const salt = randomBytes(16);
  return { ...f, salt: salt.toString('base64'), wrapped: wrapKey(key, await deriveKek(passphrase, salt)), loginIsPassphrase };
}

// ------------------------------------------------------------------ files

/** Write a content file: encrypted when the vault is on and unlocked. */
export function writeContentFile(vault: Vault | undefined, file: string, data: Buffer) {
  const key = vault?.enabled ? vault.mediaKey() : null;
  if (vault?.enabled && !key) throw new HttpError(423, 'The vault is locked', 'locked');
  writeFileSync(file, key ? encryptBlob(key, data) : data);
}

/** Read a content file, decrypting it when it was written by the vault. */
export function readContentFile(vault: Vault | undefined, file: string): Buffer {
  const buf = readFileSync(file);
  if (!isEncryptedBlob(buf)) return buf;
  const key = vault?.mediaKey();
  if (!key) throw new HttpError(423, 'The vault is locked', 'locked');
  return decryptBlob(key, buf);
}

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, out);
    else if (!name.endsWith('.vlt-tmp')) out.push(full);
  }
  return out;
}

/** Folders whose files are user content. */
export const contentDirs = (cfg: Config) => [cfg.mediaDir, path.join(cfg.dataDir, 'live2d')];

/**
 * Bring every content file to the vault's state: encrypt plain ones (seal) or decrypt encrypted
 * ones (unseal). Each file is written to a temporary name and renamed over the original, so a crash
 * leaves the file in one state or the other; reads handle both. Returns how many files changed.
 */
export function reconcileFiles(cfg: Config, key: Buffer, mode: 'seal' | 'unseal'): number {
  const mk = subkey(key, 'media');
  let n = 0;
  for (const dir of contentDirs(cfg))
    for (const f of walkFiles(dir)) {
      const buf = readFileSync(f);
      const enc = isEncryptedBlob(buf);
      if ((mode === 'seal' && enc) || (mode === 'unseal' && !enc)) continue;
      const tmp = `${f}.vlt-tmp`;
      writeFileSync(tmp, mode === 'seal' ? encryptBlob(mk, buf) : decryptBlob(mk, buf));
      renameSync(tmp, f);
      n++;
    }
  for (const dir of contentDirs(cfg)) for (const f of walkFiles(dir).filter((x) => x.endsWith('.vlt-tmp'))) rmSync(f, { force: true });
  return n;
}

/** Overwrite a file with zeros before deleting it (best effort; SSDs and copy-on-write disks may keep old blocks). */
export function shred(file: string) {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    if (!existsSync(f)) continue;
    try {
      const fd = openSync(f, 'r+');
      const size = fstatSync(fd).size;
      const zero = Buffer.alloc(Math.min(size, 1 << 20));
      for (let at = 0; at < size; at += zero.length) writeSync(fd, zero, 0, Math.min(zero.length, size - at), at);
      closeSync(fd);
    } catch {
      /* deleted anyway below */
    }
    unlinkSync(f);
  }
}

// ------------------------------------------------------------------ moving the data in and out

function tableCounts(db: DB): Record<string, number> {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql NOT LIKE 'CREATE VIRTUAL%'").all() as Array<{ name: string }>).map((r) => r.name);
  return Object.fromEntries(tables.map((t) => [t, (db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n]));
}

/** The system store: the accounts, sessions and throttling tables, copied with their exact schema. */
export function buildSystemDb(content: DB, file: string) {
  const tmp = `${file}.tmp`;
  rmSync(tmp, { force: true });
  const sys = new Database(tmp);
  for (const t of SYSTEM_TABLES) {
    const row = content.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t) as { sql: string } | undefined;
    if (!row) continue;
    sys.exec(row.sql);
    const rows = content.prepare(`SELECT * FROM "${t}"`).all() as Array<Record<string, unknown>>;
    if (rows.length) {
      const cols = Object.keys(rows[0]!);
      const ins = sys.prepare(`INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      sys.transaction(() => rows.forEach((r) => ins.run(...cols.map((c) => r[c]))))();
    }
  }
  for (const r of content.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL AND tbl_name IN ('users','sessions','auth_failures')").all() as Array<{ sql: string }>) sys.exec(r.sql);
  sys.close();
  renameSync(tmp, file);
}

/** Copy the system tables back into the content database (turning the vault off). */
export function mergeSystemDb(sysFile: string, content: DB) {
  const sys = new Database(sysFile, { readonly: true });
  content.transaction(() => {
    for (const t of SYSTEM_TABLES) {
      const rows = sys.prepare(`SELECT * FROM "${t}"`).all() as Array<Record<string, unknown>>;
      content.prepare(`DELETE FROM "${t}"`).run();
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]!);
      const ins = content.prepare(`INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      rows.forEach((r) => ins.run(...cols.map((c) => r[c])));
    }
  })();
  sys.close();
}

/**
 * Encrypt a consistent copy of the plain database, verify it against the original (integrity and
 * row counts), and return the copy's path. The original is untouched.
 */
export function encryptCopy(plain: DB, target: string, hexKey: string): string {
  const tmp = `${target}.vault-tmp`;
  for (const s of ['', '-wal', '-shm', '-journal']) rmSync(tmp + s, { force: true });
  plain.prepare('VACUUM INTO ?').run(tmp);
  const e = new Database(tmp);
  e.pragma('journal_mode = DELETE');
  e.pragma(`cipher='sqlcipher'`);
  e.pragma(`rekey="x'${hexKey}'"`);
  e.close();
  verifyCopy(plain, tmp, hexKey);
  return tmp;
}

/** Decrypt a consistent copy of the encrypted database (turning the vault off), verified. */
export function decryptCopy(enc: DB, target: string, hexKey: string): string {
  const tmp = `${target}.vault-tmp`;
  for (const s of ['', '-wal', '-shm', '-journal']) rmSync(tmp + s, { force: true });
  enc.prepare('VACUUM INTO ?').run(tmp);
  const d = new Database(tmp);
  keyDb(d, hexKey);
  d.pragma('journal_mode = DELETE');
  d.pragma(`rekey=''`);
  d.close();
  verifyCopy(enc, tmp, null);
  return tmp;
}

function verifyCopy(source: DB, copy: string, hexKey: string | null) {
  const c = new Database(copy, { readonly: true });
  try {
    if (hexKey) keyDb(c, hexKey);
    const ok = c.pragma('integrity_check', { simple: true });
    if (ok !== 'ok') throw new Error(`integrity check: ${ok}`);
    const a = tableCounts(source);
    const b = tableCounts(c);
    for (const [t, n] of Object.entries(a)) if (b[t] !== n) throw new Error(`table ${t}: ${n} rows, copy has ${b[t]}`);
  } finally {
    c.close();
  }
  // A copy meant to be encrypted must not open without the key.
  if (hexKey) {
    const raw = readFileSync(copy).subarray(0, 16).toString('latin1');
    if (raw.startsWith('SQLite format 3')) throw new Error('the copy is not encrypted');
  }
}

/** Swap a verified copy in place of the live database file. */
export function swapIn(copy: string, live: string, keepOldAs?: string) {
  for (const s of ['-wal', '-shm', '-journal']) if (existsSync(live + s)) unlinkSync(live + s);
  if (keepOldAs) renameSync(live, keepOldAs);
  renameSync(copy, live);
}

export const vaultDir = (cfg: Config) => {
  mkdirSync(cfg.dataDir, { recursive: true });
  return cfg.dataDir;
};
