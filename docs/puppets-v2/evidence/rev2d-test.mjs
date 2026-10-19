// The Puppets v2 deciding test character for Rev2D: torso, two-segment arms with hands, two-segment
// legs with feet, breasts, a head. Synthetic shapes only. Writes test.r2d.json.
import { writeFileSync } from 'node:fs';

const W = 400, H = 800;
const deg = (a) => (a * Math.PI) / 180;
const bones = [];
const B = (id, parent, x, y, rotation, length, extra = {}) => bones.push({ id, parent, x, y, rotation, length, ...extra });
// Pelvis at the hips; spine and chest point up (rotation -90: local +x is screen up, local +y screen right).
B('root', null, 200, 770, 0, 0);
B('pelvis', 'root', 0, -340, 0, 0);
B('spine', 'pelvis', 0, 0, -90, 110);
B('chest', 'spine', 110, 0, 0, 70);
B('neck', 'chest', 70, 0, 0, 30);
B('head', 'neck', 30, 0, 0, 90);
// Breasts hang off the chest (chest-local x up, y right): world ≈ (200 ± 26, 300).
B('breast_L', 'chest', 18, 26, 90, 0);
B('breast_R', 'chest', 18, -26, 90, 0);
// Arms, A-pose: world angle 70° (left, screen right) / 110° (right). Local = world − (−90).
B('upperarm_L', 'chest', 52, 58, 160, 115);
B('forearm_L', 'upperarm_L', 115, 0, 0, 105);
B('hand_L', 'forearm_L', 105, 0, 0, 40);
B('upperarm_R', 'chest', 52, -58, 200, 115);
B('forearm_R', 'upperarm_R', 115, 0, 0, 105);
B('hand_R', 'forearm_R', 105, 0, 0, 40);
// Legs (pelvis rotation 0, so local = world): thighs point down.
B('thigh_L', 'pelvis', 34, 10, 88, 165);
B('shin_L', 'thigh_L', 165, 0, 0, 160);
B('foot_L', 'shin_L', 160, 0, -88, 30);
B('thigh_R', 'pelvis', -34, 10, 92, 165);
B('shin_R', 'thigh_R', 165, 0, 0, 160);
B('foot_R', 'shin_R', 160, 0, 88, 30);
// IK targets for the feet (root children, in root space: root is at (200, 770)).
B('footTarget_L', 'root', 40, 0, 0, 0);
B('footTarget_R', 'root', -40, 0, 0, 0);

