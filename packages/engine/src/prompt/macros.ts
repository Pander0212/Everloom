/**
 * Macro expansion: SillyTavern core set plus Everloom game macros.
 * Unknown macros are left untouched so they survive round-trips.
 */
import { createRng, rollDice, seedFrom, type Rng } from '../util/rng.js';

export interface GameMacroSource {
  location?: string;
  time?: string;
  date?: string;
  weather?: string;
  bars?: Record<string, { cur: number; max: number }>;
  trackers?: Record<string, { value: number; max: number; label: string }>;
  currency?: string;
  level?: number;
}

export interface MacroContext {
  user?: string;
  char?: string;
  group?: string;
  groupNotMuted?: string;
  notChar?: string;
  persona?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  mesExamples?: string;
  mesExamplesRaw?: string;
  charPrompt?: string;
  charInstruction?: string;
  charJailbreak?: string;
  charDepthPrompt?: string;
  charVersion?: string;
  creatorNotes?: string;
  lastMessage?: string;
  lastMessageId?: number;
  lastUserMessage?: string;
  lastCharMessage?: string;
  firstIncludedMessageId?: number;
  currentSwipeId?: number;
  lastSwipeId?: number;
  input?: string;
  model?: string;
  original?: string;
  maxPrompt?: number;
  idleDuration?: string;
  /** Chat-scoped variables (mutated by setvar/addvar/incvar...). */
  vars?: Record<string, string | number>;
  globalVars?: Record<string, string | number>;
  game?: GameMacroSource;
  now?: Date;
  /** Seed for {{pick}} so it is stable per chat. */
  pickSeed?: string;
  rng?: Rng;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function fmtTime(d: Date) {
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${pad(d.getMinutes())} ${ampm}`;
}

function fmtDate(d: Date) {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function splitArgs(body: string): string[] {
  if (body.includes('::')) return body.split('::');
  return body.split(',').map((s) => s.trim());
}

function numeric(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Simple moment-like formatter for {{datetimeformat ...}}. */
function formatDateTime(d: Date, fmt: string): string {
  const map: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    MMMM: MONTHS[d.getMonth()],
    MMM: MONTHS[d.getMonth()].slice(0, 3),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    dddd: WEEKDAYS[d.getDay()],
    ddd: WEEKDAYS[d.getDay()].slice(0, 3),
    HH: pad(d.getHours()),
    hh: pad(d.getHours() % 12 || 12),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
    A: d.getHours() >= 12 ? 'PM' : 'AM',
    D: String(d.getDate()),
    M: String(d.getMonth() + 1),
  };
  return fmt.replace(/YYYY|MMMM|MMM|MM|DD|dddd|ddd|HH|hh|mm|ss|A|D|M/g, (t) => map[t] ?? t);
}

export function expandMacros(text: string, ctx: MacroContext = {}): string {
  if (!text || (!text.includes('{{') && !/<(USER|BOT|CHAR)>/i.test(text))) return text ?? '';
  const now = ctx.now ?? new Date();
  const rng = ctx.rng ?? createRng(seedFrom(now.getTime(), text.length));
  const vars = (ctx.vars ??= {});
  const gvars = (ctx.globalVars ??= {});
  const game = ctx.game;

  let out = text.replace(/<USER>/gi, ctx.user ?? 'User').replace(/<(BOT|CHAR)>/gi, ctx.char ?? '');
  // Comments and banned-word hints are removed first.
  out = out.replace(/\{\{\/\/[\s\S]*?\}\}/g, '');
  out = out.replace(/\{\{banned\s+"[^"]*"\}\}/gi, '');

  let pickIndex = 0;
  const replacer = (full: string, rawInner: string): string => {
    const inner = rawInner.trim();
    const lower = inner.toLowerCase();
    // Simple value macros
    const simple: Record<string, string | number | undefined> = {
      user: ctx.user ?? 'User',
      char: ctx.char ?? '',
      group: ctx.group ?? ctx.char ?? '',
      charifnotgroup: ctx.group ? ctx.group : ctx.char ?? '',
      groupnotmuted: ctx.groupNotMuted ?? ctx.group ?? ctx.char ?? '',
      notchar: ctx.notChar ?? ctx.user ?? '',
      persona: ctx.persona ?? '',
      description: ctx.description ?? '',
      personality: ctx.personality ?? '',
      scenario: ctx.scenario ?? '',
      mesexamples: ctx.mesExamples ?? '',
      mesexamplesraw: ctx.mesExamplesRaw ?? ctx.mesExamples ?? '',
      charprompt: ctx.charPrompt ?? '',
      charinstruction: ctx.charInstruction ?? ctx.charJailbreak ?? '',
      charjailbreak: ctx.charJailbreak ?? '',
      chardepthprompt: ctx.charDepthPrompt ?? '',
      charversion: ctx.charVersion ?? '',
      char_version: ctx.charVersion ?? '',
      creatornotes: ctx.creatorNotes ?? '',
      lastmessage: ctx.lastMessage ?? '',
      lastmessageid: ctx.lastMessageId ?? '',
      lastusermessage: ctx.lastUserMessage ?? '',
      lastcharmessage: ctx.lastCharMessage ?? '',
      firstincludedmessageid: ctx.firstIncludedMessageId ?? '',
      currentswipeid: ctx.currentSwipeId !== undefined ? ctx.currentSwipeId + 1 : '',
      lastswipeid: ctx.lastSwipeId ?? '',
      input: ctx.input ?? '',
      model: ctx.model ?? '',
      original: ctx.original ?? '',
      maxprompt: ctx.maxPrompt ?? '',
      idle_duration: ctx.idleDuration ?? 'just now',
      newline: '\n',
      noop: '',
      trim: '\u0000TRIM\u0000',
      realtime: fmtTime(now),
      realdate: fmtDate(now),
      weekday: WEEKDAYS[now.getDay()],
      isotime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
      isodate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      time: game?.time ?? fmtTime(now),
      date: game?.date ?? fmtDate(now),
      location: game?.location ?? '',
      weather: game?.weather ?? '',
      currency: game?.currency ?? '',
      money: game?.currency ?? '',
      level: game?.level ?? '',
    };
    if (lower in simple) return String(simple[lower] ?? '');

    // Game bar shortcuts: {{hp}}, {{maxhp}}, {{mp}}, {{ap}}, {{xp}}
    if (game?.bars) {
      const bar = /^(max)?(hp|mp|ap|xp|[a-z_]+)$/.exec(lower);
      if (bar && game.bars[bar[2]]) return String(bar[1] ? game.bars[bar[2]].max : game.bars[bar[2]].cur);
    }
    if (game?.trackers) {
      const tr = /^(?:tracker|stat)::?(.+)$/.exec(inner);
      const id = tr ? tr[1].trim().toLowerCase() : lower;
      const t = game.trackers[id];
      if (t) return String(Math.round(t.value));
    }

    // time_UTC±N
    const utc = /^time_utc([+-]\d+)$/i.exec(inner);
    if (utc) {
      const shifted = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + Number(utc[1]) * 3600000);
      return fmtTime(shifted);
    }
    const dtf = /^datetimeformat\s+(.+)$/i.exec(inner);
    if (dtf) return formatDateTime(now, dtf[1]);

    const timeDiff = /^timediff::(.*?)::(.*)$/i.exec(inner);
    if (timeDiff) {
      const a = Date.parse(timeDiff[1]);
      const b = Date.parse(timeDiff[2]);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const mins = Math.round(Math.abs(a - b) / 60000);
        return mins < 60 ? `${mins} minutes` : mins < 1440 ? `${Math.round(mins / 60)} hours` : `${Math.round(mins / 1440)} days`;
      }
      return '';
    }

    const random = /^random\s*(::|:)\s*([\s\S]*)$/i.exec(inner);
    if (random) {
      const opts = random[1] === '::' ? random[2].split('::') : splitArgs(random[2]);
      return opts.length ? rng.pick(opts) : '';
    }
    const pick = /^pick\s*(::|:)\s*([\s\S]*)$/i.exec(inner);
    if (pick) {
      const opts = pick[1] === '::' ? pick[2].split('::') : splitArgs(pick[2]);
      const r = createRng(seedFrom(ctx.pickSeed ?? '', text, pickIndex++));
      return opts.length ? r.pick(opts) : '';
    }
    const roll = /^roll[\s:]+(.+)$/i.exec(inner);
    if (roll) {
      const res = rollDice(roll[1].trim(), rng);
      return res ? String(res.total) : '';
    }
    const reverse = /^reverse:([\s\S]*)$/i.exec(inner);
    if (reverse) return [...reverse[1]].reverse().join('');

    // Variables
    const v = /^(set|get|add|inc|dec)(global)?var::([^:]+?)(?:::([\s\S]*))?$/i.exec(inner);
    if (v) {
      const [, op, isGlobal, name, value] = v;
      const store = isGlobal ? gvars : vars;
      switch (op.toLowerCase()) {
        case 'set':
          store[name] = value ?? '';
          return '';
        case 'get':
          return String(store[name] ?? '');
        case 'add': {
          const cur = store[name];
          const n = Number(value);
          if (cur !== undefined && Number.isFinite(Number(cur)) && Number.isFinite(n)) store[name] = numeric(cur) + n;
          else store[name] = String(cur ?? '') + (value ?? '');
          return '';
        }
        case 'inc':
          store[name] = numeric(store[name]) + 1;
          return String(store[name]);
        case 'dec':
          store[name] = numeric(store[name]) - 1;
          return String(store[name]);
      }
    }
    return full;
  };

  for (let pass = 0; pass < 6; pass++) {
    const next = out.replace(/\{\{([^{}]*)\}\}/g, replacer);
    if (next === out) break;
    out = next;
  }
  if (out.includes('\u0000TRIM\u0000')) out = out.replace(/\s*\u0000TRIM\u0000\s*/g, '');
  return out;
}
