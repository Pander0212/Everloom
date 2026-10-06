/**
 * The sandbox host: every script, panel and interactive-message frame is registered here. Frames
 * are `sandbox="allow-scripts"` iframes of /api/sandbox/frame (an opaque origin with no network);
 * they talk to Everloom only through postMessage, and every call is checked here against the
 * permissions the owner approved before anything happens. Calls that cost money, reach the
 * internet or keep data are checked again by the server.
 *
 * Also here: the watchdog (a frame that stops answering is removed), the per-script console, and
 * the slash-command registry that scripts and extensions add to.
 */
import { guardHtmlScripts, guardLoops, guardPrelude } from '@everloom/engine/guard';
import { PERMISSION_INFO, type MessageDTO, type ScriptPermission, type VarMap } from '@everloom/engine';
import { create } from 'zustand';
import { api, apiFetch, del, get, patch, post, put, streamPost } from '@/lib/api';
import { qk, queryClient, upsertMessage } from '@/lib/queries';
import { toast } from '@/lib/store';
import { scriptBus, type ScriptEvent } from './bus';
import { logTo, markRunning, useScriptUi, type ConsoleEntry, type ModalField } from './ui-store';

export { logTo, useScriptUi };
import { slashRegistry } from './registry';

export { slashRegistry };

export type FrameKind = 'script' | 'message' | 'panel' | 'screen' | 'settings' | 'renderer';

export interface FrameSpec {
  kind: FrameKind;
  /** The approval key (also used by the server to check calls). */
  key: string;
  /** Shown in the console and in notices. */
  name: string;
  permissions: readonly ScriptPermission[];
  code?: string;
  html?: string;
  compat?: boolean;
  chatId?: string | null;
  characterId?: string | null;
  messageId?: string;
  messageIndex?: number;
  extId?: string;
  scriptId?: string;
  /** Model and time limits from Settings › Scripts. */
  budgetMs?: number;
  /** An extension page to load (its HTML is fetched first). */
  entry?: { extId: string; file: string; updatedAt: number };
  /** For extension message renderers: the tag's content. */
  content?: string;
  /** Lorebook scripts: the book and the entries (uids) whose activation it listens for. */
  entries?: { book: string; uids: string[] };
}

interface Frame {
  id: number;
  iframe: HTMLIFrameElement;
  spec: FrameSpec;
  perms: Set<ScriptPermission>;
  ready: boolean;
  lastPong: number;
  ping: number;
  subscribed: Set<string>;
  calls: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  onHeight?: (h: number) => void;
  onStopped?: (why: string) => void;
  slash: Array<() => void>;
  stopped: boolean;
  starting?: boolean;
}

// ------------------------------------------------------------------ registry

const frames = new Map<number, Frame>();
let nextId = 1;


function frameOf(win: MessageEventSource | null): Frame | undefined {
  if (!win) return undefined;
  for (const f of frames.values()) if (f.iframe.contentWindow === win) return f;
  return undefined;
}

function send(f: Frame, msg: Record<string, unknown>) {
  try {
    f.iframe.contentWindow?.postMessage({ ev: 1, ...msg }, '*');
  } catch {
    /* gone */
  }
}

/** The design tokens, passed in so frames look like the rest of Everloom. */
export function themeVars(): { vars: Record<string, string>; dark: boolean } {
  const cs = getComputedStyle(document.documentElement);
  const vars: Record<string, string> = {};
  for (let i = 0; i < cs.length && Object.keys(vars).length < 300; i++) {
    const n = cs[i]!;
    if (n.startsWith('--')) vars[n] = cs.getPropertyValue(n).trim();
  }
  const dark = document.documentElement.classList.contains('dark') || document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  return { vars, dark };
}

/** Pictures in message HTML come through Everloom's image proxy as data, since the frame can't load addresses. */
async function inlineImages(html: string): Promise<string> {
  const urls = [...new Set([...html.matchAll(/(?:src\s*=\s*["']|url\(\s*["']?)(https?:\/\/[^"')\s]+)/gi)].map((m) => m[1]!))].slice(0, 12);
  if (!urls.length) return html;
  const map = new Map<string, string>();
  await Promise.all(
    urls.map(async (u) => {
      try {
        const res = await apiFetch(`/api/image-proxy?url=${encodeURIComponent(u.replace(/&amp;/g, '&'))}`);
        const blob = await res.blob();
        if (blob.size > 4 * 1024 * 1024) return;
        const data = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(r.error);
          r.readAsDataURL(blob);
        });
        map.set(u, data);
      } catch {
        /* the picture just doesn't show */
      }
    }),
  );
  return html.replace(/(src\s*=\s*["']|url\(\s*["']?)(https?:\/\/[^"')\s]+)/gi, (full, pre: string, u: string) => (map.has(u) ? pre + map.get(u) : full));
}

