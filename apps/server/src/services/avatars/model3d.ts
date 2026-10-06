/**
 * Image-to-3D and text-to-3D through a connection the owner configures (role "3D models"). Rigid
 * props (hats, weapons, bags, jewelry) come out well; garments are experimental and go through the
 * Blender fitting job afterwards. Jobs run in the background with progress; the result is cleaned
 * up (optimized like any model) and kept as a model file until the owner accepts or discards it.
 *
 * Providers (checked against their public API docs, October 2026):
 * - Meshy (api.meshy.ai): POST /openapi/v1/image-to-3d {image_url} and POST /openapi/v2/text-to-3d
 *   {mode: preview, prompt} then {mode: refine, preview_task_id}; poll GET …/:id until SUCCEEDED;
 *   the GLB is at model_urls.glb. Auth: Bearer key.
 * - fal.ai queue (queue.fal.run): POST /<app> with the input; poll the status_url until COMPLETED;
 *   read the response_url. Apps: fal-ai/hunyuan3d/v2 (input_image_url) and fal-ai/trellis
 *   (image_url); the GLB is at model_mesh.url. Auth: "Key <key>". Image only: for text, a picture
 *   is drawn first with the owner's image connection.
 * Tripo's API docs could not be read when this was written, so it isn't offered.
 */
import { randomUUID } from 'node:crypto';
import { HttpError, type AppContext } from '../../context.js';
import { generateImage } from '../../media/imagegen.js';
import { safeFetch } from '../../util/fetch.js';
import { connectionForRole } from '../connections.js';
import type { ResolvedConnection } from '../../llm/providers.js';
import { deleteMedia, saveModelFile } from '../media.js';
import { isGlb } from './glb.js';
import { inspectModel } from './inspect.js';
import { optimizeOffThread } from './service.js';

export interface Model3dJob {
  id: string;
  owner: string;
  kind: 'prop' | 'garment';
  prompt: string;
  state: 'running' | 'done' | 'failed';
  progress: number;
  stage: string;
  error: string | null;
  model: string | null;
  triangles: number | null;
  createdAt: number;
}

const jobs = new Map<string, Model3dJob>();
const MAX_GLB = 60 * 1024 * 1024;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function getModel3dJob(owner: string, id: string): Model3dJob {
  const j = jobs.get(id);
  if (!j || j.owner !== owner) throw new HttpError(404, 'Job not found');
  return j;
}

async function download(url: string): Promise<Buffer> {
  const r = await safeFetch(url, { timeoutMs: 120_000, shield: false });
  if (!r.ok) throw new HttpError(502, `Downloading the model failed (${r.status})`, 'upstream');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_GLB) throw new HttpError(413, 'The model is too large', 'upstream');
  if (!isGlb(buf)) throw new HttpError(502, 'The service did not return a GLB file', 'upstream');
  return buf;
}

async function json(r: Response, what: string) {
  if (!r.ok) {
    let detail = '';
    try {
      detail = JSON.stringify(await r.json()).slice(0, 200);
    } catch {
      /* none */
    }
    throw new HttpError(r.status === 401 || r.status === 403 ? 401 : 502, `${what} failed (${r.status})${detail ? `: ${detail}` : ''}`, 'upstream');
  }
  return (await r.json()) as Record<string, any>;
}

