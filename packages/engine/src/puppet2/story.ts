/**
 * The story drives Puppets v2 through the same avatar ops as 3D characters (avatar.emote,
 * avatar.pose, avatar.outfit, stage.layer). Those live in the campaign state of each message, so a
 * swipe or a rollback puts the puppet back as it was. This maps the story's emote and pose ids onto
 * the motion library; what has no puppet motion is ignored (never guessed).
 */

export type PuppetCue =
  | { kind: 'gesture'; motion: string }
  | { kind: 'base'; motion: string }
  | { kind: 'walk'; to: 'in' | 'out' };

/** Story emotes (avatar/emotes.ts ids) → puppet motions. */
export const EMOTE_MOTIONS: Record<string, PuppetCue> = {
  wave: { kind: 'gesture', motion: 'wave_L' },
  nod: { kind: 'gesture', motion: 'nod' },
  bow: { kind: 'gesture', motion: 'bow' },
  cheer: { kind: 'gesture', motion: 'armsUp' },
  victory: { kind: 'gesture', motion: 'armsUp' },
  laugh: { kind: 'gesture', motion: 'nod' },
  surprised: { kind: 'gesture', motion: 'jump' },
  point: { kind: 'gesture', motion: 'point_L' },
  angry: { kind: 'base', motion: 'armsCrossed' },
  thinking: { kind: 'base', motion: 'armsCrossed' },
  walk_in: { kind: 'walk', to: 'in' },
  walk_out: { kind: 'walk', to: 'out' },
};

/** Held poses (avatar.pose) → looping base motions. */
export const POSE_MOTIONS: Record<string, string> = {
  idle: 'idle', idle_relaxed: 'idle', idle_tired: 'idle', idle_shy: 'idle',
  idle_confident: 'handsOnHips', ready: 'handsOnHips', angry: 'armsCrossed',
};

export function emoteCue(emote: string | null | undefined): PuppetCue | null {
  return emote ? EMOTE_MOTIONS[emote] ?? null : null;
}
export function poseMotion(pose: string | null | undefined): string {
  return (pose && POSE_MOTIONS[pose]) || 'idle';
}

/**
 * The parts to hide for an outfit: other outfits' clothes, and the adult (nude) layers unless the
 * outfit is "none" (they belong to 18+ packs, which the minor guard keeps off minors).
 */
export function hiddenParts(parts: ReadonlyArray<{ id: string; outfit?: string; adult?: boolean }>, outfit: string | null | undefined): Set<string> {
  const outfits = [...new Set(parts.flatMap((p) => (p.outfit ? [p.outfit] : [])))];
  const nude = outfit === 'none' || outfit === 'nude';
  const wear = nude ? null : outfit && outfits.includes(outfit) ? outfit : outfits[0] ?? null;
  const out = new Set<string>();
  for (const p of parts) {
    if (p.outfit && p.outfit !== wear) out.add(p.id);
    if (p.adult && !nude) out.add(p.id);
  }
  return out;
}
