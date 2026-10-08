/**
 * Everloom's authored paired animations (see author.ts for the angle conventions). Each role is an
 * ordinary authored clip; the paired file adds where the roles stand and which bones meet when.
 *
 * Role 0 stands on the left facing right (yaw +), role 1 on the right facing left (yaw −). Facing
 * right, a character's right hand is on the camera side; facing left, its left hand is.
 */
import type { Authored, E3 } from './author';

const R = (x: number, y: number, z: number): E3 => [x, y, z];

export interface AuthoredPaired {
  id: string;
  label: string;
  aliases: string[];
  loop: boolean;
  roles: Array<{ name: string; clip: Omit<Authored, 'id' | 'loop'>; offset: [number, number]; yaw: number }>;
  contacts: Array<{ a: { role: number; bone: string }; b: { role: number; bone: string }; from: number; to: number }>;
}

// Handshake: right hands forward and a little down, three pumps.
const shake: Omit<Authored, 'id' | 'loop'> = {
  duration: 2.8,
  mirror: false,
  keys: [
    { t: 0.55, pose: { rightUpperArm: R(0, 55, 52), rightLowerArm: R(0, 38, 0), rightHand: R(0, 0, 0), head: R(4, 0, 0) } },
    { t: 0.95, pose: { rightUpperArm: R(0, 55, 46), rightLowerArm: R(0, 34, 0) } },
    { t: 1.2, pose: { rightUpperArm: R(0, 55, 56), rightLowerArm: R(0, 38, 0) } },
    { t: 1.45, pose: { rightUpperArm: R(0, 55, 46), rightLowerArm: R(0, 34, 0) } },
    { t: 1.7, pose: { rightUpperArm: R(0, 55, 56), rightLowerArm: R(0, 38, 0) } },
    { t: 2.05, pose: { rightUpperArm: R(0, 55, 52), rightLowerArm: R(0, 38, 0), rightHand: R(0, 0, 0), head: R(4, 0, 0) } },
  ],
};

// High five: wind up, slap at 0.8 s, a beat of holding, back down.
const fiveRight: Omit<Authored, 'id' | 'loop'> = {
  duration: 2.0,
  mirror: false,
  keys: [
    { t: 0.45, pose: { rightUpperArm: R(0, 15, -62), rightLowerArm: R(0, 70, 0), rightHand: R(-10, 0, 0), spine: R(0, 6, 0) } },
    { t: 0.8, pose: { rightUpperArm: R(0, 45, -42), rightLowerArm: R(0, 12, 0), rightHand: R(-25, 0, 0), spine: R(0, -6, 0) } },
    { t: 1.05, pose: { rightUpperArm: R(0, 45, -40), rightLowerArm: R(0, 14, 0), rightHand: R(-25, 0, 0), spine: R(0, -4, 0) } },
  ],
};
const mirrorKeys = (c: Omit<Authored, 'id' | 'loop'>): Omit<Authored, 'id' | 'loop'> => ({
  ...c,
  keys: c.keys.map((k) => ({ ...k, pose: Object.fromEntries(Object.entries(k.pose).map(([b, [x, y, z]]) => [b.startsWith('right') ? 'left' + b.slice(5) : b.startsWith('left') ? 'right' + b.slice(4) : b, [x, -y, -z]])) })),
});

// Hug: arms open wide, then wrap around the other's back (one pair over the shoulders, the other
// lower, so arms don't cross), heads turned to the same side, a gentle squeeze.
const hug = (high: boolean): Omit<Authored, 'id' | 'loop'> => {
  const z = high ? 4 : -30, head = high ? 22 : -22;
  return {
    duration: 3.4,
    keys: [
      { t: 0.6, pose: { leftUpperArm: R(0, -30, z), leftLowerArm: R(0, -40, 0), spine: R(4, 0, 0), head: R(2, head * 0.5, 0) } },
      { t: 1.0, pose: { leftUpperArm: R(0, -52, z - 4), leftLowerArm: R(0, -105, 0), leftHand: R(0, -20, 0), spine: R(6, 0, 0), chest: R(3, 0, 0), head: R(4, head, high ? -6 : 6) } },
      { t: 1.6, pose: { leftUpperArm: R(0, -56, z - 6), leftLowerArm: R(0, -112, 0), leftHand: R(0, -20, 0), spine: R(7, 0, 0), chest: R(4, 0, 0), head: R(4, head, high ? -6 : 6) } },
      { t: 2.5, pose: { leftUpperArm: R(0, -52, z - 4), leftLowerArm: R(0, -105, 0), leftHand: R(0, -20, 0), spine: R(6, 0, 0), chest: R(3, 0, 0), head: R(4, head, high ? -6 : 6) } },
    ],
  };
};

