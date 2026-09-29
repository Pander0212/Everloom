/** API data shapes shared by server and web. */
import type { CardData } from '../cards/card.js';
import type { WorldBook } from '../lore/types.js';
import type { WISettings } from '../lore/activate.js';
import type { PromptPreset } from '../prompt/assemble.js';
import type { CampaignState } from '../game/state.js';

export type ProviderId =
  | 'openai' | 'anthropic' | 'gemini' | 'textgen'
  | 'tts-openai' | 'tts-elevenlabs'
  | 'img-openai' | 'img-openrouter' | 'img-pollinations' | 'img-comfyui' | 'img-a1111';

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
  /** emotion -> media id */
  expressions?: Record<string, string>;
  voice?: { provider?: string; voice?: string; speed?: number; pitch?: number };
  drives?: string;
  orgs?: string[];
  chatRules?: string;
  connectionId?: string | null;
  gallery?: string[];
}

export interface CharacterSummary {
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
  textSize: 'small' | 'medium' | 'large';
  roles: { main: string | null; utility: string | null; embeddings: string | null; tts: string | null; image: string | null };
  activePresetId: string | null;
  defaultPersonaId: string | null;
  tracker: { mode: 'off' | 'inline' | 'separate'; injectBudget: number; injectState: boolean };
  hud: { pinned: string[] };
  wi: WISettings & { semantic: boolean; semanticTopK: number; semanticThreshold: number };
  memory: { auto: boolean; every: number; maxWords: number };
  chat: { enterToSend: boolean; showReasoning: boolean; autoTts: boolean; defaultMode: 'chat' | 'stage'; stt: boolean };
  tts: { provider: 'browser' | 'connection'; narratorVoice: string; rate: number; pitch: number };
  images: { autoBackground: boolean; style: string };
  backups: { nightly: boolean; retention: number; hour: number };
  helper: { visible: boolean; name: string };
  atmosphere: { enabled: boolean; particles: boolean };
}

export interface GenerateEvent {
  type: 'start' | 'delta' | 'reasoning' | 'done' | 'error' | 'user';
  messageId?: string;
  swipeId?: number;
  text?: string;
  message?: MessageDTO;
  error?: string;
}

export interface StateEvent {
  campaignId: string;
  state: CampaignState;
  changes?: string[];
  source?: string;
}