// World joints of the setup pose, to draw the limb polygons along their bones.
const world = {};
for (const b of bones) {
  const p = b.parent ? world[b.parent] : { x: 0, y: 0, a: 0 };
  const a = p.a + b.rotation;
  const x = p.x + b.x * Math.cos(deg(p.a)) - b.y * Math.sin(deg(p.a));
  const y = p.y + b.x * Math.sin(deg(p.a)) + b.y * Math.cos(deg(p.a));
  world[b.id] = { x, y, a };
}
/** A tapered strip along joints (polygon points around it). */
function strip(joints, widths) {
  const left = [], right = [];
  joints.forEach((j, i) => {
    const n = joints[Math.min(i + 1, joints.length - 1)], p = joints[Math.max(i - 1, 0)];
    const dx = n.x - p.x, dy = n.y - p.y, l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l, w = widths[i] / 2;
    left.push(j.x + nx * w, j.y + ny * w);
    right.push(j.x - nx * w, j.y - ny * w);
  });
  const pts = [...left];
  for (let i = right.length - 2; i >= 0; i -= 2) pts.push(right[i], right[i + 1]);
  return pts;
}
const tip = (id) => { const b = bones.find((x) => x.id === id), w = world[id]; return { x: w.x + b.length * Math.cos(deg(w.a)), y: w.y + b.length * Math.sin(deg(w.a)) }; };
const sample = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
const limb = (b1, b2, w0, w1, w2) => {
  const j = [...sample(world[b1], world[b2], 8), ...sample(world[b2], tip(b2), 8).slice(1)];
  return strip(j, j.map((_, i) => (i <= 8 ? w0 + ((w1 - w0) * i) / 8 : w1 + ((w2 - w1) * (i - 8)) / 8)));
};
const SKIN = '#f2c9b0', SKIN2 = '#e8b89c', LINE = { color: '#7a4a3a', width: 2 };
const parts = [
  { id: 'leg_R', skin: { bones: ['pelvis', 'thigh_R', 'shin_R'], weights: 'auto', falloff: 3 }, shape: { type: 'polygon', points: limb('thigh_R', 'shin_R', 62, 40, 30), detail: 10 }, fill: SKIN2, stroke: LINE, z: 2 },
  { id: 'leg_L', skin: { bones: ['pelvis', 'thigh_L', 'shin_L'], weights: 'auto', falloff: 3 }, shape: { type: 'polygon', points: limb('thigh_L', 'shin_L', 62, 40, 30), detail: 10 }, fill: SKIN2, stroke: LINE, z: 2 },
  { id: 'foot_R', parent: 'foot_R', shape: { type: 'ellipse', cx: tip('shin_R').x - 8, cy: tip('shin_R').y + 6, rx: 22, ry: 10 }, fill: SKIN2, stroke: LINE, z: 3 },
  { id: 'foot_L', parent: 'foot_L', shape: { type: 'ellipse', cx: tip('shin_L').x + 8, cy: tip('shin_L').y + 6, rx: 22, ry: 10 }, fill: SKIN2, stroke: LINE, z: 3 },
  { id: 'torso', skin: { bones: ['pelvis', 'spine', 'chest'], weights: 'auto', falloff: 2 }, shape: { type: 'path', d: 'M150 250 C150 300 168 340 166 380 C160 420 150 440 152 460 L248 460 C250 440 240 420 234 380 C232 340 250 300 250 250 C230 238 170 238 150 250 Z', detail: 10 }, fill: SKIN, stroke: LINE, z: 4 },
  { id: 'neck', parent: 'neck', shape: { type: 'rect', x: 186, y: 200, w: 28, h: 50, radius: 8 }, fill: SKIN2, z: 3 },
  { id: 'head', parent: 'head', shape: { type: 'ellipse', cx: 200, cy: 150, rx: 48, ry: 58 }, fill: SKIN, stroke: LINE, z: 5 },
  { id: 'breast_R', parent: 'breast_R', shape: { type: 'ellipse', cx: world.breast_R.x, cy: world.breast_R.y, rx: 24, ry: 21, detail: 6 }, fill: SKIN, stroke: LINE, z: 6 },
  { id: 'breast_L', parent: 'breast_L', shape: { type: 'ellipse', cx: world.breast_L.x, cy: world.breast_L.y, rx: 24, ry: 21, detail: 6 }, fill: SKIN, stroke: LINE, z: 6 },
  { id: 'arm_R', skin: { bones: ['upperarm_R', 'forearm_R'], weights: 'auto', falloff: 3 }, shape: { type: 'polygon', points: limb('upperarm_R', 'forearm_R', 34, 28, 22), detail: 8 }, fill: SKIN, stroke: LINE, z: 8 },
  { id: 'hand_R', parent: 'hand_R', shape: { type: 'ellipse', cx: tip('forearm_R').x + 6 * Math.cos(deg(world.hand_R.a)), cy: tip('forearm_R').y + 14, rx: 13, ry: 19 }, fill: SKIN, stroke: LINE, z: 9 },
  { id: 'arm_L', skin: { bones: ['upperarm_L', 'forearm_L'], weights: 'auto', falloff: 3 }, shape: { type: 'polygon', points: limb('upperarm_L', 'forearm_L', 34, 28, 22), detail: 8 }, fill: SKIN, stroke: LINE, z: 10 },
  { id: 'hand_L', parent: 'hand_L', shape: { type: 'ellipse', cx: tip('forearm_L').x, cy: tip('forearm_L').y + 14, rx: 13, ry: 19 }, fill: SKIN, stroke: LINE, z: 11 },
];
const parameters = [
  { id: 'BodyY', min: -1, max: 1, default: 0, description: 'Body bob: +1 = up 30 px' },
  { id: 'BustY', min: -1, max: 1, default: 0, description: 'Physics output: breast bounce' },
  { id: 'BustX', min: -1, max: 1, default: 0, description: 'Physics output: breast sway' },
  { id: 'ArmsFront', min: 0, max: 1, default: 0, description: 'Right arm drawn over the left arm (crossing)' },
];
const bindings = [
  { target: 'bone:pelvis.y', params: ['BodyY'], keys: [{ at: [-1], value: -310 }, { at: [0], value: -340 }, { at: [1], value: -370 }] },
  { target: 'bone:breast_L.x', params: ['BustY'], keys: [{ at: [-1], value: 30 }, { at: [0], value: 18 }, { at: [1], value: 6 }] },
  { target: 'bone:breast_R.x', params: ['BustY'], keys: [{ at: [-1], value: 30 }, { at: [0], value: 18 }, { at: [1], value: 6 }] },
  { target: 'bone:breast_L.scaleY', params: ['BustY'], keys: [{ at: [-1], value: 0.9 }, { at: [0], value: 1 }, { at: [1], value: 1.08 }] },
  { target: 'bone:breast_R.scaleY', params: ['BustY'], keys: [{ at: [-1], value: 0.9 }, { at: [0], value: 1 }, { at: [1], value: 1.08 }] },
  { target: 'part:arm_R.z', params: ['ArmsFront'], keys: [{ at: [0], value: 8 }, { at: [1], value: 12 }] },
  { target: 'part:hand_R.z', params: ['ArmsFront'], keys: [{ at: [0], value: 9 }, { at: [1], value: 13 }] },
];
const ik = [
  { id: 'legIk_L', bones: ['thigh_L', 'shin_L'], target: 'footTarget_L', mix: 1, bendPositive: false, stretch: true },
  { id: 'legIk_R', bones: ['thigh_R', 'shin_R'], target: 'footTarget_R', mix: 1, bendPositive: true, stretch: true },
];
// Breasts: a pendulum hanging from the chest, moved by the body's bob; its swing is the bounce.
const physics = [
  { id: 'bust', inputs: [{ param: 'BodyY', type: 'y', weight: -30 }], outputs: [{ param: 'BustY', type: 'y', scale: 0.08 }], segments: [{ length: 40, mass: 1 }], gravity: 980, damping: 0.12, stiffness: 40 },
];
const k = (t, v, ease = 'smooth') => ({ t, v, ease });
const loop = (target, keys, offset) => ({ target, keys, ...(offset ? { offset } : {}) });
const animations = [
  // Wave: the left arm up and out, the elbow bent ~120°, the forearm waving.
  { id: 'wave', duration: 2, loop: true, tracks: [
    loop('bone:upperarm_L.rotation', [k(0, 55), k(2, 55)]),
    loop('bone:forearm_L.rotation', [k(0, -100), k(0.25, -140), k(0.5, -100), k(0.75, -140), k(1, -100), k(1.25, -140), k(1.5, -100), k(1.75, -140), k(2, -100)]),
  ] },
  { id: 'armsUp', duration: 1, loop: true, tracks: [
    loop('bone:upperarm_L.rotation', [k(0, 12), k(1, 12)]), loop('bone:upperarm_R.rotation', [k(0, -12), k(1, -12)]),
    loop('bone:forearm_L.rotation', [k(0, -18), k(1, -18)]), loop('bone:forearm_R.rotation', [k(0, 18), k(1, 18)]),
  ] },
  // Arms crossed in front of the body: both forearms fold across the chest, the right arm on top.
  { id: 'cross', duration: 1, loop: true, tracks: [
    loop('param:ArmsFront', [{ t: 0, v: 1 }, { t: 1, v: 1 }]),
    loop('bone:upperarm_L.rotation', [k(0, 185), k(1, 185)]), loop('bone:forearm_L.rotation', [k(0, 125), k(1, 125)]),
    loop('bone:upperarm_R.rotation', [k(0, 175), k(1, 175)]), loop('bone:forearm_R.rotation', [k(0, -125), k(1, -125)]),
  ] },
  // Walk in place, front view: the planted foot stays locked by IK (stretching a little as the body
  // bobs); the lifting leg lets go of IK and foreshortens (in a front view a knee can't bend sideways).
  { id: 'walk', duration: 1, loop: true, tracks: [
    loop('ik:legIk_L.mix', [k(0, 1), k(0.1, 0), k(0.4, 0), k(0.5, 1), k(1, 1)]),
    loop('ik:legIk_R.mix', [k(0, 1), k(0.5, 1), k(0.6, 0), k(0.9, 0), k(1, 1)]),
    loop('bone:thigh_L.scaleX', [k(0, 1), k(0.25, 0.86), k(0.5, 1), k(1, 1)]),
    loop('bone:thigh_R.scaleX', [k(0, 1), k(0.5, 1), k(0.75, 0.86), k(1, 1)]),
    loop('param:BodyY', [k(0, 0), k(0.25, 0.2), k(0.5, 0), k(0.75, 0.2), k(1, 0)]),
    loop('bone:upperarm_L.rotation', [k(0, 165), k(0.5, 152), k(1, 165)]),
    loop('bone:upperarm_R.rotation', [k(0, 195), k(0.5, 208), k(1, 195)]),
    loop('bone:forearm_L.rotation', [k(0, -8), k(0.5, -18), k(1, -8)]),
    loop('bone:forearm_R.rotation', [k(0, 8), k(0.5, 18), k(1, 8)]),
  ] },
  // A jump, for the breast physics: crouch, up, land, settle.
  { id: 'jump', duration: 2, loop: true, tracks: [
    loop('param:BodyY', [k(0, 0), k(0.2, -0.5), k(0.4, 1), k(0.6, 0.6), k(0.75, -0.4), k(0.9, 0), k(2, 0)]),
  ] },
];
const model = { format: 'rev2d', version: 1, meta: { name: 'everloom-v2-test', width: W, height: H, background: '#e9edf2', fps: 30 }, parameters, bones, parts, bindings, ik, physics, animations };
writeFileSync(new URL('./test.r2d.json', import.meta.url), JSON.stringify(model, null, 1));
console.log('wrote test.r2d.json', bones.length, 'bones', parts.length, 'parts');
