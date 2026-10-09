/**
 * Fixture skeletons for the auto-mapper: names, hierarchy and rest positions only (no meshes, no
 * third-party content), each bone with the answer expected. Labels: "humanoid", "spine" (the chain
 * between hips and neck, or a humanoid spine bone), a secondary role, "ignore", or several
 * alternatives joined by "|".
 */
import type { AutomapBone, Vec3 } from '../src/rig/automap';

export interface Fixture {
  name: string;
  bones: AutomapBone[];
  expected: Record<string, string>;
  /** Accuracy the auto-mapper must reach (overall). */
  min: number;
}

class Rig {
  bones: AutomapBone[] = [];
  expected: Record<string, string> = {};
  add(name: string, parent: string | null, pos: Vec3 | undefined, label: string) {
    this.bones.push({ name, parent, pos });
    this.expected[name] = label;
    return name;
  }
  chain(names: string[], parent: string, from: Vec3, step: Vec3, label: string) {
    let p = parent;
    let at = from;
    for (const n of names) {
      p = this.add(n, p, at, label);
      at = [at[0] + step[0], at[1] + step[1], at[2] + step[2]];
    }
    return p;
  }
}

/** A humanoid body in metres: Y up, facing +Z, the left side at +X. */
interface Body {
  hips: string;
  spine: string[];
  neck: string;
  head: string;
  side: (s: 'L' | 'R') => { shoulder: string; upper: string; lower: string; hand: string; thigh: string; shin: string; foot: string; toe: string; fingers: (f: string, i: number) => string };
}

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];

function body(r: Rig, n: Body, root: string | null, spineLabels?: string[]) {
  r.add(n.hips, root, [0, 0.95, 0], 'humanoid');
  let p = n.hips;
  n.spine.forEach((s, i) => {
    p = r.add(s, p, [0, 1.05 + i * (0.35 / n.spine.length), 0], spineLabels?.[i] ?? 'spine|humanoid');
  });
  const top = p;
  r.add(n.neck, top, [0, 1.48, 0], 'humanoid');
  r.add(n.head, n.neck, [0, 1.58, 0.01], 'humanoid');
  for (const s of ['L', 'R'] as const) {
    const x = s === 'L' ? 1 : -1;
    const k = n.side(s);
    r.add(k.shoulder, top, [0.04 * x, 1.42, 0], 'humanoid');
    r.add(k.upper, k.shoulder, [0.17 * x, 1.42, 0], 'humanoid');
    r.add(k.lower, k.upper, [0.43 * x, 1.42, 0], 'humanoid');
    r.add(k.hand, k.lower, [0.66 * x, 1.42, 0], 'humanoid');
    FINGERS.forEach((f, fi) => {
      let fp = k.hand;
      for (let i = 1; i <= 3; i++) fp = r.add(k.fingers(f, i), fp, [(0.69 + i * 0.025) * x, 1.42, 0.04 - fi * 0.02], 'humanoid');
    });
    r.add(k.thigh, n.hips, [0.09 * x, 0.9, 0], 'humanoid');
    r.add(k.shin, k.thigh, [0.09 * x, 0.5, 0], 'humanoid');
    r.add(k.foot, k.shin, [0.09 * x, 0.08, 0], 'humanoid');
    r.add(k.toe, k.foot, [0.09 * x, 0.02, 0.12], 'humanoid');
  }
}

