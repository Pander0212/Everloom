import { applyRegexScripts, extOpRetired, OpSchemas, RegexPlacement, validateOps, type GenerateEvent, type OpType, type ValidatedOps } from '@everloom/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import * as camp from '../services/campaigns.js';
import * as chats from '../services/chats.js';
import { generate, isGenerating, lastPromptFor, previewPrompt, stopGeneration } from '../services/generate.js';
import { runChronicler, runConsolidation } from '../services/chronicle.js';
import { indexDoc } from '../services/search.js';
import { regexForChat } from '../services/scripts.js';
import { getSettings } from '../services/settings.js';
import { runTrackerPass } from '../services/tracker.js';
import { parse } from '../util/validate.js';

const USER_OP_TYPES = (Object.keys(OpSchemas) as OpType[]).filter((t) => t !== 'patch');

export function registerChats(app: FastifyInstance, ctx: AppContext) {
  const pub = (req: any, type: string, data: unknown) => ctx.bus.publish(owner(req), type, data, req.clientId);

  // ---------------- groups
  app.get('/api/groups', async (req) => chats.listGroups(ctx, owner(req)));
  const groupInput = z.object({
    name: z.string().trim().min(1).max(120),
    members: z.array(z.object({ characterId: z.string(), muted: z.boolean().default(false) })).min(1).max(12),
    strategy: z.enum(['natural', 'list', 'manual']).optional(),
  });
  app.post('/api/groups', async (req) => chats.saveGroup(ctx, owner(req), parse(groupInput, req.body)));
  app.put('/api/groups/:id', async (req) => chats.saveGroup(ctx, owner(req), parse(groupInput, req.body), (req.params as any).id));
  app.delete('/api/groups/:id', async (req) => {
    chats.deleteGroup(ctx, owner(req), (req.params as any).id);
    return { ok: true };
  });

  // ---------------- chats
  app.get('/api/chats', async (req) => chats.listChats(ctx, owner(req), req.query as any));
  app.post('/api/chats', async (req) => {
    const b = parse(
      z.object({ characterId: z.string().nullable().optional(), groupId: z.string().nullable().optional(), personaId: z.string().nullable().optional(), title: z.string().max(200).optional(), campaign: z.string().max(80).optional(), greeting: z.boolean().optional(), features: z.enum(['classic', 'story', 'full']).nullable().optional() }),
      req.body,
    );
    const chat = chats.createChat(ctx, owner(req), b);
    pub(req, 'chat.created', { chat });
    return chat;
  });
  app.get('/api/chats/:id', async (req) => {
    const chat = chats.getChat(ctx, owner(req), (req.params as any).id);
    return { ...chat, generating: isGenerating(chat.id) };
  });
  app.get('/api/chats/:id/messages', async (req) => chats.listMessages(ctx, owner(req), (req.params as any).id));
  app.patch('/api/chats/:id', async (req) => {
    const b = parse(z.object({ title: z.string().trim().min(1).max(200).optional(), personaId: z.string().nullable().optional(), metadata: z.record(z.string(), z.any()).optional() }), req.body);
    const chat = chats.updateChat(ctx, owner(req), (req.params as any).id, b as any);
    pub(req, 'chat.updated', { chat });
    return chat;
  });
  app.delete('/api/chats/:id', async (req) => {
    chats.deleteChat(ctx, owner(req), (req.params as any).id);
    pub(req, 'chat.deleted', { id: (req.params as any).id });
    return { ok: true };
  });
  app.post('/api/chats/:id/branch', async (req) => {
    const b = parse(z.object({ messageId: z.string(), title: z.string().max(200).optional() }), req.body);
    const chat = chats.branchChat(ctx, owner(req), (req.params as any).id, b.messageId, b.title);
    pub(req, 'chat.created', { chat });
    return chat;
  });
  app.post('/api/chats/:id/duplicate', async (req) => chats.duplicateChat(ctx, owner(req), (req.params as any).id));
  app.get('/api/chats/:id/export', async (req, reply) => {
    const { filename, body } = chats.exportChat(ctx, owner(req), (req.params as any).id);
    reply.header('content-type', 'application/jsonl; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${filename}"`);
    return body;
  });
  app.post('/api/chats/import', async (req) => {
    const q = req.query as { characterId?: string };
    if (!q.characterId) throw new HttpError(400, 'characterId is required');
    const text = Buffer.isBuffer(req.body) ? (req.body as Buffer).toString('utf8') : String(req.body ?? '');
    return chats.importChat(ctx, owner(req), q.characterId, text);
  });
  app.get('/api/chat-search', async (req) => chats.searchAllChats(ctx, owner(req), String((req.query as any).q ?? '')));
  app.get('/api/chats/:id/search', async (req) => chats.searchMessages(ctx, owner(req), (req.params as any).id, String((req.query as any).q ?? '')));
  // "Update memory now": read everything unread (even the newest messages), then fold.
  app.post('/api/chats/:id/summarize', async (req) => {
    const id = (req.params as any).id;
    const r = await runChronicler(ctx, owner(req), id, { force: true });
    const c = await runConsolidation(ctx, owner(req), id, { useModel: getSettings(ctx, owner(req)).world.consolidate });
    return { ...r, ok: r.ok || c.scenes + c.days + c.chapters > 0, consolidated: c };
  });
  app.post('/api/chats/:id/generate', async (req, reply) => {
    const b = parse(
      z.object({ type: z.enum(['normal', 'swipe', 'regenerate', 'continue', 'impersonate']).default('normal'), text: z.string().max(100_000).optional(), characterId: z.string().nullable().optional(), target: z.string().max(120).nullable().optional() }),
      req.body,
    );
    const chatId = (req.params as any).id;
    chats.getChat(ctx, owner(req), chatId);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    let closed = false;
    raw.on('close', () => {
      closed = true;
    });
    const send = (e: GenerateEvent) => {
      if (!closed) raw.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    const ping = setInterval(() => !closed && raw.write(': ping\n\n'), 15000);
    try {
      await generate(ctx, owner(req), chatId, { ...b, origin: req.clientId }, send);
    } catch (e) {
      const err = e as HttpError;
      send({ type: 'error', error: err.message, code: err.code });
    } finally {
      clearInterval(ping);
      if (!closed) raw.end();
    }
  });
  app.post('/api/chats/:id/stop', async (req) => {
    chats.getChat(ctx, owner(req), (req.params as any).id);
    return { stopped: stopGeneration((req.params as any).id) };
  });
  app.get('/api/chats/:id/prompt', async (req) => {
    chats.getChat(ctx, owner(req), (req.params as any).id);
    return lastPromptFor((req.params as any).id);
  });
  app.post('/api/chats/:id/prompt/preview', async (req) => previewPrompt(ctx, owner(req), (req.params as any).id, ((req.body as any)?.type ?? 'normal') as any));

  // ---------------- messages
  app.post('/api/chats/:id/messages', async (req) => {
    const chatId = (req.params as any).id;
    const b = parse(z.object({ role: z.enum(['user', 'assistant', 'system']), name: z.string().max(120).optional(), text: z.string().max(100_000), characterId: z.string().nullable().optional() }), req.body);
    const chat = chats.getChat(ctx, owner(req), chatId);
    // Regex rules apply to added messages as to typed and generated ones.
    const rules = b.role === 'system' ? [] : regexForChat(ctx, owner(req), chatId);
    const text = rules.length ? applyRegexScripts(b.text, rules, { placement: b.role === 'user' ? RegexPlacement.userInput : RegexPlacement.aiOutput, target: 'stored' }) : b.text;
    const m = chats.insertMessage(ctx, owner(req), chatId, { role: b.role, name: b.name ?? (b.role === 'system' ? 'Narrator' : 'You'), characterId: b.characterId ?? null, swipes: [{ text, createdAt: Date.now() }] });
    pub(req, 'message.created', { chatId: chat.id, message: m });
    return m;
  });
  app.patch('/api/messages/:id', async (req) => {
    const b = parse(z.object({ text: z.string().max(100_000).optional(), hidden: z.boolean().optional(), bookmarked: z.boolean().optional(), extra: z.record(z.string(), z.any()).optional() }), req.body);
    const { message, textChanged } = chats.updateMessage(ctx, owner(req), (req.params as any).id, b);
    pub(req, 'message.updated', { chatId: message.chatId, message });
    const chat = chats.getChat(ctx, owner(req), message.chatId);
    if (textChanged && chat.campaignId) {
      camp.rebuildCampaign(ctx, owner(req), chat.campaignId, req.clientId);
      if (message.role === 'assistant' && getSettings(ctx, owner(req)).tracker.mode !== 'off') void runTrackerPass(ctx, owner(req), chat.id, message.id, req.clientId).catch(() => {});
    }
    if (b.hidden !== undefined && chat.campaignId) camp.rebuildCampaign(ctx, owner(req), chat.campaignId, req.clientId);
    return message;
  });
  app.delete('/api/messages/:id', async (req) => {
    const m = chats.getMessage(ctx, owner(req), (req.params as any).id);
    const ids = chats.deleteMessages(ctx, owner(req), m.id, (req.query as any).after === '1');
    pub(req, 'message.deleted', { chatId: m.chatId, ids });
    return { ids };
  });
  app.post('/api/messages/:id/swipe', async (req) => {
    const b = parse(z.object({ swipeId: z.number().int().min(0) }), req.body);
    const m = chats.setSwipe(ctx, owner(req), (req.params as any).id, b.swipeId);
    pub(req, 'message.updated', { chatId: m.chatId, message: m });
    return m;
  });
  app.delete('/api/messages/:id/swipes/:n', async (req) => {
    const m = chats.deleteSwipe(ctx, owner(req), (req.params as any).id, Number((req.params as any).n));
    pub(req, 'message.updated', { chatId: m.chatId, message: m });
    return m;
  });
  app.post('/api/messages/:id/retrack', async (req) => {
    const m = chats.getMessage(ctx, owner(req), (req.params as any).id);
    return runTrackerPass(ctx, owner(req), m.chatId, m.id, req.clientId);
  });

  // ---------------- campaigns
  app.get('/api/campaigns/:id', async (req) => {
    const row = camp.campaignRow(ctx, owner(req), (req.params as any).id);
    return { id: row.id, name: row.name, state: camp.getState(ctx, owner(req), row.id), updatedAt: row.updated_at };
  });
  app.post('/api/campaigns/:id/ops', async (req) => {
    const campaignId = (req.params as any).id;
    const b = parse(z.object({ chatId: z.string(), ops: z.array(z.any()).min(1).max(64), messageId: z.string().nullable().optional() }), req.body);
    const v = withoutRetired(validateOps(b.ops, USER_OP_TYPES));
    if (!v.ok.length) throw new HttpError(400, v.rejected.map((r) => r.error).join('; ') || 'No valid ops');
    const chat = chats.getChat(ctx, owner(req), b.chatId);
    if (chat.campaignId !== campaignId) throw new HttpError(400, 'Chat is not linked to this campaign');
    const last = ctx.db.prepare('SELECT id FROM messages WHERE chat_id = ? ORDER BY seq DESC LIMIT 1').get(b.chatId) as { id: string } | undefined;
    const r = camp.appendOps(ctx, owner(req), campaignId, { chatId: b.chatId, messageId: b.messageId ?? last?.id ?? null, swipeId: null, source: 'user', ops: v.ok, origin: req.clientId });
    return { state: r.state, summary: r.summary, errors: [...v.rejected.map((x) => x.error), ...r.errors.map((e) => e.error)] };
  });
  app.post('/api/campaigns/:id/rebuild', async (req) => ({ state: camp.rebuildCampaign(ctx, owner(req), (req.params as any).id, req.clientId) }));
  app.get('/api/campaigns/:id/log', async (req) => camp.opLogFor(ctx, owner(req), (req.params as any).id));
  app.post('/api/campaigns/:id/undo', async (req) => {
    const b = parse(z.object({ entryId: z.string() }), req.body);
    return { state: camp.undoEntry(ctx, owner(req), (req.params as any).id, b.entryId, req.clientId) };
  });
  app.put('/api/campaigns/:id/base', async (req) => {
    const b = parse(z.object({ state: z.any() }), req.body);
    if (!b.state || typeof b.state !== 'object' || !b.state.meta || !b.state.player) throw new HttpError(400, 'Invalid state');
    return { state: camp.setBaseState(ctx, owner(req), (req.params as any).id, b.state, req.clientId) };
  });
  app.post('/api/campaigns/:id/tick', async (req) => {
    const b = parse(z.object({ chatId: z.string() }), req.body);
    const r = camp.realtimeTick(ctx, owner(req), (req.params as any).id, b.chatId);
    return { advanced: !!r, summary: r?.summary ?? [] };
  });
}

/** New changes can't use the ops of an extension that is off or uninstalled (replay still can). */
export function withoutRetired(v: ValidatedOps): ValidatedOps {
  const ok = v.ok.filter((o) => !(o.type === 'ext.op' && extOpRetired(o.ext)));
  const gone = v.ok.filter((o) => o.type === 'ext.op' && extOpRetired(o.ext)).map((o) => ({ op: o as unknown, error: `The extension “${(o as { ext: string }).ext}” is off or uninstalled` }));
  return { ok, rejected: [...v.rejected, ...gone] };
}
