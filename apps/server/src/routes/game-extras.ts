import { buildNewGameState, freeSpot, generateMapScene, locationPath, type NewGameConfig, type Op } from '@everloom/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { appendOps, getState, setBaseState } from '../services/campaigns.js';
import { getChat } from '../services/chats.js';
import { generate } from '../services/generate.js';
import { utilityJson } from '../services/utility.js';
import { parse } from '../util/validate.js';
import { registerMedia } from './media-gen.js';
import { registerSocial } from './social.js';

export function registerGameExtras(app: FastifyInstance, ctx: AppContext) {
  /** Ask the utility model for new places inside the given location (unexplored until visited). */
  app.post('/api/campaigns/:id/map/expand', async (req) => {
    const { id } = req.params as { id: string };
    const b = parse(z.object({ chatId: z.string(), parentId: z.string().nullable(), count: z.number().int().min(1).max(8).default(4) }), req.body);
    const state = getState(ctx, owner(req), id);
    const parent = b.parentId ? state.locations[b.parentId] : null;
    if (b.parentId && !parent) throw new HttpError(404, 'Location not found');
    const scene = generateMapScene(state, b.parentId);
    const path = locationPath(state, b.parentId).map((l) => l.name).join(' › ') || 'the world';
    const existing = scene.nodes.map((n) => n.name);
    const data = await utilityJson<{ nodes?: Array<{ name: string; kind?: string; description?: string }> }>(
      ctx,
      owner(req),
      'You are a map designer for a roleplay game. Invent places that fit the setting. Reply with JSON only: {"nodes":[{"name":"...","kind":"city|town|village|district|building|room|wilds|road|station|dock|landmark|shop|service|danger|interior|home","description":"one sentence"}]}',
      `Setting style: ${state.meta.style}. Campaign: ${state.meta.title}.\nInside: ${path}${parent?.description ? ` — ${parent.description}` : ''}.\nLevel of detail: ${scene.level}.\nAlready on the map: ${existing.join(', ') || 'nothing yet'}.\nInvent ${b.count} new, distinct places.`,
      1200,
      'map expand',
    );
    const kinds = new Set(['city', 'town', 'village', 'district', 'building', 'room', 'wilds', 'road', 'station', 'dock', 'landmark', 'shop', 'service', 'danger', 'interior', 'home']);
    const ops: Op[] = [];
    const taken: Array<{ x: number; y: number }> = [];
    for (const n of (data.nodes ?? []).slice(0, b.count)) {
      if (!n?.name || existing.includes(n.name)) continue;
      const pos = freeSpot(state, b.parentId, n.name, taken);
      taken.push(pos);
      ops.push({
        type: 'location.upsert',
        name: String(n.name).slice(0, 80),
        parent: parent?.id ?? null,
        level: scene.level,
        kind: kinds.has(String(n.kind)) ? n.kind : 'other',
        description: String(n.description ?? '').slice(0, 500),
        discovered: false,
        x: pos.x,
        y: pos.y,
      } as Op);
    }
    if (!ops.length) return { added: 0 };
    const last = ctx.db.prepare('SELECT id FROM messages WHERE chat_id = ? ORDER BY seq DESC LIMIT 1').get(b.chatId) as { id: string } | undefined;
    const r = appendOps(ctx, owner(req), id, { chatId: b.chatId, messageId: last?.id ?? null, swipeId: null, source: 'helper', ops, origin: req.clientId });
    return { added: r.applied.length, state: r.state };
  });

  /** Fill empty parts of a New Game config with the utility model. */
  app.post('/api/newgame/fill', async (req) => {
    const b = parse(z.object({ config: z.any(), premise: z.string().max(4000).optional() }), req.body);
    const cfg = b.config as NewGameConfig;
    const filled = await utilityJson<Partial<NewGameConfig> & { opening?: string }>(
      ctx,
      owner(req),
      'You are a game designer setting up a roleplay campaign. Fill in only what is missing, keeping everything the player already chose. Reply with JSON only, using the same shape as the input config.',
      `Premise: ${b.premise || cfg.title}\nStyle: ${cfg.style}\nCurrent config:\n${JSON.stringify({ ...cfg, trackers: undefined }, null, 1).slice(0, 6000)}\n\nReturn JSON with any of: title, character {name,className,age}, appearance, currency {name,symbol,amount}, groups [{name,type,standing}], items [{name,qty,category}], skills [{name,kind,cost,costType,power,desc}], quests [{title,desc,objectives}], npcs [{name,role,personality,appearance}], location {world,region,local,description,kind}, facts [string]. Keep lists short (2–4 entries).`,
      1800,
      'new game fill',
    );
    const pick = <K extends keyof NewGameConfig>(k: K, fallback: NewGameConfig[K]): NewGameConfig[K] => {
      const cur = cfg[k];
      const empty = Array.isArray(cur) ? cur.length === 0 : typeof cur === 'string' ? !cur.trim() : false;
      return empty && filled[k] !== undefined ? (filled[k] as NewGameConfig[K]) : fallback;
    };
    const out: NewGameConfig = {
      ...cfg,
      title: pick('title', cfg.title),
      appearance: pick('appearance', cfg.appearance),
      groups: pick('groups', cfg.groups),
      items: pick('items', cfg.items),
      skills: pick('skills', cfg.skills),
      quests: pick('quests', cfg.quests),
      npcs: pick('npcs', cfg.npcs),
      facts: pick('facts', cfg.facts),
      character: {
        ...cfg.character,
        name: cfg.character.name || String((filled.character as any)?.name ?? ''),
        className: cfg.character.className || String((filled.character as any)?.className ?? ''),
      },
      location: {
        world: cfg.location.world || String(filled.location?.world ?? ''),
        region: cfg.location.region || String(filled.location?.region ?? ''),
        local: cfg.location.local || String(filled.location?.local ?? (filled.location as any)?.name ?? ''),
        description: cfg.location.description || String(filled.location?.description ?? ''),
        kind: cfg.location.kind || filled.location?.kind,
      },
    };
    if (!(cfg.currency.name && cfg.currency.name !== 'Gold') && filled.currency?.name) out.currency = { ...cfg.currency, ...filled.currency };
    // Normalize model output shapes.
    out.items = (out.items ?? []).map((i: any) => ({ name: String(i.name ?? i), qty: Number(i.qty ?? 1) || 1, category: i.category, desc: i.desc }));
    out.quests = (out.quests ?? []).map((q: any) => ({ title: String(q.title ?? q), desc: q.desc ?? '', objectives: Array.isArray(q.objectives) ? q.objectives.map(String) : [] }));
    out.npcs = (out.npcs ?? []).map((n: any) => ({ name: String(n.name ?? n), role: n.role ?? '', personality: n.personality ?? '', appearance: n.appearance ?? '' }));
    out.groups = (out.groups ?? []).map((g: any) => ({ name: String(g.name ?? g), type: g.type ?? 'organization', standing: Number(g.standing ?? 50) || 50 }));
    out.skills = (out.skills ?? []).map((s: any) => ({ name: String(s.name ?? s), kind: ['attack', 'heal', 'buff', 'debuff', 'utility'].includes(s.kind) ? s.kind : 'utility', cost: Number(s.cost ?? 0) || 0, costType: ['mp', 'ap', 'none'].includes(s.costType) ? s.costType : 'none', power: Number(s.power ?? 10) || 10, desc: s.desc ?? '' }));
    out.facts = (out.facts ?? []).map(String);
    return { config: out };
  });

  /** Apply a New Game config to a chat's campaign and optionally write the opening scene. */
  app.post('/api/chats/:id/newgame', async (req, reply) => {
    const chatId = (req.params as { id: string }).id;
    const b = parse(z.object({ config: z.any(), opening: z.boolean().default(true) }), req.body);
    const chat = getChat(ctx, owner(req), chatId);
    if (!chat.campaignId) throw new HttpError(400, 'This chat has no campaign');
    let state;
    try {
      state = buildNewGameState(b.config as NewGameConfig);
    } catch (e) {
      throw new HttpError(400, `Invalid setup: ${(e as Error).message}`);
    }
    const next = setBaseState(ctx, owner(req), chat.campaignId, state, req.clientId);
    if (!b.opening) return { state: next };
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
    const send = (e: unknown) => raw.write(`data: ${JSON.stringify(e)}\n\n`);
    send({ type: 'state', state: next });
    try {
      await generate(
        ctx,
        owner(req),
        chatId,
        {
          type: 'normal',
          origin: req.clientId,
          instruction: `[Write the opening scene of this story. Set the place, time and mood using the game state, introduce ${(b.config as NewGameConfig).character.name || 'the player'} and at least one other character, and end with a clear hook for the player to respond to.]`,
        },
        send,
      );
    } catch (e) {
      send({ type: 'error', error: (e as Error).message });
    }
    raw.end();
  });

  registerSocial(app, ctx);
  registerMedia(app, ctx);
}
