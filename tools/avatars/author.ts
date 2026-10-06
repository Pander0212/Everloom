/**
 * Keyframed emotes, authored for Everloom (no outside assets). Each is a few key poses in the
 * canonical frame, layered over a base clip (normally the idle, so the body keeps breathing and
 * shifting its weight), eased between keys and sampled at 30 fps into a normal clip file.
 *
 * Angles are degrees, Euler XYZ, in the canonical frame: the character faces +Z, its left is +X,
 * and the T-pose (arms straight out) is zero. Left-side bones are mirrored to the right as
 * (x, −y, −z) unless the right side is given. Useful directions:
 *   left upper arm  z −72 = hanging down, z +80 = straight up, y −70 = forward
 *   left lower arm  y −90 = elbow bent forward 90°
 *   left fingers    z −70 = curled into the palm
 *   spine/chest/neck/head  x + = lean or look down/forward, y + = turn to its left, z + = tilt to its right
 *   upper leg  x − = thigh forward;  lower leg  x + = knee bent
 * Hips offsets are fractions of hips height (y −0.1 lowers the body by a tenth of the leg).
 */
import * as THREE from 'three';
import { HUMANOID_BONES, type HumanBone } from '@everloom/engine';
import { emptyPose, type CanonicalPose } from '../../apps/web/src/features/avatar3d/runtime/canonical';
import { encodeClip, sampleClip, type Clip, type ClipJSON } from '../../apps/web/src/features/avatar3d/runtime/clip';

export type E3 = [number, number, number];
export type KeyPose = Partial<Record<HumanBone, E3>>;
export interface Key {
  t: number;
  pose: KeyPose;
  hips?: E3;
}
export interface Authored {
  id: string;
  /** Clip under the keys (default idle); null = T-pose. */
  base?: string | null;
  loop: boolean;
  duration: number;
  keys: Key[];
  /** Bones whose key rotations are added on top of the base instead of replacing it. */
  additive?: HumanBone[];
  /** Mirror left-side keys to the right (default true). */
  mirror?: boolean;
  fps?: number;
}

const D = Math.PI / 180;
const q = ([x, y, z]: E3) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x * D, y * D, z * D));
const smooth = (k: number) => k * k * (3 - 2 * k);
/** Upper arm → its shoulder. */
const UPPER_ARM: Partial<Record<HumanBone, HumanBone>> = { leftUpperArm: 'leftShoulder', rightUpperArm: 'rightShoulder' };

/** Left-side angles mirrored to the right. */
export function mirrored(p: KeyPose): KeyPose {
  const out: KeyPose = { ...p };
  for (const [b, [x, y, z]] of Object.entries(p) as Array<[HumanBone, E3]>) {
    if (!b.startsWith('left')) continue;
    const r = ('right' + b.slice(4)) as HumanBone;
    if (!(r in p)) out[r] = [x, -y, -z];
  }
  return out;
}

