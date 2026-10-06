/**
 * Automatic bone mapping: any common humanoid rig onto the canonical skeleton.
 *
 * Names alone are unreliable ("Leg" is the thigh in one rig and the shin in another; MMD rigs put
 * twist bones in the arm chain; Rigify splits limbs into numbered segments), so mapping combines
 * names with structure:
 *   1. hands and feet are found by name (wrist, hand, 手首; foot, ankle, 足首),
 *   2. their chains are walked up to the body, skipping twist and helper bones and merging
 *      numbered segments, which gives the lower and upper arm (and shoulder), or the lower and
 *      upper leg,
 *   3. the hips are the common ancestor of the legs and the head (a bone called hips or pelvis
 *      wins if it is one),
 *   4. the spine chain is the path from the hips to the head, split into spine, chest, upper
 *      chest and neck by length,
 *   5. fingers are classified by name under each hand and numbered by depth.
 * A VRM file's own humanoid map wins when there is one.
 */
import { REQUIRED_BONES, type HumanBone } from './skeleton.js';

export interface RigBone {
  name: string;
  parent: string | null;
}

export interface BoneMapResult {
  /** Canonical bone → the model's bone name. */
  map: Partial<Record<HumanBone, string>>;
  /** Required bones it couldn't find (body animation stays off until they're mapped by hand). */
  missing: HumanBone[];
  /** The naming convention it recognised. */
  convention: 'vrm' | 'mixamo' | 'rigify' | 'unreal' | 'mmd' | 'vroid' | 'generic';
}

type Side = 'left' | 'right' | null;
const NOISE = new Set(['def', 'org', 'j', 'bip', 'c', 'cc', 'base', 'mixamorig', 'adj', 'rig', 'armature', 'bone', 'jnt', 'b', 'sk', 'skel']);

/** Lower-case words of a bone name without namespaces, prefixes and side markers. */
export function boneWords(raw: string): { words: string[]; side: Side; joined: string } {
  let n = raw.replace(/^.*[:|]/, '').replace(/^bip0*\d+[\s_]*/i, ''); // mixamorig:Hips, Armature|Hips, Bip01 L Thigh
  let side: Side = /左/.test(n) ? 'left' : /右/.test(n) ? 'right' : null;
  n = n.replace(/[左右]/g, ' ');
  const words = n
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .toLowerCase()
    .split(/[\s._\-]+/)
    .filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (w === 'l' || w === 'left') side ??= 'left';
    else if (w === 'r' || w === 'right') side ??= 'right';
    else if (!NOISE.has(w) && !/^bip0*\d+$/.test(w)) out.push(w);
  }
  return { words: out, side, joined: out.join('') };
}

/** Bones that never carry a body part: twist, IK, control, helper and end bones. */
export function isHelperBone(raw: string): boolean {
  const n = raw.replace(/^.*[:|]/, '');
  if (/^(mch|ctrl|ik|vis|tgt|wgt|mstr)[-_]/i.test(n)) return true;
  if (/^j_sec_/i.test(n)) return true; // VRoid secondary (hair, skirt)
  return /twist|roll(?!ing)|捩|(^|[_\s.-])ik($|[_\s.-])|ik$|pole|target|ctrl|control|helper|socket|weapon|prop|dummy|nub|leaf|_end$|end$|tip$|指先|ダミー|操作/i.test(n.replace(/^(def|org)-/i, ''));
}

const HAND = /^(hand|wrist)$|手首/;
const FOOT = /^(foot|ankle)$|足首/;
const HEAD = /^head$|^頭$/;
const NECK = /^neck\d*$|^首$/;
const SHOULDER = /^(shoulder|clavicle|collar|collarbone)$|^肩$/;
const TOES = /^(toe|toes|toebase|ball)$|つま先/;
const EYE = /^(eye|faceeye)$|^目$/;
const JAW = /^jaw$|顎|あご/;
const FINGER: Array<[RegExp, string]> = [
  [/thumb|親指/, 'Thumb'],
  [/index|人指|人差/, 'Index'],
  [/middle|中指/, 'Middle'],
  [/ring|薬指/, 'Ring'],
  [/pinky|little|小指/, 'Little'],
];

