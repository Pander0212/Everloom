/**
 * Motion for bodies that aren't human (docs/3d-import/creatures.md): a pony, a dragon, a snake, or
 * any skeleton. Built from the bone roles the auto-mapper found (pelvis, spine, neck, head, jaw,
 * legs front and hind, wings, tails, ears, eyes), never from a humanoid map.
 *
 * Every frame, in this order:
 *   1. the driven bones go back to their rest pose;
 *   2. the character's own clip (from its file), when one plays;
 *   3. a held pose (sit, lie down, sleep, prance) and a one-shot emote (nod, wag tail, flap wings,
 *      hop, rear up, roar…), each faded in and out;
 *   4. life: breathing, a slow sway, the head turning toward the camera or whoever speaks, the tail
 *      swaying, the wings settling, the ears twitching, and the jaw moving with the voice.
 *
 * Rotations are given in the body's own frame (forward, up, right, measured at rest), so "nod"
 * means the same on every rig whatever its bones' axes are.
 *
 * On humanoid bodies with a tail or wings, the same class runs as an overlay: the humanoid motion
 * stays, and only the tail and wing emotes and the file's own clips come from here.
 */
import { CREATURE_SHARED, emotesForBody, installedEmotes, type BodyParts, type RigMapping, type SkeletonFamily } from '@everloom/engine';
import * as THREE from 'three';
import type { LoadedModel } from './loader';

type Bone = THREE.Object3D;
interface Side { side: number; bones: Bone[] }

const DEG = Math.PI / 180;
const smooth = (x: number) => x * x * (3 - 2 * x);
const damp = (cur: number, target: number, rate: number, dt: number) => target + (cur - target) * Math.exp(-rate * dt);
/** 0 → 1 → 0 over a clip of `dur` seconds with `fade` seconds at each end. */
const envelope = (t: number, dur: number, fade = 0.25) => (t < fade ? smooth(t / fade) : t > dur - fade ? smooth(Math.max(0, (dur - t) / fade)) : 1);

/** Built-in creature emotes: how long they last (loops: 0) and what they need. */
const SHOTS: Record<string, number> = { nod: 1.3, shake_head: 1.5, tilt_head: 1.8, droop: 2.4, bow: 2.2, wag_tail: 2.6, flap_wings: 2.2, hop: 1.4, rear_up: 2.0, roar: 1.8 };
const HOLDS = new Set(['sit', 'lie_down', 'sleep', 'prance', 'idle']);

export interface CreatureContext {
  /** World point to look at, or null for straight ahead. */
  lookAt: THREE.Vector3 | null;
  /** How open the mouth is from the voice, 0–1. */
  mouth: number;
  speaking: boolean;
}

export class CreatureMotion {
  readonly family: SkeletonFamily;
  /** Runs the whole body (not a humanoid overlay). */
  readonly full: boolean;
  readonly parts: {
    root: Bone | null; pelvis: Bone | null; spine: Bone[]; neck: Bone[]; head: Bone | null; jaw: Bone | null;
    ears: Side[]; tails: Bone[][]; wings: Side[]; front: Side[]; hind: Side[]; legs: Side[]; arms: Side[];
  };
  /** The emotes this body can do (ids), for the picker and for translating the story's. */
  readonly fits: Set<string>;
  readonly body: BodyParts;

