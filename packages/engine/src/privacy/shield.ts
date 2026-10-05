/**
 * Name shield: real names never reach the AI provider. Outbound text has every protected term
 * swapped for a stand-in; replies have the stand-ins swapped back before anything is stored or shown.
 *
 * Matching is case-insensitive, whole-word and Unicode-aware, keeps possessives and plural endings
 * ("Lena's" → "Mira's"), and copies the capitalization pattern (LENA → MIRA, lena → mira).
 */

export type ShieldKind = 'first' | 'last' | 'full' | 'place' | 'other';
export type ShieldScope = { type: 'all' } | { type: 'persona' | 'character' | 'chat'; id: string };

export interface ShieldTerm {
  id: string;
  real: string;
  standin: string;
  kind: ShieldKind;
  /** Nicknames, other spellings: also hidden (and restored to the main real term). */
  forms: string[];
  scope: ShieldScope;
  enabled?: boolean;
}

export interface ShieldSettings {
  enabled: boolean;
  terms: ShieldTerm[];
  /** A protected term still in an outgoing request: refuse it, or ask (the owner may send it anyway). */
  onLeak: 'block' | 'ask';
  /** Cloud voices get the stand-in unless this is on. */
  ttsRealNames: boolean;
}
export const defaultShieldSettings = (): ShieldSettings => ({ enabled: false, terms: [], onLeak: 'block', ttsRealNames: false });

export interface ShieldContext {
  chatId?: string | null;
  personaId?: string | null;
  characterIds?: string[];
}

