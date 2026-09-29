/** Tracker pass: after an AI message, ask the utility model for JSON ops and apply them. */
import { buildTrackerPrompt, parseTrackerOutput, stripInlineTags, TRACKER_REPAIR_PROMPT, type Op, type TrackerExtras } from '@everloom/engine';
import type { AppContext } from '../context.js';
import { completeChat } from '../llm/providers.js';
import { logged, promptTokens } from './calls.js';
import { appendOps, characterRefs, getState, type AppendResult } from './campaigns.js';
import { getChat, getGroup, getMessage, listMessages, writeSwipes } from './chats.js';
import { connectionForRole } from './connections.js';
import { runHearsay, writeTurnMemory, type TurnWriteResult } from './mem.js';
import { defaultPersona, getPersona } from './personas.js';
import { getSettings } from './settings.js';

const running = new Map<string, Promise<unknown>>();

export interface TrackerResult {
  ok: boolean;
  summary: string[];
  error?: string;
  rejected?: number;
  memory?: TurnWriteResult | null;
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
  const textAtStart = target.swipes[swipeId]?.text ?? '';
  const settings = getSettings(ctx, owner);
  const all = listMessages(ctx, owner, chatId).filter((m) => !m.hidden && m.seq <= target.seq);
  const state = getState(ctx, owner, chat.campaignId);
  const { system, user } = buildTrackerPrompt(
    state,
    all.slice(-6).map((m) => ({ name: m.name, role: m.role, text: stripInlineTags(m.swipes[m.swipeId]?.text ?? '') })),
    { characterNames: characterRefs(ctx, owner).map((c) => c.name).slice(0, 40), memory: settings.world.memory },
  );
  ctx.bus.publish(owner, 'tracker.status', { chatId, messageId, status: 'running' });
  const call = (extra: Array<{ role: 'user' | 'assistant'; content: string }> = []) => {
    const messages = [{ role: 'system' as const, content: system }, { role: 'user' as const, content: user }, ...extra];
    return logged(ctx, owner, conn, { chatId, messageId, purpose: extra.length ? 'tracker (repair)' : 'tracker', role: 'utility' }, promptTokens(messages), () =>
      completeChat(conn, {
        messages,
        overrides: { temperature: 0.2, max_tokens: 1100, stream: true, reasoning: false, stop: [] },
        signal: AbortSignal.timeout(90_000),
      }),
    );
  };
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
  // The message may have been swiped or edited meanwhile; only write if it's still the same text.
  const now = getMessage(ctx, owner, messageId);
  if (now.swipeId !== swipeId || (now.swipes[swipeId]?.text ?? '') !== textAtStart) return { ok: false, summary: [], error: 'Message changed while tracking' };
  const result = applyTracked(ctx, owner, chat.campaignId, chatId, messageId, swipeId, parsed.ok, 'ai', origin, parsed);
  ctx.bus.publish(owner, 'tracker.status', { chatId, messageId, status: 'done', summary: result.summary, memory: result.memory });
  return { ok: true, summary: result.summary, rejected: parsed.rejected.length + result.errors.length, memory: result.memory };
}

/** The chat's character cards (group members or the one character). */
function chatCharacterIds(ctx: AppContext, owner: string, chat: ReturnType<typeof getChat>): Array<{ id: string; name: string }> {
  if (chat.groupId) {
    try {
      const g = getGroup(ctx, owner, chat.groupId);
      const refs = characterRefs(ctx, owner);
      return g.members.map((m) => refs.find((r) => r.id === m.characterId)).filter((x): x is { id: string; name: string } => !!x);
    } catch {
      return [];
    }
  }
  const ref = characterRefs(ctx, owner).find((r) => r.id === chat.characterId);
  return ref ? [ref] : [];
}

function playerName(ctx: AppContext, owner: string, chat: ReturnType<typeof getChat>): string {
  try {
    return (chat.personaId ? getPersona(ctx, owner, chat.personaId) : defaultPersona(ctx, owner))?.name ?? 'You';
  } catch {
    return 'You';
  }
}

/** After the ops: the turn's memories and facts, then free off-screen gossip. */
export function writeTurnWorld(ctx: AppContext, owner: string, chatId: string, messageId: string, swipeId: number, extras: TrackerExtras): TurnWriteResult | null {
  const settings = getSettings(ctx, owner);
  const chat = getChat(ctx, owner, chatId);
  const state = chat.campaignId ? getState(ctx, owner, chat.campaignId) : null;
  const m = getMessage(ctx, owner, messageId);
  const cards = chatCharacterIds(ctx, owner, chat);
  let res: TurnWriteResult | null = null;
  if (settings.world.memory) {
    const turnText = listMessages(ctx, owner, chatId)
      .filter((x) => x.seq <= m.seq && !x.hidden)
      .slice(-2)
      .map((x) => stripInlineTags(x.swipes[x.swipeId]?.text ?? ''))
      .join('\n');
    res = writeTurnMemory(ctx, owner, chat, state, { chatId, messageId, swipeId }, extras, { player: playerName(ctx, owner, chat), characters: cards }, turnText, cards.map((c) => c.id));
  }
  if (state && settings.world.hearsay) runHearsay(ctx, owner, chat, state, { chatId, messageId, swipeId }, { maxDistortion: 3, perListener: 2 });
  if (res && (res.memories || res.facts.inserted || res.facts.superseded || res.facts.conflicts)) ctx.bus.publish(owner, 'memory.changed', { chatId, campaignId: chat.campaignId });
  return res;
}

/** Apply ops for a message/swipe (replacing earlier ones from the same source) and store the summary on the swipe. */
export function applyTracked(ctx: AppContext, owner: string, campaignId: string, chatId: string, messageId: string, swipeId: number, ops: Op[], source: 'ai', origin?: string, extras?: TrackerExtras): AppendResult & { memory: TurnWriteResult | null } {
  const result = appendOps(ctx, owner, campaignId, { chatId, messageId, swipeId, source, ops, replace: true, origin });
  const memory = extras ? writeTurnWorld(ctx, owner, chatId, messageId, swipeId, extras) : null;
  const m = getMessage(ctx, owner, messageId);
  const swipes = m.swipes.slice();
  if (swipes[swipeId]) {
    swipes[swipeId] = { ...swipes[swipeId], changes: result.summary };
    writeSwipes(ctx, messageId, swipes, m.swipeId);
    ctx.bus.publish(owner, 'message.updated', { chatId, message: getMessage(ctx, owner, messageId) }, origin);
  }
  return { ...result, memory };
}
