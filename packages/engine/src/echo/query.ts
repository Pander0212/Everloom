/**
 * Query understanding (§7 A): deterministic and local, no model call. Finds the people, places
 * and objects a turn refers to, temporal cues ("yesterday", "the night at the lake", "before the
 * argument"), attribute cues (winter, night, rain) and how much the turn is asking for the past.
 */
import { attributesOf, words } from './projector.js';

export interface NameIndex {
  /** entity id → names and aliases (any case). */
  entities: Record<string, string[]>;
}

export interface TemporalCue {
  /** World-time window [from, to). */
  window?: [number, number];
  /** "before X" / "after X": an anchor phrase to resolve against memories. */
  relation?: 'before' | 'after';
  anchor?: string;
  phrase: string;
}

export interface QueryUnderstanding {
  text: string;
  entities: string[];
  words: string[];
  temporal: TemporalCue[];
  attributes: string[];
  /** The player wants exact words. */
  exact: boolean;
  /** 0..1: how strongly the turn reaches for the past. */
  recallNeed: number;
}

const RECALL_WORDS = /\b(remember|recall|forgot|forget|last time|back when|that time|before|promised|promise|you said|you told|did you|that night|that day|used to|again|still)\b/gi;
const EXACT_WORDS = /\b(exactly|word for word|exact words|what (did|had) (\w+ )?(say|said)|quote)\b/i;

export function understand(text: string, names: NameIndex, now: number): QueryUnderstanding {
  const low = ` ${text.toLowerCase()} `;
  const entities: string[] = [];
  // Name words are matched by the entity path only; as plain words they would make every memory
  // that mentions the person a lexical hit too, and win agreement it did not earn.
  const nameWords = new Set<string>();
  for (const [id, list] of Object.entries(names.entities)) {
    for (const n of list) {
      const t = n.toLowerCase().trim();
      if (t.length < 3) continue;
      const first = t.split(/\s+/)[0];
      const re = (w: string) => new RegExp(`[^\\p{L}\\p{N}]${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\p{L}\\p{N}]`, 'u');
      if (re(t).test(low) || (first.length >= 4 && re(first).test(low))) {
        entities.push(id);
        for (const n2 of list) for (const w of words(n2)) nameWords.add(w);
        break;
      }
    }
  }
  const temporal: TemporalCue[] = [];
  const day = 1440;
  const today = Math.floor(now / day) * day;
  const add = (phrase: string, window?: [number, number]) => temporal.push({ phrase, ...(window ? { window } : {}) });
  if (/\byesterday\b/.test(low)) add('yesterday', [today - day, today]);
  if (/\blast night\b/.test(low)) add('last night', [today - day + 18 * 60, today + 5 * 60]);
  if (/\bthis morning\b/.test(low)) add('this morning', [today, today + 12 * 60]);
  if (/\b(earlier today|today)\b/.test(low)) add('today', [today, now + 1]);
  if (/\blast week\b/.test(low)) add('last week', [today - 8 * day, today - day]);
  const ago = low.match(/\b(\d+|two|three|four|five|six|a few) (days|weeks) ago\b/);
  if (ago) {
    const n = { two: 2, three: 3, four: 4, five: 5, six: 6, 'a few': 3 }[ago[1] as 'two'] ?? Number(ago[1]);
    const span = ago[2] === 'weeks' ? 7 * day : day;
    add(ago[0], [today - (n + 1) * span, today - (n - 1) * span + day]);
  }
  const rel = low.match(/\b(before|after) (the|our|your|that) ([\p{L}\s]{3,30}?)(?=[,.?!]| and | when | but |$)/u);
  if (rel) temporal.push({ phrase: rel[0].trim(), relation: rel[1] as 'before' | 'after', anchor: rel[3].trim() });
  const night = low.match(/\bthe (night|day|evening|morning) (at|in|by|on) (the )?([\p{L}\s]{3,25}?)(?=[,.?!]| and | when |$)/u);
  if (night) temporal.push({ phrase: night[0].trim(), anchor: night[4].trim() });
  const hits = (low.match(RECALL_WORDS) ?? []).length;
  const recallNeed = Math.min(1, hits * 0.35 + (temporal.length ? 0.3 : 0));
  return {
    text,
    entities,
    words: [...new Set(words(text))].filter((w) => !nameWords.has(w)),
    temporal,
    attributes: attributesOf(text),
    exact: EXACT_WORDS.test(text),
    recallNeed,
  };
}
