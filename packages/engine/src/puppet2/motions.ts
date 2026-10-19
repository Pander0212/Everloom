/**
 * The Puppets v2 motion library. Motions are written once against the standard skeleton, relative to
 * the character's rest pose and in units of its own limbs, and compiled per character into absolute
 * Rev2D animation tracks (retargeting). See docs/puppets-v2/motions.md.
 *
 * Track kinds (angles in degrees, clockwise positive, y down; "L" = the character's left):
 *   aim    world angle of a limb bone with the body upright (0 = screen right, 90 = down)
 *   bend   local rotation relative to the parent bone (an elbow or knee bend; 0 = straight)
 *   rot    rotation added to the bone's rest rotation
 *   scale  absolute bone scaleX/scaleY (scaleX along the bone: foreshortening)
 *   reach  IK target offset from its rest position, in leg lengths (feet) or arm lengths (hands)
 *   param  absolute parameter value (BodyY, Breath, ArmBack_L, LegIk_L…)
 */
import type { Animation } from './rev2d/types.js';
import { mirrorName, normAngle, type BuiltBone } from './skeleton.js';

type Ease = 'linear' | 'smooth' | 'step';
/** [time in seconds, value, ease to the next key (default smooth)]. */
export type MotionKey = [number, number, Ease?];
export type MotionTrack =
  | { kind: 'aim' | 'bend' | 'rot'; bone: string; keys: MotionKey[]; offset?: number }
  | { kind: 'scale'; bone: string; prop: 'scaleX' | 'scaleY'; keys: MotionKey[]; offset?: number }
  | { kind: 'reach'; bone: string; axis: 'x' | 'y'; keys: MotionKey[]; offset?: number }
  | { kind: 'param'; param: string; keys: MotionKey[]; offset?: number };
export interface Motion {
  id: string;
  description: string;
  duration: number;
  loop: boolean;
  /** Views the motion is written for; it is compiled only for characters in one of them. */
  views: Array<'front' | 'threeQuarter' | 'side' | 'back'>;
  tags: string[];
  /** Locomotion: ground speed in leg lengths per second; the stage moves the character by it so planted feet stay put. */
  speed?: number;
  tracks: MotionTrack[];
}

type View = Motion['views'][number];
const FRONTISH: View[] = ['front', 'threeQuarter', 'back'];

/** Mirrors a track to the other side: names swap, angles reflect about the vertical. */
export function mirrorTrack(t: MotionTrack): MotionTrack {
  const keys = (f: (v: number) => number): MotionKey[] => t.keys.map(([tt, v, e]) => (e ? [tt, f(v), e] : [tt, f(v)]));
  switch (t.kind) {
    case 'aim': return { ...t, bone: mirrorName(t.bone), keys: keys((v) => normAngle(180 - v)) };
    case 'bend': case 'rot': return { ...t, bone: mirrorName(t.bone), keys: keys((v) => -v) };
    case 'scale': return { ...t, bone: mirrorName(t.bone) };
    case 'reach': return { ...t, bone: mirrorName(t.bone), keys: t.axis === 'x' ? keys((v) => -v) : t.keys };
    case 'param': {
      const flip = /^(BodyX|BodyAngleZ|HairX|BustX)$/.test(t.param);
      return { ...t, param: mirrorName(t.param), keys: flip ? keys((v) => -v) : t.keys };
    }
  }
}
/** The same motion done with the other side (wave_L → wave_R). */
export function mirrorMotion(m: Motion, id = mirrorName(m.id)): Motion {
  return { ...m, id, tracks: m.tracks.map(mirrorTrack) };
}
/** A track and its mirror (symmetric motions), the mirror optionally shifted in time. */
const both = (t: MotionTrack, offset?: number): MotionTrack[] => [t, offset === undefined ? mirrorTrack(t) : { ...mirrorTrack(t), offset }];
const hold = (v: number, d: number): MotionKey[] => [[0, v], [d, v]];

// --- The library -------------------------------------------------------------------------------

