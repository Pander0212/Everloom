/**
 * The emote library: what a 3D character can do. Built-in emotes are bundled clips (CC0 Quaternius
 * animations retargeted to the canonical skeleton) or keyframed clips authored for Everloom; owners
 * add their own by importing clips. The story picks only from what is installed: resolveEmote never
 * invents a name.
 */

import type { Emotion } from '../game/emotion.js';
import { BUILTIN_PAIRED, resolvePaired, type PairedInfo } from './paired.js';

export const EMOTE_CATEGORIES = ['idle', 'talk', 'emotion', 'social', 'state', 'dance', 'battle'] as const;
export type EmoteCategory = (typeof EMOTE_CATEGORIES)[number];

export interface EmoteInfo {
  /** Stable id: lower-case letters, digits and underscores. */
  id: string;
  label: string;
  category: EmoteCategory;
  /** Loops until replaced (idles, dances, sitting) or plays once and returns to the pose. */
  loop: boolean;
  /** Other words the story or the slash command may use for it. */
  aliases?: string[];
  /** Beats per minute of a dance loop at speed 1, for matching music tempo. */
  bpm?: number;
  /** Where it comes from: a bundled clip name, an authored clip, or an owner's import. */
  source: 'bundled' | 'authored' | 'imported';
  tags?: string[];
  /** The face it wears while playing (a laugh looks happy). */
  emotion?: Emotion;
}

export const EMOTE_ID = /^[a-z][a-z0-9_]{0,39}$/;

const e = (id: string, label: string, category: EmoteCategory, loop: boolean, source: EmoteInfo['source'], aliases: string[] = [], bpm?: number, emotion?: Emotion): EmoteInfo => ({ id, label, category, loop, source, aliases, ...(bpm ? { bpm } : {}), ...(emotion ? { emotion } : {}) });

