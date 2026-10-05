/** Builds the full prompt for a chat turn. Shared by generation and the prompt inspector. */
import {
  AI_OP_TYPES, allowedOpTypes, assemblePrompt, PLAYER, buildSceneBlock, checkWorldInfo, createRng, formatClock, formatDate, inlineInstruction, seedFrom, storySoFar,
  type PersonMemoryView, type SceneBlock,
  stripInlineTags, type AssembledPrompt, type CampaignState, type ChatDTO, type CharacterDTO, type HistoryMessage, type MacroContext,
  type MessageDTO, type PersonaDTO, type ScanEntry, type Settings, type FeatureSet,
  applyRegexScripts, expandMacros, messageVarsAt, RegexPlacement, type VarMap,
} from '@everloom/engine';
import { settingsFor } from './features.js';
import type { AppContext } from '../context.js';
import { characterRow, getCharacter } from './characters.js';
import { getChat, getGroup, listMessages } from './chats.js';
import { getState } from './campaigns.js';
import { booksForChat } from './lorebooks.js';
import { defaultPersona, getPersona } from './personas.js';
import { activePreset } from './presets.js';
import { extensionPromptBlocks } from './extensions.js';
import { getVars, regexForChat } from './scripts.js';
import { search } from './search.js';
import { countTokens } from './tokens.js';
import { semanticHits } from './semantic.js';
import { nameOfPerson, recallForScene } from './mem.js';

export type GenType = 'normal' | 'swipe' | 'regenerate' | 'continue' | 'impersonate' | 'quiet';

