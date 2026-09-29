/** Rebuild campaign state from a base state plus the active op-log entries. */
import type { Op } from './ops.js';
import { applyOps, type ApplyContext, type OpSource } from './reducer.js';
import type { Change } from './simulate.js';
import { migrateState, type CampaignState } from './state.js';

export interface OpLogEntry {
  id: string;
  /** Global order of creation. */
  seq: number;
  ops: Op[];
  source: OpSource;
}

export interface RebuildResult {
  state: CampaignState;
  errors: Array<{ entryId: string; op: Op; error: string }>;
}

export function rebuild(base: CampaignState, entries: OpLogEntry[], ctx: Omit<ApplyContext, 'source'> = {}): RebuildResult {
  let state = migrateState(structuredClone(base));
  const errors: RebuildResult['errors'] = [];
  const sorted = entries.slice().sort((a, b) => a.seq - b.seq);
  for (const entry of sorted) {
    const r = applyOps(state, entry.ops, { ...ctx, source: entry.source });
    state = r.state;
    for (const e of r.errors) errors.push({ entryId: entry.id, op: e.op, error: e.error });
  }
  return { state, errors };
}

function fmtNum(n: number): string {
  const r = Math.round(n * 10) / 10;
  const abs = Math.abs(r);
  const s = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  return (r < 0 ? '−' : '+') + s;
}

function fmtMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const hh = h % 24;
    return hh ? `${d} d ${hh} h` : `${d} d`;
  }
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** Merge changes by key and render short strings: "+1 Iced Lemon Tea", "20 min passed", "Hunger −10". */
export function summarizeChanges(changes: Change[], max = 8): string[] {
  const merged = new Map<string, Change>();
  const texts: string[] = [];
  for (const c of changes) {
    if (c.kind === 'text' || c.kind === 'level') {
      if (c.text && !texts.includes(c.text)) texts.push(c.text);
      continue;
    }
    const prev = merged.get(c.key);
    if (prev) prev.delta = (prev.delta ?? 0) + (c.delta ?? 0);
    else merged.set(c.key, { ...c });
    if (c.text && !texts.includes(c.text)) texts.push(c.text);
  }
  const out: string[] = [];
  const order: Array<Change['kind']> = ['item', 'time', 'currency', 'xp', 'bar', 'tracker', 'drift'];
  const list = [...merged.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  for (const c of list) {
    const d = c.delta ?? 0;
    if (Math.abs(d) < 0.5 && c.kind !== 'time') continue;
    // Background drift (hunger rising over time…) is only worth mentioning when it adds up.
    if (c.kind === 'drift' && Math.abs(d) < 5) continue;
    switch (c.kind) {
      case 'item':
        out.push(`${d > 0 ? '+' : '−'}${Math.abs(d)} ${c.label}`);
        break;
      case 'time':
        if (d > 0) out.push(`${fmtMinutes(d)} passed`);
        break;
      case 'currency':
        out.push(`${fmtNum(d)} ${c.label}`);
        break;
      default:
        out.push(`${c.label} ${fmtNum(Math.round(d))}`);
    }
  }
  return [...texts.filter((t) => !t.startsWith('Level')), ...out, ...texts.filter((t) => t.startsWith('Level'))].slice(0, max);
}

export interface AnchoredEntry extends OpLogEntry {
  chatId: string;
  /** Message the ops belong to; null = campaign root (applies always). */
  messageId: string | null;
  /** Swipe the ops belong to; null = applies whatever swipe is active. */
  swipeId: number | null;
}

export interface ActiveMessage {
  id: string;
  chatId: string;
  swipeId: number;
}

/**
 * Pick the op-log entries that are live: their message still exists in its chat and, when the
 * entry is tied to a swipe, that swipe is the one currently selected.
 */
export function selectActiveEntries<T extends AnchoredEntry>(entries: T[], messages: ActiveMessage[]): T[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  return entries.filter((e) => {
    if (e.messageId === null) return true;
    const m = byId.get(e.messageId);
    if (!m || m.chatId !== e.chatId) return false;
    return e.swipeId === null || e.swipeId === m.swipeId;
  });
}
