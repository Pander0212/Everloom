/** Tracker pass: after an AI message, ask the utility model for JSON ops and apply them. */
import { buildTrackerPrompt, parseTrackerOutput, stripInlineTags, TRACKER_REPAIR_PROMPT, type Op } from '@everloom/engine';
import type { AppContext } from '../context.js';
import { completeChat } from '../llm/providers.js';
import { appendOps, characterRefs, getState, type AppendResult } from './campaigns.js';
import { getChat, getMessage, listMessages, writeSwipes } from './chats.js';
import { connectionForRole } from './connections.js';

const running = new Map<string, Promise<unknown>>();

export interface TrackerResult {
  ok: boolean;
  summary: string[];
  error?: string;
  rejected?: number;
}

export async function runTrackerPass(ctx: AppContext, owner: string, chatId: string, messageId: string, origin?: string): Promise<TrackerResult> {
  const key = `${messageId}`;
  while (running.has(key)) await running.get(key)!.catch(() => {});
  const p = doRun(ctx, owner, chatId, messageId, origin);
  running.set(key, p);
  try {
    return await p;
  } finally {
    running.delete(key);
  }
}

async function doRun(ctx: AppContext, owner: string, chatId: string, messageId: string, origin?: string): Promise<TrackerResult> {
  const chat = getChat(ctx, owner, chatId);
  if (!chat.campaignId) return { ok: false, summary: [], error: 'Chat has no campaign' };
  const conn = connectionForRole(ctx, owner, 'utility');
  if (!conn) return { ok: false, summary: [], error: 'No utility or main connection configured' };
  const target = getMessage(ctx, owner, messageId);
  const swipeId = target.swipeId;
  const all = listMessages(ctx, owner, chatId).filter((m) => !m.hidden && m.seq <= target.seq);
  const state = getState(ctx, owner, chat.campaignId);
  const { system, user } = buildTrackerPrompt(
    state,
    all.slice(-6).map((m) => ({ name: m.name, role: m.role, text: stripInlineTags(m.swipes[m.swipeId]?.text ?? '') })),
    { characterNames: characterRefs(ctx, owner).map((c) => c.name).slice(0, 40) },
  );
  ctx.bus.publish(owner, 'tracker.status', { chatId, messageId, status: 'running' });
  const call = (extra: Array<{ role: 'user' | 'assistant'; content: string }> = []) =>
    completeChat(conn, {
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }, ...extra],
      overrides: { temperature: 0.2, max_tokens: 900, stream: true, reasoning: false, stop: [] },
      signal: AbortSignal.timeout(90_000),
    });
  let out;
  try {
    out = await call();
  } catch (e) {
    ctx.bus.publish(owner, 'tracker.status', { chatId, messageId, status: 'error', error: (e as Error).message });
    return { ok: false, summary: [], error: (e as Error).message };
  }
  let parsed = parseTrackerOutput(out.text);
  if (!parsed.parsed) {
    try {
      const retry = await call([
        { role: 'assistant', content: out.text.slice(0, 2000) },
        { role: 'user', content: TRACKER_REPAIR_PROMPT },
      ]);
      parsed = parseTrackerOutput(retry.text);
    } catch {
      /* keep the failed parse */
    }
  }
  if (!parsed.parsed) {
    ctx.bus.publish(owner, 'tracker.status', { chatId, messageId, status: 'error', error: 'Tracker returned no JSON' });
    return { ok: false, summary: [], error: 'Tracker returned no usable JSON' };
  }
  // The message may have been swiped/edited meanwhile; only apply if still current.
  const now = getMessage(ctx, owner, messageId);
  if (now.swipeId !== swipeId) return { ok: false, summary: [], error: 'Message changed while tracking' };
  const result = applyTracked(ctx, owner, chat.campaignId, chatId, messageId, swipeId, parsed.ok, 'ai', origin);
  ctx.bus.publish(owner, 'tracker.status', { chatId, messageId, status: 'done', summary: result.summary });
  return { ok: true, summary: result.summary, rejected: parsed.rejected.length + result.errors.length };
}

/** Apply ops for a message/swipe (replacing earlier ones from the same source) and store the summary on the swipe. */
export function applyTracked(ctx: AppContext, owner: string, campaignId: string, chatId: string, messageId: string, swipeId: number, ops: Op[], source: 'ai', origin?: string): AppendResult {
  const result = appendOps(ctx, owner, campaignId, { chatId, messageId, swipeId, source, ops, replace: true, origin });
  const m = getMessage(ctx, owner, messageId);
  const swipes = m.swipes.slice();
  if (swipes[swipeId]) {
    swipes[swipeId] = { ...swipes[swipeId], changes: result.summary };
    writeSwipes(ctx, messageId, swipes, m.swipeId);
    ctx.bus.publish(owner, 'message.updated', { chatId, message: getMessage(ctx, owner, messageId) }, origin);
  }
  return result;
}
