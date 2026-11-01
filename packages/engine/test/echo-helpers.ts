import { echo } from '../src/index.js';
type EchoEvent = echo.EchoEvent;
type ObserverState = echo.ObserverState;

/** Everyone listed is here, awake, attentive, with clear sight and hearing. */
export function here(...actors: string[]): ObserverState[] {
  return actors.map((actor) => ({ actor, place: 'here' as const, sight: true, hearing: 'clear' as const, awake: true, impairment: 0, attention: 1 }));
}

let n = 0;
export function ev(p: Partial<EchoEvent> & { action: string }, seq?: number): EchoEvent {
  n++;
  const s = seq ?? n;
  return {
    id: p.id ?? `e${s}`,
    storyId: 'story',
    messageId: p.messageId ?? `m${Math.floor(s)}`,
    swipeId: p.swipeId ?? 0,
    seq: s,
    type: 'action',
    occurredAt: s * 10,
    recordedAt: 0,
    locationId: 'hall',
    actors: [],
    targets: [],
    attempted: false,
    outcome: 'success',
    visibility: 'public',
    cues: [],
    observers: [],
    recipients: [],
    importance: 1,
    causes: [],
    sourceMessageIds: [],
    provenance: 'manual',
    schemaVersion: 1,
    ...p,
  } as EchoEvent;
}

export const P = (s: string, p: string, o: string, neg = false) => echo.prop(s, p, o, neg);

export const persp = (actorId: string, extra: Partial<echo.Perspective> = {}): echo.Perspective => ({ actorId, storyId: 'story', leaf: 'leaf', accessScope: 'actor', ...extra });

/** Every string an actor's view could put into a prompt. */
export function viewText(v: echo.AuthorizedView): string {
  return JSON.stringify({
    u: v.units.map((u) => [u.l0, u.l1, u.quote, u.drift]),
    b: v.beliefs.map((b) => [b.text, b.prop]),
    d: v.doubted.map((t) => t.claim),
    h: v.hypotheses,
    ho: v.higher.map((h) => [h.text, h.prop]),
    c: v.commitments.map((c) => c.what),
    co: v.common,
    un: v.unknowns,
  }).toLowerCase();
}
