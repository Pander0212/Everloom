/**
 * LLM provider adapters. All calls go through the server; API keys never reach the browser.
 * Supported: generic OpenAI-compatible, Anthropic, Google Gemini, text-completion (llama.cpp / KoboldCpp / OpenAI /completions).
 */
import { findInstructTemplate, renderInstructPrompt, type AssembledPrompt } from '@everloom/engine';
import { HttpError } from '../context.js';
import { readJson, safeFetch, sseEvents } from '../util/fetch.js';
import { shieldStream } from '../privacy/shield.js';

export type LlmProvider = 'openai' | 'anthropic' | 'gemini' | 'textgen';

export interface ConnectionParams {
  /** Image connections: text put before and after every prompt (a model's prompt style). */
  prompt_prefix?: string;
  prompt_suffix?: string;
  /** Image connections: an editing model (takes a picture and changes it). */
  edit?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repetition_penalty?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  max_tokens?: number;
  context_size?: number;
  stop?: string[];
  stream?: boolean;
  reasoning?: boolean;
  /** Voice connections: the server accepts a reference sample (voice cloning). */
  referenceAudio?: boolean;
  reasoning_effort?: 'low' | 'medium' | 'high';
  reasoning_budget?: number;
  text_backend?: 'llamacpp' | 'koboldcpp' | 'openai';
  instruct_template?: string;
  headers?: Record<string, string>;
  extra_body?: Record<string, unknown>;
  /** TTS / image specific */
  voice?: string;
  speed?: number;
  image_model?: string;
  image_size?: string;
  workflow?: unknown;
  steps?: number;
  cfg_scale?: number;
  sampler?: string;
  negative_prompt?: string;
  embeddings_model?: string;
}

export interface ResolvedConnection {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  params: ConnectionParams;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  name?: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** For text-completion backends: the assembled prompt (to render with an instruct template). */
  assembled?: AssembledPrompt;
  names?: { char: string; user: string; impersonate?: boolean; continueText?: string };
  prefill?: string;
  overrides?: Partial<ConnectionParams>;
  jsonMode?: boolean;
  signal?: AbortSignal;
}

export interface StreamChunk {
  text?: string;
  reasoning?: string;
  finishReason?: string;
}

export const DEFAULT_BASE: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
  textgen: 'http://127.0.0.1:8080',
};

function base(conn: ResolvedConnection): string {
  return (conn.baseUrl || DEFAULT_BASE[conn.provider] || '').replace(/\/+$/, '');
}

function p(conn: ResolvedConnection, req: ChatRequest): ConnectionParams {
  return { ...conn.params, ...(req.overrides ?? {}) };
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// ---------------------------------------------------------------- OpenAI-compatible

export function openaiHeaders(conn: ResolvedConnection): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json', ...(conn.params.headers ?? {}) };
  if (conn.apiKey) h.authorization = `Bearer ${conn.apiKey}`;
  if (/openrouter\.ai/.test(conn.baseUrl)) {
    h['HTTP-Referer'] = 'https://github.com/everloom';
    h['X-Title'] = 'Everloom';
  }
  return h;
}