/** Meshy: one task (image) or two (text: preview geometry, then refine textures). */
async function meshy(conn: ResolvedConnection, input: { prompt: string; image?: Buffer }, onProgress: (p: number, stage: string) => void, deadline: number): Promise<Buffer> {
  const base = (conn.baseUrl || 'https://api.meshy.ai').replace(/\/$/, '');
  const headers = { authorization: `Bearer ${conn.apiKey}`, 'content-type': 'application/json' };
  const poll = async (path: string, from: number, to: number, stage: string) => {
    while (Date.now() < deadline) {
      const t = await json(await safeFetch(`${base}${path}`, { headers, timeoutMs: 30_000, shield: false }), 'Checking the 3D task');
      onProgress(from + ((to - from) * Number(t.progress ?? 0)) / 100, stage);
      if (t.status === 'SUCCEEDED') return t;
      if (t.status === 'FAILED' || t.status === 'CANCELED') throw new HttpError(502, `The 3D service could not make it: ${t.task_error?.message ?? t.status}`, 'upstream');
      await sleep(4000);
    }
    throw new HttpError(504, 'The 3D service took too long', 'upstream');
  };
  if (input.image) {
    const created = await json(await safeFetch(`${base}/openapi/v1/image-to-3d`, { method: 'POST', headers, body: JSON.stringify({ image_url: `data:image/png;base64,${input.image.toString('base64')}`, should_texture: true, should_remesh: true, target_polycount: 20000, target_formats: ['glb'] }), timeoutMs: 60_000, shield: 'image' }), 'Starting the 3D task');
    const t = await poll(`/openapi/v1/image-to-3d/${created.result}`, 5, 95, 'Shaping');
    return download(t.model_urls?.glb);
  }
  const preview = await json(await safeFetch(`${base}/openapi/v2/text-to-3d`, { method: 'POST', headers, body: JSON.stringify({ mode: 'preview', prompt: input.prompt.slice(0, 600), should_remesh: true, target_polycount: 20000, target_formats: ['glb'] }), timeoutMs: 60_000, shield: 'image' }), 'Starting the 3D task');
  await poll(`/openapi/v2/text-to-3d/${preview.result}`, 5, 50, 'Shaping');
  const refine = await json(await safeFetch(`${base}/openapi/v2/text-to-3d`, { method: 'POST', headers, body: JSON.stringify({ mode: 'refine', preview_task_id: preview.result, enable_pbr: false, target_formats: ['glb'] }), timeoutMs: 60_000, shield: false }), 'Starting the texturing');
  const t = await poll(`/openapi/v2/text-to-3d/${refine.result}`, 50, 95, 'Painting');
  return download(t.model_urls?.glb);
}

/** fal.ai's queue: Hunyuan3D v2 or TRELLIS (the connection's model is the app id). */
async function fal(conn: ResolvedConnection, input: { image: Buffer }, onProgress: (p: number, stage: string) => void, deadline: number): Promise<Buffer> {
  const app = (conn.model || 'fal-ai/hunyuan3d/v2').replace(/^\/+|\/+$/g, '');
  if (!/^[\w-]+\/[\w./-]+$/.test(app)) throw new HttpError(400, 'The model must be a fal app id like fal-ai/hunyuan3d/v2');
  const base = (conn.baseUrl || 'https://queue.fal.run').replace(/\/$/, '');
  const headers = { authorization: `Key ${conn.apiKey}`, 'content-type': 'application/json' };
  const dataUrl = `data:image/png;base64,${input.image.toString('base64')}`;
  const body = /trellis/.test(app) ? { image_url: dataUrl } : { input_image_url: dataUrl, textured_mesh: true };
  const sub = await json(await safeFetch(`${base}/${app}`, { method: 'POST', headers, body: JSON.stringify(body), timeoutMs: 60_000, shield: 'image' }), 'Starting the 3D task');
  // Only follow URLs on the same service.
  const same = (u: unknown) => typeof u === 'string' && new URL(u).host === new URL(base).host;
  const statusUrl = same(sub.status_url) ? sub.status_url : `${base}/${app}/requests/${sub.request_id}/status`;
  const responseUrl = same(sub.response_url) ? sub.response_url : `${base}/${app}/requests/${sub.request_id}`;
  let p = 5;
  while (Date.now() < deadline) {
    const s = await json(await safeFetch(statusUrl, { headers, timeoutMs: 30_000, shield: false }), 'Checking the 3D task');
    if (s.status === 'COMPLETED') break;
    p = Math.min(90, p + 4);
    onProgress(p, s.status === 'IN_QUEUE' ? 'Waiting in line' : 'Shaping');
    await sleep(3000);
  }
  if (Date.now() >= deadline) throw new HttpError(504, 'The 3D service took too long', 'upstream');
  const res = await json(await safeFetch(responseUrl, { headers, timeoutMs: 60_000, shield: false }), 'Fetching the result');
  const url = res.model_mesh?.url ?? res.data?.model_mesh?.url;
  if (!url) throw new HttpError(502, 'The 3D service returned no model', 'upstream');
  return download(url);
}

