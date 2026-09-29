/** Per-call log of every model request: role, model, time, tokens and why it was made. */
import type { AppContext } from '../context.js';
import type { ResolvedConnection } from '../llm/providers.js';
import { newId } from '../security/crypto.js';
import { countTokens } from './tokens.js';

export type CallRole = 'main' | 'utility' | 'background' | 'embeddings' | 'image' | 'tts';

export interface CallMeta {
  chatId?: string | null;
  messageId?: string | null;
  purpose: string;
  role: CallRole;
}

export interface CallRow {
  id: string;
  chatId: string | null;
  messageId: string | null;
  purpose: string;
  role: CallRole;
  provider: string | null;
  model: string | null;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  firstTokenMs: number | null;
  ok: boolean;
  error: string | null;
  createdAt: number;
}

export function recordCall(ctx: AppContext, owner: string, conn: Pick<ResolvedConnection, 'provider' | 'model'> | null, meta: CallMeta, r: { ms: number; tokensIn: number; tokensOut: number; ok: boolean; error?: string | null; firstTokenMs?: number | null }) {
  try {
    ctx.db
      .prepare('INSERT INTO llm_calls (id, owner_id, chat_id, message_id, purpose, role, provider, model, ms, tokens_in, tokens_out, first_token_ms, ok, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId('call_'), owner, meta.chatId ?? null, meta.messageId ?? null, meta.purpose, meta.role, conn?.provider ?? null, conn?.model ?? null, Math.round(r.ms), r.tokensIn, r.tokensOut, r.firstTokenMs == null ? null : Math.round(r.firstTokenMs), r.ok ? 1 : 0, r.error ?? null, Date.now());
    // Keep the log bounded: newest 5,000 calls per owner.
    ctx.db.prepare('DELETE FROM llm_calls WHERE owner_id = ? AND id IN (SELECT id FROM llm_calls WHERE owner_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 5000)').run(owner, owner);
  } catch {
    /* logging must never break a request */
  }
}

/** Run a model call and log it. `tokensIn` is an estimate of the prompt; the output is counted from the result. */
export async function logged<T>(ctx: AppContext, owner: string, conn: Pick<ResolvedConnection, 'provider' | 'model'> | null, meta: CallMeta, tokensIn: number, fn: () => Promise<T>, outText: (r: T) => string = (r: any) => (typeof r?.text === 'string' ? r.text : '')): Promise<T> {
  const t0 = performance.now();
  try {
    const r = await fn();
    recordCall(ctx, owner, conn, meta, { ms: performance.now() - t0, tokensIn, tokensOut: countTokens(outText(r) || ''), ok: true });
    return r;
  } catch (e) {
    recordCall(ctx, owner, conn, meta, { ms: performance.now() - t0, tokensIn, tokensOut: 0, ok: false, error: (e as Error).message?.slice(0, 300) });
    throw e;
  }
}

export function promptTokens(messages: Array<{ content: string }>): number {
  return messages.reduce((n, m) => n + countTokens(m.content ?? ''), 0);
}

export function listCalls(ctx: AppContext, owner: string, opts: { chatId?: string; messageId?: string; limit?: number } = {}): CallRow[] {
  const where = ['owner_id = ?'];
  const args: unknown[] = [owner];
  if (opts.chatId) {
    where.push('chat_id = ?');
    args.push(opts.chatId);
  }
  if (opts.messageId) {
    where.push('message_id = ?');
    args.push(opts.messageId);
  }
  const rows = ctx.db.prepare(`SELECT * FROM llm_calls WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`).all(...args, Math.min(opts.limit ?? 200, 1000)) as any[];
  return rows.map((r) => ({ id: r.id, chatId: r.chat_id, messageId: r.message_id, purpose: r.purpose, role: r.role, provider: r.provider, model: r.model, ms: r.ms, tokensIn: r.tokens_in, tokensOut: r.tokens_out, firstTokenMs: r.first_token_ms, ok: !!r.ok, error: r.error, createdAt: r.created_at }));
}