async function* openaiStream(conn: ResolvedConnection, req: ChatRequest): AsyncGenerator<StreamChunk> {
  const params = p(conn, req);
  const messages = req.messages.map((m) => ({ role: m.role, content: m.content }));
  if (req.prefill) messages.push({ role: 'assistant', content: req.prefill });
  const body: Record<string, unknown> = {
    model: conn.model,
    messages,
    stream: params.stream !== false,
    temperature: num(params.temperature),
    top_p: num(params.top_p),
    max_tokens: num(params.max_tokens),
    frequency_penalty: num(params.frequency_penalty) || undefined,
    presence_penalty: num(params.presence_penalty) || undefined,
    stop: params.stop?.length ? params.stop.slice(0, 4) : undefined,
    ...(num(params.top_k) ? { top_k: params.top_k } : {}),
    ...(num(params.min_p) ? { min_p: params.min_p } : {}),
    ...(num(params.repetition_penalty) && params.repetition_penalty !== 1 ? { repetition_penalty: params.repetition_penalty } : {}),
    ...(params.reasoning ? { reasoning_effort: params.reasoning_effort ?? 'medium', include_reasoning: true } : {}),
    ...(req.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    ...(params.extra_body ?? {}),
  };
  const res = await safeFetch(`${base(conn)}/chat/completions`, {
    method: 'POST',
    headers: openaiHeaders(conn),
    body: JSON.stringify(body),
    signal: req.signal,
    timeoutMs: 180_000,
  });
  if (!res.ok || body.stream === false) {
    const json = await readJson(res);
    const choice = json.choices?.[0];
    const msg = choice?.message ?? {};
    yield { text: msg.content ?? '', reasoning: msg.reasoning_content ?? msg.reasoning ?? undefined, finishReason: choice?.finish_reason };
    return;
  }
  for await (const ev of sseEvents(res)) {
    if (ev.data === '[DONE]') break;
    let json: any;
    try {
      json = JSON.parse(ev.data);
    } catch {
      continue;
    }
    if (json.error) throw new HttpError(502, `Upstream: ${json.error.message ?? JSON.stringify(json.error)}`, 'upstream');
    const choice = json.choices?.[0];
    const delta = choice?.delta ?? {};
    const reasoning = delta.reasoning_content ?? delta.reasoning ?? undefined;
    if (delta.content || reasoning) yield { text: delta.content ?? undefined, reasoning: typeof reasoning === 'string' ? reasoning : undefined };
    if (choice?.finish_reason) yield { finishReason: choice.finish_reason };
  }
}

// ---------------------------------------------------------------- Anthropic

function toAnthropic(messages: ChatMessage[]): { system: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> } {
  const system: string[] = [];
  let i = 0;
  while (i < messages.length && messages[i].role === 'system') system.push(messages[i++].content);
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (; i < messages.length; i++) {
    const m = messages[i];
    const role: 'user' | 'assistant' = m.role === 'assistant' ? 'assistant' : 'user';
    const content = m.role === 'system' ? `[${m.content}]` : m.content;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n\n${content}`;
    else out.push({ role, content });
  }
  if (!out.length || out[0].role !== 'user') out.unshift({ role: 'user', content: '[Start]' });
  return { system: system.join('\n\n'), messages: out };
}

async function* anthropicStream(conn: ResolvedConnection, req: ChatRequest): AsyncGenerator<StreamChunk> {
  const params = p(conn, req);
  const conv = toAnthropic(req.messages);
  if (req.prefill) conv.messages.push({ role: 'assistant', content: req.prefill });
  const thinking = params.reasoning && !req.prefill;
  const maxTokens = num(params.max_tokens) ?? 1024;
  const budget = Math.max(1024, num(params.reasoning_budget) ?? 2048);
  const body: Record<string, unknown> = {
    model: conn.model,
    system: conv.system || undefined,
    messages: conv.messages,
    max_tokens: thinking ? maxTokens + budget : maxTokens,
    stream: true,
    ...(thinking ? { thinking: { type: 'enabled', budget_tokens: budget } } : { temperature: num(params.temperature), top_p: num(params.top_p), top_k: num(params.top_k) }),
    stop_sequences: params.stop?.length ? params.stop : undefined,
    ...(params.extra_body ?? {}),
  };
  const res = await safeFetch(`${base(conn)}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': conn.apiKey, 'anthropic-version': '2023-06-01', ...(conn.params.headers ?? {}) },
    body: JSON.stringify(body),
    signal: req.signal,
    timeoutMs: 180_000,
  });
  if (!res.ok) {
    await readJson(res);
    return;
  }
  for await (const ev of sseEvents(res)) {
    let json: any;
    try {
      json = JSON.parse(ev.data);
    } catch {
      continue;
    }
    if (json.type === 'content_block_delta') {
      if (json.delta?.type === 'text_delta') yield { text: json.delta.text };
      else if (json.delta?.type === 'thinking_delta') yield { reasoning: json.delta.thinking };
    } else if (json.type === 'message_delta' && json.delta?.stop_reason) {
      yield { finishReason: json.delta.stop_reason };
    } else if (json.type === 'error') {
      throw new HttpError(502, `Anthropic: ${json.error?.message ?? 'error'}`, 'upstream');
    }
  }
}

// ---------------------------------------------------------------- Gemini

