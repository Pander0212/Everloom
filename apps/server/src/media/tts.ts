/** Server-side speech: OpenAI-compatible /audio/speech (OpenAI, Kokoro, AllTalk…) and ElevenLabs. */
import { HttpError } from '../context.js';
import { openaiHeaders, type ResolvedConnection } from '../llm/providers.js';
import { readCapped, readJson, safeFetch } from '../util/fetch.js';

const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];

function base(conn: ResolvedConnection) {
  return (conn.baseUrl || (conn.provider === 'tts-elevenlabs' ? 'https://api.elevenlabs.io' : 'https://api.openai.com/v1')).replace(/\/+$/, '');
}

/**
 * `reference` is a custom voice sample (with the owner's consent on file). It is sent only to
 * OpenAI-compatible servers the owner marked as accepting reference audio (XTTS, F5 and similar);
 * everywhere else a preset voice is used.
 */
export async function synthesize(conn: ResolvedConnection, text: string, opts: { voice?: string; speed?: number; signal?: AbortSignal; reference?: { audio: Buffer; mime: string } }): Promise<{ audio: Buffer; mime: string }> {
  const b = base(conn);
  const voice = opts.voice || conn.params.voice;
  if (conn.provider === 'tts-elevenlabs') {
    if (!voice) throw new HttpError(400, 'Pick an ElevenLabs voice first');
    const res = await safeFetch(`${b}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, { shield: 'tts',
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
  if (opts.reference && conn.params.referenceAudio !== true) throw new HttpError(400, "This voice connection doesn't take reference voices. Turn on “Accepts reference audio” for it in Settings → Connections, or pick a preset voice.");
  const body = {
    model: conn.model || 'tts-1',
    input: text,
    voice: voice || 'alloy',
    speed: opts.speed ?? conn.params.speed ?? 1,
    response_format: 'mp3',
    ...(opts.reference ? { reference_audio: opts.reference.audio.toString('base64'), reference_audio_format: opts.reference.mime.split('/')[1] } : {}),
    ...(conn.params.extra_body ?? {}),
  };
  const res = await safeFetch(`${b}/audio/speech`, { shield: 'tts', method: 'POST', headers: openaiHeaders(conn), body: JSON.stringify(body), timeoutMs: 90_000, signal: opts.signal });
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

/**
 * Dictation through the voice connection: OpenAI-compatible /audio/transcriptions (OpenAI, and
 * local Whisper servers that follow it). Audio goes out as-is; the text comes back to the box.
 */
export async function transcribe(conn: ResolvedConnection, audio: Buffer, mime: string, opts: { language?: string; signal?: AbortSignal } = {}): Promise<string> {
  if (conn.provider !== 'tts-openai') throw new HttpError(400, 'Dictation through a voice service needs an OpenAI-compatible voice connection');
  const form = new FormData();
  const ext = /webm/.test(mime) ? 'webm' : /ogg/.test(mime) ? 'ogg' : /mp4|m4a|aac/.test(mime) ? 'm4a' : /wav/.test(mime) ? 'wav' : 'webm';
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `speech.${ext}`);
  form.append('model', String((conn.params as Record<string, unknown>).sttModel || 'whisper-1'));
  if (opts.language) form.append('language', opts.language.slice(0, 2));
  const { 'content-type': _json, ...headers } = openaiHeaders(conn);
  const res = await safeFetch(`${base(conn)}/audio/transcriptions`, { method: 'POST', headers, body: form, timeoutMs: 120_000, signal: opts.signal });
  const j = (await readJson(res)) as { text?: string };
  return String(j.text ?? '').trim();
}