/** Starts a job: a prop (or an experimental garment) from a description or a picture. */
export function startModel3dJob(ctx: AppContext, owner: string, input: { prompt: string; image?: Buffer; kind: 'prop' | 'garment' }): Model3dJob {
  const conn = connectionForRole(ctx, owner, 'model3d');
  if (!conn) throw new HttpError(400, 'Add a 3D model connection first (Settings › Connections › 3D models)', 'no_connection');
  const job: Model3dJob = { id: randomUUID(), owner, kind: input.kind, prompt: input.prompt.slice(0, 600), state: 'running', progress: 0, stage: 'Starting', error: null, model: null, triangles: null, createdAt: Date.now() };
  jobs.set(job.id, job);
  // Old jobs are forgotten after a day.
  for (const [id, j] of jobs) if (Date.now() - j.createdAt > 86_400_000) jobs.delete(id);
  const deadline = Date.now() + 15 * 60_000;
  const onProgress = (p: number, stage: string) => {
    job.progress = Math.round(p);
    job.stage = stage;
  };
  void (async () => {
    try {
      const style = input.kind === 'garment' ? 'a single piece of clothing on its own, laid out flat-on as if worn, no body, no mannequin' : 'a single object on its own, no person, no hands';
      const prompt = `${input.prompt}. ${style}. Stylised game asset, clean shapes, simple colours.`;
      let image = input.image;
      let glb: Buffer;
      if (conn.provider === '3d-meshy') glb = await meshy(conn, { prompt, image }, onProgress, deadline);
      else {
        if (!image) {
          // Image-only services: draw the object first with the owner's image connection.
          const img = connectionForRole(ctx, owner, 'image');
          if (!img) throw new HttpError(400, 'This 3D service works from a picture: add an image connection, or give it a picture', 'no_connection');
          onProgress(2, 'Drawing a reference');
          image = await generateImage(img, { prompt: `${prompt} Centered, plain white background, soft even light, three-quarter view.`, width: 1024, height: 1024 });
        }
        glb = await fal(conn, { image }, onProgress, deadline);
      }
      onProgress(96, 'Cleaning up');
      const info = await inspectModel(glb);
      const r = await optimizeOffThread(glb, { format: 'glb', maxTexture: 1024 });
      const saved = saveModelFile(ctx, owner, r.main, { kind: 'model', ext: 'glb', meta: { generated: input.kind, prompt: job.prompt } });
      job.model = saved.id;
      job.triangles = info.triangles;
      job.state = 'done';
      job.progress = 100;
      job.stage = 'Ready';
    } catch (e) {
      job.state = 'failed';
      job.error = (e as Error).message.slice(0, 300);
    }
  })();
  return job;
}

export async function testModel3dConnection(conn: ResolvedConnection): Promise<{ ok: boolean; message: string }> {
  try {
    if (conn.provider === '3d-meshy') {
      const base = (conn.baseUrl || 'https://api.meshy.ai').replace(/\/$/, '');
      const r = await safeFetch(`${base}/openapi/v1/image-to-3d?page_size=1`, { headers: { authorization: `Bearer ${conn.apiKey}` }, timeoutMs: 20_000, shield: false });
      return r.ok ? { ok: true, message: 'Connected to Meshy.' } : { ok: false, message: `Meshy said ${r.status}${r.status === 401 ? ' (check the key)' : ''}.` };
    }
    const base = (conn.baseUrl || 'https://queue.fal.run').replace(/\/$/, '');
    const r = await safeFetch(`${base}/${conn.model || 'fal-ai/hunyuan3d/v2'}/requests/00000000-0000-0000-0000-000000000000/status`, { headers: { authorization: `Key ${conn.apiKey}` }, timeoutMs: 20_000, shield: false });
    if (r.status === 401 || r.status === 403) return { ok: false, message: 'fal.ai refused the key.' };
    return { ok: true, message: 'fal.ai accepted the key.' };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export function discardModel3dJob(ctx: AppContext, owner: string, id: string) {
  const j = getModel3dJob(owner, id);
  if (j.model) deleteMedia(ctx, owner, j.model);
  jobs.delete(id);
  return { ok: true };
}