  private readonly scene: THREE.Object3D;
  private rest = new Map<Bone, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  /** Each driven bone's rest orientation and position relative to the model's root. */
  private restQ = new Map<Bone, THREE.Quaternion>();
  private restPos = new Map<Bone, THREE.Vector3>();
  private parentRest = new Map<Bone, THREE.Matrix4>();
  private delta = new Map<Bone, THREE.Quaternion>();
  private shift = new Map<Bone, THREE.Vector3>();
  private fwd = new THREE.Vector3(0, 0, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private right = new THREE.Vector3(1, 0, 0);
  private centre = new THREE.Vector3();
  private size = 1;

  private clock = Math.random() * 50;
  private mixer: THREE.AnimationMixer | null = null;
  private clips: THREE.AnimationClip[];
  private action: THREE.AnimationAction | null = null;
  private shot: { id: string; t: number; dur: number } | null = null;
  private base = { id: 'idle', w: 1 };
  private leaving: { id: string; w: number } | null = null;
  private look = new THREE.Vector2();
  private jawNow = 0;
  private earTwitch = { at: 3 + Math.random() * 4, t: -1, ear: 0 };
  /** True while an emote, a clip or a held pose is going (the stage renders faster). */
  busy = false;

  constructor(model: LoadedModel, rig: RigMapping | undefined, opts: { full: boolean; humanoidCore: boolean }) {
    this.family = rig?.family ?? 'generic';
    this.full = opts.full;
    this.scene = model.scene;
    const byName = new Map<string, Bone>();
    model.scene.traverse((o) => { if (!byName.has(o.name)) byName.set(o.name, o); });
    const find = (n: string | undefined) => (n ? byName.get(n) ?? byName.get(THREE.PropertyBinding.sanitizeNodeName(n)) ?? null : null);
    const roles = rig?.roles ?? [];
    const chains = (role: string) => roles.filter((r) => r.role === role).map((r) => ({ side: r.side, bones: r.bones.map(find).filter((b): b is Bone => !!b) })).filter((c) => c.bones.length);
    const one = (role: string) => chains(role)[0]?.bones[0] ?? null;
    // Several chains per wing (feathers): the first chain of each side drives it; the rest follow.
    const firstPerSide = (list: { side: string; bones: Bone[] }[]) => {
      const seen = new Set<string>();
      return list.filter((c) => (seen.has(c.side) ? false : (seen.add(c.side), true)));
    };
    const spine = (rig?.spine ?? []).map(find).filter((b): b is Bone => !!b);
    const neck = chains('neck')[0]?.bones ?? (model.bones.neck ? [model.bones.neck] : []);
    const head = one('head') ?? model.bones.head ?? null;
    this.clips = model.gltf?.animations ?? [];

    model.scene.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(model.scene.matrixWorld).invert();
    const local = (b: Bone) => new THREE.Matrix4().multiplyMatrices(inv, b.matrixWorld);
    const posOf = (b: Bone) => new THREE.Vector3().setFromMatrixPosition(local(b));
    // The body's frame: forward from the pelvis toward the head (level), else the model's +Z.
    const pelvis = one('pelvis') ?? model.bones.hips ?? null;
    if (head && pelvis) {
      const d = posOf(head).sub(posOf(pelvis)).setY(0);
      if (d.length() > 0.08 * Math.max(0.1, model.rawHeight * model.scale)) this.fwd.copy(d.normalize());
    }
    this.right.crossVectors(this.up, this.fwd).normalize();
    const box = new THREE.Box3().setFromObject(model.scene).applyMatrix4(inv);
    box.getCenter(this.centre);
    this.size = Math.max(1e-3, box.getSize(new THREE.Vector3()).length() / 1.7);
    const sideOf = (c: { side: string; bones: Bone[] }): Side => {
      // Which way a part's own side is, measured (names can lie or be missing).
      const end = c.bones.at(-1)!;
      const s = Math.sign(posOf(end).sub(this.centre).dot(this.right));
      return { side: s || (c.side === 'L' ? 1 : c.side === 'R' ? -1 : 0), bones: c.bones };
    };
    this.parts = {
      root: one('root'), pelvis, spine, neck, head, jaw: one('jaw') ?? model.bones.jaw ?? null,
      ears: chains('ears').map(sideOf),
      tails: chains('tail').map((c) => c.bones),
      wings: firstPerSide(chains('wings')).map(sideOf),
      front: chains('frontLeg').map(sideOf),
      hind: chains('hindLeg').map(sideOf),
      legs: [...chains('leg'), ...(opts.humanoidCore ? [] : chains('arm'))].map(sideOf),
      arms: chains('arm').map(sideOf),
    };
    const p = this.parts;
    const driven = new Set<Bone>([p.root, p.pelvis, ...p.spine, ...p.neck, p.head, p.jaw, ...p.ears.flatMap((e) => e.bones), ...p.tails.flat(), ...p.wings.flatMap((w) => w.bones), ...p.front.flatMap((l) => l.bones), ...p.hind.flatMap((l) => l.bones), ...p.legs.flatMap((l) => l.bones)].filter((b): b is Bone => !!b));
    if (!this.full) {
      // An overlay moves only what the humanoid motion doesn't: tails and wings.
      for (const b of [...driven]) if (!p.tails.flat().includes(b) && !p.wings.some((w) => w.bones.includes(b))) driven.delete(b);
    }
    for (const b of driven) {
      this.rest.set(b, { q: b.quaternion.clone(), p: b.position.clone() });
      const m = local(b);
      this.restQ.set(b, new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(m)));
      this.restPos.set(b, new THREE.Vector3().setFromMatrixPosition(m));
      this.parentRest.set(b, b.parent ? local(b.parent) : new THREE.Matrix4());
    }

    const legsAny = p.front.length + p.hind.length + p.legs.length > 0;
    this.body = { humanoid: !this.full, head: !!p.head, jaw: !!p.jaw, tail: p.tails.length > 0, wings: p.wings.length > 0, legs: legsAny, fourLegs: p.front.length > 0 && p.hind.length > 0, clips: this.clips.map((c) => c.name || 'Clip') };
    this.fits = new Set(emotesForBody(installedEmotes(), this.body).map((e) => e.id));
    // Serpents and legless bodies rear up with the front of the body.
    if (!legsAny && p.spine.length >= 3) this.fits.add('rear_up');
    if (this.clips.length) this.mixer = new THREE.AnimationMixer(model.scene);
  }

