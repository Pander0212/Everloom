/** Builds the full prompt for a chat turn. Shared by generation and the prompt inspector. */
import {
  assemblePrompt, buildGameStateBlock, checkWorldInfo, createRng, formatClock, formatDate, INLINE_INSTRUCTION, seedFrom,
  stripInlineTags, type AssembledPrompt, type CampaignState, type ChatDTO, type CharacterDTO, type HistoryMessage, type MacroContext,
  type MessageDTO, type PersonaDTO, type ScanEntry, type Settings,
} from '@everloom/engine';
import type { AppContext } from '../context.js';
import { characterRow, getCharacter } from './characters.js';
import { getChat, getGroup, listMessages } from './chats.js';
import { getState } from './campaigns.js';
import { booksForChat } from './lorebooks.js';
import { defaultPersona, getPersona } from './personas.js';
import { activePreset } from './presets.js';
import { search } from './search.js';
import { getSettings } from './settings.js';
import { countTokens } from './tokens.js';
import { semanticHits } from './semantic.js';

export type GenType = 'normal' | 'swipe' | 'regenerate' | 'continue' | 'impersonate' | 'quiet';

export interface PromptContext {
  chat: ChatDTO;
  character: CharacterDTO;
  members: CharacterDTO[];
  persona: PersonaDTO | null;
  userName: string;
  settings: Settings;
  state: CampaignState | null;
  history: MessageDTO[];
}

export function macroGame(state: CampaignState | null): MacroContext['game'] {
  if (!state) return undefined;
  const cal = state.meta.calendar;
  const loc = state.currentLocationId ? state.locations[state.currentLocationId] : undefined;
  return {
    location: loc?.name ?? '',
    time: formatClock(state.time.minutes, cal),
    date: formatDate(state.time.minutes, cal),
    weather: state.weather.kind,
    bars: Object.fromEntries(Object.values(state.player.bars).map((b) => [b.id, { cur: Math.round(b.cur), max: b.max }])),
    trackers: Object.fromEntries(Object.values(state.trackers).map((t) => [t.id, { value: t.value, max: t.max, label: t.label }])),
    currency: `${state.player.currency} ${state.meta.currency.name}`,
    level: state.player.level,
  };
}

export function loadPromptContext(ctx: AppContext, owner: string, chatId: string, speakerId?: string | null): PromptContext {
  const chat = getChat(ctx, owner, chatId);
  const settings = getSettings(ctx, owner);
  const members = chat.groupId ? getGroup(ctx, owner, chat.groupId).members.map((m) => getCharacter(ctx, owner, m.characterId)) : [getCharacter(ctx, owner, chat.characterId!)];
  const character = (speakerId && members.find((m) => m.id === speakerId)) || members[0];
  const persona = chat.personaId ? safePersona(ctx, owner, chat.personaId) : defaultPersona(ctx, owner);
  const state = chat.campaignId ? safeState(ctx, owner, chat.campaignId) : null;
  return {
    chat,
    character,
    members,
    persona,
    userName: persona?.name ?? 'You',
    settings,
    state,
    history: listMessages(ctx, owner, chatId),
  };
}

function safePersona(ctx: AppContext, owner: string, id: string) {
  try {
    return getPersona(ctx, owner, id);
  } catch {
    return defaultPersona(ctx, owner);
  }
}

function safeState(ctx: AppContext, owner: string, id: string) {
  try {
    return getState(ctx, owner, id);
  } catch {
    return null;
  }
}

export interface BuildOptions {
  type: GenType;
  /** Messages to include as history (already excluding the one being generated). */
  history: MessageDTO[];
  maxContext: number;
  maxResponse: number;
  finalInstruction?: string;
  presetId?: string | null;
}

export interface BuiltPrompt {
  assembled: AssembledPrompt;
  macros: MacroContext;
  wiActivated: Array<{ world: string; uid: number; comment: string }>;
  wiTimed: { sticky: Record<string, number>; cooldown: Record<string, number> };
}

