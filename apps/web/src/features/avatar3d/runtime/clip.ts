/**
 * Everloom animation clips: canonical-skeleton rotations sampled at a fixed rate, stored once and
 * played on any model through canonical.ts. Constant tracks are stored as a single frame.
 *
 *   { v: 1, id, fps, frames, loop, tracks: { leftUpperArm: [x,y,z,w, x,y,z,w, …] }, hips: [x,y,z, …] }
 */
import * as THREE from 'three';
import { HUMANOID_BONES, type HumanBone } from '@everloom/engine';
import { emptyPose, type CanonicalPose } from './canonical';

export interface ClipJSON {
  v: 1;
  id: string;
  fps: number;
  frames: number;
  loop: boolean;
  tracks: Partial<Record<HumanBone, number[]>>;
  hips?: number[];
  /** Where it came from (for credits and the clip list). */
  source?: string;
}

export interface Clip {
  id: string;
  fps: number;
  frames: number;
  loop: boolean;
  duration: number;
  tracks: Map<HumanBone, Float32Array>;
  hips: Float32Array | null;
}

export function decodeClip(j: ClipJSON): Clip {
  const tracks = new Map<HumanBone, Float32Array>();
  for (const b of HUMANOID_BONES) if (j.tracks[b]?.length) tracks.set(b, Float32Array.from(j.tracks[b]!));
  const frames = Math.max(1, j.frames);
  // A loop's last frame leads back into the first (no duplicate end frame), so it lasts frames/fps.
  return { id: j.id, fps: j.fps, frames, loop: j.loop, duration: (j.loop ? frames : Math.max(1, frames - 1)) / j.fps, tracks, hips: j.hips?.length ? Float32Array.from(j.hips) : null };
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** Builds a clip from sampled canonical poses (dropping constant tracks to one frame). */
export function encodeClip(id: string, fps: number, poses: CanonicalPose[], loop: boolean, source?: string): ClipJSON {
  const tracks: Partial<Record<HumanBone, number[]>> = {};
  for (const b of HUMANOID_BONES) {
    const qs = poses.map((p) => p.rot[b]);
    if (qs.some((q) => !q)) continue;
    // Keep quaternions on one hemisphere so interpolation takes the short way.
    const arr: number[] = [];
    let prev: THREE.Quaternion | null = null;
    for (const q0 of qs as THREE.Quaternion[]) {
      const q = q0.clone();
      if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      arr.push(r4(q.x), r4(q.y), r4(q.z), r4(q.w));
      prev = q;
    }
    const first = arr.slice(0, 4);
    const constant = arr.every((v, i) => Math.abs(v - first[i % 4]!) < 0.0005);
    const isIdentity = constant && Math.abs(first[3]!) > 0.9999;
    if (isIdentity) continue;
    tracks[b] = constant ? first : arr;
  }
  let hips: number[] | undefined = poses.flatMap((p) => [r4(p.hips.x), r4(p.hips.y), r4(p.hips.z)]);
  if (hips.every((v) => Math.abs(v) < 0.0005)) hips = undefined;
  else if (hips.every((v, i) => Math.abs(v - hips![i % 3]!) < 0.0005)) hips = hips.slice(0, 3);
  return { v: 1, id, fps, frames: poses.length, loop, tracks, ...(hips ? { hips } : {}), ...(source ? { source } : {}) };
}

const _a = new THREE.Quaternion();
const _b = new THREE.Quaternion();
/** The pose at `time` seconds (wrapping for loops, holding the last frame otherwise). */
export function sampleClip(clip: Clip, time: number, out: CanonicalPose = emptyPose()): CanonicalPose {
  const span = clip.duration;
  let t = clip.loop ? ((time % span) + span) % span : Math.min(Math.max(time, 0), span);
  const f = t * clip.fps;
  const i0 = Math.min(clip.frames - 1, Math.floor(f));
  const i1 = clip.loop ? (i0 + 1) % clip.frames : Math.min(clip.frames - 1, i0 + 1);
  const k = f - i0;
  for (const [b, arr] of clip.tracks) {
    const q = (out.rot[b] ??= new THREE.Quaternion());
    if (arr.length === 4) q.set(arr[0]!, arr[1]!, arr[2]!, arr[3]!);
    else {
      _a.fromArray(arr, i0 * 4);
      _b.fromArray(arr, i1 * 4);
      q.slerpQuaternions(_a, _b, k);
    }
  }
  if (clip.hips) {
    const h = clip.hips;
    if (h.length === 3) out.hips.set(h[0]!, h[1]!, h[2]!);
    else {
      const x0 = i0 * 3;
      const x1 = i1 * 3;
      out.hips.set(h[x0]! + (h[x1]! - h[x0]!) * k, h[x0 + 1]! + (h[x1 + 1]! - h[x0 + 1]!) * k, h[x0 + 2]! + (h[x1 + 2]! - h[x0 + 2]!) * k);
    }
  } else out.hips.set(0, 0, 0);
  t = 0;
  return out;
}

const _t = new THREE.Quaternion();
const _id = new THREE.Quaternion();
/**
 * Blends `src` into `dst` with weight w (0..1), bone by bone. Bones only `src` has are blended from
 * identity (the T-pose), bones only `dst` has stay. A bone mask limits the blend (talking gestures
 * only move the arms and upper body).
 */
export function blendPose(dst: CanonicalPose, src: CanonicalPose, w: number, mask?: ReadonlySet<HumanBone>) {
  if (w <= 0) return dst;
  for (const b of HUMANOID_BONES) {
    if (mask && !mask.has(b)) continue;
    const s = src.rot[b];
    const d = dst.rot[b];
    if (!s && !d) continue;
    if (!d) {
      dst.rot[b] = _id.clone().slerp(s!, w);
      continue;
    }
    _t.copy(s ?? _id);
    d.slerp(_t, w);
  }
  if (!mask || mask.has('hips')) dst.hips.lerp(src.hips, w);
  return dst;
}

/** Copies a pose (so layers can be mixed without aliasing). */
export function copyPose(src: CanonicalPose, out: CanonicalPose = emptyPose()): CanonicalPose {
  for (const k of Object.keys(out.rot) as HumanBone[]) if (!src.rot[k]) delete out.rot[k];
  for (const [k, q] of Object.entries(src.rot) as Array<[HumanBone, THREE.Quaternion]>) (out.rot[k] ??= new THREE.Quaternion()).copy(q);
  out.hips.copy(src.hips);
  return out;
}

/** Bones of the upper body (for talking gestures layered over sitting or idling). */
export const UPPER_BODY: ReadonlySet<HumanBone> = new Set(HUMANOID_BONES.filter((b) => !/Leg|Foot|Toes|^hips$/.test(b)));
