import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  mediaDir: string;
  backupDir: string;
  dbPath: string;
  webDir: string;
  /** 32-byte key used for AES-256-GCM encryption of stored secrets. */
  secretKey: Buffer;
  /** Force Secure cookies even over plain HTTP (behind a TLS proxy that doesn't set X-Forwarded-Proto). */
  forceSecureCookies: boolean;
  trustProxy: boolean;
  /** Allow outbound calls to private network addresses (local LLMs on the same VPS). */
  allowPrivateNetwork: boolean;
  backupRetention: number;
  logLevel: string;
  /** Restricts which directories the SillyTavern importer may read. */
  importRoots: string[];
}

function parseKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const hex = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : null;
  if (hex) return hex;
  const b64 = Buffer.from(raw, 'base64');
  return b64.length === 32 ? b64 : null;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = process.env;
  const dataDir = path.resolve(overrides.dataDir ?? env.EVERLOOM_DATA_DIR ?? path.join(process.cwd(), 'data'));
  mkdirSync(dataDir, { recursive: true });
  let secretKey = overrides.secretKey ?? parseKey(env.EVERLOOM_SECRET_KEY);
  if (!secretKey) {
    // No key in the environment: keep one next to the data so restarts can still decrypt.
    const keyFile = path.join(dataDir, '.secret-key');
    if (existsSync(keyFile)) secretKey = parseKey(readFileSync(keyFile, 'utf8').trim());
    if (!secretKey) {
      secretKey = randomBytes(32);
      writeFileSync(keyFile, secretKey.toString('hex'), { mode: 0o600 });
    }
  }
  const webDir = overrides.webDir ?? env.EVERLOOM_WEB_DIR ?? path.resolve(process.cwd(), 'apps/web/dist');
  const cfg: Config = {
    port: Number(env.PORT ?? env.EVERLOOM_PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    dataDir,
    mediaDir: path.join(dataDir, 'media'),
    backupDir: path.join(dataDir, 'backups'),
    dbPath: path.join(dataDir, 'everloom.db'),
    webDir,
    secretKey,
    forceSecureCookies: env.EVERLOOM_SECURE_COOKIES === '1',
    trustProxy: env.EVERLOOM_TRUST_PROXY !== '0',
    allowPrivateNetwork: env.EVERLOOM_ALLOW_PRIVATE_NETWORK !== '0',
    backupRetention: Number(env.EVERLOOM_BACKUP_RETENTION ?? 14),
    logLevel: env.LOG_LEVEL ?? 'warn',
    // Folders the SillyTavern importer may read. Docker sets /import; otherwise the home folder.
    importRoots: (env.EVERLOOM_IMPORT_ROOTS ?? os.homedir()).split(':').filter(Boolean),
    ...overrides,
  };
  mkdirSync(cfg.mediaDir, { recursive: true });
  mkdirSync(cfg.backupDir, { recursive: true });
  return cfg;
}
