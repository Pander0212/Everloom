/** Best-effort import/export of SillyTavern chat-completion presets. */
import { DEFAULT_PRESET, type MarkerId, type PromptBlock, type PromptPreset, type Role } from './assemble.js';

const MARKER_MAP: Record<string, MarkerId> = {
  worldInfoBefore: 'worldInfoBefore',
  worldInfoAfter: 'worldInfoAfter',
  personaDescription: 'personaDescription',
  charDescription: 'charDescription',
  charPersonality: 'charPersonality',
  scenario: 'scenario',
  dialogueExamples: 'dialogueExamples',
  chatHistory: 'chatHistory',
};

export interface PresetSamplers {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  max_tokens?: number;
  max_context?: number;
}

export function importSillyTavernPreset(raw: any, name = 'Imported preset'): { preset: PromptPreset; samplers: PresetSamplers } {
  const prompts: any[] = Array.isArray(raw?.prompts) ? raw.prompts : [];
  const byId = new Map(prompts.map((p) => [p.identifier, p]));
  const orders: any[] = Array.isArray(raw?.prompt_order) ? raw.prompt_order : [];
  // ST keeps per-character orders; 100001 is the global "dummy" used for all characters.
  const order = (orders.find((o) => o.character_id === 100001) ?? orders[orders.length - 1] ?? { order: [] }).order as Array<{ identifier: string; enabled: boolean }>;
  const seq = order.length ? order : prompts.map((p) => ({ identifier: p.identifier, enabled: p.enabled !== false }));

  const blocks: PromptBlock[] = [];
  for (const item of seq) {
    const p = byId.get(item.identifier) ?? {};
    const id = String(item.identifier);
    const role: Role = p.role === 'user' || p.role === 'assistant' ? p.role : 'system';
    const injection = p.injection_position === 1 ? { mode: 'depth' as const, depth: Number(p.injection_depth ?? 4) } : undefined;
    if (MARKER_MAP[id]) {
      blocks.push({ id, name: p.name ?? id, kind: 'marker', marker: MARKER_MAP[id], role, content: '', enabled: !!item.enabled, injection });
    } else if (id === 'main') {
      blocks.push({ id, name: p.name ?? 'Main prompt', kind: 'text', role, content: p.content ?? '', enabled: !!item.enabled, overridable: 'main' });
    } else if (id === 'jailbreak') {
      blocks.push({ id: 'postHistory', name: p.name ?? 'Post-history instructions', kind: 'text', role, content: p.content ?? '', enabled: !!item.enabled, overridable: 'postHistory', injection });
    } else if (id === 'enhanceDefinitions' || id === 'nsfw' || !p.marker) {
      if (p.marker) continue;
      blocks.push({ id, name: p.name ?? id, kind: 'text', role, content: p.content ?? '', enabled: !!item.enabled, injection });
    }
  }
  // Everloom-specific blocks that ST does not have.
  const ensure = (id: MarkerId, name: string, afterId: string, extra: Partial<PromptBlock> = {}) => {
    if (blocks.some((b) => b.marker === id)) return;
    const idx = blocks.findIndex((b) => b.id === afterId);
    const block: PromptBlock = { id, name, kind: 'marker', marker: id, role: 'system', content: '', enabled: true, ...extra };
    blocks.splice(idx >= 0 ? idx + 1 : blocks.length, 0, block);
  };
  ensure('memory', 'Memory', 'scenario');
  ensure('gameState', 'Game state', 'memory');
  ensure('authorsNote', "Author's note", 'chatHistory', { injection: { mode: 'depth', depth: 4 } });
  if (!blocks.some((b) => b.marker === 'chatHistory')) blocks.push({ ...DEFAULT_PRESET.blocks.find((b) => b.id === 'chatHistory')! });

  const preset: PromptPreset = {
    ...DEFAULT_PRESET,
    name,
    blocks,
    formats: {
      ...DEFAULT_PRESET.formats,
      worldInfo: raw?.wi_format ?? DEFAULT_PRESET.formats.worldInfo,
      scenario: raw?.scenario_format ?? DEFAULT_PRESET.formats.scenario,
      personality: raw?.personality_format ?? DEFAULT_PRESET.formats.personality,
      newChat: raw?.new_chat_prompt ?? DEFAULT_PRESET.formats.newChat,
      newGroupChat: raw?.new_group_chat_prompt ?? DEFAULT_PRESET.formats.newGroupChat,
      examplesSeparator: raw?.new_example_chat_prompt ?? DEFAULT_PRESET.formats.examplesSeparator,
      continueNudge: raw?.continue_nudge_prompt ?? DEFAULT_PRESET.formats.continueNudge,
      impersonation: raw?.impersonation_prompt ?? DEFAULT_PRESET.formats.impersonation,
      groupNudge: raw?.group_nudge_prompt ?? DEFAULT_PRESET.formats.groupNudge,
    },
    squashSystem: !!raw?.squash_system_messages,
    assistantPrefill: raw?.assistant_prefill ?? '',
    namesInHistory: raw?.names_behavior === 1 || raw?.names_behavior === 2 ? 'always' : 'group',
  };
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
  const samplers: PresetSamplers = {
    temperature: num(raw?.temperature),
    top_p: num(raw?.top_p),
    top_k: num(raw?.top_k),
    min_p: num(raw?.min_p),
    frequency_penalty: num(raw?.frequency_penalty),
    presence_penalty: num(raw?.presence_penalty),
    repetition_penalty: num(raw?.repetition_penalty),
    max_tokens: num(raw?.openai_max_tokens),
    max_context: num(raw?.openai_max_context),
  };
  return { preset, samplers };
}

