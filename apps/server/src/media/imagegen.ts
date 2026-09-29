/**
 * Image generation across providers. Every result goes through saveImage (magic-byte check,
 * re-encode, metadata strip) before it is stored, exactly like an upload.
 */
import { HttpError } from '../context.js';
import { openaiHeaders, type ResolvedConnection } from '../llm/providers.js';
import { readCapped, readJson, safeFetch } from '../util/fetch.js';

export interface ImageRequest {
  prompt: string;
  negative?: string;
  width?: number;
  height?: number;
  seed?: number;
  signal?: AbortSignal;
}

const MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_BASE: Record<string, string> = {
  'img-openai': 'https://api.openai.com/v1',
  'img-openrouter': 'https://openrouter.ai/api/v1',
  'img-pollinations': 'https://image.pollinations.ai',
  'img-comfyui': 'http://127.0.0.1:8188',
  'img-a1111': 'http://127.0.0.1:7860',
};

function base(conn: ResolvedConnection) {
  return (conn.baseUrl || DEFAULT_BASE[conn.provider] || '').replace(/\/+$/, '');
}

function size(conn: ResolvedConnection, req: ImageRequest): { w: number; h: number } {
  if (req.width && req.height) return { w: req.width, h: req.height };
  const m = /^(\d{2,4})\s*x\s*(\d{2,4})$/i.exec(String(conn.params.image_size ?? ''));
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 1024, h: 1024 };
}

function fromDataUrl(s: string): Buffer | null {
  const m = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(s);
  return m ? Buffer.from(m[1], 'base64') : null;
}

async function fetchImage(url: string, signal?: AbortSignal): Promise<Buffer> {
  const inline = fromDataUrl(url);
  if (inline) return inline;
  const res = await safeFetch(url, { timeoutMs: 120_000, signal });
  if (!res.ok) throw new HttpError(502, `Image download failed (${res.status})`, 'upstream');
  return readCapped(res, MAX_BYTES);
}

async function fail(res: Response, what: string): Promise<never> {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 300);
  } catch {
    /* ignore */
  }
  throw new HttpError(502, `${what} failed (${res.status})${detail ? `: ${detail}` : ''}`, 'upstream');
}

/** Returns raw image bytes (validated later by saveImage). */
export async function generateImage(conn: ResolvedConnection, req: ImageRequest): Promise<Buffer> {
  const b = base(conn);
  const { w, h } = size(conn, req);
  const negative = [req.negative, conn.params.negative_prompt].filter(Boolean).join(', ');
  const seed = req.seed ?? Math.floor(Math.random() * 2 ** 31);
  switch (conn.provider) {
    case 'img-openai': {
      const body: Record<string, unknown> = { model: conn.model || 'dall-e-3', prompt: req.prompt.slice(0, 4000), n: 1, size: `${w}x${h}`, ...(conn.params.extra_body ?? {}) };
      // gpt-image-* always returns base64 and rejects response_format.
      if (!/^gpt-image/.test(String(body.model))) body.response_format = 'b64_json';
      const res = await safeFetch(`${b}/images/generations`, { method: 'POST', headers: openaiHeaders(conn), body: JSON.stringify(body), timeoutMs: 180_000, signal: req.signal });
      if (!res.ok) await fail(res, 'Image generation');
      const j = await readJson(res, 60 * 1024 * 1024);
      const d = j.data?.[0];
      if (d?.b64_json) return Buffer.from(d.b64_json, 'base64');
      if (d?.url) return fetchImage(d.url, req.signal);
      throw new HttpError(502, 'The image service returned no image', 'upstream');
    }
    case 'img-openrouter': {
      const body = { model: conn.model, modalities: ['image', 'text'], messages: [{ role: 'user', content: req.prompt.slice(0, 4000) }], ...(conn.params.extra_body ?? {}) };
      const res = await safeFetch(`${b}/chat/completions`, { method: 'POST', headers: openaiHeaders(conn), body: JSON.stringify(body), timeoutMs: 180_000, signal: req.signal });
      if (!res.ok) await fail(res, 'Image generation');
      const j = await readJson(res, 60 * 1024 * 1024);
      const img = j.choices?.[0]?.message?.images?.[0];
      const url = img?.image_url?.url ?? img?.url;
      if (typeof url === 'string') return fetchImage(url, req.signal);
      throw new HttpError(502, 'This model did not return an image. Pick a model with image output.', 'upstream');
    }
    case 'img-pollinations': {
      const q = new URLSearchParams({ width: String(w), height: String(h), seed: String(seed), nologo: 'true', private: 'true' });
      if (conn.model) q.set('model', conn.model);
      if (negative) q.set('negative_prompt', negative);
      const res = await safeFetch(`${b}/prompt/${encodeURIComponent(req.prompt.slice(0, 1500))}?${q}`, { headers: conn.apiKey ? { authorization: `Bearer ${conn.apiKey}` } : {}, timeoutMs: 180_000, signal: req.signal });
      if (!res.ok) await fail(res, 'Image generation');
      return readCapped(res, MAX_BYTES);
    }
    case 'img-a1111': {
      const body = { prompt: req.prompt, negative_prompt: negative, width: w, height: h, steps: Number(conn.params.steps ?? 24), cfg_scale: Number(conn.params.cfg_scale ?? 6), seed, sampler_name: conn.params.sampler ?? undefined, ...(conn.params.extra_body ?? {}) };
      const headers: Record<string, string> = { 'content-type': 'application/json', ...(conn.params.headers ?? {}) };
      if (conn.apiKey) headers.authorization = `Basic ${Buffer.from(conn.apiKey).toString('base64')}`;
      const res = await safeFetch(`${b}/sdapi/v1/txt2img`, { method: 'POST', headers, body: JSON.stringify(body), timeoutMs: 300_000, signal: req.signal });
      if (!res.ok) await fail(res, 'Image generation');
      const j = await readJson(res, 60 * 1024 * 1024);
      if (!j.images?.[0]) throw new HttpError(502, 'The image service returned no image', 'upstream');
      return Buffer.from(String(j.images[0]).replace(/^data:[^,]+,/, ''), 'base64');
    }
    case 'img-comfyui':
      return comfy(conn, b, { ...req, negative }, w, h, seed);
    default:
      throw new HttpError(400, 'That connection is not an image connection');
  }
}

