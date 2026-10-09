/**
 * Scenarios: a reusable starting point for a story (docs/ux/hakawati.md). Every story started from
 * one gets its own copy of what it needs (the opening, the note, the cards, the game setup), so
 * editing a scenario never rewrites a story. Shared as JSON (clipboard or file).
 */
import type { FeaturePreset } from './features.js';
import type { NewGameConfig } from './game/newgame.js';

export interface ScenarioCard {
  type: 'character' | 'place' | 'thing' | 'concept';
  title: string;
  keys: string[];
  content: string;
  pinned?: boolean;
}

export interface ScenarioData {
  title: string;
  /** One line for the list. */
  summary: string;
  /** A small picture (data URL or media URL); optional. */
  cover: string | null;
  /** The character the story is with; null: picked when starting. */
  characterId: string | null;
  /** The first message of the story (may ask ${questions}). */
  opening: string;
  /** How the narrator should run this story (added to its instructions). */
  instructions: string;
  /** Where the story is meant to go (the narrator's eyes only). */
  plot: string;
  /** The note to the AI the story starts with. */
  note: string;
  /** The mode the story starts in. */
  mode: FeaturePreset | null;
  /** Starting stats, money, inventory, place… (Story and Full RPG). */
  game: Partial<NewGameConfig> | null;
  cards: ScenarioCard[];
}

export interface ScenarioDTO extends ScenarioData {
  id: string;
  createdAt: number;
  updatedAt: number;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const TYPES = ['character', 'place', 'thing', 'concept'] as const;

/** A clean scenario from anything (an import, an older export); throws if it has no title. */
export function normalizeScenario(raw: unknown): ScenarioData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const src = (r.everloomScenario && typeof r.everloomScenario === 'object' ? r.everloomScenario : r) as Record<string, unknown>;
  const title = str(src.title, 120).trim();
  if (!title) throw new Error('A scenario needs a title');
  const cards = Array.isArray(src.cards) ? src.cards : [];
  return {
    title,
    summary: str(src.summary, 300),
    cover: typeof src.cover === 'string' && src.cover.length < 400_000 && /^(data:image\/(png|jpeg|webp);base64,|\/api\/media\/)/.test(src.cover) ? src.cover : null,
    characterId: typeof src.characterId === 'string' ? src.characterId : null,
    opening: str(src.opening, 20_000),
    instructions: str(src.instructions, 8000),
    plot: str(src.plot, 8000),
    note: str(src.note, 4000),
    mode: src.mode === 'classic' || src.mode === 'story' || src.mode === 'full' ? src.mode : null,
    game: src.game && typeof src.game === 'object' ? (src.game as Partial<NewGameConfig>) : null,
    cards: cards.slice(0, 200).flatMap((c) => {
      const x = (c ?? {}) as Record<string, unknown>;
      const t = str(x.title, 120).trim();
      const content = str(x.content, 4000).trim();
      if (!t || !content) return [];
      return [{ type: TYPES.includes(x.type as never) ? (x.type as ScenarioCard['type']) : 'concept', title: t, keys: (Array.isArray(x.keys) ? x.keys : []).map((k) => str(k, 60).trim()).filter(Boolean).slice(0, 12), content, pinned: !!x.pinned }];
    }),
  };
}

/** The JSON a scenario is shared as. */
export function exportScenario(s: ScenarioData): string {
  const { characterId: _drop, ...rest } = s;
  return JSON.stringify({ everloomScenario: { version: 1, ...rest } }, null, 2);
}