export function exportSillyTavernPreset(preset: PromptPreset, samplers: PresetSamplers = {}): Record<string, unknown> {
  const reverse: Record<string, string> = { postHistory: 'jailbreak' };
  const prompts = preset.blocks
    .filter((b) => b.kind === 'text' || MARKER_MAP[b.id])
    .map((b) => {
      const identifier = reverse[b.id] ?? b.id;
      if (b.kind === 'marker') return { identifier, name: b.name, system_prompt: true, marker: true };
      return {
        identifier,
        name: b.name,
        system_prompt: ['main', 'jailbreak'].includes(identifier),
        role: b.role,
        content: b.content,
        injection_position: b.injection?.mode === 'depth' ? 1 : 0,
        injection_depth: b.injection?.depth ?? 4,
      };
    });
  const order = preset.blocks
    .filter((b) => b.kind === 'text' || MARKER_MAP[b.id])
    .map((b) => ({ identifier: reverse[b.id] ?? b.id, enabled: b.enabled }));
  return {
    temperature: samplers.temperature ?? 1,
    top_p: samplers.top_p ?? 1,
    top_k: samplers.top_k ?? 0,
    min_p: samplers.min_p ?? 0,
    frequency_penalty: samplers.frequency_penalty ?? 0,
    presence_penalty: samplers.presence_penalty ?? 0,
    repetition_penalty: samplers.repetition_penalty ?? 1,
    openai_max_tokens: samplers.max_tokens ?? 400,
    openai_max_context: samplers.max_context ?? 16384,
    wi_format: preset.formats.worldInfo,
    scenario_format: preset.formats.scenario,
    personality_format: preset.formats.personality,
    new_chat_prompt: preset.formats.newChat,
    new_group_chat_prompt: preset.formats.newGroupChat,
    new_example_chat_prompt: preset.formats.examplesSeparator,
    continue_nudge_prompt: preset.formats.continueNudge,
    impersonation_prompt: preset.formats.impersonation,
    group_nudge_prompt: preset.formats.groupNudge,
    squash_system_messages: preset.squashSystem,
    assistant_prefill: preset.assistantPrefill,
    prompts,
    prompt_order: [{ character_id: 100001, order }],
  };
}
