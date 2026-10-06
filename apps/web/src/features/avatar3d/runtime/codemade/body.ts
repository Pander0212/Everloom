/**
 * The body of a code-made character: proportions from age, height and build, a canonical skeleton
 * in T-pose (bones named like the canonical skeleton, so no mapping is needed), and the shapes the
 * body is made of, each moved by one bone.
 */
import type { AvatarRecipe } from '@everloom/engine';
import { ellipsoid, roundBox, roundCone, type Shape, type V3 } from './sdf';

export interface BodyPlan {
  H: number;
  /** How smoothly the body's shapes blend (metres). */
  blend: number;
  kid: boolean;
  /** World position of every bone in the T-pose (character faces +Z, its left is +X). */
  joints: Record<string, V3>;
  parent: Record<string, string | null>;
  shapes: Shape[];
  /** Useful landmarks for clothes, hair and face. */
  at: {
    headC: V3;
    headR: V3;
    headH: number;
    chinY: number;
    neckY: number;
    shoulderY: number;
    shoulderX: number;
    chestY: number;
    waistY: number;
    hipsY: number;
    crotchY: number;
    kneeY: number;
    ankleY: number;
    hipX: number;
    handX: number;
    elbowX: number;
    wristX: number;
    footLen: number;
  };
}

const HEADS = { child: 4.8, teen: 6.0, adult: 6.6, elder: 6.5 } as const;
const LEGS = { child: 0.43, teen: 0.47, adult: 0.475, elder: 0.465 } as const;

