/**
 * The Blender worker: converts FBX, PMX/PMD, OBJ and DAE models (and FBX/BVH/VMD motions) to GLB,
 * and later fits garments and retargets. Blender is optional; everything else works without it.
 *
 * Jobs run one at a time in a fresh background Blender (factory settings, scripts in files never
 * auto-run), inside a private temp folder that is deleted afterwards, with a time limit, a minimal
 * environment (no keys, no tokens) and the job's files only. The file being converted is decrypted
 * into that folder for the run, since Blender needs a file; nothing else from the vault is.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, type AppContext } from '../context.js';
import { newId } from '../security/crypto.js';
import { getKv, setKv } from './settings.js';

export interface BlenderInfo {
  found: boolean;
  path: string | null;
  version: string | null;
  /** MMD Tools (needed for PMX, PMD and VMD). */
  mmd: boolean;
  source: 'setting' | 'env' | 'path' | 'common' | 'data' | null;
}

const here = path.dirname(fileURLToPath(import.meta.url));
function workerScript(): string {
  for (const f of [path.join(here, 'blender-worker.py'), path.join(here, '../blender/worker.py'), path.join(here, 'blender/worker.py')]) if (existsSync(f)) return f;
  throw new Error('The Blender worker script is missing');
}

const exe = process.platform === 'win32' ? 'blender.exe' : 'blender';

/** Places Blender is usually installed, newest version first. */
function commonPaths(dataDir: string): Array<{ p: string; source: BlenderInfo['source'] }> {
  const out: Array<{ p: string; source: BlenderInfo['source'] }> = [];
  const add = (p: string, source: BlenderInfo['source']) => out.push({ p, source });
  const versioned = (dir: string, pattern: RegExp, sub: string) => {
    try {
      const names = readdirSync(dir).filter((n) => pattern.test(n));
      names.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
      for (const n of names) add(path.join(dir, n, sub), dir.startsWith(dataDir) ? 'data' : 'common');
    } catch {
      /* not there */
    }
  };
  // install.sh puts a portable Blender under the data folder.
  versioned(path.join(dataDir, 'blender'), /^blender-/i, exe);
  if (process.platform === 'win32') {
    for (const pf of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files']) if (pf) versioned(path.join(pf, 'Blender Foundation'), /^Blender/i, exe);
    if (process.env.LOCALAPPDATA) versioned(path.join(process.env.LOCALAPPDATA, 'Programs', 'Blender Foundation'), /^Blender/i, exe);
    // Steam installs.
    for (const pf of [process.env['ProgramFiles(x86)'], 'C:\\Program Files (x86)']) if (pf) add(path.join(pf, 'Steam', 'steamapps', 'common', 'Blender', exe), 'common');
  } else if (process.platform === 'darwin') {
    add('/Applications/Blender.app/Contents/MacOS/Blender', 'common');
    add(path.join(os.homedir(), 'Applications/Blender.app/Contents/MacOS/Blender'), 'common');
  } else {
    for (const p of ['/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender', '/var/lib/flatpak/exports/bin/org.blender.Blender']) add(p, 'common');
    versioned(os.homedir(), /^blender-\d/i, 'blender');
    versioned('/opt', /^blender/i, 'blender');
  }
  return out;
}

function onPath(): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const f = path.join(dir, exe);
    try {
      if (statSync(f).isFile()) return f;
    } catch {
      /* not here */
    }
  }
  return null;
}

function run(file: string, argv: string[], opts: { cwd?: string; timeoutMs: number; env?: NodeJS.ProcessEnv }): Promise<{ code: number | null; out: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(file, argv, { cwd: opts.cwd, env: opts.env ?? minimalEnv(opts.cwd ?? os.tmpdir()), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    const take = (d: Buffer) => {
      if (out.length < 64_000) out += d.toString('utf8');
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: -1, out, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, timedOut });
    });
  });
}

