/**
 * Chat generation: builds the prompt, streams tokens to the caller and to other devices,
 * saves the result as a message/swipe, then runs the tracker pass and memory upkeep.
 */
import { detectEmotion, extractInlineOps, stripInlineTags, type GenerateEvent, type MessageDTO, type SwipeDTO } from '@everloom/engine';
import { HttpError, type AppContext } from '../context.js';
import { streamChat, type ResolvedConnection } from '../llm/providers.js';
import { deleteEntriesFor, rebuildCampaign, realtimeTick } from './campaigns.js';
import { getChat, getGroup, getMessage, insertMessage, listMessages, updateChat, writeSwipes } from './chats.js';
import { connectionForRole } from './connections.js';
import { shouldSummarize, summarizeChat } from './memory.js';
import { buildPrompt, loadPromptContext, type GenType, type PromptContext } from './prompt.js';
import { countTokens } from './tokens.js';
import { applyTracked, runTrackerPass } from './tracker.js';

const active = new Map<string, AbortController>();
const lastPrompts = new Map<string, unknown>();

export function stopGeneration(chatId: string): boolean {
  const c = active.get(chatId);
  if (!c) return false;
  c.abort(new Error('Stopped'));
  return true;
}

export function isGenerating(chatId: string) {
  return active.has(chatId);
}

export function lastPromptFor(chatId: string) {
  return lastPrompts.get(chatId) ?? null;
}

export interface GenerateInput {
  type: GenType;
  text?: string;
  /** Group chats: force this member to speak. */
  characterId?: string | null;
  origin?: string;
}

function textOf(m: MessageDTO) {
  return m.swipes[m.swipeId]?.text ?? '';
}

/** Pick who speaks next in a group chat. */
export function pickSpeaker(pc: PromptContext, muted: Set<string>, strategy: string, forced?: string | null): string {
  const members = pc.members.filter((m) => !muted.has(m.id));
  if (forced && pc.members.some((m) => m.id === forced)) return forced;
  if (!members.length) return pc.members[0].id;
  const history = pc.history.filter((m) => !m.hidden);
  const lastSpeaker = [...history].reverse().find((m) => m.role === 'assistant')?.characterId;
  if (strategy === 'list') {
    const idx = members.findIndex((m) => m.id === lastSpeaker);
    return members[(idx + 1) % members.length].id;
  }
  // Natural: whoever was mentioned last speaks; otherwise weighted by talkativeness, avoiding repeats.
  const last = history[history.length - 1];
  if (last) {
    const text = textOf(last).toLowerCase();
    let best: { id: string; pos: number } | null = null;
    for (const m of members) {
      if (m.id === last.characterId) continue;
      const first = m.name.toLowerCase().split(' ')[0];
      const pos = Math.max(text.lastIndexOf(m.name.toLowerCase()), text.lastIndexOf(first));
      if (pos >= 0 && (!best || pos > best.pos)) best = { id: m.id, pos };
    }
    if (best) return best.id;
  }
  const pool = members.length > 1 ? members.filter((m) => m.id !== lastSpeaker) : members;
  const weights = pool.map((m) => Math.max(0.05, Number(m.card.extensions?.talkativeness ?? 0.5)));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i].id;
  }
  return pool[0].id;
}

