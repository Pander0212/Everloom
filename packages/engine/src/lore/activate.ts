/**
 * World Info activation — our own implementation of SillyTavern-compatible semantics:
 * primary keys (plain or /regex/flags), secondary keys with AND ANY / NOT ALL / NOT ANY / AND ALL,
 * constant entries, probability, scan depth, recursion (with exclude/prevent/delay-until-recursion),
 * sticky / cooldown / delay timed effects, inclusion groups, token budget, and insertion positions.
 */
import { createRng, type Rng } from '../util/rng.js';
import { estimateTokens } from '../util/text.js';
import { DEFAULT_DEPTH, WILogic, WIPosition, type WIEntry } from './types.js';

export interface ScanEntry extends WIEntry {
  /** Source book name (used for the unique key). */
  world: string;
  /** Optional vector score from semantic retrieval; > 0 means externally activated. */
  semanticHit?: boolean;
}

export interface WIGlobalScanData {
  personaDescription?: string;
  characterDescription?: string;
  characterPersonality?: string;
  characterDepthPrompt?: string;
  scenario?: string;
  creatorNotes?: string;
  trigger?: string;
}

export interface WISettings {
  /** How many recent messages to scan. */
  scanDepth: number;
  /** Budget as a % of the context size. */
  budgetPercent: number;
  /** Absolute cap in tokens (0 = none). */
  budgetCap: number;
  recursive: boolean;
  /** Max recursion loops (0 = unlimited, bounded internally). */
  maxRecursionSteps: number;
  caseSensitive: boolean;
  matchWholeWords: boolean;
  /** Include speaker names ("Name: text") in the scanned buffer. */
  includeNames: boolean;
  minActivations: number;
  useGroupScoring: boolean;
}

export const DEFAULT_WI_SETTINGS: WISettings = {
  scanDepth: 2,
  budgetPercent: 25,
  budgetCap: 0,
  recursive: true,
  maxRecursionSteps: 0,
  caseSensitive: false,
  matchWholeWords: false,
  includeNames: true,
  minActivations: 0,
  useGroupScoring: false,
};

/** Timed-effect bookkeeping persisted per chat. Values are the chat length at which the effect ends. */
export interface WITimedState {
  sticky: Record<string, number>;
  cooldown: Record<string, number>;
}

export interface WIDepthGroup {
  depth: number;
  role: number;
  entries: string[];
}

export interface WIResult {
  before: string;
  after: string;
  anTop: string[];
  anBottom: string[];
  emTop: string[];
  emBottom: string[];
  depth: WIDepthGroup[];
  outlets: Record<string, string[]>;
  activated: ScanEntry[];
  timed: WITimedState;
  budget: number;
  overflowed: boolean;
}

export interface WIScanInput {
  entries: ScanEntry[];
  /** Messages newest-first, already formatted (e.g. "Name: text" if includeNames). */
  messagesNewestFirst: string[];
  /** Total chat length (used for timed effects). */
  chatLength: number;
  maxContext: number;
  settings?: Partial<WISettings>;
  global?: WIGlobalScanData;
  timed?: WITimedState;
  rng?: Rng;
  countTokens?: (text: string) => number;
  substitute?: (text: string) => string;
  /** Extra text always scanned (e.g. author's note if allowed). */
  injects?: string[];
}

