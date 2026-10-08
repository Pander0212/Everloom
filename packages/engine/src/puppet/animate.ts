/**
 * What moves a puppet every frame, in this order: the base pose (defaults plus the character's own
 * settings, such as body shape), the expression (blended smoothly), automatic life (blinking with
 * natural timing, breathing, a small idle sway, eyes and head toward whoever is speaking or the
 * pointer), motions and gestures (parameter animations, added on top), lip-sync (from the voice's
 * loudness, plus vowel shapes when known), then pendulum physics, which writes its own parameters.
 */
import type { PuppetModel, PuppetMotion } from './format.js';
import { PuppetRig } from './deform.js';

/** Random numbers 0–1 (Math.random, or a seeded one in tests). */
export type PuppetRandom = () => number;

/** Everloom's emotions (docs/avatars.md) and what an expression without its own keyforms falls back to. */
export const PUPPET_EMOTIONS = ['neutral', 'joy', 'amusement', 'sadness', 'anger', 'fear', 'surprise', 'disgust', 'embarrassment', 'love', 'curiosity', 'confusion', 'nervousness', 'pride', 'relief', 'determination'] as const;

/** Defaults in terms of the standard parameters, for puppets whose file doesn't set an expression. */
export const DEFAULT_EXPRESSIONS: Record<string, Record<string, number>> = {
  neutral: {},
  joy: { EyeSmile: 0.8, MouthForm: 1, MouthOpen: 0.25, BrowY: 0.3, Cheek: 0.3 },
  amusement: { EyeSmile: 0.5, MouthForm: 0.8, BrowY: 0.2 },
  sadness: { MouthForm: -0.7, BrowY: -0.3, BrowAngle: 0.8, EyeLOpen: 0.75, EyeROpen: 0.75 },
  anger: { MouthForm: -0.6, BrowY: -0.6, BrowAngle: -1, EyeLOpen: 0.85, EyeROpen: 0.85 },
  fear: { BrowY: 0.6, BrowAngle: 0.7, MouthOpen: 0.25, MouthForm: -0.4 },
  surprise: { BrowY: 1, MouthOpen: 0.6, MouthForm: 0, EyeLOpen: 1, EyeROpen: 1 },
  disgust: { MouthForm: -0.8, BrowY: -0.4, BrowAngle: -0.5, EyeLOpen: 0.7, EyeROpen: 0.8 },
  embarrassment: { Cheek: 1, MouthForm: 0.3, BrowAngle: 0.5, EyeBallY: -0.5 },
  love: { Cheek: 0.7, EyeSmile: 0.6, MouthForm: 0.8 },
  curiosity: { BrowY: 0.5, AngleZ: 6, MouthForm: 0.2 },
  confusion: { BrowAngle: 0.6, BrowY: 0.2, AngleZ: -8, MouthForm: -0.3 },
  nervousness: { BrowAngle: 0.8, MouthForm: -0.3, EyeBallX: 0.4 },
  pride: { EyeSmile: 0.3, MouthForm: 0.6, AngleY: 6 },
  relief: { EyeSmile: 0.4, MouthForm: 0.6, BrowY: 0.2 },
  determination: { BrowY: -0.3, BrowAngle: -0.6, MouthForm: -0.2 },
};

