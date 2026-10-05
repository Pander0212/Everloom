/** The slash-command registry, shared by built-in commands, scripts and extensions. */
import { SlashRegistry, type ScriptPermission } from '@everloom/engine';

export interface SlashCtx {
  /** Who is running it: the owner (no limits) or a script (its permissions). */
  perms: Set<ScriptPermission> | 'owner';
  chatId: string | null;
  from: string;
}

export const slashRegistry = new SlashRegistry<SlashCtx>();
