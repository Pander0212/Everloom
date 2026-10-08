/**
 * Paired and group animations on a stage: every participant plays its role's clip on one shared
 * clock, stands where the clip says relative to the others (scaled to their heights), and the bones
 * that meet (hands in a handshake) are pulled together with two-bone inverse kinematics, so a tall
 * and a short character still shake hands. When a one-shot ends everyone goes back to what they
 * were doing.
 */
import * as THREE from 'three';
import { PairedClipSchema, type HumanBone, type PairedClip } from '@everloom/engine';
import { registerClip } from './clips';
import { solveTwoBone } from './ik';
import type { Avatar } from './avatar';
import type { Stage3D } from './stage';

const files = new Map<string, Promise<PairedClip | null>>();

/** A paired clip by id: built-in files first, then the owner's imported ones. */
export function getPaired(id: string): Promise<PairedClip | null> {
  let p = files.get(id);
  if (!p) {
    p = fetch(`/avatar/clips/paired/${encodeURIComponent(id)}.json`)
      .then((res) => (res.ok ? res : fetch(`/api/avatar-paired/${encodeURIComponent(id)}`, { credentials: 'same-origin' })))
      .then((res) => (res.ok ? res.json() : null))
      .then((j) => { const r = j ? PairedClipSchema.safeParse(j) : null; return r?.success ? r.data : null; })
      .catch(() => null);
    files.set(id, p);
  }
  return p;
}

/** Hands and feet, and the two bones above them that bend to reach. */
const CHAIN: Partial<Record<HumanBone, [HumanBone, HumanBone]>> = {
  leftHand: ['leftUpperArm', 'leftLowerArm'],
  rightHand: ['rightUpperArm', 'rightLowerArm'],
  leftFoot: ['leftUpperLeg', 'leftLowerLeg'],
  rightFoot: ['rightUpperLeg', 'rightLowerLeg'],
};

/** Torso bones a rig may not have, and the nearest one to use instead. */
const TORSO_FALLBACK: Partial<Record<HumanBone, HumanBone>> = { upperChest: 'chest', chest: 'spine', spine: 'hips', neck: 'upperChest' };

/** The rig's bone for a contact, or the nearest torso bone it has. */
function boneOf(av: Avatar, bone: HumanBone): THREE.Object3D | undefined {
  for (let b: HumanBone | undefined = bone; b; b = TORSO_FALLBACK[b]) if (av.rig.bones[b]) return av.rig.bones[b];
  return undefined;
}

/** Where a limb starts (shoulder or hip) and how far it reaches when straight. */
function reachOf(av: Avatar, bone: HumanBone): { at: THREE.Vector3; length: number } | null {
  const chain = CHAIN[bone], root = chain && av.rig.bones[chain[0]], joint = chain && av.rig.bones[chain[1]], end = av.rig.bones[bone];
  if (!root || !joint || !end) return null;
  const a = root.getWorldPosition(new THREE.Vector3()), b = joint.getWorldPosition(new THREE.Vector3());
  return { at: a, length: a.distanceTo(b) + b.distanceTo(end.getWorldPosition(new THREE.Vector3())) };
}

/** How much a contact pulls at clip time t: eases in over 0.3 s from `from`, out by `to`. */
export function contactWeight(t: number, from: number, to: number, ease = 0.3): number {
  if (t < from - ease || t > to + ease) return 0;
  const k = t < from ? 1 - (from - t) / ease : t > to ? 1 - (t - to) / ease : 1;
  const x = Math.max(0, Math.min(1, k));
  return x * x * (3 - 2 * x);
}

/** Where each participant stands: the clip's offsets (at 1.7 m) scaled to the group's height, around the middle. */
export function placements(clip: Pick<PairedClip, 'roles'>, heights: number[], centerX: number): Array<{ x: number; z: number; yaw: number }> {
  const scale = heights.reduce((a, b) => a + b, 0) / Math.max(1, heights.length) / 1.7;
  const mid = clip.roles.reduce((a, r) => a + r.offset[0], 0) / clip.roles.length;
  return clip.roles.map((r) => ({ x: centerX + (r.offset[0] - mid) * scale, z: r.offset[1] * scale, yaw: (r.yaw * Math.PI) / 180 }));
}

interface Running {
  clip: PairedClip;
  ids: string[];
  avatars: Avatar[];
  /** What each was doing before, to go back to. */
  before: string[];
  time: number;
  started: boolean;
  /** Where each stands, and how much closer they've moved so hands can meet (long or short arms). */
  spots: Array<{ x: number; z: number; yaw: number }>;
  center: number;
  squeeze: number;
  /** Seconds spent stepping into place. */
  approach: number;
}

export class PairedDirector {
  private run: Running | null = null;
  private ticket = 0;
  /** Holds the shared clock at a moment (checks and screenshots); null runs normally. */
  freezeAt: number | null = null;
  /** The widest gap between bones that should meet, last frame (metres; checks read it). */
  contactGap = 0;
  /** How far apart the shoulders are beyond what the arms can reach, last frame. */
  private deficit = 0;
  /** Called when a one-shot finishes (the stage layer forgets its cue). */
  onEnd: ((clip: string) => void) | null = null;
  private ik = (dt: number) => this.solveContacts(dt);

