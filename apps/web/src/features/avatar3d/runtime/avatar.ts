/**
 * One 3D character on a stage: its model, how it moves and what its face does.
 *
 * Every frame, in this order:
 *   1. the base pose (idle, a held pose like sitting, or a dance) is sampled and cross-faded from
 *      the previous one;
 *   2. while the character talks, talking gestures are layered on the upper body (each utterance
 *      starts the gesture loop somewhere else, so it doesn't visibly repeat);
 *   3. a one-shot emote plays on top with a short fade in and out, then hands back to the base;
 *   4. a procedural layer adds breathing, a slow weight shift, and head and eyes turning toward
 *      the camera or whoever speaks;
 *   5. the canonical pose is applied to the model (canonical.ts), then the face (expression,
 *      blinking, mouth shapes; all smoothed so nothing pops), then hair and cloth springs.
 */
import * as THREE from 'three';
import { VRMSpringBoneCollider, VRMSpringBoneColliderShapeSphere, VRMSpringBoneJoint, VRMSpringBoneManager } from '@pixiv/three-vrm';
import { faceWeights, type Emotion, type HumanBone, type Viseme } from '@everloom/engine';
import { applyCanonical, emptyPose, prepareRig, type CanonicalPose, type RigInfo } from './canonical';
import { blendPose, copyPose, sampleClip, UPPER_BODY, type Clip } from './clip';
import { clipIdFor, getClip } from './clips';
import type { LoadedModel } from './loader';
import { applyLook, type Look, type LookOptions } from './materials';

export interface AvatarOptions {
  look: Look;
  outlines: boolean;
  physics: boolean;
  /** Multipliers for hair and cloth springs (saved per avatar). */
  stiffness?: number;
  gravity?: number;
}

interface Layer {
  clip: Clip;
  time: number;
  /** Fade weight now, and where it is heading. */
  weight: number;
  target: number;
  speed: number;
  mask?: ReadonlySet<HumanBone>;
  /** One-shots end on their own; holds stay on their last frame until replaced. */
  oneShot?: boolean;
  hold?: boolean;
  onEnd?: () => void;
}

const smooth = (x: number) => x * x * (3 - 2 * x);
const damp = (cur: number, target: number, rate: number, dt: number) => target + (cur - target) * Math.exp(-rate * dt);
const DEG = Math.PI / 180;
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const rotate = (q: THREE.Quaternion | undefined, x: number, y: number, z: number) => {
  if (!q) return;
  q.multiply(_q.setFromEuler(_e.set(x * DEG, y * DEG, z * DEG)));
};

/** Emotes that hold their last frame (they're states, not gestures). */
const HOLD = new Set(['defeat', 'sleep', 'lie_down']);

export class Avatar {
  readonly model: LoadedModel;
  readonly rig: RigInfo;
  /** Positioned and turned by the stage. */
  readonly group = new THREE.Group();
  options: AvatarOptions;

  private base: Layer | null = null;
  private fading: Layer[] = [];
  private talk: Layer | null = null;
  private shot: Layer | null = null;
  private pending = 0;
  private pose: CanonicalPose = emptyPose();
  private scratch: CanonicalPose = emptyPose();
  private clock = Math.random() * 100;

  basePoseId = 'idle';
  emotion: Emotion = 'neutral';
  emotionStrength = 0.85;
  speaking = false;
  /** Mouth shapes for this frame (from the voice). */
  visemes: Partial<Record<Viseme, number>> = {};
  /** World point to look at (camera or speaker); null looks ahead. */
  lookAt: THREE.Vector3 | null = null;

  private faceNow = new Map<string, number>();
  private blinkT = 2 + Math.random() * 3;
  private blinkPhase = -1;
  private look = new THREE.Vector2();
  private springs: VRMSpringBoneManager | null = null;
  /** True while anything besides the quiet idle is happening (the stage renders faster then). */
  busy = false;
  /** A fixed pose instead of the animation layers (the import wizard's checks). */
  override: CanonicalPose | null = null;
  /** Fixed morph weights instead of the expression system (the wizard's face preview). */
  faceOverride: Record<string, number> | null = null;

