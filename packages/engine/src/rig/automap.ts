/**
 * The auto-mapper: every bone of a skeleton (100–300 on VRChat avatars) onto Everloom's humanoid
 * core, the spine chain and the secondary roles, with a confidence and the reason for each.
 *
 * Evidence, strongest first:
 *   1. a mapping the file already has (Unity's humanoid in .fbx.meta, VRM's humanoid), PhysBone roots;
 *   2. a known base's naming (VRoid, MMD, Mixamo, Rigify, Unreal, Daz, VRChat bases) — presets.ts;
 *   3. names in English, Japanese, Chinese and Korean (names.ts), with prefixes, sides and numbers;
 *   4. the hierarchy: what a chain hangs from, its length, left/right pairs;
 *   5. rest-pose geometry relative to the body: breasts forward of the chest, the butt behind and below
 *      the hips, hair above the neck, skirt bones around the hips pointing down;
 *   6. the skin-weight footprint (where the vertices a bone moves are), when given.
 * Nothing is dropped silently: every bone ends up mapped, in a role, ignored with a reason, or listed
 * for review.
 */
import { mapBones, type RigBone } from '../avatar/bonemap.js';
import { REQUIRED_BONES, type HumanBone } from '../avatar/skeleton.js';
import { hasWord, nameInfo, type NameInfo, type Side } from './names.js';
import { recognizeBase, type BasePreset } from './presets.js';
import { RigMappingSchema, type RigMapping, type RigRole, type RoleAssignment } from './schema.js';

export type Vec3 = [number, number, number];

export interface AutomapBone {
  name: string;
  parent: string | null;
  /** Rest-pose position in world space (metres, Y up), when known. */
  pos?: Vec3;
  /** Where the vertices this bone moves are (their weighted centre) and how many. */
  footprint?: { count: number; center: Vec3 };
}

export interface AutomapInput {
  bones: AutomapBone[];
  /** A mapping the file already has. */
  humanoid?: Partial<Record<HumanBone, string>> | null;
  humanoidSource?: string;
  /** Physics chain roots the file names (PhysBones, VRM springs), with a kind. */
  chains?: { root: string; kind: string }[];
}

export interface Assigned {
  bone: string;
  confidence: number;
  why: string;
}

export interface AutomapResult {
  humanoid: Partial<Record<HumanBone, Assigned>>;
  /** Plain bone map (for AvatarConfig.boneMap). */
  boneMap: Partial<Record<HumanBone, string>>;
  missing: HumanBone[];
  rig: RigMapping;
  /** Bones a person should look at, with the reason. */
  review: { bone: string; why: string }[];
  base: BasePreset | null;
  /** Every bone's outcome, for the report and tests. */
  byBone: Map<string, { kind: 'humanoid' | 'spine' | 'role' | 'ignore' | 'review'; role?: RigRole | HumanBone; confidence: number; why: string }>;
}

const REVIEW_BELOW = 0.6;