async function snapshot(f: Frame) {
  const s: { vars: Record<string, VarMap>; messages: unknown[] } = { vars: {}, messages: [] };
  const chatId = f.spec.chatId;
  if (f.perms.has('variables')) {
    try {
      if (chatId) s.vars.chat = ((await get(`/api/chats/${chatId}`)).metadata?.vars ?? {}) as VarMap;
      s.vars.global = await get('/api/scripts/vars', { scope: 'global' });
      if (f.spec.characterId) s.vars.character = await get('/api/scripts/vars', { scope: 'character', scopeId: f.spec.characterId });
      if (f.perms.has('storage')) s.vars.script = ((await get('/api/scripts/run/storage', { key: f.spec.key, k: '__variables' })).value ?? {}) as VarMap;
    } catch {
      /* partial snapshot */
    }
  }
  if (f.perms.has('chat.read') && chatId) s.messages = messagesFor(chatId);
  return s;
}

function messagesFor(chatId: string) {
  const list = queryClient.getQueryData<MessageDTO[]>(qk.messages(chatId)) ?? [];
  return list.map((m) => ({ id: m.id, name: m.name, role: m.role, text: m.swipes[m.swipeId]?.text ?? '', hidden: m.hidden, swipeId: m.swipeId, swipes: m.swipes.map((x) => x.text), data: m.swipes[m.swipeId]?.vars ?? {} }));
}

/** Attach a frame. Returns a handle; dispose() removes everything it registered. */
export function attach(iframe: HTMLIFrameElement, spec: FrameSpec, opts: { onHeight?: (h: number) => void; onStopped?: (why: string) => void } = {}) {
  const f: Frame = { id: nextId++, iframe, spec, perms: new Set(spec.permissions), ready: false, lastPong: Date.now(), ping: 0, subscribed: new Set(), calls: new Map(), onHeight: opts.onHeight, onStopped: opts.onStopped, slash: [], stopped: false };
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.setAttribute('allow', '');
  iframe.src = '/api/sandbox/frame';
  frames.set(f.id, f);
  markRunning(spec, 1);
  ensureListening();
  return {
    id: f.id,
    call: (name: string, args: unknown[] = [], timeoutMs = 5000) => callFrame(f, name, args, timeoutMs),
    dispose: () => dispose(f),
    theme: () => send(f, { t: 'theme', ...themeVars() }),
  };
}

function dispose(f: Frame, why?: string) {
  if (!frames.has(f.id)) return;
  frames.delete(f.id);
  for (const u of f.slash) u();
  for (const c of f.calls.values()) {
    clearTimeout(c.timer);
    c.reject(new Error('The script stopped'));
  }
  f.calls.clear();
  markRunning(f.spec, -1, why);
  if (why) {
    f.stopped = true;
    try {
      f.iframe.removeAttribute('src');
      f.iframe.srcdoc = '';
    } catch {
      /* gone */
    }
    f.onStopped?.(why);
  }
}

function callFrame(f: Frame, name: string, args: unknown[], timeoutMs: number): Promise<unknown> {
  if (!f.ready) return Promise.reject(new Error('The script is still starting'));
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const timer = setTimeout(() => {
      f.calls.delete(id);
      reject(new Error(`${f.spec.name} took too long to answer`));
    }, timeoutMs);
    f.calls.set(id, { resolve, reject, timer });
    send(f, { t: 'call', id, name, args });
  });
}

// ------------------------------------------------------------------ incoming messages

let listening = false;
function ensureListening() {
  if (listening) return;
  listening = true;
  window.addEventListener('message', onMessage);
  // The watchdog: frames answer a ping every couple of seconds; one that doesn't is stopped.
  setInterval(() => {
    const now = Date.now();
    for (const f of [...frames.values()]) {
      if (!f.ready) {
        if (now - f.lastPong > 15_000) dispose(f, 'Didn’t start');
        continue;
      }
      if (now - f.lastPong > 8000) {
        logTo(f.spec.key, 'error', 'Stopped: it stopped responding (a long-running loop?)');
        dispose(f, 'Stopped: not responding');
        continue;
      }
      send(f, { t: 'ping', n: ++f.ping });
    }
  }, 2000);
  scriptBus.listen((name, data) => emitToFrames(name, data));
  scriptBus.setHook(async (name, data) => {
    const targets = [...frames.values()].filter((f) => f.ready && f.subscribed.has(name) && f.spec.chatId === data.chatId);
    await Promise.all(targets.map((f) => callFrame(f, `event:${name}`, [publicData(f, data)], 3000).catch((e) => logTo(f.spec.key, 'warn', `${name}: ${(e as Error).message}`))));
  });
}

