import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adultAge, ageYears, RealisticSpecSchema } from '@everloom/engine';
import { extractZip, mpfbDir, setMpfbSources } from '../src/services/avatars/mpfb.js';
import { avatarSettled } from '../src/services/avatars/service.js';
import { createClient, waitFor, type TestClient } from './helpers.js';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** Serves files by name from memory or disk. */
let server: Server;
let base = '';
const served = new Map<string, string | Uint8Array>();
beforeAll(async () => {
  server = createServer((req, res) => {
    const f = served.get((req.url ?? '').slice(1));
    if (!f) return void res.writeHead(404).end();
    const body = typeof f === 'string' ? readFileSync(f) : Buffer.from(f);
    res.writeHead(200, { 'content-length': body.length }).end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

let c: TestClient | null = null;
afterEach(async () => {
  await c?.close();
  c = null;
});

describe('realistic spec', () => {
  it('fills defaults and keeps characters adult', () => {
    const s = RealisticSpecSchema.parse({});
    expect(s.macro.gender).toBe(0.5);
    expect(s.eyes).toBe('low-poly');
    expect(RealisticSpecSchema.safeParse({ hair: '../etc' }).success).toBe(false);
    expect(Math.round(ageYears(adultAge(0)))).toBe(18);
    expect(ageYears(0.5)).toBe(25);
  });
});

describe('MPFB install', () => {
  it('unzips as it streams and refuses paths outside the folder', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'everloom-zip-'));
    try {
      writeFileSync(path.join(tmp, 'ok.zip'), zipSync({ 'a/b.txt': strToU8('hello'), 'c.txt': strToU8('x'.repeat(100_000)) }));
      await extractZip(path.join(tmp, 'ok.zip'), path.join(tmp, 'out'));
      expect(readFileSync(path.join(tmp, 'out/a/b.txt'), 'utf8')).toBe('hello');
      expect(readFileSync(path.join(tmp, 'out/c.txt'), 'utf8').length).toBe(100_000);
      writeFileSync(path.join(tmp, 'bad.zip'), zipSync({ '../evil.txt': strToU8('no') }));
      await expect(extractZip(path.join(tmp, 'bad.zip'), path.join(tmp, 'out2'))).rejects.toThrow(/Unsafe path/);
      expect(existsSync(path.join(tmp, 'evil.txt'))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('installs into its own extensions folder only when the checksums match', async () => {
    const addon = zipSync({ 'blender_manifest.toml': strToU8('id = "mpfb"'), '__init__.py': strToU8('') });
    const assets = zipSync({ 'skins/test/test.mhmat': strToU8('name test') });
    served.set('addon.zip', addon);
    served.set('assets.zip', assets);
    c = await createClient();
    const status = async () => (await c!.req('GET', '/api/mpfb')).json.install;
    // A wrong checksum: nothing is installed.
    setMpfbSources({ addon: { url: `${base}/addon.zip`, sha256: '0'.repeat(64), max: 1 << 20 }, assets: { url: `${base}/assets.zip`, sha256: sha(assets), max: 1 << 20 } });
    expect((await c.req('POST', '/api/mpfb/install')).json.state).toBe('running');
    await waitFor(async () => (await status()).state !== 'running', 20_000);
    expect(await status()).toMatchObject({ state: 'failed', error: expect.stringMatching(/checksum/) });
    const dir = mpfbDir(c.built.ctx);
    expect(existsSync(path.join(dir, 'everloom-mpfb.json'))).toBe(false);

    setMpfbSources({ addon: { url: `${base}/addon.zip`, sha256: sha(addon), max: 1 << 20 }, assets: { url: `${base}/assets.zip`, sha256: sha(assets), max: 1 << 20 } });
    await c.req('POST', '/api/mpfb/install');
    await waitFor(async () => (await status()).state !== 'running', 20_000);
    expect(await status()).toMatchObject({ state: 'done' });
    expect(existsSync(path.join(dir, 'user_default/mpfb/blender_manifest.toml'))).toBe(true);
    expect(existsSync(path.join(dir, '.user/user_default/mpfb/data/skins/test/test.mhmat'))).toBe(true);
    expect((await c.req('GET', '/api/mpfb')).json.copy).toMatchObject({ installedAt: expect.any(Number) });
    expect((await c.req('DELETE', '/api/mpfb')).status).toBe(200);
    expect(existsSync(dir)).toBe(false);
  });

  it('explains what is missing instead of making a character', async () => {
    c = await createClient();
    const r = await c.req('POST', '/api/avatars/realistic', { name: 'Ada', spec: {} });
    expect(r.status).toBe(424);
    expect(r.json.error).toMatch(/Blender|MPFB/);
  }, 120_000);
});

// The real thing: EVERLOOM_BLENDER and EVERLOOM_MPFB_ZIPS="<mpfb.zip>,<assets.zip>" (both downloaded
// from the official sources; see docs/avatars.md).
const BLENDER = process.env.EVERLOOM_BLENDER;
const ZIPS = (process.env.EVERLOOM_MPFB_ZIPS ?? '').split(',').filter(Boolean);
describe.skipIf(!BLENDER || !existsSync(BLENDER) || ZIPS.length !== 2)('MPFB with Blender', () => {
  it('installs MPFB and makes a rigged, clothed realistic character', async () => {
    served.set('m.zip', ZIPS[0]!);
    served.set('a.zip', ZIPS[1]!);
    setMpfbSources({
      addon: { url: `${base}/m.zip`, sha256: sha(readFileSync(ZIPS[0]!)), max: 200 << 20 },
      assets: { url: `${base}/a.zip`, sha256: sha(readFileSync(ZIPS[1]!)), max: 600 << 20 },
    });
    c = await createClient();
    await c.req('POST', '/api/mpfb/install');
    await waitFor(async () => (await c!.req('GET', '/api/mpfb')).json.install.state !== 'running', 300_000);
    const st = (await c.req('GET', '/api/mpfb?refresh=1')).json;
    expect(st.install.state).toBe('done');
    expect(st.installed).toBe(true);
    expect(st.assets.skins).toContain('young_caucasian_female');
    const spec = { macro: { gender: 0.1, age: 0.5 }, skin: 'young_caucasian_female', eyebrows: 'eyebrow001', eyelashes: 'eyelashes01', hair: 'bob01', clothes: ['female_casualsuit01', 'shoes01'] };
    expect((await c.req('POST', '/api/avatars/realistic', { name: 'Ada', spec: { ...spec, hair: 'nope' } })).status).toBe(400);
    const r = await c.req('POST', '/api/avatars/realistic', { name: 'Ada', spec });
    expect(r.status).toBe(200);
    await avatarSettled(r.json.id);
    const d = (await c.req('GET', `/api/avatars/${r.json.id}`)).json;
    expect(d.error).toBeNull();
    expect(d).toMatchObject({ status: 'ready', kind: 'realistic' });
    expect(d.info.missingBones).toEqual([]);
    expect(d.config.realistic.hair).toBe('bob01');
    expect(d.config.realistic.macro.age).toBe(0.5);
  }, 600_000);
});
