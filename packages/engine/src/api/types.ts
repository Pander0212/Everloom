import type { ScriptSettings, VarMap } from '../scripting/types.js';
import type { FeaturePreset, FeatureSettings } from '../features.js';
import type { ShieldSettings } from '../privacy/shield.js';
/** API data shapes shared by server and web. */
import type { CardData } from '../cards/card.js';
import type { WorldBook } from '../lore/types.js';
import type { WISettings } from '../lore/activate.js';
import type { PromptPreset } from '../prompt/assemble.js';
import type { CampaignState } from '../game/state.js';

export type ProviderId =
  | 'openai' | 'anthropic' | 'gemini' | 'textgen'
  | 'tts-openai' | 'tts-elevenlabs'
  | 'img-openai' | 'img-openrouter' | 'img-pollinations' | 'img-comfyui' | 'img-a1111'
  | '3d-meshy' | '3d-fal'
  | 'layers-seethrough';

export interface ConnectionDTO {
  id: string;
  name: string;
  provider: ProviderId;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  params: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export interface MediaRef {
  id: string;
  url: string;
}

export interface CharacterGame {
  /** Recorded age, also checked before linking an adult 3D avatar. */
  age?: number | null;
  /** emotion -> media id */
  expressions?: Record<string, string>;
  /** A preset voice, or one of the owner's reference voices (kept separate, with consent on file). */
  voice?: { provider?: string; voice?: string; speed?: number; pitch?: number; kind?: 'preset' | 'custom'; reference?: string };
  drives?: string;
  orgs?: string[];
  chatRules?: string;
  connectionId?: string | null;
  gallery?: string[];
  /** The feature preset new chats with this character use (unset: ask, or follow the global setting). */
  chatMode?: FeaturePreset | null;
  /** A 3D avatar (its id) shown on the stage when 3D characters are on. */
  avatar3d?: string;
  /** How this character appears on the stage: 3D, Live2D, sprites, or the richest available. */
  display?: 'auto' | '3d' | 'live2d' | 'sprite';
}

export interface CharacterSummary {
  adult?: boolean;
  id: string;
  name: string;
  avatar: string | null;
  tags: string[];
  fav: boolean;
  description: string;
  createdAt: number;
  updatedAt: number;
  lastChatAt: number | null;
  chatCount: number;
  /** A local nickname; the card keeps its own name. */
  displayName: string | null;
  creator: string;
  /** Permanent prompt tokens (description, personality, scenario, first message, examples…). */
  tokens: number;
  hash: string;
  version: string;
  hasLorebook: boolean;
  hasGallery: boolean;
  hasGreetings: boolean;
  /** Online source link, e.g. "chub:author/slug". */
  linked: string | null;
  /** The linked character's page at its source. */
  linkedUrl?: string | null;
  collections: string[];
  /** The mode new chats with this character start in (unset: ask). */
  chatMode?: FeaturePreset | null;
  /** The 3D avatar this character uses, if any. */
  avatar3d?: string | null;
}

export interface CharacterDTO extends CharacterSummary {
  card: CardData;
  game: CharacterGame;
}

export interface LineageMember {
  id: string;
  name: string;
  relation: string;
  characterId?: string | null;
  npcId?: string | null;
  parentOf?: string[];
  notes?: string;
}

export interface PersonaDTO {
  id: string;
  name: string;
  avatar: string | null;
  description: string;
  title: string;
  age: number | null;
  ageStage: string;
  phone: string;
  isDefault: boolean;
  data: {
    lineage?: LineageMember[];
    expressions?: Record<string, string>;
    engine?: { resourceProfile?: 'hybrid' | 'ap' | 'mp'; className?: string; startingLevel?: number };
    lockedToCharacters?: string[];
  };
  createdAt: number;
  updatedAt: number;
}

export interface LorebookDTO {
  id: string;
  name: string;
  scope: 'global' | 'character' | 'chat';
  scopeId: string | null;
  enabled: boolean;
  book: WorldBook;
  entryCount: number;
  updatedAt: number;
}

export interface PresetDTO {
  id: string;
  name: string;
  kind: 'prompt';
  preset: PromptPreset;
  updatedAt: number;
}

export interface SwipeDTO {
  text: string;
  reasoning?: string;
  createdAt: number;
  model?: string;
  tokens?: number;
  /** Game-state change summary produced for this swipe. */
  changes?: string[];
  /** Message variables set on this swipe (by scripts); they follow swipes and edits. */
  vars?: VarMap;
}

export interface MessageDTO {
  id: string;
  chatId: string;
  seq: number;
  role: 'user' | 'assistant' | 'system';
  name: string;
  characterId: string | null;
  swipeId: number;
  swipes: SwipeDTO[];
  hidden: boolean;
  bookmarked: boolean;
  extra: { emotion?: string; image?: string; [k: string]: unknown };
  createdAt: number;
  updatedAt: number;
}

export interface ChatMeta {
  authorsNote?: { content: string; depth: number; role: 'system' | 'user' | 'assistant' };
  memory?: { text: string; pinned: boolean; uptoSeq: number };
  vars?: Record<string, string | number>;
  wiTimed?: { sticky: Record<string, number>; cooldown: Record<string, number> };
  mode?: 'chat' | 'stage';
  background?: string | null;
  presetId?: string | null;
  connectionId?: string | null;
  lastPrompt?: unknown;
  /** This chat's own feature preset (Classic, Story, Full RPG); unset follows Settings › Features. */
  features?: FeaturePreset | null;
  /** This world's own theme (a look id); unset uses the player's. */
  look?: string | null;
  [k: string]: unknown;
}

export interface ChatSummary {
  id: string;
  title: string;
  characterId: string | null;
  groupId: string | null;
  personaId: string | null;
  campaignId: string | null;
  parentChatId: string | null;
  messageCount: number;
  lastMessage: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatDTO extends ChatSummary {
  metadata: ChatMeta;
}

export interface GroupMember {
  characterId: string;
  muted: boolean;
}

export interface GroupDTO {
  id: string;
  name: string;
  avatar: string | null;
  members: GroupMember[];
  strategy: 'natural' | 'list' | 'manual';
  createdAt: number;
  updatedAt: number;
}

export interface CampaignDTO {
  id: string;
  name: string;
  state: CampaignState;
  updatedAt: number;
}

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  motion: 'full' | 'reduced';
  textSize: 'small' | 'medium' | 'large' | 'xlarge';
  /** Accent palette. */
  palette: 'amber' | 'dusk' | 'sea' | 'rose';
  /** Tint the story view to match the campaign's genre. */
  genreTheme: boolean;
  /** Music and ambience (off until the owner turns them on). */
  audio: {
    music: boolean;
    ambient: boolean;
    musicVolume: number;
    ambientVolume: number;
    crossfadeMs: number;
    /**
     * Music by context. A playlist plays when the scene asks for it by name or mood; otherwise one
     * tagged "battle" plays during battles, then one that fits the place (a location kind or
     * name) and the time of day.
     */
    playlists: Array<{ id: string; name: string; mood: string; tracks: string[]; place?: string; time?: 'day' | 'night' }>;
    /** Owner's own loops per ambience kind (media ids); others are synthesized. */
    ambientFiles: Record<string, string>;
  };
  /** Stage extras: speech bubbles, and Live2D (off by default; needs the owner's own Cubism Core). */
  stage: { bubbles: boolean; live2d: boolean; /** Scene effects the owner turned off. */ fxOff?: string[] };
  roles: { main: string | null; utility: string | null; background: string | null; embeddings: string | null; tts: string | null; image: string | null; model3d?: string | null; layering?: string | null };
  activePresetId: string | null;
  defaultPersonaId: string | null;
  tracker: { mode: 'off' | 'inline' | 'separate'; injectBudget: number; injectState: boolean };
  hud: { pinned: string[] };
  wi: WISettings & { semantic: boolean; semanticTopK: number; semanticThreshold: number };
  memory: { auto: boolean; every: number; maxWords: number };
  chat: { enterToSend: boolean; showReasoning: boolean; autoTts: boolean; defaultMode: 'chat' | 'stage'; stt: boolean; /** Dictation by the browser, or recorded and sent to the voice connection. */ sttEngine?: 'browser' | 'connection' };
  tts: { provider: 'browser' | 'connection'; narratorVoice: string; rate: number; pitch: number };
  images: { autoBackground: boolean; style: string };
  backups: { nightly: boolean; retention: number; hour: number };
  helper: { visible: boolean; name: string };
  atmosphere: { enabled: boolean; particles: boolean };
  /** Everloom's bundled illustrations (item icons, genre cards, empty states, the helper). Off shows the line icons. */
  art: { enabled: boolean };
  world: WorldSettings;
  library: LibrarySettings;
  css: { snippets: CssSnippet[] };
  /** Character studio: your own system prompts, and which preset and connection it starts with. */
  studio: { presets: Array<{ id: string; name: string; system: string }>; preset: string; connection: string | null };
  /** Which modules are on (Settings › Features). */
  features: FeatureSettings;
  /**
   * Interface choices (docs/ux/navigation.md): pinned palette entries and composer quick actions
   * (null = the defaults for the preset), tours already seen, the Simple/Advanced settings view and
   * whether experimental entries show.
   */
  ui: { pins: string[] | null; quick: string[] | null; tours: string[]; advanced: boolean; experimental: boolean };
  /**
   * The theme (apps/web/src/themes/looks.ts) and reading settings. A device can override the theme
   * and the scenery; a chat can have its own theme (`ChatMeta.look`).
   */
  look: {
    id: string;
    scenery: 'animated' | 'still' | 'off';
    /** Line height, story column width (px), space between paragraphs (em), font ids (null = the theme's). */
    reading: { leading: number; width: number; paragraph: number; storyFont: string | null; uiFont: string | null };
  };
  /** Settings › Privacy. */
  privacy: { shield: ShieldSettings };
  /** Settings › Scripts. */
  scripts: ScriptSettings;
}

export interface CssSnippet {
  id: string;
  name: string;
  css: string;
  enabled: boolean;
}

export interface FilterPreset {
  id: string;
  name: string;
  query: string;
  tagStates: Record<string, 'include' | 'exclude'>;
  sort: 'name' | 'modified' | 'created' | 'tokens' | 'recent' | 'random';
  desc: boolean;
  /** Which screen it belongs to. */
  scope: 'characters' | 'chats';
}

export interface LibrarySettings {
  view: 'grid' | 'list';
  presets: FilterPreset[];
  /** Applied every time the library opens. */
  defaultPreset: string | null;
  /** Automatic snapshots kept per character (manual ones are kept until deleted). */
  versionRetention: number;
  /** Show the Info tab (ids, raw data). */
  debug: boolean;
  /** Prev/next through the filtered list in the detail sheet. */
  prevNext: boolean;
  /** Card info on hover / long-press. */
  cardInfo: boolean;
  /** Online sources: show adult content. Off by default. */
  nsfw: boolean;
  /** One-time owner confirmation shared by sources and the 3D editor. */
  adultConfirmed?: boolean;
}

export type WorldProfile = 'cheap' | 'balanced' | 'max' | 'custom';

/** World engine switches. Every one that costs a model call can be turned off. */
export interface WorldSettings {
  profile: WorldProfile;
  /** Record memories and facts in the tracker pass (same call, no extra cost). */
  memory: boolean;
  /** Embedding similarity in recall (needs an embeddings connection; one small call per turn). */
  semantic: boolean;
  /** Player memories recalled per scene. */
  recallLimit: number;
  /** Token budget for the scene block. */
  sceneBudget: number;
  /** Off-screen gossip between people standing together (no model call). */
  hearsay: boolean;
  /** Read the chat in batches for memories the turn-by-turn pass missed (background call). */
  chronicler: boolean;
  chronicleEvery: number;
  /** Fold finished scenes into one memory and days into summaries (background call; plain text fallback when off). */
  consolidate: boolean;
  consolidateEvery: number;
  /** What off-screen people do to each other (background call). */
  social: boolean;
  socialEvery: number;
  /** A model read of the player's message before the reply (movement, time, dice). Adds latency. */
  preRead: boolean;
  /** Understand "I go to the market" before the reply (no model call). */
  intent: boolean;
  /** Random events with a pity timer (no model call). */
  pulse: boolean;
  /** Off-screen storylines (heartbeats are free; seeding new ones is a background call). */
  threads: boolean;
  threadSeeding: boolean;
  /** Skill checks with real odds (no model call unless the pre-read proposes them). */
  dice: boolean;
}

export const WORLD_PROFILES: Record<Exclude<WorldProfile, 'custom'>, Omit<WorldSettings, 'profile' | 'recallLimit' | 'sceneBudget'>> = {
  cheap: { memory: true, semantic: false, hearsay: true, chronicler: true, chronicleEvery: 30, consolidate: false, consolidateEvery: 4, social: false, socialEvery: 4, preRead: false, intent: true, pulse: true, threads: true, threadSeeding: false, dice: true },
  balanced: { memory: true, semantic: true, hearsay: true, chronicler: true, chronicleEvery: 20, consolidate: true, consolidateEvery: 3, social: true, socialEvery: 3, preRead: false, intent: true, pulse: true, threads: true, threadSeeding: true, dice: true },
  max: { memory: true, semantic: true, hearsay: true, chronicler: true, chronicleEvery: 10, consolidate: true, consolidateEvery: 2, social: true, socialEvery: 1, preRead: true, intent: true, pulse: true, threads: true, threadSeeding: true, dice: true },
};

export interface GenerateEvent {
  type: 'start' | 'delta' | 'reasoning' | 'done' | 'error' | 'user';
  messageId?: string;
  swipeId?: number;
  text?: string;
  message?: MessageDTO;
  error?: string;
  /** Why it failed, when known (e.g. shield_leak). */
  code?: string;
}

export interface StateEvent {
  campaignId: string;
  state: CampaignState;
  changes?: string[];
  source?: string;
}