/** Message events carry text only for frames that may read the chat. */
function publicData(f: Frame, data: Record<string, unknown>) {
  if (f.perms.has('chat.read')) return { ...data, messages: data.chatId ? messagesFor(String(data.chatId)) : undefined };
  const { chatId, messageId, messageIndex, button, scriptId } = data as Record<string, unknown>;
  return { chatId, messageId, messageIndex, button, scriptId };
}

function emitToFrames(name: ScriptEvent | string, data: Record<string, unknown>) {
  for (const f of frames.values()) {
    if (!f.ready || !f.subscribed.has(name)) continue;
    if (data.chatId && f.spec.chatId && data.chatId !== f.spec.chatId) continue;
    if ((name === 'button' || name === 'timer') && data.key && data.key !== f.spec.key) continue;
    if (name === 'entryActivated' && f.spec.entries) {
      const hits = ((data.entries as Array<{ book: string; uid: number }>) ?? []).filter((e) => e.book === f.spec.entries!.book && (!f.spec.entries!.uids.length || f.spec.entries!.uids.includes(String(e.uid))));
      if (!hits.length) continue;
      send(f, { t: 'event', name, data: { chatId: data.chatId, entries: hits } });
      continue;
    }
    send(f, { t: 'event', name, data: publicData(f, data) });
  }
}

/** Send an event to one frame (button presses, timers, stream tokens). */
export function emitTo(frameId: number, name: string, data: unknown) {
  const f = frames.get(frameId);
  if (f?.ready) send(f, { t: 'event', name, data });
}

async function onMessage(e: MessageEvent) {
  const f = frameOf(e.source);
  if (!f) return;
  const m = e.data as Record<string, any>;
  if (!m || m.ev !== 1) return;
  switch (m.t) {
    case 'ready': {
      // Answer one "ready" per frame load, even if another arrives while this one is being prepared.
      if (f.ready || f.starting) return;
      f.starting = true;
      const fn = `__g${Math.random().toString(36).slice(2, 10)}`;
      let code = f.spec.code;
      let html = f.spec.html;
      if (code) {
        const g = guardLoops(code, { fn });
        if (!g.ok) {
          logTo(f.spec.key, 'error', `Syntax error${g.line ? ` (line ${g.line})` : ''}: ${g.error}`);
          dispose(f, 'Syntax error');
          return;
        }
        code = g.code;
      }
      if (html) {
        const g = guardHtmlScripts(html, fn);
        for (const err of g.errors) logTo(f.spec.key, 'error', err);
        html = await inlineImages(g.html);
      }
      f.ready = true;
      f.lastPong = Date.now();
      const settingsCompat = f.spec.compat;
      const tv = themeVars();
      const chat = f.spec.chatId ? (queryClient.getQueryData<any>(qk.chat(f.spec.chatId)) ?? null) : null;
      const character = f.spec.characterId ? (queryClient.getQueryData<any>(qk.character(f.spec.characterId)) ?? null) : null;
      send(f, {
        t: 'init',
        kind: f.spec.kind,
        guard: guardPrelude(f.spec.budgetMs ?? 1500, fn),
        code,
        html,
        compat: !!settingsCompat,
        snapshot: settingsCompat ? await snapshot(f) : undefined,
        theme: tv.vars,
        dark: tv.dark,
        ctx: {
          chatId: f.spec.chatId ?? null,
          characterId: f.spec.characterId ?? null,
          messageId: f.spec.messageId ?? null,
          messageIndex: f.spec.messageIndex,
          scriptId: f.spec.scriptId ?? f.spec.key,
          scriptName: f.spec.name,
          frameName: `${f.spec.kind}-${f.id}`,
          kind: f.spec.kind,
          content: f.spec.content,
          permissions: [...f.perms],
          userName: f.perms.has('chat.read') ? (chat?.personaName ?? undefined) : undefined,
          charName: f.perms.has('chat.read') ? (character?.name ?? undefined) : undefined,
        },
      });
      return;
    }
    case 'pong':
      f.lastPong = Date.now();
      return;
    case 'height':
      f.onHeight?.(Math.max(0, Math.min(20_000, Number(m.h) || 0)));
      return;
    case 'log':
      logTo(f.spec.key, (['log', 'info', 'warn', 'error'].includes(m.level) ? m.level : 'log') as ConsoleEntry['level'], (Array.isArray(m.args) ? m.args : [String(m.args)]).join(' '));
      return;
    case 'subscribe':
      if (typeof m.name === 'string' && m.name.length < 80) f.subscribed.add(m.name);
      return;
    case 'reply': {
      const c = f.calls.get(m.id);
      if (!c) return;
      f.calls.delete(m.id);
      clearTimeout(c.timer);
      if (m.ok) c.resolve(m.value);
      else c.reject(new Error(String(m.error ?? 'Failed')));
      return;
    }
    case 'rpc': {
      const id = m.id;
      try {
        const value = await dispatch(f, String(m.method), (m.args ?? {}) as Record<string, any>);
        send(f, { t: 'res', id, ok: true, value: value === undefined ? null : value });
      } catch (err) {
        const msg = (err as Error).message || 'Failed';
        logTo(f.spec.key, 'warn', `${m.method}: ${msg}`);
        send(f, { t: 'res', id, ok: false, error: msg, code: (err as any).code });
      }
      return;
    }
  }
}

