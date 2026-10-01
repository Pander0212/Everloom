/**
 * Phase 3 communication: group texts, calls, letters and email, the social feed, the in-world
 * browser and custom phone apps. Every model call is optional, logged, and never changes the game
 * except through ops the reducer checks.
 */
import { formatClock, formatDate, hasEmail, PLAYER, type CampaignState, type Op } from '@everloom/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { appendOps, getState } from '../services/campaigns.js';
import { insertMemory, scopeOf } from '../services/mem.js';
import { utilityJson, utilityText } from '../services/utility.js';
import { parse } from '../util/validate.js';
import { briefState, chatForCampaign, insertPhone, lastMessageId, npcText, phoneDTO, recentStory, thread } from './social.js';

const chatBody = z.object({ chatId: z.string() });

function apply(ctx: AppContext, o: string, campaignId: string, chatId: string, ops: Op[], origin?: string) {
  return appendOps(ctx, o, campaignId, { chatId, messageId: lastMessageId(ctx, chatId), swipeId: null, source: 'user', ops, origin });
}

/** In-world pages are cached per campaign and query so the same search shows the same page. */
const pageCache = new Map<string, unknown>();
function remember(key: string, value: unknown) {
  pageCache.set(key, value);
  if (pageCache.size > 200) pageCache.delete(pageCache.keys().next().value!);
}

function worldBrief(s: CampaignState) {
  const facts = Object.values(s.databank)
    .filter((f) => f.status === 'active')
    .slice(-12)
    .map((f) => `- ${f.text}`)
    .join('\n');
  const people = Object.values(s.npcs)
    .filter((n) => n.status === 'alive')
    .slice(0, 20)
    .map((n) => `${n.name}${n.role && n.role !== 'NPC' ? ` (${n.role})` : ''}`)
    .join(', ');
  const places = Object.values(s.locations)
    .filter((l) => l.discovered)
    .slice(0, 20)
    .map((l) => l.name)
    .join(', ');
  return [`Setting: ${s.meta.style}, "${s.meta.title}". ${formatDate(s.time.minutes, s.meta.calendar)} ${formatClock(s.time.minutes, s.meta.calendar)}.`, people && `People: ${people}`, places && `Places: ${places}`, facts && `Known facts:\n${facts}`].filter(Boolean).join('\n');
}

