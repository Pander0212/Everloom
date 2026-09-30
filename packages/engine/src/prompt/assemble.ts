/**
 * Prompt assembly. A preset is an ordered list of toggleable blocks. Marker blocks pull their
 * content from the chat context (character fields, persona, world info, history, game state...).
 */
import { estimateTokens } from '../util/text.js';
import { expandMacros, type MacroContext } from './macros.js';
import { NARRATOR_CONTRACT } from '../game/scene.js';

export type Role = 'system' | 'user' | 'assistant';

export type MarkerId =
  | 'worldInfoBefore'
  | 'worldInfoAfter'
  | 'personaDescription'
  | 'charDescription'
  | 'charPersonality'
  | 'scenario'
  | 'dialogueExamples'
  | 'chatHistory'
  | 'memory'
  | 'gameState'
  | 'authorsNote';

export interface PromptBlock {
  id: string;
  name: string;
  /** 'marker' blocks are filled from context; 'text' blocks use `content`. */
  kind: 'text' | 'marker';
  marker?: MarkerId;
  role: Role;
  content: string;
  enabled: boolean;
  /** Relative (in order) or injected into history at a depth. */
  injection?: { mode: 'relative' | 'depth'; depth: number };
  /** For system/main block: let character system_prompt override. */
  overridable?: 'main' | 'postHistory';
  /** Only include this block when the game-state block is present (e.g. the narrator contract). */
  withGameState?: boolean;
}

export interface PromptPreset {
  id?: string;
  name: string;
  blocks: PromptBlock[];
  /** Formats applied to marker contents. `{0}` is replaced with the content. */
  formats: {
    worldInfo: string;
    scenario: string;
    personality: string;
    examplesSeparator: string;
    newChat: string;
    newGroupChat: string;
    continueNudge: string;
    impersonation: string;
    groupNudge: string;
  };
  preferCharacterPrompt: boolean;
  preferCharacterInstructions: boolean;
  squashSystem: boolean;
  namesInHistory: 'none' | 'group' | 'always';
  assistantPrefill: string;
}

export const DEFAULT_PRESET: PromptPreset = {
  name: 'Default',
  blocks: [
    { id: 'main', name: 'Main prompt', kind: 'text', role: 'system', enabled: true, overridable: 'main', content: "Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}. Stay in character, keep the story moving, and write vivid, grounded prose." },
    { id: 'worldInfoBefore', name: 'World info (before)', kind: 'marker', marker: 'worldInfoBefore', role: 'system', content: '', enabled: true },
    { id: 'personaDescription', name: 'Persona', kind: 'marker', marker: 'personaDescription', role: 'system', content: '', enabled: true },
    { id: 'charDescription', name: 'Character description', kind: 'marker', marker: 'charDescription', role: 'system', content: '', enabled: true },
    { id: 'charPersonality', name: 'Character personality', kind: 'marker', marker: 'charPersonality', role: 'system', content: '', enabled: true },
    { id: 'scenario', name: 'Scenario', kind: 'marker', marker: 'scenario', role: 'system', content: '', enabled: true },
    { id: 'memory', name: 'Memory', kind: 'marker', marker: 'memory', role: 'system', content: '', enabled: true },
    { id: 'worldContract', name: 'World state rules', kind: 'text', role: 'system', enabled: true, withGameState: true, content: NARRATOR_CONTRACT },
    { id: 'gameState', name: 'Game state', kind: 'marker', marker: 'gameState', role: 'system', content: '', enabled: true },
    { id: 'worldInfoAfter', name: 'World info (after)', kind: 'marker', marker: 'worldInfoAfter', role: 'system', content: '', enabled: true },
    { id: 'dialogueExamples', name: 'Example dialogue', kind: 'marker', marker: 'dialogueExamples', role: 'system', content: '', enabled: true },
    { id: 'chatHistory', name: 'Chat history', kind: 'marker', marker: 'chatHistory', role: 'system', content: '', enabled: true },
    { id: 'authorsNote', name: "Author's note", kind: 'marker', marker: 'authorsNote', role: 'system', content: '', enabled: true, injection: { mode: 'depth', depth: 4 } },
    { id: 'postHistory', name: 'Post-history instructions', kind: 'text', role: 'system', enabled: true, overridable: 'postHistory', content: '' },
  ],
  formats: {
    worldInfo: '{0}',
    scenario: "Scenario: {0}",
    personality: "{{char}}'s personality: {0}",
    examplesSeparator: '[Example chat]',
    newChat: '[Start a new chat]',
    newGroupChat: '[Start a new group chat. Group members: {{group}}]',
    continueNudge: '[Continue your last message without repeating its original content.]',
    impersonation: "[Write your next reply from the point of view of {{user}}, using the chat history so far as a guideline for the writing style of {{user}}. Don't write as {{char}} or system. Don't describe actions of {{char}}.]",
    groupNudge: '[Write the next reply only as {{char}}.]',
  },
  preferCharacterPrompt: true,
  preferCharacterInstructions: true,
  squashSystem: false,
  namesInHistory: 'group',
  assistantPrefill: '',
};

