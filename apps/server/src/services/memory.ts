/** Rolling chat summaries and long-term facts, written by the utility model. */
import { extractJson, stripInlineTags } from '@everloom/engine';
import type { AppContext } from '../context.js';
import { completeChat } from '../llm/providers.js';
import { newId } from '../security/crypto.js';
import { getChat, listMessages, updateChat } from './chats.js';
import { connectionForRole } from './connections.js';
import { indexDoc } from './search.js';
import { getSettings } from './settings.js';

const inflight = new Set<string>();

export function shouldSummarize(ctx: AppContext, owner: string, chatId: string): boolean {
  const s = getSettings(ctx, owner);
  if (!s.memory.auto) return false;
  const chat = getChat(ctx, owner, chatId);
  if (chat.metadata.memory?.pinned) return false;
  const upto = chat.metadata.memory?.uptoSeq ?? 0;
  const pending = (ctx.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND seq > ?').get(chatId, upto) as { n: number }).n;
  return pending >= s.memory.every;
}

export async function summarizeChat(ctx: AppContext, owner: string, chatId: string, opts: { force?: boolean } = {}): Promise<{ ok: boolean; summary?: string; facts?: string[]; error?: string }> {
  if (inflight.has(chatId)) return { ok: false, error: 'Already summarizing' };
  inflight.add(chatId);
  try {
    const chat = getChat(ctx, owner, chatId);
    if (chat.metadata.memory?.pinned && !opts.force) return { ok: false, error: 'Memory is pinned' };
    const conn = connectionForRole(ctx, owner, 'utility');
    if (!conn) return { ok: false, error: 'No utility connection' };
    const settings = getSettings(ctx, owner);
    const messages = listMessages(ctx, owner, chatId).filter((m) => !m.hidden);
    if (!messages.length) return { ok: false, error: 'Nothing to summarize' };
    const upto = opts.force ? 0 : chat.metadata.memory?.uptoSeq ?? 0;
    // Keep the most recent messages out: they are still in the prompt verbatim.
    const keepRecent = 8;
    const toSummarize = messages.filter((m) => m.seq > upto).slice(0, Math.max(0, messages.filter((m) => m.seq > upto).length - keepRecent));
    if (!toSummarize.length && !opts.force) return { ok: false, error: 'Not enough new messages' };
    const body = (toSummarize.length ? toSummarize : messages)
      .map((m) => `${m.name}: ${stripInlineTags(m.swipes[m.swipeId]?.text ?? '')}`)
      .join('\n\n')
      .slice(-24000);
    const previous = opts.force ? '' : chat.metadata.memory?.text ?? '';
    const prompt = `Update the running summary of a roleplay story.
${previous ? `Current summary:\n${previous}\n\n` : ''}New events:
${body}

Reply with JSON only: {"summary": "<the updated summary, past tense, at most ${settings.memory.maxWords} words, concrete names, places and open threads>", "facts": ["<durable facts worth remembering long-term, e.g. relationships, promises, secrets; max 5>"]}`;
    const r = await completeChat(conn, {
      messages: [{ role: 'system', content: 'You summarize stories faithfully and concisely. Output JSON only.' }, { role: 'user', content: prompt }],
      overrides: { temperature: 0.3, max_tokens: 900, reasoning: false, stop: [] },
      signal: AbortSignal.timeout(120_000),
    });
    const parsed = extractJson<{ summary?: string; facts?: string[] }>(r.text);
    const summary = parsed.ok && typeof parsed.value?.summary === 'string' ? parsed.value.summary.trim() : r.text.trim().slice(0, 4000);
    const facts = parsed.ok && Array.isArray(parsed.value?.facts) ? parsed.value!.facts.filter((f) => typeof f === 'string' && f.trim()).slice(0, 5) : [];
    const lastSeq = (toSummarize.length ? toSummarize : messages)[(toSummarize.length ? toSummarize : messages).length - 1].seq;
    updateChat(ctx, owner, chatId, { metadata: { memory: { text: summary, pinned: false, uptoSeq: lastSeq } } });
    const now = Date.now();
    for (const f of facts) {
      const dup = ctx.db.prepare("SELECT id FROM memories WHERE owner_id = ? AND chat_id = ? AND kind = 'fact' AND text = ?").get(owner, chatId, f);
      if (dup) continue;
      const id = newId('mem_');
      ctx.db
        .prepare("INSERT INTO memories (id, owner_id, chat_id, character_id, kind, text, pinned, upto_seq, created_at, updated_at) VALUES (?, ?, ?, ?, 'fact', ?, 0, ?, ?, ?)")
        .run(id, owner, chatId, chat.characterId, f, lastSeq, now, now);
      indexDoc(ctx, owner, chat.campaignId, 'memory', id, 'Memory', f);
    }
    ctx.bus.publish(owner, 'chat.updated', { chat: getChat(ctx, owner, chatId) });
    return { ok: true, summary, facts };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    inflight.delete(chatId);
  }
}