/** Built-in gestures, as parameter tracks (added to the pose). */
export const DEFAULT_MOTIONS: Record<string, PuppetMotion> = {
  nod: { duration: 0.9, loop: false, additive: true, tracks: { AngleY: [[0, 0], [0.2, -14], [0.45, 4], [0.65, -6], [0.9, 0]] } },
  shake: { duration: 1.1, loop: false, additive: true, tracks: { AngleX: [[0, 0], [0.18, -16], [0.42, 16], [0.66, -12], [0.88, 6], [1.1, 0]] } },
  tilt: { duration: 1.4, loop: false, additive: true, tracks: { AngleZ: [[0, 0], [0.35, 12], [1.05, 12], [1.4, 0]] } },
  surprise: { duration: 1.0, loop: false, additive: true, tracks: { AngleY: [[0, 0], [0.12, 8], [1, 0]], BrowY: [[0, 0], [0.1, 0.8], [0.8, 0.6], [1, 0]], EyeLOpen: [[0, 0], [0.1, 0.15], [1, 0]], EyeROpen: [[0, 0], [0.1, 0.15], [1, 0]], BodyAngleX: [[0, 0], [0.12, -3], [1, 0]] } },
  laugh: { duration: 1.6, loop: false, additive: true, tracks: { AngleY: [[0, 0], [0.2, 6], [0.4, -2], [0.6, 6], [0.8, -2], [1.0, 5], [1.6, 0]], EyeSmile: [[0, 0], [0.15, 1], [1.4, 1], [1.6, 0]], MouthOpen: [[0, 0], [0.15, 0.6], [0.3, 0.3], [0.45, 0.6], [0.6, 0.3], [0.75, 0.6], [1.4, 0.4], [1.6, 0]], BodyAngleZ: [[0, 0], [0.4, 2], [1.0, -1], [1.6, 0]] } },
  wave: { duration: 1.6, loop: false, additive: true, tracks: { ArmRPose: [[0, 0], [0.25, 1], [1.35, 1], [1.6, 0]], ArmWave: [[0, 0], [0.3, 0], [0.5, 1], [0.7, -1], [0.9, 1], [1.1, -1], [1.3, 0]], AngleZ: [[0, 0], [0.3, 4], [1.3, 4], [1.6, 0]], MouthForm: [[0, 0], [0.3, 0.7], [1.4, 0.7], [1.6, 0]] } },
  flinch: { duration: 0.7, loop: false, additive: true, tracks: { AngleY: [[0, 0], [0.08, 8], [0.7, 0]], AngleX: [[0, 0], [0.08, -10], [0.7, 0]], EyeLOpen: [[0, 0], [0.06, -0.8], [0.4, -0.2], [0.7, 0]], EyeROpen: [[0, 0], [0.06, -0.8], [0.4, -0.2], [0.7, 0]], BodyAngleX: [[0, 0], [0.1, -4], [0.7, 0]] } },
  lean: { duration: 1.2, loop: false, additive: true, tracks: { BodyAngleX: [[0, 0], [0.4, 6], [0.8, 6], [1.2, 0]], AngleX: [[0, 0], [0.4, 8], [0.8, 8], [1.2, 0]] } },
};

/** Value of a track at time t (smoothstep between keys, held at the ends). */
export function trackAt(keys: Array<[number, number]>, t: number): number {
  if (t <= keys[0]![0]) return keys[0]![1];
  const last = keys[keys.length - 1]!;
  if (t >= last[0]) return last[1];
  let i = 0;
  while (t > keys[i + 1]![0]) i++;
  const [t0, v0] = keys[i]!, [t1, v1] = keys[i + 1]!;
  const f = (t - t0) / (t1 - t0);
  return v0 + (v1 - v0) * f * f * (3 - 2 * f);
}

interface Pendulum { px: Float32Array; py: Float32Array; qx: Float32Array; qy: Float32Array; inputs: Array<{ i: number; w: number; kind: 'x' | 'angle'; range: number }>; outputs: Array<{ i: number; segment: number; scale: number }>; def: PuppetModel['physics'][number]; acc: number }

/** Pendulum chains (verlet, fixed 60 Hz steps) whose swing drives parameters. */
export class PuppetPendulums {
  private chains: Pendulum[] = [];
  enabled = true;

