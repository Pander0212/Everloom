/**
 * Slash commands typed in the composer (or run by quick replies, scripts and extensions).
 * `/name key=value text | /next {{pipe}}`. A command run by a script is checked against that
 * script's permissions; the owner can run everything.
 */
import { createRng, expandMacros, rollDice, runSlash, seedFrom, type MessageDTO, type ScriptPermission, type SlashCall } from '@everloom/engine';
import { get, patch, post } from '@/lib/api';
import { qk, queryClient, upsertMessage } from '@/lib/queries';
import { toast } from '@/lib/store';
import { scriptBus } from './bus';
import { slashRegistry, type SlashCtx } from './registry';

/** What the story view lends to commands (sending runs the normal reply flow). */
export interface ChatActions {
  chatId: string;
  generate: (type: 'normal' | 'swipe' | 'regenerate' | 'continue' | 'impersonate', text?: string) => Promise<string | null>;
  setComposer: (text: string) => void;
  stop: () => void;
}
const chats = new Map<string, ChatActions>();
export function setChatActions(a: ChatActions | null, chatId?: string) {
  if (a) chats.set(a.chatId, a);
  else if (chatId) chats.delete(chatId);
}

/** Quick replies currently shown, so /qr can find them by label. */
let quickReplies: Array<{ label: string; message: string }> = [];
export const setQuickReplies = (list: Array<{ label: string; message: string }>) => {
  quickReplies = list;
};
/** Script buttons currently shown, so /run can press them by script name. */
let scriptButtons: Array<{ name: string; key: string; buttonId: string }> = [];
export const setScriptButtons = (list: Array<{ name: string; key: string; buttonId: string }>) => {
  scriptButtons = list;
};

function need(ctx: SlashCtx, perm: ScriptPermission) {
  if (ctx.perms !== 'owner' && !ctx.perms.has(perm)) throw new Error(`needs the “${perm}” permission`);
}
function chatOf(ctx: SlashCtx): string {
  if (!ctx.chatId) throw new Error('only works in a chat');
  return ctx.chatId;
}
function actions(ctx: SlashCtx): ChatActions {
  const a = chats.get(chatOf(ctx));
  if (!a) throw new Error('open the chat first');
  return a;
}
async function chatVars(chatId: string): Promise<Record<string, any>> {
  return ((await get(`/api/chats/${chatId}`)).metadata?.vars ?? {}) as Record<string, any>;
}
async function setChatVars(chatId: string, vars: Record<string, any>) {
  queryClient.setQueryData(qk.chat(chatId), await patch(`/api/chats/${chatId}`, { metadata: { vars } }));
}
async function campaignOf(chatId: string): Promise<string> {
  const c = await get(`/api/chats/${chatId}`);
  if (!c.campaignId) throw new Error('this chat has no game');
  return c.campaignId;
}
async function ops(ctx: SlashCtx, list: unknown[]) {
  const chatId = chatOf(ctx);
  const campaignId = await campaignOf(chatId);
  const r = await post<{ summary?: string[]; errors: string[] }>(`/api/campaigns/${campaignId}/ops`, { chatId, ops: list });
  void queryClient.invalidateQueries({ queryKey: qk.campaign(campaignId) });
  if (r.errors?.length) throw new Error(r.errors.join('; '));
  return (r.summary ?? []).join(', ');
}
async function addMessage(ctx: SlashCtx, role: 'user' | 'assistant' | 'system', text: string, name?: string) {
  const chatId = chatOf(ctx);
  const m = await post<MessageDTO>(`/api/chats/${chatId}/messages`, { role, text, name });
  upsertMessage(m);
  scriptBus.emit(role === 'user' ? 'messageSent' : 'message', { chatId, messageId: m.id });
  return '';
}

type Run = (c: SlashCall, ctx: SlashCtx) => Promise<string | void> | string | void;
function def(name: string, help: string, usage: string, perm: ScriptPermission | null, run: Run, aliases: string[] = []) {
  slashRegistry.register({
    name,
    aliases,
    help,
    usage,
    source: 'Everloom',
    run: (c, ctx) => {
      if (perm) need(ctx, perm);
      return run(c, ctx);
    },
  });
}