export function parseRegexFromString(input: string): RegExp | null {
  const match = input.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
  if (!match) return null;
  let [, pattern, flags] = match;
  if (pattern.match(/(^|[^\\])\//)) return null;
  pattern = pattern.replace('\\/', '/');
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function entryKey(e: ScanEntry): string {
  return `${e.world}.${e.uid}`;
}

export function matchKey(haystack: string, needle: string, caseSensitive: boolean, wholeWords: boolean): boolean {
  const regex = parseRegexFromString(needle);
  if (regex) {
    regex.lastIndex = 0;
    return regex.test(haystack);
  }
  const h = caseSensitive ? haystack : haystack.toLowerCase();
  const n = caseSensitive ? needle : needle.toLowerCase();
  if (!n) return false;
  if (wholeWords) {
    if (n.split(/\s+/).length > 1) return h.includes(n);
    return new RegExp(`(?:^|\\W)(${escapeRegex(n)})(?:$|\\W)`).test(h);
  }
  return h.includes(n);
}

export function checkWorldInfo(input: WIScanInput): WIResult {
  const settings: WISettings = { ...DEFAULT_WI_SETTINGS, ...(input.settings ?? {}) };
  const rng = input.rng ?? createRng(Date.now() & 0xffffffff);
  const count = input.countTokens ?? estimateTokens;
  const sub = input.substitute ?? ((s: string) => s);
  const global = input.global ?? {};
  const chatLen = input.chatLength;
  const timedIn: WITimedState = input.timed ?? { sticky: {}, cooldown: {} };
  const timed: WITimedState = { sticky: { ...timedIn.sticky }, cooldown: { ...timedIn.cooldown } };

  // Drop expired effects.
  for (const k of Object.keys(timed.sticky)) if (timed.sticky[k] <= chatLen) delete timed.sticky[k];
  for (const k of Object.keys(timed.cooldown)) if (timed.cooldown[k] <= chatLen) delete timed.cooldown[k];

  let budget = Math.round((settings.budgetPercent * input.maxContext) / 100) || 1;
  if (settings.budgetCap > 0 && budget > settings.budgetCap) budget = settings.budgetCap;

  // Higher order = higher priority when sorting for budget; ST sorts descending by order.
  const sorted = input.entries.slice().sort((a, b) => b.order - a.order);
  const sortedIndex = new Map(sorted.map((e, i) => [e, i]));

  const recurseBuffer: string[] = [];
  const isSticky = (e: ScanEntry) => (timed.sticky[entryKey(e)] ?? -1) > chatLen;
  const isCooldown = (e: ScanEntry) => (timed.cooldown[entryKey(e)] ?? -1) > chatLen;
  const isDelayed = (e: ScanEntry) => e.delay != null && e.delay > 0 && chatLen < e.delay;

  let extraDepth = 0;
  const textFor = (e: ScanEntry, state: 'initial' | 'recursion'): string => {
    const depth = Math.max(0, Math.min(1000, (e.scanDepth ?? settings.scanDepth) + extraDepth));
    const JOIN = '\n\x01';
    let text = '\x01' + input.messagesNewestFirst.slice(0, depth).join(JOIN);
    if (e.matchPersonaDescription && global.personaDescription) text += JOIN + global.personaDescription;
    if (e.matchCharacterDescription && global.characterDescription) text += JOIN + global.characterDescription;
    if (e.matchCharacterPersonality && global.characterPersonality) text += JOIN + global.characterPersonality;
    if (e.matchCharacterDepthPrompt && global.characterDepthPrompt) text += JOIN + global.characterDepthPrompt;
    if (e.matchScenario && global.scenario) text += JOIN + global.scenario;
    if (e.matchCreatorNotes && global.creatorNotes) text += JOIN + global.creatorNotes;
    if (input.injects?.length) text += JOIN + input.injects.join(JOIN);
    if (state === 'recursion' || recurseBuffer.length) text += JOIN + recurseBuffer.join(JOIN);
    return text;
  };

  const delayLevels = [
    ...new Set(sorted.filter((e) => e.delayUntilRecursion).map((e) => (e.delayUntilRecursion === true ? 1 : Number(e.delayUntilRecursion)))),
  ].sort((a, b) => a - b);
  let currentDelayLevel = delayLevels.shift() ?? 0;

  const activated = new Map<string, ScanEntry>();
  const failedProbability = new Set<ScanEntry>();
  let overflowed = false;
  let usedTokens = 0;
  let state: 'initial' | 'recursion' | 'none' = 'initial';
  let loops = 0;
  const maxLoops = settings.maxRecursionSteps > 0 ? settings.maxRecursionSteps : 50;

  while (state !== 'none') {
    if (loops >= maxLoops) break;
    loops++;
    const now = new Set<ScanEntry>();

    for (const e of sorted) {
      if (failedProbability.has(e) || activated.has(entryKey(e))) continue;
      if (e.disable) continue;
      if (Array.isArray(e.triggers) && e.triggers.length && global.trigger && !e.triggers.includes(global.trigger)) continue;
      const sticky = isSticky(e);
      if (isDelayed(e)) continue;
      if (isCooldown(e) && !sticky) continue;
      if (state !== 'recursion' && e.delayUntilRecursion && !sticky) continue;
      if (state === 'recursion' && e.delayUntilRecursion && Number(e.delayUntilRecursion === true ? 1 : e.delayUntilRecursion) > currentDelayLevel && !sticky) continue;
      if (state === 'recursion' && settings.recursive && e.excludeRecursion && !sticky) continue;
      if (e.semanticHit) {
        now.add(e);
        continue;
      }
      if (e.constant || sticky) {
        now.add(e);
        continue;
      }
      if (!Array.isArray(e.key) || !e.key.length) continue;
      const cs = e.caseSensitive ?? settings.caseSensitive;
      const ww = e.matchWholeWords ?? settings.matchWholeWords;
      const text = textFor(e, state);
      const primary = e.key.find((k) => {
        const s = sub(k).trim();
        return s && matchKey(text, s, cs, ww);
      });
      if (!primary) continue;
      const secondary = e.selective && Array.isArray(e.keysecondary) && e.keysecondary.length > 0;
      if (!secondary) {
        now.add(e);
        continue;
      }
      const logic = e.selectiveLogic ?? WILogic.AND_ANY;
      let any = false;
      let all = true;
      let pass = false;
      for (const k2 of e.keysecondary) {
        const s = sub(k2).trim();
        const hit = !!s && matchKey(text, s, cs, ww);
        if (hit) any = true;
        else all = false;
        if (logic === WILogic.AND_ANY && hit) {
          pass = true;
          break;
        }
        if (logic === WILogic.NOT_ALL && !hit) {
          pass = true;
          break;
        }
      }
      if (!pass && logic === WILogic.NOT_ANY && !any) pass = true;
      if (!pass && logic === WILogic.AND_ALL && all) pass = true;
      if (pass) now.add(e);
    }

    let fresh = [...now].sort((a, b) => {
      const sa = isSticky(a) ? 1 : 0;
      const sb = isSticky(b) ? 1 : 0;
      return sb - sa || (sortedIndex.get(a) ?? 0) - (sortedIndex.get(b) ?? 0);
    });
    fresh = filterInclusionGroups(fresh, activated, rng, settings, isSticky);

    const successful: ScanEntry[] = [];
    let ignoresBudget = fresh.filter((e) => e.ignoreBudget).length;
    for (const e of fresh) {
      ignoresBudget -= e.ignoreBudget ? 1 : 0;
      if (overflowed && !e.ignoreBudget) {
        if (ignoresBudget > 0) continue;
        break;
      }
      const needsRoll = e.useProbability && e.probability < 100 && !isSticky(e);
      if (needsRoll && rng.next() * 100 > e.probability) {
        failedProbability.add(e);
        continue;
      }
      let content = sub(e.content);
      if (e.tokenBudget && e.tokenBudget > 0 && count(content) > e.tokenBudget) {
        // Trim oversized entries to their own budget (by characters, approximated).
        content = content.slice(0, Math.max(0, Math.floor(e.tokenBudget * 3.6)));
      }
      const cost = count(content + '\n');
      if (!e.ignoreBudget && usedTokens + cost >= budget) {
        overflowed = true;
        continue;
      }
      usedTokens += cost;
      const act = { ...e, content };
      activated.set(entryKey(e), act);
      successful.push(act);
    }

    let next: 'initial' | 'recursion' | 'none' = 'none';
    const forRecursion = successful.filter((e) => !e.preventRecursion);
    if (settings.recursive && !overflowed && forRecursion.length) next = 'recursion';
    if (next === 'none' && !overflowed && settings.minActivations > 0 && activated.size < settings.minActivations) {
      if (settings.scanDepth + extraDepth < input.messagesNewestFirst.length) {
        extraDepth++;
        next = state === 'recursion' ? 'recursion' : 'initial';
      }
    }
    if (next === 'none' && delayLevels.length) {
      next = 'recursion';
      currentDelayLevel = delayLevels.shift()!;
    }
    if (next !== 'none') {
      const text = forRecursion.map((e) => e.content).join('\n');
      if (text) recurseBuffer.push(text);
    }
    state = next;
  }

  // Record timed effects for newly activated entries.
  for (const e of activated.values()) {
    const key = entryKey(e);
    const wasSticky = (timedIn.sticky[key] ?? -1) > chatLen;
    if (e.sticky && e.sticky > 0 && !wasSticky) timed.sticky[key] = chatLen + e.sticky;
    if (e.cooldown && e.cooldown > 0 && !wasSticky) {
      const end = (timed.sticky[key] ?? chatLen) + e.cooldown;
      timed.cooldown[key] = end;
    }
  }

  // Build positions; entries joined in ascending order (ST unshifts from a descending sort).
  const result: WIResult = {
    before: '',
    after: '',
    anTop: [],
    anBottom: [],
    emTop: [],
    emBottom: [],
    depth: [],
    outlets: {},
    activated: [...activated.values()],
    timed,
    budget,
    overflowed,
  };
  const before: string[] = [];
  const after: string[] = [];
  const ordered = [...activated.values()].sort((a, b) => b.order - a.order);
  for (const e of ordered) {
    const content = e.content;
    if (!content) continue;
    switch (Number(e.position)) {
      case WIPosition.before:
        before.unshift(content);
        break;
      case WIPosition.after:
        after.unshift(content);
        break;
      case WIPosition.ANTop:
        result.anTop.unshift(content);
        break;
      case WIPosition.ANBottom:
        result.anBottom.unshift(content);
        break;
      case WIPosition.EMTop:
        result.emTop.unshift(content);
        break;
      case WIPosition.EMBottom:
        result.emBottom.unshift(content);
        break;
      case WIPosition.atDepth: {
        const depth = e.depth ?? DEFAULT_DEPTH;
        const role = e.role ?? 0;
        const g = result.depth.find((d) => d.depth === depth && d.role === role);
        if (g) g.entries.unshift(content);
        else result.depth.push({ depth, role, entries: [content] });
        break;
      }
      case WIPosition.outlet:
        if (e.outletName) (result.outlets[e.outletName] ??= []).push(content);
        break;
      default:
        before.unshift(content);
    }
  }
  result.before = before.join('\n');
  result.after = after.join('\n');
  return result;
}

/** Inclusion groups: only one entry per group activates (override → highest order, else weighted roll). */
function filterInclusionGroups(
  entries: ScanEntry[],
  already: Map<string, ScanEntry>,
  rng: Rng,
  settings: WISettings,
  isSticky: (e: ScanEntry) => boolean,
): ScanEntry[] {
  const groups = new Map<string, ScanEntry[]>();
  for (const e of entries) {
    if (!e.group) continue;
    for (const g of e.group.split(/,\s*/).filter(Boolean)) {
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(e);
    }
  }
  if (!groups.size) return entries;
  const removed = new Set<ScanEntry>();
  const activatedGroups = new Set<string>();
  for (const e of already.values()) for (const g of (e.group ?? '').split(/,\s*/).filter(Boolean)) activatedGroups.add(g);
  for (const [name, members] of groups) {
    if (activatedGroups.has(name)) {
      members.forEach((m) => removed.add(m));
      continue;
    }
    if (members.length < 2) continue;
    const sticky = members.filter(isSticky);
    if (sticky.length) {
      members.filter((m) => !sticky.includes(m)).forEach((m) => removed.add(m));
      continue;
    }
    const overrides = members.filter((m) => m.groupOverride);
    if (overrides.length) {
      const winner = overrides.reduce((a, b) => (b.order > a.order ? b : a));
      members.filter((m) => m !== winner).forEach((m) => removed.add(m));
      continue;
    }
    const total = members.reduce((s, m) => s + Math.max(0, m.groupWeight ?? 100), 0);
    let roll = rng.next() * total;
    let winner = members[0];
    for (const m of members) {
      roll -= Math.max(0, m.groupWeight ?? 100);
      if (roll <= 0) {
        winner = m;
        break;
      }
    }
    members.filter((m) => m !== winner).forEach((m) => removed.add(m));
  }
  void settings;
  return entries.filter((e) => !removed.has(e));
}