/** Minimal text-to-image workflow for ComfyUI when the user did not paste their own. */
function defaultWorkflow(checkpoint: string) {
  return {
    '3': { class_type: 'KSampler', inputs: { seed: '%seed%', steps: 24, cfg: 6, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: '%width%', height: '%height%', batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: '%prompt%', clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: '%negative_prompt%', clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'everloom', images: ['8', 0] } },
  };
}

/** Replace placeholders in string leaves; whole-string numeric placeholders become numbers. */
function fillPlaceholders(node: unknown, vars: Record<string, string | number>): unknown {
  if (typeof node === 'string') {
    const whole = /^%(\w+)%$/.exec(node);
    if (whole && whole[1] in vars) return vars[whole[1]];
    return node.replace(/%(\w+)%/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }
  if (Array.isArray(node)) return node.map((x) => fillPlaceholders(x, vars));
  if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fillPlaceholders(v, vars)]));
  return node;
}

async function comfy(conn: ResolvedConnection, b: string, req: ImageRequest, w: number, h: number, seed: number): Promise<Buffer> {
  let workflow: unknown = conn.params.workflow;
  if (typeof workflow === 'string' && workflow.trim()) {
    try {
      workflow = JSON.parse(workflow);
    } catch {
      throw new HttpError(400, 'The ComfyUI workflow is not valid JSON');
    }
  }
  if (!workflow || typeof workflow !== 'object') workflow = defaultWorkflow(conn.model || 'sd_xl_base_1.0.safetensors');
  const prompt = fillPlaceholders(workflow, { prompt: req.prompt, negative_prompt: req.negative ?? '', seed, width: w, height: h });
  const headers = { 'content-type': 'application/json', ...(conn.params.headers ?? {}) };
  const res = await safeFetch(`${b}/prompt`, { method: 'POST', headers, body: JSON.stringify({ prompt, client_id: 'everloom' }), timeoutMs: 30_000, signal: req.signal });
  if (!res.ok) await fail(res, 'ComfyUI');
  const { prompt_id } = await readJson(res);
  if (!prompt_id) throw new HttpError(502, 'ComfyUI did not accept the workflow', 'upstream');
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    if (req.signal?.aborted) throw new HttpError(499, 'Cancelled');
    await new Promise((r) => setTimeout(r, 1500));
    const hist = await readJson(await safeFetch(`${b}/history/${encodeURIComponent(prompt_id)}`, { headers, timeoutMs: 15_000 }), 10 * 1024 * 1024);
    const entry = hist?.[prompt_id];
    if (!entry) continue;
    if (entry.status?.status_str === 'error') throw new HttpError(502, 'ComfyUI reported an error running the workflow', 'upstream');
    for (const out of Object.values<any>(entry.outputs ?? {})) {
      const img = out.images?.[0];
      if (img?.filename) {
        const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? '', type: img.type ?? 'output' });
        const r = await safeFetch(`${b}/view?${q}`, { headers, timeoutMs: 60_000 });
        if (!r.ok) await fail(r, 'ComfyUI download');
        return readCapped(r, MAX_BYTES);
      }
    }
  }
  throw new HttpError(504, 'ComfyUI took too long');
}

export async function testImageConnection(conn: ResolvedConnection): Promise<{ ok: boolean; message: string }> {
  const b = base(conn);
  try {
    if (conn.provider === 'img-comfyui') {
      const r = await safeFetch(`${b}/system_stats`, { timeoutMs: 10_000 });
      return r.ok ? { ok: true, message: 'ComfyUI is reachable' } : { ok: false, message: `ComfyUI answered ${r.status}` };
    }
    if (conn.provider === 'img-a1111') {
      const r = await safeFetch(`${b}/sdapi/v1/sd-models`, { timeoutMs: 10_000, headers: conn.apiKey ? { authorization: `Basic ${Buffer.from(conn.apiKey).toString('base64')}` } : {} });
      return r.ok ? { ok: true, message: 'Web UI API is reachable' } : { ok: false, message: `Answered ${r.status} — start it with --api` };
    }
    if (conn.provider === 'img-pollinations') return { ok: true, message: 'No key needed. Generation happens on demand.' };
    const r = await safeFetch(`${b}/models`, { headers: openaiHeaders(conn), timeoutMs: 15_000 });
    return r.ok ? { ok: true, message: 'Key accepted' } : { ok: false, message: `Answered ${r.status}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
