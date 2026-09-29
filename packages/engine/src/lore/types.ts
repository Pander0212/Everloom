/** World Info entry — mirrors SillyTavern's world file entry format for lossless import/export. */
export interface WIEntry {
  uid: number;
  key: string[];
  keysecondary: string[];
  comment: string;
  content: string;
  constant: boolean;
  vectorized: boolean;
  selective: boolean;
  selectiveLogic: WILogic;
  addMemo: boolean;
  order: number;
  position: WIPosition;
  disable: boolean;
  ignoreBudget: boolean;
  excludeRecursion: boolean;
  preventRecursion: boolean;
  matchPersonaDescription: boolean;
  matchCharacterDescription: boolean;
  matchCharacterPersonality: boolean;
  matchCharacterDepthPrompt: boolean;
  matchScenario: boolean;
  matchCreatorNotes: boolean;
  delayUntilRecursion: number | boolean;
  probability: number;
  useProbability: boolean;
  depth: number;
  outletName: string;
  group: string;
  groupOverride: boolean;
  groupWeight: number;
  scanDepth: number | null;
  caseSensitive: boolean | null;
  matchWholeWords: boolean | null;
  useGroupScoring: boolean | null;
  automationId: string;
  role: number;
  sticky: number | null;
  cooldown: number | null;
  delay: number | null;
  displayIndex?: number;
  triggers?: string[];
  /** Everloom: per-entry token budget (0 = none). */
  tokenBudget?: number;
  /** Anything else from the source file, preserved on export. */
  [extra: string]: unknown;
}

export enum WILogic {
  AND_ANY = 0,
  NOT_ALL = 1,
  NOT_ANY = 2,
  AND_ALL = 3,
}

export enum WIPosition {
  before = 0,
  after = 1,
  ANTop = 2,
  ANBottom = 3,
  atDepth = 4,
  EMTop = 5,
  EMBottom = 6,
  outlet = 7,
}

export interface WorldBook {
  name: string;
  entries: Record<string, WIEntry>;
  /** Original character_book data when imported from a card (kept for round-trip). */
  originalData?: unknown;
  [extra: string]: unknown;
}

export const DEFAULT_DEPTH = 4;

export function newEntry(uid: number, partial: Partial<WIEntry> = {}): WIEntry {
  return {
    uid,
    key: [],
    keysecondary: [],
    comment: '',
    content: '',
    constant: false,
    vectorized: false,
    selective: true,
    selectiveLogic: WILogic.AND_ANY,
    addMemo: false,
    order: 100,
    position: WIPosition.before,
    disable: false,
    ignoreBudget: false,
    excludeRecursion: false,
    preventRecursion: false,
    matchPersonaDescription: false,
    matchCharacterDescription: false,
    matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false,
    matchScenario: false,
    matchCreatorNotes: false,
    delayUntilRecursion: 0,
    probability: 100,
    useProbability: true,
    depth: DEFAULT_DEPTH,
    outletName: '',
    group: '',
    groupOverride: false,
    groupWeight: 100,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    role: 0,
    sticky: null,
    cooldown: null,
    delay: null,
    displayIndex: uid,
    triggers: [],
    ...partial,
  };
}

/** Coerce any loosely-shaped entry (from JSON import) to a full WIEntry. */
export function normalizeEntry(raw: any, fallbackUid: number): WIEntry {
  const toList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String).filter((s) => s.trim() !== '') : typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const uid = Number.isFinite(Number(raw?.uid)) ? Number(raw.uid) : fallbackUid;
  const base = newEntry(uid);
  const out: WIEntry = { ...base, ...(raw ?? {}) };
  out.uid = uid;
  out.key = toList(raw?.key ?? raw?.keys);
  out.keysecondary = toList(raw?.keysecondary ?? raw?.secondary_keys);
  out.content = String(raw?.content ?? '');
  out.comment = String(raw?.comment ?? '');
  out.order = Number.isFinite(Number(raw?.order)) ? Number(raw.order) : 100;
  out.position = Number.isFinite(Number(raw?.position)) ? Number(raw.position) : WIPosition.before;
  out.probability = Number.isFinite(Number(raw?.probability)) ? Number(raw.probability) : 100;
  out.depth = Number.isFinite(Number(raw?.depth)) ? Number(raw.depth) : DEFAULT_DEPTH;
  out.selectiveLogic = Number.isFinite(Number(raw?.selectiveLogic)) ? Number(raw.selectiveLogic) : 0;
  out.disable = Boolean(raw?.disable ?? (raw?.enabled === false));
  delete (out as any).keys;
  delete (out as any).secondary_keys;
  delete (out as any).enabled;
  return out;
}

export function normalizeBook(raw: any, name = 'World'): WorldBook {
  const entriesIn = raw?.entries ?? {};
  const entries: Record<string, WIEntry> = {};
  const list: any[] = Array.isArray(entriesIn) ? entriesIn : Object.values(entriesIn);
  list.forEach((e, i) => {
    const entry = normalizeEntry(e, i);
    entries[String(entry.uid)] = entry;
  });
  const out: WorldBook = { ...(raw ?? {}), name: String(raw?.name ?? name), entries };
  return out;
}