// ------------------------------------------------------------------ the bridge

class PermissionError extends Error {
  code = 'permission';
}

/** Which permission each call needs (null: none). Anything not listed doesn't exist. */
const NEEDS: Record<string, ScriptPermission | null> = {
  'chat.messages': 'chat.read',
  'chat.get': 'chat.read',
  'chat.current': 'chat.read',
  'characters.current': 'chat.read',
  'persona.current': 'chat.read',
  'chat.send': 'chat.write',
  'chat.add': 'chat.write',
  'chat.edit': 'chat.write',
  'chat.hide': 'chat.write',
  'chat.delete': 'chat.write',
  'chat.swipe': 'chat.write',
  generate: 'generate',
  'vars.get': 'variables',
  'vars.all': 'variables',
  'vars.set': 'variables',
  'vars.replace': 'variables',
  'macros.set': 'variables',
  'lore.list': 'lorebook.read',
  'lore.entries': 'lorebook.read',
  'lore.setEntry': 'lorebook.write',
  'lore.createEntry': 'lorebook.write',
  'lore.deleteEntry': 'lorebook.write',
  'state.get': 'state.read',
  'state.propose': 'state.ops',
  'avatar.emote': 'avatar',
  'avatar.pose': 'avatar',
  'ui.toast': 'ui.panel',
  'ui.panel': 'ui.panel',
  'ui.closePanel': 'ui.panel',
  'ui.modal': 'ui.panel',
  'audio.play': 'audio',
  'audio.stop': 'audio',
  'storage.get': 'storage',
  'storage.set': 'storage',
  'net.fetch': 'network',
  'slash.run': null,
  'slash.register': null,
};

/** Chat-level actions only the story view can do (sending runs the normal reply flow). */
export interface ChatBridge {
  chatId: string;
  send: (text: string) => Promise<void>;
  swipeNew: () => Promise<void>;
}
const bridges = new Map<string, ChatBridge>();
export function setChatBridge(b: ChatBridge | null, chatId?: string) {
  if (b) bridges.set(b.chatId, b);
  else if (chatId) bridges.delete(chatId);
}

function needChat(f: Frame): string {
  if (!f.spec.chatId) throw new Error('This only works inside a chat');
  return f.spec.chatId;
}

const msgOut = (m: MessageDTO, index: number) => ({ id: m.id, index, role: m.role, name: m.name, text: m.swipes[m.swipeId]?.text ?? '', hidden: m.hidden, swipeId: m.swipeId, swipeCount: m.swipes.length, vars: m.swipes[m.swipeId]?.vars ?? {} });

async function chatVars(chatId: string): Promise<VarMap> {
  return ((await get(`/api/chats/${chatId}`)).metadata?.vars ?? {}) as VarMap;
}

async function bookFor(ref: string) {
  const list = await get<any[]>('/api/lorebooks');
  const b = list.find((x) => x.id === ref) ?? list.find((x) => x.name === ref);
  if (!b) throw new Error(`No lorebook called “${ref}”`);
  return b;
}
const entryOut = (e: any) => ({ uid: e.uid, comment: e.comment, content: e.content, keys: e.key, secondary_keys: e.keysecondary, enabled: !e.disable, constant: e.constant, position: e.position, depth: e.depth, order: e.order, probability: e.probability });
function entryIn(cur: any, e: any) {
  const out = { ...cur };
  if (e.comment !== undefined) out.comment = String(e.comment);
  if (e.content !== undefined) out.content = String(e.content);
  if (Array.isArray(e.keys)) out.key = e.keys.map(String);
  if (Array.isArray(e.secondary_keys)) out.keysecondary = e.secondary_keys.map(String);
  if (typeof e.enabled === 'boolean') out.disable = !e.enabled;
  if (typeof e.constant === 'boolean') out.constant = e.constant;
  if (typeof e.depth === 'number') out.depth = e.depth;
  if (typeof e.order === 'number') out.order = e.order;
  if (typeof e.probability === 'number') out.probability = e.probability;
  return out;
}

