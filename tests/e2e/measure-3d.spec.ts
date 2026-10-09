/**
 * Measuring runs for the custom-base work (not part of the regression suite: skipped unless
 * MEASURE_3D=1). With EVIDENCE=1 the numbers go to docs/3d-base-evidence/measurements.json and the
 * screenshots next to them.
 *
 *   - Fitting a 20,000-vertex garment on the CC0 morph base: the worker's time with the preview
 *     not rendering (it pauses when hidden), and the same input run through the same code in Node.
 *   - Frame rates (§6.9): one, two and three characters on the story stage, each wearing a fitted
 *     shirt, a skirt on chains, long hair on chains and shoes, dancing with physics on, at quality
 *     low, medium and high. phone-390-light adds a 4× CPU slowdown. Headless Chromium draws with
 *     SwiftShader (software WebGL), so the frame rate is the rasteriser's; the CPU time per frame
 *     (scene update, physics, skinning upload and draw submission) is what carries over.
 *   - Physics (§6.5): the skirt dancing (screenshots, and how often a skirt point ends up inside a
 *     leg), long hair from behind, and the chest springs on and off.
 *
 *   npm run build -w apps/web
 *   MEASURE_3D=1 EVIDENCE=1 npx playwright test tests/e2e/measure-3d.spec.ts --project desktop-1280-light --project phone-390-light
 */
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { api, expect, test } from './fixtures';
import { ev, F, fit, garment, open, phone, record, saveAvatar, settle, SWIFTSHADER, tubeObj, upload } from './avatar-helpers';
import { buildBodyBvh, transferToGarment, type BodyInput, type GarmentInput, type TransferOptions } from '../../apps/web/src/features/avatar3d/runtime/fit/core';

test.use(SWIFTSHADER);
test.beforeEach(({}, info) => {
  test.skip(!process.env.MEASURE_3D, 'measuring runs only with MEASURE_3D=1');
  test.skip(!/^(desktop-1280|phone-390)-light$/.test(info.project.name), 'measured on two projects');
});
test.describe.configure({ timeout: 1_800_000 });

const OUT = 'measurements.json';
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : 0; };
const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

/** Typed arrays survive page.evaluate as base64 with their type. */
type Packed = { $t: string; b64: string } | Packed[] | { [k: string]: Packed } | number | string | boolean | null;
function unpack(v: Packed): unknown {
  if (Array.isArray(v)) return v.map(unpack);
  if (v && typeof v === 'object') {
    if ('$t' in v && typeof v.$t === 'string') {
      const bytes = Buffer.from(v.b64 as string, 'base64');
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const C = { Float32Array, Uint32Array, Uint16Array, Int8Array, Uint8Array, Int32Array, Float64Array }[v.$t]!;
      return new C(buf);
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unpack(x as Packed)]));
  }
  return v;
}