/** Secondary chains every VRChat-style avatar has, with names from `nm` (null: meaningless names). */
function extras(r: Rig, at: { chest: string; hips: string; head: string; upperArm: (s: 'L' | 'R') => string; thigh: (s: 'L' | 'R') => string }, nm: ((what: string, s: string, i: number, j?: number) => string) | null, opts: { hairChains: number; skirtChains: number; tail: boolean }) {
  let anon = 0;
  const name = (what: string, s: string, i: number, j?: number) => (nm ? nm(what, s, i, j) : `Bone.${String(++anon).padStart(3, '0')}`);
  for (const s of ['L', 'R'] as const) {
    const x = s === 'L' ? 1 : -1;
    r.chain([name('breast', s, 1), name('breast', s, 2), name('breast', s, 3)], at.chest, [0.07 * x, 1.3, 0.06], [0, -0.01, 0.035], 'breast');
    r.chain([name('butt', s, 1), name('butt', s, 2)], at.hips, [0.07 * x, 0.88, -0.07], [0, -0.01, -0.03], 'butt');
    if (nm) {
      r.add(name('twistArm', s, 1), at.upperArm(s), [0.3 * x, 1.42, 0], 'upperArmHelper');
      r.add(name('twistThigh', s, 1), at.thigh(s), [0.09 * x, 0.7, 0], 'thighHelper');
    }
  }
  // Hair strands: from the back and sides of the head, going down.
  for (let i = 0; i < opts.hairChains; i++) {
    const a = (i / opts.hairChains) * Math.PI * 1.6 - Math.PI * 0.8;
    r.chain([1, 2, 3, 4].map((j) => name('hair', '', i, j)), at.head, [Math.sin(a) * 0.08, 1.7, -Math.cos(a) * 0.08], [Math.sin(a) * 0.01, -0.07, -Math.cos(a) * 0.01], 'hair');
  }
  // Skirt panels around the hips, pointing down.
  const skirtRoot = nm ? r.add(name('skirtRoot', '', 0), at.hips, [0, 0.93, 0], 'skirt') : at.hips;
  for (let i = 0; i < opts.skirtChains; i++) {
    const a = (i / opts.skirtChains) * Math.PI * 2;
    r.chain([1, 2, 3].map((j) => name('skirt', '', i, j)), skirtRoot, [Math.sin(a) * 0.14, 0.86, Math.cos(a) * 0.12], [Math.sin(a) * 0.02, -0.1, Math.cos(a) * 0.02], 'skirt');
  }
  if (opts.tail) r.chain([1, 2, 3, 4, 5].map((j) => name('tail', '', 0, j)), at.hips, [0, 0.9, -0.12], [0, -0.02, -0.08], 'tail');
}

const vrchatEnglish = (): Fixture => {
  const r = new Rig();
  r.add('Armature', null, [0, 0, 0], 'ignore|accessory');
  const side = (s: 'L' | 'R') => ({ shoulder: `Shoulder.${s}`, upper: `Upper_arm.${s}`, lower: `Lower_arm.${s}`, hand: `Hand.${s}`, thigh: `Upper_leg.${s}`, shin: `Lower_leg.${s}`, foot: `Foot.${s}`, toe: `Toes.${s}`, fingers: (f: string, i: number) => `${f}_${i}.${s}` });
  // Five spine bones, as on many VRChat bases.
  body(r, { hips: 'Hips', spine: ['Spine', 'Spine1', 'Spine2', 'Chest', 'Upper_Chest'], neck: 'Neck', head: 'Head', side }, 'Armature');
  const words: Record<string, string> = { breast: 'Breast', butt: 'Butt', twistArm: 'UpperArm_Twist', twistThigh: 'Thigh_Twist', hair: 'Hair', skirtRoot: 'Skirt_Root', skirt: 'Skirt', tail: 'Tail' };
  extras(r, { chest: 'Chest', hips: 'Hips', head: 'Head', upperArm: (s) => `Upper_arm.${s}`, thigh: (s) => `Upper_leg.${s}` }, (w, s, i, j) => (s ? `${words[w]}_${i}.${s}` : j !== undefined ? `${words[w]}_${String(i).padStart(2, '0')}_${j}` : `${words[w]}`), { hairChains: 18, skirtChains: 12, tail: true });
  r.add('Hat_Ribbon', 'Head', [0, 1.75, 0], 'accessory');
  r.add('Head_end', 'Head', [0, 1.8, 0], 'ignore');
  return { name: 'VRChat-style, English names', bones: r.bones, expected: r.expected, min: 0.98 };
};

const vrchatJapanese = (): Fixture => {
  const r = new Rig();
  const sideJ = (s: 'L' | 'R') => (s === 'L' ? '左' : '右');
  const side = (s: 'L' | 'R') => ({ shoulder: `${sideJ(s)}肩`, upper: `${sideJ(s)}腕`, lower: `${sideJ(s)}ひじ`, hand: `${sideJ(s)}手首`, thigh: `${sideJ(s)}足`, shin: `${sideJ(s)}ひざ`, foot: `${sideJ(s)}足首`, toe: `${sideJ(s)}つま先`, fingers: (f: string, i: number) => `${sideJ(s)}${({ Thumb: '親指', Index: '人指', Middle: '中指', Ring: '薬指', Little: '小指' } as Record<string, string>)[f]}${i}` });
  body(r, { hips: '下半身', spine: ['上半身', '上半身2', '上半身3'], neck: '首', head: '頭', side }, null);
  const words: Record<string, string> = { breast: '胸', butt: '尻', twistArm: '腕捩', twistThigh: '足捩', hair: '髪', skirtRoot: 'スカート親', skirt: 'スカート', tail: 'しっぽ' };
  extras(r, { chest: '上半身3', hips: '下半身', head: '頭', upperArm: (s) => `${sideJ(s)}腕`, thigh: (s) => `${sideJ(s)}足` }, (w, s, i, j) => (s ? `${sideJ(s as 'L')}${words[w]}${i}` : j !== undefined ? `${words[w]}_${i}_${j}` : words[w]!), { hairChains: 14, skirtChains: 10, tail: true });
  return { name: 'VRChat-style, Japanese names', bones: r.bones, expected: r.expected, min: 0.97 };
};

