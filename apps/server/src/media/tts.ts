/** Server-side speech: OpenAI-compatible /audio/speech (OpenAI, Kokoro, AllTalk…) and ElevenLabs. */
import { HttpError } from '../context.js';
import { openaiHeaders, type ResolvedConnection } from '../llm/providers.js';
import { readCapped, readJson, safeFetch } from '../util/fetch.js';

const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];

function base(conn: ResolvedConnection) {
  return (conn.baseUrl || (conn.provider === 'tts-elevenlabs' ? 'https://api.elevenlabs.io' : 'https://api.openai.com/v1')).replace(/\/+$/, '');
}

export async function synthesize(conn: ResolvedConnection, text: string, opts: { voice?: string; speed?: number; signal?: AbortSignal }): Promise<{ audio: Buffer; mime: string }> {
  const b = base(conn);
  const voice = opts.voice || conn.params.voice;
  if (conn.provider === 'tts-elevenlabs') {
    if (!voice) throw new HttpError(400, 'Pick an ElevenLabs voice first');
    const res = await safeFetch(`${b}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'xi-api-key': conn.apiKey, accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: conn.model || 'eleven_flash_v2_5', voice_settings: opts.speed ? { speed: Math.max(0.7, Math.min(1.2, opts.speed)) } : undefined }),
      timeoutMs: 90_000,
      signal: opts.signal,
    });
    if (!res.ok) throw new HttpError(502, `Speech failed (${res.status})`, 'upstream');
    return { audio: await readCapped(res, 15 * 1024 * 1024), mime: 'audio/mpeg' };
  }
  if (conn.provider !== 'tts-openai') throw new HttpError(400, 'That connection is not a voice connection');
  const body = { model: conn.model || 'tts-1', input: text, voice: voice || 'alloy', speed: opts.speed ?? conn.params.speed ?? 1, response_format: 'mp3', ...(conn.params.extra_body ?? {}) };
  const res = await safeFetch(`${b}/audio/speech`, { method: 'POST', headers: openaiHeaders(conn), body: JSON.stringify(body), timeoutMs: 90_000, signal: opts.signal });
  if (!res.ok) throw new HttpError(502, `Speech failed (${res.status})`, 'upstream');
  const mime = res.headers.get('content-type')?.split(';')[0] || 'audio/mpeg';
  if (!/^audio\//.test(mime)) throw new HttpError(502, 'The voice service did not return audio', 'upstream');
  return { audio: await readCapped(res, 15 * 1024 * 1024), mime };
}

export async function listVoices(conn: ResolvedConnection): Promise<Array<{ id: string; name: string }>> {
  if (conn.provider === 'tts-elevenlabs') {
    const j = await readJson(await safeFetch(`${base(conn)}/v1/voices`, { headers: { 'xi-api-key': conn.apiKey }, timeoutMs: 15_000 }));
    return (j.voices ?? []).map((v: any) => ({ id: String(v.voice_id), name: String(v.name) }));
  }
  // Kokoro and friends expose /audio/voices; fall back to the OpenAI list.
  try {
    const j = await readJson(await safeFetch(`${base(conn)}/audio/voices`, { headers: openaiHeaders(conn), timeoutMs: 8_000 }));
    const list: unknown[] = Array.isArray(j) ? j : j.voices ?? [];
    if (list.length) return list.map((v: any) => (typeof v === 'string' ? { id: v, name: v } : { id: String(v.id ?? v.name), name: String(v.name ?? v.id) }));
  } catch {
    /* not supported */
  }
  return OPENAI_VOICES.map((v) => ({ id: v, name: v[0].toUpperCase() + v.slice(1) }));
}
