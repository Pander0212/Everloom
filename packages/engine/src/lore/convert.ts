/** Conversions between SillyTavern world files and V2/V3 card `character_book`. */
import { DEFAULT_DEPTH, WILogic, WIPosition, newEntry, normalizeBook, type WIEntry, type WorldBook } from './types.js';

export interface CharacterBookEntry {
  id?: number;
  keys: string[];
  secondary_keys?: string[];
  comment?: string;
  content: string;
  constant?: boolean;
  selective?: boolean;
  insertion_order: number;
  enabled: boolean;
  position?: 'before_char' | 'after_char';
  use_regex?: boolean;
  priority?: number;
  name?: string;
  case_sensitive?: boolean;
  extensions: Record<string, any>;
  [extra: string]: unknown;
}

export interface CharacterBook {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions?: Record<string, any>;
  entries: CharacterBookEntry[];
  [extra: string]: unknown;
}

export function characterBookToWorld(book: CharacterBook, name?: string): WorldBook {
  const entries: Record<string, WIEntry> = {};
  (book.entries ?? []).forEach((e, index) => {
    const id = e.id ?? index;
    const x = e.extensions ?? {};
    const { id: _i, keys: _k, secondary_keys: _s, comment: _c, content: _ct, constant: _co, selective: _se, insertion_order: _o, enabled: _e, position: _p, extensions: _x, use_regex: _u, ...cbExtra } = e;
    entries[String(id)] = newEntry(id, {
      cbExtra,
      key: Array.isArray(e.keys) ? e.keys : [],
      keysecondary: e.secondary_keys ?? [],
      comment: e.comment ?? '',
      content: e.content ?? '',
      constant: e.constant ?? false,
      selective: e.selective ?? false,
      order: e.insertion_order ?? 100,
      position: x.position ?? (e.position === 'before_char' ? WIPosition.before : WIPosition.after),
      excludeRecursion: x.exclude_recursion ?? false,
      preventRecursion: x.prevent_recursion ?? false,
      delayUntilRecursion: x.delay_until_recursion ?? false,
      disable: !e.enabled,
      addMemo: !!e.comment,
      displayIndex: x.display_index ?? index,
      probability: x.probability ?? 100,
      useProbability: x.useProbability ?? true,
      depth: x.depth ?? DEFAULT_DEPTH,
      selectiveLogic: x.selectiveLogic ?? WILogic.AND_ANY,
      outletName: x.outlet_name ?? '',
      group: x.group ?? '',
      groupOverride: x.group_override ?? false,
      groupWeight: x.group_weight ?? 100,
      scanDepth: x.scan_depth ?? null,
      caseSensitive: x.case_sensitive ?? null,
      matchWholeWords: x.match_whole_words ?? null,
      useGroupScoring: x.use_group_scoring ?? null,
      automationId: x.automation_id ?? '',
      role: x.role ?? 0,
      vectorized: x.vectorized ?? false,
      sticky: x.sticky ?? null,
      cooldown: x.cooldown ?? null,
      delay: x.delay ?? null,
      matchPersonaDescription: x.match_persona_description ?? false,
      matchCharacterDescription: x.match_character_description ?? false,
      matchCharacterPersonality: x.match_character_personality ?? false,
      matchCharacterDepthPrompt: x.match_character_depth_prompt ?? false,
      matchScenario: x.match_scenario ?? false,
      matchCreatorNotes: x.match_creator_notes ?? false,
      triggers: x.triggers ?? [],
      ignoreBudget: x.ignore_budget ?? false,
      extensions: x,
    });
  });
  return { name: name ?? book.name ?? 'Character Book', entries, originalData: book };
}

export function worldToCharacterBook(world: WorldBook): CharacterBook {
  const entries: CharacterBookEntry[] = Object.values(world.entries).map((entry) => ({
    ...((entry.cbExtra as object) ?? {}),
    id: entry.uid,
    keys: entry.key,
    secondary_keys: entry.keysecondary,
    comment: entry.comment,
    content: entry.content,
    constant: entry.constant,
    selective: entry.selective,
    insertion_order: entry.order,
    enabled: !entry.disable,
    position: entry.position === WIPosition.before ? 'before_char' : 'after_char',
    use_regex: true,
    extensions: {
      ...((entry.extensions as object) ?? {}),
      position: entry.position,
      exclude_recursion: entry.excludeRecursion,
      display_index: entry.displayIndex,
      probability: entry.probability ?? null,
      useProbability: entry.useProbability ?? false,
      depth: entry.depth ?? DEFAULT_DEPTH,
      selectiveLogic: entry.selectiveLogic ?? 0,
      outlet_name: entry.outletName ?? '',
      group: entry.group ?? '',
      group_override: entry.groupOverride ?? false,
      group_weight: entry.groupWeight ?? null,
      prevent_recursion: entry.preventRecursion ?? false,
      delay_until_recursion: entry.delayUntilRecursion ?? false,
      scan_depth: entry.scanDepth ?? null,
      match_whole_words: entry.matchWholeWords ?? null,
      use_group_scoring: entry.useGroupScoring ?? false,
      case_sensitive: entry.caseSensitive ?? null,
      automation_id: entry.automationId ?? '',
      role: entry.role ?? 0,
      vectorized: entry.vectorized ?? false,
      sticky: entry.sticky ?? null,
      cooldown: entry.cooldown ?? null,
      delay: entry.delay ?? null,
      match_persona_description: entry.matchPersonaDescription ?? false,
      match_character_description: entry.matchCharacterDescription ?? false,
      match_character_personality: entry.matchCharacterPersonality ?? false,
      match_character_depth_prompt: entry.matchCharacterDepthPrompt ?? false,
      match_scenario: entry.matchScenario ?? false,
      match_creator_notes: entry.matchCreatorNotes ?? false,
      triggers: entry.triggers ?? [],
      ignore_budget: entry.ignoreBudget ?? false,
    },
  }));
  const original = (world.originalData ?? {}) as Partial<CharacterBook>;
  return { ...original, name: world.name, entries };
}

/** Export in SillyTavern world file shape: { entries: { [uid]: entry } }. */
export function worldToSillyTavern(world: WorldBook): Record<string, unknown> {
  const { name: _n, originalData, entries, ...rest } = world;
  const out: Record<string, unknown> = { ...rest, entries };
  if (originalData) out.originalData = originalData;
  return out;
}

export function worldFromSillyTavern(raw: unknown, name: string): WorldBook {
  const r = raw as any;
  // A bare character_book (entries array with `keys`) also appears in the wild.
  if (Array.isArray(r?.entries) && r.entries.some((e: any) => Array.isArray(e?.keys))) {
    return characterBookToWorld(r as CharacterBook, name);
  }
  return normalizeBook(r, name);
}
