import { EMOTIONS, formatClock, partOfDay, stripInlineTags } from '@everloom/engine';
import { readContentFile } from '../vault/vault.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { generateImage } from '../media/imagegen.js';
import { listVoices, synthesize, transcribe } from '../media/tts.js';
import { getState } from '../services/campaigns.js';
import { getCharacter, updateCharacter } from '../services/characters.js';
import { getChat, updateChat } from '../services/chats.js';
import { connectionForRole, resolveConnection } from '../services/connections.js';
import { deleteMedia, getMedia, mediaUrl, saveImage, saveMedia, sniffAvType } from '../services/media.js';
import { getSettings } from '../services/settings.js';
import { parse } from '../util/validate.js';

const KINDS = ['portrait', 'expression', 'background', 'item', 'photo', 'scene', 'npc'] as const;
type GenKind = (typeof KINDS)[number];

const genBody = z.object({
  kind: z.enum(KINDS),
  /** Free text; for most kinds it is combined with details from the subject. */
  prompt: z.string().max(3000).optional(),
  characterId: z.string().max(80).optional(),
  chatId: z.string().max(80).optional(),
  npcId: z.string().max(80).optional(),
  itemName: z.string().max(120).optional(),
  emotion: z.string().max(30).optional(),
  /** Save the result where it belongs (avatar, expression slot, chat background, NPC portrait). */
  apply: z.boolean().default(false),
});

const SHAPE: Record<GenKind, { w: number; h: number; maxDim: number; media: string }> = {
  portrait: { w: 832, h: 1216, maxDim: 1536, media: 'avatar' },
  expression: { w: 832, h: 1216, maxDim: 1536, media: 'expression' },
  npc: { w: 832, h: 1216, maxDim: 1536, media: 'portrait' },
  background: { w: 1344, h: 768, maxDim: 2560, media: 'background' },
  scene: { w: 1344, h: 768, maxDim: 2560, media: 'scene' },
  item: { w: 768, h: 768, maxDim: 1024, media: 'item' },
  photo: { w: 1024, h: 1024, maxDim: 2048, media: 'photo' },
};

function clip(s: string | undefined, n: number) {
  const t = stripInlineTags(String(s ?? '')).replace(/\{\{[^}]+\}\}/g, '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '')}…` : t;
}

/** Deterministic prompt from what we know about the subject — no extra model call needed. */
function buildPrompt(ctx: AppContext, ownerId: string, b: z.infer<typeof genBody>): { prompt: string; characterId: string | null } {
  const style = getSettings(ctx, ownerId).images.style;
  const parts: string[] = [];
  let characterId: string | null = null;
  if (b.characterId && (b.kind === 'portrait' || b.kind === 'expression')) {
    const c = getCharacter(ctx, ownerId, b.characterId);
    characterId = c.id;
    parts.push(`Character portrait of ${c.name}, upper body, facing the viewer, plain softly lit background`);
    const looks = c.card.extensions?.everloom && typeof (c.card.extensions.everloom as any).appearance === 'string' ? (c.card.extensions.everloom as any).appearance : '';
    parts.push(clip(looks || c.card.description, 500));
    if (b.kind === 'expression') parts.push(`${b.emotion ?? 'neutral'} facial expression, same character, same outfit, consistent design`);
  }
  if (b.kind === 'npc' && b.chatId && b.npcId) {
    const chat = getChat(ctx, ownerId, b.chatId);
    const s = chat.campaignId ? getState(ctx, ownerId, chat.campaignId) : null;
    const npc = s?.npcs[b.npcId];
    if (!npc) throw new HttpError(404, 'NPC not found');
    parts.push(`Portrait of ${npc.name}${npc.role && npc.role !== 'NPC' ? `, ${npc.role}` : ''}, upper body, plain background`);
    if (npc.age) parts.push(`${npc.age} years old`);
    parts.push(clip(npc.appearance, 400));
  }
  if ((b.kind === 'background' || b.kind === 'scene') && b.chatId) {
    const chat = getChat(ctx, ownerId, b.chatId);
    const s = chat.campaignId ? getState(ctx, ownerId, chat.campaignId) : null;
    if (s) {
      const loc = s.currentLocationId ? s.locations[s.currentLocationId] : null;
      parts.push(`${b.kind === 'background' ? 'Wide establishing background, no people' : 'Scene illustration'}: ${loc?.name ?? 'a quiet place'}${loc?.description ? ` — ${clip(loc.description, 300)}` : ''}`);
      parts.push(`${partOfDay(s.time.minutes)} (${formatClock(s.time.minutes, s.meta.calendar)}), ${s.weather.kind} weather, ${s.meta.style === 'scifi' ? 'science fiction setting' : s.meta.style === 'modern' ? 'present-day setting' : 'fantasy setting'}`);
    } else parts.push('Wide establishing background, no people');
  }
  if (b.kind === 'item') parts.push(`Game item icon: ${b.itemName ?? b.prompt ?? 'an object'}, single object centered, plain background, clean silhouette`);
  if (b.prompt && b.kind !== 'item') parts.push(clip(b.prompt, 1500));
  if (!parts.filter(Boolean).length) throw new HttpError(400, 'Describe what to draw');
  parts.push(style);
  return { prompt: parts.filter(Boolean).join('. '), characterId };
}