async function* geminiStream(conn: ResolvedConnection, req: ChatRequest): AsyncGenerator<StreamChunk> {
  const params = p(conn, req);
  const conv = toAnthropic(req.messages);
  const contents = conv.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  if (req.prefill) contents.push({ role: 'model', parts: [{ text: req.prefill }] });
  const body: Record<string, unknown> = {
    contents,
    ...(conv.system ? { systemInstruction: { parts: [{ text: conv.system }] } } : {}),
    generationConfig: {
      temperature: num(params.temperature),
      topP: num(params.top_p),
      topK: num(params.top_k) || undefined,
      maxOutputTokens: num(params.max_tokens),
      stopSequences: params.stop?.length ? params.stop.slice(0, 5) : undefined,
      ...(req.jsonMode ? { responseMimeType: 'application/json' } : {}),
      ...(params.reasoning ? { thinkingConfig: { includeThoughts: true, thinkingBudget: num(params.reasoning_budget) ?? -1 } } : {}),
    },
    safetySettings: ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map((category) => ({ category, threshold: 'BLOCK_NONE' })),
    ...(params.extra_body ?? {}),
  };
  const model = conn.model.replace(/^models\//, '');
  const res = await safeFetch(`${base(conn)}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': conn.apiKey, ...(conn.params.headers ?? {}) },
    body: JSON.stringify(body),
    signal: req.signal,
    timeoutMs: 180_000,
  });
  if (!res.ok) {
    await readJson(res);
    return;
  }
  for await (const ev of sseEvents(res)) {
    let json: any;
    try {
      json = JSON.parse(ev.data);
    } catch {
      continue;
    }
    const cand = json.candidates?.[0];
    for (const part of cand?.content?.parts ?? []) {
      if (part.thought) yield { reasoning: part.text };
      else if (part.text) yield { text: part.text };
    }
    if (cand?.finishReason && cand.finishReason !== 'STOP') yield { finishReason: cand.finishReason };
    if (json.promptFeedback?.blockReason) throw new HttpError(502, `Gemini blocked the prompt: ${json.promptFeedback.blockReason}`, 'upstream');
  }
}

// ---------------------------------------------------------------- Text completion

async function* textgenStream(conn: ResolvedConnection, req: ChatRequest): AsyncGenerator<StreamChunk> {
  const params = p(conn, req);
  const template = findInstructTemplate(params.instruct_template);
  let prompt: string;
  let stop: string[];
  if (req.assembled) {
    const r = renderInstructPrompt({ ...req.assembled, prefill: req.prefill ?? req.assembled.prefill }, template, {
      charName: req.names?.char ?? 'Assistant',
      userName: req.names?.user ?? 'User',
      impersonate: req.names?.impersonate,
      continueText: req.names?.continueText,
    });
    prompt = r.prompt;
    stop = [...r.stop, ...(params.stop ?? [])];
  } else {
    prompt = req.messages.map((m) => (m.role === 'system' ? template.systemPrefix + m.content + template.systemSuffix : m.role === 'user' ? template.userPrefix + m.content + template.userSuffix : template.assistantPrefix + m.content + template.assistantSuffix)).join('') + template.assistantPrefix + (req.prefill ?? '');
    stop = [...template.stop, ...(params.stop ?? [])];
  }
  const backend = params.text_backend ?? 'llamacpp';
  const b = base(conn);
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(conn.params.headers ?? {}) };
  if (conn.apiKey) headers.authorization = `Bearer ${conn.apiKey}`;
  if (backend === 'koboldcpp') {
    const res = await safeFetch(`${b}/api/extra/generate/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt,
        max_length: num(params.max_tokens) ?? 300,
        max_context_length: num(params.context_size) ?? 8192,
        temperature: num(params.temperature),
        top_p: num(params.top_p),
        top_k: num(params.top_k),
        min_p: num(params.min_p),
        rep_pen: num(params.repetition_penalty),
        stop_sequence: stop,
        ...(params.extra_body ?? {}),
      }),
      signal: req.signal,
      timeoutMs: 300_000,
    });
    if (!res.ok) await readJson(res);
    for await (const ev of sseEvents(res)) {
      try {
        const j = JSON.parse(ev.data);
        if (j.token) yield { text: j.token };
      } catch {
        /* ignore */
      }
    }
    return;
  }
  if (backend === 'openai') {
    const res = await safeFetch(`${b}/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: conn.model, prompt, stream: true, max_tokens: num(params.max_tokens), temperature: num(params.temperature), top_p: num(params.top_p), stop: stop.slice(0, 4), ...(params.extra_body ?? {}) }),
      signal: req.signal,
      timeoutMs: 300_000,
    });
    if (!res.ok) await readJson(res);
    for await (const ev of sseEvents(res)) {
      if (ev.data === '[DONE]') break;
      try {
        const j = JSON.parse(ev.data);
        const t = j.choices?.[0]?.text;
        if (t) yield { text: t };
      } catch {
        /* ignore */
      }
    }
    return;
  }
  // llama.cpp server
  const res = await safeFetch(`${b}/completion`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt,
      stream: true,
      n_predict: num(params.max_tokens) ?? 300,
      temperature: num(params.temperature),
      top_p: num(params.top_p),
      top_k: num(params.top_k),
      min_p: num(params.min_p),
      repeat_penalty: num(params.repetition_penalty),
      stop,
      cache_prompt: true,
      ...(params.extra_body ?? {}),
    }),
    signal: req.signal,
    timeoutMs: 300_000,
  });
  if (!res.ok) await readJson(res);
  for await (const ev of sseEvents(res)) {
    try {
      const j = JSON.parse(ev.data);
      if (j.content) yield { text: j.content };
      if (j.stop) break;
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------- Public API

export function streamChat(conn: ResolvedConnection, req: ChatRequest): AsyncGenerator<StreamChunk> {
  // Real names go out as stand-ins (safeFetch) and come back restored here, before anyone sees them.
  return shieldStream(dispatchStream(conn, req));
}

function dispatchStream(conn: ResolvedConnection, req: ChatRequest): AsyncGenerator<StreamChunk> {
  switch (conn.provider) {
    case 'openai':
      return openaiStream(conn, req);
    case 'anthropic':
      return anthropicStream(conn, req);
    case 'gemini':
      return geminiStream(conn, req);
    case 'textgen':
      return textgenStream(conn, req);
    default:
      throw new HttpError(400, `Provider "${conn.provider}" cannot generate text`);
  }
}

/** Non-streaming convenience: collect the whole reply. */
export async function completeChat(conn: ResolvedConnection, req: ChatRequest): Promise<{ text: string; reasoning: string }> {
  let text = '';
  let reasoning = '';
  for await (const c of streamChat(conn, req)) {
    if (c.text) text += c.text;
    if (c.reasoning) reasoning += c.reasoning;
  }
  return { text, reasoning };
}

export async function listModels(conn: ResolvedConnection): Promise<string[]> {
  const b = base(conn);
  if (conn.provider === 'anthropic') {
    const res = await safeFetch(`${b}/v1/models?limit=100`, { headers: { 'x-api-key': conn.apiKey, 'anthropic-version': '2023-06-01' }, timeoutMs: 20_000 });
    const j = await readJson(res);
    return (j.data ?? []).map((m: any) => m.id);
  }
  if (conn.provider === 'gemini') {
    const res = await safeFetch(`${b}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': conn.apiKey }, timeoutMs: 20_000 });
    const j = await readJson(res);
    return (j.models ?? [])
      .filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m: any) => String(m.name).replace(/^models\//, ''));
  }
  if (conn.provider === 'textgen') {
    const backend = conn.params.text_backend ?? 'llamacpp';
    if (backend === 'koboldcpp') {
      const j = await readJson(await safeFetch(`${b}/api/v1/model`, { timeoutMs: 15_000 }));
      return [String(j.result ?? 'koboldcpp')];
    }
    try {
      const j = await readJson(await safeFetch(`${b}/v1/models`, { headers: conn.apiKey ? { authorization: `Bearer ${conn.apiKey}` } : {}, timeoutMs: 15_000 }));
      return (j.data ?? []).map((m: any) => m.id);
    } catch {
      const j = await readJson(await safeFetch(`${b}/props`, { timeoutMs: 15_000 }));
      return [String(j.default_generation_settings?.model ?? j.model_path ?? 'local model')];
    }
  }
  const res = await safeFetch(`${b}/models`, { headers: openaiHeaders(conn), timeoutMs: 20_000 });
  const j = await readJson(res, 30 * 1024 * 1024);
  const list: any[] = Array.isArray(j) ? j : j.data ?? j.models ?? [];
  return list.map((m) => (typeof m === 'string' ? m : m.id ?? m.name)).filter(Boolean).sort();
}

