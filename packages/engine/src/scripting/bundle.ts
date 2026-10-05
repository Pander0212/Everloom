/**
 * Reading script data out of cards, presets and lorebooks. Everloom keeps it in
 * `extensions.everloom_scripts` (`extensions.everloom` on cards is the game layer's); character regex rules use SillyTavern's `extensions.regex_scripts`; cards
 * made for Tavern Helper keep their scripts in `extensions.TavernHelper_scripts` (read here as
 * compatibility scripts, with permissions inferred from the code since they don't declare any).
 */
import { importRegexScripts, type RegexScript } from './regex.js';
import { quickReplySetSchema, scriptFingerprint, scriptSchema, type QuickReplySet, type Script, type ScriptPermission } from './types.js';

export interface ReadBundle {
  scripts: Script[];
  regex: RegexScript[];
  /** Declared (or inferred) permissions for scripts inside this card's messages. */
  messagePermissions: ScriptPermission[];
  quickReplies: QuickReplySet[];
}

/** Permissions a compatibility script will need, judged from the functions it calls. */
export function inferPermissions(code: string): ScriptPermission[] {
  const p = new Set<ScriptPermission>();
  const has = (re: RegExp) => re.test(code);
  if (has(/\b(getChatMessages|getCurrentMessageId|getLastMessageId|SillyTavern\.chat|getCharData|getCharacter)\b/)) p.add('chat.read');
  if (has(/\b(setChatMessages?|createChatMessages|deleteChatMessages|triggerSlash|setChatMessage|rotateChatMessages|everloom\.chat\.(send|add|edit|delete|swipe))\b/)) p.add('chat.write');
  if (has(/\b(getVariables|replaceVariables|insertOrAssignVariables|insertVariables|deleteVariable|updateVariablesWith|everloom\.vars)\b/)) p.add('variables');
  if (has(/\b(getLorebooks|getCharLorebooks|getLorebookEntries|getLorebookSettings|getCurrentCharPrimaryLorebook|everloom\.lore\.(list|get|entries))\b/)) p.add('lorebook.read');
  if (has(/\b(setLorebookEntries|createLorebookEntries|deleteLorebookEntries|createLorebook|deleteLorebook|everloom\.lore\.(set|create|delete))/)) p.add('lorebook.write');
  if (has(/\b(generate|generateRaw|everloom\.generate)\s*\(/)) p.add('generate');
  if (has(/\b(toastr|everloom\.ui|addButton|replaceScriptButtons|appendInexistentScriptButtons)\b/)) p.add('ui.panel');
  if (has(/\b(Audio|audioPlay|playAudio|everloom\.audio)\b/)) p.add('audio');
  if (has(/\b(everloom\.storage|insertOrAssignVariables\(\s*[^,]+,\s*\{\s*type:\s*['"]script)/)) p.add('storage');
  if (has(/\b(everloom\.state\.get)\b/)) p.add('state.read');
  if (has(/\b(everloom\.state\.propose)\b/)) p.add('state.ops');
  if (has(/\b(everloom\.net\.fetch)\b/)) p.add('network');
  return [...p];
}

function asScript(raw: unknown): Script | null {
  const p = scriptSchema.safeParse(raw);
  return p.success ? p.data : null;
}

/** Tavern Helper's character script entries → Everloom scripts in compatibility mode. */
function fromTavernHelper(list: unknown): Script[] {
  if (!Array.isArray(list)) return [];
  const out: Script[] = [];
  for (const [i, it] of list.entries()) {
    if (!it || typeof it !== 'object') continue;
    const r = it as Record<string, any>;
    // Folders hold their scripts in `scripts`.
    if (Array.isArray(r.scripts)) {
      out.push(...fromTavernHelper(r.scripts));
      continue;
    }
    const code = typeof r.content === 'string' ? r.content : typeof r.code === 'string' ? r.code : '';
    if (!code.trim()) continue;
    const buttons = Array.isArray(r.button?.buttons) ? r.button.buttons : Array.isArray(r.buttons?.buttons) ? r.buttons.buttons : [];
    const s = asScript({
      id: String(r.id ?? `th-${i}`).slice(0, 80),
      name: String(r.name ?? `Script ${i + 1}`).slice(0, 80) || `Script ${i + 1}`,
      description: String(r.info ?? '').slice(0, 2000),
      code,
      permissions: inferPermissions(code),
      triggers: ['chatOpen', ...(buttons.length ? (['button'] as const) : [])],
      buttons: buttons
        .filter((b: any) => b && typeof b.name === 'string' && b.visible !== false)
        .slice(0, 8)
        .map((b: any, j: number) => ({ id: `b${j}`, label: String(b.name).slice(0, 40) || `Button ${j + 1}` })),
      enabled: r.enabled !== false,
      compat: true,
    });
    if (s) out.push(s);
  }
  return out;
}

/** Everything script-related in an item's `extensions`. */
export function readBundle(extensions: Record<string, any> | undefined | null, extra: { messageText?: string[] } = {}): ReadBundle {
  const ext = extensions && typeof extensions === 'object' ? extensions : {};
  const ev = ext.everloom_scripts && typeof ext.everloom_scripts === 'object' ? ext.everloom_scripts : {};
  const scripts = [...(Array.isArray(ev.scripts) ? ev.scripts.map(asScript).filter(Boolean) : []), ...fromTavernHelper(ext.TavernHelper_scripts ?? ext.tavern_helper?.scripts)] as Script[];
  const regex = importRegexScripts(Array.isArray(ext.regex_scripts) ? ext.regex_scripts : []);
  const quickReplies = (Array.isArray(ev.quickReplies) ? ev.quickReplies : []).flatMap((q: unknown) => {
    const p = quickReplySetSchema.safeParse(q);
    return p.success ? [p.data] : [];
  });
  let messagePermissions: ScriptPermission[] = Array.isArray(ev.messagePermissions) ? ev.messagePermissions.filter((x: unknown) => typeof x === 'string') : [];
  if (!Array.isArray(ev.messagePermissions)) {
    // Not declared: judge from the HTML the card's rules and greetings put into messages.
    const sources = [...regex.map((r) => r.replaceString), ...(extra.messageText ?? [])].join('\n');
    if (/<script\b/i.test(sources)) messagePermissions = inferPermissions(sources);
  }
  return { scripts, regex, messagePermissions, quickReplies };
}

/** Whether there's anything to review. Message HTML alone doesn't count; scripts in it do. */
export function bundleHasCode(b: ReadBundle, messageText: string[] = []): boolean {
  return b.scripts.length > 0 || b.regex.length > 0 || [...b.regex.map((r) => r.replaceString), ...messageText].some((t) => /<script\b|```html/i.test(t));
}

/** The fingerprint for an item's whole regex set (approved together). */
export const regexFingerprint = (rules: readonly RegexScript[]) =>
  scriptFingerprint({ code: JSON.stringify(rules.map((r) => [r.findRegex, r.replaceString, r.placement, r.trimStrings, r.markdownOnly, r.promptOnly, r.minDepth, r.maxDepth, r.substituteRegex])), permissions: [], domains: [] });

/** The fingerprint for running scripts inside an item's messages. */
export const messageFingerprint = (perms: readonly ScriptPermission[]) => scriptFingerprint({ code: '@messages', permissions: [...perms], domains: [] });
