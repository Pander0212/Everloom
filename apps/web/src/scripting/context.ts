/** What message rendering needs to know about scripts in this chat (provided by the story view). */
import type { ScriptSettings } from '@everloom/engine';
import { createContext, useContext } from 'react';
import type { ActiveSet, ReviewTarget } from './types';

export interface ScriptView {
  settings: ScriptSettings | null;
  active: ActiveSet | null;
  safe: boolean;
  chatId: string;
  /** The chat's character, for messages without one (user and narrator messages). */
  characterId: string | null;
  review: (t: ReviewTarget) => void;
  /** Extension message renderers by tag. */
  renderers: Array<{ ext: string; key: string; tag: string; file: string; permissions: string[]; updatedAt: number }>;
}

export const ScriptViewContext = createContext<ScriptView | null>(null);
export const useScriptView = () => useContext(ScriptViewContext);