test('fitting 20,000 vertices: the worker with nothing rendering, and the same input in Node', async ({ page, errors }) => {
  // Keep a copy of what the page sends the fitting worker, and time the worker's answer.
  await page.addInitScript(() => {
    const W = window.Worker;
    const log: Array<{ op: string; sent: number; done?: number }> = [];
    Object.assign(window, { __fitLog: log, __fitInput: null });
    window.Worker = class extends W {
      constructor(url: string | URL, opts?: WorkerOptions) {
        super(url, opts);
        this.addEventListener('message', (e: MessageEvent) => {
          const entry = log.find((l) => (l as unknown as { id: number }).id === e.data?.id && l.done === undefined);
          if (entry && e.data && e.data.progress === undefined) entry.done = performance.now();
        });
      }
      postMessage(msg: unknown, transfer?: unknown) {
        const m = msg as { id?: number; op?: string };
        if (m && m.op) {
          log.push({ op: m.op, sent: performance.now(), id: m.id } as never);
          if (m.op === 'transfer') (window as unknown as { __fitInput: unknown }).__fitInput = structuredClone(msg);
        }
        return super.postMessage(msg, transfer as Transferable[]);
      }
    } as typeof Worker;
  });
  const id = await upload(page, path.join(F, 'models/morph-base.glb'), 'Timing base');
  await open(page, id, 'Wardrobe');
  const tube = path.join(os.tmpdir(), `tube-top-20k-${Date.now()}.obj`);
  writeFileSync(tube, tubeObj(100, 200));
  // Rendering stops while the preview is out of sight (the stage pauses when its canvas is hidden).
  await page.getByTestId('avatar-preview').evaluate((el) => { (el as HTMLElement).style.display = 'none'; });
  const runs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const stats = await fit(page, [tube]);
    expect(stats.vertices).toBe(20_000);
    const t = await page.evaluate(() => (window as unknown as { __fitLog: Array<{ op: string; sent: number; done?: number }> }).__fitLog.filter((l) => l.op === 'transfer').at(-1)!);
    runs.push(t.done! - t.sent);
  }
  // The same body and garment, through the same code, in Node.
  const packed = await page.evaluate(() => {
    const pack = (v: unknown): unknown => {
      if (ArrayBuffer.isView(v)) {
        const u8 = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
        let s = '';
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        return { $t: v.constructor.name, b64: btoa(s) };
      }
      if (Array.isArray(v)) return v.map(pack);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, pack(x)]));
      return v;
    };
    return pack((window as unknown as { __fitInput: unknown }).__fitInput);
  });
  const input = unpack(packed as Packed) as { body: BodyInput; garments: GarmentInput[]; options: Partial<TransferOptions> };
  const node: number[] = [], bvhMs: number[] = [];
  for (let i = 0; i < 5; i++) {
    let t = performance.now();
    const bvh = buildBodyBvh(input.body);
    bvhMs.push(performance.now() - t);
    t = performance.now();
    const r = transferToGarment(input.body, input.garments, input.options, bvh);
    node.push(performance.now() - t);
    expect(r.meshes[0]!.positions.length / 3).toBe(20_000);
  }
  record('fitting 20k', {
    garmentVertices: 20_000,
    bodyVertices: input.body.positions.length / 3,
    bodyTriangles: input.body.indices.length / 3,
    bodyMorphs: input.body.morphs.length,
    workerMsNothingRendering: runs.map((x) => Math.round(x)),
    workerMsMedian: Math.round(median(runs)),
    nodeTransferMs: node.map((x) => Math.round(x)),
    nodeTransferMsMedian: Math.round(median(node)),
    nodeBvhMsMedian: round(median(bvhMs)),
    cpuThrottle: 1,
  }, OUT);
  expect(errors).toEqual([]);
});

/** A morph base wearing a fitted shirt, a skirt on chains, long hair on chains and shoes. */
async function dressedBase(page: Page) {
  const id = await upload(page, path.join(F, 'models/morph-base.glb'), 'Dressed base');
  await open(page, id, 'Wardrobe');
  await fit(page, garment('shirt'));
  await fit(page, garment('skirt'), { swing: 'Skirt or coat' });
  await fit(page, garment('long-hair'), { swing: 'Long hair' });
  await fit(page, garment('shoes'));
  await saveAvatar(page);
  const detail = await api(page, 'GET', `/api/avatars/${id}`);
  expect(detail.config.garments.length).toBe(4);
  return id;
}

/** N characters on the base, in a chat (solo for one, a group for more), on the stage. */
async function stageWith(page: Page, avatar: string, n: number, tag: string) {
  const names = ['Ines', 'Mara', 'Odile'].slice(0, n).map((x) => `${x} ${tag}`);
  const ids: string[] = [];
  for (const name of names) {
    const c = await api(page, 'POST', '/api/characters', { card: { name, first_mes: `${name.split(' ')[0]} smiles.` } });
    await api(page, 'PATCH', `/api/characters/${c.id}`, { game: { avatar3d: avatar, display: 'auto' } });
    ids.push(c.id);
  }
  const chat = n === 1
    ? await api(page, 'POST', '/api/chats', { characterId: ids[0] })
    : await api(page, 'POST', '/api/chats', { groupId: (await api(page, 'POST', '/api/groups', { name: `Stage ${tag}`, members: ids.map((characterId) => ({ characterId })) })).id });
  return { chat: chat.id as string, ids };
}

type Stats = { fps: number; frameMs: number; level: number; avatars: number; drawCalls: number; triangles: number; paused: boolean };
interface StageHandle { stats: Stats; onFrame: ((s: Stats) => void) | null; ids(): string[]; get(id: string): { emote(id: string, o?: { loop?: boolean }): Promise<boolean>; physics: { tails(): unknown[]; joints: unknown[] } } | undefined; setFraming(f: string): void }

