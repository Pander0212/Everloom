/** SillyTavern chat JSONL import/export. */

export interface SwipeRecord {
  text: string;
  reasoning?: string;
  createdAt: string;
  model?: string;
  extra?: Record<string, unknown>;
}

export interface ChatMessageRecord {
  role: 'user' | 'assistant' | 'system';
  name: string;
  swipes: SwipeRecord[];
  swipeId: number;
  createdAt: string;
  /** Excluded from the prompt (SillyTavern "is_system" ghost messages). */
  hidden?: boolean;
  extra?: Record<string, unknown>;
}

export interface ChatFile {
  userName: string;
  characterName: string;
  createdAt: string;
  metadata: Record<string, unknown>;
  messages: ChatMessageRecord[];
}

export function parseStDate(value: unknown): string {
  if (typeof value === 'number') return new Date(value).toISOString();
  if (typeof value !== 'string' || !value) return new Date(0).toISOString();
  const direct = Date.parse(value);
  if (Number.isFinite(direct)) return new Date(direct).toISOString();
  // "September 29, 2026 1:30pm"
  const m = /^(\w+ \d{1,2}, \d{4}) (\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(value.trim());
  if (m) {
    let h = Number(m[2]) % 12;
    if (m[4].toLowerCase() === 'pm') h += 12;
    const d = Date.parse(`${m[1]} ${String(h).padStart(2, '0')}:${m[3]}:00`);
    if (Number.isFinite(d)) return new Date(d).toISOString();
  }
  // "2024-5-12 @14h 30m 12s 123ms"
  const h = /^(\d{4})-(\d{1,2})-(\d{1,2}) @(\d{1,2})h ?(\d{1,2})m ?(\d{1,2})s/.exec(value);
  if (h) return new Date(Date.UTC(+h[1], +h[2] - 1, +h[3], +h[4], +h[5], +h[6])).toISOString();
  return new Date(0).toISOString();
}

export function parseChatJsonl(text: string): ChatFile {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error('Empty chat file');
  const rows = lines.map((l, i) => {
    try {
      return JSON.parse(l);
    } catch {
      throw new Error(`Invalid JSON on line ${i + 1}`);
    }
  });
  let header: any = {};
  let body = rows;
  if (rows[0] && (rows[0].user_name !== undefined || rows[0].chat_metadata !== undefined) && rows[0].mes === undefined) {
    header = rows[0];
    body = rows.slice(1);
  }
  const messages: ChatMessageRecord[] = body
    .filter((r) => r && typeof r === 'object' && (r.mes !== undefined || Array.isArray(r.swipes)))
    .map((r) => {
      const swipesText: string[] = Array.isArray(r.swipes) && r.swipes.length ? r.swipes.map((s: unknown) => String(s ?? '')) : [String(r.mes ?? '')];
      const info: any[] = Array.isArray(r.swipe_info) ? r.swipe_info : [];
      let swipeId = Number.isInteger(r.swipe_id) ? r.swipe_id : 0;
      if (swipeId < 0 || swipeId >= swipesText.length) swipeId = 0;
      // Ensure the displayed text is the active swipe.
      if (typeof r.mes === 'string' && swipesText[swipeId] !== r.mes) swipesText[swipeId] = r.mes;
      const createdAt = parseStDate(r.send_date);
      const swipes: SwipeRecord[] = swipesText.map((t, i) => ({
        text: t,
        reasoning: (info[i]?.extra?.reasoning ?? (i === swipeId ? r.extra?.reasoning : undefined)) || undefined,
        createdAt: info[i]?.send_date ? parseStDate(info[i].send_date) : createdAt,
        model: info[i]?.extra?.model ?? (i === swipeId ? r.extra?.model : undefined),
        extra: info[i]?.extra,
      }));
      const isNarrator = r.extra?.type === 'narrator';
      const role: ChatMessageRecord['role'] = r.is_user ? 'user' : isNarrator ? 'system' : 'assistant';
      return {
        role,
        name: String(r.name ?? (r.is_user ? header.user_name : header.character_name) ?? ''),
        swipes,
        swipeId,
        createdAt,
        hidden: !!r.is_system && !isNarrator,
        extra: r.extra && typeof r.extra === 'object' ? r.extra : undefined,
      };
    });
  return {
    userName: String(header.user_name ?? 'User'),
    characterName: String(header.character_name ?? ''),
    createdAt: parseStDate(header.create_date),
    metadata: header.chat_metadata && typeof header.chat_metadata === 'object' ? header.chat_metadata : {},
    messages,
  };
}

function humanDate(iso: string): string {
  const d = new Date(iso);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  let h = d.getUTCHours();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${h}:${String(d.getUTCMinutes()).padStart(2, '0')}${ampm}`;
}

export function exportChatJsonl(chat: ChatFile): string {
  const lines: string[] = [];
  lines.push(
    JSON.stringify({
      user_name: chat.userName,
      character_name: chat.characterName,
      create_date: humanDate(chat.createdAt),
      chat_metadata: chat.metadata ?? {},
    }),
  );
  for (const m of chat.messages) {
    const active = m.swipes[m.swipeId] ?? m.swipes[0] ?? { text: '', createdAt: m.createdAt };
    const extra: Record<string, unknown> = { ...(m.extra ?? {}) };
    if (active.reasoning) extra.reasoning = active.reasoning;
    if (active.model) extra.model = active.model;
    if (m.role === 'system') extra.type = 'narrator';
    const row: Record<string, unknown> = {
      name: m.name,
      is_user: m.role === 'user',
      is_system: !!m.hidden || m.role === 'system',
      send_date: humanDate(m.createdAt),
      mes: active.text,
      extra,
    };
    if (m.role === 'assistant' || m.swipes.length > 1) {
      row.swipe_id = m.swipeId;
      row.swipes = m.swipes.map((s) => s.text);
      row.swipe_info = m.swipes.map((s) => ({
        send_date: humanDate(s.createdAt),
        gen_started: s.createdAt,
        gen_finished: s.createdAt,
        extra: { ...(s.extra ?? {}), ...(s.reasoning ? { reasoning: s.reasoning } : {}), ...(s.model ? { model: s.model } : {}) },
      }));
    }
    lines.push(JSON.stringify(row));
  }
  return lines.join('\n') + '\n';
}