/** Name rules for each role (on English words after translation). */
const ROLE_NAMES: [RigRole, RegExp, number][] = [
  ['breast', /^(breasts?|bust|boobs?|oppai|nipple|tit|tits|mune|chichi|pecs?)$/, 0.9],
  ['butt', /^(butt|buttocks?|glutes?|gluteus|ass|bottom|oshiri|hip_?cheek)$/, 0.9],
  ['belly', /^(belly|stomach|tummy|abdomen|abs|onaka)$/, 0.85],
  ['hair', /^(hair|hairs|bangs?|fronthair|backhair|sidehair|ahoge|ponytail|twintails?|braids?|sideburns?|kami|maegami|ushirogami|forelock|fringe|tress)$/, 0.9],
  ['skirt', /^(skirt|hem|dress|frill|petticoat|sukato|apron)$/, 0.85],
  ['coat', /^(coat|cape|cloak|mantle|robe|tailcoat|jacket|sleeve|scarf|mant|cloth)$/, 0.75],
  ['tail', /^(tail|shippo)$/, 0.9],
  ['ears', /^(ears?|kemomimi|mimi|nekomimi)$/, 0.85],
  ['wings', /^(wings?|feathers?|hane)$/, 0.9],
  ['eyelid', /^(eyelids?|lids?|mabuta)$/, 0.9],
  ['tongue', /^(tongue|shita)$/, 0.9],
  ['teeth', /^(teeth|tooth|fangs?)$/, 0.9],
  ['accessory', /^(acc|accessory|accessories|hat|cap|glasses|earrings?|necklace|bag|weapon|sword|ribbon|bow|choker|hairpin|ornament|prop|halo|horns?|crown|bell)$/, 0.7],
];
const HELPER = /^(twist|roll|helper|adj|sub|corrective|correct|aux|support|bulge|volume|fix|dummy|share|leaf|socket)$/;
const IGNORE = /^(end|nub|tip|ik|ctrl|control|target|pole|null|locator|marker|root|parent|center|groove|waistcancel|viewcenter|grip|weapon_?r|armature)$/;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export function automap(input: AutomapInput): AutomapResult {
  const bones = input.bones;
  const byName = new Map(bones.map((b) => [b.name, b]));
  const children = new Map<string, string[]>();
  for (const b of bones) if (b.parent) children.set(b.parent, [...(children.get(b.parent) ?? []), b.name]);
  const info = new Map(bones.map((b) => [b.name, nameInfo(b.name)]));
  const byBone: AutomapResult['byBone'] = new Map();
  const review: AutomapResult['review'] = [];

  // 1–2. The humanoid core: the file's own mapping, else the core mapper on raw and translated names.
  const base = recognizeBase(bones.map((b) => b.name));
  const humanoid: AutomapResult['humanoid'] = {};
  if (input.humanoid) for (const [k, v] of Object.entries(input.humanoid)) if (v && byName.has(v)) humanoid[k as HumanBone] = { bone: v, confidence: 1, why: `from the file (${input.humanoidSource ?? 'its humanoid map'})` };
  const rig: RigBone[] = bones.map((b) => ({ name: b.name, parent: b.parent }));
  const auto = mapBones(rig, null);
  for (const [k, v] of Object.entries(auto.map)) if (v && !humanoid[k as HumanBone]) humanoid[k as HumanBone] = { bone: v, confidence: base ? 0.95 : 0.85, why: base ? `the ${base.name} naming` : `by name and structure (${auto.convention})` };
  // Translated names catch what raw CJK names hide (中國 rigs, Korean rigs).
  if (REQUIRED_BONES.some((b) => !humanoid[b])) {
    const translated = bones.map((b) => ({ name: info.get(b.name)!.words.join('_') + (info.get(b.name)!.side ? `_${info.get(b.name)!.side}` : '') + `#${b.name}`, parent: b.parent }));
    const back = new Map(translated.map((t, i) => [t.name, bones[i]!.name]));
    const parents = new Map(bones.map((b, i) => [b.name, translated[i]!.name]));
    const t2 = mapBones(translated.map((t) => ({ name: t.name, parent: t.parent ? parents.get(t.parent) ?? null : null })), null);
    for (const [k, v] of Object.entries(t2.map)) if (v && !humanoid[k as HumanBone]) humanoid[k as HumanBone] = { bone: back.get(v)!, confidence: 0.75, why: 'by translated name and structure' };
  }
  const used = new Set<string>();
  for (const [k, a] of Object.entries(humanoid)) {
    used.add(a.bone);
    byBone.set(a.bone, { kind: 'humanoid', role: k as HumanBone, confidence: a.confidence, why: a.why });
  }
  const missing = REQUIRED_BONES.filter((b) => !humanoid[b]);
  for (const m of missing) review.push({ bone: m, why: `No bone found for ${m}.` });

  // 3. The spine chain: everything between the hips and the neck (or head), in order.
  const ancestors = (n: string) => {
    const out: string[] = [];
    let p = byName.get(n)?.parent ?? null;
    const guard = new Set<string>();
    while (p && !guard.has(p)) {
      guard.add(p);
      out.push(p);
      p = byName.get(p)?.parent ?? null;
    }
    return out;
  };
  const hips = humanoid.hips?.bone;
  const top = humanoid.neck?.bone ?? humanoid.head?.bone;
  let spine: string[] = [];
  if (hips && top) {
    const up = ancestors(top);
    const i = up.indexOf(hips);
    if (i >= 0) spine = up.slice(0, i).reverse();
  }
  for (const s of spine) {
    if (!used.has(s)) byBone.set(s, { kind: 'spine', confidence: 0.9, why: 'between the hips and the neck' });
    used.add(s);
  }

  // Body landmarks for geometry (Y up; which way is forward and which side is left).
  const P = (n?: string) => (n ? byName.get(n)?.footprint?.center ?? byName.get(n)?.pos : undefined);
  const head = P(humanoid.head?.bone);
  const footL = P(humanoid.leftFoot?.bone);
  const footR = P(humanoid.rightFoot?.bone);
  const hipsP = P(hips);
  const chestP = P(humanoid.upperChest?.bone ?? humanoid.chest?.bone ?? spine.at(-1));
  const neckP = P(humanoid.neck?.bone);
  const floor = Math.min(footL?.[1] ?? Infinity, footR?.[1] ?? Infinity, hipsP ? hipsP[1] - 1 : Infinity);
  const height = head && Number.isFinite(floor) ? Math.max(0.3, head[1] - floor) : 1.6;
  const toes = [P(humanoid.leftToes?.bone), P(humanoid.rightToes?.bone)].filter(Boolean) as Vec3[];
  const feet = [footL, footR].filter(Boolean) as Vec3[];
  let fwdSign = 1;
  if (toes.length && feet.length) fwdSign = Math.sign(toes.reduce((s, t) => s + t[2], 0) / toes.length - feet.reduce((s, f) => s + f[2], 0) / feet.length) || 1;
  const leftArm = P(humanoid.leftUpperArm?.bone);
  const leftSign = leftArm && hipsP ? Math.sign(leftArm[0] - hipsP[0]) || 1 : 1;
  const sideOfX = (x: number, cx: number): Side => (Math.abs(x - cx) < height * 0.008 ? null : Math.sign(x - cx) === leftSign ? 'L' : 'R');

  // PhysBone roots and the like.
  const chainKind = new Map((input.chains ?? []).map((c) => [c.root, c.kind]));

  const humanOf = (n: string | null): HumanBone | 'spine' | null => {
    let p = n;
    const guard = new Set<string>();
    while (p && !guard.has(p)) {
      guard.add(p);
      const b = byBone.get(p);
      if (b?.kind === 'humanoid') return b.role as HumanBone;
      if (b?.kind === 'spine') return 'spine';
      p = byName.get(p)?.parent ?? null;
    }
    return null;
  };

  /** A role for a chain root from its name, its PhysBone, and where it is. */
  const classify = (n: string, inChain = false): { role: RigRole | 'ignore' | null; confidence: number; why: string } => {
    const i = info.get(n)!;
    const parentHuman = humanOf(byName.get(n)?.parent ?? null);
    const pk = chainKind.get(n);
    let nameRole: [RigRole, number] | null = null;
    const baseRole = base?.role(n) ?? null;
    if (baseRole === 'ignore') return { role: 'ignore', confidence: 0.95, why: `a ${base!.name} control or end bone` };
    if (baseRole) nameRole = [baseRole, 0.92];
    if (!nameRole) for (const [role, re, c] of ROLE_NAMES) if (hasWord(i, re)) {
      nameRole = [role, c];
      break;
    }
    // "Chest_L" / "Hip.R" next to a mapped chest or hips: a breast / butt bone on many rigs.
    if (!nameRole && i.side && /^(chest|mune)$/.test(i.joined) && (parentHuman === 'chest' || parentHuman === 'upperChest' || parentHuman === 'spine')) nameRole = ['breast', 0.7];
    if (!nameRole && i.side && /^(hip|hips|koshi)$/.test(i.joined) && parentHuman === 'hips') nameRole = ['butt', 0.55];
    // A limb split into numbered segments (Rigify's upper_arm.L.001): the extra segment follows the first.
    const parentName = byName.get(n)?.parent;
    const segmentOf = parentName && info.get(parentName)!.joined === i.joined && byBone.get(parentName)?.kind === 'humanoid';
    if (!nameRole && (segmentOf || i.words.some((w) => HELPER.test(w)))) {
      const h = parentHuman;
      const role: RigRole | null = h === 'leftUpperLeg' || h === 'rightUpperLeg' || h === 'hips' ? 'thighHelper' : h === 'leftUpperArm' || h === 'rightUpperArm' ? 'upperArmHelper' : h === 'leftLowerArm' || h === 'rightLowerArm' || h === 'leftHand' || h === 'rightHand' ? 'forearmHelper' : h === 'leftShoulder' || h === 'rightShoulder' || h === 'upperChest' || h === 'chest' ? 'shoulderHelper' : null;
      if (role) return { role, confidence: 0.85, why: segmentOf ? `a second segment of the ${h}` : `a helper/twist bone on the ${h}` };
    }
    if (!nameRole && (i.words.some((w) => IGNORE.test(w)) || /_end$|\.end$|end$/i.test(n)) && !(children.get(n)?.length)) return { role: 'ignore', confidence: 0.9, why: 'an end, IK or control bone' };
    // PhysBone kinds.
    const physRole: RigRole | null = pk === 'chest' ? 'breast' : pk === 'hair' ? 'hair' : pk === 'tail' ? 'tail' : pk === 'cloth' ? 'skirt' : null;
    // Geometry.
    let geo: [RigRole, number, string] | null = null;
    const p = P(n);
    // Geometry judges where a chain starts; bones further along it keep the chain's role.
    if (p && hipsP && !inChain) {
      const from = (q: Vec3) => {
        const d = sub(p, q);
        return { up: d[1] / height, fwd: (d[2] * fwdSign) / height, side: Math.abs(p[0] - hipsP[0]) / height };
      };
      const chainLen = depth(n);
      if ((parentHuman === 'chest' || parentHuman === 'upperChest' || parentHuman === 'spine') && chestP) {
        const r = from(chestP);
        if (r.fwd > 0.02 && r.up > -0.12 && r.up < 0.06 && r.side > 0.01 && r.side < 0.12) geo = ['breast', 0.75, 'forward of the chest, to one side'];
        else if (r.fwd > 0.02 && r.up < -0.1 && r.side < 0.03) geo = ['belly', 0.6, 'forward of the lower spine'];
      }
      // Which way the chain runs (to its first child): skirts hang straight down.
      const kid = (children.get(n) ?? []).map((c) => P(c)).find(Boolean);
      const dir = kid ? sub(kid, p) : null;
      const len = dir ? Math.hypot(...dir) : 0;
      const hangs = !!dir && len > 0 && dir[1] / len < -0.7;
      if (!geo && (parentHuman === 'hips' || parentHuman === 'spine')) {
        const r = from(hipsP);
        const siblings = (children.get(byName.get(n)!.parent!) ?? []).filter((s) => !used.has(s)).length;
        if (hangs && r.up < 0.02 && chainLen >= 2 && siblings >= 3) geo = ['skirt', 0.65, 'one of several chains hanging around the hips'];
        else if (r.fwd < -0.02 && r.up < 0.04 && r.side > 0.012 && r.side < 0.12 && chainLen <= 3) geo = ['butt', 0.7, 'behind and below the hips, to one side'];
        else if (r.fwd < -0.03 && r.side < 0.02 && chainLen >= 2) geo = ['tail', 0.6, 'a chain behind the hips, in the middle'];
        else if (r.up < 0.02 && chainLen >= 2 && (children.get(byName.get(n)!.parent!) ?? []).filter((s) => !used.has(s)).length >= 3) geo = ['skirt', 0.6, 'one of several chains around the hips'];
      }
      if (!geo && (parentHuman === 'head' || parentHuman === 'neck') && neckP) {
        const r = from(neckP);
        if (r.up > 0 && r.side > 0.04 && chainLen <= 3 && Math.abs(r.fwd) < 0.05 && (byName.get(n)?.pos?.[1] ?? 0) > (head?.[1] ?? 0)) geo = ['ears', 0.55, 'on top of the head, to the side'];
        else if (r.up > 0) geo = ['hair', 0.65, 'above the neck'];
      }
    }
    const candidates: [RigRole, number, string][] = [];
    if (nameRole) candidates.push([nameRole[0], nameRole[1], `named “${n}”`]);
    if (physRole) candidates.push([physRole, 0.8, 'a PhysBone of that kind']);
    if (geo) candidates.push(geo);
    if (!candidates.length) return { role: null, confidence: 0, why: '' };
    // Agreement raises confidence; the strongest single piece of evidence otherwise wins.
    candidates.sort((a, b) => b[1] - a[1]);
    const best = candidates[0]!;
    const agree = candidates.filter((c) => c[0] === best[0]);
    const conf = Math.min(1, best[1] + 0.1 * (agree.length - 1));
    return { role: best[0], confidence: conf, why: agree.map((c) => c[2]).join('; ') };
  };

  function depth(n: string): number {
    const c = children.get(n) ?? [];
    return 1 + (c.length ? Math.max(...c.map(depth)) : 0);
  }

  // 4. Chains: every bone not in the core belongs to a chain hanging from somewhere.
  const roles: RoleAssignment[] = [];
  const ignore: string[] = [];
  const visit = (n: string, inherited: { role: RigRole; confidence: number; why: string } | null, chain: string[] | null, chainInfo: RoleAssignment | null) => {
    if (used.has(n)) {
      for (const c of children.get(n) ?? []) visit(c, null, null, null);
      return;
    }
    let cls = classify(n, !!inherited);
    // A strong name of its own (a ribbon in the hair) starts a new role; otherwise the chain's role holds.
    if (inherited && !(cls.role && cls.role !== inherited.role && cls.confidence >= 0.7)) cls = { ...inherited, why: inherited.why };
    if (cls.role === 'ignore') {
      ignore.push(n);
      byBone.set(n, { kind: 'ignore', confidence: cls.confidence, why: cls.why });
      for (const c of children.get(n) ?? []) visit(c, null, null, null);
      return;
    }
    if (!cls.role) {
      // Nothing points anywhere: an accessory to review.
      cls = { role: 'accessory', confidence: 0.3, why: 'no evidence: check it' };
    }
    const role = cls.role as RigRole;
    const i = info.get(n)!;
    const p = P(n);
    const side: 'L' | 'R' | 'C' = i.side ?? (p && hipsP ? sideOfX(p[0], hipsP[0]) : null) ?? 'C';
    let entry = chainInfo;
    if (!entry || !chain || entry.role !== role) {
      entry = { role, side, bones: [], confidence: cls.confidence, why: cls.why };
      roles.push(entry);
      chain = entry.bones;
    }
    if (chain.length < 64) chain.push(n);
    byBone.set(n, { kind: cls.confidence < REVIEW_BELOW ? 'review' : 'role', role, confidence: cls.confidence, why: cls.why });
    if (cls.confidence < REVIEW_BELOW) review.push({ bone: n, why: `${role}? ${cls.why}` });
    const kids = children.get(n) ?? [];
    // One child continues the chain; several start chains of their own (hair strands, skirt panels).
    if (kids.length === 1) visit(kids[0]!, { role, confidence: cls.confidence, why: cls.why }, chain, entry);
    else for (const k of kids) visit(k, { role, confidence: cls.confidence, why: cls.why }, null, null);
  };
  for (const b of bones) if (!b.parent || !byName.has(b.parent)) visit(b.name, null, null, null);

  const boneMap = Object.fromEntries(Object.entries(humanoid).map(([k, v]) => [k, v.bone])) as Partial<Record<HumanBone, string>>;
  return {
    humanoid,
    boneMap,
    missing,
    rig: RigMappingSchema.parse({ spine, roles, ignore: ignore.slice(0, 1000), base: base?.id ?? null }),
    review,
    base,
    byBone,
  };
}

/** Accuracy against an expected answer: per role and overall (bones whose role matches). */
export function scoreMapping(result: AutomapResult, expected: Record<string, string>): { overall: number; byRole: Record<string, { right: number; total: number }> } {
  const byRole: Record<string, { right: number; total: number }> = {};
  let right = 0;
  let total = 0;
  for (const [bone, want] of Object.entries(expected)) {
    const got = result.byBone.get(bone);
    const label = got?.kind === 'spine' ? 'spine' : got?.kind === 'ignore' ? 'ignore' : got?.kind === 'humanoid' ? 'humanoid' : String(got?.role ?? 'none');
    const key = want.split('|')[0]!;
    const r = (byRole[key] ??= { right: 0, total: 0 });
    r.total++;
    total++;
    if (want.split('|').includes(label)) {
      r.right++;
      right++;
    }
  }
  return { overall: total ? right / total : 1, byRole };
}

export type { NameInfo };