  constructor(model: LoadedModel, options: AvatarOptions) {
    this.model = model;
    this.options = options;
    this.group.add(model.scene);
    this.rig = prepareRig(model.scene, model.bones);
    // Models built facing away (VRM 0.x, MMD) are turned to face the camera. Retargeting works in
    // the rig's own frame, so this changes nothing else.
    if (Math.abs(this.rig.facing.w) < 0.5) model.scene.rotation.y += Math.PI;
    // The model's feet stand on the group's origin.
    model.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model.scene);
    model.scene.position.y -= box.min.y - model.floor;
    this.setLook(options.look, { outlines: options.outlines });
    this.setupSprings();
    void this.setBase('idle');
  }

  get height() {
    return this.model.height;
  }

  setLook(look: Look, opts: Partial<LookOptions> = {}) {
    this.options.look = look;
    if (opts.outlines !== undefined) this.options.outlines = opts.outlines;
    applyLook(this.model.scene, look, { outlines: this.options.outlines, ...opts });
  }

  // ------------------------------------------------------------------ motion

  /** Changes the held pose (idle, sit, a dance…), cross-fading over `fade` seconds. */
  async setBase(emoteId: string, fade = 0.6, speed = 1) {
    const ticket = ++this.pending;
    const id = clipIdFor(emoteId);
    // Sitting down and getting up have their own transitions.
    if (id === 'sit' && this.basePoseId !== 'sit' && this.basePoseId !== 'sit_talk') {
      const enter = await getClip('sit_enter');
      if (enter && ticket === this.pending) this.playShot(enter, { fade: 0.3, onEnd: () => void 0 });
    } else if (this.basePoseId === 'sit' && id !== 'sit') {
      const exit = await getClip('sit_exit');
      if (exit && ticket === this.pending) this.playShot(exit, { fade: 0.25 });
    }
    const clip = (await getClip(id)) ?? (await getClip('idle'));
    if (!clip || ticket !== this.pending) return;
    this.basePoseId = emoteId;
    if (this.base) {
      this.base.target = 0;
      this.base.speed = 1 / Math.max(0.05, fade);
      this.fading.push(this.base);
    }
    this.base = { clip, time: HOLD.has(emoteId) ? clip.duration : 0, weight: this.fading.length ? 0 : 1, target: 1, speed: (1 / Math.max(0.05, fade)) * 1, hold: HOLD.has(emoteId) };
    this.base.time = 0;
    (this.base as Layer & { rate?: number }).rate = speed;
  }

  /** Plays a one-shot emote over the base pose. Loops (dances, sitting) become the base instead. */
  async emote(emoteId: string, opts: { loop?: boolean } = {}) {
    const clip = await getClip(clipIdFor(emoteId));
    if (!clip) return false;
    if (clip.loop || opts.loop) {
      await this.setBase(emoteId);
      return true;
    }
    if (HOLD.has(emoteId)) {
      // Falling over and staying down: becomes the base, holding the last frame.
      this.playShot(clip, { fade: 0.25, onEnd: () => void this.holdLast(clip, emoteId) });
      return true;
    }
    this.playShot(clip, { fade: 0.25 });
    return true;
  }

  private holdLast(clip: Clip, id: string) {
    this.basePoseId = id;
    if (this.base) this.fading.push({ ...this.base, target: 0, speed: 8 });
    this.base = { clip, time: clip.duration, weight: 1, target: 1, speed: 4, hold: true };
  }

  private playShot(clip: Clip, o: { fade: number; onEnd?: () => void }) {
    if (this.shot) this.fading.push({ ...this.shot, target: 0, speed: 1 / 0.2 });
    // Sitting or lying down: gestures use the upper body only.
    const seated = /sit|lie|sleep|kneel/.test(this.basePoseId);
    this.shot = { clip, time: 0, weight: 0, target: 1, speed: 1 / o.fade, oneShot: true, mask: seated ? UPPER_BODY : undefined, onEnd: o.onEnd };
  }

  /** Starts or stops talking gestures (only while standing idle). */
  setSpeaking(on: boolean) {
    if (on === this.speaking) return;
    this.speaking = on;
    if (on) {
      const seated = /sit/.test(this.basePoseId);
      void getClip(seated ? 'sit_talk' : 'talk').then((clip) => {
        if (!clip || !this.speaking) return;
        // A different place in the loop each time, and a slightly different pace.
        this.talk = { clip, time: Math.random() * clip.duration, weight: this.talk?.weight ?? 0, target: seated ? 1 : 0.75, speed: 1 / 0.45, mask: UPPER_BODY };
        (this.talk as Layer & { rate?: number }).rate = 0.85 + Math.random() * 0.3;
      });
    } else if (this.talk) this.talk.target = 0;
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number, camera: THREE.Camera | null) {
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    const pose = this.pose;
    // 1. base and what's fading out of it.
    const base = this.base;
    copyPose(emptyPose(), pose);
    if (base) {
      this.advance(base, dt);
      sampleClip(base.clip, base.hold && base.time >= base.clip.duration ? base.clip.duration : base.time, pose);
    } else this.armsDown(pose);
    for (const f of this.fading) {
      this.advance(f, dt);
      if (f.weight > 0) blendPose(pose, sampleClip(f.clip, f.time, this.scratch), smooth(f.weight), f.mask);
    }
    this.fading = this.fading.filter((f) => f.weight > 0.001);
    // 2. talking gestures.
    if (this.talk) {
      const standingOrSeated = /^(idle|idle_relaxed|idle_confident|idle_shy|idle_tired|sit|sit_talk)$/.test(this.basePoseId);
      if (!standingOrSeated) this.talk.target = 0;
      this.advance(this.talk, dt);
      if (this.talk.weight > 0) blendPose(pose, sampleClip(this.talk.clip, this.talk.time, this.scratch), smooth(this.talk.weight), this.talk.mask);
      if (this.talk.weight <= 0.001 && this.talk.target === 0) this.talk = null;
    }
    // 3. one-shot emote.
    if (this.shot) {
      const s = this.shot;
      this.advance(s, dt);
      // Fade out over the last 0.35 s.
      if (s.time >= s.clip.duration - 0.35 && s.target === 1) {
        s.target = 0;
        s.speed = 1 / 0.35;
      }
      if (s.weight > 0) blendPose(pose, sampleClip(s.clip, s.time, this.scratch), smooth(s.weight), s.mask);
      if (s.time >= s.clip.duration && s.weight <= 0.001) {
        this.shot = null;
        s.onEnd?.();
      }
    }
    this.busy = !!this.shot || !!this.talk || this.speaking || !/^idle/.test(this.basePoseId) || this.fading.length > 0;
    // 4. procedural life (not over a fixed check pose).
    if (this.override) copyPose(this.override, pose);
    else this.procedural(pose, dt, camera);
    // 5. the model.
    applyCanonical(this.rig, pose);
    this.face(dt);
    if (this.springs && this.options.physics) this.springs.update(dt);
    this.model.vrm?.expressionManager?.update();
  }

  private advance(l: Layer, dt: number) {
    const rate = (l as Layer & { rate?: number }).rate ?? 1;
    l.time += dt * rate;
    if (l.hold) l.time = Math.min(l.time, l.clip.duration);
    l.weight = l.target > l.weight ? Math.min(l.target, l.weight + l.speed * dt) : Math.max(l.target, l.weight - l.speed * dt);
  }

  /** Before any clip has loaded: arms down instead of a T-pose. */
  private armsDown(pose: CanonicalPose) {
    pose.rot.leftUpperArm = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -72 * DEG));
    pose.rot.rightUpperArm = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 72 * DEG));
  }

  private procedural(pose: CanonicalPose, dt: number, camera: THREE.Camera | null) {
    const t = this.clock;
    const lying = /lie|sleep|defeat/.test(this.basePoseId);
    // Breathing: chest and shoulders rise a little, about 15 breaths a minute (slower asleep).
    const breath = Math.sin((t * 2 * Math.PI) / (this.basePoseId === 'sleep' ? 5.5 : 4.2));
    rotate(pose.rot.upperChest ?? pose.rot.chest, -1.1 * breath, 0, 0);
    rotate(pose.rot.leftShoulder, 0, 0, 0.8 * breath);
    rotate(pose.rot.rightShoulder, 0, 0, -0.8 * breath);
    if (lying) return;
    // Head and eyes toward the target (or ahead), limited and smoothed.
    let yaw = 0;
    let pitch = 0;
    const target = this.lookAt ?? (camera ? camera.getWorldPosition(new THREE.Vector3()) : null);
    const head = this.rig.bones.head;
    if (target && head) {
      const from = head.getWorldPosition(new THREE.Vector3());
      const dir = target.clone().sub(from);
      // Into the avatar's facing frame.
      const inv = new THREE.Quaternion();
      this.group.getWorldQuaternion(inv);
      dir.applyQuaternion(inv.invert());
      yaw = Math.atan2(dir.x, dir.z) / DEG;
      pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z)) / DEG;
    }
    const busyGesture = this.shot ? 0.35 : 1;
    yaw = THREE.MathUtils.clamp(yaw, -40, 40) * busyGesture;
    pitch = THREE.MathUtils.clamp(pitch, -20, 15) * busyGesture;
    this.look.x = damp(this.look.x, yaw, 4, dt);
    this.look.y = damp(this.look.y, pitch, 4, dt);
    rotate(pose.rot.neck, -this.look.y * 0.3, this.look.x * 0.35, 0);
    rotate(pose.rot.head, -this.look.y * 0.5, this.look.x * 0.5, 0);
    const eyeYaw = THREE.MathUtils.clamp(this.look.x * 0.15, -8, 8);
    const eyePitch = THREE.MathUtils.clamp(this.look.y * 0.2, -6, 6);
    if (pose.rot.leftEye || this.rig.bones.leftEye) {
      pose.rot.leftEye ??= new THREE.Quaternion();
      pose.rot.rightEye ??= new THREE.Quaternion();
      rotate(pose.rot.leftEye, -eyePitch, eyeYaw, 0);
      rotate(pose.rot.rightEye, -eyePitch, eyeYaw, 0);
    }
  }

  private face(dt: number) {
    // Blink every 2–6 s (sometimes twice), 0.14 s each.
    if (this.blinkPhase < 0) {
      this.blinkT -= dt;
      if (this.blinkT <= 0) this.blinkPhase = 0;
    }
    let blink = 0;
    if (this.blinkPhase >= 0) {
      this.blinkPhase += dt / 0.14;
      blink = Math.sin(Math.min(1, this.blinkPhase) * Math.PI);
      if (this.blinkPhase >= 1) {
        this.blinkPhase = -1;
        this.blinkT = Math.random() < 0.15 ? 0.12 : 2 + Math.random() * 4;
      }
    }
    if (this.basePoseId === 'sleep') blink = 1;
    const target = this.faceOverride ?? faceWeights(this.model.expressions, { emotion: this.emotion, strength: this.emotionStrength, visemes: this.speaking ? this.visemes : undefined, blink });
    // Smooth everything toward the target: expressions slowly, the mouth quickly, blinks instantly.
    const keys = new Set([...this.faceNow.keys(), ...Object.keys(target)]);
    const mouth = new Set(['aa', 'ih', 'ou', 'ee', 'oh', 'jawOpen'].flatMap((k) => (this.model.expressions[k as Viseme] ?? []).map((m) => m.morph)));
    const blinks = new Set(['blink', 'blinkLeft', 'blinkRight'].flatMap((k) => (this.model.expressions[k as 'blink'] ?? []).map((m) => m.morph)));
    for (const k of keys) {
      const goal = target[k] ?? 0;
      const rate = blinks.has(k) ? 60 : mouth.has(k) ? 18 : 6;
      const v = damp(this.faceNow.get(k) ?? 0, goal, rate, dt);
      if (v < 0.001 && goal === 0) this.faceNow.delete(k);
      else this.faceNow.set(k, v);
      this.setMorph(k, v);
    }
  }

  private setMorph(name: string, v: number) {
    if (name.startsWith('vrm:')) {
      this.model.vrm?.expressionManager?.setValue(name.slice(4), v);
      return;
    }
    for (const m of this.model.morphMeshes) {
      const i = m.morphTargetDictionary![name];
      if (i !== undefined && m.morphTargetInfluences) m.morphTargetInfluences[i] = v;
    }
  }

  // ------------------------------------------------------------------ springs

  private setupSprings() {
    if (this.model.vrm?.springBoneManager && this.model.vrm.springBoneManager.joints.size) {
      this.springs = this.model.vrm.springBoneManager;
      for (const j of this.springs.joints) {
        j.settings.stiffness *= this.options.stiffness ?? 1;
        j.settings.gravityPower *= this.options.gravity ?? 1;
      }
      this.springs.setInitState();
      return;
    }
    if (!this.model.secondaryChains.length) return;
    const mgr = new VRMSpringBoneManager();
    const h = this.model.height;
    // Spheres on the head, chest, hips and thighs keep hair and skirts outside the body.
    const group = { colliders: [] as VRMSpringBoneCollider[], name: 'body' };
    const sphere = (bone: THREE.Object3D | undefined, r: number, offset = new THREE.Vector3()) => {
      if (!bone) return;
      const c = new VRMSpringBoneCollider(new VRMSpringBoneColliderShapeSphere({ radius: r * h, offset }));
      bone.add(c);
      group.colliders.push(c);
    };
    const b = this.rig.bones;
    sphere(b.head, 0.06, new THREE.Vector3(0, 0.05 * h, 0));
    sphere(b.upperChest ?? b.chest, 0.08);
    sphere(b.hips, 0.09);
    sphere(b.leftUpperLeg, 0.055, new THREE.Vector3(0, -0.08 * h, 0));
    sphere(b.rightUpperLeg, 0.055, new THREE.Vector3(0, -0.08 * h, 0));
    for (const chain of this.model.secondaryChains) {
      const skirt = /skirt|スカート|cloth|coat|cape/i.test(chain[0]!.name);
      for (let i = 0; i < chain.length; i++) {
        const bone = chain[i]!;
        const child = chain[i + 1] ?? null;
        const k = this.options.stiffness ?? 1;
        const g = this.options.gravity ?? 1;
        const joint = new VRMSpringBoneJoint(bone, child, { hitRadius: 0.012 * h, stiffness: (skirt ? 1.2 : 0.7) * k, gravityPower: (skirt ? 0.4 : 0.15) * g, gravityDir: new THREE.Vector3(0, -1, 0), dragForce: skirt ? 0.5 : 0.4 }, [group]);
        mgr.addJoint(joint);
      }
    }
    mgr.setInitState();
    this.springs = mgr;
  }

  dispose() {
    this.group.removeFromParent();
    this.model.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
    });
  }
}
