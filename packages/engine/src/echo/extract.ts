/**
 * The write path's front door (§6): turn a model's structured extraction into validated events,
 * or turn today's tracker memories into events deterministically (no extra model call).
 *
 * Names are resolved to actor ids by the caller. Observers come from the world state at commit
 * (who was where, awake, behind which door), never from the model. Anything malformed is dropped,
 * and uncertain extractions stay ambiguous: an attempt with no stated outcome stays 'unknown'.
 */
import { normProp } from './props.js';
import type { ActorId, Claim, Cue, EchoEvent, EventType, ObserverState, Prop, Reveal } from './types.js';

export interface ExtractContext {
  storyId: string;
  messageId: string | null;
  swipeId: number | null;
  /** Story order of the message; events get seqBase + index/100. */
  seqBase: number;
  occurredAt: number;
  recordedAt: number;
  locationId: string | null;
  observers: ObserverState[];
  sourceMessageIds: string[];
  resolve: (name: string) => ActorId | null;
  /** People only (actors, addressees, owners): may return a provisional id for someone unnamed. */
  resolveActor?: (name: string) => ActorId | null;
  provenance?: EchoEvent['provenance'];
}

/** Instructions appended to the tracker prompt when ECHO is on (one call, not a new one). */
export const ECHO_EXTRACTION_PROMPT = `- "events": 0-4 things that HAPPENED in the new turn and matter later (not small talk). Fields:
  "type" (action|speech|message|promise|reveal|move), "actors" (names), "to" (addressees), "action" (one past-tense sentence, full names),
  "quote" (exact words, optional), "private" (whisper, letter, secret), "attempted" + "outcome" (success|failure|unknown) for tries,
  "seen" (what onlookers could notice: [{"detail","reveals":"behavior|identity|content","channel":"sight|sound|smell","salience":0-1}]),
  "says" (claims made: [{"s","p","o","text"}]), "lie" (true if the speaker knows the claim is false),
  "sets" (world changes: [{"s","p","o"}], e.g. {"s":"ring","p":"location","o":"clara's bag"}),
  "promise" ({"what","to"}), "kept"/"broken" (what promise), "importance" (1-3),
  "feelings" ([{"who","emotion","intensity","toward"}]), "suspects" ([{"who","question","options":[{"label","s","p","o","weight","sinister"}]}]).
  Write "seen" from an onlooker's view: seeing an object hidden is not knowing what it is.`;

const TYPES = new Set<EventType>(['action', 'speech', 'message', 'thought', 'move', 'world', 'promise', 'promise.update', 'reveal', 'group', 'note']);
const REVEALS = new Set<Reveal>(['presence', 'behavior', 'identity', 'content']);
const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown, d: number, lo = 0, hi = 1) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function toProp(v: any, resolve: (n: string) => string | null): Prop | null {
  if (!v || typeof v !== 'object') return null;
  const s = str(v.s, 80);
  const p = str(v.p, 60);
  const o = str(v.o, 120);
  if (!s || !p || !o) return null;
  const id = (x: string) => resolve(x) ?? x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');
  return normProp({ s: id(s), p: p.replace(/\s+/g, '_'), o: resolve(o) ?? o, ...(v.neg || v.not ? { neg: true } : {}) });
}

let counter = 0;
const evId = (ctx: ExtractContext, i: number) => `ev_${(ctx.messageId ?? 'manual').slice(-12)}_${ctx.swipeId ?? 'n'}_${i}${ctx.messageId ? '' : `_${++counter}`}`;

