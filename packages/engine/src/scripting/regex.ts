/**
 * Regex scripts in SillyTavern's format: find/replace rules applied to what the player writes, what
 * the AI writes, the displayed text only, or the prompt only. Interactive cards use them to turn
 * tags into HTML. Written from the format's field list; the matching rules are Everloom's own.
 */
import { z } from 'zod';
import { expandMacros, type MacroContext } from '../prompt/macros.js';

/** SillyTavern's placement numbers. */
export enum RegexPlacement {
  /** Old "display" placement; treated like AI output. */
  legacyDisplay = 0,
  userInput = 1,
  aiOutput = 2,
  slashCommand = 3,
  worldInfo = 5,
  reasoning = 6,
}

export const regexScriptSchema = z.looseObject({
  id: z.string().default(() => Math.random().toString(36).slice(2, 12)),
  scriptName: z.string().default('Regex'),
  findRegex: z.string().default(''),
  replaceString: z.string().default(''),
  trimStrings: z.array(z.string()).default([]),
  placement: z.array(z.number().int()).default([RegexPlacement.aiOutput]),
  disabled: z.boolean().default(false),
  /** Changes only what is shown; storage keeps the original. */
  markdownOnly: z.boolean().default(false),
  /** Changes only what is sent to the model. */
  promptOnly: z.boolean().default(false),
  runOnEdit: z.boolean().default(true),
  /** 0 = no, 1 = expand macros in the pattern, 2 = expand and escape them. Booleans are accepted. */
  substituteRegex: z.union([z.number().int(), z.boolean()]).default(0),
  minDepth: z.number().int().nullable().optional(),
  maxDepth: z.number().int().nullable().optional(),
});
export type RegexScript = z.infer<typeof regexScriptSchema>;

/** Where a text is going when rules run on it. */
export type RegexTarget = 'stored' | 'display' | 'prompt';

export interface RegexRun {
  placement: RegexPlacement;
  target: RegexTarget;
  /** Messages from the end (0 = the newest); depth rules only apply when this is known. */
  depth?: number;
  macros?: MacroContext;
  /** Message edits only run rules with runOnEdit. */
  isEdit?: boolean;
  /** For text that is never stored (world info): prompt runs also apply the ordinary rules. */
  includeStored?: boolean;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** "/pattern/flags" or a bare pattern (global by default, like SillyTavern). */
export function parseRegex(source: string): RegExp | null {
  if (!source) return null;
  const m = /^\/([\s\S]+)\/([dgimsuvy]*)$/.exec(source);
  try {
    if (m) return new RegExp(m[1]!, m[2]);
    return new RegExp(source, 'g');
  } catch {
    return null;
  }
}

function wanted(s: RegexScript, run: RegexRun): boolean {
  if (s.disabled || !s.findRegex) return false;
  const placements = s.placement.map((p) => (p === RegexPlacement.legacyDisplay ? RegexPlacement.aiOutput : p));
  if (!placements.includes(run.placement)) return false;
  if (run.isEdit && !s.runOnEdit) return false;
  // Which kind of text this run is for.
  if (run.target === 'stored' && (s.markdownOnly || s.promptOnly)) return false;
  if (run.target === 'display' && !s.markdownOnly) return false;
  if (run.target === 'prompt' && !s.promptOnly && !(run.includeStored && !s.markdownOnly)) return false;
  if (run.depth !== undefined) {
    if (typeof s.minDepth === 'number' && s.minDepth >= 0 && run.depth < s.minDepth) return false;
    if (typeof s.maxDepth === 'number' && s.maxDepth >= 0 && run.depth > s.maxDepth) return false;
  }
  return true;
}

/** Apply one rule. `{{match}}` and `$0` are the whole match, `$1`… and `$<name>` its groups. */
export function applyRegexScript(text: string, s: RegexScript, macros?: MacroContext): string {
  const sub = s.substituteRegex === true ? 1 : s.substituteRegex === false ? 0 : s.substituteRegex;
  let pattern = s.findRegex;
  if (sub && macros) {
    // Expand macros inside the pattern; mode 2 escapes the expanded values.
    pattern = pattern.replace(/\{\{[^{}]*\}\}/g, (mac) => {
      const v = expandMacros(mac, { ...macros, vars: { ...(macros.vars ?? {}) } });
      return sub === 2 ? escapeRe(v) : v;
    });
  }
  const re = parseRegex(pattern);
  if (!re) return text;
  return text.replace(re, (...args: unknown[]) => {
    const hasGroups = typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null;
    const named = (hasGroups ? args[args.length - 1] : {}) as Record<string, string | undefined>;
    const groups = args.slice(1, hasGroups ? -3 : -2) as Array<string | undefined>;
    let match = args[0] as string;
    for (const t of s.trimStrings) if (t) match = match.split(macros ? expandMacros(t, { ...macros, vars: { ...(macros.vars ?? {}) } }) : t).join('');
    let out = s.replaceString
      .replace(/\{\{match\}\}/gi, () => match)
      .replace(/\$<([A-Za-z_][\w]*)>/g, (_m, n: string) => named[n] ?? '')
      .replace(/\$(\d{1,2})/g, (_m, d: string) => (d === '0' ? match : (groups[Number(d) - 1] ?? '')));
    if (macros) out = expandMacros(out, { ...macros, vars: { ...(macros.vars ?? {}) } });
    return out;
  });
}

/** Apply every wanted rule in order. */
export function applyRegexScripts(text: string, scripts: readonly RegexScript[], run: RegexRun): string {
  if (!text || !scripts.length) return text;
  let out = text;
  for (const s of scripts) if (wanted(s, run)) out = applyRegexScript(out, s, run.macros);
  return out;
}

/** Read one rule or a list from a SillyTavern export (or an Everloom one). Bad entries are dropped. */
export function importRegexScripts(raw: unknown): RegexScript[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as any).regex_scripts) ? (raw as any).regex_scripts : [raw];
  const out: RegexScript[] = [];
  for (const r of list) {
    const p = regexScriptSchema.safeParse(r);
    if (p.success && p.data.findRegex) out.push(p.data);
  }
  return out;
}

/** The SillyTavern export shape for one rule (its own file). */
export const exportRegexScript = (s: RegexScript) => ({ ...s });
