/** Instruct templates for text-completion backends (KoboldCpp, llama.cpp /completion). */
import type { AssembledPrompt } from './assemble.js';

export interface InstructTemplate {
  name: string;
  systemPrefix: string;
  systemSuffix: string;
  userPrefix: string;
  userSuffix: string;
  assistantPrefix: string;
  assistantSuffix: string;
  /** Include speaker names inside turns. */
  names: boolean;
  stop: string[];
  bos?: string;
}

export const INSTRUCT_TEMPLATES: InstructTemplate[] = [
  {
    name: 'ChatML',
    systemPrefix: '<|im_start|>system\n',
    systemSuffix: '<|im_end|>\n',
    userPrefix: '<|im_start|>user\n',
    userSuffix: '<|im_end|>\n',
    assistantPrefix: '<|im_start|>assistant\n',
    assistantSuffix: '<|im_end|>\n',
    names: true,
    stop: ['<|im_end|>', '<|im_start|>'],
  },
  {
    name: 'Llama 3',
    bos: '<|begin_of_text|>',
    systemPrefix: '<|start_header_id|>system<|end_header_id|>\n\n',
    systemSuffix: '<|eot_id|>',
    userPrefix: '<|start_header_id|>user<|end_header_id|>\n\n',
    userSuffix: '<|eot_id|>',
    assistantPrefix: '<|start_header_id|>assistant<|end_header_id|>\n\n',
    assistantSuffix: '<|eot_id|>',
    names: true,
    stop: ['<|eot_id|>', '<|start_header_id|>'],
  },
  {
    name: 'Mistral',
    systemPrefix: '[INST] ',
    systemSuffix: ' [/INST]\n',
    userPrefix: '[INST] ',
    userSuffix: ' [/INST]',
    assistantPrefix: '',
    assistantSuffix: '</s>',
    names: true,
    stop: ['[INST]', '</s>'],
  },
  {
    name: 'Alpaca',
    systemPrefix: '',
    systemSuffix: '\n\n',
    userPrefix: '### Instruction:\n',
    userSuffix: '\n\n',
    assistantPrefix: '### Response:\n',
    assistantSuffix: '\n\n',
    names: true,
    stop: ['### Instruction:', '### Response:'],
  },
  {
    name: 'Gemma',
    systemPrefix: '<start_of_turn>user\n',
    systemSuffix: '<end_of_turn>\n',
    userPrefix: '<start_of_turn>user\n',
    userSuffix: '<end_of_turn>\n',
    assistantPrefix: '<start_of_turn>model\n',
    assistantSuffix: '<end_of_turn>\n',
    names: true,
    stop: ['<end_of_turn>', '<start_of_turn>'],
  },
  {
    name: 'Plain (no template)',
    systemPrefix: '',
    systemSuffix: '\n\n',
    userPrefix: '',
    userSuffix: '\n',
    assistantPrefix: '',
    assistantSuffix: '\n',
    names: true,
    stop: [],
  },
];

export function findInstructTemplate(name: string | undefined): InstructTemplate {
  return INSTRUCT_TEMPLATES.find((t) => t.name.toLowerCase() === String(name ?? '').toLowerCase()) ?? INSTRUCT_TEMPLATES[0];
}

/** Render an assembled chat prompt into one text-completion prompt string. */
export function renderInstructPrompt(
  prompt: AssembledPrompt,
  template: InstructTemplate,
  opts: { charName: string; userName: string; continueText?: string; impersonate?: boolean },
): { prompt: string; stop: string[] } {
  let out = template.bos ?? '';
  for (const part of prompt.parts) {
    const text = part.content;
    if (part.role === 'system') out += template.systemPrefix + text + template.systemSuffix;
    else if (part.role === 'user') out += template.userPrefix + text + template.userSuffix;
    else out += template.assistantPrefix + text + template.assistantSuffix;
  }
  const speaker = opts.impersonate ? opts.userName : opts.charName;
  if (opts.impersonate) out += template.userPrefix + (template.names ? `${speaker}: ` : '');
  else out += template.assistantPrefix + (template.names ? `${speaker}: ` : '');
  if (prompt.prefill) out += prompt.prefill;
  if (opts.continueText) out += opts.continueText;
  const stop = [...template.stop, `\n${opts.userName}:`];
  if (opts.impersonate) stop.push(`\n${opts.charName}:`);
  return { prompt: out, stop: [...new Set(stop)] };
}
