import { EMOTIONS, formatClock, partOfDay, stripInlineTags } from '@everloom/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { generateImage } from '../media/imagegen.js';
import { listVoices, synthesize } from '../media/tts.js';
import { getState } from '../services/campaigns.js';
import { getCharacter, updateCharacter } from '../services/characters.js';
import { getChat, updateChat } from '../services/chats.js';
import { connectionForRole, resolveConnection } from '../services/connections.js';
import { mediaUrl, saveImage } from '../services/media.js';
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
    const b = parse(z.object({ text: z.string().min(1).max(4000), voice: z.string().max(120).optional(), speed: z.number().min(0.25).max(4).optional(), connectionId: z.string().max(80).optional() }), req.body);
    const conn = connectionForRole(ctx, owner(req), 'tts', b.connectionId);
    if (!conn) throw new HttpError(400, 'Choose a voice connection in Settings → Connections');
    const out = await synthesize(conn, b.text, { voice: b.voice, speed: b.speed });
    reply.header('content-type', out.mime).header('cache-control', 'no-store');
    return reply.send(out.audio);
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
