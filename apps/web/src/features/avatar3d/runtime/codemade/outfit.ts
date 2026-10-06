/**
 * Hair, clothes, hats and extras for a code-made character: each piece is a distance field built
 * from the body's own shapes (grown a little, cut by planes) or from new shapes, so it fits any
 * body the recipe makes. Long hair, ponytails and capes get bone chains that swing.
 */
import type { AvatarRecipe } from '@everloom/engine';
import type { BodyPlan } from './body';
import { ellipsoid, rebone, roundBox, roundCone, scaled, torus, type Field, type Shape, type V3 } from './sdf';

export interface Chain {
  /** Bone names are `${name}_${i}`; the first hangs from `parent`. */
  name: string;
  parent: string;
  points: V3[];
}

export interface Part {
  name: string;
  field: Field;
  color: string;
  /** Mesh cell size as a fraction of height. */
  cell: number;
  /** Shapes for skin weights (defaults to the field's shapes plus the body's). */
  weights?: Shape[];
  /** Softness of the weights as a fraction of height (larger: smoother, for skirts). */
  sigma?: number;
  /** Covers the body (skin under it is removed). */
  covers?: boolean;
  roughness?: number;
  metalness?: number;
  /** A printed pattern (stripes, checks, dots) over the colour. */
  pattern?: 'plain' | 'stripes' | 'checks' | 'dots';
}

export interface Outfit {
  parts: Part[];
  chains: Chain[];
}

const by = (plan: BodyPlan, bones: RegExp) => plan.shapes.filter((s) => bones.test(s.bone));

/** Points along a polyline from a to b, bending down by `sag` at the middle. */
function strand(a: V3, b: V3, n: number, sag = 0): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(Math.PI * t) * sag, a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}

/** A chain's shapes: one rounded cone per segment, moved by that segment's bone. */
function chainShapes(c: Chain, r0: number, r1: number): Shape[] {
  const out: Shape[] = [];
  const n = c.points.length - 1;
  for (let i = 0; i < n; i++) out.push(roundCone(c.points[i]!, c.points[i + 1]!, r0 + ((r1 - r0) * i) / n, r0 + ((r1 - r0) * (i + 1)) / n, `${c.name}_${i}`));
  return out;
}