// Dancing together: both hands held, a slow side-to-side sway on a four-second loop.
const sway = (phase: 1 | -1): Omit<Authored, 'id' | 'loop'> => ({
  duration: 4,
  keys: [0, 1, 2, 3].map((i) => {
    const s = (i % 2 === 0 ? 1 : -1) * phase;
    return {
      t: i,
      pose: { leftUpperArm: R(0, -48, -52), leftLowerArm: R(0, -34, 0), spine: R(2, 0, 4 * s), chest: R(0, 0, 2 * s), head: R(3, 0, -3 * s), leftUpperLeg: R(s > 0 ? -6 : 0, 0, 0), leftLowerLeg: R(s > 0 ? 10 : 0, 0, 0), rightUpperLeg: R(s < 0 ? -6 : 0, 0, 0), rightLowerLeg: R(s < 0 ? 10 : 0, 0, 0) },
      hips: R(0.035 * s, -0.01, 0),
    };
  }),
});

export const PAIRED: AuthoredPaired[] = [
  {
    id: 'handshake',
    label: 'Handshake',
    aliases: ['shake hands', 'shake_hands'],
    loop: false,
    roles: [
      { name: 'Left', clip: shake, offset: [-0.34, 0], yaw: 80 },
      { name: 'Right', clip: shake, offset: [0.34, 0], yaw: -80 },
    ],
    contacts: [{ a: { role: 0, bone: 'rightHand' }, b: { role: 1, bone: 'rightHand' }, from: 0.55, to: 2.05 }],
  },
  {
    id: 'high_five',
    label: 'High five',
    aliases: ['high five', 'highfive'],
    loop: false,
    roles: [
      { name: 'Left', clip: fiveRight, offset: [-0.36, 0], yaw: 80 },
      { name: 'Right', clip: mirrorKeys(fiveRight), offset: [0.36, 0], yaw: -80 },
    ],
    contacts: [{ a: { role: 0, bone: 'rightHand' }, b: { role: 1, bone: 'leftHand' }, from: 0.75, to: 1.1 }],
  },
  {
    id: 'hug_pair',
    label: 'Hug',
    aliases: ['hug', 'embrace', 'hugs'],
    loop: false,
    roles: [
      { name: 'Left', clip: hug(true), offset: [-0.15, 0], yaw: 88 },
      { name: 'Right', clip: hug(false), offset: [0.15, 0], yaw: -88 },
    ],
    // Hands on the other's back: one pair high (shoulder blades), the other low (waist).
    contacts: [
      { a: { role: 0, bone: 'leftHand' }, b: { role: 1, bone: 'upperChest' }, from: 0.95, to: 2.6 },
      { a: { role: 0, bone: 'rightHand' }, b: { role: 1, bone: 'upperChest' }, from: 0.95, to: 2.6 },
      { a: { role: 1, bone: 'leftHand' }, b: { role: 0, bone: 'spine' }, from: 0.95, to: 2.6 },
      { a: { role: 1, bone: 'rightHand' }, b: { role: 0, bone: 'spine' }, from: 0.95, to: 2.6 },
    ],
  },
  {
    id: 'dance_pair',
    label: 'Dance together',
    aliases: ['dance together', 'slow dance', 'partner dance'],
    loop: true,
    roles: [
      { name: 'Lead', clip: sway(1), offset: [-0.3, 0], yaw: 85 },
      { name: 'Partner', clip: sway(-1), offset: [0.3, 0], yaw: -85 },
    ],
    contacts: [
      { a: { role: 0, bone: 'rightHand' }, b: { role: 1, bone: 'leftHand' }, from: 0, to: 4 },
      { a: { role: 0, bone: 'leftHand' }, b: { role: 1, bone: 'rightHand' }, from: 0, to: 4 },
    ],
  },
];