export function planBody(r: AvatarRecipe): BodyPlan {
  const b = r.body;
  const H = b.height;
  const headH = H / HEADS[b.age];
  const m = 0.82 + 0.55 * b.build; // girth
  const shoulderMul = 0.82 + 0.32 * b.frame;
  const hipMul = 1.12 - 0.22 * b.frame;
  const kid = b.age === 'child';
  const crotchY = H * LEGS[b.age];
  const hipsY = crotchY + 0.035 * H;
  const chinY = H - headH;
  const neckY = chinY - headH * (kid ? 0.12 : 0.22);
  const shoulderY = neckY - 0.022 * H;
  const shoulderX = 0.1 * H * shoulderMul * (kid ? 1.05 : 1);
  const chestY = shoulderY - 0.075 * H;
  const waistY = hipsY + 0.075 * H;
  const kneeY = crotchY * 0.53;
  const ankleY = 0.045 * H;
  const hipX = 0.054 * H * hipMul;
  const ua = 0.17 * H;
  const fa = 0.145 * H;
  const elbowX = shoulderX + ua;
  const wristX = elbowX + fa;
  const handX = wristX + 0.075 * H;
  const footLen = 0.15 * H;
  const headC: V3 = [0, H - headH * 0.5, 0.003 * H];
  const headR: V3 = [headH * 0.43, headH * 0.5, headH * 0.47];

  const joints: Record<string, V3> = {
    hips: [0, hipsY, 0],
    spine: [0, hipsY + 0.05 * H, 0],
    chest: [0, chestY, 0],
    upperChest: [0, shoulderY - 0.04 * H, 0],
    neck: [0, neckY, -0.004 * H],
    head: [0, chinY + headH * 0.12, 0],
    leftShoulder: [0.025 * H, shoulderY - 0.008 * H, -0.004 * H],
    leftUpperArm: [shoulderX, shoulderY, -0.006 * H],
    leftLowerArm: [elbowX, shoulderY, -0.01 * H],
    leftHand: [wristX, shoulderY, -0.006 * H],
    leftUpperLeg: [hipX, hipsY - 0.03 * H, 0],
    leftLowerLeg: [hipX, kneeY, 0.004 * H],
    leftFoot: [hipX, ankleY, -0.006 * H],
    leftToes: [hipX, 0.012 * H, footLen * 0.62],
  };
  const parent: Record<string, string | null> = {
    hips: null, spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck',
    leftShoulder: 'upperChest', leftUpperArm: 'leftShoulder', leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm',
    leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg', leftToes: 'leftFoot',
  };
  for (const k of Object.keys(joints)) {
    if (!k.startsWith('left')) continue;
    const rk = 'right' + k.slice(4);
    const [x, y, z] = joints[k]!;
    joints[rk] = [-x, y, z];
    const p = parent[k]!;
    parent[rk] = p.startsWith('left') ? 'right' + p.slice(4) : p;
  }

  const shapes: Shape[] = [];
  const side = (f: (s: 1 | -1, n: 'left' | 'right') => void) => {
    f(1, 'left');
    f(-1, 'right');
  };
  // Head and neck.
  shapes.push(ellipsoid(headC, headR, 'head'));
  shapes.push(ellipsoid([0, chinY + headH * 0.2, headH * 0.08], [headH * 0.3, headH * 0.26, headH * 0.32], 'head'));
  side((s) => shapes.push(ellipsoid([s * headR[0] * 0.96, chinY + headH * 0.4, -headH * 0.04], [headH * 0.05, headH * 0.1, headH * 0.06], 'head')));
  shapes.push(roundCone([0, neckY - 0.012 * H, -0.006 * H], [0, chinY + headH * 0.18, -0.002 * H], 0.025 * H * m * (kid ? 0.9 : 1), 0.022 * H * m * (kid ? 0.9 : 1), 'neck'));
  // Torso: shoulders, ribcage, waist and pelvis, blended into one smooth shape.
  const waistMul = kid ? 1 : (0.88 + 0.12 * b.frame) * (b.age === 'elder' ? 1.06 : 1);
  shapes.push(ellipsoid([0, shoulderY - 0.035 * H, -0.004 * H], [shoulderX * 0.95, 0.05 * H, 0.052 * H * m], 'upperChest'));
  shapes.push(ellipsoid([0, chestY + 0.005 * H, 0], [0.085 * H * m * shoulderMul, 0.085 * H, 0.055 * H * m], 'chest'));
  shapes.push(ellipsoid([0, waistY + 0.01 * H, 0.002 * H], [0.078 * H * m * waistMul, 0.075 * H, 0.046 * H * m], 'spine'));
  shapes.push(ellipsoid([0, hipsY - 0.01 * H, -0.002 * H], [0.088 * H * m * hipMul, 0.06 * H, 0.055 * H * m], 'hips'));
  side((s) => shapes.push(ellipsoid([s * 0.038 * H * hipMul, hipsY - 0.04 * H, -0.03 * H], [0.045 * H * m, 0.045 * H, 0.04 * H * m], 'hips')));
  // Chest shape for teen, adult and elder bodies (never for children).
  const c = kid ? 0 : Math.max(0, (b.chest - 0.25) / 0.75) * (b.age === 'teen' ? 0.6 : 1);
  if (c > 0.05) side((s) => shapes.push(ellipsoid([s * 0.04 * H, chestY + 0.015 * H, 0.035 * H * m], [0.038 * H * (0.7 + 0.4 * c), 0.034 * H * (0.7 + 0.4 * c), 0.03 * H * (0.5 + 0.6 * c)], 'chest')));
  // Arms.
  side((s, n) => {
    const J = (k: string) => joints[`${n}${k}`]!;
    shapes.push(roundCone([s * 0.03 * H, shoulderY - 0.006 * H, -0.006 * H], J('UpperArm'), 0.026 * H * m, 0.032 * H * m, `${n}Shoulder`));
    shapes.push(roundCone(J('UpperArm'), J('LowerArm'), 0.031 * H * m, 0.025 * H * m, `${n}UpperArm`));
    shapes.push(roundCone(J('LowerArm'), J('Hand'), 0.025 * H * m, 0.019 * H * (0.9 + 0.2 * b.build), `${n}LowerArm`));
    const hand = J('Hand');
    shapes.push(ellipsoid([hand[0] + s * 0.04 * H, hand[1] - 0.002 * H, hand[2] + 0.004 * H], [0.045 * H, 0.014 * H, 0.03 * H], `${n}Hand`));
    shapes.push(roundCone([hand[0] + s * 0.012 * H, hand[1] - 0.004 * H, hand[2] + 0.02 * H], [hand[0] + s * 0.038 * H, hand[1] - 0.006 * H, hand[2] + 0.042 * H], 0.0095 * H, 0.008 * H, `${n}Hand`));
  });
  // Legs and feet.
  side((s, n) => {
    const J = (k: string) => joints[`${n}${k}`]!;
    const up = J('UpperLeg');
    shapes.push(roundCone([up[0], up[1] + 0.01 * H, up[2]], J('LowerLeg'), 0.05 * H * m * (0.92 + 0.1 * hipMul), 0.034 * H * m, `${n}UpperLeg`));
    shapes.push(roundCone(J('LowerLeg'), J('Foot'), 0.035 * H * m, 0.022 * H * (0.9 + 0.2 * b.build), `${n}LowerLeg`));
    const kn = J('LowerLeg');
    shapes.push(ellipsoid([kn[0], kn[1] - 0.075 * H, kn[2] - 0.01 * H], [0.034 * H * m, 0.07 * H, 0.034 * H * m], `${n}LowerLeg`));
    shapes.push(roundBox([J('Foot')[0], 0.02 * H, 0.02 * H], [0.016 * H, 0.011 * H, 0.04 * H], 0.009 * H, `${n}Foot`));
    shapes.push(ellipsoid([J('Toes')[0], 0.016 * H, J('Toes')[2] + 0.01 * H], [0.022 * H, 0.013 * H, 0.03 * H], `${n}Toes`));
  });

  return {
    H,
    blend: 0.022 * H,
    kid,
    joints,
    parent,
    shapes,
    at: { headC, headR, headH, chinY, neckY, shoulderY, shoulderX, chestY, waistY, hipsY, crotchY, kneeY, ankleY, hipX, handX, elbowX, wristX, footLen },
  };
}