function conventionOf(names: string[]): BoneMapResult['convention'] {
  const s = names.join(' ');
  if (/mixamorig/i.test(s)) return 'mixamo';
  if (/J_Bip_/i.test(s)) return 'vroid';
  if (/\bDEF-/i.test(s)) return 'rigify';
  if (/upperarm_l|spine_01|\bpelvis\b/i.test(s)) return 'unreal';
  if (/[左右上下]/.test(s)) return 'mmd';
  return 'generic';
}

export function mapBones(bones: RigBone[], vrmHumanoid?: Partial<Record<string, string>> | null): BoneMapResult {
  const byName = new Map(bones.map((b) => [b.name, b]));
  const names = bones.map((b) => b.name);
  if (vrmHumanoid && Object.keys(vrmHumanoid).length) {
    const map: Partial<Record<HumanBone, string>> = {};
    const v = vrmHumanoid as Record<string, string | undefined>;
    for (const [k, name] of Object.entries(v)) if (name && byName.has(name)) map[k as HumanBone] = name;
    // VRM 0.x names the thumb segments proximal/intermediate/distal; VRM 1.0 metacarpal/proximal/distal.
    for (const side of ['left', 'right'] as const) {
      if (v[`${side}ThumbIntermediate`] && !v[`${side}ThumbMetacarpal`]) {
        map[`${side}ThumbMetacarpal` as HumanBone] = v[`${side}ThumbProximal`];
        map[`${side}ThumbProximal` as HumanBone] = v[`${side}ThumbIntermediate`];
        delete (map as Record<string, string>)[`${side}ThumbIntermediate`];
      }
    }
    return { map, missing: REQUIRED_BONES.filter((b) => !map[b]), convention: 'vrm' };
  }

  const childrenOf = new Map<string, string[]>();
  for (const b of bones) if (b.parent) (childrenOf.get(b.parent) ?? childrenOf.set(b.parent, []).get(b.parent)!).push(b.name);
  const parentOf = (n: string) => byName.get(n)?.parent ?? null;
  const ancestors = (n: string): string[] => {
    const out: string[] = [];
    let p = parentOf(n);
    while (p && out.length < 300) {
      out.push(p);
      p = parentOf(p);
    }
    return out;
  };
  const info = new Map(names.map((n) => [n, boneWords(n)]));
  const W = (n: string) => info.get(n)!;
  const stem = (n: string) => W(n).joined.replace(/\d+$/, '');
  const find = (re: RegExp, side: Side) => names.filter((n) => !isHelperBone(n) && re.test(W(n).joined) && (side === null || W(n).side === side));
  const shallowest = (list: string[]) => [...list].sort((a, b) => ancestors(a).length - ancestors(b).length)[0];
  /** Ancestors without helper bones, with numbered segments of one limb (thigh, thigh.001) merged into the topmost. */
  const limbChain = (n: string): string[] => {
    const raw = ancestors(n).filter((x) => !isHelperBone(x));
    const out: string[] = [];
    for (const x of raw) {
      if (out.length && stem(out[out.length - 1]!) === stem(x) && W(x).side === W(out[out.length - 1]!).side) out[out.length - 1] = x;
      else out.push(x);
    }
    return out;
  };

  const map: Partial<Record<HumanBone, string>> = {};
  for (const side of ['left', 'right'] as const) {
    const S = side;
    const hand = shallowest(find(HAND, side));
    if (hand) {
      map[`${S}Hand` as HumanBone] = hand;
      const chain = limbChain(hand);
      if (chain[0]) map[`${S}LowerArm` as HumanBone] = chain[0];
      if (chain[1]) map[`${S}UpperArm` as HumanBone] = chain[1];
      const sh = chain[2];
      if (sh && (SHOULDER.test(W(sh).joined) || W(sh).side === side)) map[`${S}Shoulder` as HumanBone] = sh;
      for (const [re, finger] of FINGER) {
        const segs = names
          .filter((n) => !isHelperBone(n) && re.test(W(n).joined) && ancestors(n).includes(hand))
          .sort((a, b) => ancestors(a).length - ancestors(b).length)
          .slice(0, 3);
        const slots = finger === 'Thumb' ? (segs.length >= 3 ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Distal']) : ['Proximal', 'Intermediate', 'Distal'];
        segs.forEach((n, i) => {
          if (slots[i]) map[`${S}${finger}${slots[i]}` as HumanBone] = n;
        });
      }
    }
    const foot = shallowest(find(FOOT, side));
    if (foot) {
      map[`${S}Foot` as HumanBone] = foot;
      const chain = limbChain(foot);
      if (chain[0]) map[`${S}LowerLeg` as HumanBone] = chain[0];
      if (chain[1]) map[`${S}UpperLeg` as HumanBone] = chain[1];
      const toes = (childrenOf.get(foot) ?? []).filter((n) => !isHelperBone(n)).find((n) => TOES.test(W(n).joined)) ?? (childrenOf.get(foot) ?? []).find((n) => !isHelperBone(n));
      if (toes) map[`${S}Toes` as HumanBone] = toes;
    }
  }

  // The head by name, or the end of the bone chain rising between the two arms.
  let head = shallowest(find(HEAD, null).filter((n) => W(n).side === null));
  const lArm = map.leftUpperArm;
  const rArm = map.rightUpperArm;
  if (!head && lArm && rArm) {
    const rUp = new Set(ancestors(rArm));
    const upper = ancestors(lArm).find((n) => rUp.has(n));
    let cur = upper;
    const sideChildren = new Set([map.leftShoulder, map.rightShoulder, lArm, rArm]);
    while (cur) {
      const next: string | undefined = (childrenOf.get(cur) ?? []).find((n) => !isHelperBone(n) && W(n).side === null && !sideChildren.has(n));
      if (!next) break;
      cur = next;
    }
    if (cur && cur !== upper) head = cur;
  }
  if (head) map.head = head;

  // Hips: the common ancestor of a leg and the head.
  const leg = map.leftUpperLeg ?? map.rightUpperLeg;
  if (leg && head) {
    const up = new Set(ancestors(head));
    const common = ancestors(leg).find((n) => up.has(n));
    const named = names.find((n) => /^(hips?|pelvis)$/.test(W(n).joined) && W(n).side === null && ancestors(leg).includes(n) && ancestors(head!).includes(n));
    map.hips = named ?? common;
  }
  // The spine chain: hips (exclusive) to head (exclusive), without helper bones.
  if (map.hips && head) {
    const path = ancestors(head);
    const i = path.indexOf(map.hips);
    const chain = (i >= 0 ? path.slice(0, i) : path).reverse().filter((n) => !isHelperBone(n));
    // The bone the shoulders hang from is the upper chest; what lies between it and the head is neck.
    const lUp = map.leftShoulder ?? map.leftUpperArm;
    const rUp = map.rightShoulder ?? map.rightUpperArm;
    const armRoot = lUp && rUp ? ancestors(lUp).find((n) => ancestors(rUp).includes(n)) : undefined;
    const k = armRoot ? chain.indexOf(armRoot) : -1;
    if (k >= 0 && k < chain.length - 1) chain.splice(k + 2);
    let neck: string | undefined;
    if (chain.length >= 2 || (chain.length === 1 && NECK.test(W(chain[0]!).joined))) neck = chain.pop();
    // Several neck bones (Rigify's spine.004/.005, "neck1/neck2"): the lowest one is the neck.
    while (chain.length && NECK.test(stem(chain[chain.length - 1]!) || W(chain[chain.length - 1]!).joined)) neck = chain.pop();
    if (neck) map.neck = neck;
    if (chain.length === 1) map.spine = chain[0];
    else if (chain.length === 2) [map.spine, map.chest] = chain;
    else if (chain.length >= 3) {
      map.spine = chain[0];
      map.chest = chain[Math.floor(chain.length / 2)];
      map.upperChest = chain[chain.length - 1];
    }
    const jaw = names.find((n) => JAW.test(W(n).joined) && ancestors(n).includes(head!));
    if (jaw) map.jaw = jaw;
    for (const side of ['left', 'right'] as const) {
      const eye = names.find((n) => EYE.test(W(n).joined) && W(n).side === side && ancestors(n).includes(head!));
      if (eye) map[`${side}Eye` as HumanBone] = eye;
    }
  }
  return { map, missing: REQUIRED_BONES.filter((b) => !map[b]), convention: conventionOf(names) };
}