export function compile(a: Authored, clips: Record<string, Clip>): ClipJSON {
  const fps = a.fps ?? 30;
  const frames = Math.round(a.duration * fps) + (a.loop ? 0 : 1);
  const base = a.base === null ? null : clips[a.base ?? 'idle'];
  if (a.base !== null && !base) throw new Error(`${a.id}: base clip ${a.base ?? 'idle'} is missing`);
  const keys = [...a.keys].sort((x, y) => x.t - y.t).map((k) => ({ ...k, pose: a.mirror === false ? k.pose : mirrored(k.pose) }));
  const add = new Set(a.additive ?? []);
  const bones = HUMANOID_BONES.filter((b) => keys.some((k) => k.pose[b]));
  const poses: CanonicalPose[] = [];
  for (let f = 0; f < frames; f++) {
    const t = f / fps;
    const p = base ? sampleClip(base, t) : emptyPose();
    const basePose = base ? sampleClip(base, t) : emptyPose();
    const set = (b: HumanBone, chestOrLocal: THREE.Quaternion) => {
      const arm = UPPER_ARM[b];
      p.rot[b] = arm ? (p.rot[arm]?.clone() ?? new THREE.Quaternion()).invert().multiply(chestOrLocal) : chestOrLocal;
    };
    // Bracketing keys (a loop wraps from the last key to the first).
    for (const b of bones) {
      const track = keys.filter((k) => k.pose[b]);
      let prev = [...track].reverse().find((k) => k.t <= t);
      let next = track.find((k) => k.t > t);
      let span: number;
      let k: number;
      if (a.loop) {
        prev ??= { ...track[track.length - 1]!, t: track[track.length - 1]!.t - a.duration };
        next ??= { ...track[0]!, t: track[0]!.t + a.duration };
      }
      // Upper arm keys are in the chest's frame (shoulder × arm), so a base clip's shoulder posture
      // doesn't bend the authored direction; converted back to the arm's own rotation below.
      const arm = UPPER_ARM[b];
      const baseQ = arm ? (basePose.rot[arm]?.clone() ?? new THREE.Quaternion()).multiply(basePose.rot[b] ?? new THREE.Quaternion()) : (p.rot[b]?.clone() ?? new THREE.Quaternion());
      const at = (key: Key | undefined) => (key ? (add.has(b) ? baseQ.clone().multiply(q(key.pose[b]!)) : q(key.pose[b]!)) : baseQ.clone());
      if (!prev && !next) continue;
      if (!prev) {
        // Before the first key: blend from the base into it.
        span = next!.t;
        k = span > 0 ? t / span : 1;
        set(b, baseQ.clone().slerp(at(next), smooth(k)));
        continue;
      }
      if (!next) {
        // After the last key: back to the base by the end (or hold, if the key is at the end).
        span = a.duration - prev.t;
        k = span > 0 ? (t - prev.t) / span : 0;
        set(b, at(prev).slerp(baseQ, smooth(Math.min(1, k))));
        continue;
      }
      span = next.t - prev.t;
      k = span > 0 ? (t - prev.t) / span : 0;
      set(b, at(prev).slerp(at(next), smooth(k)));
    }
    // Hips: keys that give hips offsets are added to the base's.
    const hk = keys.filter((k) => k.hips);
    if (hk.length) {
      const prev = [...hk].reverse().find((k) => k.t <= t);
      const next = hk.find((k) => k.t > t);
      const v = (k?: Key) => new THREE.Vector3(...(k?.hips ?? [0, 0, 0]));
      const a0 = prev ? v(prev) : new THREE.Vector3();
      const a1 = next ? v(next) : a.loop ? v(hk[0]) : new THREE.Vector3();
      const t0 = prev?.t ?? 0;
      const t1 = next?.t ?? a.duration;
      const kk = t1 > t0 ? smooth((t - t0) / (t1 - t0)) : 0;
      p.hips.add(a0.lerp(a1, kk));
    }
    poses.push(p);
  }
  return encodeClip(a.id, fps, poses, a.loop, 'Everloom (authored)');
}

/** A clip played backwards (lying down is getting up, reversed). */
export function reversed(id: string, clip: ClipJSON): ClipJSON {
  const tracks: ClipJSON['tracks'] = {};
  for (const [b, t] of Object.entries(clip.tracks) as Array<[HumanBone, number[]]>) {
    if (t.length === 4) tracks[b] = t;
    else {
      const out: number[] = [];
      for (let f = clip.frames - 1; f >= 0; f--) out.push(...t.slice(f * 4, f * 4 + 4));
      tracks[b] = out;
    }
  }
  let hips = clip.hips;
  if (hips && hips.length > 3) {
    const out: number[] = [];
    for (let f = clip.frames - 1; f >= 0; f--) out.push(...hips.slice(f * 3, f * 3 + 3));
    hips = out;
  }
  return { ...clip, id, loop: false, tracks, ...(hips ? { hips } : {}), source: clip.source };
}

/** One frame of a clip held as a loop (with the base's breathing added by the caller if wanted). */
export function still(id: string, clip: ClipJSON, frame: number): ClipJSON {
  const tracks: ClipJSON['tracks'] = {};
  for (const [b, t] of Object.entries(clip.tracks) as Array<[HumanBone, number[]]>) tracks[b] = t.length === 4 ? t : t.slice(frame * 4, frame * 4 + 4);
  const hips = clip.hips ? (clip.hips.length === 3 ? clip.hips : clip.hips.slice(frame * 3, frame * 3 + 3)) : undefined;
  return { v: 1, id, fps: 30, frames: 1, loop: true, tracks, ...(hips ? { hips } : {}), source: clip.source };
}