export interface PromptContext {
  chat: ChatDTO;
  character: CharacterDTO;
  members: CharacterDTO[];
  persona: PersonaDTO | null;
  userName: string;
  /** Settings with the world switches limited by the chat's features. */
  settings: Settings;
  /** The feature switches in force for this chat. */
  features: FeatureSet;
  /** The game state, or null when the chat has no game or the game layer is off. */
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
  const { settings, features } = settingsFor(ctx, owner, chat);
  const members = chat.groupId ? getGroup(ctx, owner, chat.groupId).members.map((m) => getCharacter(ctx, owner, m.characterId)) : [getCharacter(ctx, owner, chat.characterId!)];
  const character = (speakerId && members.find((m) => m.id === speakerId)) || members[0];
  const persona = chat.personaId ? safePersona(ctx, owner, chat.personaId) : defaultPersona(ctx, owner);
  // Game layer off: the game's data stays, but nothing of it reaches the prompt.
  const state = chat.campaignId && features.on.game ? safeState(ctx, owner, chat.campaignId) : null;
  return {
    chat,
    character,
    members,
    persona,
    userName: persona?.name ?? 'You',
    settings,
    features,
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
  /** THE DICE lines for this turn. */
  dice?: string[];
  /** SOMETHING HAPPENS lines for this turn. */
  happens?: string[];
  /** Storyline rungs at this turn (from the turn tick). */
  threadRungs?: Record<string, number>;
}

export interface BuiltPrompt {
  assembled: AssembledPrompt;
  /** The exact scene block sent (byte-identical to the inspector's preview). */
  scene: SceneBlock | null;
  recall: { player: number; people: number };
  macros: MacroContext;
  wiActivated: Array<{ world: string; uid: number; comment: string }>;
  wiTimed: { sticky: Record<string, number>; cooldown: Record<string, number> };
}

export async function buildPrompt(ctx: AppContext, owner: string, pc: PromptContext, opts: BuildOptions): Promise<BuiltPrompt> {
  const { chat, character, persona, settings, state, features } = pc;
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
    globalVars: getVars(ctx, owner, 'global') as Record<string, string | number>,
    charVars: getVars(ctx, owner, 'character', character.id) as Record<string, string | number>,
    mesVars: messageVarsAt(opts.history as Array<{ id: string; swipeId: number; swipes: Array<{ vars?: VarMap }> }>),
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

  // Memory and the scene block. Recall is scoped to what each person can know; the scene block
  // tells the narrator who is here, what they know and don't, and what matters now.
  const recentText = [lastUser ? textOf(lastUser) : '', lastChar ? textOf(lastChar) : '', ...visible.slice(-3).map(textOf)].join('\n').slice(-6000);
  const names = { player: pc.userName, characters: pc.members.map((m) => ({ id: m.id, name: m.name })) };
  const world = settings.world;
  let memory = '';
  let gameState = '';
  let sceneBlock: SceneBlock | null = null;
  // Memory off: nothing is recalled (and no embedding call is made). Summary: only the story so far.
  const scene =
    features.memory === 'off'
      ? { facts: [], summaries: [], milestones: [], present: [], result: { player: [], people: [] } }
      : await recallForScene(ctx, owner, chat, state, recentText, {
          chatCharacters: pc.members.map((m) => m.id),
          semantic: world.semantic,
          playerLimit: features.memory === 'summary' ? 0 : world.recallLimit,
          focus: lastUser ? textOf(lastUser) : undefined,
          names: [pc.userName, ...pc.members.map((m) => m.name)],
        });
  if (features.memory === 'summary') scene.facts = [];
  const factsBy: Record<string, string[]> = {};
  for (const f of scene.facts) (factsBy[f.entityId] ??= []).push(f.text);
  const recap = storySoFar(scene.summaries, scene.milestones);
  const recalled = scene.result.player.map((r) => ({
    text: r.m.text,
    gameTime: r.m.gameTime,
    heard: r.k.kind === 'heard',
    secretWith: r.m.secret ? r.m.witnesses.filter((w) => w !== PLAYER).map((w) => nameOfPerson(state, w, names)) : undefined,
  }));
  if (state && settings.tracker.injectState && features.on.sceneBlock) {
    const known = search(ctx, owner, recentText, { campaignId: chat.campaignId, kinds: ['fact', 'runin', 'diary'], limit: 4 }).map((h) => (h.title ? `${h.title}: ${h.body}` : h.body));
    const texts = recentPhoneTexts(ctx, owner, chat.campaignId!, state);
    const people: Record<string, PersonMemoryView> = {};
    for (const p of scene.result.people) {
      people[p.id] = {
        knows: p.knows.map((r) => r.m.text),
        heard: p.heard.map((r) => ({ text: r.m.text, distortion: r.k.distortion })),
        doesNotKnow: p.doesNotKnow.map((r) => r.m.text),
      };
    }
    // Named in what the player just said first, then in the rest of the recent text.
    const referenced = new Set<string>();
    for (const text of [lastUser ? textOf(lastUser) : '', recentText]) {
      const low = text.toLowerCase();
      for (const n of Object.values(state.npcs)) if (low.includes(n.name.toLowerCase().split(' ')[0])) referenced.add(n.id);
    }
    const extraPresent = scene.present.filter((id) => id.startsWith('char:')).map((id) => ({ id, name: nameOfPerson(state, id, names) }));
    sceneBlock = buildSceneBlock(
      state,
      { storySoFar: recap, recalled, known: [...known, ...texts], people, facts: factsBy, extraPresent, referenced, dice: opts.dice, happens: opts.happens, threadRungs: opts.threadRungs },
      { budgetTokens: world.sceneBudget, countTokens },
    );
    gameState = sceneBlock.text;
  } else {
    // No game: memory is still recalled and injected as the story so far.
    const lines = [...recap, ...recalled.map((r) => `- ${r.text}`), ...(factsBy.world ?? []).map((f) => `- ${f}`), ...Object.entries(factsBy).filter(([k]) => k !== 'world').flatMap(([, v]) => v.map((f) => `- ${f}`))];
    memory = lines.length ? `[Story so far]\n${lines.join('\n')}` : '';
  }

  const extraRules: string[] = [];
  if (character.game.chatRules?.trim()) extraRules.push(character.game.chatRules.trim());
  if (state && features.on.trackers && settings.tracker.mode === 'inline' && opts.type !== 'impersonate') extraRules.push(inlineInstruction(allowedOpTypes(AI_OP_TYPES, features)));
  if (opts.finalInstruction) extraRules.push(opts.finalInstruction);

  // Regex rules: prompt-only ones change history as sent (by depth); world info runs through all rules
  // for its placement, since it is never stored.
  const rules = regexForChat(ctx, owner, chat.id);
  const rx = (text: string, placement: RegexPlacement, depth?: number, includeStored = false) => (rules.length ? applyRegexScripts(text, rules, { placement, target: 'prompt', depth, macros, includeStored }) : text);
  const history: HistoryMessage[] = visible.map((m, i) => ({
    id: m.id,
    role: m.role === 'user' ? 'user' : m.role === 'system' ? 'system' : 'assistant',
    name: m.name,
    content: rx(stripInlineTags(textOf(m)), m.role === 'user' ? RegexPlacement.userInput : RegexPlacement.aiOutput, visible.length - 1 - i),
  }));
  if (rules.length) {
    const wiRx = (t: string) => rx(t, RegexPlacement.worldInfo, undefined, true);
    wi.before = wiRx(wi.before);
    wi.after = wiRx(wi.after);
    for (const d of wi.depth) d.entries = d.entries.map(wiRx);
  }

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
  // Extension prompt blocks (approved, enabled extensions): at the top, at the end, or at a depth.
  for (const blk of extensionPromptBlocks(ctx, owner)) {
    const content = expandMacros(blk.text, macros).trim();
    if (!content) continue;
    const msg = { role: blk.role, content };
    const n = assembled.messages.length;
    const at = blk.position === 'before' ? Math.min(1, n) : blk.position === 'after' ? n : Math.max(0, n - blk.depth);
    assembled.messages.splice(at, 0, msg);
    assembled.parts.push({ blockId: `ext:${blk.ext}:${blk.id}`, name: `Extension: ${blk.ext}`, role: blk.role, content, tokens: countTokens(content) });
    assembled.totalTokens += countTokens(content);
  }
  void characterRow;
  return {
    assembled,
    scene: sceneBlock,
    recall: { player: scene.result.player.length, people: scene.result.people.length },
    macros,
    wiActivated: wi.activated.map((e) => ({ world: e.world, uid: e.uid, comment: e.comment || e.key.join(', ') })),
    wiTimed: wi.timed,
  };
}

/** The last few phone texts from the past two game days, so the story knows what was said off-screen. */
function recentPhoneTexts(ctx: AppContext, owner: string, campaignId: string, state: CampaignState): string[] {
  const since = state.time.minutes - 2 * 1440;
  const rows = ctx.db
    .prepare('SELECT npc_id, from_player, text, game_time FROM phone_messages WHERE owner_id = ? AND campaign_id = ? AND (game_time IS NULL OR game_time >= ?) ORDER BY created_at DESC LIMIT 6')
    .all(owner, campaignId, since) as Array<{ npc_id: string; from_player: number; text: string }>;
  const who = (id: string) => state.npcs[id]?.name ?? 'Someone';
  return rows.reverse().map((r) => `text ${r.from_player ? `${state.player.name} → ${who(r.npc_id)}` : `${who(r.npc_id)} → ${state.player.name}`}: ${r.text.slice(0, 200)}`);
}