const audios = new Map<string, HTMLAudioElement>();

async function dispatch(f: Frame, method: string, a: Record<string, any>): Promise<unknown> {
  if (!(method in NEEDS)) throw new Error(`Unknown call ${method}`);
  const need = NEEDS[method];
  if (need && !f.perms.has(need)) throw new PermissionError(`${f.spec.name} needs the “${PERMISSION_INFO[need].label}” permission for ${method}`);
  switch (method) {
    case 'chat.messages': {
      const chatId = needChat(f);
      const list = await get<MessageDTO[]>(`/api/chats/${chatId}/messages`);
      const out = list.map(msgOut);
      return typeof a.last === 'number' ? out.slice(-Math.max(1, a.last)) : out;
    }
    case 'chat.get': {
      const list = await get<MessageDTO[]>(`/api/chats/${needChat(f)}/messages`);
      const i = list.findIndex((m) => m.id === a.id);
      return i >= 0 ? msgOut(list[i]!, i) : null;
    }
    case 'chat.current': {
      const c = await get(`/api/chats/${needChat(f)}`);
      return { id: c.id, title: c.title, characterId: c.characterId, groupId: c.groupId };
    }
    case 'characters.current': {
      const id = f.spec.characterId ?? (f.spec.chatId ? (await get(`/api/chats/${f.spec.chatId}`)).characterId : null);
      if (!id) return null;
      const c = await get(`/api/characters/${id}`);
      return { id: c.id, name: c.name, description: c.card.description, personality: c.card.personality, scenario: c.card.scenario, firstMessage: c.card.first_mes, creator: c.card.creator, tags: c.card.tags };
    }
    case 'persona.current': {
      const c = f.spec.chatId ? await get(`/api/chats/${f.spec.chatId}`) : null;
      const list = await get<any[]>('/api/personas');
      const p = (c?.personaId && list.find((x) => x.id === c.personaId)) || list.find((x) => x.isDefault) || list[0];
      return p ? { id: p.id, name: p.name, description: p.description } : null;
    }
    case 'chat.send': {
      const b = bridges.get(needChat(f));
      if (!b) throw new Error('Open the chat to send messages');
      await b.send(String(a.text ?? ''));
      return true;
    }
    case 'chat.add': {
      const chatId = needChat(f);
      const role = ['user', 'assistant', 'system'].includes(a.role) ? a.role : 'assistant';
      let m = await post<MessageDTO>(`/api/chats/${chatId}/messages`, { role, name: a.name ? String(a.name).slice(0, 120) : undefined, text: String(a.text ?? ''), characterId: role === 'assistant' ? (f.spec.characterId ?? null) : null });
      if (a.data && typeof a.data === 'object') m = await patch<MessageDTO>(`/api/messages/${m.id}/vars`, { set: a.data, replace: true });
      if (a.hidden) m = await patch<MessageDTO>(`/api/messages/${m.id}`, { hidden: true });
      upsertMessage(m);
      return { id: m.id };
    }
    case 'chat.edit':
      upsertMessage(await patch(`/api/messages/${a.id}`, { text: String(a.text ?? '') }));
      return true;
    case 'chat.hide':
      upsertMessage(await patch(`/api/messages/${a.id}`, { hidden: a.hidden !== false }));
      return true;
    case 'chat.delete': {
      const r = await del<{ ids: string[] }>(`/api/messages/${a.id}`);
      const chatId = needChat(f);
      queryClient.setQueryData<MessageDTO[]>(qk.messages(chatId), (l) => l?.filter((x) => !r.ids.includes(x.id)));
      return true;
    }
    case 'chat.swipe': {
      const chatId = needChat(f);
      const list = await get<MessageDTO[]>(`/api/chats/${chatId}/messages`);
      const m = list.find((x) => x.id === a.id) ?? list[list.length - 1];
      if (!m) throw new Error('No message');
      const to = a.to === 'next' || a.to === undefined ? m.swipeId + 1 : a.to === 'prev' ? m.swipeId - 1 : Number(a.to);
      if (to >= m.swipes.length) {
        const b = bridges.get(chatId);
        if (!b) throw new Error('Open the chat to make a new swipe');
        await b.swipeNew();
        return true;
      }
      upsertMessage(await post(`/api/messages/${m.id}/swipe`, { swipeId: Math.max(0, to) }));
      return true;
    }
    case 'generate': {
      const body: Record<string, unknown> = { key: f.spec.key, model: a.model === 'utility' ? 'utility' : 'main', maxTokens: Math.min(4000, Number(a.maxTokens) || 600) };
      if (a.temperature !== undefined) body.temperature = Number(a.temperature);
      if (Array.isArray(a.messages)) body.messages = a.messages.map((m: any) => ({ role: ['system', 'user', 'assistant'].includes(m.role) ? m.role : 'user', content: String(m.content ?? '') }));
      else if (typeof a.prompt === 'string') body.messages = [...(a.system ? [{ role: 'system', content: String(a.system) }] : []), { role: 'user', content: a.prompt }];
      else {
        body.chatId = needChat(f);
        if (a.userInput) body.userInput = String(a.userInput);
        if (a.systemOverride) body.systemOverride = String(a.systemOverride);
      }
      if (typeof a.stream === 'string' && a.stream) {
        let full = '';
        for await (const ev of streamPost<{ type: string; text?: string; error?: string }>('/api/scripts/run/generate', { ...body, stream: true })) {
          if (ev.type === 'delta' && ev.text) {
            full += ev.text;
            send(f, { t: 'event', name: `generate.${a.stream}`, data: { text: ev.text, full } });
          } else if (ev.type === 'error') throw new Error(ev.error ?? 'Generation failed');
        }
        return full;
      }
      return (await post<{ text: string }>('/api/scripts/run/generate', body)).text;
    }
    case 'vars.get':
    case 'vars.all':
    case 'vars.set':
    case 'vars.replace': {
      const scope = ['global', 'character', 'chat', 'message', 'script'].includes(a.scope) ? a.scope : 'chat';
      const key = a.key === undefined ? undefined : String(a.key);
      const read = async (): Promise<VarMap> => {
        if (scope === 'chat') return chatVars(needChat(f));
        if (scope === 'global') return get('/api/scripts/vars', { scope: 'global' });
        if (scope === 'character') {
          if (!f.spec.characterId) throw new Error('No character here');
          return get('/api/scripts/vars', { scope: 'character', scopeId: f.spec.characterId });
        }
        if (scope === 'script') {
          if (!f.perms.has('storage')) throw new PermissionError('Script variables need the “Keep its own data” permission');
          return ((await get('/api/scripts/run/storage', { key: f.spec.key, k: '__variables' })).value ?? {}) as VarMap;
        }
        const list = await get<MessageDTO[]>(`/api/chats/${needChat(f)}/messages`);
        const m = list.find((x) => x.id === (a.messageId ?? f.spec.messageId)) ?? list[list.length - 1];
        return (m?.swipes[m.swipeId]?.vars ?? {}) as VarMap;
      };
      if (method === 'vars.get') return (await read())[key ?? ''] ?? null;
      if (method === 'vars.all') return read();
      const write = async (next: VarMap, replace: boolean) => {
        if (scope === 'chat') {
          const chatId = needChat(f);
          const cur = replace ? {} : await chatVars(chatId);
          for (const [k, v] of Object.entries(next)) if (v === null) delete cur[k];
            else cur[k] = v;
          const c = await patch(`/api/chats/${chatId}`, { metadata: { vars: cur } });
          queryClient.setQueryData(qk.chat(chatId), c);
          return cur;
        }
        if (scope === 'global' || scope === 'character') return patch('/api/scripts/vars', { scope, scopeId: scope === 'character' ? f.spec.characterId : '', set: next, replace });
        if (scope === 'script') {
          const cur = replace ? {} : await read();
          const merged = { ...cur, ...next };
          for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
          await put('/api/scripts/run/storage', { key: f.spec.key, k: '__variables', value: merged });
          return merged;
        }
        const list = await get<MessageDTO[]>(`/api/chats/${needChat(f)}/messages`);
        const m = list.find((x) => x.id === (a.messageId ?? f.spec.messageId)) ?? list[list.length - 1];
        if (!m) throw new Error('No message');
        const up = await patch<MessageDTO>(`/api/messages/${m.id}/vars`, { set: next, replace });
        upsertMessage(up);
        return up.swipes[up.swipeId]?.vars ?? {};
      };
      const value = method === 'vars.replace' ? await write((a.value ?? {}) as VarMap, true) : await write({ [key ?? '']: a.value === undefined ? null : a.value }, false);
      emitToFrames('vars', { chatId: f.spec.chatId, [scope]: value });
      return method === 'vars.replace' ? true : (value as VarMap)[key ?? ''] ?? null;
    }
    case 'macros.set': {
      const chatId = needChat(f);
      const name = String(a.name ?? '').replace(/[^\w.-]/g, '').slice(0, 60);
      if (!name) throw new Error('Name the macro');
      const cur = await chatVars(chatId);
      cur[`__script.${name}`] = String(a.value ?? '');
      queryClient.setQueryData(qk.chat(chatId), await patch(`/api/chats/${chatId}`, { metadata: { vars: cur } }));
      return true;
    }
    case 'lore.list': {
      const list = await get<any[]>('/api/lorebooks');
      return list.map((b) => ({ id: b.id, name: b.name, scope: b.scope, enabled: b.enabled, entries: b.entryCount }));
    }
    case 'lore.entries': {
      const b = await bookFor(String(a.book ?? ''));
      return Object.values(b.book.entries).map(entryOut);
    }
    case 'lore.setEntry':
    case 'lore.createEntry':
    case 'lore.deleteEntry': {
      const b = await bookFor(String(a.book ?? ''));
      const entries = { ...b.book.entries } as Record<string, any>;
      let uid: number;
      if (method === 'lore.createEntry') {
        uid = Math.max(-1, ...Object.values(entries).map((e: any) => Number(e.uid) || 0)) + 1;
        entries[String(uid)] = entryIn({ uid, key: [], keysecondary: [], comment: '', content: '', constant: false, selective: true, order: 100, position: 0, disable: false, probability: 100, useProbability: true, depth: 4 }, a.entry ?? {});
      } else {
        uid = Number(method === 'lore.deleteEntry' ? a.uid : a.entry?.uid);
        const k = Object.keys(entries).find((x) => Number(entries[x].uid) === uid);
        if (k === undefined) throw new Error(`No entry ${uid} in ${b.name}`);
        if (method === 'lore.deleteEntry') delete entries[k];
        else entries[k] = entryIn(entries[k], a.entry ?? {});
      }
      await put(`/api/lorebooks/${b.id}`, { book: { ...b.book, entries } });
      void queryClient.invalidateQueries({ queryKey: ['lorebooks'] });
      return { uid };
    }
    case 'state.get': {
      const c = await get(`/api/chats/${needChat(f)}`);
      if (!c.campaignId) return null;
      return (await get(`/api/campaigns/${c.campaignId}`)).state;
    }
    case 'state.propose': {
      const r = await post<{ applied: number; summary?: string[]; errors: string[] }>('/api/scripts/run/ops', { key: f.spec.key, chatId: needChat(f), ops: Array.isArray(a.ops) ? a.ops : [] });
      const c = queryClient.getQueryData<any>(qk.chat(needChat(f)));
      if (c?.campaignId) void queryClient.invalidateQueries({ queryKey: qk.campaign(c.campaignId) });
      return r;
    }
    case 'avatar.emote':
    case 'avatar.pose': {
      const op = method === 'avatar.emote' ? { type: 'avatar.emote', who: String(a.who ?? ''), emote: String(a.emote ?? '') } : { type: 'avatar.pose', who: String(a.who ?? ''), pose: a.pose == null ? null : String(a.pose) };
      const r = await post<{ applied: number; errors: string[] }>('/api/scripts/run/avatar', { key: f.spec.key, chatId: needChat(f), op });
      const c = queryClient.getQueryData<any>(qk.chat(needChat(f)));
      if (c?.campaignId) void queryClient.invalidateQueries({ queryKey: qk.campaign(c.campaignId) });
      return r;
    }
    case 'ui.toast': {
      const tone = ['success', 'danger', 'neutral'].includes(a.tone) ? a.tone : a.tone === 'error' || a.tone === 'warning' ? 'danger' : 'neutral';
      toast({ title: String(a.message ?? '').slice(0, 200), lines: [f.spec.name], tone });
      return true;
    }
    case 'ui.panel': {
      const id = `${f.spec.key}:${String(a.id ?? 'panel')}`;
      const panel = { id, title: String(a.title ?? f.spec.name).slice(0, 80), spec: { ...f.spec, kind: 'panel' as const, code: typeof a.code === 'string' ? a.code : undefined, html: typeof a.html === 'string' ? a.html : '<div></div>' } };
      useScriptUi.setState((s) => ({ panels: [...s.panels.filter((p) => p.id !== id), panel] }));
      return true;
    }
    case 'ui.closePanel':
      useScriptUi.setState((s) => ({ panels: s.panels.filter((p) => !p.id.startsWith(`${f.spec.key}:`)) }));
      return true;
    case 'ui.modal': {
      const fields: ModalField[] = (Array.isArray(a.fields) ? a.fields : []).slice(0, 12).map((x: any, i: number) => ({ id: String(x.id ?? `f${i}`), label: String(x.label ?? '').slice(0, 80), type: ['text', 'textarea', 'number', 'select', 'checkbox'].includes(x.type) ? x.type : 'text', options: Array.isArray(x.options) ? x.options.slice(0, 50).map((o: any) => (typeof o === 'object' ? { value: String(o.value), label: String(o.label ?? o.value) } : { value: String(o), label: String(o) })) : undefined, value: x.value === undefined ? undefined : String(x.value) }));
      const buttons = (Array.isArray(a.buttons) && a.buttons.length ? a.buttons : [{ id: 'ok', label: 'OK', tone: 'primary' }]).slice(0, 4).map((b: any, i: number) => ({ id: String(b.id ?? `b${i}`), label: String(b.label ?? 'OK').slice(0, 40), tone: b.tone === 'danger' ? ('danger' as const) : b.tone === 'primary' ? ('primary' as const) : undefined }));
      return new Promise((resolve) => useScriptUi.setState({ modal: { title: String(a.title ?? f.spec.name).slice(0, 100), body: a.body ? String(a.body).slice(0, 2000) : undefined, fields, buttons, from: f.spec.name, resolve } }));
    }
    case 'audio.play': {
      const src = String(a.src ?? '');
      if (!/^(data:audio\/|\/media\/|blob:)/.test(src)) throw new Error('Sounds must be data: addresses or Everloom media');
      const id = String(a.id ?? 'default');
      audios.get(`${f.spec.key}:${id}`)?.pause();
      const el = new Audio(src);
      el.volume = Math.max(0, Math.min(1, Number(a.volume ?? 1)));
      el.loop = !!a.loop;
      audios.set(`${f.spec.key}:${id}`, el);
      await el.play().catch(() => undefined);
      return true;
    }
    case 'audio.stop': {
      for (const [k, el] of audios) if (k.startsWith(`${f.spec.key}:`) && (a.id === undefined || k === `${f.spec.key}:${a.id}`)) el.pause();
      return true;
    }
    case 'storage.get':
      return (await get('/api/scripts/run/storage', { key: f.spec.key, k: a.k === undefined ? undefined : String(a.k) })).value;
    case 'storage.set':
      await put('/api/scripts/run/storage', { key: f.spec.key, k: String(a.k ?? ''), value: a.value ?? null });
      return true;
    case 'net.fetch':
      return post('/api/scripts/run/fetch', { key: f.spec.key, url: String(a.url ?? ''), method: a.method ?? 'GET', headers: a.headers ?? {}, body: a.body === undefined ? undefined : typeof a.body === 'string' ? a.body : JSON.stringify(a.body) });
    case 'slash.run': {
      const { runSlashLine } = await import('./commands');
      return runSlashLine(String(a.line ?? ''), { perms: f.perms, chatId: f.spec.chatId ?? null, from: f.spec.name });
    }
    case 'slash.register': {
      const name = String(a.name ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);
      if (!name) throw new Error('Name the command');
      if (slashRegistry.get(name) && !slashRegistry.get(name)!.source?.startsWith('script:')) throw new Error(`/${name} is already a built-in command`);
      const off = slashRegistry.register({ name, help: String(a.help ?? '').slice(0, 200), usage: a.usage ? String(a.usage).slice(0, 200) : undefined, source: `script:${f.spec.name}`, run: async (call) => String((await callFrame(f, `slash:${name}`, [call], 15_000)) ?? '') });
      f.slash.push(off);
      return true;
    }
  }
  throw new Error(`Unknown call ${method}`);
}

/** Stop every frame belonging to a key (from the scripts sheet). */
export function stopKey(key: string) {
  for (const f of [...frames.values()]) if (f.spec.key === key) dispose(f, 'Stopped by you');
}

/** Frames currently running for a key. */
export function framesFor(key: string): number {
  let n = 0;
  for (const f of frames.values()) if (f.spec.key === key && !f.stopped) n++;
  return n;
}

export function runningCount(kind?: FrameKind): number {
  let n = 0;
  for (const f of frames.values()) if (!kind || f.spec.kind === kind) n++;
  return n;
}

/** Re-send the theme to every frame (after a theme change). */
export function refreshThemes() {
  const t = themeVars();
  for (const f of frames.values()) if (f.ready) send(f, { t: 'theme', vars: t.vars, dark: t.dark });
}

export { api };