const wave_L: Motion = {
  id: 'wave_L', description: 'Waves with the left hand: the arm up and out, the elbow bent about 120°, the forearm swinging.',
  duration: 2, loop: true, views: FRONTISH, tags: ['greeting', 'gesture'],
  tracks: [
    { kind: 'aim', bone: 'upperarm_L', keys: [[0, -40], [1, -44], [2, -40]] },
    { kind: 'bend', bone: 'forearm_L', keys: [[0, -45], [0.25, -75], [0.5, -45], [0.75, -75], [1, -45], [1.25, -75], [1.5, -45], [1.75, -75], [2, -45]] },
    { kind: 'bend', bone: 'hand_L', keys: hold(-10, 2) },
    // The waving-hand sprite (fingers spread, palm out) when the character has one.
    { kind: 'param', param: 'HandPose_L', keys: hold(2, 2) },
    { kind: 'param', param: 'BodyAngleZ', keys: hold(-1.5, 2) },
  ],
};

const armsUp: Motion = {
  id: 'armsUp', description: 'Both arms raised overhead (cheering, stretching).',
  duration: 1.6, loop: true, views: FRONTISH, tags: ['gesture', 'happy'],
  tracks: [
    ...both({ kind: 'aim', bone: 'upperarm_L', keys: [[0, -78], [0.8, -74], [1.6, -78]] }),
    ...both({ kind: 'bend', bone: 'forearm_L', keys: [[0, -12], [0.8, -18], [1.6, -12]] }),
    { kind: 'param', param: 'BodyY', keys: [[0, 0.05], [0.8, 0.12], [1.6, 0.05]] },
  ],
};

const armsCrossed: Motion = {
  id: 'armsCrossed', description: 'Arms folded across the chest, the right arm over the left.',
  duration: 3, loop: true, views: ['front', 'threeQuarter'], tags: ['pose', 'annoyed'],
  tracks: [
    ...both({ kind: 'aim', bone: 'upperarm_L', keys: hold(80, 3) }),
    ...both({ kind: 'bend', bone: 'forearm_L', keys: hold(118, 3) }),
    { kind: 'param', param: 'ArmOver_R', keys: hold(1, 3) },
    { kind: 'param', param: 'Breath', keys: [[0, 0], [1.5, 1], [3, 0]] },
  ],
};

const handsOnHips: Motion = {
  id: 'handsOnHips', description: 'Both hands on the hips, elbows out.',
  duration: 3, loop: true, views: ['front', 'threeQuarter', 'back'], tags: ['pose', 'confident'],
  tracks: [
    ...both({ kind: 'aim', bone: 'upperarm_L', keys: hold(42, 3) }),
    ...both({ kind: 'bend', bone: 'forearm_L', keys: hold(98, 3) }),
    { kind: 'param', param: 'Breath', keys: [[0, 0], [1.5, 1], [3, 0]] },
  ],
};

const point_L: Motion = {
  id: 'point_L', description: 'Points sideways with the left arm.',
  duration: 1.5, loop: true, views: FRONTISH, tags: ['gesture'],
  tracks: [
    { kind: 'param', param: 'HandPose_L', keys: hold(4, 1.5) },
    { kind: 'aim', bone: 'upperarm_L', keys: [[0, -8], [0.75, -10], [1.5, -8]] },
    { kind: 'bend', bone: 'forearm_L', keys: hold(-4, 1.5) },
    { kind: 'param', param: 'BodyAngleZ', keys: hold(-2, 1.5) },
  ],
};

const nod: Motion = {
  id: 'nod', description: 'Nods twice (yes).',
  duration: 1.2, loop: false, views: FRONTISH, tags: ['gesture', 'yes'],
  tracks: [
    { kind: 'scale', bone: 'neck', prop: 'scaleX', keys: [[0, 1], [0.2, 0.7], [0.4, 1], [0.6, 0.7], [0.8, 1], [1.2, 1]] },
    { kind: 'param', param: 'BodyY', keys: [[0, 0], [0.2, -0.03], [0.4, 0], [0.6, -0.03], [0.8, 0], [1.2, 0]] },
  ],
};

const bow: Motion = {
  id: 'bow', description: 'A short polite bow (front view: the torso foreshortens forward).',
  duration: 2, loop: false, views: ['front', 'threeQuarter'], tags: ['greeting'],
  tracks: [
    { kind: 'scale', bone: 'spine', prop: 'scaleX', keys: [[0, 1], [0.5, 0.86], [1.3, 0.86], [2, 1]] },
    { kind: 'scale', bone: 'neck', prop: 'scaleX', keys: [[0, 1], [0.5, 0.6], [1.3, 0.6], [2, 1]] },
    { kind: 'param', param: 'BodyY', keys: [[0, 0], [0.5, -0.06], [1.3, -0.06], [2, 0]] },
    ...both({ kind: 'aim', bone: 'upperarm_L', keys: [[0, 80], [0.5, 96], [1.3, 96], [2, 80]] }),
    ...both({ kind: 'bend', bone: 'forearm_L', keys: [[0, 0], [0.5, 30], [1.3, 30], [2, 0]] }),
  ],
};