  constructor(private rig: PuppetRig, model: PuppetModel) {
    for (const def of model.physics) {
      const n = def.segments + 1;
      const c: Pendulum = { px: new Float32Array(n), py: new Float32Array(n), qx: new Float32Array(n), qy: new Float32Array(n), def, acc: 0, inputs: [], outputs: [] };
      for (let k = 0; k < n; k++) { c.py[k] = k * def.length; c.qy[k] = c.py[k]!; }
      for (const x of def.inputs) { const i = rig.param(x.param); if (i >= 0) c.inputs.push({ i, w: x.weight, kind: x.kind, range: Math.max(Math.abs(rig.min[i]!), Math.abs(rig.max[i]!)) || 1 }); }
      for (const o of def.outputs) { const i = rig.param(o.param); if (i >= 0) c.outputs.push({ i, segment: Math.min(o.segment, def.segments - 1), scale: o.scale }); }
      this.chains.push(c);
    }
  }

  get count() { return this.chains.length; }

  /** Advances by dt seconds and writes the output parameters. */
  update(dt: number) {
    const h = 1 / 60;
    for (const c of this.chains) {
      if (!this.enabled) { for (const o of c.outputs) this.rig.values[o.i] = this.rig.defaults[o.i]!; continue; }
      c.acc = Math.min(c.acc + dt, h * 6);
      while (c.acc >= h) { this.step(c, h); c.acc -= h; }
      for (const o of c.outputs) {
        const k = o.segment;
        const ax = c.px[k + 1]! - c.px[k]!, ay = c.py[k + 1]! - c.py[k]!;
        // The swing relative to hanging straight down in the head's frame.
        const tilt = this.anchorAngle(c);
        let a = Math.atan2(ax, ay) * (180 / Math.PI) + tilt;
        a = Math.max(-c.def.limit, Math.min(c.def.limit, a));
        const r = Math.max(Math.abs(this.rig.min[o.i]!), Math.abs(this.rig.max[o.i]!));
        this.rig.values[o.i] = Math.max(this.rig.min[o.i]!, Math.min(this.rig.max[o.i]!, (a / c.def.limit) * r * o.scale));
      }
    }
  }

  private anchorX(c: Pendulum) { let x = 0; for (const s of c.inputs) if (s.kind === 'x') x += (this.rig.values[s.i]! / s.range) * s.w; return x; }
  private anchorAngle(c: Pendulum) { let a = 0; for (const s of c.inputs) if (s.kind === 'angle') a += (this.rig.values[s.i]! / s.range) * s.w * 30; return a; }

  private step(c: Pendulum, h: number) {
    const d = c.def, n = c.px.length;
    c.px[0] = this.anchorX(c); c.py[0] = 0;
    const tilt = this.anchorAngle(c) * (Math.PI / 180);
    // Gravity pulls down in the world; the rest direction turns with the head.
    const restX = -Math.sin(tilt), restY = Math.cos(tilt);
    const keep = Math.pow(1 - d.damping, h * 60);
    for (let k = 1; k < n; k++) {
      const vx = (c.px[k]! - c.qx[k]!) * keep, vy = (c.py[k]! - c.qy[k]!) * keep;
      c.qx[k] = c.px[k]!; c.qy[k] = c.py[k]!;
      const tx = c.px[k - 1]! + restX * d.length, ty = c.py[k - 1]! + restY * d.length;
      c.px[k] = c.px[k]! + vx + (tx - c.px[k]!) * d.stiffness * h;
      c.py[k] = c.py[k]! + vy + (ty - c.py[k]!) * d.stiffness * h + d.gravity * 9.8 * h * h;
      // Hold the segment's length.
      const dx = c.px[k]! - c.px[k - 1]!, dy = c.py[k]! - c.py[k - 1]!;
      const len = Math.hypot(dx, dy) || 1;
      c.px[k] = c.px[k - 1]! + (dx / len) * d.length;
      c.py[k] = c.py[k - 1]! + (dy / len) * d.length;
    }
  }

  reset() {
    for (const c of this.chains) for (let k = 0; k < c.px.length; k++) { c.px[k] = 0; c.py[k] = k * c.def.length; c.qx[k] = 0; c.qy[k] = c.py[k]!; }
  }
}

