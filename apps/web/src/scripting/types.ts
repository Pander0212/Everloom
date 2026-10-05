/** Shapes the scripting endpoints return (mirrors apps/server/src/services/scripts.ts). */
import type { QuickReplySet, RegexScript, Script, ScriptPermission, ScriptRef, ScriptSettings } from '@everloom/engine';

export type ReviewTarget = { kind: 'character' | 'preset' | 'lorebook'; id: string };

export interface ReviewItem {
  key: string;
  type: 'script' | 'regex' | 'messages';
  name: string;
  description: string;
  code: string;
  permissions: ScriptPermission[];
  domains: string[];
  fingerprint: string;
  granted: boolean;
  changed: boolean;
  once?: boolean;
  compat?: boolean;
  triggers?: string[];
}

export interface Review {
  name: string;
  creator: string;
  source: string;
  items: ReviewItem[];
  trusted: boolean;
}

export interface ActiveScript {
  key: string;
  ref: ScriptRef;
  script: Script;
  fingerprint: string;
  granted: boolean;
  origin: string;
}

export interface ActiveSet {
  settings: ScriptSettings;
  scripts: ActiveScript[];
  regex: RegexScript[];
  quickReplies: Array<{ scope: 'global' | 'chat' | 'character'; set: QuickReplySet }>;
  messages: Record<string, { key: string; granted: boolean; permissions: ScriptPermission[] }>;
  pending: Array<{ target: ReviewTarget; name: string }>;
}

export interface ExtensionUi {
  id: string;
  key: string;
  name: string;
  version: string;
  permissions: ScriptPermission[];
  dev: boolean;
  updatedAt: number;
  background: string | null;
  panels: Array<{ id: string; title: string; file: string; icon?: string; tile: boolean }>;
  screens: Array<{ id: string; title: string; file: string; icon?: string }>;
  settings: string | null;
  composerButtons: Array<{ id: string; label: string; icon?: string }>;
  slashCommands: Array<{ name: string; help: string; usage?: string }>;
  messageRenderers: Array<{ tag: string; file: string }>;
  macros: string[];
}