const idle: Motion = {
  id: 'idle', description: 'Standing: breathing, a slow weight shift.',
  duration: 4, loop: true, views: ['front', 'threeQuarter', 'side', 'back'], tags: ['idle'],
  tracks: [
    { kind: 'param', param: 'Breath', keys: [[0, 0], [2, 1], [4, 0]] },
    { kind: 'param', param: 'BodyX', keys: [[0, -0.02], [2, 0.02], [4, -0.02]] },
    { kind: 'param', param: 'BodyAngleZ', keys: [[0, 0.6], [2, -0.6], [4, 0.6]] },
    { kind: 'param', param: 'BodyY', keys: [[0, 0], [1, -0.02], [2, 0], [3, -0.02], [4, 0]] },
    ...both({ kind: 'rot', bone: 'upperarm_L', keys: [[0, 0], [2, -2], [4, 0]] }),
  ],
};

/**
 * Walk in place, front view: the planted foot stays locked by IK; the lifted leg lets go of IK and
 * foreshortens (a front-view knee can't bend sideways). Arms swing a little against the legs.
 */
const walkFront: Motion = {
  id: 'walk', description: 'Walking toward the viewer, in place.',
  duration: 1, loop: true, views: FRONTISH, tags: ['locomotion'],
  tracks: [
    ...both({ kind: 'param', param: 'LegIk_L', keys: [[0, 1], [0.1, 0], [0.4, 0], [0.5, 1], [1, 1]] }, 0.5),
    ...both({ kind: 'scale', bone: 'thigh_L', prop: 'scaleX', keys: [[0, 1], [0.25, 0.86], [0.5, 1], [1, 1]] }, 0.5),
    ...both({ kind: 'bend', bone: 'shin_L', keys: [[0, 0], [0.25, -6], [0.5, 0], [1, 0]] }, 0.5),
    { kind: 'param', param: 'BodyY', keys: [[0, 0], [0.25, 0.15], [0.5, 0], [0.75, 0.15], [1, 0]] },
    { kind: 'param', param: 'BodyAngleZ', keys: [[0, -1.2], [0.5, 1.2], [1, -1.2]] },
    ...both({ kind: 'rot', bone: 'upperarm_L', keys: [[0, -6], [0.5, 6], [1, -6]] }),
    ...both({ kind: 'bend', bone: 'forearm_L', keys: [[0, -6], [0.5, -14], [1, -6]] }),
  ],
};

/**
 * Walk in profile (facing screen left): the feet follow their IK targets, which slide back at ground
 * speed while planted (the stage moves the character forward by `speed`, so they stay put on the
 * floor) and swing forward in an arc; the right leg runs half a cycle behind the left.
 */
const STRIDE = 0.5; // leg lengths, front to back
const walkSide: Motion = {
  id: 'walk', description: 'Walking in profile (facing left); feet locked to the ground while planted.',
  duration: 1, loop: true, views: ['side'], tags: ['locomotion'], speed: STRIDE / 0.6,
  tracks: [
    ...['L', 'R'].flatMap((s, i): MotionTrack[] => {
      const off = i * 0.5;
      return [
        // Planted from t = 0 (front) to 0.6 (back), at constant speed; then the swing forward.
        { kind: 'reach', bone: `footTarget_${s}`, axis: 'x', offset: off, keys: [[0, -STRIDE / 2, 'linear'], [0.6, STRIDE / 2], [0.8, 0], [1, -STRIDE / 2]] },
        { kind: 'reach', bone: `footTarget_${s}`, axis: 'y', offset: off, keys: [[0, 0, 'linear'], [0.6, 0], [0.75, -0.14], [0.92, -0.04], [1, 0]] },
        { kind: 'rot', bone: `foot_${s}`, offset: off, keys: [[0, -8], [0.15, 0], [0.5, 0], [0.62, 18], [0.8, 0], [1, -8]] },
        { kind: 'rot', bone: `upperarm_${s}`, offset: off, keys: [[0, 18], [0.5, -18], [1, 18]] },
        { kind: 'bend', bone: `forearm_${s}`, offset: off, keys: [[0, -22], [0.5, -6], [1, -22]] },
      ];
    }),
    // The body is lowest as the feet pass the double support, highest over the planted leg.
    { kind: 'param', param: 'BodyY', keys: [[0, -0.06], [0.25, 0.04], [0.5, -0.06], [0.75, 0.04], [1, -0.06]] },
    { kind: 'param', param: 'BodyAngleZ', keys: hold(-3, 1) },
  ],
};