let installed = false;
export function installBuiltins() {
  if (installed) return;
  installed = true;
  def('help', 'List the commands', '/help', null, () => {
    const lines = slashRegistry.list().map((d) => `/${d.name} — ${d.help}`);
    toast({ title: 'Commands', lines: lines.slice(0, 40), duration: 12_000 });
    return lines.join('\n');
  });
  def('echo', 'Show a notice', '/echo Hello', null, (c) => {
    if (c.text) toast(c.text);
    return c.text;
  });
  def('roll', 'Roll dice (2d6+1, d20)', '/roll 2d6+1', null, (c) => {
    const notation = (c.text || 'd20').trim();
    const r = rollDice(notation, createRng(seedFrom(Date.now(), Math.random())));
    if (!r) throw new Error(`can't read “${notation}”`);
    if (!c.args.quiet) toast({ title: `Rolled ${notation}: ${r.total}`, lines: r.rolls.length > 1 ? [r.rolls.join(' + ')] : undefined });
    return String(r.total);
  }, ['r']);
  def('sys', 'Add a narrator line (no reply)', '/sys The rain stops.', 'chat.write', (c, ctx) => addMessage(ctx, 'system', c.text, c.args.name), ['narrate']);
  def('send', 'Add your message without a reply', '/send I wait.', 'chat.write', (c, ctx) => addMessage(ctx, 'user', c.text));
  def('sendas', 'Add a message as someone', '/sendas name=Mira Hello.', 'chat.write', (c, ctx) => addMessage(ctx, 'assistant', c.text, c.args.name || undefined));
  def('trigger', 'Ask for a reply now', '/trigger', 'chat.write', async (_c, ctx) => void (await actions(ctx).generate('normal')));
  def('continue', 'Continue the last reply', '/continue', 'chat.write', async (_c, ctx) => void (await actions(ctx).generate('continue')));
  def('swipe', 'A new version of the last reply', '/swipe', 'chat.write', async (_c, ctx) => void (await actions(ctx).generate('swipe')));
  def('impersonate', 'Write your next line for you', '/impersonate', 'chat.write', async (_c, ctx) => {
    const t = await actions(ctx).generate('impersonate');
    if (t) actions(ctx).setComposer(t);
    return t ?? '';
  });
  def('stop', 'Stop the reply being written', '/stop', 'chat.write', (_c, ctx) => actions(ctx).stop());
  def('gen', 'Ask the model something (not added to the chat)', '/gen Name three inns', 'generate', async (c, ctx) => {
    if (!c.text) throw new Error('say what to ask');
    if (ctx.perms !== 'owner') throw new Error('scripts use everloom.generate()');
    return (await post<{ text: string }>('/api/scripts/user-generate', { prompt: c.text, model: c.args.model === 'main' ? 'main' : 'utility' })).text;
  });
  // Variables (chat scope unless noted).
  const varName = (c: SlashCall) => (c.args.key ?? c.args.name ?? c.text.split(/\s+/)[0] ?? '').trim();
  const restText = (c: SlashCall) => (c.args.key || c.args.name ? c.text : c.text.split(/\s+/).slice(1).join(' '));
  def('setvar', 'Set a chat variable', '/setvar key=hp 10', 'variables', async (c, ctx) => {
    const k = varName(c);
    if (!k) throw new Error('name the variable');
    const chatId = chatOf(ctx);
    const v = await chatVars(chatId);
    v[k] = c.args.value ?? restText(c);
    await setChatVars(chatId, v);
    return String(v[k]);
  });
  def('getvar', 'Read a chat variable', '/getvar hp', 'variables', async (c, ctx) => {
    const v = (await chatVars(chatOf(ctx)))[varName(c)];
    return v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
  const bump = (by: (cur: number, n: number) => number) => async (c: SlashCall, ctx: SlashCtx) => {
    const k = varName(c);
    const chatId = chatOf(ctx);
    const v = await chatVars(chatId);
    const n = Number(c.args.value ?? restText(c) ?? 1) || 1;
    v[k] = by(Number(v[k]) || 0, n);
    await setChatVars(chatId, v);
    return String(v[k]);
  };
  def('addvar', 'Add to a chat variable', '/addvar key=gold 5', 'variables', bump((a, n) => a + n));
  def('incvar', 'Add one to a chat variable', '/incvar turns', 'variables', bump((a) => a + 1));
  def('decvar', 'Take one from a chat variable', '/decvar lives', 'variables', bump((a) => a - 1));
  def('flushvar', 'Remove a chat variable', '/flushvar hp', 'variables', async (c, ctx) => {
    const chatId = chatOf(ctx);
    const v = await chatVars(chatId);
    delete v[varName(c)];
    await setChatVars(chatId, v);
  });
  def('setglobalvar', 'Set a variable shared by every chat', '/setglobalvar key=day 3', 'variables', async (c) => {
    const k = varName(c);
    await patch('/api/scripts/vars', { scope: 'global', set: { [k]: c.args.value ?? restText(c) } });
    return c.args.value ?? restText(c);
  });
  def('getglobalvar', 'Read a shared variable', '/getglobalvar day', 'variables', async (c) => {
    const v = (await get('/api/scripts/vars', { scope: 'global' }))[varName(c)];
    return v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
  // Game commands (through the same checks as any change; they roll back with the message).
  def('travel', 'Go somewhere (game)', '/travel Millbrook', 'state.ops', (c, ctx) => ops(ctx, [{ type: 'location.move', name: c.text.trim() }]), ['go']);
  def('give', 'Add an item (game)', '/give qty=2 Rope', 'state.ops', (c, ctx) => ops(ctx, [{ type: 'item.add', name: c.text.trim(), qty: Number(c.args.qty ?? 1) || 1 }]));
  def('take', 'Remove an item (game)', '/take Rope', 'state.ops', (c, ctx) => ops(ctx, [{ type: 'item.remove', name: c.text.trim(), qty: Number(c.args.qty ?? 1) || 1 }]));
  def('money', 'Change your money (game)', '/money -5', 'state.ops', (c, ctx) => ops(ctx, [{ type: 'currency.delta', amount: Number(c.text) || 0 }]));
  def('wait', 'Let time pass (game)', '/wait 30', 'state.ops', (c, ctx) => ops(ctx, [{ type: 'time.advance', minutes: Math.max(1, Number(c.text) || 10) }]));
  // 3D characters: who= defaults to the chat's character; emotes by id, name or alias.
  const whoOf = async (c: SlashCall, ctx: SlashCtx) => {
    if (c.args.who) return c.args.who;
    const chat = await get(`/api/chats/${chatOf(ctx)}`);
    if (!chat.characterId) throw new Error('say who: /emote who=Name wave');
    return (await get(`/api/characters/${chat.characterId}`)).name as string;
  };
  def('emote', 'A 3D character does something (wave, bow, laugh…)', '/emote wave  or  /emote who=Mira bow', 'avatar', async (c, ctx) => ops(ctx, [{ type: 'avatar.emote', who: await whoOf(c, ctx), emote: c.text.trim().toLowerCase().replace(/[\s-]+/g, '_') }]));
  def('pose', 'A 3D character holds a pose (sit, sleep, dance…; "stand" to stop)', '/pose sit', 'avatar', async (c, ctx) => {
    const p = c.text.trim();
    return ops(ctx, [{ type: 'avatar.pose', who: await whoOf(c, ctx), pose: !p || /^(stand|none|idle)$/i.test(p) ? null : p.toLowerCase().replace(/[\s-]+/g, '_') }]);
  });
  def('qr', 'Use a quick reply by its label', '/qr Look around', 'chat.write', async (c, ctx) => {
    const q = quickReplies.find((x) => x.label.toLowerCase() === c.text.trim().toLowerCase());
    if (!q) throw new Error(`no quick reply called “${c.text}”`);
    if (q.message.trim().startsWith('/')) return runSlashLine(q.message, ctx);
    await actions(ctx).generate('normal', q.message);
    return '';
  });
  def('run', 'Press a script’s button', '/run Dice', null, (c, ctx) => {
    const b = scriptButtons.find((x) => x.name.toLowerCase() === c.text.trim().toLowerCase());
    if (!b) throw new Error(`no script button called “${c.text}”`);
    scriptBus.emit('button', { chatId: ctx.chatId, key: b.key, button: b.buttonId });
  });
  def('len', 'Length of a text', '/len hello', null, (c) => String(c.text.length));
}

/** Run a line of commands. Errors come back as a notice (owner) or an exception (scripts). */
export async function runSlashLine(line: string, ctx: SlashCtx): Promise<string> {
  installBuiltins();
  const chat = ctx.chatId ? queryClient.getQueryData<any>(qk.chat(ctx.chatId)) : null;
  const vars = { ...(chat?.metadata?.vars ?? {}) };
  const r = await runSlash(line, slashRegistry, ctx, { expand: (t) => expandMacros(t, { vars, user: undefined, char: undefined }) });
  if (!r.ok) {
    if (ctx.perms === 'owner') toast({ title: 'Command failed', lines: [r.error], tone: 'danger' });
    else throw new Error(r.error);
    return '';
  }
  return r.result;
}

/** Is this composer text a command? (A leading slash and a letter; "//" sends a plain slash.) */
export const isCommand = (text: string) => /^\/[a-z]/i.test(text.trim());
