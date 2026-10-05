/**
 * The light half of scripting, loaded with the app: an event hub the story view reports to, and
 * whether scripts may run at all. The sandbox host (host.ts) subscribes when it is loaded, so
 * chats without scripts never download it.
 */
import { readSafeMode } from '@/lib/customCss';

export type ScriptEvent = 'chatOpen' | 'generationStart' | 'generationEnd' | 'message' | 'messageSent' | 'swipe' | 'edit' | 'delete' | 'button' | 'timer' | 'entryActivated';

type Listener = (name: ScriptEvent, data: Record<string, unknown>) => void;
type Hook = (name: 'beforeGeneration', data: Record<string, unknown>) => Promise<void>;

const listeners = new Set<Listener>();
let hook: Hook | null = null;

export const scriptBus = {
  emit(name: ScriptEvent, data: Record<string, unknown> = {}) {
    for (const l of listeners) l(name, data);
  },
  /** Before a reply: scripts may change variables first. Never blocks longer than the host allows. */
  async beforeGeneration(data: Record<string, unknown>) {
    if (hook) await hook('beforeGeneration', data).catch(() => undefined);
  },
  listen(fn: Listener) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  setHook(fn: Hook | null) {
    hook = fn;
  },
};

/** Safe mode (`?safe=1` or `?safe-mode`) turns off every script, extension and message frame. */
export const scriptsSafeMode = () => readSafeMode(typeof location !== 'undefined' ? location.search : '');

/** Interactive HTML blocks in a message: ```html fences, the configured tag, or a whole document. */
export type Part = { type: 'text'; text: string } | { type: 'html'; html: string; index: number } | { type: 'renderer'; tag: string; content: string; index: number };

/** Extension message renderers claim their own tags, e.g. <dice>2d6</dice>. */
export function splitInteractive(text: string, tag = 'everloom-html', rendererTags: readonly string[] = []): Part[] {
  if (!text || (!text.includes('```') && !text.includes('<'))) return [{ type: 'text', text }];
  const safeTag = /^[a-z][a-z0-9-]{0,40}$/.test(tag) ? tag : 'everloom-html';
  const rTags = rendererTags.filter((t) => /^[a-z][a-z0-9-]{0,30}$/.test(t));
  const rAlt = rTags.length ? `|<(${rTags.join('|')})>([\\s\\S]*?)</\\4>` : '';
  const re = new RegExp('```html\\s*\\n([\\s\\S]*?)```|<' + safeTag + '>([\\s\\S]*?)</' + safeTag + '>|(<!doctype html[\\s\\S]*?</html>|<html[\\s\\S]*?</html>)' + rAlt, 'gi');
  const parts: Part[] = [];
  let last = 0;
  let index = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[4]) parts.push({ type: 'renderer', tag: m[4].toLowerCase(), content: (m[5] ?? '').trim(), index: index++ });
    else parts.push({ type: 'html', html: (m[1] ?? m[2] ?? m[3] ?? '').trim(), index: index++ });
    last = re.lastIndex;
  }
  if (!parts.length) return [{ type: 'text', text }];
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  return parts.filter((p) => p.type !== 'text' || p.text.trim());
}