export function registerMedia(app: FastifyInstance, ctx: AppContext) {
  // ---------------- speech
  app.post('/api/tts', async (req, reply) => {
    const b = parse(z.object({ text: z.string().min(1).max(4000), voice: z.string().max(120).optional(), speed: z.number().min(0.25).max(4).optional(), connectionId: z.string().max(80).optional(), reference: z.string().max(80).optional() }), req.body);
    const conn = connectionForRole(ctx, owner(req), 'tts', b.connectionId);
    if (!conn) throw new HttpError(400, 'Choose a voice connection in Settings → Connections');
    const out = await synthesize(conn, b.text, { voice: b.voice, speed: b.speed, reference: b.reference ? referenceVoice(ctx, owner(req), b.reference) : undefined });
    reply.header('content-type', out.mime).header('cache-control', 'no-store');
    return reply.send(out.audio);
  });

  // ---------------- dictation through the voice connection (the browser's own speech recognition needs none)
  app.post('/api/stt', { bodyLimit: 25 * 1024 * 1024 }, async (req) => {
    const audio = req.body as Buffer;
    if (!Buffer.isBuffer(audio) || audio.length < 100) throw new HttpError(400, 'No recording arrived');
    const conn = connectionForRole(ctx, owner(req), 'tts');
    if (!conn) throw new HttpError(400, 'Choose a voice connection in Settings › Models & connections');
    const q = req.query as { lang?: string };
    return { text: await transcribe(conn, audio, String(req.headers['content-type'] ?? 'audio/webm'), { language: q.lang }) };
  });

  // ---------------- custom (reference) voices: kept apart from preset voices, each with a consent record
  app.get('/api/voices', async (req) => listReferenceVoices(ctx, owner(req)));
  app.post('/api/voices', { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    const b = parse(
      z.object({
        name: z.string().trim().min(1).max(60),
        data: z.string().min(100).max(20_000_000),
        consent: z.literal(true, { message: 'Confirm that this is your voice or that you have permission to use it' }),
      }),
      req.body,
    );
    const bytes = Buffer.from(b.data.replace(/^data:[^;,]+;base64,/, ''), 'base64');
    if (!sniffAvType(new Uint8Array(bytes.subarray(0, 16)))?.match(/^(mp3|wav|ogg|m4a|webm)$/)) throw new HttpError(415, 'Upload an audio sample (MP3, WAV, OGG or M4A)');
    const row = await saveMedia(ctx, owner(req), bytes, { kind: 'voice-ref', meta: { name: b.name, consent: { at: Date.now(), statement: CONSENT } } });
    return { id: row.id, name: b.name, consentAt: Date.now() };
  });
  app.delete('/api/voices/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    const { row } = getMedia(ctx, owner(req), id);
    if (row.kind !== 'voice-ref') throw new HttpError(404, 'Voice not found');
    deleteMedia(ctx, owner(req), id);
    return { ok: true };
  });

  app.get('/api/tts/voices', async (req) => {
    const q = req.query as { connectionId?: string };
    const conn = q.connectionId ? resolveConnection(ctx, owner(req), q.connectionId) : connectionForRole(ctx, owner(req), 'tts');
    if (!conn) return { voices: [] };
    return { voices: await listVoices(conn) };
  });

  // ---------------- images
  app.post('/api/images/generate', async (req) => {
    const o = owner(req);
    const b = parse(genBody, req.body);
    const conn = connectionForRole(ctx, o, 'image');
    if (!conn) throw new HttpError(400, 'Choose an image connection in Settings → Connections');
    const { prompt, characterId } = buildPrompt(ctx, o, b);
    const shape = SHAPE[b.kind];
    const raw = await generateImage(conn, { prompt, width: shape.w, height: shape.h });
    const row = await saveImage(ctx, o, raw, { kind: shape.media, characterId: characterId ?? b.characterId ?? null, maxDim: shape.maxDim, meta: { prompt: prompt.slice(0, 2000), generated: true, emotion: b.emotion } });
    let applied: string | null = null;
    if (b.apply) {
      if (b.kind === 'portrait' && b.characterId) {
        updateCharacter(ctx, o, b.characterId, { avatar: row.id });
        applied = 'avatar';
      } else if (b.kind === 'expression' && b.characterId) {
        const emo = (EMOTIONS as readonly string[]).includes(b.emotion ?? '') ? b.emotion! : 'neutral';
        const c = getCharacter(ctx, o, b.characterId);
        updateCharacter(ctx, o, b.characterId, { game: { expressions: { ...(c.game.expressions ?? {}), [emo]: row.id } } });
        applied = `expression:${emo}`;
      } else if (b.kind === 'background' && b.chatId) {
        const chat = getChat(ctx, o, b.chatId);
        const updated = updateChat(ctx, o, b.chatId, { metadata: { ...chat.metadata, background: row.id } });
        ctx.bus.publish(o, 'chat.updated', { chat: updated }, req.clientId);
        applied = 'background';
      }
    }
    return { id: row.id, url: mediaUrl(row.id), width: row.width, height: row.height, prompt, applied };
  });
}

const CONSENT = 'This is my own voice, or I have the speaker\'s permission to use it for this purpose.';

function listReferenceVoices(ctx: AppContext, owner: string) {
  return (ctx.db.prepare("SELECT id, meta, created_at FROM media WHERE owner_id = ? AND kind = 'voice-ref' ORDER BY created_at").all(owner) as Array<{ id: string; meta: string; created_at: number }>).map((r) => {
    const m = JSON.parse(r.meta || '{}') as { name?: string; consent?: { at: number } };
    return { id: r.id, name: m.name ?? 'Voice', consentAt: m.consent?.at ?? r.created_at, url: `/media/${r.id}` };
  });
}

function referenceVoice(ctx: AppContext, owner: string, id: string): { audio: Buffer; mime: string } {
  const { row, file } = getMedia(ctx, owner, id);
  if (row.kind !== 'voice-ref') throw new HttpError(404, 'Voice not found');
  if (!(JSON.parse(row.meta || '{}') as { consent?: unknown }).consent) throw new HttpError(403, 'This voice has no consent on record');
  return { audio: readContentFile(ctx.vault, file), mime: row.mime };
}
