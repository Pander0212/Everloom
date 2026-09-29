/** Game clock math on absolute minutes with a configurable calendar. */
import type { CalendarConfig } from './state.js';

export const MIN_PER_HOUR = 60;
export const MIN_PER_DAY = 1440;

export interface GameDate {
  year: number;
  /** 0-based month index. */
  month: number;
  /** 1-based day of month. */
  day: number;
  hour: number;
  minute: number;
  weekday: number;
  dayOfYear: number;
  /** Absolute day number since epoch. */
  absDay: number;
}

export function daysPerYear(cal: CalendarConfig): number {
  return cal.months.reduce((s, m) => s + Math.max(1, m.days), 0);
}

export function toDate(minutes: number, cal: CalendarConfig): GameDate {
  const m = Math.max(0, Math.floor(minutes));
  const absDay = Math.floor(m / MIN_PER_DAY);
  const minOfDay = m - absDay * MIN_PER_DAY;
  const dpy = daysPerYear(cal);
  const year = cal.epochYear + Math.floor(absDay / dpy);
  let doy = absDay % dpy;
  const dayOfYear = doy;
  let month = 0;
  while (month < cal.months.length - 1 && doy >= cal.months[month].days) {
    doy -= cal.months[month].days;
    month++;
  }
  const weekdays = Math.max(1, cal.weekdays.length);
  return {
    year,
    month,
    day: doy + 1,
    hour: Math.floor(minOfDay / 60),
    minute: minOfDay % 60,
    weekday: (cal.epochWeekday + absDay) % weekdays,
    dayOfYear,
    absDay,
  };
}

export function fromDate(d: { year: number; month: number; day: number; hour?: number; minute?: number }, cal: CalendarConfig): number {
  const dpy = daysPerYear(cal);
  let days = (d.year - cal.epochYear) * dpy;
  for (let i = 0; i < d.month && i < cal.months.length; i++) days += cal.months[i].days;
  days += Math.max(0, d.day - 1);
  return Math.max(0, days * MIN_PER_DAY + (d.hour ?? 0) * 60 + (d.minute ?? 0));
}

export function formatClock(minutes: number, cal: CalendarConfig): string {
  const d = toDate(minutes, cal);
  if (cal.clock === '24h') return `${String(d.hour).padStart(2, '0')}:${String(d.minute).padStart(2, '0')}`;
  const h = d.hour % 12 || 12;
  return `${h}:${String(d.minute).padStart(2, '0')} ${d.hour >= 12 ? 'PM' : 'AM'}`;
}

export function formatDate(minutes: number, cal: CalendarConfig, format = cal.dateFormat): string {
  const d = toDate(minutes, cal);
  const monthName = cal.months[d.month]?.name ?? `Month ${d.month + 1}`;
  return format
    .replace('{weekday}', cal.weekdays[d.weekday] ?? '')
    .replace('{month}', monthName)
    .replace('{mon}', monthName.slice(0, 3))
    .replace('{day}', String(d.day))
    .replace('{dd}', String(d.day).padStart(2, '0'))
    .replace('{mm}', String(d.month + 1).padStart(2, '0'))
    .replace('{year}', String(d.year));
}

export function partOfDay(minutes: number): 'night' | 'dawn' | 'morning' | 'afternoon' | 'evening' | 'dusk' {
  const h = Math.floor((minutes % MIN_PER_DAY) / 60);
  if (h < 5) return 'night';
  if (h < 7) return 'dawn';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 20) return 'evening';
  if (h < 22) return 'dusk';
  return 'night';
}

export function formatDuration(minutes: number): string {
  const m = Math.round(Math.abs(minutes));
  if (m < 60) return `${m} min`;
  const days = Math.floor(m / MIN_PER_DAY);
  const hours = Math.floor((m % MIN_PER_DAY) / 60);
  const mins = m % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} d`);
  if (hours) parts.push(`${hours} h`);
  if (mins && !days) parts.push(`${mins} min`);
  return parts.join(' ');
}

/** Minutes of the day, e.g. parseClock("7:30 pm") → 1170. Returns null if invalid. */
export function parseClock(text: string): number | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i.exec(text);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3]) {
    h = h % 12;
    if (m[3].toLowerCase() === 'pm') h += 12;
  }
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Next absolute minute (strictly after `now`, or equal if allowSame) at the given minute-of-day. */
export function nextTimeOfDay(now: number, minuteOfDay: number, allowSame = false): number {
  const dayStart = Math.floor(now / MIN_PER_DAY) * MIN_PER_DAY;
  let t = dayStart + minuteOfDay;
  if (t < now || (!allowSame && t === now)) t += MIN_PER_DAY;
  return t;
}

/** Occurrences of a recurring event in (from, to]. Capped to avoid runaway loops. */
export function occurrencesBetween(
  at: number,
  recurring: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly',
  from: number,
  to: number,
  cal: CalendarConfig,
  cap = 64,
): number[] {
  const out: number[] = [];
  if (to <= from) return out;
  if (recurring === 'none') {
    if (at > from && at <= to) out.push(at);
    return out;
  }
  if (recurring === 'daily' || recurring === 'weekly') {
    const step = recurring === 'daily' ? MIN_PER_DAY : MIN_PER_DAY * Math.max(1, cal.weekdays.length);
    let t = at;
    if (t <= from) t += Math.ceil((from - t + 1) / step) * step;
    for (; t <= to && out.length < cap; t += step) if (t > from) out.push(t);
    return out;
  }
  const base = toDate(at, cal);
  const startYear = toDate(from, cal).year;
  const endYear = toDate(to, cal).year;
  for (let y = startYear; y <= endYear && out.length < cap; y++) {
    const months = recurring === 'yearly' ? [base.month] : cal.months.map((_, i) => i);
    for (const mo of months) {
      const day = Math.min(base.day, cal.months[mo]?.days ?? base.day);
      const t = fromDate({ year: y, month: mo, day, hour: base.hour, minute: base.minute }, cal);
      if (t >= at && t > from && t <= to) out.push(t);
    }
  }
  return out.sort((a, b) => a - b).slice(0, cap);
}