export interface HistoryMessage {
  id?: string | number;
  role: 'user' | 'assistant' | 'system';
  name: string;
  content: string;
}

export interface DepthInjection {
  depth: number;
  role: Role;
  content: string;
  source: string;
}

export interface AssemblyInput {
  preset: PromptPreset;
  macros: MacroContext;
  character: {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    mesExample: string;
    systemPrompt: string;
    postHistoryInstructions: string;
    depthPrompt?: { prompt: string; depth: number; role: Role };
  };
  personaDescription: string;
  worldInfo: { before: string; after: string; depth: DepthInjection[]; anTop: string[]; anBottom: string[]; emTop: string[]; emBottom: string[] };
  authorsNote?: { content: string; depth: number; role: Role };
  memory?: string;
  gameState?: string;
  history: HistoryMessage[];
  isGroup?: boolean;
  type: 'normal' | 'continue' | 'impersonate' | 'swipe' | 'regenerate' | 'quiet';
  /** Extra instruction appended at the end (quiet prompts / group nudge). */
  finalInstruction?: string;
  maxContext: number;
  maxResponse: number;
  countTokens?: (text: string) => number;
}

export interface AssembledPart {
  blockId: string;
  name: string;
  role: Role;
  content: string;
  tokens: number;
  /** For history messages: original message id. */
  messageId?: string | number;
}

export interface AssembledPrompt {
  messages: Array<{ role: Role; content: string; name?: string }>;
  parts: AssembledPart[];
  totalTokens: number;
  budget: number;
  trimmedHistory: number;
  includedHistory: number;
  prefill: string;
}

export function parseExampleDialogue(text: string, sep = '[Example chat]'): string[] {
  if (!text?.trim()) return [];
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/<START>/i)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks.map((b) => `${sep}\n${b}`);
}

const fmt = (template: string, value: string) => (value ? template.replace('{0}', value) : '');

