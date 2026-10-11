/**
 * Everloom script and extension API. Every script, panel, screen and interactive message runs in a
 * sandboxed frame; `everloom` is its only way out, and every call is checked against the permissions
 * the owner approved. Calls that need a permission reject with an error when it wasn't granted.
 *
 * Use with a triple-slash reference: /// <reference types="@everloom/script-types" />
 */

export type Permission =
  | 'chat.read'
  | 'chat.write'
  | 'variables'
  | 'lorebook.read'
  | 'lorebook.write'
  | 'state.read'
  | 'state.ops'
  | 'avatar'
  | 'generate'
  | 'ui.panel'
  | 'audio'
  | 'storage'
  | 'network';

export type Trigger = 'load' | 'chatOpen' | 'beforeGeneration' | 'afterGeneration' | 'messageReceived' | 'swipe' | 'button' | 'timer' | 'entryActivated';

export type VarValue = string | number | boolean | null | VarValue[] | { [k: string]: VarValue };
export type VarScope = 'chat' | 'global' | 'character' | 'message' | 'script';

export interface ChatMessage {
  id: string;
  /** Position in the chat (0 = the first message). */
  index: number;
  role: 'user' | 'assistant' | 'system';
  name: string;
  text: string;
  hidden: boolean;
  swipeId: number;
  swipeCount: number;
  /** Message variables on the current swipe. */
  vars: Record<string, VarValue>;
}

export interface EventData {
  chatId?: string | null;
  messageId?: string;
  messageIndex?: number;
  /** For "button": which button. */
  button?: string;
  /** Present only with chat.read. */
  messages?: Array<{ id: string; name: string; role: string; text: string; hidden: boolean; swipeId: number; swipes: string[]; data: Record<string, VarValue> }>;
  [k: string]: unknown;
}

export type EventName =
  | 'chatOpen'
  | 'beforeGeneration'
  | 'generationStart'
  | 'generationEnd'
  | 'message'
  | 'messageSent'
  | 'swipe'
  | 'edit'
  | 'delete'
  | 'button'
  | 'timer'
  | 'vars';

export interface GenerateOptions {
  /** Raw messages, sent as they are. */
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  /** Or a single prompt (with an optional system line). */
  prompt?: string;
  system?: string;
  /** Neither: the chat's own prompt, as for a reply, with this as the player's turn. */
  userInput?: string;
  /** Replaces the chat prompt's top system message. */
  systemOverride?: string;
  model?: 'main' | 'utility';
  maxTokens?: number;
  temperature?: number;
  /** Streams: called with each new piece and the text so far. */
  onToken?: (piece: string, full: string) => void;
}

export interface ModalField {
  id: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'select' | 'checkbox';
  options?: Array<string | { value: string; label: string }>;
  value?: string;
}

export interface LoreEntry {
  uid: number;
  comment: string;
  content: string;
  keys: string[];
  secondary_keys: string[];
  enabled: boolean;
  constant: boolean;
  position: number;
  depth: number;
  order: number;
  probability: number;
}

export interface Everloom {
  readonly version: 1;
  readonly context: {
    chatId: string | null;
    characterId: string | null;
    messageId: string | null;
    messageIndex?: number;
    scriptId: string;
    scriptName: string;
    kind: 'script' | 'message' | 'panel' | 'screen' | 'settings' | 'renderer';
    permissions: Permission[];
    /** Extension message renderers: the tag's content. */
    content?: string;
  };
  /** Subscribe; returns an unsubscribe function. "beforeGeneration" handlers may return a promise (up to 3 s). */
  on(event: EventName | string, fn: (data: EventData) => unknown): () => void;
  off(event: EventName | string, fn: (data: EventData) => unknown): void;
  once(event: EventName | string, fn: (data: EventData) => unknown): () => void;