export function parseEchoEvents(raw: unknown, ctx: ExtractContext): { events: EchoEvent[]; rejected: number } {
  const who = ctx.resolveActor ?? ctx.resolve;
  const events: EchoEvent[] = [];
  let rejected = 0;
  const list = arr(raw).slice(0, 6);
  list.forEach((v: any, i) => {
    const action = str(v?.action ?? v?.text, 600);
    const actors = arr(v?.actors ?? v?.who).map((n) => who(str(n, 80))).filter((x): x is string => !!x);
    if (!action || action.length < 6) {
      rejected++;
      return;
    }
    const type: EventType = TYPES.has(v?.type) ? v.type : 'action';
    const recipients = arr(v?.to).map((n) => who(str(n, 80))).filter((x): x is string => !!x);
    const cues: Cue[] = arr(v?.seen)
      .map((c: any) => ({
        channel: (['sight', 'sound', 'smell', 'touch'].includes(c?.channel) ? c.channel : 'sight') as Cue['channel'],
        detail: str(c?.detail, 300),
        salience: num(c?.salience, 0.6),
        reveals: (REVEALS.has(c?.reveals) ? c.reveals : 'behavior') as Reveal,
        props: arr(c?.props).map((p) => toProp(p, ctx.resolve)).filter((p): p is Prop => !!p),
      }))
      .filter((c) => c.detail.length >= 4)
      .slice(0, 4);
    const claims: Claim[] = arr(v?.says)
      .map((c: any) => {
        const prop = toProp(c, ctx.resolve);
        return prop ? { prop, text: str(c?.text, 300) || `${prop.s} ${prop.p} ${prop.o}` } : null;
      })
      .filter((c): c is Claim => !!c)
      .slice(0, 4);
    const establishes = arr(v?.sets).map((p) => toProp(p, ctx.resolve)).filter((p): p is Prop => !!p).slice(0, 6);
    const attempted = v?.attempted === true;
    const outcome = (['success', 'failure', 'unknown'].includes(v?.outcome) ? v.outcome : attempted ? 'unknown' : 'success') as EchoEvent['outcome'];
    const id = evId(ctx, i);
    const e: EchoEvent = {
      id,
      storyId: ctx.storyId,
      messageId: ctx.messageId,
      swipeId: ctx.swipeId,
      seq: ctx.seqBase + i / 100,
      type,
      occurredAt: ctx.occurredAt,
      recordedAt: ctx.recordedAt,
      locationId: ctx.locationId,
      actors: actors.length ? actors : [],
      targets: [],
      action,
      ...(str(v?.quote, 600) ? { quote: str(v.quote, 600) } : {}),
      attempted,
      outcome,
      visibility: v?.private === true || v?.secret === true ? 'private' : 'public',
      cues,
      observers: ctx.observers,
      recipients,
      ...(claims.length ? { claims } : {}),
      ...(v?.lie === true ? { sincere: false } : {}),
      ...(establishes.length ? { establishes } : {}),
      importance: Math.round(num(v?.importance, 1, 1, 3)) as 1 | 2 | 3,
      causes: [],
      sourceMessageIds: ctx.sourceMessageIds,
      provenance: ctx.provenance ?? 'extraction',
      schemaVersion: 1,
    };
    const promise = v?.promise;
    if (promise && str(promise.what) && actors[0]) e.commitment = { id: `${id}:p`, by: actors[0], to: arr(promise.to).map((n) => who(str(n, 80))).filter((x): x is string => !!x), what: str(promise.what, 200) };
    const feelings = arr(v?.feelings)
      .map((f: any) => ({ actor: who(str(f?.who, 80)), emotion: str(f?.emotion, 30), intensity: num(f?.intensity, 0.5), toward: f?.toward ? who(str(f.toward, 80)) ?? undefined : undefined }))
      .filter((f) => f.actor && f.emotion) as NonNullable<EchoEvent['emotions']>;
    if (feelings.length) e.emotions = feelings.slice(0, 4);
    const hyps = arr(v?.suspects)
      .map((h: any) => {
        const owner = who(str(h?.who, 80));
        const options = arr(h?.options)
          .map((o: any) => {
            const prop = toProp(o, ctx.resolve);
            return prop ? { label: str(o?.label, 120) || `${prop.p} ${prop.o}`, prop, weight: num(o?.weight, 0.33, 0.01, 1), sinister: o?.sinister === true } : null;
          })
          .filter((o): o is NonNullable<typeof o> => !!o);
        return owner && str(h?.question) && options.length >= 2 ? { owner, question: str(h.question, 160), options: options.slice(0, 4) } : null;
      })
      .filter((h): h is NonNullable<typeof h> => !!h);
    if (hyps.length) e.hypotheses = hyps;
    events.push(e);
  });
  return { events, rejected };
}

/** Today's tracker memory line → an event (deterministic; Light/Fast profiles with no extra extraction). */
export function eventFromTrackedMemory(m: { text: string; about: string[]; importance: number; private: boolean; to: string[] }, i: number, ctx: ExtractContext): EchoEvent | null {
  const text = str(m.text, 600);
  if (text.length < 8) return null;
  const about = m.about.map((n) => ctx.resolve(n)).filter((x): x is string => !!x);
  const to = m.to.map((n) => ctx.resolve(n)).filter((x): x is string => !!x);
  return {
    id: evId(ctx, 50 + i),
    storyId: ctx.storyId,
    messageId: ctx.messageId,
    swipeId: ctx.swipeId,
    seq: ctx.seqBase + (50 + i) / 100,
    type: m.private ? 'speech' : 'action',
    occurredAt: ctx.occurredAt,
    recordedAt: ctx.recordedAt,
    locationId: ctx.locationId,
    // A private line is between the player and who was told; a public one involves who it's about.
    actors: m.private ? ['player'] : about.slice(0, 3),
    targets: about,
    action: text,
    attempted: false,
    outcome: 'success',
    visibility: m.private ? 'private' : 'public',
    cues: [],
    observers: ctx.observers,
    recipients: m.private ? to : [],
    importance: Math.max(1, Math.min(3, Math.round(m.importance) || 1)) as 1 | 2 | 3,
    causes: [],
    sourceMessageIds: ctx.sourceMessageIds,
    provenance: ctx.provenance ?? 'extraction',
    schemaVersion: 1,
  };
}

/** A legacy memory row (summary migration, §13). Witnesses become probable observers of the public part only. */
export function eventFromLegacy(row: { id: string; text: string; participants: string[]; witnesses: string[]; locationId: string | null; gameTime: number; importance: number; secret: boolean; seq: number; messageId: string | null; swipeId: number | null }, storyId: string): EchoEvent {
  const witnesses = row.witnesses.length ? row.witnesses : [];
  return {
    id: `ev_mig_${row.id}`,
    storyId,
    messageId: row.messageId,
    swipeId: row.swipeId,
    seq: row.seq,
    type: 'note',
    occurredAt: row.gameTime,
    recordedAt: Date.now(),
    locationId: row.locationId,
    actors: witnesses,
    targets: row.participants,
    action: row.text,
    attempted: false,
    outcome: 'success',
    visibility: row.secret ? 'secret' : 'public',
    cues: [],
    observers: [],
    recipients: [],
    importance: Math.max(1, Math.min(3, row.importance)) as 1 | 2 | 3,
    causes: [],
    sourceMessageIds: row.messageId ? [row.messageId] : [],
    provenance: 'migration',
    // When no witnesses were recorded, nobody is granted it.
    unresolved: true,
    schemaVersion: 1,
  };
}