export function assemblePrompt(input: AssemblyInput): AssembledPrompt {
  const count = input.countTokens ?? estimateTokens;
  const m = (s: string) => expandMacros(s ?? '', input.macros);
  const { preset, character } = input;
  const budget = Math.max(256, input.maxContext - input.maxResponse);

  interface Pending {
    block: PromptBlock;
    parts: AssembledPart[];
  }
  const ordered: Pending[] = [];
  const depthInjections: DepthInjection[] = [...input.worldInfo.depth];
  let historyIndex = -1;

  const mkPart = (block: PromptBlock, content: string, role: Role = block.role, name = block.name): AssembledPart => ({
    blockId: block.id,
    name,
    role,
    content,
    tokens: count(content),
  });

  for (const block of preset.blocks) {
    if (!block.enabled) continue;
    if (block.withGameState && !input.gameState) continue;
    let content = '';
    if (block.kind === 'text') {
      content = block.content;
      if (block.overridable === 'main' && preset.preferCharacterPrompt && character.systemPrompt.trim()) {
        content = character.systemPrompt.replace(/\{\{original\}\}/gi, block.content);
      }
      if (block.overridable === 'postHistory' && preset.preferCharacterInstructions && character.postHistoryInstructions.trim()) {
        content = character.postHistoryInstructions.replace(/\{\{original\}\}/gi, block.content);
      }
      content = m(content);
    } else {
      switch (block.marker) {
        case 'worldInfoBefore':
          content = fmt(preset.formats.worldInfo, input.worldInfo.before);
          break;
        case 'worldInfoAfter':
          content = fmt(preset.formats.worldInfo, input.worldInfo.after);
          break;
        case 'personaDescription':
          content = m(input.personaDescription);
          break;
        case 'charDescription':
          content = m(character.description);
          break;
        case 'charPersonality':
          content = m(fmt(preset.formats.personality, character.personality));
          break;
        case 'scenario':
          content = m(fmt(preset.formats.scenario, character.scenario));
          break;
        case 'memory':
          content = input.memory ? m(input.memory) : '';
          break;
        case 'gameState':
          content = input.gameState ?? '';
          break;
        case 'dialogueExamples': {
          const examples = parseExampleDialogue(m(character.mesExample), m(preset.formats.examplesSeparator));
          const parts = examples.map((e, i) => mkPart(block, e, 'system', `${block.name} ${i + 1}`));
          if (parts.length) ordered.push({ block, parts });
          continue;
        }
        case 'chatHistory':
          historyIndex = ordered.length;
          ordered.push({ block, parts: [] });
          continue;
        case 'authorsNote': {
          const an = input.authorsNote;
          const text = [input.worldInfo.anTop.join('\n'), an?.content ? m(an.content) : '', input.worldInfo.anBottom.join('\n')].filter(Boolean).join('\n');
          if (text) depthInjections.push({ depth: an?.depth ?? block.injection?.depth ?? 4, role: an?.role ?? block.role, content: text, source: block.name });
          continue;
        }
      }
    }
    if (!content.trim()) continue;
    if (block.injection?.mode === 'depth') {
      depthInjections.push({ depth: block.injection.depth, role: block.role, content, source: block.name });
      continue;
    }
    ordered.push({ block, parts: [mkPart(block, content)] });
  }

  if (character.depthPrompt?.prompt?.trim()) {
    depthInjections.push({ depth: character.depthPrompt.depth, role: character.depthPrompt.role, content: m(character.depthPrompt.prompt), source: 'Character note' });
  }

  // Final nudges
  const tail: AssembledPart[] = [];
  if (input.type === 'impersonate') {
    tail.push({ blockId: 'impersonate', name: 'Impersonation', role: 'system', content: m(preset.formats.impersonation), tokens: 0 });
  } else if (input.type === 'continue') {
    tail.push({ blockId: 'continue', name: 'Continue nudge', role: 'system', content: m(preset.formats.continueNudge), tokens: 0 });
  } else if (input.isGroup && preset.formats.groupNudge) {
    tail.push({ blockId: 'groupNudge', name: 'Group nudge', role: 'system', content: m(preset.formats.groupNudge), tokens: 0 });
  }
  if (input.finalInstruction) tail.push({ blockId: 'instruction', name: 'Instruction', role: 'system', content: m(input.finalInstruction), tokens: 0 });
  tail.forEach((t) => (t.tokens = count(t.content)));

  const fixedTokens =
    ordered.reduce((s, p) => s + p.parts.reduce((a, b) => a + b.tokens, 0), 0) +
    tail.reduce((s, t) => s + t.tokens, 0) +
    depthInjections.reduce((s, d) => s + count(d.content), 0) +
    count(input.worldInfo.emTop.join('\n') + input.worldInfo.emBottom.join('\n'));

  // If fixed prompts exceed budget, drop example dialogue first.
  let remaining = budget - fixedTokens;
  if (remaining < 0) {
    const exIdx = ordered.findIndex((p) => p.block.marker === 'dialogueExamples');
    if (exIdx >= 0) {
      remaining += ordered[exIdx].parts.reduce((a, b) => a + b.tokens, 0);
      ordered.splice(exIdx, 1);
      if (historyIndex > exIdx) historyIndex--;
    }
  }

  // Chat history newest-first until the budget is used.
  const history = input.history;
  const useNames = preset.namesInHistory === 'always' || (preset.namesInHistory === 'group' && input.isGroup);
  const historyParts: AssembledPart[] = [];
  const startMarker = input.isGroup ? m(preset.formats.newGroupChat) : m(preset.formats.newChat);
  remaining -= count(startMarker);
  let included = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    let content = m(h.content);
    if (useNames && h.role !== 'system' && !content.startsWith(`${h.name}:`)) content = `${h.name}: ${content}`;
    const tokens = count(content) + 4;
    if (tokens > remaining && included > 0) break;
    remaining -= tokens;
    historyParts.unshift({ blockId: 'chatHistory', name: h.name, role: h.role, content, tokens, messageId: h.id });
    included++;
  }
  // When history has to be cut, cut at a multiple of 10 messages: the start of the history then
  // stays the same for the next several turns, so provider prompt caching keeps working. What was
  // cut is covered by the memory summaries; nothing is deleted.
  const CHUNK = 10;
  let trimmed = history.length - included;
  if (trimmed > 0) {
    const cut = Math.min(history.length - 1, Math.ceil(trimmed / CHUNK) * CHUNK);
    while (history.length - historyParts.length < cut && historyParts.length > 1) remaining += historyParts.shift()!.tokens;
    trimmed = history.length - historyParts.length;
  }

  // Example-message anchors
  const emTop = input.worldInfo.emTop.join('\n');
  const emBottom = input.worldInfo.emBottom.join('\n');
  if (emTop || emBottom) {
    const ex = ordered.find((p) => p.block.marker === 'dialogueExamples');
    if (ex) {
      if (emTop) ex.parts.unshift({ blockId: 'wiEM', name: 'World info (examples top)', role: 'system', content: emTop, tokens: count(emTop) });
      if (emBottom) ex.parts.push({ blockId: 'wiEM', name: 'World info (examples bottom)', role: 'system', content: emBottom, tokens: count(emBottom) });
    }
  }

  // Depth injections: depth 0 = after last message. Stable order by depth then insertion.
  const withDepth = historyParts.slice();
  const sortedInj = depthInjections.map((d, i) => ({ ...d, i })).sort((a, b) => a.depth - b.depth || a.i - b.i);
  for (const inj of sortedInj.reverse()) {
    const pos = Math.max(0, withDepth.length - Math.max(0, inj.depth));
    withDepth.splice(pos, 0, { blockId: 'depth', name: inj.source, role: inj.role, content: inj.content, tokens: count(inj.content) });
  }
  if (startMarker) withDepth.unshift({ blockId: 'chatStart', name: 'Chat start', role: 'system', content: startMarker, tokens: count(startMarker) });

  if (historyIndex >= 0) ordered[historyIndex].parts = withDepth;
  else ordered.push({ block: { id: 'chatHistory', name: 'Chat history', kind: 'marker', role: 'system', content: '', enabled: true }, parts: withDepth });

  const parts: AssembledPart[] = [...ordered.flatMap((p) => p.parts), ...tail];
  let messages = parts.map((p) => {
    const msg: { role: Role; content: string; name?: string } = { role: p.role, content: p.content };
    return msg;
  });
  if (preset.squashSystem) {
    const squashed: typeof messages = [];
    for (const msg of messages) {
      const last = squashed[squashed.length - 1];
      if (last && last.role === 'system' && msg.role === 'system') last.content += '\n\n' + msg.content;
      else squashed.push({ ...msg });
    }
    messages = squashed;
  }
  const prefill = input.type === 'impersonate' ? '' : m(preset.assistantPrefill ?? '');
  return {
    messages,
    parts,
    totalTokens: parts.reduce((s, p) => s + p.tokens, 0),
    budget,
    trimmedHistory: trimmed,
    includedHistory: historyParts.length,
    prefill,
  };
}