const vrchatAnonymous = (): Fixture => {
  const r = new Rig();
  const side = (s: 'L' | 'R') => ({ shoulder: `Shoulder.${s}`, upper: `UpperArm.${s}`, lower: `LowerArm.${s}`, hand: `Hand.${s}`, thigh: `UpperLeg.${s}`, shin: `LowerLeg.${s}`, foot: `Foot.${s}`, toe: `Toe.${s}`, fingers: (f: string, i: number) => `${f}${i}.${s}` });
  body(r, { hips: 'Hips', spine: ['Spine', 'Chest', 'UpperChest'], neck: 'Neck', head: 'Head', side }, null);
  // Secondary bones with meaningless names: only the hierarchy and geometry can tell.
  extras(r, { chest: 'UpperChest', hips: 'Hips', head: 'Head', upperArm: (s) => `UpperArm.${s}`, thigh: (s) => `UpperLeg.${s}` }, null, { hairChains: 35, skirtChains: 16, tail: false });
  return { name: 'VRChat-style, meaningless secondary names (geometry only)', bones: r.bones, expected: r.expected, min: 0.95 };
};

const vroid = (): Fixture => {
  const r = new Rig();
  const side = (s: 'L' | 'R') => ({ shoulder: `J_Bip_${s}_Shoulder`, upper: `J_Bip_${s}_UpperArm`, lower: `J_Bip_${s}_LowerArm`, hand: `J_Bip_${s}_Hand`, thigh: `J_Bip_${s}_UpperLeg`, shin: `J_Bip_${s}_LowerLeg`, foot: `J_Bip_${s}_Foot`, toe: `J_Bip_${s}_ToeBase`, fingers: (f: string, i: number) => `J_Bip_${s}_${f}${i}` });
  r.add('Root', null, [0, 0, 0], 'ignore|accessory');
  body(r, { hips: 'J_Bip_C_Hips', spine: ['J_Bip_C_Spine', 'J_Bip_C_Chest', 'J_Bip_C_UpperChest'], neck: 'J_Bip_C_Neck', head: 'J_Bip_C_Head', side }, 'Root');
  for (const s of ['L', 'R'] as const) {
    const x = s === 'L' ? 1 : -1;
    r.chain([`J_Sec_${s}_Bust1`, `J_Sec_${s}_Bust2`], 'J_Bip_C_Chest', [0.07 * x, 1.28, 0.06], [0, 0, 0.04], 'breast');
    r.add(`J_Adj_${s}_FaceEye`, 'J_Bip_C_Head', [0.03 * x, 1.62, 0.07], 'humanoid|ignore');
  }
  for (let i = 1; i <= 12; i++) r.chain([1, 2, 3].map((j) => `J_Sec_Hair${j}_${String(i).padStart(2, '0')}`), 'J_Bip_C_Head', [Math.sin(i) * 0.08, 1.7, -0.06], [0, -0.06, -0.01], 'hair');
  for (let i = 1; i <= 8; i++) r.chain([1, 2].map((j) => `J_Sec_R_SkirtBack${i}_${j}`), 'J_Bip_C_Hips', [Math.sin(i) * 0.12, 0.88, -0.05], [0, -0.12, -0.01], 'skirt');
  return { name: 'VRoid export', bones: r.bones, expected: r.expected, min: 0.98 };
};