export function registerComms(app: FastifyInstance, ctx: AppContext) {
  // ---------------------------------------------------------------- group texts
  app.get('/api/campaigns/:id/phone-groups/:gid', async (req) => {
    const o = owner(req);
    const { id: campaignId, gid } = req.params as { id: string; gid: string };
    const s = getState(ctx, o, campaignId);
    if (!s.phone.groups?.[gid]) throw new HttpError(404, 'Group not found');
    return { messages: thread(ctx, o, campaignId, `group:${gid}`).map(phoneDTO) };
  });

  /** Send to a group. Whoever you name answers; otherwise members take turns. */
  app.post('/api/campaigns/:id/phone-groups/:gid', async (req) => {
    const o = owner(req);
    const { id: campaignId, gid } = req.params as { id: string; gid: string };
    const b = parse(z.object({ chatId: z.string(), text: z.string().trim().min(1).max(1000) }), req.body);
    chatForCampaign(ctx, o, campaignId, b.chatId);
    const s = getState(ctx, o, campaignId);
    const g = s.phone.groups?.[gid];
    if (!g) throw new HttpError(404, 'Group not found');
    const key = `group:${gid}`;
    const sent = insertPhone(ctx, o, campaignId, key, true, b.text, s.time.minutes);
    const alive = g.members.filter((id) => s.npcs[id]?.status === 'alive');
    let reply = null;
    let error: string | null = null;
    if (alive.length) {
      const lower = b.text.toLowerCase();
      const named = alive.find((id) => lower.includes(s.npcs[id]!.name.split(' ')[0]!.toLowerCase()));
      const count = (ctx.db.prepare('SELECT COUNT(*) AS n FROM phone_messages WHERE campaign_id = ? AND npc_id = ?').get(campaignId, key) as { n: number }).n;
      const who = named ?? alive[count % alive.length]!;
      try {
        const text = await npcText(ctx, o, s, who, thread(ctx, o, campaignId, key), null, 'group', g.name);
        reply = phoneDTO(insertPhone(ctx, o, campaignId, key, false, text, s.time.minutes, { speakerId: who }));
      } catch (e) {
        error = (e as Error).message;
      }
    }
    return { sent: phoneDTO(sent), reply, error };
  });

  // ---------------------------------------------------------------- calls
  app.post('/api/campaigns/:id/phone/:npcId/call', async (req) => {
    const o = owner(req);
    const { id: campaignId, npcId } = req.params as { id: string; npcId: string };
    const b = parse(z.object({ chatId: z.string(), text: z.string().trim().max(1000).default('') }), req.body);
    chatForCampaign(ctx, o, campaignId, b.chatId);
    const s = getState(ctx, o, campaignId);
    const npc = s.npcs[npcId];
    if (!npc) throw new HttpError(404, 'Contact not found');
    if (npc.status !== 'alive') return { answered: false, reason: 'No answer.' };
    const said = b.text ? phoneDTO(insertPhone(ctx, o, campaignId, npcId, true, b.text, s.time.minutes, { kind: 'call' })) : null;
    const history = thread(ctx, o, campaignId, npcId).filter((m) => m.kind === 'call');
    const text = await npcText(ctx, o, s, npcId, history, b.text ? null : 'they are calling you', 'call');
    return { answered: true, said, reply: phoneDTO(insertPhone(ctx, o, campaignId, npcId, false, text, s.time.minutes, { kind: 'call' })) };
  });

  /** Hang up: the call took game time (about two minutes per exchange). */
  app.post('/api/campaigns/:id/phone/:npcId/call/end', async (req) => {
    const o = owner(req);
    const { id: campaignId, npcId } = req.params as { id: string; npcId: string };
    const b = parse(z.object({ chatId: z.string(), exchanges: z.number().int().min(0).max(200) }), req.body);
    const chat = chatForCampaign(ctx, o, campaignId, b.chatId);
    const s = getState(ctx, o, campaignId);
    const npc = s.npcs[npcId];
    if (!npc) throw new HttpError(404, 'Contact not found');
    const minutes = Math.max(1, b.exchanges * 2);
    // What was said since the last hang-up, for the memory below.
    const rows = thread(ctx, o, campaignId, npcId, 200);
    const start = rows.map((m) => m.kind).lastIndexOf('call-end') + 1;
    const said = rows.slice(start).filter((m) => m.kind === 'call');
    insertPhone(ctx, o, campaignId, npcId, true, `Call · ${minutes} min`, s.time.minutes, { kind: 'call-end' });
    const r = apply(ctx, o, campaignId, b.chatId, [{ type: 'time.advance', minutes } as Op], req.clientId);
    // The call goes into memory like a scene: both of them heard it, nobody else did.
    if (said.length) {
      const quote = (who: string, t: string) => `${who}: "${t.length > 140 ? `${t.slice(0, 137)}…` : t}"`;
      const lastNpc = [...said].reverse().find((m) => !m.from_player);
      const lastMine = [...said].reverse().find((m) => m.from_player);
      const text = [`${s.player.name} and ${npc.name} talked on the phone for ${minutes} minutes.`, lastMine && quote(s.player.name, lastMine.text), lastNpc && quote(npc.name, lastNpc.text)].filter(Boolean).join(' ');
      insertMemory(ctx, o, scopeOf(chat), { chatId: chat.id, messageId: lastMessageId(ctx, chat.id), swipeId: null }, 'user', {
        text,
        participants: [npc.name],
        witnesses: [PLAYER, npc.id],
        locationId: s.currentLocationId ?? null,
        gameTime: s.time.minutes,
        importance: 2,
        secret: false,
      });
      ctx.bus.publish(o, 'memory.changed', { chatId: chat.id, campaignId }, req.clientId);
    }
    return { state: r.state, minutes };
  });

  // ---------------------------------------------------------------- letters and email
  /** Open a letter: one still waiting for its words is written now, in the sender's voice. */
  app.post('/api/campaigns/:id/mail/:mailId/open', async (req) => {
    const o = owner(req);
    const { id: campaignId, mailId } = req.params as { id: string; mailId: string };
    const b = parse(chatBody, req.body);
    chatForCampaign(ctx, o, campaignId, b.chatId);
    const s = getState(ctx, o, campaignId);
    const m = s.mail[mailId];
    if (!m) throw new HttpError(404, 'Letter not found');
    if (m.deliverAt > s.time.minutes) throw new HttpError(400, "It hasn't arrived yet");
    const ops: Op[] = [];
    let error: string | null = null;
    if (m.pending && m.direction === 'in') {
      const npc = m.npcId ? s.npcs[m.npcId] : null;
      const original = Object.values(s.mail).find((x) => x.direction === 'out' && x.npcId === m.npcId && m.subject === `Re: ${x.subject}`);
      try {
        const body = await utilityText(
          ctx,
          o,
          [
            `You are ${m.from}${npc?.role && npc.role !== 'NPC' ? `, ${npc.role}` : ''}, writing ${m.kind === 'email' ? 'an email' : 'a letter'} to ${s.player.name}.`,
            npc?.personality && `Personality: ${npc.personality}`,
            worldBrief(s),
            `Write the ${m.kind} body only, 60–180 words, in your own voice, fitting the setting. No subject line.`,
          ]
            .filter(Boolean)
            .join('\n'),
          original ? `You are replying to this ${m.kind} from ${s.player.name} ("${original.subject}"):\n${original.body}` : `Subject: ${m.subject}\nWrite about what's happening in your life and anything ${s.player.name} should know.\n\nRecent story:\n${recentStory(ctx, b.chatId, 6, 3000)}`,
          { maxTokens: 500, temperature: 0.85, role: 'main', purpose: m.kind === 'email' ? 'email' : 'letter', chatId: b.chatId },
        );
        ops.push({ type: 'mail.write', id: mailId, body: body.slice(0, 8000) || '…' } as Op);
      } catch (e) {
        error = (e as Error).message;
      }
    }
    if (!error && !m.read) ops.push({ type: 'mail.read', id: mailId } as Op);
    const state = ops.length ? apply(ctx, o, campaignId, b.chatId, ops, req.clientId).state : s;
    return { state, error };
  });

  // ---------------------------------------------------------------- feed
  /** A few new posts from people the player knows, grounded in the recent story. */
  app.post('/api/campaigns/:id/feed/refresh', async (req) => {
    const o = owner(req);
    const campaignId = (req.params as { id: string }).id;
    const b = parse(chatBody, req.body);
    chatForCampaign(ctx, o, campaignId, b.chatId);
    const s = getState(ctx, o, campaignId);
    const people = Object.values(s.npcs).filter((n) => n.status === 'alive');
    if (!people.length) return { state: s, added: 0 };
    const board = s.meta.style === 'fantasy' ? 'the town notice board (short public notices, rumours and announcements)' : 'a social feed (short public posts)';
    const out = await utilityJson<{ posts?: Array<{ author?: string; text?: string }> }>(
      ctx,
      o,
      `Write 1–3 new posts for ${board} in this world, each by one of the listed people, in their own voice. Keep each under 40 words. Reply with JSON only: {"posts":[{"author":"exact name from the list","text":"..."}]}`,
      `${worldBrief(s)}\n\nAuthors to choose from: ${people.map((p) => p.name).join(', ')}\n\nRecent posts:\n${s.feed.slice(-5).map((p) => `${p.author}: ${p.text}`).join('\n') || 'none'}\n\nRecent story:\n${recentStory(ctx, b.chatId, 6, 3000)}`,
      600,
      'feed posts',
    );
    const names = new Set(people.map((p) => p.name));
    const ops = (out.posts ?? [])
      .filter((p) => p.author && names.has(p.author) && p.text?.trim())
      .slice(0, 3)
      .map((p) => ({ type: 'feed.post', author: p.author, text: p.text!.trim().slice(0, 1000) }) as Op);
    const state = ops.length ? apply(ctx, o, campaignId, b.chatId, ops, req.clientId).state : s;
    return { state, added: ops.length };
  });

  // ---------------------------------------------------------------- browser / archive
  app.post('/api/campaigns/:id/browser', async (req) => {
    const o = owner(req);
    const campaignId = (req.params as { id: string }).id;
    const b = parse(z.object({ chatId: z.string(), query: z.string().trim().min(1).max(200) }), req.body);
    chatForCampaign(ctx, o, campaignId, b.chatId);
    const s = getState(ctx, o, campaignId);
    const key = `${o}:${campaignId}:${b.query.toLowerCase()}`;
    if (pageCache.has(key)) return pageCache.get(key);
    const archive = !hasEmail(s);
    const out = await utilityJson<{ title?: string; source?: string; sections?: Array<{ heading?: string; text?: string }> }>(
      ctx,
      o,
      `${archive ? 'You are the archive of this world: an entry from books, ledgers and records.' : 'You are the in-world internet: one web page from inside this world.'} Stay consistent with the known facts and never contradict them; invent only harmless everyday detail. Never reveal secrets characters are keeping. Reply with JSON only: {"title":"page title","source":"${archive ? 'which book or record' : 'site name'}","sections":[{"heading":"...","text":"2–4 sentences"}]} with 2–4 sections.`,
      `${worldBrief(s)}\n\n${archive ? 'Look up' : 'Search'}: ${b.query}`,
      900,
      archive ? 'archive lookup' : 'in-world browser',
    );
    const page = {
      title: String(out.title ?? b.query).slice(0, 160),
      source: String(out.source ?? '').slice(0, 120),
      sections: (out.sections ?? []).slice(0, 5).map((x) => ({ heading: String(x.heading ?? '').slice(0, 120), text: String(x.text ?? '').slice(0, 1200) })),
    };
    remember(key, page);
    return page;
  });

  // ---------------------------------------------------------------- custom apps
  app.post('/api/campaigns/:id/apps/:appId/run', async (req) => {
    const o = owner(req);
    const { id: campaignId, appId } = req.params as { id: string; appId: string };
    const b = parse(z.object({ chatId: z.string(), input: z.string().trim().max(500).default('') }), req.body);
    chatForCampaign(ctx, o, campaignId, b.chatId);
    const s = getState(ctx, o, campaignId);
    const a = s.phone.apps?.[appId];
    if (!a) throw new HttpError(404, 'App not found');
    const text = await utilityText(
      ctx,
      o,
      `You are "${a.name}", an app on ${s.player.name}'s ${hasEmail(s) ? 'phone' : 'codex'} inside this story world. ${a.prompt}\nAnswer in plain text, under 150 words, grounded in the game state. Never change the story or state; only show information.`,
      `${briefState(s)}\n${worldBrief(s)}${b.input ? `\n\nThe player asks: ${b.input}` : ''}`,
      { maxTokens: 400, purpose: `app: ${a.name}`, chatId: b.chatId },
    );
    return { text: text.slice(0, 3000) };
  });
}