  /** The file's own clips (own_1 is the first). */
  get ownClips() {
    return this.body.clips;
  }

  // ------------------------------------------------------------------ requests

  /** A held pose: sit, lie down, sleep, prance, or idle. */
  setBase(id: string) {
    const next = HOLDS.has(id) ? id : 'idle';
    if (next === this.base.id) return;
    this.leaving = { id: this.base.id, w: this.base.w };
    this.base = { id: next, w: 0 };
  }

  get baseId() {
    return this.base.id;
  }

  /** A one-shot emote this body does; false when it can't. */
  emote(id: string): boolean {
    if (id.startsWith('own_')) return this.playOwn(Number(id.slice(4)) - 1);
    if (HOLDS.has(id)) {
      this.setBase(id);
      return true;
    }
    const dur = SHOTS[id];
    if (!dur || !this.fits.has(id)) return false;
    this.shot = { id, t: 0, dur };
    return true;
  }

  /** Plays the file's own clip number `n` (from 0); loops if its name says so. */
  playOwn(n: number): boolean {
    const clip = this.clips[n];
    if (!clip || !this.mixer) return false;
    const next = this.mixer.clipAction(clip);
    const loop = /idle|loop|walk|run|cycle|breath/i.test(clip.name);
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = false;
    if (this.action && this.action !== next) {
      next.crossFadeFrom(this.action, 0.3, false);
    } else next.fadeIn(0.3);
    next.play();
    this.action = next;
    return true;
  }

  /** True while the file's own clip plays (an overlay hands the whole body to it). */
  get clipPlaying() {
    return !!this.action && this.action.isRunning();
  }

  stopClip() {
    this.action?.fadeOut(0.3);
    this.action = null;
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number, ctx: CreatureContext) {
    this.clock += dt;
    const t = this.clock;
    // 1. rest
    for (const [b, r] of this.rest) {
      b.quaternion.copy(r.q);
      b.position.copy(r.p);
    }
    this.delta.clear();
    this.shift.clear();
    // 2. own clip
    if (this.mixer) {
      this.mixer.update(dt);
      if (this.action && !this.action.isRunning() && this.action.loop === THREE.LoopOnce) this.action = null;
    }
    const clip = this.action ? 0.35 : 1;
    // 3. held pose and one-shot
    this.base.w = Math.min(1, this.base.w + dt / 0.6);
    if (this.leaving) {
      this.leaving.w -= dt / 0.6;
      if (this.leaving.w <= 0) this.leaving = null;
      else this.hold(this.leaving.id, this.leaving.w, t);
    }
    this.hold(this.base.id, this.base.w, t);
    let shotW = 0;
    if (this.shot) {
      const s = this.shot;
      s.t += dt;
      shotW = envelope(s.t, s.dur);
      this.play(s.id, s.t, s.dur, shotW);
      if (s.t >= s.dur) this.shot = null;
    }
    // 4. life
    if (this.full) this.life(dt, t, ctx, clip * (1 - 0.6 * shotW));
    this.idleTail(t, clip * (1 - shotW * (this.shot?.id === 'wag_tail' ? 1 : 0.5)));
    this.idleWings(t, clip * (1 - shotW * (this.shot?.id === 'flap_wings' ? 1 : 0.3)));
    this.apply();
    this.busy = !!this.shot || !!this.action || this.base.id !== 'idle' || !!this.leaving;
  }