export async function generate(ctx: AppContext, owner: string, chatId: string, input: GenerateInput, emit: (e: GenerateEvent) => void): Promise<void> {
  if (active.has(chatId)) throw new HttpError(409, 'Already generating in this chat');
  const controller = new AbortController();
  active.set(chatId, controller);
  const pub = (type: string, data: unknown) => ctx.bus.publish(owner, type, data, input.origin);
  try {
    let chat = getChat(ctx, owner, chatId);
    if (chat.campaignId) realtimeTick(ctx, owner, chat.campaignId, chatId);

    // 1. User message
    if (input.type === 'normal' && input.text && input.text.trim()) {
      const pcTmp = loadPromptContext(ctx, owner, chatId);
      const userMsg = insertMessage(ctx, owner, chatId, { role: 'user', name: pcTmp.userName, swipes: [{ text: input.text.trim(), createdAt: Date.now() }] });
      emit({ type: 'user', message: userMsg });
      pub('message.created', { chatId, message: userMsg });
    }

    // 2. Speaker + connection
    let pc = loadPromptContext(ctx, owner, chatId);
    let speakerId = pc.character.id;
    if (chat.groupId) {
      const group = getGroup(ctx, owner, chat.groupId);
      const muted = new Set(group.members.filter((m) => m.muted).map((m) => m.characterId));
      const last = pc.history[pc.history.length - 1];
      const continuing = input.type === 'continue' || input.type === 'swipe' || input.type === 'regenerate';
      speakerId = continuing && last?.characterId ? last.characterId : pickSpeaker(pc, muted, group.strategy, input.characterId);
      pc = loadPromptContext(ctx, owner, chatId, speakerId);
    }
    const conn: ResolvedConnection | null = connectionForRole(ctx, owner, 'main', pc.character.game.connectionId ?? chat.metadata.connectionId ?? null);
    if (!conn) throw new HttpError(400, 'Add a connection in Settings → Connections first.', 'no_connection');
    const maxContext = Number(conn.params.context_size ?? 16384);
    const maxResponse = Number(conn.params.max_tokens ?? 500);

    // 3. Target message and history
    const history = pc.history;
    let target: MessageDTO | null = null;
    let swipeIndex = 0;
    let baseText = '';
    let promptHistory = history;
    const lastMsg = history[history.length - 1];
    if (input.type === 'swipe' || input.type === 'regenerate' || input.type === 'continue') {
      if (!lastMsg || lastMsg.role !== 'assistant') throw new HttpError(400, 'The last message is not a character reply');
      target = lastMsg;
    }
    if (input.type === 'swipe' && target) {
      const swipes = [...target.swipes, { text: '', createdAt: Date.now() } as SwipeDTO];
      swipeIndex = swipes.length - 1;
      writeSwipes(ctx, target.id, swipes, swipeIndex);
      if (chat.campaignId) rebuildCampaign(ctx, owner, chat.campaignId, input.origin);
      promptHistory = history.slice(0, -1);
    } else if (input.type === 'regenerate' && target) {
      swipeIndex = target.swipeId;
      const swipes = target.swipes.slice();
      swipes[swipeIndex] = { text: '', createdAt: Date.now() };
      writeSwipes(ctx, target.id, swipes, swipeIndex);
      if (chat.campaignId) {
        deleteEntriesFor(ctx, chat.campaignId, target.id, swipeIndex, ['ai']);
        rebuildCampaign(ctx, owner, chat.campaignId, input.origin);
      }
      promptHistory = history.slice(0, -1);
    } else if (input.type === 'continue' && target) {
      swipeIndex = target.swipeId;
      baseText = textOf(target);
    }
    // Refresh state after rebuilds.
    pc = loadPromptContext(ctx, owner, chatId, speakerId);

    const built = await buildPrompt(ctx, owner, pc, {
      type: input.type,
      history: promptHistory,
      maxContext,
      maxResponse,
    });
    lastPrompts.set(chatId, {
      at: Date.now(),
      connection: { name: conn.name, provider: conn.provider, model: conn.model },
      parts: built.assembled.parts,
      totalTokens: built.assembled.totalTokens,
      budget: built.assembled.budget,
      trimmedHistory: built.assembled.trimmedHistory,
      worldInfo: built.wiActivated,
    });
    chat = updateChat(ctx, owner, chatId, { metadata: { wiTimed: built.wiTimed, vars: built.macros.vars as Record<string, string> } });

    // 4. Create the assistant message now so other devices can show it streaming.
    if (input.type === 'normal') {
      target = insertMessage(ctx, owner, chatId, {
        role: 'assistant',
        name: pc.character.name,
        characterId: pc.character.id,
        swipes: [{ text: '', createdAt: Date.now(), model: conn.model }],
      });
      swipeIndex = 0;
      pub('message.created', { chatId, message: target });
    } else if (target) {
      pub('message.updated', { chatId, message: getMessage(ctx, owner, target.id) });
    }
    const messageId = target?.id;
    emit({ type: 'start', messageId, swipeId: swipeIndex });

    // 5. Stream
    let text = '';
    let reasoning = '';
    let lastSave = Date.now();
    let lastPub = 0;
    let error: string | undefined;
    const save = (final: boolean) => {
      if (!messageId) return;
      const m = getMessage(ctx, owner, messageId);
      const swipes = m.swipes.slice();
      const shown = baseText + (baseText && text && !/^\s/.test(text) && !/\s$/.test(baseText) ? ' ' : '') + text;
      swipes[swipeIndex] = {
        ...swipes[swipeIndex],
        text: final ? stripInlineTags(shown) : shown,
        reasoning: reasoning || swipes[swipeIndex]?.reasoning,
        createdAt: swipes[swipeIndex]?.createdAt ?? Date.now(),
        model: conn.model,
        tokens: final ? countTokens(shown) : undefined,
      };
      writeSwipes(ctx, messageId, swipes, swipeIndex);
    };
    try {
      for await (const chunk of streamChat(conn, {
        messages: built.assembled.messages,
        assembled: built.assembled,
        names: { char: pc.character.name, user: pc.userName, impersonate: input.type === 'impersonate', continueText: baseText || undefined },
        prefill: built.assembled.prefill || undefined,
        signal: controller.signal,
      })) {
        if (chunk.text) {
          text += chunk.text;
          emit({ type: 'delta', messageId, text: chunk.text });
        }
        if (chunk.reasoning) {
          reasoning += chunk.reasoning;
          emit({ type: 'reasoning', messageId, text: chunk.reasoning });
        }
        const now = Date.now();
        if (messageId && now - lastPub > 150) {
          lastPub = now;
          pub('message.stream', { chatId, messageId, swipeId: swipeIndex, text: stripInlineTags(baseText + text), reasoning });
        }
        if (messageId && now - lastSave > 1500) {
          lastSave = now;
          save(false);
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) error = (e as Error).message;
    }

    if (input.type === 'impersonate') {
      if (error) emit({ type: 'error', error });
      emit({ type: 'done', text: stripInlineTags(text) });
      return;
    }
    if (!messageId) return;

    // 6. Finalize
    const inline = pc.settings.tracker.mode === 'inline' ? extractInlineOps(text) : null;
    if (!text.trim() && !baseText && error) {
      // Nothing came back: remove the empty message/swipe we created.
      const m = getMessage(ctx, owner, messageId);
      if (input.type === 'normal') {
        ctx.db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
        pub('message.deleted', { chatId, ids: [messageId] });
      } else if (input.type === 'swipe' && m.swipes.length > 1) {
        const swipes = m.swipes.slice(0, -1);
        writeSwipes(ctx, messageId, swipes, swipes.length - 1);
        if (chat.campaignId) rebuildCampaign(ctx, owner, chat.campaignId, input.origin);
        pub('message.updated', { chatId, message: getMessage(ctx, owner, messageId) });
      }
      emit({ type: 'error', error });
      return;
    }
    save(true);
    const finalText = stripInlineTags(baseText + text);
    const emotion = detectEmotion(finalText);
    const m0 = getMessage(ctx, owner, messageId);
    ctx.db.prepare('UPDATE messages SET extra = ? WHERE id = ?').run(JSON.stringify({ ...m0.extra, emotion }), messageId);
    const finalMsg = getMessage(ctx, owner, messageId);
    emit({ type: 'done', messageId, swipeId: swipeIndex, message: finalMsg, error });
    pub('message.updated', { chatId, message: finalMsg });

    // 7. Game state + memory (after the reply is safely stored)
    if (chat.campaignId && pc.settings.tracker.mode !== 'off') {
      if (inline) {
        if (inline.ok.length || inline.found) applyTracked(ctx, owner, chat.campaignId, chatId, messageId, swipeIndex, inline.ok, 'ai', input.origin);
      } else {
        void runTrackerPass(ctx, owner, chatId, messageId, input.origin).catch(() => {});
      }
    }
    if (shouldSummarize(ctx, owner, chatId)) void summarizeChat(ctx, owner, chatId).catch(() => {});
  } finally {
    active.delete(chatId);
  }
}

/** Dry run for the prompt inspector: what would be sent right now. */
export async function previewPrompt(ctx: AppContext, owner: string, chatId: string, type: GenType = 'normal') {
  const pc = loadPromptContext(ctx, owner, chatId);
  const conn = connectionForRole(ctx, owner, 'main', pc.character.game.connectionId ?? pc.chat.metadata.connectionId ?? null);
  const maxContext = Number(conn?.params.context_size ?? 16384);
  const maxResponse = Number(conn?.params.max_tokens ?? 500);
  const history = type === 'swipe' || type === 'regenerate' ? pc.history.slice(0, -1) : pc.history;
  const built = await buildPrompt(ctx, owner, pc, { type, history, maxContext, maxResponse });
  return {
    at: Date.now(),
    connection: conn ? { name: conn.name, provider: conn.provider, model: conn.model } : null,
    parts: built.assembled.parts,
    totalTokens: built.assembled.totalTokens,
    budget: built.assembled.budget,
    trimmedHistory: built.assembled.trimmedHistory,
    worldInfo: built.wiActivated,
  };
}

export { listMessages };
