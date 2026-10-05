/**
 * The name shield's single choke point. Every request to an outside service (models, embeddings,
 * voices, image generation) goes through util/fetch.ts › safeFetch, which hands its body to
 * `shieldOutbound` here. Replies come back through `shieldStream` (llm/providers.ts).
 *
 * Which terms apply depends on where the request comes from (owner, chat, persona, characters). That
 * is carried in an AsyncLocalStorage store opened per HTTP request; services fill in the chat as soon
 * as they know it, and background work started from a request inherits it. With no store at all
 * (startup jobs), every owner's terms apply: the shield hides more, never less.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { buildShield, mapJsonStrings, makeStandin, standinClashes, termsInScope, type Shield, type ShieldSettings, type ShieldTerm } from '@everloom/engine';
import { HttpError } from '../context.js';

export interface ShieldStore {
  owner: string | null;
  chatId?: string | null;
  personaId?: string | null;
  characterIds?: string[];
  /** "Send anyway" for one request after a leak warning (only when the owner chose "ask"). */
  allowOnce?: boolean;
}

const als = new AsyncLocalStorage<ShieldStore>();
export const runWithShield = <T>(store: ShieldStore, fn: () => T): T => als.run(store, fn);
export const shieldStore = () => als.getStore() ?? null;
/** Tell the shield which chat (and so which scoped terms) the current work is for. */
export function shieldChat(p: Omit<ShieldStore, 'owner' | 'allowOnce'>) {
  const s = als.getStore();
  if (s) Object.assign(s, p);
}

export interface ResolvedShield {
  shield: Shield;
  settings: ShieldSettings;
  terms: ShieldTerm[];
}

/** Set once at startup: loads the owner's settings and the chat's names (for clash checks). */
type Resolver = (store: ShieldStore | null) => ResolvedShield | null;
let resolver: Resolver | null = null;
export function setShieldResolver(r: Resolver | null) {
  resolver = r;
}

export function currentShield(): ResolvedShield | null {
  if (!resolver) return null;
  try {
    const r = resolver(shieldStore());
    return r && r.settings.enabled && r.shield.active ? r : null;
  } catch {
    return null;
  }
}

/** Terms in scope for a store, with stand-ins that clash with names in this chat swapped per chat. */
export function resolveTerms(settings: ShieldSettings, store: ShieldStore | null, namesInUse: string[], chatSwaps: Record<string, string>): { terms: ShieldTerm[]; newSwaps: Record<string, string> } {
  const scoped = termsInScope(settings.terms, store ?? {}).map((t) => (chatSwaps[t.id] ? { ...t, standin: chatSwaps[t.id]! } : t));
  const clashes = standinClashes(scoped, namesInUse);
  const newSwaps: Record<string, string> = {};
  for (const t of clashes) {
    const avoid = [...namesInUse, ...scoped.map((x) => x.standin), ...settings.terms.map((x) => x.real)];
    const alt = makeStandin(t.kind, `${t.id}:${store?.chatId ?? ''}:${t.standin}`, avoid);
    newSwaps[t.id] = alt;
    t.standin = alt;
  }
  return { terms: scoped, newSwaps };
}

export type OutboundKind = 'llm' | 'tts' | 'image' | 'embed' | 'other';

/**
 * Replace protected terms in an outgoing request body, then check nothing slipped through. Strings
 * inside JSON are rewritten (keys untouched); anything else is treated as text.
 */
export function shieldOutbound(body: string, kind: OutboundKind = 'other'): string {
  const r = currentShield();
  if (!r) return body;
  if (kind === 'tts' && r.settings.ttsRealNames) return body;
  let out: string;
  try {
    out = JSON.stringify(mapJsonStrings(JSON.parse(body), (s) => r.shield.outbound(s)));
  } catch {
    out = r.shield.outbound(body);
  }
  // The leak check reads the payload as the provider will (JSON escapes undone).
  let plain = out;
  try {
    plain = JSON.stringify(JSON.parse(out), null, 0).replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  } catch {
    /* not JSON */
  }
  const leaks = r.shield.leaks(plain);
  if (leaks.length) {
    const store = shieldStore();
    if (r.settings.onLeak === 'ask' && store?.allowOnce) return out;
    throw new HttpError(409, `The name shield stopped this request: "${leaks[0]}" would have been sent to the AI provider.${r.settings.onLeak === 'ask' ? ' You can send it anyway.' : ''}`, 'shield_leak');
  }
  return out;
}

/** Restore real names in a streamed reply (text and reasoning separately), holding back split stand-ins. */
export async function* shieldStream<T extends { text?: string; reasoning?: string }>(gen: AsyncGenerator<T>): AsyncGenerator<T> {
  const r = currentShield();
  if (!r) {
    yield* gen;
    return;
  }
  const text = r.shield.restorer();
  const reasoning = r.shield.restorer();
  let last: T | null = null;
  for await (const c of gen) {
    last = c;
    const t = c.text ? text.push(c.text) : '';
    const z = c.reasoning ? reasoning.push(c.reasoning) : '';
    if (t || z || (!c.text && !c.reasoning)) yield { ...c, text: t || undefined, reasoning: z || undefined };
  }
  const t = text.flush();
  const z = reasoning.flush();
  if (t || z) yield { ...(last ?? ({} as T)), text: t || undefined, reasoning: z || undefined };
}

/** Restore real names in finished text (tracker JSON, utility answers, text returned to scripts). */
export function shieldInbound(text: string): string {
  const r = currentShield();
  return r ? r.shield.inbound(text) : text;
}

/** What the provider would receive for this text (the inspector's "as sent" view). */
export function shieldPreview(text: string): string {
  const r = currentShield();
  return r ? r.shield.outbound(text) : text;
}