  // ------------------------------------------------------------------ building blocks

  /** Rotates a bone by `deg` around an axis of the body's frame (accumulates). */
  private turn(b: Bone | null | undefined, axis: THREE.Vector3, deg: number) {
    if (!b || !this.restQ.has(b) || !deg) return;
    const q = new THREE.Quaternion().setFromAxisAngle(axis, deg * DEG);
    const d = this.delta.get(b);
    if (d) d.premultiply(q);
    else this.delta.set(b, q);
  }
  /** Moves a bone along a body-frame vector (metres in the model's space). */
  private move(b: Bone | null | undefined, v: THREE.Vector3) {
    if (!b || !this.restQ.has(b)) return;
    const s = this.shift.get(b);
    if (s) s.add(v);
    else this.shift.set(b, v.clone());
  }
  private pitch(b: Bone | null | undefined, deg: number) { this.turn(b, this.right, deg); }
  private yaw(b: Bone | null | undefined, deg: number) { this.turn(b, this.up, deg); }
  private roll(b: Bone | null | undefined, deg: number) { this.turn(b, this.fwd, deg); }

  private apply() {
    for (const [b, d] of this.delta) {
      const r = this.restQ.get(b)!;
      // A rotation in the model's frame, expressed in the bone's own (rest) frame.
      const local = r.clone().invert().multiply(d).multiply(r);
      b.quaternion.multiply(local);
    }
    for (const [b, v] of this.shift) {
      const parent = this.parentRest.get(b)!;
      const m = new THREE.Matrix3().setFromMatrix4(parent).invert();
      b.position.add(v.clone().applyMatrix3(m));
    }
  }

  /** The whole head, spread over the neck (40%) and the head (60%). */
  private headTurn(axis: 'pitch' | 'yaw' | 'roll', deg: number) {
    const f = axis === 'pitch' ? this.pitch.bind(this) : axis === 'yaw' ? this.yaw.bind(this) : this.roll.bind(this);
    const n = this.parts.neck.length;
    for (const b of this.parts.neck) f(b, (deg * 0.4) / n);
    f(this.parts.head, n ? deg * 0.6 : deg);
  }

  private legs(): Side[] {
    return [...this.parts.front, ...this.parts.hind, ...this.parts.legs];
  }

  /** Bends a leg: the top swings by `a`, the middle back by `b`, the end forward by `c` (degrees). */
  private bend(l: Side, a: number, b: number, c = 0) {
    const [top, mid, low] = l.bones;
    this.pitch(top, -a);
    this.pitch(mid, b);
    if (low) this.pitch(low, -c);
  }

  private bodyLower(amount: number, tilt = 0) {
    const target = this.parts.root ?? this.parts.pelvis;
    this.move(target, this.up.clone().multiplyScalar(-amount * this.size));
    if (tilt) this.pitch(target, tilt);
  }

  // ------------------------------------------------------------------ held poses