export function planOutfit(plan: BodyPlan, r: AvatarRecipe): Outfit {
  const { H, at } = plan;
  const hh = at.headH;
  const [hx, hy, hz] = at.headC;
  const [rx, ry, rz] = at.headR;
  const parts: Part[] = [];
  const chains: Chain[] = [];
  const browY = at.chinY + hh * (plan.kid ? 0.36 : 0.42) + hh * 0.14;
  const hatKind = r.hat.kind;
  const coversHead = hatKind === 'beanie' || hatKind === 'hood' || hatKind === 'cap' || hatKind === 'helmet';

  // ------------------------------------------------------------------ hair
  const style = coversHead && (r.hair.style === 'spiky' || r.hair.style === 'curly') ? 'short' : r.hair.style;
  if (style !== 'none') {
    const L = r.hair.length;
    const grow = style === 'buzz' ? 1.03 : style === 'curly' ? 1.1 : 1.09;
    const cap = ellipsoid([hx, hy + hh * 0.015, hz - hh * 0.02], [rx * grow, ry * grow, rz * grow], 'head');
    const shapes: Shape[] = [cap];
    const weights: Shape[] = [cap];
    // Hairline: low at the front (bangs reach the brows), lower at the back.
    const front = style === 'buzz' ? browY + hh * 0.12 : browY + hh * 0.015;
    const back = style === 'buzz' ? at.chinY + hh * 0.3 : style === 'bob' || style === 'long' ? at.chinY - hh * 0.08 : at.chinY + hh * 0.12;
    const clips: Field['clips'] = [
      (x, y, z) => {
        const t = Math.max(0, Math.min(1, (z - (hz - rz * 0.4)) / (rz * 1.1)));
        // Over the ears the line dips; in front it follows the brows.
        const side = Math.max(0, Math.abs(x) / rx - 0.55) * hh * 0.5;
        return back * (1 - t) + front * t - side * t - y;
      },
    ];
    if (style === 'bob' || style === 'long') {
      // Side curtains and a back that fall below the chin, open in front of the face.
      const mass = ellipsoid([hx, hy - hh * 0.12, hz - hh * 0.05], [rx * 1.16, ry * 1.12, rz * 1.12], 'head');
      shapes.push(mass);
      weights.push(mass);
      const zf = hz + rz * 0.18;
      clips.length = 0;
      clips.push((x, y, z) => Math.min(z - zf, browY + hh * 0.02 - y, rx * 0.98 - Math.abs(x) + (y > at.chinY ? 0 : hh)));
      clips.push((_x, y) => at.chinY - hh * 0.06 - y);
    }
    if (style === 'long') {
      const top: V3 = [0, hy - hh * 0.25, hz - rz * 0.8];
      const end: V3 = [0, Math.max(at.waistY - (L - 0.5) * 0.2 * H, at.shoulderY - 0.35 * H * L), -0.07 * H];
      const c: Chain = { name: 'hairBack', parent: 'head', points: strand(top, end, 3) };
      chains.push(c);
      const back = chainShapes(c, rx * 0.95, rx * 0.75).map((s, i) => scaled(s, c.points[i]!, [1, 1, 0.38]));
      shapes.push(...back);
      weights.push(...back);
    }
    if (style === 'ponytail') {
      const tie: V3 = [0, hy + hh * 0.08, hz - rz * 1.02];
      const c: Chain = { name: 'hairTail', parent: 'head', points: [tie, [0, tie[1] + hh * 0.02, tie[2] - hh * 0.2], [0, tie[1] - hh * 0.35, tie[2] - hh * 0.28], [0, tie[1] - hh * (0.6 + L * 0.8), tie[2] - hh * 0.25]] };
      chains.push(c);
      const t = chainShapes(c, hh * 0.1, hh * 0.04);
      shapes.push(...t);
      weights.push(...t);
    }
    if (style === 'twintails') {
      for (const s of [1, -1]) {
        const tie: V3 = [s * rx * 0.85, hy + hh * 0.18, hz - rz * 0.35];
        const c: Chain = { name: `hairTwin${s > 0 ? 'L' : 'R'}`, parent: 'head', points: [tie, [s * (rx + hh * 0.18), tie[1] - hh * 0.05, tie[2] - hh * 0.05], [s * (rx + hh * 0.22), tie[1] - hh * 0.45, tie[2] - hh * 0.08], [s * (rx + hh * 0.18), tie[1] - hh * (0.7 + L * 0.9), tie[2] - hh * 0.08]] };
        chains.push(c);
        const t = chainShapes(c, hh * 0.09, hh * 0.035);
        shapes.push(...t);
        weights.push(...t);
      }
    }
    if (style === 'bun') {
      const b = ellipsoid([0, hy + ry * 0.75, hz - rz * 0.55], [hh * 0.17, hh * 0.15, hh * 0.17], 'head');
      shapes.push(b);
    }
    if (style === 'spiky') {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const dir: V3 = [Math.cos(a) * 0.7, 0.55 + 0.25 * Math.sin(a * 2), Math.sin(a) * 0.7 - 0.25];
        const base: V3 = [hx + dir[0] * rx * 0.8, hy + dir[1] * ry * 0.8, hz + dir[2] * rz * 0.8];
        shapes.push(roundCone(base, [base[0] + dir[0] * hh * 0.42, base[1] + dir[1] * hh * 0.42, base[2] + dir[2] * hh * 0.42], hh * 0.11, hh * 0.02, 'head'));
      }
    }
    if (style === 'curly') {
      for (let i = 0; i < 26; i++) {
        // Points spread over the upper and back part of the head (golden spiral).
        const y = 1 - (i + 0.5) / 26;
        const rr = Math.sqrt(1 - y * y);
        const a = i * 2.39996;
        const p: V3 = [Math.cos(a) * rr, y * 1.1 - 0.15, Math.sin(a) * rr];
        if (p[2] > 0.55 && p[1] < 0.45) continue;
        shapes.push(ellipsoid([hx + p[0] * rx * 1.05, hy + p[1] * ry * 1.02, hz + p[2] * rz * 1.05 - hh * 0.02], [hh * 0.12, hh * 0.12, hh * 0.12], 'head'));
      }
    }
    parts.push({ name: 'Hair', field: { shapes, blend: hh * 0.08, clips, clipRound: 0.006 * H }, color: r.hair.color, cell: 0.0075, weights, roughness: 0.6 });
  }

  // ------------------------------------------------------------------ clothes
  const legShapes = by(plan, /(UpperLeg|LowerLeg)$/);
  const top = r.top.kind;
  const accent = r.top.accent ?? shade(r.top.color, 0.7);
  if (top !== 'none') {
    const loose = 0.55 + 1.5 * r.top.looseness;
    const thick = { tshirt: 0.006, shirt: 0.006, tank: 0.005, sweater: 0.01, jacket: 0.012, robe: 0.01, armor: 0.016 }[top] * H * (top === 'armor' ? 1 : loose);
    const sleeve = top === 'tank' ? 0 : top === 'sweater' || top === 'jacket' || top === 'robe' ? 1 : top === 'tshirt' ? Math.min(r.top.sleeve, 0.35) : r.top.sleeve;
    // The whole body, cut by planes (it stands in a T-pose, so arms, legs and head separate cleanly):
    // the garment then follows the skin exactly where it covers it.
    const shapes = [...plan.shapes];
    if (top === 'robe') for (const s of [1, -1]) {
      const n = s > 0 ? 'left' : 'right';
      shapes.push(roundCone(plan.joints[`${n}LowerArm`]!, [plan.joints[`${n}Hand`]![0] - s * 0.01 * H, at.shoulderY - 0.012 * H, 0], 0.03 * H, 0.05 * H, `${n}LowerArm`));
    }
    const sleeveX = at.shoulderX + 0.035 * H + sleeve * (at.wristX - at.shoulderX - 0.045 * H);
    const hem = top === 'jacket' ? at.hipsY - 0.04 * H : top === 'tank' || top === 'tshirt' ? at.hipsY - 0.01 * H : at.hipsY - 0.025 * H;
    const clips: Field['clips'] = [
      (_x, y) => hem - y,
      (x) => Math.abs(x) - (sleeve > 0 ? sleeveX : at.shoulderX * 0.8),
      // Neckline: an opening around the neck, scooped at the front.
      (x, y, z) => Math.min((top === 'tank' ? 0.06 : 0.042) * H + Math.max(0, y - at.shoulderY) * 0.8 - Math.hypot(x, (z - 0.012 * H) * 0.8), y - (at.shoulderY - (top === 'tank' ? 0.07 : 0.045) * H)),
      (_x, y) => y - at.chinY,
    ];
    parts.push({ name: 'Top', field: { shapes, blend: plan.blend, offset: thick, clips, clipRound: 0.006 * H }, color: r.top.color, cell: 0.008, covers: true, roughness: top === 'armor' ? 0.35 : 0.85, metalness: top === 'armor' ? 0.6 : 0, pattern: top === 'armor' ? 'plain' : r.top.pattern });
    if (top === 'jacket' || top === 'robe' || r.top.collar) parts.push({ name: 'Collar', field: { shapes: [torus([0, at.shoulderY - 0.004 * H, 0.004 * H], 0.047 * H, 0.011 * H, 'y', 'upperChest')], blend: 0.01 * H }, color: accent, cell: 0.005 });
    if (top === 'armor')
      for (const s of [1, -1]) parts.push({ name: s > 0 ? 'PadL' : 'PadR', field: { shapes: [ellipsoid([s * at.shoulderX, at.shoulderY + 0.012 * H, 0], [0.05 * H, 0.03 * H, 0.05 * H], `${s > 0 ? 'left' : 'right'}Shoulder`)], blend: 0.01 * H, clips: [(_x, y) => at.shoulderY - 0.015 * H - y] }, color: shade(r.top.color, 0.85), cell: 0.007, roughness: 0.35, metalness: 0.6 });
  }

  // Bottoms (a robe or dress brings its own long skirt).
  let bottom = r.bottom.kind;
  let bottomColor = r.bottom.color;
  let bottomLength = r.bottom.length;
  if (top === 'robe') {
    bottom = 'long_skirt';
    bottomColor = r.top.color;
    bottomLength = 1;
  }
  const hipsShape = plan.shapes.find((s) => s.bone === 'hips')!;
  if (bottom === 'pants' || bottom === 'shorts' || bottom === 'none') {
    const length = bottom === 'none' ? 0.08 : bottom === 'shorts' ? Math.min(bottomLength, 0.45) : Math.max(bottomLength, 0.5);
    const end = Math.max(at.crotchY - length * (at.crotchY - at.ankleY - 0.01 * H), r.shoes.kind === 'boots' ? at.kneeY - 0.05 * H : 0);
    const top_ = bottom === 'none' ? at.hipsY + 0.01 * H : at.waistY + 0.006 * H;
    parts.push({
      name: bottom === 'none' ? 'Underwear' : 'Bottom',
      field: { shapes: plan.shapes, blend: plan.blend, offset: (bottom === 'none' ? 0.003 : 0.007 * (0.7 + 0.6 * r.bottom.looseness)) * H, clips: [(_x, y) => y - top_, (_x, y) => end - y], clipRound: 0.005 * H },
      color: bottom === 'none' ? '#e8e2d8' : bottomColor,
      cell: 0.008,
      covers: true,
      pattern: bottom === 'none' ? 'plain' : r.bottom.pattern,
    });
  } else {
    const hem = bottom === 'skirt' ? at.crotchY - (0.3 + 0.7 * bottomLength) * (at.crotchY - at.kneeY) : at.kneeY - bottomLength * (at.kneeY - at.ankleY - 0.025 * H);
    const c: V3 = [0, at.waistY, 0];
    const hipW = 0.1 * H * (0.82 + 0.55 * r.body.build);
    const flare = roundCone([0, at.waistY, 0], [0, hem, 0], hipW * 0.8, hipW * (bottom === 'skirt' ? 1.35 : 1.5) * (0.85 + 0.5 * (top === 'robe' ? r.top.looseness : r.bottom.looseness)), 'hips');
    const skirtShapes = [rebone(hipsShape, 'hips'), ...by(plan, /UpperLeg$/).map((s) => rebone(s, 'hips')), scaled(flare, c, [1, 1, 0.75])];
    parts.push({
      name: 'Skirt',
      field: { shapes: skirtShapes, blend: 0.03 * H, offset: 0.006 * H, clips: [(_x, y) => y - (at.waistY + 0.006 * H), (_x, y) => hem - y] },
      color: bottomColor,
      cell: 0.008,
      covers: true,
      pattern: top === 'robe' ? r.top.pattern : r.bottom.pattern,
      weights: [hipsShape, ...legShapes],
      sigma: 0.03,
    });
    // Modesty layer under a skirt.
    parts.push({ name: 'Underwear', field: { shapes: plan.shapes, blend: plan.blend, offset: 0.003 * H, clips: [(_x, y) => y - (at.hipsY + 0.01 * H), (_x, y) => at.crotchY - 0.04 * H - y] }, color: shade(bottomColor, 0.75), cell: 0.009, covers: true });
  }
  // A plain band when the chest is bare (all-ages bodies always wear underwear).
  if (top === 'none' && r.body.chest > 0.12 && r.body.age !== 'child')
    parts.push({ name: 'Underwear Top', field: { shapes: plan.shapes, blend: plan.blend, offset: 0.004 * H, clipRound: 0.004 * H, clips: [(_x, y) => y - (at.chestY + 0.05 * H), (_x, y) => at.chestY - 0.03 * H - y] }, color: '#e8e2d8', cell: 0.008, covers: true });

  // Shoes.
  if (r.shoes.kind !== 'none') {
    const kind = r.shoes.kind;
    const topY = kind === 'boots' ? at.kneeY - 0.03 * H : kind === 'sandals' ? 0.011 * H : at.ankleY + 0.03 * H;
    parts.push({ name: 'Shoes', field: { shapes: plan.shapes, blend: plan.blend, offset: (kind === 'sandals' ? 0.004 : kind === 'boots' ? 0.009 : 0.0055) * H, clips: [(_x, y) => y - topY] }, color: r.shoes.color, cell: 0.007, covers: kind !== 'sandals', roughness: 0.6 });
  }

  // ------------------------------------------------------------------ hats
  if (hatKind !== 'none') {
    const c = r.hat.color;
    let field: Field | null = null;
    if (hatKind === 'beanie') field = { shapes: [ellipsoid([hx, hy + hh * 0.05, hz - hh * 0.02], [rx * 1.14, ry * 1.12, rz * 1.14], 'head')], blend: 0.01 * H, clips: [(_x, y) => browY + hh * 0.05 - y] };
    if (hatKind === 'cap')
      field = {
        shapes: [ellipsoid([hx, hy + hh * 0.03, hz - hh * 0.02], [rx * 1.13, ry * 1.1, rz * 1.13], 'head'), ellipsoid([0, browY + hh * 0.1, hz + rz * 0.95], [rx * 0.85, hh * 0.022, rz * 0.6], 'head')],
        blend: 0.008 * H,
        clips: [(_x, y) => browY + hh * 0.07 - y],
      };
    if (hatKind === 'wizard')
      field = {
        shapes: [ellipsoid([0, browY + hh * 0.18, hz], [hh * 0.95, hh * 0.03, hh * 0.95], 'head'), roundCone([0, browY + hh * 0.2, hz], [0, hy + ry + hh * 0.75, hz - hh * 0.35], rx * 1.15, hh * 0.02, 'head')],
        blend: 0.02 * H,
      };
    if (hatKind === 'hood') {
      const zf = hz + rz * 0.35;
      field = {
        shapes: [ellipsoid([hx, hy, hz - hh * 0.05], [rx * 1.28, ry * 1.22, rz * 1.25], 'head'), roundCone([0, at.shoulderY - 0.01 * H, -0.01 * H], [0, at.chinY, -0.02 * H], 0.075 * H, rx * 1.1, 'neck')],
        blend: 0.03 * H,
        clips: [(x, y, z) => -Math.max(zf - z, Math.hypot(x / (rx * 0.85), (y - (hy - hh * 0.1)) / (ry * 0.95)) - 1)],
      };
    }
    if (hatKind === 'crown') {
      const y0 = hy + ry * 0.62;
      const shapes: Shape[] = [torus([hx, y0, hz], rx * 0.62, hh * 0.035, 'y', 'head')];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + Math.PI / 2;
        shapes.push(roundCone([hx + Math.cos(a) * rx * 0.62, y0, hz + Math.sin(a) * rx * 0.62], [hx + Math.cos(a) * rx * 0.66, y0 + hh * 0.17, hz + Math.sin(a) * rx * 0.66], hh * 0.035, hh * 0.012, 'head'));
      }
      field = { shapes, blend: 0.006 * H };
    }
    if (hatKind === 'helmet')
      field = {
        shapes: [ellipsoid([hx, hy + hh * 0.04, hz - hh * 0.02], [rx * 1.17, ry * 1.13, rz * 1.17], 'head'), torus([hx, browY + hh * 0.06, hz - hh * 0.02], rx * 1.1, hh * 0.035, 'y', 'head'), roundBox([0, browY - hh * 0.04, hz + rz * 1.12], [hh * 0.018, hh * 0.1, hh * 0.012], hh * 0.008, 'head')],
        blend: 0.008 * H,
        // Above the brows, plus the nose guard in front.
        clips: [(x, y, z) => (z > hz + rz * 0.95 && Math.abs(x) < hh * 0.045 ? -1 : browY + hh * 0.03 - y)],
      };
    if (hatKind === 'headband') field = { shapes: [scaled(torus([hx, browY + hh * 0.1, hz - hh * 0.02], rx * 1.0, hh * 0.028, 'y', 'head'), [hx, browY + hh * 0.1, hz], [1, 1, rz / rx])], blend: 0.006 * H };
    const metal = hatKind === 'crown' || hatKind === 'helmet';
    if (field) parts.push({ name: 'Hat', field, color: hatKind === 'crown' ? '#d4a93a' : c, cell: hatKind === 'crown' || hatKind === 'headband' ? 0.004 : 0.0075, roughness: metal ? 0.3 : 0.8, metalness: metal ? 0.8 : 0 });
  }

  // ------------------------------------------------------------------ extras
  for (const ex of r.extras) {
    if (ex.kind === 'cape') {
      const c: Chain = { name: 'cape', parent: 'upperChest', points: strand([0, at.shoulderY - 0.005 * H, -0.075 * H], [0, at.kneeY - 0.02 * H, -0.12 * H], 4) };
      chains.push(c);
      const shapes: Shape[] = [];
      for (let i = 0; i < 4; i++) {
        const a = c.points[i]!;
        const b = c.points[i + 1]!;
        const w = at.shoulderX * (1.05 + 0.12 * i);
        shapes.push(roundBox([0, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [w, Math.abs(a[1] - b[1]) / 2, 0.003 * H], 0.004 * H, `cape_${i}`));
      }
      // Wrapped over the shoulders.
      shapes.push(rebone(scaled(torus([0, at.shoulderY - 0.02 * H, -0.02 * H], at.shoulderX * 0.62, 0.012 * H, 'y', 'upperChest'), [0, at.shoulderY, 0], [1, 1, 0.75]), 'upperChest'));
      parts.push({ name: 'Cape', field: { shapes, blend: 0.03 * H }, color: ex.color, cell: 0.008, weights: shapes });
    }
    if (ex.kind === 'scarf') {
      const s1 = torus([0, at.neckY - 0.008 * H, 0], 0.035 * H, 0.016 * H, 'y', 'neck');
      const s2 = roundBox([0.03 * H, at.neckY - 0.07 * H, 0.05 * H], [0.022 * H, 0.06 * H, 0.006 * H], 0.005 * H, 'upperChest');
      parts.push({ name: 'Scarf', field: { shapes: [s1, s2], blend: 0.015 * H }, color: ex.color, cell: 0.006 });
    }
    if (ex.kind === 'belt') {
      const y = top === 'jacket' ? at.waistY - 0.01 * H : at.hipsY + 0.02 * H;
      parts.push({ name: 'Belt', field: { shapes: plan.shapes, blend: plan.blend, offset: 0.016 * H, clips: [(_x, yy) => Math.abs(yy - y) - 0.013 * H] }, color: ex.color, cell: 0.006 });
      parts.push({ name: 'Buckle', field: { shapes: [roundBox([0, y, 0.075 * H * (0.82 + 0.55 * r.body.build) + 0.012 * H], [0.014 * H, 0.012 * H, 0.004 * H], 0.002 * H, 'spine')], blend: 0.004 * H }, color: '#c9a23a', cell: 0.004, metalness: 0.8, roughness: 0.3 });
    }
    if (ex.kind === 'glasses') {
      const eyeY = at.chinY + hh * (plan.kid ? 0.36 : 0.42);
      const ez = hz + rz * 0.93;
      const fr = hh * 0.1;
      const shapes: Shape[] = [];
      for (const s of [1, -1]) {
        shapes.push(torus([s * hh * 0.17, eyeY, ez], fr, hh * 0.012, 'z', 'head'));
        shapes.push(roundCone([s * (hh * 0.17 + fr), eyeY + hh * 0.02, ez - hh * 0.02], [s * rx * 1.02, eyeY + hh * 0.03, hz - hh * 0.05], hh * 0.01, hh * 0.01, 'head'));
      }
      shapes.push(roundCone([hh * 0.07, eyeY + hh * 0.02, ez + hh * 0.01], [-hh * 0.07, eyeY + hh * 0.02, ez + hh * 0.01], hh * 0.01, hh * 0.01, 'head'));
      parts.push({ name: 'eye_glasses', field: { shapes, blend: 0.002 * H }, color: ex.color, cell: 0.0028 });
    }
    if (ex.kind === 'earrings') {
      const shapes = [1, -1].map((s) => ellipsoid([s * rx * 1.0, at.chinY + hh * 0.26, -hh * 0.04], [hh * 0.03, hh * 0.03, hh * 0.03], 'head'));
      parts.push({ name: 'Earrings', field: { shapes, blend: 0.002 * H }, color: '#d4a93a', cell: 0.003, metalness: 0.8, roughness: 0.3 });
    }
    if (ex.kind === 'apron') {
      const front = 0.06 * H * (0.82 + 0.55 * r.body.build) + 0.02 * H;
      const box = roundBox([0, (at.chestY + at.kneeY) / 2, front], [0.085 * H, (at.chestY - at.kneeY) / 2, 0.003 * H], 0.003 * H, 'spine');
      parts.push({ name: 'Apron', field: { shapes: [box], blend: 0.004 * H }, color: ex.color, cell: 0.008, weights: [...by(plan, /^(chest|spine|hips)$/), ...by(plan, /UpperLeg$/)], sigma: 0.04 });
    }
  }
  return { parts, chains };
}

/** A colour darkened (k < 1) or lightened (k > 1). */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k < 1 ? v * k : v + (255 - v) * (k - 1))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('')}`;
}