export async function buildPrompt(ctx: AppContext, owner: string, pc: PromptContext, opts: BuildOptions): Promise<BuiltPrompt> {
  const { chat, character, persona, settings, state } = pc;
  const card = character.card;
  const isGroup = !!chat.groupId;
  const others = pc.members.filter((m) => m.id !== character.id).map((m) => m.name);
  const lastUser = [...opts.history].reverse().find((m) => m.role === 'user');
  const lastChar = [...opts.history].reverse().find((m) => m.role === 'assistant');
  const textOf = (m: MessageDTO) => m.swipes[m.swipeId]?.text ?? '';
  const macros: MacroContext = {
    user: pc.userName,
    char: character.name,
    group: isGroup ? pc.members.map((m) => m.name).join(', ') : character.name,
    groupNotMuted: isGroup ? pc.members.map((m) => m.name).join(', ') : character.name,
    notChar: [pc.userName, ...others].join(', '),
    persona: persona?.description ?? '',
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    mesExamples: card.mes_example,
    charPrompt: card.system_prompt,
    charJailbreak: card.post_history_instructions,
    charVersion: card.character_version,
    creatorNotes: card.creator_notes,
    charDepthPrompt: card.extensions?.depth_prompt?.prompt ?? '',
    lastMessage: opts.history.length ? textOf(opts.history[opts.history.length - 1]) : '',
    lastMessageId: opts.history.length ? opts.history.length - 1 : undefined,
    lastUserMessage: lastUser ? textOf(lastUser) : '',
    lastCharMessage: lastChar ? textOf(lastChar) : '',
    vars: { ...(chat.metadata.vars ?? {}) },
    game: macroGame(state),
    pickSeed: chat.id,
    rng: createRng(seedFrom(chat.id, opts.history.length, Date.now())),
    maxPrompt: opts.maxContext,
  };

  // World info scan
  const books = booksForChat(ctx, owner, chat.id, pc.members.map((m) => m.id));
  const entries: ScanEntry[] = books.flatMap((b) => Object.values(b.book.entries).map((e) => ({ ...e, world: b.id })));
  const visible = opts.history.filter((m) => !m.hidden);
  const scanText = visible
    .slice()
    .reverse()
    .map((m) => (settings.wi.includeNames ? `${m.name}: ${textOf(m)}` : textOf(m)));
  if (settings.wi.semantic && entries.length) {
    try {
      const hits = await semanticHits(ctx, owner, books, scanText.slice(0, 3).join('\n'), settings.wi.semanticTopK, settings.wi.semanticThreshold);
      for (const e of entries) if (hits.has(`${e.world}.${e.uid}`)) e.semanticHit = true;
    } catch {
      /* semantic retrieval is optional; keywords still work */
    }
  }
  const wi = checkWorldInfo({
    entries,
    messagesNewestFirst: scanText,
    chatLength: visible.length,
    maxContext: opts.maxContext,
    settings: settings.wi,
    global: {
      personaDescription: persona?.description,
      characterDescription: card.description,
      characterPersonality: card.personality,
      characterDepthPrompt: card.extensions?.depth_prompt?.prompt,
      scenario: card.scenario,
      creatorNotes: card.creator_notes,
      trigger: opts.type === 'swipe' || opts.type === 'regenerate' ? opts.type : opts.type === 'quiet' ? 'quiet' : opts.type,
    },
    timed: chat.metadata.wiTimed,
    countTokens,
    substitute: (s) => s.replace(/\{\{char\}\}/gi, character.name).replace(/\{\{user\}\}/gi, pc.userName),
  });

  // Memory: rolling summary + pinned long-term facts for this character.
  const memParts: string[] = [];
  if (chat.metadata.memory?.text) memParts.push(chat.metadata.memory.text);
  const facts = ctx.db
    .prepare("SELECT text FROM memories WHERE owner_id = ? AND kind = 'fact' AND (chat_id = ? OR (character_id = ? AND pinned = 1)) ORDER BY pinned DESC, updated_at DESC LIMIT 12")
    .all(owner, chat.id, character.id) as Array<{ text: string }>;
  if (facts.length) memParts.push(`Long-term memories:\n${facts.map((f) => `- ${f.text}`).join('\n')}`);
  const memory = memParts.length ? `[Story so far]\n${memParts.join('\n\n')}` : '';

  // Game state block
  let gameState = '';
  if (state && settings.tracker.injectState) {
    const recent = visible.slice(-3).map(textOf).join('\n');
    const relevant = search(ctx, owner, recent, { campaignId: chat.campaignId, kinds: ['fact', 'runin', 'diary', 'memory'], limit: 6 }).map((h) => (h.title ? `${h.title}: ${h.body}` : h.body));
    gameState = buildGameStateBlock(state, { budgetTokens: settings.tracker.injectBudget, relevantFacts: relevant, countTokens, recentText: recent });
  }

  const extraRules: string[] = [];
  if (character.game.chatRules?.trim()) extraRules.push(character.game.chatRules.trim());
  if (state && settings.tracker.mode === 'inline' && opts.type !== 'impersonate') extraRules.push(INLINE_INSTRUCTION);
  if (opts.finalInstruction) extraRules.push(opts.finalInstruction);

  const history: HistoryMessage[] = visible.map((m) => ({
    id: m.id,
    role: m.role === 'user' ? 'user' : m.role === 'system' ? 'system' : 'assistant',
    name: m.name,
    content: stripInlineTags(textOf(m)),
  }));

  const dp = card.extensions?.depth_prompt;
  const assembled = assemblePrompt({
    preset: activePreset(ctx, owner, opts.presetId ?? chat.metadata.presetId),
    macros,
    character: {
      name: character.name,
      description: card.description,
      personality: card.personality,
      scenario: card.scenario,
      mesExample: card.mes_example,
      systemPrompt: card.system_prompt,
      postHistoryInstructions: card.post_history_instructions,
      depthPrompt: dp?.prompt ? { prompt: dp.prompt, depth: Number(dp.depth ?? 4), role: dp.role ?? 'system' } : undefined,
    },
    personaDescription: persona?.description ?? '',
    worldInfo: {
      before: wi.before,
      after: wi.after,
      depth: wi.depth.map((d) => ({ depth: d.depth, role: d.role === 1 ? 'user' : d.role === 2 ? 'assistant' : 'system', content: d.entries.join('\n'), source: 'World info (depth)' })),
      anTop: wi.anTop,
      anBottom: wi.anBottom,
      emTop: wi.emTop,
      emBottom: wi.emBottom,
    },
    authorsNote: chat.metadata.authorsNote,
    memory,
    gameState,
    history,
    isGroup,
    type: opts.type === 'swipe' || opts.type === 'regenerate' || opts.type === 'quiet' ? 'normal' : opts.type,
    finalInstruction: extraRules.join('\n\n') || undefined,
    maxContext: opts.maxContext,
    maxResponse: opts.maxResponse,
    countTokens,
  });
  void characterRow;
  return {
    assembled,
    macros,
    wiActivated: wi.activated.map((e) => ({ world: e.world, uid: e.uid, comment: e.comment || e.key.join(', ') })),
    wiTimed: wi.timed,
  };
}