  private hold(id: string, w: number, t: number) {
    if (w <= 0 || id === 'idle') return;
    const p = this.parts;
    const four = p.front.length > 0 && p.hind.length > 0;
    if (id === 'sit') {
      if (four) {
        // Haunches down, front legs straight, chest up.
        for (const l of p.hind) this.bend(l, -55 * w, 95 * w, 40 * w);
        this.bodyLower(0.18 * w, -22 * w);
        for (const l of p.front) this.pitch(l.bones[0], 22 * w);
      } else {
        for (const l of p.legs) this.bend(l, 70 * w, 80 * w, 10 * w);
        this.bodyLower(0.22 * w);
      }
      this.headTurn('pitch', 6 * w);
    } else if (id === 'lie_down' || id === 'sleep') {
      for (const l of this.legs()) this.bend(l, (four ? 35 : 80) * w, (four ? 100 : 100) * w, 30 * w);
      this.bodyLower((four ? 0.3 : 0.35) * w);
      this.headTurn('pitch', (id === 'sleep' ? 28 : 10) * w);
      for (const tail of p.tails) tail.forEach((b, i) => this.yaw(b, 12 * w * Math.min(1, i / 2)));
      for (const wg of p.wings) this.roll(wg.bones[0], -10 * wg.side * w);
    } else if (id === 'prance') {
      const s = t * 2 * Math.PI * 1.6;
      this.move(p.root ?? p.pelvis, this.up.clone().multiplyScalar(Math.abs(Math.sin(s)) * 0.03 * this.size * w));
      this.legs().forEach((l, i) => this.bend(l, Math.max(0, Math.sin(s + (i % 2) * Math.PI)) * 35 * w, Math.max(0, Math.sin(s + (i % 2) * Math.PI)) * 50 * w));
      this.headTurn('pitch', Math.sin(s * 2) * 4 * w);
      for (const tail of p.tails) tail.forEach((b, i) => this.yaw(b, Math.sin(s + i * 0.5) * 10 * w));
    }
  }

  // ------------------------------------------------------------------ one-shots

