/**
 * Backups: SQLite online backup + media folder, zipped, with retention.
 * Restore is staged and applied on the next start, before the database is opened.
 */
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { HttpError, type AppContext } from '../context.js';
import { getSettings, getKv, setKv } from './settings.js';

const NAME_RE = /^everloom-\d{8}-\d{6}(-[a-z]+)?\.zip$/;

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function walk(dir: string, base = dir, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out;
}

export async function createBackup(ctx: AppContext, label = ''): Promise<{ name: string; size: number }> {
  const tmpDb = path.join(ctx.cfg.backupDir, `.tmp-${Date.now()}.db`);
  await ctx.db.backup(tmpDb);
  let name = `everloom-${stamp()}${label ? `-${label}` : ''}.zip`;
  if (existsSync(path.join(ctx.cfg.backupDir, name))) name = name.replace('.zip', `-${Date.now() % 1000}.zip`).replace(/-(\d+)\.zip$/, '.zip');
  const out = path.join(ctx.cfg.backupDir, name);
  const zip = new yazl.ZipFile();
  zip.addFile(tmpDb, 'everloom.db');
  for (const rel of walk(ctx.cfg.mediaDir)) zip.addFile(path.join(ctx.cfg.mediaDir, rel), `media/${rel.split(path.sep).join('/')}`);
  zip.addBuffer(Buffer.from(JSON.stringify({ app: 'everloom', format: 1, createdAt: new Date().toISOString() })), 'manifest.json');
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(out));
  unlinkSync(tmpDb);
  pruneBackups(ctx);
  return { name, size: statSync(out).size };
}

export function listBackups(ctx: AppContext) {
  return readdirSync(ctx.cfg.backupDir)
    .filter((n) => NAME_RE.test(n))
    .map((n) => {
      const st = statSync(path.join(ctx.cfg.backupDir, n));
      return { name: n, size: st.size, createdAt: st.mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function backupPath(ctx: AppContext, name: string): string {
  if (!NAME_RE.test(name)) throw new HttpError(400, 'Invalid backup name');
  const p = path.join(ctx.cfg.backupDir, name);
  if (!existsSync(p)) throw new HttpError(404, 'Backup not found');
  return p;
}

export function pruneBackups(ctx: AppContext) {
  const owner = (ctx.db.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get() as { id: string } | undefined)?.id;
  const keep = owner ? getSettings(ctx, owner).backups.retention : ctx.cfg.backupRetention;
  const all = listBackups(ctx).filter((b) => !b.name.includes('-pre'));
  for (const b of all.slice(Math.max(1, keep))) unlinkSync(path.join(ctx.cfg.backupDir, b.name));
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((res, rej) => yauzl.open(file, { lazyEntries: true, autoClose: true }, (err, zip) => (err ? rej(err) : res(zip!))));
}

/** Safe extraction: no absolute paths, no "..", size and entry-count caps. */
export async function extractZip(file: string, dest: string, opts: { maxBytes?: number; maxEntries?: number; filter?: (name: string) => boolean } = {}): Promise<string[]> {
  const zip = await openZip(file).catch((e: Error) => {
    throw new HttpError(400, `Invalid archive: ${e.message}`);
  });
  const maxBytes = opts.maxBytes ?? 4 * 1024 * 1024 * 1024;
  const maxEntries = opts.maxEntries ?? 200_000;
  const root = path.resolve(dest);
  mkdirSync(root, { recursive: true });
  let total = 0;
  let count = 0;
  const written: string[] = [];
  return new Promise((resolve, rejectRaw) => {
    // Anything yauzl itself rejects (bad names, corrupt data) is the upload's fault, not ours.
    const reject = (e: unknown) => {
      zip.close();
      rejectRaw(e instanceof HttpError ? e : new HttpError(400, `Invalid archive: ${(e as Error)?.message ?? 'unreadable'}`));
    };
    zip.on('error', reject);
    zip.on('end', () => resolve(written));
    zip.on('entry', (entry: yauzl.Entry) => {
      const name = entry.fileName.replace(/\\/g, '/');
      if (++count > maxEntries) return reject(new HttpError(400, 'Archive has too many files'));
      const target = path.resolve(root, name);
      if (name.startsWith('/') || name.split('/').includes('..') || !(target === root || target.startsWith(root + path.sep))) {
        return reject(new HttpError(400, `Unsafe path in archive: ${name}`));
      }
      if (name.endsWith('/') || (opts.filter && !opts.filter(name))) return zip.readEntry();
      total += entry.uncompressedSize;
      if (total > maxBytes) return reject(new HttpError(413, 'Archive is too large when extracted'));
      mkdirSync(path.dirname(target), { recursive: true });
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return reject(err);
        pipeline(stream, createWriteStream(target))
          .then(() => {
            written.push(name);
            zip.readEntry();
          })
          .catch(reject);
      });
    });
    zip.readEntry();
  });
}

/** Validate an uploaded backup and stage it; it is applied at the next start. */
export async function stageRestore(ctx: AppContext, zipFile: string): Promise<void> {
  const staging = path.join(ctx.cfg.dataDir, 'restore-pending');
  rmSync(staging, { recursive: true, force: true });
  const files = await extractZip(zipFile, staging);
  if (!files.includes('everloom.db')) {
    rmSync(staging, { recursive: true, force: true });
    throw new HttpError(400, 'This is not an Everloom backup (no everloom.db inside)');
  }
  // Safety net: back up the current data before it gets replaced.
  await createBackup(ctx, 'prerestore');
}

/** Called at startup before the DB is opened. Returns true if a restore was applied. */
export function applyPendingRestore(dataDir: string): boolean {
  const staging = path.join(dataDir, 'restore-pending');
  if (!existsSync(path.join(staging, 'everloom.db'))) return false;
  const dbPath = path.join(dataDir, 'everloom.db');
  for (const suffix of ['', '-wal', '-shm']) if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
  renameSync(path.join(staging, 'everloom.db'), dbPath);
  const media = path.join(dataDir, 'media');
  if (existsSync(path.join(staging, 'media'))) {
    rmSync(media, { recursive: true, force: true });
    renameSync(path.join(staging, 'media'), media);
  }
  rmSync(staging, { recursive: true, force: true });
  return true;
}

export function startScheduler(ctx: AppContext): () => void {
  const tick = async () => {
    try {
      const owner = (ctx.db.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get() as { id: string } | undefined)?.id;
      if (!owner) return;
      const s = getSettings(ctx, owner);
      if (!s.backups.nightly) return;
      const last = getKv<number>(ctx, owner, 'lastNightlyBackup', 0);
      const now = new Date();
      if (now.getHours() !== s.backups.hour || Date.now() - last < 20 * 3600 * 1000) return;
      setKv(ctx, owner, 'lastNightlyBackup', Date.now());
      await createBackup(ctx, 'nightly');
    } catch (e) {
      console.error('Nightly backup failed', e);
    }
  };
  const timer = setInterval(() => void tick(), 10 * 60 * 1000);
  return () => clearInterval(timer);
}