/** Everything Everloom ships. The web app holds the clips; the server and the story only need the names. */
export const BUILTIN_EMOTES: EmoteInfo[] = [
  // idles (poses)
  e('idle', 'Idle', 'idle', true, 'bundled', ['neutral', 'stand', 'idle_neutral']),
  e('idle_relaxed', 'Relaxed', 'idle', true, 'authored', ['relaxed', 'at ease']),
  e('idle_shy', 'Shy', 'idle', true, 'authored', ['shy', 'bashful'], undefined, 'nervousness'),
  e('idle_confident', 'Confident', 'idle', true, 'bundled', ['confident', 'arms crossed', 'fold arms']),
  e('idle_tired', 'Tired', 'idle', true, 'authored', ['tired', 'exhausted', 'weary']),
  // talking
  e('talk', 'Talking', 'talk', true, 'bundled', ['talking', 'speak', 'gesture']),
  // emotions
  e('laugh', 'Laugh', 'emotion', false, 'authored', ['laughing', 'giggle', 'chuckle'], undefined, 'amusement'),
  e('cry', 'Cry', 'emotion', false, 'authored', ['crying', 'sob', 'weep'], undefined, 'sadness'),
  e('angry', 'Angry', 'emotion', false, 'authored', ['anger', 'furious', 'stomp'], undefined, 'anger'),
  e('embarrassed', 'Embarrassed', 'emotion', false, 'authored', ['embarrassment', 'flustered', 'blush'], undefined, 'embarrassment'),
  e('surprised', 'Surprised', 'emotion', false, 'authored', ['surprise', 'startled', 'gasp'], undefined, 'surprise'),
  e('scared', 'Scared', 'emotion', false, 'authored', ['fear', 'afraid', 'cower', 'flinch'], undefined, 'fear'),
  e('thinking', 'Thinking', 'emotion', false, 'authored', ['think', 'ponder', 'hmm'], undefined, 'curiosity'),
  e('sigh', 'Sigh', 'emotion', false, 'authored', ['sighs'], undefined, 'relief'),
  // social
  e('wave', 'Wave', 'social', false, 'authored', ['waves', 'hello', 'goodbye', 'hi', 'bye'], undefined, 'joy'),
  e('nod', 'Nod', 'social', false, 'bundled', ['nods', 'yes', 'agree']),
  e('shake_head', 'Shake head', 'social', false, 'bundled', ['no', 'shakes head', 'disagree']),
  e('bow', 'Bow', 'social', false, 'authored', ['bows', 'curtsy']),
  e('clap', 'Clap', 'social', false, 'authored', ['claps', 'applause', 'applaud'], undefined, 'joy'),
  e('shrug', 'Shrug', 'social', false, 'authored', ['shrugs'], undefined, 'confusion'),
  e('point', 'Point', 'social', false, 'authored', ['points']),
  e('hug', 'Hug', 'social', false, 'authored', ['hugs', 'embrace'], undefined, 'love'),
  e('cheer', 'Cheer', 'social', false, 'authored', ['cheers', 'celebrate', 'hooray', 'yay'], undefined, 'joy'),
  e('drink', 'Drink', 'social', false, 'bundled', ['drinks', 'sip', 'eat', 'consume']),
  // states (poses)
  e('sit', 'Sit', 'state', true, 'bundled', ['sits', 'sitting', 'sit down']),
  e('lie_down', 'Lie down', 'state', true, 'authored', ['lie', 'lying', 'lay down']),
  e('sleep', 'Sleep', 'state', true, 'authored', ['sleeping', 'asleep', 'nap']),
  e('kneel', 'Kneel', 'state', true, 'bundled', ['kneels', 'kneeling', 'crouch']),
  e('walk_in', 'Walk in', 'state', false, 'bundled', ['enter', 'arrive', 'walks in']),
  e('walk_out', 'Walk out', 'state', false, 'bundled', ['leave', 'exit', 'walks out']),
  // dances (poses)
  e('dance', 'Dance', 'dance', true, 'bundled', ['dancing', 'dance_groove'], 120, 'joy'),
  e('dance_sway', 'Sway', 'dance', true, 'authored', ['sway', 'slow dance'], 90, 'joy'),
  e('dance_bounce', 'Bounce', 'dance', true, 'authored', ['bounce', 'party'], 128, 'joy'),
  e('dance_arms', 'Arm wave', 'dance', true, 'authored', ['arm wave', 'wave dance'], 110, 'joy'),
  // battle
  e('ready', 'Ready stance', 'battle', true, 'bundled', ['battle ready', 'stance', 'guard up']),
  e('attack', 'Attack', 'battle', false, 'bundled', ['strike', 'slash', 'hit them']),
  e('punch', 'Punch', 'battle', false, 'bundled', ['jab']),
  e('cast', 'Cast', 'battle', false, 'bundled', ['spell', 'magic']),
  e('hit', 'Hit', 'battle', false, 'bundled', ['hurt', 'take hit', 'ouch'], undefined, 'fear'),
  e('defend', 'Defend', 'battle', false, 'bundled', ['block', 'parry', 'guard']),
  e('victory', 'Victory', 'battle', false, 'authored', ['win', 'triumph', 'fist pump'], undefined, 'pride'),
  e('defeat', 'Defeat', 'battle', false, 'bundled', ['lose', 'fall', 'knocked out'], undefined, 'sadness'),
];

/** Emotes that persist (a pose) rather than play once. */
export const isPoseEmote = (x: EmoteInfo) => x.loop && x.category !== 'talk';

const key = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, '_');

/** The installed emote a name refers to (id, label or alias), or null. Never a guess outside the list. */
export function resolveEmote(installed: readonly EmoteInfo[], name: string | null | undefined): EmoteInfo | null {
  if (!name) return null;
  const k = key(name);
  return installed.find((x) => x.id === k) ?? installed.find((x) => key(x.label) === k) ?? installed.find((x) => (x.aliases ?? []).some((a) => key(a) === k)) ?? null;
}