  private play(id: string, t: number, dur: number, w: number) {
    const p = this.parts;
    const u = t / dur;
    switch (id) {
      case 'nod':
        this.headTurn('pitch', 16 * w * Math.max(0, Math.sin(u * Math.PI * 4)));
        break;
      case 'shake_head':
        this.headTurn('yaw', 22 * w * Math.sin(u * Math.PI * 6));
        break;
      case 'tilt_head':
        this.headTurn('roll', 18 * w);
        this.headTurn('pitch', -4 * w);
        break;
      case 'droop':
        this.headTurn('pitch', 22 * w);
        for (const e of p.ears) e.bones.forEach((b) => this.roll(b, -25 * e.side * w));
        for (const tail of p.tails) tail.forEach((b, i) => this.pitch(b, (i ? 6 : 12) * w));
        for (const wg of p.wings) this.roll(wg.bones[0], -8 * wg.side * w);
        break;
      case 'bow':
        this.headTurn('pitch', 30 * w);
        for (const s of p.spine) this.pitch(s, (8 * w) / Math.max(1, p.spine.length));
        for (const l of p.front) this.bend(l, -10 * w, 50 * w, 20 * w);
        break;
      case 'wag_tail':
        for (const tail of p.tails) tail.forEach((b, i) => this.yaw(b, Math.sin(t * 2 * Math.PI * 2.4 - i * 0.7) * (16 + i * 4) * w));
        break;
      case 'flap_wings': {
        const beat = Math.sin(t * 2 * Math.PI * 1.6);
        for (const wg of p.wings) {
          this.roll(wg.bones[0], 45 * wg.side * beat * w);
          this.roll(wg.bones[1], -20 * wg.side * beat * w);
          this.yaw(wg.bones[0], -15 * wg.side * w);
        }
        this.move(p.root ?? p.pelvis, this.up.clone().multiplyScalar(Math.max(0, beat) * 0.02 * this.size * w));
        break;
      }
      case 'hop': {
        const hop = Math.max(0, Math.sin(u * Math.PI * 2));
        this.move(p.root ?? p.pelvis, this.up.clone().multiplyScalar(hop * 0.1 * this.size * w));
        for (const l of this.legs()) this.bend(l, hop * 25 * w, hop * 45 * w, hop * 15 * w);
        for (const tail of p.tails) tail.forEach((b, i) => this.pitch(b, -hop * (8 + i * 2) * w));
        break;
      }
      case 'rear_up': {
        const up = Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.5) * w;
        if (p.front.length && p.hind.length) {
          // Up on the hind legs: the body pitches back, the front legs kick.
          this.pitch(p.root ?? p.pelvis, -30 * up);
          this.move(p.root ?? p.pelvis, this.up.clone().multiplyScalar(0.12 * this.size * up));
          for (const l of p.front) this.bend(l, 40 * up + Math.sin(t * 14) * 12 * up, 60 * up);
          for (const l of p.hind) this.bend(l, -10 * up, 20 * up);
          this.headTurn('pitch', -10 * up);
        } else {
          // Two legs or none: the front of the body rises, the head lifts.
          const segs = p.spine.length ? p.spine : [p.pelvis];
          for (const s of segs) this.pitch(s, (-24 * up) / segs.length);
          this.headTurn('pitch', -12 * up);
          for (const wg of p.wings) this.roll(wg.bones[0], 30 * wg.side * up);
        }
        break;
      }
      case 'roar': {
        const open = Math.sin(Math.min(1, u * 1.4) * Math.PI) * w;
        this.headTurn('pitch', -14 * open);
        for (const n of p.neck) this.pitch(n, -6 * open);
        this.pitch(p.jaw, 28 * open);
        for (const wg of p.wings) this.roll(wg.bones[0], 25 * wg.side * open);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ life

  private life(dt: number, t: number, ctx: CreatureContext, k: number) {
    const p = this.parts;
    const lying = this.base.id === 'lie_down' || this.base.id === 'sleep';
    // Breathing: the spine rises and falls a little (slower asleep).
    const breath = Math.sin((t * 2 * Math.PI) / (this.base.id === 'sleep' ? 5.5 : 3.8));
    p.spine.forEach((s) => this.pitch(s, (-1.4 * breath * k) / Math.max(1, p.spine.length)));
    // A slow sway and weight shift.
    if (!lying) {
      this.roll(p.root ?? p.pelvis, Math.sin(t * 0.8) * 1.1 * k);
      this.yaw(p.root ?? p.pelvis, Math.sin(t * 0.37 + 1) * 1.2 * k);
    }
    // Head and eyes toward the target, limited and smoothed.
    let yaw = 0, pitch = 0;
    if (ctx.lookAt && p.head && this.base.id !== 'sleep') {
      const target = this.scene.worldToLocal(ctx.lookAt.clone());
      const from = this.restPos.get(p.head)!;
      const d = target.sub(from);
      yaw = Math.atan2(d.dot(this.right), d.dot(this.fwd)) / DEG;
      pitch = Math.atan2(d.dot(this.up), Math.hypot(d.dot(this.right), d.dot(this.fwd))) / DEG;
      // Behind the head: look over the shoulder no further than the limit.
      yaw = THREE.MathUtils.clamp(yaw, -40, 40);
      pitch = THREE.MathUtils.clamp(pitch, -18, 18);
    }
    this.look.x = damp(this.look.x, yaw * k, 3, dt);
    this.look.y = damp(this.look.y, pitch * k, 3, dt);
    this.headTurn('yaw', this.look.x);
    this.headTurn('pitch', -this.look.y + Math.sin(t * 0.5) * 1.5 * k);
    // Ear twitches every few seconds.
    if (p.ears.length) {
      const e = this.earTwitch;
      if (e.t < 0 && (e.at -= dt) <= 0) { e.t = 0; e.ear = Math.floor(Math.random() * p.ears.length); }
      if (e.t >= 0) {
        e.t += dt;
        const ear = p.ears[e.ear]!;
        this.roll(ear.bones[0], 14 * ear.side * Math.sin(Math.min(1, e.t / 0.3) * Math.PI) * k);
        if (e.t > 0.3) { e.t = -1; e.at = 2.5 + Math.random() * 5; }
      }
    }
    // The jaw with the voice.
    this.jawNow = damp(this.jawNow, ctx.speaking ? ctx.mouth : 0, 20, dt);
    if (p.jaw) this.pitch(p.jaw, 16 * this.jawNow);
  }

  private idleTail(t: number, k: number) {
    if (k <= 0) return;
    for (const tail of this.parts.tails) tail.forEach((b, i) => this.yaw(b, Math.sin(t * 1.3 - i * 0.55) * (2 + i * 1.2) * k));
  }

  private idleWings(t: number, k: number) {
    if (k <= 0) return;
    for (const wg of this.parts.wings) this.roll(wg.bones[0], Math.sin(t * 0.9) * 2 * wg.side * k);
  }
}

/** Shared emotes the creature runtime performs (for the picker's list). */
export const CREATURE_SHARED_IDS = Object.keys(CREATURE_SHARED);