const jump: Motion = {
  id: 'jump', description: 'A small hop on the spot: crouch, up, land, settle (shows off the body physics).',
  duration: 1.6, loop: false, views: ['front', 'threeQuarter', 'side', 'back'], tags: ['happy', 'locomotion'],
  tracks: [
    { kind: 'param', param: 'BodyY', keys: [[0, 0], [0.2, -0.35], [0.4, 1], [0.6, 0.6], [0.78, -0.3], [0.95, 0], [1.6, 0]] },
    ...both({ kind: 'param', param: 'LegIk_L', keys: [[0, 1], [0.3, 1], [0.34, 0], [0.7, 0], [0.76, 1], [1.6, 1]] }),
    ...both({ kind: 'aim', bone: 'upperarm_L', keys: [[0, 75], [0.2, 95], [0.4, -30], [0.7, 20], [1, 75], [1.6, 75]] }),
  ],
};

export const MOTIONS: Motion[] = [idle, wave_L, mirrorMotion(wave_L), armsUp, armsCrossed, handsOnHips, point_L, mirrorMotion(point_L), nod, bow, walkFront, walkSide, jump];

// --- Compilation (retargeting) -----------------------------------------------------------------

type BodyMeasure = { leg: number; arm: number; height: number };

/** World rotation of every bone at rest (rotations accumulate down the chain). */
export function restWorldAngles(bones: BuiltBone[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of bones) out[b.id] = normAngle((b.parent ? out[b.parent] ?? 0 : 0) + b.rotation);
  return out;
}

/**
 * Compiles motions into absolute Rev2D animations for one character. Tracks naming bones the
 * character lacks are dropped; motions written for other views are skipped (a profile character
 * gets the profile walk, the others the front walk, both as "walk").
 */
export function compileMotions(motions: Motion[], bones: BuiltBone[], body: BodyMeasure, view: View = 'front'): Animation[] {
  const byId = new Map(bones.map((b) => [b.id, b]));
  const world = restWorldAngles(bones);
  const out: Animation[] = [];
  for (const m of motions) {
    if (!m.views.includes(view)) continue;
    const tracks: Animation['tracks'] = [];
    for (const t of m.tracks) {
      let target: string;
      let map: (v: number) => number;
      if (t.kind === 'param') { target = `param:${t.param}`; map = (v) => v; }
      else {
        const b = byId.get(t.bone);
        if (!b) continue;
        switch (t.kind) {
          case 'aim': { const pw = b.parent ? world[b.parent] ?? 0 : 0; target = `bone:${b.id}.rotation`; map = (v) => unwrapNear(normAngle(v - pw), b.rotation); break; }
          case 'bend': target = `bone:${b.id}.rotation`; map = (v) => v; break;
          case 'rot': target = `bone:${b.id}.rotation`; map = (v) => b.rotation + v; break;
          case 'scale': target = `bone:${b.id}.${t.prop}`; map = (v) => v; break;
          case 'reach': {
            const unit = b.id.startsWith('foot') ? body.leg : body.arm;
            const rest = t.axis === 'x' ? b.x : b.y;
            target = `bone:${b.id}.${t.axis}`; map = (v) => rest + v * unit; break;
          }
        }
      }
      tracks.push({ target, offset: t.offset ?? 0, keys: t.keys.map(([tt, v, e]) => ({ t: tt, v: round(map(v)), ease: e ?? 'smooth' })) });
    }
    const anim: Animation = { id: m.id, duration: m.duration, loop: m.loop, tracks, description: m.description };
    if (m.speed !== undefined) anim.events = [{ t: 0, name: 'locomotion', data: { speed: round(m.speed * body.leg) } }];
    out.push(anim);
  }
  return out;
}

/** Picks the turn of an angle closest to a reference (so an aimed arm rotates the short way from rest). */
const unwrapNear = (a: number, ref: number) => a + 360 * Math.round((ref - a) / 360);
const round = (v: number) => Math.round(v * 1000) / 1000;
