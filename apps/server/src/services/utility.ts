/** One-shot calls to the utility model (falls back to Main): JSON answers and short texts. */
import { extractJson } from '@everloom/engine';
import { HttpError, type AppContext } from '../context.js';
import { completeChat } from '../llm/providers.js';
import { logged, promptTokens } from './calls.js';
import { connectionForRole } from './connections.js';

export async function utilityText(ctx: AppContext, ownerId: string, system: string, user: string, opts: { maxTokens?: number; temperature?: number; role?: 'utility' | 'main'; purpose?: string; chatId?: string | null } = {}): Promise<string> {
  const role = opts.role ?? 'utility';
  const conn = connectionForRole(ctx, ownerId, role);
  if (!conn) throw new HttpError(400, 'Add a connection first');
  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
  // Every call shows up in the call log with why it was made.
  const r = await logged(ctx, ownerId, conn, { purpose: opts.purpose ?? 'utility task', role, chatId: opts.chatId ?? null }, promptTokens(messages), () =>
    completeChat(conn, { messages, overrides: { temperature: opts.temperature ?? 0.8, max_tokens: opts.maxTokens ?? 800, reasoning: false, stop: [] }, signal: AbortSignal.timeout(90_000) }),
  );
  return r.text.trim();
}

export async function utilityJson<T>(ctx: AppContext, ownerId: string, system: string, user: string, maxTokens = 1200, purpose = 'utility task'): Promise<T> {
  const text = await utilityText(ctx, ownerId, system, user, { maxTokens, purpose });
  const j = extractJson<T>(text);
  if (!j.ok) throw new HttpError(502, 'The model did not return usable JSON. Try again.');
  return j.value as T;
}
