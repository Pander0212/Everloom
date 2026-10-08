/**
 * The part schema both templates share, so every hairstyle, eye set and outfit made for a template
 * snaps onto it. Each slot has a draw order, the deformer that moves it, an optional mask, a colour
 * group and a depth used for head-turn parallax. docs/puppets.md has the table.
 */

export interface SlotDef {
  /** Draw order (back to front). */
  z: number;
  /** The template deformer that moves it. */
  deformer: string;
  /** Depth in front of the face surface when the head turns (front hair +, back hair −). */
  depth?: number;
  /** Clipped by this slot's parts. */
  mask?: string;
  color?: string;
  /** What it is, for docs and the maker. */
  about: string;
  /** The maker can swap it (a set of parts from a pack). */
  swappable?: 'hair' | 'eyes' | 'brows' | 'mouth' | 'outfit' | 'accessory' | 'arms' | 'body';
}

export const SLOTS: Record<string, SlotDef> = {
  'hair.back': { z: 0, deformer: 'hairBack', depth: -0.55, color: 'hair', about: 'Hair behind the head and body', swappable: 'hair' },
  'acc.back': { z: 2, deformer: 'body', about: 'Behind the body (a cape, wings)', swappable: 'accessory' },
  body: { z: 10, deformer: 'body', color: 'skin', about: 'The body and neck (adult; the 18+ pack swaps it)', swappable: 'body' },
  underwear: { z: 11, deformer: 'body', about: 'The underwear layer (removable only in adult mode)', swappable: 'body' },
  legwear: { z: 12, deformer: 'body', color: 'cloth3', about: 'Stockings, socks', swappable: 'outfit' },
  shoes: { z: 13, deformer: 'body', color: 'cloth3', about: 'Shoes (seen when framed lower)', swappable: 'outfit' },
  bottom: { z: 14, deformer: 'body', color: 'cloth2', about: 'Trousers, skirts', swappable: 'outfit' },
  top: { z: 16, deformer: 'body', color: 'cloth1', about: 'Shirts, blouses, dresses', swappable: 'outfit' },
  outer: { z: 18, deformer: 'body', color: 'cloth4', about: 'Jackets, coats, cardigans', swappable: 'outfit' },
  'acc.body': { z: 19, deformer: 'body', about: 'Belts, bags, necklaces', swappable: 'accessory' },
  'arm.l': { z: 20, deformer: 'armL', color: 'skin', about: 'Left arm in the current pose (the picture\'s right)', swappable: 'arms' },
  'arm.r': { z: 20, deformer: 'armR', color: 'skin', about: 'Right arm in the current pose (the picture\'s left)', swappable: 'arms' },
  'sleeve.l': { z: 21, deformer: 'armL', color: 'cloth1', about: 'The top\'s left sleeve', swappable: 'outfit' },
  'sleeve.r': { z: 21, deformer: 'armR', color: 'cloth1', about: 'The top\'s right sleeve', swappable: 'outfit' },
  face: { z: 30, deformer: 'face', depth: 0, color: 'skin', about: 'Face, ears and the skin under the eyes and mouth (eyes shut, mouth closed)' },
  'eye.l.white': { z: 32, deformer: 'eyeL', depth: 0.02, about: 'Left eye white (a mask for the iris)', swappable: 'eyes' },
  'eye.r.white': { z: 32, deformer: 'eyeR', depth: 0.02, about: 'Right eye white', swappable: 'eyes' },
  'eye.l.iris': { z: 33, deformer: 'eyeL', depth: 0.02, mask: 'eye.l.white', color: 'eyes', about: 'Left iris and pupil (follows EyeBallX/Y)', swappable: 'eyes' },
  'eye.r.iris': { z: 33, deformer: 'eyeR', depth: 0.02, mask: 'eye.r.white', color: 'eyes', about: 'Right iris and pupil', swappable: 'eyes' },
  'eye.l.lash': { z: 35, deformer: 'eyeL', depth: 0.03, about: 'Left lids and lashes, open', swappable: 'eyes' },
  'eye.r.lash': { z: 35, deformer: 'eyeR', depth: 0.03, about: 'Right lids and lashes, open', swappable: 'eyes' },
  'eye.l.half': { z: 36, deformer: 'eyeL', depth: 0.03, about: 'Left eye half shut', swappable: 'eyes' },
  'eye.r.half': { z: 36, deformer: 'eyeR', depth: 0.03, about: 'Right eye half shut', swappable: 'eyes' },
  'eye.l.closed': { z: 37, deformer: 'eyeL', depth: 0.03, about: 'Left eye shut (the lash line)', swappable: 'eyes' },
  'eye.r.closed': { z: 37, deformer: 'eyeR', depth: 0.03, about: 'Right eye shut', swappable: 'eyes' },
  'eye.l.smile': { z: 37, deformer: 'eyeL', depth: 0.03, about: 'Left eye smiling (an upward arc)', swappable: 'eyes' },
  'eye.r.smile': { z: 37, deformer: 'eyeR', depth: 0.03, about: 'Right eye smiling', swappable: 'eyes' },
  'brow.l': { z: 38, deformer: 'browL', depth: 0.05, color: 'hair', about: 'Left eyebrow', swappable: 'brows' },
  'brow.r': { z: 38, deformer: 'browR', depth: 0.05, color: 'hair', about: 'Right eyebrow', swappable: 'brows' },
  nose: { z: 39, deformer: 'face', depth: 0.12, about: 'Nose' },
  'mouth.open': { z: 40, deformer: 'mouth', depth: 0.04, about: 'Mouth open ("ah")', swappable: 'mouth' },
  'mouth.wide': { z: 40, deformer: 'mouth', depth: 0.04, about: 'Mouth wide open', swappable: 'mouth' },
  'mouth.smile': { z: 40, deformer: 'mouth', depth: 0.04, about: 'Closed smile', swappable: 'mouth' },
  'mouth.i': { z: 40, deformer: 'mouth', depth: 0.04, about: '"ee"', swappable: 'mouth' },
  'mouth.u': { z: 40, deformer: 'mouth', depth: 0.04, about: '"oo"', swappable: 'mouth' },
  'mouth.e': { z: 40, deformer: 'mouth', depth: 0.04, about: '"eh"', swappable: 'mouth' },
  'mouth.o': { z: 40, deformer: 'mouth', depth: 0.04, about: '"oh"', swappable: 'mouth' },
  blush: { z: 42, deformer: 'face', depth: 0.03, about: 'Blush (Cheek)' },
  'hair.side': { z: 44, deformer: 'hairSide', depth: 0.25, color: 'hair', about: 'Hair beside the face', swappable: 'hair' },
  'hair.front': { z: 46, deformer: 'hairFront', depth: 0.45, color: 'hair', about: 'Fringe and front hair', swappable: 'hair' },
  'acc.head': { z: 48, deformer: 'hairFront', depth: 0.5, about: 'Hair clips, hats, glasses', swappable: 'accessory' },
};

