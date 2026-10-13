/** Unity serialized animation → canonical motion. Muscle channels use documented normalized ranges;
 * generic clips without their model assume the canonical T-pose and should be previewed before saving. */
import * as THREE from 'three';
import { mapBones, type HumanBone } from '@everloom/engine';
import { readAnim, type Key, type UnityAnim } from '@everloom/engine/unity';
import type { ClipJSON } from '../clip';

type Muscle = { bone: HumanBone; axis: 'x' | 'y' | 'z'; min: number; max: number; sign?: number };
export function muscle(name: string): Muscle | undefined {
  const core = /^(Spine|Chest|UpperChest|Neck|Head) (Front-Back|Left-Right|Twist Left-Right)$/.exec(name);
  if (core) return { bone: (core[1]![0]!.toLowerCase() + core[1]!.slice(1)) as HumanBone, axis: core[2] === 'Front-Back' ? 'x' : core[2] === 'Left-Right' ? 'z' : 'y', min: -40, max: 40 };
  const side = /^(Left|Right) (.*)$/.exec(name);
  if (side) {
    const s = side[1]!.toLowerCase(), sign = s === 'left' ? 1 : -1;
    const limb: Record<string, [string, 'x' | 'y' | 'z', number, number, number]> = {
      'Shoulder Down-Up': ['Shoulder', 'z', -15, 30, sign], 'Shoulder Front-Back': ['Shoulder', 'y', -15, 15, sign],
      'Arm Down-Up': ['UpperArm', 'z', -90, 60, sign], 'Arm Front-Back': ['UpperArm', 'y', -100, 100, -sign], 'Arm Twist In-Out': ['UpperArm', 'x', -90, 90, sign],
      'Forearm Stretch': ['LowerArm', 'y', -130, 0, sign], 'Forearm Twist In-Out': ['LowerArm', 'x', -90, 90, sign],
      'Hand Down-Up': ['Hand', 'y', -80, 80, sign], 'Hand In-Out': ['Hand', 'z', -40, 40, sign],
      'Upper Leg Front-Back': ['UpperLeg', 'x', -90, 50, 1], 'Upper Leg In-Out': ['UpperLeg', 'z', -45, 45, sign], 'Upper Leg Twist In-Out': ['UpperLeg', 'y', -60, 60, sign],
      'Leg Stretch': ['LowerLeg', 'x', 0, 140, -1], 'Leg Twist In-Out': ['LowerLeg', 'y', -60, 60, sign],
      'Foot Up-Down': ['Foot', 'x', -50, 50, 1], 'Foot Twist In-Out': ['Foot', 'y', -30, 30, sign], 'Toes Up-Down': ['Toes', 'x', -50, 50, 1],
    };
    const v = limb[side[2]!];
    if (v) return { bone: `${s}${v[0]}` as HumanBone, axis: v[1], min: v[2], max: v[3], sign: v[4] };
  }
  const finger = /^(Left|Right)Hand\.(Thumb|Index|Middle|Ring|Little)\.([123]) Stretched$/.exec(name);
  if (finger) return { bone: `${finger[1]!.toLowerCase()}${finger[2]}${['Proximal', 'Intermediate', 'Distal'][Number(finger[3]) - 1]}` as HumanBone, axis: 'z', min: -90, max: 0, sign: finger[1] === 'Left' ? 1 : -1 };
  return undefined;
}
function scalar(keys: Key<number>[], time: number) {
  if (!keys.length) return 0;
  if (time <= keys[0]!.t) return keys[0]!.v;
  const index = keys.findIndex(k => k.t >= time);
  if (index < 0) return keys.at(-1)!.v;
  const a = keys[index - 1]!, b = keys[index]!;
  return THREE.MathUtils.lerp(a.v, b.v, b.t === a.t ? 0 : (time - a.t) / (b.t - a.t));
}
function vector(keys: Key<number[]>[], t: number, size: number) { return Array.from({ length: size }, (_, i) => scalar(keys.map(k => ({ t: k.t, v: k.v[i]! })), t)); }
export function unityMotion(a: UnityAnim, opts: { id: string; loop?: boolean; source?: string }): { clip: ClipJSON; notes: string[] } {
  const fps = 30, length = Math.min(30, Math.max(1 / fps, a.length)), loop = opts.loop ?? a.loop;
  const frames = Math.max(2, Math.round(length * fps) + (loop ? 0 : 1));
  const notes = [];
  const tracks: ClipJSON['tracks'] = {}, morphs: Record<string, number[]> = {};
  for (const c of a.blendShapes.slice(0, 64)) morphs[c.name] = Array.from({ length: frames }, (_, i) => THREE.MathUtils.clamp(scalar(c.keys, i / fps) / 100, 0, 1));
  const paths = [...a.rotations, ...a.eulers, ...a.positions].map(c => c.path);
  const mapping = mapBones([...new Set(paths)].map(path => ({ name: path.split('/').pop()!, parent: path.split('/').slice(-2, -1)[0] ?? null }))).map;
  const role = (path: string) => Object.entries(mapping).find(([, name]) => name === path.split('/').pop())?.[0] as HumanBone | undefined;
  for (const c of [...a.rotations, ...a.eulers]) {
    const bone = role(c.path); if (!bone) { notes.push(`Unmapped transform: ${c.path}`); continue; }
    tracks[bone] = Array.from({ length: frames }, (_, i) => {
      const v = vector(c.keys, i / fps, c.keys[0]?.v.length ?? 4);
      const q = v.length === 4 ? new THREE.Quaternion(v[0], -v[1]!, -v[2]!, v[3]).normalize() : new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(v[0]!), THREE.MathUtils.degToRad(-v[1]!), THREE.MathUtils.degToRad(-v[2]!), 'YXZ'));
      return q.toArray();
    }).flat();
  }
  const channels = a.muscleCurves.map(c => ({ ...c, spec: muscle(c.name) }));
  for (const bone of new Set(channels.flatMap(c => c.spec ? [c.spec.bone] : []))) {
    tracks[bone] = Array.from({ length: frames }, (_, i) => {
      const q = new THREE.Quaternion();
      for (const c of channels.filter(c => c.spec?.bone === bone)) {
        const m = c.spec!, v = THREE.MathUtils.clamp(scalar(c.keys, i / fps), -1, 1);
        const degrees = (v < 0 ? -v * m.min : v * m.max) * (m.sign ?? 1);
        const axis = new THREE.Vector3(m.axis === 'x' ? 1 : 0, m.axis === 'y' ? 1 : 0, m.axis === 'z' ? 1 : 0);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(degrees)));
      }
      return q.normalize().toArray();
    }).flat();
  }
  if (channels.length) notes.push('Humanoid muscles use approximate canonical ranges. Preview the motion; Unity avatar-specific muscle limits and IK are not reproduced.');
  for (const c of channels) if (!c.spec) notes.push(`Unsupported Animator channel: ${c.name}`);
  if (a.rotations.length || a.eulers.length) notes.push('Standalone transforms assume canonical bone axes. Import with the original avatar for rest-pose retargeting.');
  if (a.length > 30) notes.push('The first 30 seconds are imported.');
  if (a.other || a.scales.length) notes.push('Material, object-toggle and scale curves are not motion tracks.');
  if (!Object.keys(tracks).length && !Object.keys(morphs).length) throw new Error('No supported motion or blendshape curves. Include the source avatar for unnamed transform bones.');
  return { clip: { v: 1, id: opts.id, fps, frames, loop, tracks, ...(Object.keys(morphs).length ? { morphs } : {}), source: opts.source?.slice(0, 200) }, notes };
}
export function unityMotionText(text: string, opts: Parameters<typeof unityMotion>[1]) {
  const a = readAnim(text); if (!a) throw new Error('This file is not a serialized Unity AnimationClip');
  return unityMotion(a, opts);
}
