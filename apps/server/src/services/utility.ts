/** One-shot calls to the utility model (falls back to Main): JSON answers and short texts. */
import { extractJson } from '@everloom/engine';
import { HttpError, type AppContext } from '../context.js';
import { completeChat } from '../llm/providers.js';
import { connectionForRole } from './connections.js';

export async function utilityText(ctx: AppContext, ownerId: string, system: string, user: string, opts: { maxTokens?: number; temperature?: number; role?: 'utility' | 'main' } = {}): Promise<string> {
  const conn = connectionForRole(ctx, ownerId, opts.role ?? 'utility');
  if (!conn) throw new HttpError(400, 'Add a connection first');
  const r = await completeChat(conn, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    overrides: { temperature: opts.temperature ?? 0.8, max_tokens: opts.maxTokens ?? 800, reasoning: false, stop: [] },
    signal: AbortSignal.timeout(90_000),
  });
  return r.text.trim();
}

export async function utilityJson<T>(ctx: AppContext, ownerId: string, system: string, user: string, maxTokens = 1200): Promise<T> {
  const text = await utilityText(ctx, ownerId, system, user, { maxTokens });
  const j = extractJson<T>(text);
  if (!j.ok) throw new HttpError(502, 'The model did not return usable JSON. Try again.');
  return j.value as T;
}
