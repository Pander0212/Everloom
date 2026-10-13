/**
 * Skeleton families: what kind of body a skeleton is, found from its shape, so characters that
 * aren't human (a pony, a dragon, a snake) import, display and move properly
 * (docs/3d-import/creatures.md).
 *
 * The analysis needs only the bones, their parents and their rest positions (Y up). It finds:
 *   - feet: the ends of chains that reach the ground (several toes of one paw count as one foot);
 *   - legs: the chain above each foot, up to where it joins the body;
 *   - front and hind legs on four-legged bodies (the front ones are nearer the head);
 *   - pelvis, spine, chest, neck and head along the body;
 *   - tails (behind the pelvis, in the middle), wings (to the sides of the chest, off the ground),
 *     arms (to the sides of the chest, with fingers), ears, jaw and eyes (by name, on the head).
 * Names help where they exist ("tail", "wing", "front", Japanese and Chinese words through
 * names.ts) but nothing depends on them: a rig named Bone.001… still works.
 */
import { hasWord, nameInfo } from './names.js';

export const SKELETON_FAMILIES = ['humanoid', 'quadruped', 'wingedQuadruped', 'bipedCreature', 'serpent', 'generic'] as const;
export type SkeletonFamily = (typeof SKELETON_FAMILIES)[number];

export const FAMILY_LABELS: Record<SkeletonFamily, string> = {
  humanoid: 'Humanoid',
  quadruped: 'Four-legged',
  wingedQuadruped: 'Four-legged with wings',
  bipedCreature: 'Two-legged creature or dragon',
  serpent: 'Serpent',
  generic: 'Other (any skeleton)',
};

/** Families whose skeletons can play the humanoid motions (dances, gestures) when their core is mapped. */
export const HUMANOID_MOTION_FAMILIES: ReadonlySet<SkeletonFamily> = new Set(['humanoid', 'bipedCreature']);

type V3 = [number, number, number];
export type LimbSide = 'L' | 'R' | 'C';

export interface Limb {
  side: LimbSide;
  /** From where it leaves the body to its end. */
  bones: string[];
}

export interface SkeletonAnalysis {
  family: SkeletonFamily;
  confidence: number;
  /** Why, in plain words. */
  why: string[];
  root: string | null;
  pelvis: string | null;
  chest: string | null;
  /** Between the pelvis and the chest (or neck), in order. */
  spine: string[];
  neck: string[];
  head: string | null;
  jaw: string | null;
  eyes: string[];
  ears: Limb[];
  frontLegs: Limb[];
  hindLegs: Limb[];
  /** Two-legged bodies: their legs. */
  legs: Limb[];
  arms: Limb[];
  wings: Limb[];
  tails: Limb[];
  extraLimbs: Limb[];
  /** The way the body faces (unit vector in the file's space, Y up), and its size. */
  forward: V3;
  height: number;
  length: number;
  /** Upright (head well above the pelvis) or horizontal (head in front of it). */
  upright: boolean;
}