export interface LifeOptions {
  blink: boolean;
  breath: boolean;
  sway: boolean;
}

interface Playing { motion: PuppetMotion; t: number; weight: number; fadeOut: boolean }

/**
 * The animator a player runs each frame. Holds the base pose, the expression, the look target,
 * speech and the motions, and writes the rig's parameters before it evaluates.
 */
export class PuppetAnimator {
  readonly rig: PuppetRig;
  readonly physics: PuppetPendulums;
  /** The character's own settings (body shape, a held head tilt…): the pose everything adds to. */
  readonly base = new Map<string, number>();
  life: LifeOptions = { blink: true, breath: true, sway: true };
  private expression = new Map<string, number>();
  private exprNow = new Map<string, number>();
  private playing: Playing[] = [];
  private time = 0;
  private nextBlink = 1.5;
  private blinkT = -1;
  private doubleBlink = false;
  /** Where to look, -1..1 each way (x right, y up), or null for straight ahead. */
  look: { x: number; y: number } | null = null;
  private lookNow = { x: 0, y: 0 };
  private swayPhase: number;
  /** Mouth openness 0–1 from the voice, and vowel weights when known. */
  speech = 0;
  vowels: Partial<Record<'A' | 'I' | 'U' | 'E' | 'O', number>> | null = null;
  private speechNow = 0;

  constructor(readonly model: PuppetModel, private rng: PuppetRandom = Math.random) {
    this.rig = new PuppetRig(model);
    this.physics = new PuppetPendulums(this.rig, model);
    this.swayPhase = rng() * 100;
    this.nextBlink = 1 + rng() * 3;
  }

  /** Blends to an emotion (unknown names fall back to neutral). */
  setExpression(name: string) {
    const ex = this.model.expressions[name] ?? DEFAULT_EXPRESSIONS[name] ?? {};
    // Eye openness is given as a level (0.8: a little narrowed); kept as the change from open.
    this.expression = new Map(Object.entries(ex).map(([id, v]) => [id, id === 'EyeLOpen' || id === 'EyeROpen' ? v - 1 : v]));
  }

  /** Plays a motion by name (the puppet's own, else a built-in). Returns false if there's none. */
  play(name: string): boolean {
    const m = this.model.motions[name] ?? DEFAULT_MOTIONS[name];
    if (!m) return false;
    for (const p of this.playing) if (!p.motion.loop) p.fadeOut = true;
    this.playing.push({ motion: m, t: 0, weight: 0, fadeOut: false });
    return true;
  }

  stopLoops() { for (const p of this.playing) if (p.motion.loop) p.fadeOut = true; }
  get busy() { return this.playing.length > 0 || this.speechNow > 0.02; }

  private add(id: string, v: number) {
    const i = this.rig.param(id);
    if (i >= 0) this.rig.values[i] = this.rig.values[i]! + v;
  }

