/**
 * Guarding what the writer sees and writes (measured need: docs/echo/LIVE.md §3).
 *
 * A "private moment" is an event some people present now did NOT perceive: a secret, a whisper, a
 * hidden object, or something that happened while they were elsewhere. Three uses:
 *  - history notes: the chat history sent to the writer marks such moments where they happened
 *    ("only Rin perceived this"), so the boundary sits next to the text, not in a far-away block;
 *  - the reply guard: a cheap deterministic pre-filter finds replies that touch a private moment
 *    while someone unaware of it is present; only those go to a model check (and a repair);
 *  - provisional actors: "the one-armed dwarf" is an actor before he has a name, and is merged into
 *    the NPC once one fits him.
 */
import type { Projector } from './projector.js';
import { words } from './projector.js';
import type { EchoEvent } from './types.js';

export interface PrivateMoment {
  eventId: string;
  messageId: string | null;
  seq: number;
  /** What happened, as its perceivers know it. */
  gist: string;
  perceivers: string[];
  /** People present now who perceived nothing of it. */
  unaware: string[];
  /** Distinctive words a reply would use if it touched this moment. */
  terms: string[];
}

const COMMON = new Set('looked looks walked walks turned turns asked asks said says made makes went goes came comes took takes gave gives while nobody anyone someone something thing things back down there here into onto then them their with from this that very just only still even again away left right what when where which quietly slowly quickly little first last'.split(' '));

/** Distinctive content words of a text, longest first (names removed). */
export function distinctiveTerms(text: string, nameWords: Set<string>, max = 8): string[] {
  return [...new Set(words(text).filter((w) => w.length >= 4 && !COMMON.has(w) && !nameWords.has(w)))].sort((a, b) => b.length - a.length).slice(0, max);
}

/**
 * Moments that some of `present` did not perceive. Public, ordinary moments are left out unless
 * they matter (importance ≥ 2): an unaware person missing a chat about the weather is no secret.
 */
export function privateMoments(proj: Projector, present: string[], names: Record<string, string>): PrivateMoment[] {
  const perceivers = new Map<string, Set<string>>();
  const gistOf = new Map<string, string>();
  for (const u of proj.units) {
    let s = perceivers.get(u.eventId);
    if (!s) perceivers.set(u.eventId, (s = new Set()));
    s.add(u.owner);
    if (u.level === 'content' && !gistOf.has(u.eventId)) gistOf.set(u.eventId, u.l1);
  }
  const nameWords = new Set(Object.values(names).flatMap((n) => words(n)));
  const out: PrivateMoment[] = [];
  for (const id of proj.order) {
    const e = proj.events.get(id)!;
    const who = perceivers.get(id) ?? new Set<string>();
    if (!who.size) continue;
    const unaware = present.filter((p) => !who.has(p));
    if (!unaware.length) continue;
    if (e.visibility === 'public' && e.importance < 2) continue;
    const gist = gistOf.get(id) ?? e.action;
    out.push({ eventId: id, messageId: e.messageId, seq: e.seq, gist, perceivers: [...who], unaware, terms: distinctiveTerms(`${e.action} ${e.quote ?? ''}`, nameWords) });
  }
  return out;
}

/** The note added to a history message in the writer's prompt (never stored). */
export function historyNote(moments: PrivateMoment[], names: Record<string, string>): string {
  if (!moments.length) return '';
  const n = (id: string) => names[id] ?? id;
  const lines = moments.slice(0, 3).map((m) => `only ${m.perceivers.map(n).join(', ')} perceived "${m.gist.slice(0, 120)}"; ${m.unaware.map(n).join(', ')} did not`);
  return `[Perspective: ${lines.join(' | ')}]`;
}

export interface GuardCandidate {
  moment: PrivateMoment;
  hits: string[];
}

/**
 * Deterministic pre-filter: the reply uses at least two of a private moment's distinctive words
 * (or one long, rare one) while someone unaware of it is present. Cheap; a model only judges these.
 */
export function guardCandidates(moments: PrivateMoment[], reply: string): GuardCandidate[] {
  const text = new Set(words(reply));
  // "I noticed … your boot" leaks with one of the moment's words: perception words lower the bar.
  const perceives = PERCEIVE.test(reply);
  const out: GuardCandidate[] = [];
  for (const m of moments) {
    const hits = m.terms.filter((t) => text.has(t));
    if (hits.length >= 2 || hits.some((h) => h.length >= 8) || (perceives && hits.length >= 1)) out.push({ moment: m, hits });
  }
  return out.slice(0, 4);
}

const PERCEIVE = /\b(notic(?:e|ed|ing)|saw|seen|see you|spott(?:ed|ing)|caught|watched|witness(?:ed)?|overheard|heard you|know what you|i know about|bemerkt|gesehen|beobachtet|mitbekommen)\b/i;