  constructor(private readonly stage: Stage3D) {
    stage.pairs = (dt) => this.tick(dt);
    stage.tickers.add(this.ik);
  }

  /** Participants of the running clip (their held pose belongs to it until it ends). */
  has(id: string) {
    return !!this.run?.ids.includes(id);
  }

  get playing() {
    return this.run?.clip.id ?? null;
  }

  async play(clipId: string, ids: string[]): Promise<boolean> {
    const ticket = ++this.ticket;
    const clip = await getPaired(clipId);
    if (!clip || ticket !== this.ticket) return false;
    const avatars = ids.slice(0, clip.roles.length).map((id) => this.stage.get(id));
    if (avatars.length < clip.roles.length || avatars.some((a) => !a)) return false;
    this.stop(false);
    const list = avatars as Avatar[];
    clip.roles.forEach((r, i) => registerClip(`paired_${clip.id}_${i}`, r.clip));
    const before = list.map((a) => (a.basePoseId.startsWith('paired_') ? 'idle' : a.basePoseId));
    // Line up around the middle of where they stand now.
    const xs = ids.map((id) => this.stage.slotX(id) ?? 0);
    const center = xs.reduce((a, b) => a + b, 0) / xs.length;
    const spots = placements(clip, list.map((a) => a.height), center);
    // Claimed before the clips load, so nothing else changes their pose meanwhile.
    const run: Running = { clip, ids: ids.slice(0, clip.roles.length), avatars: list, before, time: 0, started: false, spots, center, squeeze: 0, approach: 0 };
    this.run = run;
    this.deficit = 0;
    this.pinAll(run);
    await Promise.all(list.map((a, i) => a.setBase(`paired_${clip.id}_${i}`, 0.35)));
    if (ticket !== this.ticket || this.run !== run) return false;
    run.started = true;
    this.stage.kick();
    return true;
  }

  /** Everyone at their spot, drawn together by the squeeze; each looks at the first (the first at the second). */
  private pinAll(r: Running) {
    r.ids.forEach((id, i) => {
      const s = r.spots[i]!, side = Math.sign(s.x - r.center);
      this.stage.pin(id, { ...s, x: s.x - (side * r.squeeze) / 2, face: r.ids[i === 0 ? 1 : 0] });
    });
  }

  /** Ends the running clip; `restore` puts everyone back in their own pose. */
  stop(restore = true) {
    const r = this.run;
    if (!r) return;
    this.run = null;
    for (const id of r.ids) this.stage.pin(id, null);
    if (restore) r.avatars.forEach((a, i) => { if (a.basePoseId.startsWith('paired_')) void a.setBase(r.before[i]!, 0.5); });
  }

  private duration(r: Running) {
    return Math.max(...r.clip.roles.map((x) => (x.clip.loop ? x.clip.frames : Math.max(1, x.clip.frames - 1)) / x.clip.fps));
  }

  private tick(dt: number) {
    const r = this.run;
    if (!r) return;
    // A participant left the stage: the clip can't go on.
    if (r.ids.some((id, i) => this.stage.get(id) !== r.avatars[i])) { this.stop(false); return; }
    if (!r.started) return;
    // They step into place first (at most 1.5 s), then the clip starts.
    const placed = r.avatars.every((a, i) => {
      const s = r.spots[i]!, x = s.x - (Math.sign(s.x - r.center) * r.squeeze) / 2;
      return Math.hypot(a.group.position.x - x, a.group.position.z - s.z) < 0.03 && Math.abs(a.group.rotation.y - s.yaw) < 0.2;
    });
    r.approach += dt;
    if (r.time === 0 && !placed && r.approach < 1.5 && this.freezeAt === null) return;
    r.time = this.freezeAt ?? r.time + dt;
    const d = this.duration(r);
    if (!r.clip.loop && r.time >= d) {
      const id = r.clip.id;
      this.stop();
      this.onEnd?.(id);
      return;
    }
    // Arms too short for the spacing: step closer (never more than a third of their height).
    // (Measured only once they've arrived, or the walk over would count as distance.)
    const arrived = r.avatars.every((a, i) => Math.abs(a.group.position.x - (r.spots[i]!.x - (Math.sign(r.spots[i]!.x - r.center) * r.squeeze) / 2)) < 0.01);
    if (arrived && this.deficit > 0.005) {
      const h = r.avatars.reduce((s, a) => s + a.height, 0) / r.avatars.length;
      // Never into each other: bodies keep about a chest's depth apart.
      const xs = r.spots.map((s) => s.x).sort((p, q) => p - q);
      const closest = Math.min(...xs.slice(1).map((x, i) => x - xs[i]!));
      r.squeeze = Math.max(r.squeeze, Math.min(h / 3, closest - 0.17 * h, r.squeeze + this.deficit * Math.min(1, dt * 4)));
      this.pinAll(r);
    }
    // One clock: every role's clip at the same moment.
    r.avatars.forEach((a, i) => { if (a.basePoseId === `paired_${r.clip.id}_${i}`) a.baseTime = r.clip.loop ? r.time % d : r.time; });
  }