/** The emote an emotion or game event triggers, if one is installed. */
export const EMOTE_FOR: Record<string, string> = {
  joy: 'laugh', amusement: 'laugh', sadness: 'sigh', anger: 'angry', surprise: 'surprised', fear: 'scared', embarrassment: 'embarrassed', confusion: 'thinking', curiosity: 'thinking', relief: 'sigh', pride: 'cheer',
  levelUp: 'cheer', battleStart: 'ready', battleWin: 'victory', battleLose: 'defeat', attack: 'attack', cast: 'cast', hurt: 'hit', defend: 'defend', enter: 'walk_in', leave: 'walk_out', greet: 'wave',
};

/** The line the tracker prompt gets: the exact ids it may use. */
export function emoteOpReference(installed: readonly EmoteInfo[]): string {
  const one = installed.filter((x) => !isPoseEmote(x)).map((x) => x.id);
  const pose = installed.filter(isPoseEmote).map((x) => x.id);
  return `- {"type":"avatar.emote","who":"Mara Quill","emote":"wave"}  a 3D character does something visible once; emote is one of: ${one.join(', ')}\n- {"type":"avatar.pose","who":"Mara Quill","pose":"sit"}  a held pose until changed ("pose":null to stand); pose is one of: ${pose.join(', ')}. "who":"everyone" for the whole scene (a group dance)`;
}

/** Built-in emotes plus the owner's imported clips (by id, label and category). */
export function installedEmotes(custom: ReadonlyArray<{ id: string; label: string; category: string; loop?: boolean }> = []): EmoteInfo[] {
  const extra = custom
    .filter((c) => EMOTE_ID.test(c.id) && !BUILTIN_EMOTES.some((b) => b.id === c.id))
    .map((c): EmoteInfo => ({ id: c.id, label: c.label, category: (EMOTE_CATEGORIES as readonly string[]).includes(c.category) ? (c.category as EmoteCategory) : 'social', loop: c.loop ?? ['idle', 'dance', 'state'].includes(c.category), source: 'imported' }));
  return [...BUILTIN_EMOTES, ...extra];
}

/**
 * Avatar ops from the story, checked against what is installed: names become ids, poses must be
 * pose emotes, and anything unknown is dropped (never guessed).
 */
export function normalizeAvatarOps<T extends { type: string }>(ops: T[], installed: readonly EmoteInfo[], paired: readonly PairedInfo[] = BUILTIN_PAIRED.filter((p) => !p.adult)): { ok: T[]; rejected: Array<{ op: T; reason: string }> } {
  const ok: T[] = [];
  const rejected: Array<{ op: T; reason: string }> = [];
  for (const op of ops) {
    if (op.type === 'avatar.paired') {
      const o = op as unknown as { clip: string | null; who: string[] };
      if (o.clip === null) { ok.push(op); continue; }
      const p = resolvePaired(paired, o.clip);
      if (!p) rejected.push({ op, reason: `No paired animation called "${o.clip}"` });
      else if (o.who.length !== p.participants) rejected.push({ op, reason: `${p.label} needs ${p.participants} characters` });
      else ok.push({ ...op, clip: p.id });
      continue;
    }
    if (op.type === 'avatar.emote') {
      const e = resolveEmote(installed, (op as unknown as { emote: string }).emote);
      if (!e) rejected.push({ op, reason: `No emote called "${(op as unknown as { emote: string }).emote}"` });
      else ok.push({ ...op, emote: e.id });
    } else if (op.type === 'avatar.pose') {
      const name = (op as unknown as { pose: string | null }).pose;
      if (name === null) ok.push(op);
      else {
        const e = resolveEmote(installed.filter(isPoseEmote), name);
        if (!e) rejected.push({ op, reason: `No pose called "${name}"` });
        else ok.push({ ...op, pose: e.id });
      }
    } else ok.push(op);
  }
  return { ok, rejected };
}
