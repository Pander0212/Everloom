/**
 * One-click install of a headless Blender converter on the server (optional). Blender needs no
 * graphics card to convert files; it needs an x86-64 Linux machine with about 2 GB of free memory
 * and 1–2 GB of disk. The official Blender 4.2 LTS build is downloaded from download.blender.org,
 * checked against its published SHA-256, and unpacked into the data folder, where findBlender
 * finds it. Nothing runs from it until a conversion asks for it.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, rmSync, statfsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError, type AppContext } from '../context.js';
import { findBlender } from './blender.js';

export const BLENDER_VERSION = '4.2.3';
const BASE = 'https://download.blender.org/release/Blender4.2';
const FILE = `blender-${BLENDER_VERSION}-linux-x64.tar.xz`;

export interface InstallCheck {
  ok: boolean;
  platform: string;
  arch: string;
  freeMemoryGb: number;
  freeDiskGb: number;
  /** Why it can't be installed here, in plain words. */
  reasons: string[];
  installed: boolean;
}

export interface InstallState {
  state: 'idle' | 'downloading' | 'checking' | 'unpacking' | 'done' | 'failed';
  progress: number;
  error: string | null;
}

let state: InstallState = { state: 'idle', progress: 0, error: null };
const dirOf = (ctx: AppContext) => path.join(ctx.cfg.dataDir, 'blender');

export function installCheck(ctx: AppContext): InstallCheck {
  const reasons: string[] = [];
  const free = (() => {
    try {
      const s = statfsSync(ctx.cfg.dataDir);
      return (s.bavail * s.bsize) / 1024 ** 3;
    } catch {
      return 0;
    }
  })();
  const mem = os.freemem() / 1024 ** 3;
  if (process.platform !== 'linux') reasons.push(process.platform === 'win32' ? 'On Windows, install Blender from blender.org: Everloom finds it by itself.' : 'On this system, install Blender from blender.org and set its path.');
  else if (os.arch() !== 'x64') reasons.push(`Blender publishes Linux builds for x86-64 only; this server is ${os.arch()}. Install Blender from your system's packages (for example "apt install blender") and set its path.`);
  if (free < 1.5) reasons.push(`About 1.5 GB of free disk is needed (${free.toFixed(1)} GB free).`);
  if (os.totalmem() / 1024 ** 3 < 2) reasons.push(`About 2 GB of memory is needed (${(os.totalmem() / 1024 ** 3).toFixed(1)} GB in all).`);
  return { ok: !reasons.length, platform: process.platform, arch: os.arch(), freeMemoryGb: Math.round(mem * 10) / 10, freeDiskGb: Math.round(free * 10) / 10, reasons, installed: existsSync(path.join(dirOf(ctx), `blender-${BLENDER_VERSION}-linux-x64`, 'blender')) };
}

export const installState = () => state;

/** Starts the download and install (returns at once; poll installState). */
export function startInstall(ctx: AppContext, owner: string) {
  const check = installCheck(ctx);
  if (!check.ok) throw new HttpError(409, check.reasons.join(' '));
  if (['downloading', 'checking', 'unpacking'].includes(state.state)) return state;
  state = { state: 'downloading', progress: 0, error: null };
  void run(ctx, owner).catch((e) => {
    state = { state: 'failed', progress: 0, error: (e as Error).message };
  });
  return state;
}

async function run(ctx: AppContext, owner: string) {
  const dir = dirOf(ctx);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `${FILE}.part`);
  try {
    const sums = await (await fetch(`${BASE}/blender-${BLENDER_VERSION}.sha256`)).text();
    const want = sums.split('\n').find((l) => l.trim().endsWith(FILE))?.split(/\s+/)[0];
    if (!want || !/^[0-9a-f]{64}$/.test(want)) throw new Error('Could not read the published checksum from blender.org.');
    const res = await fetch(`${BASE}/${FILE}`);
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
    const total = Number(res.headers.get('content-length') ?? 0);
    const hash = createHash('sha256');
    let got = 0;
    const body = Readable.fromWeb(res.body as never);
    body.on('data', (c: Buffer) => {
      hash.update(c);
      got += c.length;
      if (total) state = { ...state, progress: Math.round((got / total) * 100) };
    });
    await pipeline(body, createWriteStream(tmp, { mode: 0o600 }));
    state = { state: 'checking', progress: 100, error: null };
    if (hash.digest('hex') !== want) throw new Error('The download did not match blender.org’s checksum; nothing was installed.');
    state = { state: 'unpacking', progress: 100, error: null };
    await new Promise<void>((resolve, reject) => {
      const p = spawn('tar', ['-xJf', tmp, '-C', dir], { stdio: 'ignore' });
      p.on('error', reject);
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Unpacking failed (tar exited with ${code}). Is xz installed?`))));
    });
    const info = await findBlender(ctx, owner, { refresh: true });
    if (!info.found) throw new Error('Blender was unpacked but does not start on this server.');
    state = { state: 'done', progress: 100, error: null };
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Removes the installed converter. */
export async function uninstall(ctx: AppContext, owner: string) {
  rmSync(path.join(dirOf(ctx), `blender-${BLENDER_VERSION}-linux-x64`), { recursive: true, force: true });
  state = { state: 'idle', progress: 0, error: null };
  return findBlender(ctx, owner, { refresh: true });
}