  /** Advances everything by dt seconds and evaluates the rig. */
  update(dt: number) {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const rig = this.rig;
    rig.reset();
    for (const [id, v] of this.base) rig.set(id, v);
    // Expression: every parameter it names eases toward its value; the rest ease back.
    const k = 1 - Math.exp(-dt * 8);
    const ids = new Set([...this.expression.keys(), ...this.exprNow.keys()]);
    for (const id of ids) {
      const target = this.expression.get(id) ?? 0;
      const cur = this.exprNow.get(id) ?? 0;
      const next = cur + (target - cur) * k;
      if (Math.abs(next) < 1e-4 && !this.expression.has(id)) this.exprNow.delete(id);
      else this.exprNow.set(id, next);
    }
    for (const [id, v] of this.exprNow) {
      const i = rig.param(id);
      if (i >= 0) rig.values[i] = rig.values[i]! + v;
    }
    // Life.
    if (this.life.breath) rig.set('Breath', 0.5 + 0.5 * Math.sin(this.time * ((2 * Math.PI) / 3.6)));
    if (this.life.sway) {
      const t = this.time + this.swayPhase;
      this.add('AngleX', Math.sin(t * 0.37) * 2.2 + Math.sin(t * 0.91) * 0.8);
      this.add('AngleZ', Math.sin(t * 0.29 + 1) * 1.6);
      this.add('BodyAngleX', Math.sin(t * 0.23 + 2) * 1.2);
      this.add('BodyAngleZ', Math.sin(t * 0.31 + 3) * 0.8);
    }
    const lt = this.look ?? { x: 0, y: 0 };
    const lk = 1 - Math.exp(-dt * 5);
    this.lookNow.x += (lt.x - this.lookNow.x) * lk;
    this.lookNow.y += (lt.y - this.lookNow.y) * lk;
    this.add('EyeBallX', this.lookNow.x);
    this.add('EyeBallY', this.lookNow.y);
    this.add('AngleX', this.lookNow.x * 12);
    this.add('AngleY', this.lookNow.y * 9);
    this.add('BodyAngleX', this.lookNow.x * 3);
    let eye = 1;
    if (this.life.blink) {
      if (this.blinkT < 0 && this.time >= this.nextBlink) { this.blinkT = 0; this.doubleBlink = this.rng() < 0.15; }
      if (this.blinkT >= 0) {
        this.blinkT += dt;
        // Close fast (70 ms), stay shut briefly, open a little slower (110 ms).
        const t = this.blinkT;
        eye = t < 0.07 ? 1 - t / 0.07 : t < 0.11 ? 0 : t < 0.22 ? (t - 0.11) / 0.11 : 1;
        if (t >= 0.22) {
          this.blinkT = -1;
          this.nextBlink = this.time + (this.doubleBlink ? 0.12 : 1.8 + this.rng() * 4.2);
          this.doubleBlink = false;
        }
      }
    }
    // Motions on top.
    for (const p of this.playing) {
      p.t += dt;
      p.weight = p.fadeOut ? Math.max(0, p.weight - dt / 0.2) : Math.min(1, p.weight + dt / 0.15);
      const t = p.motion.loop ? p.t % p.motion.duration : Math.min(p.t, p.motion.duration);
      for (const [id, keys] of Object.entries(p.motion.tracks)) {
        const v = trackAt(keys, t);
        const i = rig.param(id);
        if (i < 0) continue;
        rig.values[i] = p.motion.additive ? rig.values[i]! + v * p.weight : rig.values[i]! * (1 - p.weight) + v * p.weight;
      }
      if (!p.motion.loop && p.t >= p.motion.duration) p.fadeOut = true;
    }
    this.playing = this.playing.filter((p) => !(p.fadeOut && p.weight <= 0));
    // Speech: open the mouth with the voice (quick to open, a little slower to close).
    const sk = 1 - Math.exp(-dt * (this.speech > this.speechNow ? 30 : 14));
    this.speechNow += (this.speech - this.speechNow) * sk;
    if (this.speechNow > 0.01) {
      const i = rig.param('MouthOpen');
      if (i >= 0) rig.values[i] = Math.max(rig.values[i]!, this.speechNow);
      if (this.vowels) for (const [v, w] of Object.entries(this.vowels)) rig.set(`Mouth${v}`, (w ?? 0) * this.speechNow);
    }
    // Clamp, then blink (multiplies whatever openness the expression and motions left).
    for (let i = 0; i < rig.values.length; i++) rig.values[i] = Math.min(rig.max[i]!, Math.max(rig.min[i]!, rig.values[i]!));
    for (const id of ['EyeLOpen', 'EyeROpen']) { const i = rig.param(id); if (i >= 0) rig.values[i] = rig.values[i]! * eye; }
    this.physics.update(dt);
    rig.evaluate();
  }
}