export interface FamilyBone {
  name: string;
  parent: string | null;
  pos?: V3;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const W = {
  tail: /^(tail|tails|shippo|weiba|kkori)$/,
  wing: /^(wing|wings|feather|feathers|hane|tsubasa|chibang|wingtip|pinion|membrane|patagium|elbow_?wing)$/,
  head: /^(head|kopf|atama|tou|meori|skull|cranium)$/,
  neck: /^(neck|kubi|bozi|mok)$/,
  jaw: /^(jaw|jawbone|mandible|chin|ago|lowerjaw)$/,
  ear: /^(ear|ears|mimi|kemomimi)$/,
  eye: /^(eye|eyes|me|eyeball)$/,
  front: /^(front|fore|forearm|foreleg|frontleg|arm|mae)$/,
  hind: /^(hind|back|rear|thigh|hindleg|backleg|ushiro)$/,
  arm: /^(arm|arms|upperarm|forearm|hand|hands|clavicle|shoulder|ude|te)$/,
  finger: /^(finger|fingers|thumb|index|middle|ring|pinky|little|claw|yubi)$/,
  leg: /^(leg|legs|thigh|calf|shin|knee|foot|feet|toe|toes|hoof|paw|ankle|ashi)$/,
  spine: /^(spine|spine\d*|back|torso|chest|body|pelvis|hips?|waist|root|sebone)$/,
  skip: /^(ik|pole|target|ctrl|control|helper|end|nub|tip|twist|mch|org|wgt|widget)$/,
};

export function analyzeSkeleton(input: FamilyBone[], opts: { humanoidCore?: boolean } = {}): SkeletonAnalysis {
  const bones = input.filter((b) => b.pos);
  const by = new Map(bones.map((b) => [b.name, b]));
  const kids = new Map<string, string[]>();
  for (const b of bones) if (b.parent && by.has(b.parent)) kids.set(b.parent, [...(kids.get(b.parent) ?? []), b.name]);
  const parentOf = (n: string) => {
    const p = by.get(n)?.parent;
    return p && by.has(p) ? p : null;
  };
  const P = (n: string) => by.get(n)!.pos!;
  const info = new Map(bones.map((b) => [b.name, nameInfo(b.name)]));
  const named = (n: string, re: RegExp) => hasWord(info.get(n)!, re);
  const why: string[] = [];

  const empty = (family: SkeletonFamily, reason: string): SkeletonAnalysis => ({ family, confidence: 0.3, why: [reason], root: bones.find((b) => !parentOf(b.name))?.name ?? null, pelvis: null, chest: null, spine: [], neck: [], head: null, jaw: null, eyes: [], ears: [], frontLegs: [], hindLegs: [], legs: [], arms: [], wings: [], tails: [], extraLimbs: [], forward: [0, 0, 1], height: 0, length: 0, upright: true });
  if (bones.length < 2) return empty('generic', bones.length ? 'only one bone' : 'no bone positions');

  const ys = bones.map((b) => b.pos![1]);
  const ground = Math.min(...ys);
  const top = Math.max(...ys);
  const height = Math.max(1e-4, top - ground);
  const xs = bones.map((b) => b.pos![0]);
  const zs = bones.map((b) => b.pos![2]);
  const width = Math.max(...xs) - Math.min(...xs);
  const depthZ = Math.max(...zs) - Math.min(...zs);
  const size = Math.max(height, width, depthZ);
  const centreX = (Math.max(...xs) + Math.min(...xs)) / 2;

  const ancestors = (n: string): string[] => {
    const out: string[] = [];
    const seen = new Set([n]);
    for (let p = parentOf(n); p && !seen.has(p); p = parentOf(p)) {
      seen.add(p);
      out.push(p);
    }
    return out;
  };
  const subtree = (n: string): string[] => {
    const out: string[] = [];
    const todo = [n];
    while (todo.length) {
      const x = todo.pop()!;
      out.push(x);
      todo.push(...(kids.get(x) ?? []));
    }
    return out;
  };
  const lca = (a: string, b: string): string | null => {
    const up = new Set([a, ...ancestors(a)]);
    if (up.has(b)) return b;
    for (const x of ancestors(b)) if (up.has(x)) return x;
    return null;
  };
  const pathDown = (from: string, to: string): string[] => {
    // Bones from `from` (exclusive) down to `to` (inclusive).
    const up = [to, ...ancestors(to)];
    const i = up.indexOf(from);
    return i < 0 ? [to] : up.slice(0, i).reverse();
  };
  const sideOf = (n: string): LimbSide => {
    const s = info.get(n)!.side;
    if (s) return s;
    const dx = P(n)[0] - centreX;
    return Math.abs(dx) < size * 0.02 ? 'C' : dx > 0 ? 'L' : 'R';
  };
  const skip = (n: string) => named(n, W.skip);

  // 1. Feet: ends of chains near the ground (clustered: the toes of one paw are one foot).
  const leaves = bones.filter((b) => !(kids.get(b.name)?.length) && !skip(b.name)).map((b) => b.name);
  const nearGround = (n: string) => P(n)[1] <= ground + Math.max(0.12 * height, 0.02 * size);
  let footTips = leaves.filter(nearGround);
  // A chain can end above its lowest bone (toe helpers): its lowest bone counts.
  for (const b of bones) if (nearGround(b.name) && !footTips.includes(b.name) && (kids.get(b.name) ?? []).every((k) => !nearGround(k) || skip(k))) {
    if (!(kids.get(b.name) ?? []).some((k) => footTips.includes(k))) footTips.push(b.name);
  }
  footTips = [...new Set(footTips)];
  const clusters: string[][] = [];
  for (const f of footTips) {
    const home = clusters.find((c) => c.some((g) => len(sub(P(g), P(f))) < size * 0.09 && (lca(g, f) ? ancestors(g).indexOf(lca(g, f)!) < 4 || lca(g, f) === g : false)));
    if (home) home.push(f);
    else clusters.push([f]);
  }
  const feet = clusters.map((c) => c.reduce((a, b) => lca(a, b) ?? a));

  // 2. Legs: from each foot up to the highest bone that holds no other foot.
  const footSet = new Set(feet);
  const holdsOtherFoot = (n: string, foot: string) => subtree(n).some((x) => footSet.has(x) && x !== foot);
  const limbs: { foot: string; root: string; attach: string | null; bones: string[] }[] = [];
  for (const foot of feet) {
    let root = foot;
    for (let p = parentOf(root); p && !holdsOtherFoot(p, foot); p = parentOf(p)) root = p;
    const attach = parentOf(root);
    // The root of the whole skeleton isn't a leg (a single-footed thing standing on its root).
    if (!attach) continue;
    const bonesOf = [root, ...pathDown(root, foot)].filter((x, i, a) => a.indexOf(x) === i);
    const drop = P(attach)[1] - P(foot)[1];
    const horizontal = Math.hypot(P(foot)[0] - P(attach)[0], P(foot)[2] - P(attach)[2]);
    // A leg goes down more than along; a tail lying on the ground goes along.
    if (drop < horizontal * 0.8 && !named(root, W.leg)) continue;
    if (named(root, W.tail) || named(root, W.wing)) continue;
    limbs.push({ foot, root, attach, bones: bonesOf });
  }

  // 3. Where the body faces: from the hind legs to the front legs, or toward the head.
  const headByName = bones.map((b) => b.name).filter((n) => named(n, W.head) && !skip(n)).sort((a, b) => ancestors(a).length - ancestors(b).length)[0] ?? null;
  const mean = (ns: string[]): V3 => {
    const s: V3 = [0, 0, 0];
    for (const n of ns) for (let i = 0; i < 3; i++) s[i]! += P(n)[i]!;
    return ns.length ? [s[0] / ns.length, s[1] / ns.length, s[2] / ns.length] : [0, 0, 0];
  };
  let forward: V3 = [0, 0, 1];
  const legRoots = limbs.map((l) => l.root);
  const legCentre = mean(legRoots.length ? legRoots : bones.map((b) => b.name));
  if (headByName) {
    const d = sub(P(headByName), legCentre);
    const h = Math.hypot(d[0], d[2]);
    if (h > size * 0.08) forward = [d[0] / h, 0, d[2] / h];
  }
  if (forward[2] === 1 && limbs.length >= 4) {
    // No named head: along the line of the legs, the end with names like "front" (else +Z, glTF's front).
    const along = (n: string) => P(n)[2];
    const sorted = [...limbs].sort((a, b) => along(a.root) - along(b.root));
    const frontish = sorted.slice(-2).some((l) => named(l.root, W.front)) || sorted.slice(0, 2).some((l) => named(l.root, W.hind));
    forward = frontish || !sorted.slice(0, 2).some((l) => named(l.root, W.front)) ? [0, 0, 1] : [0, 0, -1];
  }
  const fwd = (n: string) => dot(sub(P(n), legCentre), forward);

  // 4. Four legs or more: front and hind; two legs: legs.
  const legLimbs = limbs.sort((a, b) => fwd(b.root) - fwd(a.root));
  let frontLegs: Limb[] = [];
  let hindLegs: Limb[] = [];
  let legs: Limb[] = [];
  const extraLimbs: Limb[] = [];
  const asLimb = (l: { bones: string[]; foot: string }): Limb => ({ side: sideOf(l.foot), bones: l.bones });
  if (legLimbs.length >= 4) {
    // Named front/hind legs win; otherwise the two nearest the head are the front.
    const byName = legLimbs.filter((l) => l.bones.some((b) => named(b, W.front)));
    const front = byName.length === 2 ? byName : legLimbs.slice(0, 2);
    const rest = legLimbs.filter((l) => !front.includes(l));
    const hind = rest.slice(-2);
    frontLegs = front.map(asLimb);
    hindLegs = hind.map(asLimb);
    for (const l of rest.slice(0, -2)) extraLimbs.push(asLimb(l));
    why.push(`${legLimbs.length} legs reach the ground`);
  } else if (legLimbs.length >= 1) {
    legs = legLimbs.map(asLimb);
    why.push(`${legLimbs.length} leg${legLimbs.length === 1 ? '' : 's'} reach${legLimbs.length === 1 ? 'es' : ''} the ground`);
  }

  // 5. The body: pelvis where the (hind) legs join, chest where the front legs (or arms) join.
  const attachOf = (ls: Limb[]) => ls.map((l) => parentOf(l.bones[0]!)).filter(Boolean) as string[];
  const lcaAll = (ns: string[]) => ns.reduce<string | null>((a, b) => (a === null ? b : lca(a, b)), null);
  const root = bones.find((b) => !parentOf(b.name))?.name ?? null;
  let pelvis = lcaAll(attachOf(hindLegs.length ? hindLegs : legs));
  let chest = frontLegs.length ? lcaAll(attachOf(frontLegs)) : null;

  // Head: by name, else the end of the body's longest non-limb chain beyond the chest.
  const limbBones = new Set([...frontLegs, ...hindLegs, ...legs, ...extraLimbs].flatMap((l) => l.bones));
  let head = headByName && !limbBones.has(headByName) ? headByName : null;
  if (!head) {
    const from = chest ?? pelvis ?? root;
    if (from) {
      // Follow the child whose subtree reaches furthest forward and up, away from limbs, until it branches widely.
      let cur = from;
      for (let guard = 0; guard < 40; guard++) {
        const next = (kids.get(cur) ?? []).filter((k) => !limbBones.has(k) && !skip(k) && !named(k, W.tail) && !named(k, W.wing));
        if (!next.length) break;
        const score = (k: string) => Math.max(...subtree(k).map((x) => fwd(x) + (P(x)[1] - ground) * 0.5));
        const best = next.sort((a, b) => score(b) - score(a))[0]!;
        if (score(best) <= fwd(cur) + (P(cur)[1] - ground) * 0.5 - size * 0.01) break;
        cur = best;
        if ((kids.get(cur) ?? []).length >= 3 && P(cur)[1] > ground + height * 0.4) break;
      }
      if (cur !== from) head = cur;
    }
  }
  if (pelvis && head && !chest) {
    // Two legs: the chest is where the arms or wings join; else the last trunk bone before the neck.
    const up = pathDown(pelvis, head);
    chest = up.length > 2 ? up[Math.max(0, up.length - 3)]! : pelvis;
  }
  const upright = !!(head && pelvis && P(head)[1] - P(pelvis)[1] > Math.abs(fwd(head) - fwd(pelvis)) * 0.9);

  // Spine and neck.
  let spine: string[] = [];
  let neck: string[] = [];
  if (pelvis && chest && pelvis !== chest) {
    const meet = lca(pelvis, chest);
    spine = meet === pelvis ? pathDown(pelvis, chest) : meet ? pathDown(meet, chest) : [chest];
  }
  if (head && (chest ?? pelvis)) {
    const base = chest ?? pelvis!;
    if (ancestors(head).includes(base)) neck = pathDown(base, head).slice(0, -1);
  }
  if (!pelvis && root) pelvis = root;

  // 6. Chains off the body: tails, wings, arms; on the head: jaw, ears, eyes.
  const trunk = new Set([pelvis, chest, head, ...spine, ...neck].filter(Boolean) as string[]);
  const tails: Limb[] = [];
  const wings: Limb[] = [];
  const arms: Limb[] = [];
  const ears: Limb[] = [];
  const eyes: string[] = [];
  let jaw: string | null = null;
  const chainFrom = (start: string): string[] => {
    const out = [start];
    let cur = start;
    while ((kids.get(cur) ?? []).length) {
      const ks = (kids.get(cur) ?? []).filter((k) => !skip(k));
      if (!ks.length) break;
      cur = ks.sort((a, b) => subtree(b).length - subtree(a).length)[0]!;
      out.push(cur);
      if (out.length > 64) break;
    }
    return out;
  };
  const headSet = new Set(head ? subtree(head) : []);
  // Named wings and tails start anywhere (wings often hang from the shoulder); a typo or a prefix
  // doesn't hide them ("c_Wilngs_01", "TailBase").
  const loose = (n: string, words: string[]) => words.some((w) => n.toLowerCase().replace(/[^a-z]/g, '').includes(w));
  const WING_WORDS = ['wing', 'wilng', 'feather', 'tsubasa', 'pinion'];
  const TAIL_WORDS = ['tail', 'shippo'];
  const claimed = new Set<string>();
  for (const b of bones) {
    const n = b.name;
    const p = parentOf(n);
    if (!p || skip(n) || claimed.has(n) || headSet.has(n)) continue;
    const isWing = loose(n, WING_WORDS) && !loose(p, WING_WORDS);
    const isTail = loose(n, TAIL_WORDS) && !loose(p, TAIL_WORDS) && !isWing;
    if (!isWing && !isTail) continue;
    const chain = chainFrom(n);
    for (const x of subtree(n)) claimed.add(x);
    if (isWing) wings.push({ side: sideOf(chain.at(-1)!), bones: chain });
    else tails.push({ side: 'C', bones: chain });
  }
  for (const b of bones) {
    const n = b.name;
    const p = parentOf(n);
    if (!p || limbBones.has(n) || trunk.has(n) || skip(n) || claimed.has(n)) continue;
    // With a humanoid core, chains off the body are hair, skirts and capes unless named otherwise.
    if (opts.humanoidCore) continue;
    // Only chain starts: the parent is on the body (or an ancestor of the body).
    if (!trunk.has(p) && !(root && p === root)) continue;
    const chain = chainFrom(n);
    const end = chain.at(-1)!;
    const reach = sub(P(end), P(n));
    const sideways = Math.abs(P(end)[0] - centreX) - Math.abs(P(n)[0] - centreX);
    if (headSet.has(n)) continue;
    const isTail = named(n, W.tail) || (!upright || legLimbs.length !== 2 ? dot(reach, forward) < -size * 0.08 && Math.abs(P(n)[0] - centreX) < size * 0.05 && chain.length >= 2 : dot(reach, forward) < -size * 0.05 && P(n)[1] < (head ? P(head)[1] : top) * 0.8 && Math.abs(P(n)[0] - centreX) < size * 0.05 && chain.length >= 3);
    if (isTail) {
      tails.push({ side: 'C', bones: chain });
      continue;
    }
    const fingers = subtree(n).filter((x) => named(x, W.finger)).length;
    const branching = Math.max(0, ...subtree(n).map((x) => (kids.get(x) ?? []).length));
    if (named(n, W.wing) || chain.some((x) => named(x, W.wing))) {
      wings.push({ side: sideOf(end), bones: chain });
      continue;
    }
    if (sideways > size * 0.08) {
      const armLike = named(n, W.arm) || chain.some((x) => named(x, W.arm)) || fingers >= 3 || (branching >= 4 && branching <= 6 && chain.length <= 6);
      if (armLike && !(opts.humanoidCore === false && sideways > size * 0.45)) arms.push({ side: sideOf(end), bones: chain });
      else wings.push({ side: sideOf(end), bones: chain });
    }
  }
  if (head) {
    for (const n of subtree(head)) {
      if (n === head || skip(n)) continue;
      if (!jaw && named(n, W.jaw)) jaw = n;
      else if (named(n, W.ear) && named(parentOf(n) ?? '', W.ear) === false) ears.push({ side: sideOf(n), bones: chainFrom(n) });
      else if (named(n, W.eye) && !/lid|brow|lash|lash|track|target/i.test(n)) eyes.push(n);
    }
  }

  // 7. The family.
  const longest = Math.max(0, ...bones.map((b) => ancestors(b.name).length + 1));
  let family: SkeletonFamily;
  let confidence = 0.75;
  if (opts.humanoidCore && legLimbs.length <= 2) {
    family = wings.length ? 'bipedCreature' : 'humanoid';
    why.push(wings.length ? 'a humanoid core with wings' : 'a humanoid core (hips, spine, arms, legs)');
    confidence = 0.9;
  } else if (legLimbs.length >= 4) {
    family = wings.length ? 'wingedQuadruped' : 'quadruped';
    if (wings.length) why.push(`${wings.length} wing chain${wings.length === 1 ? '' : 's'}`);
    confidence = legLimbs.length === 4 ? 0.85 : 0.65;
  } else if (legLimbs.length === 2 || legLimbs.length === 3) {
    if (upright && arms.length >= 2 && !wings.length) {
      family = 'humanoid';
      why.push('upright, with two arms');
    } else {
      family = 'bipedCreature';
      why.push(wings.length ? 'two legs and wings' : upright ? 'two legs, no human arms' : 'two legs, body held level');
    }
  } else if (legLimbs.length === 0 && longest >= 8 && (depthZ > height * 1.5 || width > height * 1.5)) {
    family = 'serpent';
    why.push(`no legs; one long chain of ${longest} bones`);
    confidence = 0.7;
  } else {
    family = 'generic';
    why.push(legLimbs.length === 1 ? 'one leg' : 'no legs on the ground');
    confidence = 0.5;
  }
  if (tails.length) why.push(`${tails.length} tail${tails.length === 1 ? '' : 's'}`);
  if (family === 'serpent' && !spine.length) {
    // The body is the long chain itself.
    const deepest = bones.map((b) => b.name).sort((a, b) => ancestors(b).length - ancestors(a).length)[0]!;
    const chain = [...ancestors(deepest).reverse(), deepest];
    spine = chain.slice(1, -2);
    head = head ?? chain.at(-1) ?? null;
  }
  return { family, confidence, why, root, pelvis, chest, spine, neck, head, jaw, eyes, ears, frontLegs, hindLegs, legs, arms, wings, tails, extraLimbs, forward, height, length: Math.max(width, depthZ), upright };
}
