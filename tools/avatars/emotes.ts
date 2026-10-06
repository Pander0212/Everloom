/**
 * Everloom's authored emotes (see author.ts for the angle conventions). Right-side bones default
 * to the mirror of the left; give the right side explicitly for one-sided gestures.
 */
import type { Authored, E3, KeyPose } from './author';

// Reusable bits.
const FIST = (side: 'left' | 'right', curl = 75): KeyPose => {
  const s = side === 'left' ? -1 : 1;
  const out: KeyPose = {};
  for (const f of ['Index', 'Middle', 'Ring', 'Little'] as const) {
    out[`${side}${f}Proximal`] = [0, 0, s * curl];
    out[`${side}${f}Intermediate`] = [0, 0, s * (curl + 15)];
    out[`${side}${f}Distal`] = [0, 0, s * curl * 0.7];
  }
  out[`${side}ThumbProximal`] = [0, s * -25, s * 20];
  out[`${side}ThumbDistal`] = [0, s * -10, s * 35];
  return out;
};
const both = (p: KeyPose): KeyPose => p; // left side given; author.ts mirrors it
const R = (x: number, y: number, z: number): E3 => [x, y, z];

export const AUTHORED: Authored[] = [
  // ------------------------------------------------------------------ social
  {
    id: 'wave',
    loop: false,
    duration: 2.3,
    mirror: false,
    keys: [
      { t: 0.4, pose: { rightUpperArm: R(0, 25, -40), rightLowerArm: R(0, 0, -55), rightHand: R(0, 0, -5), neck: R(0, -4, -3), head: R(-3, -6, -4) } },
      { t: 0.65, pose: { rightLowerArm: R(0, 10, -35), rightHand: R(0, 0, 10) } },
      { t: 0.9, pose: { rightLowerArm: R(0, 10, -72), rightHand: R(0, 0, -15) } },
      { t: 1.15, pose: { rightLowerArm: R(0, 10, -35), rightHand: R(0, 0, 10) } },
      { t: 1.4, pose: { rightLowerArm: R(0, 10, -72), rightHand: R(0, 0, -15) } },
      { t: 1.7, pose: { rightUpperArm: R(0, 25, -40), rightLowerArm: R(0, 0, -55), rightHand: R(0, 0, -5), neck: R(0, -4, -3), head: R(-3, -6, -4) } },
    ],
  },
  {
    id: 'bow',
    loop: false,
    duration: 2.4,
    keys: [
      { t: 0.7, pose: { spine: R(22, 0, 0), chest: R(14, 0, 0), upperChest: R(6, 0, 0), neck: R(10, 0, 0), head: R(8, 0, 0), leftUpperArm: R(0, -18, -76), leftLowerArm: R(0, -20, 0) }, hips: R(0, -0.01, -0.04) },
      { t: 1.4, pose: { spine: R(24, 0, 0), chest: R(15, 0, 0), upperChest: R(6, 0, 0), neck: R(10, 0, 0), head: R(8, 0, 0), leftUpperArm: R(0, -20, -76), leftLowerArm: R(0, -20, 0) }, hips: R(0, -0.01, -0.04) },
    ],
  },
  {
    id: 'clap',
    loop: false,
    duration: 2.2,
    keys: [
      { t: 0.35, pose: both({ leftUpperArm: R(0, -45, -55), leftLowerArm: R(0, -95, 0), leftHand: R(-70, 0, 0) }) },
      { t: 0.55, pose: both({ leftUpperArm: R(0, -50, -55), leftLowerArm: R(0, -118, 0), leftHand: R(-80, 0, 0) }) },
      { t: 0.75, pose: both({ leftUpperArm: R(0, -45, -55), leftLowerArm: R(0, -95, 0), leftHand: R(-70, 0, 0) }) },
      { t: 0.95, pose: both({ leftUpperArm: R(0, -50, -55), leftLowerArm: R(0, -118, 0), leftHand: R(-80, 0, 0) }) },
      { t: 1.15, pose: both({ leftUpperArm: R(0, -45, -55), leftLowerArm: R(0, -95, 0), leftHand: R(-70, 0, 0) }) },
      { t: 1.35, pose: both({ leftUpperArm: R(0, -50, -55), leftLowerArm: R(0, -118, 0), leftHand: R(-80, 0, 0) }) },
      { t: 1.6, pose: both({ leftUpperArm: R(0, -45, -55), leftLowerArm: R(0, -95, 0), leftHand: R(-70, 0, 0) }) },
    ],
  },
  {
    id: 'shrug',
    loop: false,
    duration: 1.9,
    keys: [
      { t: 0.45, pose: { leftShoulder: R(0, 0, 16), leftUpperArm: R(0, -5, -72), leftLowerArm: R(0, -55, 32), leftHand: R(-80, 0, 20), neck: R(0, 0, 4), head: R(-4, 0, 8) } },
      { t: 1.1, pose: { leftShoulder: R(0, 0, 12), leftUpperArm: R(0, -5, -72), leftLowerArm: R(0, -55, 32), leftHand: R(-80, 0, 20), neck: R(0, 0, 4), head: R(-4, 0, 8) } },
    ],
  },
  {
    id: 'point',
    loop: false,
    duration: 2.0,
    mirror: false,
    keys: [
      {
        t: 0.45,
        pose: {
          rightUpperArm: R(0, 92, 2),
          rightLowerArm: R(0, 4, 0),
          rightHand: R(0, 0, 0),
          ...FIST('right', 80),
          rightIndexProximal: R(0, 0, 0),
          rightIndexIntermediate: R(0, 0, 0),
          rightIndexDistal: R(0, 0, 0),
          upperChest: R(0, -8, 0),
          head: R(0, -10, 0),
        },
      },
      {
        t: 1.4,
        pose: {
          rightUpperArm: R(0, 92, 2),
          rightLowerArm: R(0, 4, 0),
          ...FIST('right', 80),
          rightIndexProximal: R(0, 0, 0),
          rightIndexIntermediate: R(0, 0, 0),
          rightIndexDistal: R(0, 0, 0),
          upperChest: R(0, -8, 0),
          head: R(0, -10, 0),
        },
      },
    ],
  },
  {
    id: 'hug',
    loop: false,
    duration: 2.8,
    keys: [
      { t: 0.5, pose: { leftUpperArm: R(0, -62, -20), leftLowerArm: R(0, -55, 0), spine: R(6, 0, 0), head: R(4, 0, 0) } },
      { t: 0.9, pose: { leftUpperArm: R(0, -75, -18), leftLowerArm: R(0, -80, 0), spine: R(8, 0, 0), head: R(6, 0, 10) } },
      { t: 2.0, pose: { leftUpperArm: R(0, -75, -18), leftLowerArm: R(0, -82, 0), spine: R(8, 0, 0), head: R(6, 0, 10) } },
    ],
  },
  {
    id: 'cheer',
    loop: false,
    duration: 2.0,
    keys: [
      { t: 0.3, pose: { leftUpperArm: R(0, 10, 55), leftLowerArm: R(0, 0, 20), ...FIST('left'), ...FIST('right'), head: R(-10, 0, 0) }, hips: R(0, -0.04, 0) },
      { t: 0.55, pose: { leftUpperArm: R(0, 8, 68), leftLowerArm: R(0, 0, 5), head: R(-14, 0, 0) }, hips: R(0, 0.05, 0) },
      { t: 0.85, pose: { leftUpperArm: R(0, 10, 55), leftLowerArm: R(0, 0, 25), head: R(-10, 0, 0) }, hips: R(0, -0.03, 0) },
      { t: 1.1, pose: { leftUpperArm: R(0, 8, 68), leftLowerArm: R(0, 0, 5), head: R(-14, 0, 0) }, hips: R(0, 0.05, 0) },
      { t: 1.45, pose: { leftUpperArm: R(0, 10, 55), leftLowerArm: R(0, 0, 20), ...FIST('left'), ...FIST('right'), head: R(-8, 0, 0) }, hips: R(0, 0, 0) },
    ],
  },
  // ------------------------------------------------------------------ emotions
  {
    id: 'laugh',
    loop: false,
    duration: 2.4,
    additive: ['spine', 'chest', 'upperChest', 'neck', 'head'],
    keys: [
      { t: 0.25, pose: { spine: R(-4, 0, 0), head: R(-12, 0, 0), leftUpperArm: R(0, -35, -66), leftLowerArm: R(0, -85, 0) } },
      ...[0.45, 0.65, 0.85, 1.05, 1.25, 1.45].map((t, i) => ({ t, pose: { spine: R(i % 2 ? -3 : 5, 0, 0), upperChest: R(i % 2 ? 0 : 4, 0, 0), head: R(i % 2 ? -12 : -4, 0, i % 2 ? 2 : -2), leftUpperArm: R(0, -35, -66), leftLowerArm: R(0, -85, 0) } })),
      { t: 1.75, pose: { spine: R(2, 0, 0), head: R(-6, 0, 0), leftUpperArm: R(0, -30, -68), leftLowerArm: R(0, -70, 0) } },
    ],
  },
  {
    id: 'cry',
    loop: false,
    duration: 3.2,
    additive: ['spine', 'upperChest'],
    keys: [
      { t: 0.6, pose: { spine: R(10, 0, 0), neck: R(14, 0, 0), head: R(16, 0, 0), leftUpperArm: R(0, -55, -42), leftLowerArm: R(0, -135, 0), leftHand: R(0, 0, 20) } },
      ...[0.9, 1.15, 1.4, 1.65, 1.9, 2.15].map((t, i) => ({ t, pose: { spine: R(i % 2 ? 6 : 10, 0, 0), upperChest: R(i % 2 ? 0 : 3, 0, 0), neck: R(14, 0, 0), head: R(16 + (i % 2) * 3, 0, 0), leftUpperArm: R(0, -55, -42), leftLowerArm: R(0, -135, 0), leftHand: R(0, 0, 20) } })),
      { t: 2.5, pose: { spine: R(8, 0, 0), neck: R(10, 0, 0), head: R(12, 0, 0), leftUpperArm: R(0, -50, -48), leftLowerArm: R(0, -120, 0) } },
    ],
  },
  {
    id: 'angry',
    loop: false,
    duration: 2.1,
    mirror: false,
    keys: [
      { t: 0.35, pose: { ...FIST('left'), ...FIST('right'), leftUpperArm: R(0, -10, -62), rightUpperArm: R(0, 10, 62), leftLowerArm: R(0, -35, 0), rightLowerArm: R(0, 35, 0), neck: R(-4, 0, 0), head: R(6, 0, 0), rightUpperLeg: R(-35, 0, 0), rightLowerLeg: R(45, 0, 0) } },
      { t: 0.6, pose: { leftUpperArm: R(0, -8, -66), rightUpperArm: R(0, 8, 66), leftLowerArm: R(0, -45, 0), rightLowerArm: R(0, 45, 0), spine: R(8, 0, 0), head: R(8, 0, 0), rightUpperLeg: R(-4, 0, 0), rightLowerLeg: R(4, 0, 0) }, hips: R(0, -0.04, 0) },
      { t: 1.4, pose: { ...FIST('left'), ...FIST('right'), leftUpperArm: R(0, -10, -64), rightUpperArm: R(0, 10, 64), leftLowerArm: R(0, -40, 0), rightLowerArm: R(0, 40, 0), spine: R(4, 0, 0), head: R(6, 0, 0) } },
    ],
  },
  {
    id: 'embarrassed',
    loop: false,
    duration: 2.6,
    mirror: false,
    keys: [
      { t: 0.5, pose: { rightUpperArm: R(0, 35, -55), rightLowerArm: R(0, 150, 0), rightHand: R(0, 0, -20), neck: R(10, 15, -4), head: R(12, 12, -6), spine: R(4, 0, 0) } },
      { t: 1.0, pose: { rightUpperArm: R(0, 35, -58), rightLowerArm: R(0, 145, 0), rightHand: R(0, 0, -10), neck: R(10, 15, -4), head: R(12, 12, -6) } },
      { t: 1.5, pose: { rightUpperArm: R(0, 35, -55), rightLowerArm: R(0, 150, 0), rightHand: R(0, 0, -25), neck: R(12, 18, -4), head: R(14, 12, -6) } },
      { t: 2.0, pose: { rightUpperArm: R(0, 35, -56), rightLowerArm: R(0, 148, 0), neck: R(8, 10, -2), head: R(10, 8, -4) } },
    ],
  },
  {
    id: 'surprised',
    loop: false,
    duration: 1.9,
    keys: [
      { t: 0.18, pose: { spine: R(-8, 0, 0), upperChest: R(-6, 0, 0), head: R(-10, 0, 0), leftShoulder: R(0, 0, 10), leftUpperArm: R(0, -40, -40), leftLowerArm: R(0, -110, 0), leftHand: R(0, 0, 25) }, hips: R(0, 0.01, -0.05) },
      { t: 1.1, pose: { spine: R(-6, 0, 0), upperChest: R(-4, 0, 0), head: R(-8, 0, 0), leftShoulder: R(0, 0, 6), leftUpperArm: R(0, -40, -44), leftLowerArm: R(0, -105, 0), leftHand: R(0, 0, 20) }, hips: R(0, 0, -0.05) },
    ],
  },
  {
    id: 'scared',
    loop: false,
    duration: 2.3,
    keys: [
      { t: 0.25, pose: { spine: R(18, 0, 0), upperChest: R(8, 0, 0), neck: R(10, 0, 0), head: R(14, 0, 0), leftShoulder: R(0, 0, 16), leftUpperArm: R(0, -65, -15), leftLowerArm: R(0, -130, 0), leftUpperLeg: R(-25, 0, 0), leftLowerLeg: R(40, 0, 0), leftFoot: R(-15, 0, 0) }, hips: R(0, -0.1, -0.05) },
      { t: 1.4, pose: { spine: R(16, 0, 0), upperChest: R(8, 0, 0), neck: R(10, 0, 0), head: R(12, 0, 0), leftShoulder: R(0, 0, 12), leftUpperArm: R(0, -62, -18), leftLowerArm: R(0, -128, 0), leftUpperLeg: R(-22, 0, 0), leftLowerLeg: R(36, 0, 0), leftFoot: R(-14, 0, 0) }, hips: R(0, -0.09, -0.05) },
    ],
  },
  {
    id: 'thinking',
    loop: false,
    duration: 3.0,
    mirror: false,
    keys: [
      { t: 0.6, pose: { rightUpperArm: R(0, 45, 58), rightLowerArm: R(0, 150, 0), rightHand: R(0, 0, 25), ...FIST('right', 55), leftUpperArm: R(0, -45, -70), leftLowerArm: R(0, -95, 0), neck: R(-4, -6, 6), head: R(-6, -8, 8) } },
      { t: 2.2, pose: { rightUpperArm: R(0, 45, 58), rightLowerArm: R(0, 150, 0), rightHand: R(0, 0, 25), ...FIST('right', 55), leftUpperArm: R(0, -45, -70), leftLowerArm: R(0, -95, 0), neck: R(-6, -10, 6), head: R(-8, -12, 10) } },
    ],
  },
  {
    id: 'sigh',
    loop: false,
    duration: 2.3,
    additive: ['spine', 'upperChest', 'neck', 'head', 'leftShoulder', 'rightShoulder'],
    keys: [
      { t: 0.7, pose: { spine: R(-5, 0, 0), upperChest: R(-5, 0, 0), head: R(-8, 0, 0), leftShoulder: R(0, 0, 9) } },
      { t: 1.4, pose: { spine: R(6, 0, 0), upperChest: R(4, 0, 0), neck: R(6, 0, 0), head: R(10, 0, 0), leftShoulder: R(0, 0, -5) } },
      { t: 1.8, pose: { spine: R(4, 0, 0), neck: R(4, 0, 0), head: R(6, 0, 0), leftShoulder: R(0, 0, -3) } },
    ],
  },
  {
    id: 'victory',
    loop: false,
    duration: 2.2,
    mirror: false,
    keys: [
      { t: 0.3, pose: { rightUpperArm: R(0, 20, -20), rightLowerArm: R(0, 0, -95), ...FIST('right'), ...FIST('left'), leftUpperArm: R(0, -20, -70), leftLowerArm: R(0, -60, 0) }, hips: R(0, -0.05, 0) },
      { t: 0.55, pose: { rightUpperArm: R(0, 10, -75), rightLowerArm: R(0, 0, -10), head: R(-14, 0, 0), spine: R(-6, 0, 0) }, hips: R(0, 0.06, 0) },
      { t: 0.9, pose: { rightUpperArm: R(0, 20, -20), rightLowerArm: R(0, 0, -100), head: R(-6, 0, 0) }, hips: R(0, -0.03, 0) },
      { t: 1.2, pose: { rightUpperArm: R(0, 20, -25), rightLowerArm: R(0, 0, -95), ...FIST('right'), head: R(-4, 0, 0) }, hips: R(0, 0, 0) },
    ],
  },
  // ------------------------------------------------------------------ idles (loops)
  {
    id: 'idle_relaxed',
    loop: true,
    duration: 5,
    additive: ['spine', 'chest', 'neck', 'head'],
    keys: [
      { t: 0, pose: { spine: R(0, 4, 3), head: R(2, -6, 4), leftUpperArm: R(0, -8, -78), leftLowerArm: R(0, -18, 0), leftUpperLeg: R(-4, 0, -3), leftLowerLeg: R(10, 0, 0) }, hips: R(0.03, -0.01, 0) },
      { t: 2.5, pose: { spine: R(0, 3, 4), head: R(2, -2, 6), leftUpperArm: R(0, -6, -76), leftLowerArm: R(0, -20, 0), leftUpperLeg: R(-5, 0, -3), leftLowerLeg: R(12, 0, 0) }, hips: R(0.035, -0.012, 0) },
    ],
  },
  {
    id: 'idle_shy',
    loop: true,
    duration: 4,
    keys: [
      { t: 0, pose: { leftUpperArm: R(0, -32, -66), leftLowerArm: R(0, -62, 0), leftHand: R(0, 0, 10), neck: R(8, 0, 4), head: R(10, 6, 6), leftUpperLeg: R(0, 0, 3), spine: R(4, 0, 0) } },
      { t: 2, pose: { leftUpperArm: R(0, -33, -66), leftLowerArm: R(0, -64, 0), leftHand: R(0, 0, 12), neck: R(9, 0, 4), head: R(12, 10, 5), leftUpperLeg: R(0, 0, 3), spine: R(4, 0, 0) } },
    ],
  },
  {
    id: 'idle_tired',
    loop: true,
    duration: 5,
    keys: [
      { t: 0, pose: { spine: R(12, 0, 0), chest: R(6, 0, 0), neck: R(10, 0, 0), head: R(14, 0, 4), leftShoulder: R(0, 0, -6), leftUpperArm: R(0, 6, -82), leftLowerArm: R(0, -6, 0) }, hips: R(0, -0.02, 0) },
      { t: 2.5, pose: { spine: R(10, 0, 0), chest: R(5, 0, 0), neck: R(8, 0, 0), head: R(10, 0, 2), leftShoulder: R(0, 0, -4), leftUpperArm: R(0, 6, -80), leftLowerArm: R(0, -8, 0) }, hips: R(0, -0.015, 0) },
    ],
  },
  // ------------------------------------------------------------------ dances (loops, timed to their bpm)
  {
    // 90 bpm, a sway every two beats.
    id: 'dance_sway',
    loop: true,
    duration: 4 * (60 / 90),
    keys: [
      { t: 0, pose: { spine: R(0, 0, 5), head: R(0, 0, -4), leftUpperArm: R(0, -20, -66), leftLowerArm: R(0, -40, 0), leftUpperLeg: R(0, 0, -2), leftLowerLeg: R(8, 0, 0) }, hips: R(0.04, -0.02, 0) },
      { t: 2 * (60 / 90), pose: { spine: R(0, 0, -5), head: R(0, 0, 4), leftUpperArm: R(0, -25, -70), leftLowerArm: R(0, -45, 0), leftUpperLeg: R(0, 0, 2), leftLowerLeg: R(2, 0, 0) }, hips: R(-0.04, -0.02, 0) },
    ],
  },
  {
    // 128 bpm, down on every beat, arms pumping on alternate beats.
    id: 'dance_bounce',
    loop: true,
    duration: 4 * (60 / 128),
    mirror: false,
    keys: [0, 1, 2, 3].flatMap((beat) => {
      const t = beat * (60 / 128);
      const up = beat % 2 ? 'right' : 'left';
      return [
        { t, pose: { leftUpperLeg: R(-14, 0, 0), rightUpperLeg: R(-14, 0, 0), leftLowerLeg: R(26, 0, 0), rightLowerLeg: R(26, 0, 0), leftFoot: R(-12, 0, 0), rightFoot: R(-12, 0, 0), leftUpperArm: up === 'left' ? R(0, -35, 25) : R(0, -30, -50), rightUpperArm: up === 'right' ? R(0, 35, -25) : R(0, 30, 50), leftLowerArm: R(0, -85, 0), rightLowerArm: R(0, 85, 0), ...FIST('left'), ...FIST('right'), head: R(6, 0, 0) }, hips: R(0, -0.06, 0) },
        { t: t + 0.5 * (60 / 128), pose: { leftUpperLeg: R(-2, 0, 0), rightUpperLeg: R(-2, 0, 0), leftLowerLeg: R(4, 0, 0), rightLowerLeg: R(4, 0, 0), leftFoot: R(0, 0, 0), rightFoot: R(0, 0, 0), leftUpperArm: R(0, -15, -55), rightUpperArm: R(0, 15, 55), leftLowerArm: R(0, -70, 0), rightLowerArm: R(0, 70, 0), head: R(-2, 0, 0) }, hips: R(0, 0.01, 0) },
      ];
    }),
  },
  {
    // 110 bpm, arms waving overhead side to side over two bars.
    id: 'dance_arms',
    loop: true,
    duration: 8 * (60 / 110),
    keys: [0, 1, 2, 3].map((i) => {
      const t = i * 2 * (60 / 110);
      const s = i % 2 ? 1 : -1;
      return { t, pose: { leftUpperArm: R(0, 0, 62 + s * 10), leftLowerArm: R(0, 0, 20 - s * 15), spine: R(0, 0, s * 6), head: R(-6, 0, s * 4), leftUpperLeg: R(-3, 0, 0), leftLowerLeg: R(6, 0, 0) }, hips: R(s * -0.03, -0.015, 0) };
    }),
  },
];