/** Opens the chat on the stage at a quality, waits for every character to be dressed and still. */
async function openStage(page: Page, chat: string, n: number, quality: 'low' | 'medium' | 'high') {
  await page.evaluate((q) => { localStorage.setItem('everloom:3d', JSON.stringify({ quality: q, fpsCap: 60, physics: true, outlines: true })); localStorage.setItem('everloom:debug3d', '1'); }, quality);
  await page.goto(`/chat/${chat}`);
  // Stage mode is remembered per chat: switch only the first time.
  await expect(page.getByRole('button', { name: /^Switch to (stage|chat) mode$/ })).toBeVisible({ timeout: 30_000 });
  const toStage = page.getByRole('button', { name: 'Switch to stage view' });
  if (await toStage.isVisible()) await toStage.click();
  const stage = page.getByTestId('stage-3d');
  await expect(stage).toHaveAttribute('data-avatars', new RegExp(`^[^|]+${'\\|[^|]+'.repeat(n - 1)}$`), { timeout: 180_000 });
  // Garments load after the body: wait until the triangle count holds still.
  let last = -1;
  await expect.poll(async () => {
    const t = await page.evaluate(() => (window as unknown as { __everloomStage: StageHandle }).__everloomStage.stats.triangles);
    const same = t === last && t > 0;
    last = t;
    return same;
  }, { timeout: 180_000, intervals: [3000] }).toBe(true);
}

/** Every character dances; then frames are sampled for `ms`. */
async function sample(page: Page, ms: number) {
  return page.evaluate(async (ms) => {
    const s = (window as unknown as { __everloomStage: StageHandle }).__everloomStage;
    for (const id of s.ids()) await s.get(id)!.emote('dance', { loop: true });
    await new Promise((r) => setTimeout(r, 3000));
    const frames: Array<{ ms: number; at: number }> = [];
    const prev = s.onFrame;
    s.onFrame = (st) => { frames.push({ ms: st.frameMs, at: performance.now() }); prev?.(st); };
    await new Promise((r) => setTimeout(r, ms));
    s.onFrame = prev;
    const cpu = frames.map((f) => f.ms).sort((a, b) => a - b);
    const span = frames.length > 1 ? frames.at(-1)!.at - frames[0]!.at : ms;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      fps: Math.round(((frames.length - 1) / span) * 1000 * 10) / 10,
      cpuMsMean: Math.round((cpu.reduce((a, b) => a + b, 0) / Math.max(1, cpu.length)) * 10) / 10,
      cpuMsP95: cpu[Math.floor(cpu.length * 0.95)] ?? 0,
      frames: frames.length,
      drawCalls: s.stats.drawCalls,
      triangles: s.stats.triangles,
      level: s.stats.level,
      heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
    };
  }, ms);
}

test('frame rates: one, two and three dressed characters dancing with physics, per quality', async ({ page, errors }) => {
  const avatar = await dressedBase(page);
  const tag = test.info().project.name.replace(/-/g, ' ');
  const rows: Array<Record<string, unknown>> = [];
  const cdp = await page.context().newCDPSession(page);
  for (const n of [1, 2, 3]) {
    const { chat } = await stageWith(page, avatar, n, `${tag} ${n}`);
    for (const quality of ['low', 'medium', 'high'] as const) {
      await openStage(page, chat, n, quality);
      if (phone()) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const r = await sample(page, 8000);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      rows.push({ profile: phone() ? 'phone' : 'desktop', quality, characters: n, ...r });
      if (n === 3 && quality === 'high') await ev(page, '9-three-dancing');
    }
  }
  record('frame rates', rows, OUT);
  expect(errors).toEqual([]);
});