/** The slot of a part id like `hair.front:twintails` (the part after the colon names the option). */
export const slotOf = (partSlot: string) => partSlot.split(':')[0]!;
export const slotDef = (partSlot: string): SlotDef | undefined => SLOTS[slotOf(partSlot)];

/**
 * A template's landmarks, in art pixels. Measured on the template's master once; every part made
 * for it lines up with these.
 */
export interface TemplateLandmarks {
  canvas: [number, number];
  /** Head: centre of the skull and its half width (the face's width at the cheekbones / 2). */
  head: { cx: number; cy: number; r: number; top: number; chin: number };
  eyeL: { cx: number; cy: number; w: number; h: number };
  eyeR: { cx: number; cy: number; w: number; h: number };
  browL: { cx: number; cy: number; w: number };
  browR: { cx: number; cy: number; w: number };
  mouth: { cx: number; cy: number; w: number };
  neck: { cx: number; cy: number };
  shoulderL: [number, number];
  shoulderR: [number, number];
  chest: { cy: number; w: number };
  waist: { cy: number; w: number };
  hips: { cy: number; w: number };
  /** The lowest drawn point (mid-thigh framing, or the feet). */
  bottom: number;
  /** Elbow positions for arm swings (optional). */
  elbowL?: [number, number];
  elbowR?: [number, number];
}