  private solveContacts(_dt: number) {
    const r = this.run;
    if (!r || !r.started || !r.clip.contacts.length) return;
    const t = r.clip.loop ? r.time % this.duration(r) : r.time;
    const pa = new THREE.Vector3(), pb = new THREE.Vector3(), mid = new THREE.Vector3();
    this.contactGap = 0;
    this.deficit = 0;
    for (const c of r.clip.contacts) {
      const A = r.avatars[c.a.role], B = r.avatars[c.b.role];
      const ea = A && boneOf(A, c.a.bone), eb = B && boneOf(B, c.b.bone);
      if (!A || !B || !ea || !eb) continue;
      // Shortly before and during a contact: can the two limbs reach each other from where they stand?
      if ((r.clip.loop && c.from <= 0) || (t > c.from - 0.8 && t < c.to)) {
        const ra = reachOf(A, c.a.bone), rb = reachOf(B, c.b.bone);
        // Arms meet with the elbows still bent (80% of full reach), wrists a palm apart.
        if (ra && rb) this.deficit = Math.max(this.deficit, ra.at.distanceTo(rb.at) - (ra.length + rb.length) * 0.8 - 0.05 * (A.height + B.height) / 2);
      }
      const w = r.clip.loop && c.from <= 0 ? 1 : contactWeight(t, c.from, c.to);
      if (w <= 0) continue;
      ea.getWorldPosition(pa);
      eb.getWorldPosition(pb);
      // A hand on a body (a hug): it goes round to the other's back, on its own side, and only the arm moves.
      const limbA = !!CHAIN[c.a.bone], limbB = !!CHAIN[c.b.bone];
      if (limbA !== limbB) {
        const [hand, handBone, body, hp, bp] = limbA ? [A, c.a.bone, B, pa, pb] as const : [B, c.b.bone, A, pb, pa] as const;
        const q = body.group.getWorldQuaternion(new THREE.Quaternion());
        const back = new THREE.Vector3(0, 0, -1).applyQuaternion(q), right = new THREE.Vector3(-1, 0, 0).applyQuaternion(q);
        // The side the arm comes from (its shoulder, not where the hand happens to be this frame).
        const s = reachOf(hand, handBone);
        const side = Math.sign((s?.at ?? hp).clone().sub(bp).dot(right)) || 1;
        const target = bp.clone().addScaledVector(back, 0.04 * body.height).addScaledVector(right, side * 0.12 * body.height);
        const far = s ? target.distanceTo(s.at) : 0;
        // Short arms: the pair steps a little closer (see tick), and meanwhile the hand gets as far as it can.
        if (s) this.deficit = Math.max(this.deficit, far - s.length * 0.95);
        if (s && far > s.length * 0.97) target.sub(s.at).multiplyScalar((s.length * 0.97) / far).add(s.at);
        const chain = CHAIN[handBone]!, root = hand.rig.bones[chain[0]], joint = hand.rig.bones[chain[1]], end = hand.rig.bones[handBone];
        // Elbows out to the side and a little down, so the arm goes round the body rather than through it.
        const pole = s ? s.at.clone().addScaledVector(right, side * 0.25 * body.height).add(new THREE.Vector3(0, -0.1 * body.height, 0)) : undefined;
        if (root && joint && end) solveTwoBone(root, joint, end, target, w, pole);
        continue;
      }
      mid.copy(pa).add(pb).multiplyScalar(0.5);
      // Halfway between the hands, pulled to where both arms can actually reach (the two reach spheres meet).
      const spheres = [reachOf(A, c.a.bone), reachOf(B, c.b.bone)].filter((x): x is NonNullable<typeof x> => !!x);
      for (let k = 0; k < 8; k++) for (const s of spheres) {
        const d = mid.distanceTo(s.at), max = s.length * 0.97;
        if (d > max) mid.sub(s.at).multiplyScalar(max / d).add(s.at);
      }
      // Wrists stop a palm's width apart (hand bones sit at the wrist), each on its own side.
      const gap = 0.025 * (A.height + B.height) / 2;
      const along = pb.clone().sub(pa);
      if (along.lengthSq() < 1e-10) along.set(1, 0, 0);
      along.normalize().multiplyScalar(gap);
      for (const [av, bone, target] of [[A, c.a.bone, mid.clone().sub(along)], [B, c.b.bone, mid.clone().add(along)]] as const) {
        const chain = CHAIN[bone];
        const root = chain && av.rig.bones[chain[0]], joint = chain && av.rig.bones[chain[1]], end = av.rig.bones[bone];
        if (root && joint && end) solveTwoBone(root, joint, end, target, w);
      }
      this.contactGap = Math.max(this.contactGap, ea.getWorldPosition(pa).distanceTo(eb.getWorldPosition(pb)));
    }
  }

  dispose() {
    this.stop(false);
    this.stage.tickers.delete(this.ik);
    if (this.stage.pairs) this.stage.pairs = null;
  }
}