  chat: {
    /** chat.read */
    messages(opts?: { last?: number }): Promise<ChatMessage[]>;
    get(id: string): Promise<ChatMessage | null>;
    current(): Promise<{ id: string; title: string; characterId: string | null; groupId: string | null }>;
    /** chat.write: sends as the player (a reply follows, as from the message box). */
    send(text: string): Promise<true>;
    add(m: { role?: 'user' | 'assistant' | 'system'; name?: string; text: string; hidden?: boolean; data?: Record<string, VarValue> }): Promise<{ id: string }>;
    edit(id: string, text: string): Promise<true>;
    hide(id: string, hidden?: boolean): Promise<true>;
    delete(id: string): Promise<true>;
    /** A swipe index, 'next' (makes a new one at the end) or 'prev'. */
    swipe(id: string, to?: number | 'next' | 'prev'): Promise<true>;
  };
  /** generate: costs money; rate-limited; shows in the call log under the script's name. */
  generate(opts: GenerateOptions): Promise<string>;
  vars: {
    get(key: string, opts?: { scope?: VarScope; messageId?: string }): Promise<VarValue>;
    all(opts?: { scope?: VarScope; messageId?: string }): Promise<Record<string, VarValue>>;
    /** null deletes. Message variables live on the current swipe and roll back with it. */
    set(key: string, value: VarValue, opts?: { scope?: VarScope; messageId?: string }): Promise<VarValue>;
    delete(key: string, opts?: { scope?: VarScope; messageId?: string }): Promise<null>;
  };
  lore: {
    list(): Promise<Array<{ id: string; name: string; scope: string; enabled: boolean; entries: number }>>;
    /** A lorebook by id or name. */
    entries(book: string): Promise<LoreEntry[]>;
    setEntry(book: string, entry: Partial<LoreEntry> & { uid: number }): Promise<{ uid: number }>;
    createEntry(book: string, entry: Partial<LoreEntry>): Promise<{ uid: number }>;
    deleteEntry(book: string, uid: number): Promise<{ uid: number }>;
  };
  characters: { current(): Promise<{ id: string; name: string; description: string; personality: string; scenario: string; firstMessage: string; creator: string; tags: string[] } | null> };
  persona: { current(): Promise<{ id: string; name: string; description: string } | null> };
  state: {
    /** state.read: the whole game state (null without a game). */
    get(): Promise<any>;
    /** state.ops: checked like the AI's changes and tied to the newest message (they roll back with it). */
    propose(ops: object | object[]): Promise<{ applied: number; summary?: string[]; errors: string[] }>;
  };
  /** avatar: 3D characters (installed emotes only; recorded like any story change). */
  avatar: {
    emote(who: string, emote: string): Promise<{ applied: number; errors: string[] }>;
    /** A held pose (sit, sleep, a dance…); null to stand. */
    pose(who: string, pose: string | null): Promise<{ applied: number; errors: string[] }>;
    /** A paired or group animation (handshake, hug, dance together…) for two to four characters; null clip stops a looping one. */
    paired(clip: string | null, who: string[]): Promise<{ applied: number; errors: string[] }>;
  };
  ui: {
    toast(message: string, opts?: { tone?: 'neutral' | 'success' | 'danger' }): Promise<true>;
    /** A side panel with your HTML (and the same permissions). */
    panel(opts: { id?: string; title?: string; html?: string; code?: string }): Promise<true>;
    closePanel(): Promise<true>;
    /** A dialog built from Everloom's own components. */
    modal(opts: { title: string; body?: string; fields?: ModalField[]; buttons?: Array<{ id: string; label: string; tone?: 'primary' | 'danger' }> }): Promise<{ button: string | null; values: Record<string, string> }>;
    /** Report this frame's height now (it's also tracked automatically). */
    resize(): void;
  };
  audio: {
    /** data:audio/… or Everloom media (/media/…). */
    play(src: string, opts?: { id?: string; volume?: number; loop?: boolean }): Promise<true>;
    stop(id?: string): Promise<true>;
  };
  storage: {
    get(key: string): Promise<VarValue>;
    all(): Promise<Record<string, VarValue>>;
    set(key: string, value: VarValue): Promise<true>;
    delete(key: string): Promise<true>;
  };
  net: {
    /** network: https only, to the domains you declared; fetched by the server; 1 MB at most. */
    fetch(url: string, opts?: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; headers?: Record<string, string>; body?: string | object }): Promise<{ status: number; contentType: string; text: string }>;
  };
  slash: {
    /** Runs with this script's permissions. */
    run(line: string): Promise<string>;
    register(name: string, opts: { help?: string; usage?: string }, fn: (call: { name: string; args: Record<string, string>; text: string }) => unknown): Promise<true>;
    register(name: string, fn: (call: { name: string; args: Record<string, string>; text: string }) => unknown): Promise<true>;
  };
  /** variables: values for {{script::name}} in prompts and lore. */
  macros: { set(name: string, value: string | number): Promise<true> };
  log(...args: unknown[]): void;
}

/** everloom-extension.json */
export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  author?: string;
  homepage?: string;
  description?: string;
  minEverloom?: string;
  changelog?: string;
  permissions?: Permission[];
  /** For "network": the only sites it may reach (example.com, *.example.org). */
  domains?: string[];
  entries?: {
    /** A .js or .html file that runs (hidden) in every chat: event hooks, slash commands, buttons. */
    background?: string;
    panels?: Array<{ id: string; title: string; file: string; icon?: string; tile?: boolean }>;
    screens?: Array<{ id: string; title: string; file: string; icon?: string }>;
    settings?: string;
    composerButtons?: Array<{ id: string; label: string; icon?: string }>;
    slashCommands?: Array<{ name: string; help?: string; usage?: string }>;
    promptBlocks?: Array<{ id: string; text: string; position?: 'before' | 'after' | 'depth'; depth?: number; role?: 'system' | 'user' | 'assistant' }>;
    messageRenderers?: Array<{ tag: string; file: string }>;
    macros?: string[];
    ops?: ExtensionOp[];
    /** SillyTavern-format regex rules. */
    regex?: object[];
  };
  /** Power users only: a single bundled ES module run in its own Node process. */
  server?: { main: string };
}

/** A custom game op: declarative steps on state.ext[extensionId]; the inverse is computed by Everloom. */
export interface ExtensionOp {
  name: string;
  label: string;
  description?: string;
  params?: Record<string, { type: 'string' | 'number' | 'integer' | 'boolean' | 'enum'; values?: string[]; min?: number; max?: number; maxLength?: number; optional?: boolean; description?: string }>;
  steps: Array<
    | { do: 'set'; path: string; value: string | number | boolean | null }
    | { do: 'add'; path: string; value: string | number; min?: number; max?: number }
    | { do: 'push'; path: string; value: string | number | boolean | null; limit?: number }
    | { do: 'delete'; path: string }
    | { do: 'require'; path: string; check: 'exists' | 'missing' | 'gte' | 'lte'; value?: string | number; message: string }
  >;
  summary?: string;
  /** The story's AI may use it. */
  ai?: boolean;
}

/** Server extensions: the default export of the main module. */
export interface ServerApi {
  readonly id: string;
  route(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, handler: (req: { params: Record<string, string>; query: Record<string, unknown>; body: unknown }) => unknown): void;
  every(ms: number, fn: () => unknown): void;
  log(...args: unknown[]): void;
}

declare global {
  const everloom: Everloom;
}