/** Terms that apply here. Without a chat context, scoped terms apply too (hide more, never less). */
export function termsInScope(terms: ShieldTerm[], c: ShieldContext): ShieldTerm[] {
  const known = !!(c.chatId || c.personaId || c.characterIds?.length);
  return terms.filter((t) => {
    if (t.enabled === false || !t.real.trim() || !t.standin.trim()) return false;
    const s = t.scope;
    if (s.type === 'all' || !known) return true;
    if (s.type === 'chat') return s.id === c.chatId;
    if (s.type === 'persona') return s.id === c.personaId;
    return !!c.characterIds?.includes(s.id);
  });
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const L = '\\p{L}\\p{N}_';
/** A word, not part of a longer one, with an optional possessive or plural ending kept aside. */
const wordRe = (words: string[]) => new RegExp(`(?<![${L}])(${words.map(esc).sort((a, b) => b.length - a.length).join('|')})(?=(?:['’]s|s|es)?(?![${L}]))`, 'giu');

/** Copy the capitalization pattern of `like` onto `word`. */
export function matchCase(word: string, like: string): string {
  if (like.length > 1 && like === like.toUpperCase() && like !== like.toLowerCase()) return word.toUpperCase();
  if (like === like.toLowerCase() && like !== like.toUpperCase()) return word.toLowerCase();
  return word;
}

export interface Shield {
  /** Real → stand-in (for anything going out). */
  outbound(text: string): string;
  /** Stand-in → real (for anything coming back). */
  inbound(text: string): string;
  /** Protected terms still present in outgoing text. */
  leaks(text: string): string[];
  /** For streams: feed chunks, get restored text; holds back what might be the start of a stand-in. */
  restorer(): { push(chunk: string): string; flush(): string };
  /** Short forms of a stand-in left in a reply ("Marcus" → "Marc"): worth a hint, not safe to swap. */
  possibleLeftovers(text: string): string[];
  readonly active: boolean;
}

export function buildShield(terms: ShieldTerm[]): Shield {
  const out = new Map<string, string>(); // lower-cased real (and forms) → stand-in
  const back = new Map<string, string>(); // lower-cased stand-in → real
  for (const t of terms) {
    const real = t.real.trim();
    const stand = t.standin.trim();
    out.set(real.toLowerCase(), stand);
    back.set(stand.toLowerCase(), real);
    // Full names: the parts map to the parts, so "Lena" alone becomes "Mira", not "Mira Hollis".
    const rp = real.split(/\s+/);
    const sp = stand.split(/\s+/);
    if (rp.length > 1 && sp.length > 1) {
      if (!out.has(rp[0]!.toLowerCase())) out.set(rp[0]!.toLowerCase(), sp[0]!);
      if (!out.has(rp.at(-1)!.toLowerCase())) out.set(rp.at(-1)!.toLowerCase(), sp.at(-1)!);
      if (!back.has(sp[0]!.toLowerCase())) back.set(sp[0]!.toLowerCase(), rp[0]!);
      if (!back.has(sp.at(-1)!.toLowerCase())) back.set(sp.at(-1)!.toLowerCase(), rp.at(-1)!);
    }
    // Nicknames and other spellings: one word stands in for the first name, more for the whole.
    for (const f of t.forms) {
      const form = f.trim();
      if (!form || out.has(form.toLowerCase())) continue;
      out.set(form.toLowerCase(), form.split(/\s+/).length === 1 && sp.length > 1 ? sp[0]! : stand);
    }
  }
  const outRe = out.size ? wordRe([...out.keys()]) : null;
  const backRe = back.size ? wordRe([...back.keys()]) : null;
  const swap = (text: string, re: RegExp | null, map: Map<string, string>) => (re ? text.replace(re, (m) => matchCase(map.get(m.toLowerCase()) ?? m, m)) : text);
  const standins = [...back.keys()];
  const shown = terms.map((t) => t.standin.trim());
  const maxLen = Math.max(0, ...standins.map((s) => s.length));
  return {
    active: out.size > 0,
    outbound: (text) => swap(text, outRe, out),
    inbound: (text) => swap(text, backRe, back),
    leaks(text) {
      if (!outRe) return [];
      const found = new Set<string>();
      for (const m of text.matchAll(outRe)) found.add(m[1]!);
      return [...found];
    },
    restorer() {
      let buf = '';
      const cut = () => {
        // Hold back from the earliest word start (within reach) whose tail could still grow into a stand-in.
        const from = Math.max(0, buf.length - maxLen - 3);
        for (let i = from; i < buf.length; i++) {
          if (i > 0 && /[\p{L}\p{N}_]/u.test(buf[i - 1]!)) continue;
          const tail = buf.slice(i).toLowerCase();
          if (!tail) break;
          if (standins.some((s) => s.startsWith(tail) || (tail.startsWith(s) && tail.length <= s.length + 3 && !/[^\p{L}\p{N}_'’]/u.test(tail.slice(s.length))))) return i;
        }
        return buf.length;
      };
      return {
        push(chunk) {
          buf += chunk;
          if (!backRe) {
            const all = buf;
            buf = '';
            return all;
          }
          const at = cut();
          const ready = buf.slice(0, at);
          buf = buf.slice(at);
          return swap(ready, backRe, back);
        },
        flush() {
          const rest = swap(buf, backRe, back);
          buf = '';
          return rest;
        },
      };
    },
    possibleLeftovers(text) {
      const hits = new Set<string>();
      for (const s of shown) {
        const first = s.split(/\s+/)[0]!;
        if (first.length < 5) continue;
        const short = first.slice(0, Math.max(3, first.length - 2));
        const re = new RegExp(`(?<![${L}])${esc(short)}(?![${L}])`, 'iu');
        if (re.test(text)) hits.add(short);
      }
      return [...hits];
    },
  };
}

/** Apply a string transform to every string inside a JSON value (keys untouched). */
export function mapJsonStrings(value: unknown, f: (s: string) => string): unknown {
  if (typeof value === 'string') return f(value);
  if (Array.isArray(value)) return value.map((v) => mapJsonStrings(v, f));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapJsonStrings(v, f)]));
  return value;
}

// ------------------------------------------------------------------ stand-ins

const FIRST = ['Mira', 'Tomas', 'Elin', 'Rowan', 'Sabine', 'Corin', 'Ilse', 'Dario', 'Neve', 'Anselm', 'Talia', 'Bram', 'Odile', 'Kasimir', 'Wren', 'Leander', 'Ysolde', 'Matteo', 'Esme', 'Joren', 'Liesl', 'Caspian', 'Maren', 'Teodor', 'Ottilie', 'Florian', 'Signe', 'Emeric', 'Junia', 'Aurel'];
const LAST = ['Hollis', 'Varga', 'Lindqvist', 'Marlow', 'Okafor', 'Brandt', 'Castell', 'Duval', 'Ferreira', 'Galloway', 'Haskel', 'Ivers', 'Kowal', 'Lorne', 'Mercer', 'Nakamura', 'Orsini', 'Pell', 'Quaid', 'Rasmussen', 'Sallow', 'Thorne', 'Ulven', 'Vance', 'Whitlock', 'Ystad', 'Zeller', 'Ashby', 'Bexley', 'Crane'];
const PLACE = ['Larkmoor', 'Eastwick', 'Velden', 'Corrow', 'Saltmere', 'Brindle', 'Ashford', 'Kestrel Bay', 'Dunmore', 'Halvard', 'Millbrook', 'Orrin', 'Quillon', 'Ravensby', 'Tamsey', 'Westerholm'];
const OTHER = ['Juniper', 'Quartz', 'Meridian', 'Halcyon', 'Ember', 'Solace', 'Tamarind', 'Vesper'];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A plausible stand-in of the same kind, avoiding `avoid` (names in use, other stand-ins). The same
 * seed gives the same answer, so a re-roll is just another seed.
 */
export function makeStandin(kind: ShieldKind, seed: string, avoid: string[] = []): string {
  const taken = new Set(avoid.map((a) => a.toLowerCase()));
  const pick = (list: string[], salt: string) => {
    const start = hash(seed + salt) % list.length;
    for (let i = 0; i < list.length; i++) {
      const c = list[(start + i) % list.length]!;
      if (!taken.has(c.toLowerCase())) return c;
    }
    return `${list[start]} ${String.fromCharCode(65 + (hash(seed) % 26))}.`;
  };
  if (kind === 'first') return pick(FIRST, 'f');
  if (kind === 'last') return pick(LAST, 'l');
  if (kind === 'place') return pick(PLACE, 'p');
  if (kind === 'other') return pick(OTHER, 'o');
  for (let i = 0; i < 40; i++) {
    const full = `${pick(FIRST, 'f' + i)} ${pick(LAST, 'l' + i)}`;
    if (!taken.has(full.toLowerCase())) return full;
  }
  return `${pick(FIRST, 'f')} ${pick(LAST, 'l')}`;
}

/** Stand-ins that clash with a name already in the story (or with each other). */
export function standinClashes(terms: ShieldTerm[], namesInUse: string[]): ShieldTerm[] {
  // A stand-in clashes with a whole name in use or with any word of one ("Iris Hale" vs "Iris Thorne").
  const used = new Set(namesInUse.flatMap((n) => [n.toLowerCase(), ...n.toLowerCase().split(/\s+/).filter((w) => w.length > 2)]));
  const seen = new Set<string>();
  const out: ShieldTerm[] = [];
  for (const t of terms) {
    const s = t.standin.trim().toLowerCase();
    const parts = s.split(/\s+/);
    if (used.has(s) || parts.some((p) => used.has(p)) || seen.has(s)) out.push(t);
    seen.add(s);
  }
  return out;
}
