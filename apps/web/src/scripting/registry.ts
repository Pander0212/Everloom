/** The slash-command registry, shared by built-in commands, scripts and extensions. */
import { SlashRegistry, type ScriptPermission } from '@everloom/engine';

export interface SlashCtx {
  /** Who is running it: the owner (no limits) or a script (its permissions). */
  perms: Set<ScriptPermission> | 'owner';
  chatId: string | null;
  from: string;
}

export const slashRegistry = new SlashRegistry<SlashCtx>();

/**
 * Scripts and extensions still starting (their files loading, or their code just started and
 * registering commands). A command typed right after a chat opens waits for them briefly instead
 * of failing as unknown.
 */
const starting = new Set<string>();
export function noteStarting(key: string, on: boolean) {
  if (on) starting.add(key);
  else starting.delete(key);
}
export async function whenStarted(maxMs = 5000) {
  const until = Date.now() + maxMs;
  while (starting.size && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
}
