/**
 * Perceptual reality: who perceived what of an event. Deterministic rules (salience × awareness),
 * never dice, so critical knowledge is reproducible and explainable.
 *
 * - The event's actors perceive it completely (they know what they did and what it was).
 * - Addressees and recipients get the content when they can receive it (hear it, read it) and
 *   understand the language.
 * - Everyone else gets only the cues they notice. Seeing an object put in a drawer is not knowing
 *   it is a letter: the cue says what it reveals.
 * - Private and secret events reach nobody else unless a cue says otherwise (an interceptor, an
 *   open door with a listener next to it).
 */
import { REVEAL_ORDER, type Cue, type EchoEvent, type ObserverState, type Reveal, type SenseChannel } from './types.js';

export interface Perceived {
  actor: string;
  level: Reveal;
  details: string[];
  channels: SenseChannel[];
  cues: Cue[];
  /** Why (for the inspector). */
  reason: string;
}

export function maxReveal(a: Reveal | null, b: Reveal): Reveal {
  if (!a) return b;
  return REVEAL_ORDER.indexOf(a) >= REVEAL_ORDER.indexOf(b) ? a : b;
}

export function revealAtLeast(level: Reveal, min: Reveal): boolean {
  return REVEAL_ORDER.indexOf(level) >= REVEAL_ORDER.indexOf(min);
}

/** How alert an observer is (0..1). */
export function awareness(o: ObserverState): number {
  if (!o.awake) return 0;
  return Math.max(0, Math.min(1, o.attention)) * (1 - 0.6 * Math.max(0, Math.min(1, o.impairment)));
}

/** Effective salience of one cue for one observer, after channel and distance. */
export function cueStrength(c: Cue, o: ObserverState): number {
  if (!o.awake) return 0;
  let s = Math.max(0, Math.min(1, c.salience));
  switch (c.channel) {
    case 'sight':
      if (!o.sight) return 0;
      if (o.place === 'adjacent') s *= 0.5;
      if (o.place === 'remote') return 0;
      break;
    case 'sound':
      if (o.hearing === 'none') return 0;
      if (o.hearing === 'muffled') s *= 0.5;
      if (o.place === 'remote') return 0;
      break;
    case 'smell':
    case 'touch':
      if (o.place !== 'here') return 0;
      break;
  }
  return s;
}

/** The cue an event has when the extractor wrote none: everyone present who can see or hear gets it all. */
export function defaultCues(e: EchoEvent): Cue[] {
  if (e.cues.length) return e.cues;
  if (e.visibility !== 'public') return [];
  const ch: SenseChannel = e.type === 'speech' ? 'sound' : 'sight';
  return [
    { channel: ch, detail: e.action, salience: 0.9, reveals: 'content' },
    ...(ch === 'sound' ? [] : [{ channel: 'sound' as const, detail: e.action, salience: 0.6, reveals: 'content' as const }]),
  ];
}

function understands(o: ObserverState | undefined, language: string | undefined): boolean {
  if (!language || !o?.languages) return true;
  return o.languages.includes(language);
}

/**
 * What each potential observer perceived. Returns one entry per actor who perceived anything.
 * `threshold`: salience × awareness needed to notice a cue.
 */
export function perceive(e: EchoEvent, threshold = 0.35): Perceived[] {
  const out = new Map<string, Perceived>();
  const obs = new Map(e.observers.map((o) => [o.actor, o]));
  const full = (actor: string, reason: string) => {
    out.set(actor, { actor, level: 'content', details: [e.action], channels: ['sight', 'sound'], cues: e.cues, reason });
  };
  for (const a of e.actors) full(a, 'did it');
  const speechLike = e.type === 'speech' || e.type === 'message' || e.type === 'promise' || e.type === 'reveal';
  // Messages and letters reach recipients wherever they are; speech needs hearing.
  for (const r of [...e.recipients, ...(e.interceptors ?? [])]) {
    if (out.has(r)) continue;
    const o = obs.get(r);
    const remoteChannel = e.type === 'message';
    const canReceive = remoteChannel || !o || (o.awake && o.hearing !== 'none' && o.place !== 'remote');
    if (!canReceive) continue;
    if (!understands(o, e.language)) {
      out.set(r, { actor: r, level: 'behavior', details: [speechLike ? 'heard words they could not understand' : 'received something they could not make sense of'], channels: ['sound'], cues: [], reason: 'did not understand the language' });
      continue;
    }
    if (o && o.hearing === 'muffled' && !remoteChannel && awareness(o) < 0.5) {
      out.set(r, { actor: r, level: 'behavior', details: ['caught only fragments'], channels: ['sound'], cues: [], reason: 'muffled' });
      continue;
    }
    full(r, e.interceptors?.includes(r) ? 'intercepted it' : 'it was meant for them');
  }
  if (e.visibility === 'secret' && !e.cues.length) return [...out.values()];
  const cues = defaultCues(e);
  for (const o of e.observers) {
    if (out.has(o.actor)) continue;
    const aw = awareness(o);
    let level: Reveal | null = null;
    const got: Cue[] = [];
    for (const c of cues) {
      const strength = cueStrength(c, o) * aw;
      if (strength + 1e-9 < threshold) continue;
      // Speech content needs the language; disguises hide identity.
      // A downgraded cue never keeps its original wording or propositions: they say more than was perceived.
      let rev = c.reveals;
      let detail = c.detail;
      if (c.channel === 'sound' && revealAtLeast(rev, 'identity') && !understands(o, e.language)) {
        rev = 'behavior';
        detail = 'heard voices in a language they could not follow';
      }
      if (o.recognises === false && revealAtLeast(rev, 'identity')) {
        rev = 'behavior';
        detail = c.channel === 'sight' ? 'saw someone they did not recognise doing something' : 'heard someone they did not recognise';
      }
      got.push(rev === c.reveals ? c : { channel: c.channel, detail, salience: c.salience, reveals: rev });
      level = maxReveal(level, rev);
    }
    if (!level) continue;
    out.set(o.actor, {
      actor: o.actor,
      level,
      details: [...new Set(got.map((c) => c.detail))],
      channels: [...new Set(got.map((c) => c.channel))],
      cues: got,
      reason: `noticed ${got.length} cue${got.length === 1 ? '' : 's'} (awareness ${aw.toFixed(2)})`,
    });
  }
  return [...out.values()];
}

/** Whether `a` could see `b` during the event (both here, both with sight) — for "A knows B saw it". */
export function sawEachOther(e: EchoEvent, a: string, b: string): boolean {
  const oa = e.observers.find((o) => o.actor === a);
  const ob = e.observers.find((o) => o.actor === b);
  const isActor = (x: string) => e.actors.includes(x);
  const visible = (o: ObserverState | undefined, x: string) => isActor(x) || (!!o && o.awake && o.sight && o.place === 'here');
  return visible(oa, a) && visible(ob, b);
}