test('physics: the skirt dancing against the legs, long hair from behind, the chest on and off', async ({ page, errors }) => {
  test.skip(phone(), 'the same solver on both; screenshots on desktop');
  const avatar = await dressedBase(page);
  const { chat, ids } = await stageWith(page, avatar, 1, 'physics');
  await openStage(page, chat, 1, 'high');
  const stage = page.getByTestId('stage-3d');
  await page.evaluate((id) => {
    const s = (window as unknown as { __everloomStage: StageHandle }).__everloomStage;
    s.setFraming('full');
    void s.get(id)!.emote('dance', { loop: true });
  }, ids[0]!);
  await settle(page, 3000);
  // Skirt points against the leg capsules, every frame for 6 s of dancing.
  const legs = await page.evaluate(async (id) => {
    type V = { x: number; y: number; z: number; distanceTo(o: V): number; clone(): V };
    type C = { label: string; radius: number; on: boolean; tail: unknown; worldA: V; worldB: V };
    type J = { bone: { name: string }; curr: V; colliders: C[]; settings: { radius: number }; chain: number };
    const s = (window as unknown as { __everloomStage: StageHandle }).__everloomStage;
    const a = s.get(id)! as unknown as { physics: { joints: J[] } };
    const closest = (p: V, c: C) => {
      if (!c.tail) return c.worldA;
      const ax = c.worldB.x - c.worldA.x, ay = c.worldB.y - c.worldA.y, az = c.worldB.z - c.worldA.z;
      const len = ax * ax + ay * ay + az * az;
      const t = len ? Math.min(1, Math.max(0, ((p.x - c.worldA.x) * ax + (p.y - c.worldA.y) * ay + (p.z - c.worldA.z) * az) / len)) : 0;
      return { x: c.worldA.x + ax * t, y: c.worldA.y + ay * t, z: c.worldA.z + az * t };
    };
    // Skirt chains start near the hips (hair chains at the head): a chain's first joint decides.
    const hips = (a as unknown as { colliders(): C[] }).colliders().find((c) => c.label === 'hips')!.worldA.y;
    const first = new Map<number, J>();
    for (const j of a.physics.joints) if (!first.has(j.chain)) first.set(j.chain, j);
    const skirt = a.physics.joints.filter((j) => /^EvSwing/.test(j.bone.name) && first.get(j.chain)!.curr.y < hips + 0.2);
    let samples = 0, inside = 0, deepest = 0;
    const until = performance.now() + 6000;
    while (performance.now() < until) {
      await new Promise((r) => requestAnimationFrame(r));
      for (const j of skirt) for (const c of j.colliders) {
        if (!c.on || !/Leg/.test(c.label)) continue;
        const q = closest(j.curr, c);
        const d = Math.hypot(j.curr.x - q.x, j.curr.y - q.y, j.curr.z - q.z);
        samples++;
        // A point deeper than 5 mm inside a leg (the solver pushes to radius + the point's own radius).
        if (d < c.radius - 0.005) { inside++; deepest = Math.max(deepest, c.radius - d); }
      }
    }
    return { skirtJoints: skirt.length, samples, inside, deepestMm: Math.round(deepest * 1000) };
  }, ids[0]!);
  for (let i = 1; i <= 4; i++) { await ev(page, `5-skirt-dance-${i}`, stage); await page.waitForTimeout(350); }
  // Long hair against the shoulders and back: the camera goes behind her.
  await page.getByRole('button', { name: 'Look around' }).click();
  await page.evaluate(() => {
    const s = (window as unknown as { __everloomStage: { controls: { target: { set(x: number, y: number, z: number): void }; update(): void }; camera: { position: { set(x: number, y: number, z: number): void } } } }).__everloomStage;
    s.controls.target.set(0, 1.25, 0);
    s.camera.position.set(0.6, 1.45, -2.2);
    s.controls.update();
  });
  for (let i = 1; i <= 2; i++) { await page.waitForTimeout(500); await ev(page, `5-hair-back-${i}`, stage); }
  await page.getByRole('button', { name: 'Stop looking around' }).click();
  // The chest: how far the breast bones turn from their animated pose while bouncing, on and off.
  const chest = await page.evaluate(async (id) => {
    type Q = { angleTo(q: Q): number };
    type J = { bone: { name: string; quaternion: Q }; rest: Q; chain: number };
    const s = (window as unknown as { __everloomStage: StageHandle }).__everloomStage;
    const a = s.get(id)! as unknown as { physics: { joints: J[] }; chestChains: number[]; setChest(on: boolean, strength: number): void; emote(id: string, o?: { loop?: boolean }): Promise<boolean> };
    await a.emote('dance_bounce', { loop: true });
    const measure = async () => {
      let worst = 0;
      const until = performance.now() + 4000;
      while (performance.now() < until) {
        await new Promise((r) => requestAnimationFrame(r));
        for (const j of a.physics.joints) if (a.chestChains.includes(j.chain)) worst = Math.max(worst, j.bone.quaternion.angleTo(j.rest));
      }
      return Math.round((worst * 180) / Math.PI * 10) / 10;
    };
    a.setChest(true, 1);
    await new Promise((r) => setTimeout(r, 1500));
    const on = await measure();
    a.setChest(false, 1);
    await new Promise((r) => setTimeout(r, 1500));
    const off = await measure();
    return { chestBones: a.chestChains.length, maxTurnDegOn: on, maxTurnDegOff: off };
  }, ids[0]!);
  record('physics', { legs, chest }, OUT);
  expect(legs.skirtJoints).toBeGreaterThan(10);
  expect(chest.chestBones).toBe(2);
  expect(chest.maxTurnDegOn).toBeGreaterThan(chest.maxTurnDegOff);
  expect(errors).toEqual([]);
});