/** Only what Blender needs to start: no API keys, no tokens, no session secrets. */
function minimalEnv(home: string): NodeJS.ProcessEnv {
  const keep = ['PATH', 'SYSTEMROOT', 'WINDIR', 'LANG', 'LC_ALL', 'DISPLAY', 'XDG_RUNTIME_DIR', 'LD_LIBRARY_PATH', 'COMSPEC', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE'];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keep) if (process.env[k]) env[k] = process.env[k];
  // Blender keeps its user config (and add-ons such as MMD Tools) under the real profile; share
  // only that folder by pointing at the owner's normal Blender config.
  env.HOME = process.env.HOME ?? home;
  if (process.env.APPDATA) env.APPDATA = process.env.APPDATA;
  if (process.env.USERPROFILE) env.USERPROFILE = process.env.USERPROFILE;
  env.TMP = env.TEMP = env.TMPDIR = home;
  return env;
}

let cached: { at: number; info: BlenderInfo } | null = null;

async function probe(file: string): Promise<{ version: string | null; mmd: boolean } | null> {
  if (!existsSync(file)) return null;
  const tmp = jobDir();
  try {
    writeFileSync(path.join(tmp, 'job.json'), JSON.stringify({ op: 'info' }));
    const r = await run(file, ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '3', '--python', workerScript(), '--', path.join(tmp, 'job.json')], { cwd: tmp, timeoutMs: 60_000 });
    const res = existsSync(path.join(tmp, 'result.json')) ? JSON.parse(readFileSync(path.join(tmp, 'result.json'), 'utf8')) : null;
    if (!res?.ok) return r.code === 0 || /Blender \d/.test(r.out) ? { version: /Blender (\d+\.\d+(?:\.\d+)?)/.exec(r.out)?.[1] ?? null, mmd: false } : null;
    return { version: res.version ?? null, mmd: !!res.mmd };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

let tmpRoot = path.join(os.tmpdir(), 'everloom-blender');
export function setBlenderTmp(dir: string) {
  tmpRoot = dir;
}
function jobDir(): string {
  const d = path.join(tmpRoot, newId('bj_'));
  mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

/** Finds Blender: the path set in Settings, EVERLOOM_BLENDER, PATH, then the usual install places. */
export async function findBlender(ctx: AppContext, owner: string, opts: { refresh?: boolean } = {}): Promise<BlenderInfo> {
  if (cached && !opts.refresh && Date.now() - cached.at < 10 * 60_000) return cached.info;
  setBlenderTmp(path.join(ctx.cfg.dataDir, 'tmp', 'blender'));
  const set = getKv<{ path?: string }>(ctx, owner, 'blender', {}).path;
  const tries: Array<{ p: string; source: BlenderInfo['source'] }> = [];
  if (set) tries.push({ p: set, source: 'setting' });
  if (process.env.EVERLOOM_BLENDER) tries.push({ p: process.env.EVERLOOM_BLENDER, source: 'env' });
  const fromPath = onPath();
  if (fromPath) tries.push({ p: fromPath, source: 'path' });
  tries.push(...commonPaths(ctx.cfg.dataDir));
  let info: BlenderInfo = { found: false, path: null, version: null, mmd: false, source: null };
  for (const t of tries) {
    const r = await probe(t.p);
    if (r) {
      info = { found: true, path: t.p, version: r.version, mmd: r.mmd, source: t.source };
      break;
    }
  }
  cached = { at: Date.now(), info };
  return info;
}

export function setBlenderPath(ctx: AppContext, owner: string, p: string | null) {
  if (p && !/blender(\.exe)?$/i.test(path.basename(p)) && !/Blender$/.test(p)) throw new HttpError(400, 'Point this at the Blender program itself (blender or blender.exe)');
  setKv(ctx, owner, 'blender', p ? { path: p } : {});
  cached = null;
}

// One job at a time: Blender is heavy, and a phone-sized server shouldn't run two.
let chain: Promise<unknown> = Promise.resolve();
const waiting = { n: 0 };
export function blenderQueueLength() {
  return waiting.n;
}

export interface BlenderJob {
  op: 'convert' | 'motion' | 'optimize' | 'fit' | 'render' | 'mpfb' | 'mpfb_assets';
  /** Input files by name (written into the job folder). */
  files: Record<string, Buffer>;
  input: string;
  /** The file the job makes ('' for jobs that only answer, such as listing MPFB's assets). */
  output: string;
  /** Blender extensions folder to use instead of the owner's profile (the MPFB that Everloom installed). */
  extensions?: string;
  timeoutMs?: number;
  extra?: Record<string, unknown>;
}

/** Recent jobs, newest first (in memory): what ran, how it went, and the end of Blender's log. */
export interface BlenderJobLog {
  id: number;
  owner: string;
  op: string;
  state: 'waiting' | 'running' | 'done' | 'failed';
  queuedAt: number;
  startedAt: number | null;
  ms: number | null;
  error: string | null;
  log: string;
}
const jobLog: BlenderJobLog[] = [];
let jobSeq = 0;
export function blenderJobs(owner: string): Array<Omit<BlenderJobLog, 'owner'>> {
  return jobLog.filter((j) => j.owner === owner).map(({ owner: _o, ...j }) => j);
}

export async function runBlenderJob(ctx: AppContext, owner: string, job: BlenderJob): Promise<{ output: Buffer; result: Record<string, unknown> }> {
  const info = await findBlender(ctx, owner);
  if (!info.found || !info.path) throw new HttpError(424, 'This file type needs Blender, which was not found. Install Blender (free, blender.org) or set its path in Settings → 3D.', 'blender_missing');
  waiting.n++;
  const entry: BlenderJobLog = { id: ++jobSeq, owner, op: job.op, state: 'waiting', queuedAt: Date.now(), startedAt: null, ms: null, error: null, log: '' };
  jobLog.unshift(entry);
  jobLog.length = Math.min(jobLog.length, 30);
  const task = chain.then(async () => {
    waiting.n--;
    entry.state = 'running';
    entry.startedAt = Date.now();
    const dir = jobDir();
    try {
      for (const [name, bytes] of Object.entries(job.files)) {
        if (!/^[\w.-]{1,80}$/.test(name)) throw new HttpError(400, 'Bad file name');
        writeFileSync(path.join(dir, name), bytes, { mode: 0o600 });
      }
      writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ op: job.op, input: job.input, output: job.output, ...(job.extra ?? {}) }));
      const r = await run(info.path!, ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '3', '--python', workerScript(), '--', path.join(dir, 'job.json')], {
        cwd: dir,
        timeoutMs: job.timeoutMs ?? 5 * 60_000,
        env: job.extensions ? { ...minimalEnv(dir), BLENDER_USER_EXTENSIONS: job.extensions } : undefined,
      });
      // The log never holds file contents; paths are the job's own temporary folder.
      entry.log = r.out.split(dir).join('<job>').slice(-4000);
      if (r.timedOut) throw new HttpError(504, 'Blender took too long and was stopped', 'blender_timeout');
      const res = existsSync(path.join(dir, 'result.json')) ? (JSON.parse(readFileSync(path.join(dir, 'result.json'), 'utf8')) as Record<string, unknown>) : null;
      if (!res?.ok) {
        const err = String(res?.error ?? 'Blender stopped without a result');
        if (err.includes('MPFB_MISSING')) throw new HttpError(424, 'Realistic characters need MPFB (the MakeHuman add-on): install it in Settings → 3D characters.', 'mpfb_missing');
        if (err.includes('MMD_TOOLS_MISSING')) throw new HttpError(424, 'PMX, PMD and VMD files need the free MMD Tools add-on in Blender (Edit → Preferences → Get Extensions → "MMD Tools").', 'mmd_tools_missing');
        throw new HttpError(422, `Blender could not convert the file: ${err}`, 'blender_failed');
      }
      entry.state = 'done';
      if (!job.output) return { output: Buffer.alloc(0), result: res };
      const out = path.join(dir, job.output);
      if (!existsSync(out)) throw new HttpError(422, 'Blender produced no file', 'blender_failed');
      return { output: readFileSync(out), result: res };
    } catch (e) {
      entry.state = 'failed';
      entry.error = (e as Error).message.slice(0, 300);
      throw e;
    } finally {
      entry.ms = Date.now() - (entry.startedAt ?? Date.now());
      rmSync(dir, { recursive: true, force: true });
    }
  });
  chain = task.catch(() => undefined);
  return task;
}

/** Leftover job folders from a crash are removed at start. */
export function cleanBlenderTmp(ctx: AppContext) {
  rmSync(path.join(ctx.cfg.dataDir, 'tmp', 'blender'), { recursive: true, force: true });
}

