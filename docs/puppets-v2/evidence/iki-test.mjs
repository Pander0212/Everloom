// The same deciding-test character for iki: quads on rotation (matrix) deformers. iki has no skinning,
// no IK and a static draw order, so the arm is two rigid segments with a round cap at the elbow, and
// crossing the arms uses a second copy of the right arm drawn in front (faded in). Writes test.iki.
import { writeFileSync } from 'node:fs';

// Same proportions as the Rev2D test (canvas 400 × 800); iki model space: origin at the centre, +y up.
const X = (x) => x - 200, Y = (y) => 400 - y;
const P = (id, min, max, def = 0) => ({ id, min, max, default: def });
const parameters = [
  P('ParamArmL', -1, 1), P('ParamElbowL', -1, 1), P('ParamArmR', -1, 1), P('ParamElbowR', -1, 1),
  P('ParamLegL', -1, 1), P('ParamKneeL', -1, 1), P('ParamLegR', -1, 1), P('ParamKneeR', -1, 1),
  P('ParamBodyY', -1, 1), P('ParamBust', -1, 1), P('ParamCross', 0, 1),
];
const rot = (parameter, from, to) => ({ parameter, channel: 'rotate', from, to });
// Pivots (model space): shoulders, elbows, hips, knees (from the Rev2D rig's setup joints).
const deformers = [
  { id: 'd_body', pivot: { x: 0, y: Y(430) }, bindings: [{ parameter: 'ParamBodyY', channel: 'translateY', from: -30, to: 30 }] },
  { id: 'd_upperarm_L', parent: 'd_body', pivot: { x: X(258), y: Y(268) }, bindings: [rot('ParamArmL', 160, -160)] },
  { id: 'd_forearm_L', parent: 'd_upperarm_L', pivot: { x: X(297), y: Y(376) }, bindings: [rot('ParamElbowL', 150, -150)] },
  { id: 'd_upperarm_R', parent: 'd_body', pivot: { x: X(142), y: Y(268) }, bindings: [rot('ParamArmR', -160, 160)] },
  { id: 'd_forearm_R', parent: 'd_upperarm_R', pivot: { x: X(103), y: Y(376) }, bindings: [rot('ParamElbowR', -150, 150)] },
  { id: 'd_thigh_L', pivot: { x: X(234), y: Y(440) }, bindings: [rot('ParamLegL', 40, -40)] },
  { id: 'd_shin_L', parent: 'd_thigh_L', pivot: { x: X(240), y: Y(605) }, bindings: [rot('ParamKneeL', 40, -40)] },
  { id: 'd_thigh_R', pivot: { x: X(166), y: Y(440) }, bindings: [rot('ParamLegR', -40, 40)] },
  { id: 'd_shin_R', parent: 'd_thigh_R', pivot: { x: X(160), y: Y(605) }, bindings: [rot('ParamKneeR', -40, 40)] },
];
let order = 0;
const quad = (id, cx, cy, w, h, color, deformer, extra = {}) => ({ id, color, width: w, height: h, transform: { x: X(cx), y: Y(cy), rotation: extra.rotation ?? 0 }, order: extra.order ?? order++, ...(deformer ? { deformer } : {}), ...(extra.bindings ? { bindings: extra.bindings } : {}) });
const SKIN = [0.95, 0.79, 0.69, 1], SKIN2 = [0.91, 0.72, 0.61, 1], CAP = [0.93, 0.76, 0.66, 1];
// Segment quads are centred between their joints and rotated to point along the limb (degrees, CCW +).
const seg = (id, a, b, w, color, deformer, o) => {
  const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ang = (Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180) / Math.PI - 90; // quad height along the limb
  return quad(id, cx, cy, w, len, color, deformer, { rotation: ang, order: o });
};
const parts = [
  seg('thigh_R', [166, 440], [160, 605], 52, SKIN2, 'd_thigh_R', 1), seg('shin_R', [160, 605], [156, 765], 34, SKIN2, 'd_shin_R', 1),
  seg('thigh_L', [234, 440], [240, 605], 52, SKIN2, 'd_thigh_L', 1), seg('shin_L', [240, 605], [244, 765], 34, SKIN2, 'd_shin_L', 1),
  quad('knee_cap_R', 160, 605, 40, 40, SKIN2, 'd_shin_R', { order: 2 }), quad('knee_cap_L', 240, 605, 40, 40, SKIN2, 'd_shin_L', { order: 2 }),
  quad('torso', 200, 355, 100, 210, SKIN, 'd_body', { order: 4 }),
  quad('head', 200, 150, 96, 116, SKIN, 'd_body', { order: 5 }),
  quad('breast_R', 174, 300, 48, 42, SKIN, 'd_body', { order: 6, bindings: [{ parameter: 'ParamBust', channel: 'translateY', from: -8, to: 8 }] }),
  quad('breast_L', 226, 300, 48, 42, SKIN, 'd_body', { order: 6, bindings: [{ parameter: 'ParamBust', channel: 'translateY', from: -8, to: 8 }] }),
  seg('upperarm_R', [142, 268], [103, 376], 32, SKIN, 'd_upperarm_R', 8), seg('forearm_R', [103, 376], [67, 475], 26, SKIN, 'd_forearm_R', 7),
  quad('elbow_cap_R', 103, 376, 30, 30, CAP, 'd_forearm_R', { order: 8 }),
  seg('upperarm_L', [258, 268], [297, 376], 32, SKIN, 'd_upperarm_L', 10), seg('forearm_L', [297, 376], [333, 475], 26, SKIN, 'd_forearm_L', 9),
  quad('elbow_cap_L', 297, 376, 30, 30, CAP, 'd_forearm_L', { order: 10 }),
  // The crossing copy of the right arm, in front of the left one; fades in on ParamCross.
  { ...seg('upperarm_R_front', [142, 268], [103, 376], 32, SKIN, 'd_upperarm_R', 12), bindings: [{ parameter: 'ParamCross', channel: 'opacity', from: 0, to: 1 }] },
  { ...seg('forearm_R_front', [103, 376], [67, 475], 26, SKIN, 'd_forearm_R', 12), bindings: [{ parameter: 'ParamCross', channel: 'opacity', from: 0, to: 1 }] },
];
const physics = [{ id: 'bust', input: { parameter: 'ParamBodyY', weight: 1 }, output: { parameter: 'ParamBust', scale: 1 }, mass: 1, stiffness: 60, damping: 4 }];
const model = { version: 1, name: 'everloom-v2-test', canvas: { width: 400, height: 800 }, parameters, parts, deformers, physics };
writeFileSync(new URL('./test.iki', import.meta.url), JSON.stringify(model));
console.log('wrote test.iki', parts.length, 'parts', deformers.length, 'deformers');