const mmd = (): Fixture => {
  const r = new Rig();
  r.add('全ての親', null, [0, 0, 0], 'ignore');
  r.add('センター', '全ての親', [0, 0.8, 0], 'ignore');
  r.add('グルーブ', 'センター', [0, 0.85, 0], 'ignore');
  const sideJ = (s: 'L' | 'R') => (s === 'L' ? '左' : '右');
  const side = (s: 'L' | 'R') => ({ shoulder: `${sideJ(s)}肩`, upper: `${sideJ(s)}腕`, lower: `${sideJ(s)}ひじ`, hand: `${sideJ(s)}手首`, thigh: `${sideJ(s)}足`, shin: `${sideJ(s)}ひざ`, foot: `${sideJ(s)}足首`, toe: `${sideJ(s)}つま先`, fingers: (f: string, i: number) => `${sideJ(s)}${({ Thumb: '親指', Index: '人指', Middle: '中指', Ring: '薬指', Little: '小指' } as Record<string, string>)[f]}${i}` });
  body(r, { hips: '下半身', spine: ['上半身', '上半身2'], neck: '首', head: '頭', side }, 'グルーブ');
  for (const s of ['L', 'R'] as const) {
    const x = s === 'L' ? 1 : -1;
    r.add(`${sideJ(s)}腕捩`, `${sideJ(s)}腕`, [0.3 * x, 1.42, 0], 'upperArmHelper');
    r.add(`${sideJ(s)}足IK`, '全ての親', [0.09 * x, 0.08, 0], 'ignore');
    r.chain([`${sideJ(s)}胸`, `${sideJ(s)}胸先`], '上半身2', [0.07 * x, 1.3, 0.06], [0, 0, 0.04], 'breast');
  }
  r.add('両目', '頭', [0, 1.62, 0.07], 'ignore');
  for (let i = 1; i <= 6; i++) r.chain([1, 2, 3].map((j) => `前髪${i}_${j}`), '頭', [Math.sin(i) * 0.06, 1.7, 0.06], [0, -0.04, 0.005], 'hair');
  return { name: 'MMD model (Japanese standard names)', bones: r.bones, expected: r.expected, min: 0.97 };
};

const mixamo = (): Fixture => {
  const r = new Rig();
  const m = (n: string) => `mixamorig:${n}`;
  const side = (s: 'L' | 'R') => {
    const S = s === 'L' ? 'Left' : 'Right';
    return { shoulder: m(`${S}Shoulder`), upper: m(`${S}Arm`), lower: m(`${S}ForeArm`), hand: m(`${S}Hand`), thigh: m(`${S}UpLeg`), shin: m(`${S}Leg`), foot: m(`${S}Foot`), toe: m(`${S}ToeBase`), fingers: (f: string, i: number) => m(`${S}Hand${f === 'Little' ? 'Pinky' : f}${i}`) };
  };
  body(r, { hips: m('Hips'), spine: [m('Spine'), m('Spine1'), m('Spine2')], neck: m('Neck'), head: m('Head'), side }, null);
  r.add(m('HeadTop_End'), m('Head'), [0, 1.78, 0], 'ignore');
  return { name: 'Mixamo rig', bones: r.bones, expected: r.expected, min: 1 };
};

const rigify = (): Fixture => {
  const r = new Rig();
  const side = (s: 'L' | 'R') => ({ shoulder: `DEF-shoulder.${s}`, upper: `DEF-upper_arm.${s}`, lower: `DEF-forearm.${s}`, hand: `DEF-hand.${s}`, thigh: `DEF-thigh.${s}`, shin: `DEF-shin.${s}`, foot: `DEF-foot.${s}`, toe: `DEF-toe.${s}`, fingers: (f: string, i: number) => `DEF-${f === 'Thumb' ? 'thumb' : `f_${f.toLowerCase() === 'little' ? 'pinky' : f.toLowerCase()}`}.0${i}.${s}` });
  body(r, { hips: 'DEF-spine', spine: ['DEF-spine.001', 'DEF-spine.002', 'DEF-spine.003'], neck: 'DEF-spine.004', head: 'DEF-spine.006' , side }, null);
  for (const s of ['L', 'R'] as const) {
    const x = s === 'L' ? 1 : -1;
    r.add(`DEF-breast.${s}`, 'DEF-spine.003', [0.07 * x, 1.3, 0.08], 'breast');
    // Rigify splits limbs: the second segment follows the first.
    r.add(`DEF-upper_arm.${s}.001`, `DEF-upper_arm.${s}`, [0.3 * x, 1.42, 0], 'upperArmHelper|humanoid');
    r.add(`DEF-thigh.${s}.001`, `DEF-thigh.${s}`, [0.09 * x, 0.7, 0], 'thighHelper|humanoid');
  }
  return { name: 'Rigify (deform bones)', bones: r.bones, expected: r.expected, min: 0.97 };
};

export const FIXTURES: (() => Fixture)[] = [vroid, mmd, mixamo, rigify, vrchatEnglish, vrchatJapanese, vrchatAnonymous];
