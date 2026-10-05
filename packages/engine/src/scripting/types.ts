/**
 * Scripts: user and creator JavaScript that runs in a sandboxed frame and reaches Everloom only
 * through a permission-checked message bridge. This module holds the shapes and the permission
 * vocabulary shared by the server and the app.
 */
import { z } from 'zod';

/** What a script can ask for. Everything else (keys, settings, accounts, backups) is never reachable. */
export const SCRIPT_PERMISSIONS = [
  'chat.read',
  'chat.write',
  'variables',
  'lorebook.read',
  'lorebook.write',
  'state.read',
  'state.ops',
  'generate',
  'ui.panel',
  'audio',
  'storage',
  'network',
] as const;
export type ScriptPermission = (typeof SCRIPT_PERMISSIONS)[number];

/** Plain-language meaning, shown when a script asks. */
export const PERMISSION_INFO: Record<ScriptPermission, { label: string; detail: string; risk: 'low' | 'medium' | 'high' }> = {
  'chat.read': { label: 'Read this chat', detail: 'Messages, the character and your persona.', risk: 'medium' },
  'chat.write': { label: 'Write in this chat', detail: 'Send, add, edit and delete messages, and swipe.', risk: 'medium' },
  variables: { label: 'Variables', detail: 'Read and change chat, character, message and global variables.', risk: 'low' },
  'lorebook.read': { label: 'Read lorebooks', detail: 'Lorebooks and their entries.', risk: 'medium' },
  'lorebook.write': { label: 'Change lorebooks', detail: 'Add, edit and delete lorebook entries.', risk: 'medium' },
  'state.read': { label: 'Read the game', detail: 'Location, party, inventory, quests and the rest of the game state.', risk: 'low' },
  'state.ops': { label: 'Propose game changes', detail: 'Changes go through the same checks as the AI’s and roll back with swipes.', risk: 'medium' },
  generate: { label: 'Use your AI model', detail: 'Makes model calls on your connection. This costs money; calls are rate-limited and logged.', risk: 'high' },
  'ui.panel': { label: 'Show panels and buttons', detail: 'Panels, buttons, notices and dialogs inside Everloom.', risk: 'low' },
  audio: { label: 'Play sound', detail: 'Music and sound effects.', risk: 'low' },
  storage: { label: 'Keep its own data', detail: 'A small private store for this script only.', risk: 'low' },
  network: { label: 'Reach the internet', detail: 'Only the sites listed below, fetched through your server.', risk: 'high' },
};

export const SCRIPT_TRIGGERS = ['load', 'chatOpen', 'beforeGeneration', 'afterGeneration', 'messageReceived', 'swipe', 'button', 'timer', 'entryActivated'] as const;
export type ScriptTrigger = (typeof SCRIPT_TRIGGERS)[number];

export const TRIGGER_LABELS: Record<ScriptTrigger, string> = {
  load: 'When Everloom opens',
  chatOpen: 'When a chat opens',
  beforeGeneration: 'Before each reply',
  afterGeneration: 'After each reply',
  messageReceived: 'When a message arrives',
  swipe: 'On swipe',
  button: 'When its button is pressed',
  timer: 'On a timer',
  entryActivated: 'When its lorebook entry activates',
};

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}$/, 'A domain like example.com or *.example.com');

export const scriptButtonSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(40),
  /** A lucide icon name; unknown names fall back to a generic icon. */
  icon: z.string().max(40).optional(),
});
export type ScriptButton = z.infer<typeof scriptButtonSchema>;

export const scriptSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  description: z.string().max(2000).default(''),
  code: z.string().max(400_000),
  permissions: z.array(z.enum(SCRIPT_PERMISSIONS)).default([]),
  /** For `network`: the only domains it may reach. */
  domains: z.array(domain).max(20).default([]),
  triggers: z.array(z.enum(SCRIPT_TRIGGERS)).default(['chatOpen']),
  /** For the `timer` trigger. */
  intervalSeconds: z.number().int().min(5).max(86_400).optional(),
  /** For `entryActivated`: lorebook entry uids (as strings) that start it. */
  entries: z.array(z.string()).max(200).optional(),
  buttons: z.array(scriptButtonSchema).max(8).default([]),
  /** The author's switch. Running also needs the owner's approval (a grant). */
  enabled: z.boolean().default(true),
  /** Tavern Helper compatibility globals (opt-in, same sandbox and permissions). */
  compat: z.boolean().default(false),
  version: z.string().max(40).optional(),
});
export type Script = z.infer<typeof scriptSchema>;
export type ScriptInput = z.input<typeof scriptSchema>;