export async function testConnection(conn: ResolvedConnection): Promise<{ ok: boolean; message: string; sample?: string }> {
  try {
    const started = Date.now();
    const r = await completeChat(conn, {
      messages: [
        { role: 'system', content: 'You are a connection test. Reply with the single word: ready' },
        { role: 'user', content: 'Say ready.' },
      ],
      overrides: { max_tokens: 16, stream: true, reasoning: false },
    });
    return { ok: true, message: `Replied in ${Date.now() - started} ms`, sample: r.text.slice(0, 80) };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function embed(conn: ResolvedConnection, texts: string[]): Promise<number[][]> {
  const b = base(conn);
  if (conn.provider === 'gemini') {
    const model = conn.params.embeddings_model || 'text-embedding-004';
    const res = await safeFetch(`${b}/v1beta/models/${model}:batchEmbedContents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': conn.apiKey },
      body: JSON.stringify({ requests: texts.map((t) => ({ model: `models/${model}`, content: { parts: [{ text: t }] } })) }),
      timeoutMs: 60_000,
    });
    const j = await readJson(res);
    return (j.embeddings ?? []).map((e: any) => e.values as number[]);
  }
  if (conn.provider !== 'openai' && conn.provider !== 'textgen') throw new HttpError(400, 'This connection has no embeddings endpoint');
  const res = await safeFetch(`${b}${conn.provider === 'textgen' ? '/v1' : ''}/embeddings`, {
    method: 'POST',
    headers: openaiHeaders(conn),
    body: JSON.stringify({ model: conn.params.embeddings_model || conn.model || 'text-embedding-3-small', input: texts }),
    timeoutMs: 60_000,
  });
  const j = await readJson(res, 50 * 1024 * 1024);
  return (j.data ?? []).sort((a: any, b2: any) => a.index - b2.index).map((d: any) => d.embedding as number[]);
}