/** The judge's prompt (utility model). Returns JSON {"violations":[{"who","moment","quote"}]}. */
export function guardPrompt(cands: GuardCandidate[], reply: string, names: Record<string, string>): Array<{ role: 'system' | 'user'; content: string }> {
  const n = (id: string) => names[id] ?? id;
  const facts = cands.map((c, i) => `${i + 1}. "${c.moment.gist}" — known only to ${c.moment.perceivers.map(n).join(', ')}; NOT known to ${c.moment.unaware.map(n).join(', ')}`).join('\n');
  return [
    {
      role: 'system',
      content:
        'You check a roleplay reply for knowledge leaks. Below are private facts and who does NOT know each. A leak is when a character who does not know a fact speaks about it, acts on it, notices it, or hints that they know it, without being told in this reply. The narration describing it, or the knowing character mentioning it, is NOT a leak. Answer ONLY JSON: {"violations":[{"who":"name","fact":1,"quote":"the words in the reply"}]} or {"violations":[]}.',
    },
    { role: 'user', content: `Private facts:\n${facts}\n\nReply:\n${reply.slice(0, 6000)}` },
  ];
}

export function parseGuard(text: string): Array<{ who: string; fact: number; quote: string }> {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const v = JSON.parse(m[0]);
    return (Array.isArray(v.violations) ? v.violations : []).filter((x: any) => x && typeof x.who === 'string').slice(0, 4).map((x: any) => ({ who: String(x.who).slice(0, 80), fact: Number(x.fact) || 1, quote: String(x.quote ?? '').slice(0, 300) }));
  } catch {
    return [];
  }
}

/** The instruction for one repair of the reply. */
export function repairInstruction(vs: Array<{ who: string; fact: number; quote: string }>, cands: GuardCandidate[]): string {
  const lines = vs.map((v) => {
    const c = cands[v.fact - 1] ?? cands[0];
    return `- ${v.who} cannot know "${c?.moment.gist ?? 'that'}"${v.quote ? ` (the draft had: "${v.quote}")` : ''}.`;
  });
  return `Rewrite this reply. In the previous draft, a character knew something they never saw or were told:\n${lines.join('\n')}\nKeep everything else; make them not know it (they may be curious, guess wrongly, or not notice).`;
}

// ------------------------------------------------------------------ provisional actors

/** An actor id for someone the story hasn't named yet ("the one-armed dwarf" → anon:one_armed_dwarf). */
export function provisionalId(phrase: string): string | null {
  const raw = phrase.trim();
  // A described person ("the one-armed dwarf") keeps "the"; a name the story used ("Korra") doesn't.
  const described = /^(the|a|an|that|this|some)\s+/i.test(raw) || raw === raw.toLowerCase();
  const w = raw
    .toLowerCase()
    .replace(/^(the|a|an|that|this|some)\s+/, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim();
  if (w.length < 3 || w.split(/\s+/).length > 5) return null;
  return `anon:${described ? 'the_' : ''}${w.replace(/[\s-]+/g, '_')}`;
}

/** How a provisional actor is shown: "the one armed dwarf", or the name as the story used it ("Korra"). */
export function provisionalName(id: string): string {
  const w = id.slice(5);
  if (w.startsWith('the_')) return w.replace(/_/g, ' ');
  return w.split('_').map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(' ');
}

/**
 * Which named NPC a provisional actor turned out to be: every descriptor word of the provisional
 * id appears in exactly one NPC's name, role, title or appearance.
 */
export function mergeProvisional(ids: string[], npcs: Array<{ id: string; text: string }>): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of ids) {
    const want = id.slice(5).split('_').filter((w) => w.length >= 3 && !['the', 'old', 'young', 'man', 'woman'].includes(w));
    if (!want.length) continue;
    const fits = npcs.filter((n) => {
      const t = ` ${n.text.toLowerCase().replace(/-/g, ' ')} `;
      return want.every((w) => t.includes(w));
    });
    if (fits.length === 1) out.set(id, fits[0].id);
  }
  return out;
}

/** Events with provisional actors replaced by who they turned out to be. Pure. */
export function remapActors(events: EchoEvent[], map: Map<string, string>): EchoEvent[] {
  if (!map.size) return events;
  const m = (x: string) => map.get(x) ?? x;
  return events.map((e) => ({
    ...e,
    actors: e.actors.map(m),
    targets: e.targets.map(m),
    recipients: e.recipients.map(m),
    ...(e.interceptors ? { interceptors: e.interceptors.map(m) } : {}),
    observers: e.observers.map((o) => ({ ...o, actor: m(o.actor) })),
    ...(e.emotions ? { emotions: e.emotions.map((x) => ({ ...x, actor: m(x.actor), ...(x.toward ? { toward: m(x.toward) } : {}) })) } : {}),
    ...(e.relations ? { relations: e.relations.map((r) => ({ ...r, from: m(r.from), to: m(r.to) })) } : {}),
    ...(e.hypotheses ? { hypotheses: e.hypotheses.map((h) => ({ ...h, owner: m(h.owner) })) } : {}),
  }));
}