/** Where a script came from; also the key its approval is stored under. */
export type ScriptScope = 'global' | 'character' | 'preset' | 'lorebook' | 'extension';
export interface ScriptRef {
  scope: ScriptScope;
  /** Character, preset, lorebook or extension id; '' for global. */
  scopeId: string;
  scriptId: string;
}
export const scriptKey = (r: ScriptRef) => `${r.scope}:${r.scopeId}:${r.scriptId}`;

/** Script data, kept in a card's, preset's or lorebook's `extensions.everloom_scripts` so it round-trips. */
export interface ScriptBundle {
  scripts?: ScriptInput[];
  /** Permissions for HTML/JS inside this card's messages. */
  messagePermissions?: ScriptPermission[];
  quickReplies?: QuickReplySetInput[];
}

/** A stable fingerprint of what the owner approved: code, permissions and domains. */
export function scriptFingerprint(s: Pick<Script, 'code' | 'permissions' | 'domains'>): string {
  const text = `${s.code}\u0000${[...s.permissions].sort().join(',')}\u0000${[...(s.domains ?? [])].sort().join(',')}`;
  // FNV-1a 64 as two 32-bit halves: not a security hash; the grant also stores the full permission
  // list, and any change to code, permissions or domains asks again.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}${text.length.toString(16)}`;
}

// ------------------------------------------------------------------ quick replies

export const quickReplySchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  /** Text to send, or a slash command line when it starts with "/". */
  message: z.string().max(10_000),
  /** Put it in the box instead of sending it. */
  fillOnly: z.boolean().default(false),
});
export const quickReplySetSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  items: z.array(quickReplySchema).max(40).default([]),
  enabled: z.boolean().default(true),
});
export type QuickReply = z.infer<typeof quickReplySchema>;
export type QuickReplySet = z.infer<typeof quickReplySetSchema>;
export type QuickReplySetInput = z.input<typeof quickReplySetSchema>;

// ------------------------------------------------------------------ variables

export const VAR_SCOPES = ['global', 'character', 'chat', 'message'] as const;
export type VarScope = (typeof VAR_SCOPES)[number];
export type VarValue = string | number | boolean | null | VarValue[] | { [k: string]: VarValue };
export type VarMap = Record<string, VarValue>;

/**
 * Message variables live on the swipe that set them, so they follow swipes, edits and deletions
 * with no extra bookkeeping: the value at a message is everything set up to it, along the active
 * swipe of each earlier message.
 */
export function messageVarsAt(messages: Array<{ id: string; swipeId: number; swipes: Array<{ vars?: VarMap }> }>, uptoId?: string): VarMap {
  const out: VarMap = {};
  for (const m of messages) {
    const v = m.swipes[m.swipeId]?.vars;
    if (v) for (const [k, val] of Object.entries(v)) if (val === null) delete out[k];
      else out[k] = val;
    if (uptoId && m.id === uptoId) break;
  }
  return out;
}

/** Values as macros see them. */
export const varText = (v: VarValue | undefined): string => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

// ------------------------------------------------------------------ settings

export interface ScriptSettings {
  /** The kill switch: off, no script, panel or message script runs anywhere. */
  enabled: boolean;
  /** Render HTML in messages (```html blocks and the tag below) in sandboxed frames. Off shows code. */
  renderHtml: boolean;
  /** Scripts inside messages: only for characters you approved, always (no permissions unless approved), or never. */
  messageJs: 'approved' | 'always' | 'never';
  /** A custom tag whose contents render as HTML, e.g. <everloom-html>…</everloom-html>. */
  htmlTag: string;
  /** How many script frames may run at once (message frames are counted separately and lazy). */
  maxActive: number;
  /** How long one script task may run before it is stopped (ms). */
  timeBudgetMs: number;
  /** Model calls a script may make per minute. */
  generatePerMinute: number;
  /** Tavern Helper compatibility globals for message scripts. */
  compat: boolean;
}

export const defaultScriptSettings = (): ScriptSettings => ({
  enabled: true,
  renderHtml: true,
  messageJs: 'approved',
  htmlTag: 'everloom-html',
  maxActive: 6,
  timeBudgetMs: 1500,
  generatePerMinute: 6,
  compat: true,
});
