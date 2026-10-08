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
import { VRMSpringBoneColliderShapeCapsule, type VRMSpringBoneCollider } from '@pixiv/three-vrm';
import { BUILTIN_EMOTES, faceWeights, type Appearance, type Emotion, type HumanBone, type Physics, type SpringSettings, type Viseme } from '@everloom/engine';
import type { SkinPainter } from './skin';
import { applyCanonical, emptyPose, prepareRig, type CanonicalPose, type RigInfo } from './canonical';
import { blendPose, copyPose, sampleClip, UPPER_BODY, type Clip } from './clip';
import { clipIdFor, getClip } from './clips';
import { applyRestPose, withRestPose, type LoadedModel } from './loader';
import { applyLook, type Look, type LookOptions } from './materials';
import { MorphController } from './morphs';
import { generateColliders } from './physics/colliders';
import { makeCollider, SpringSolver, type Collider, type JointSettings } from './physics/solver';
import type { Wardrobe } from './wardrobe';
import type { Garments } from './garments';

export interface AvatarOptions {
  look: Look;
  outlines: boolean;
  physics: boolean;
  /** Multipliers for hair and cloth springs (saved per avatar). */
  stiffness?: number;
  gravity?: number;
  /** The avatar's saved physics settings (chest, picked chains, collider edits, wind, damping). */
  settings?: Partial<Physics>;
  /** Simulated points and solver rate for the device's quality level. */
  budget?: { points: number; hz: number };
}

/** A garment's or chain's spring settings as the solver takes them, with the avatar's multipliers. */
export function jointSettings(s: Partial<SpringSettings> = {}, k = 1, g = 1, kind: 'hair' | 'cloth' | 'chest' | 'tail' | 'accessory' = 'hair'): Partial<JointSettings> {
  const base = { hair: { stiffness: 0.7, drag: 0.4, gravity: 0.15 }, cloth: { stiffness: 1.2, drag: 0.5, gravity: 0.4 }, chest: { stiffness: 4, drag: 0.35, gravity: 0.08 }, tail: { stiffness: 0.9, drag: 0.4, gravity: 0.2 }, accessory: { stiffness: 1.5, drag: 0.5, gravity: 0.3 } }[kind];
  return { stiffness: (s.stiffness ?? 1) * base.stiffness * k, drag: s.damping ?? base.drag, gravity: (s.gravity ?? 1) * base.gravity * g, wind: s.wind ?? 0.5, ...(s.radius !== undefined ? { radius: s.radius } : {}) };
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
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const rotate = (q: THREE.Quaternion | undefined, x: number, y: number, z: number) => {
  if (!q) return;
  q.multiply(_q.setFromEuler(_e.set(x * DEG, y * DEG, z * DEG)));
};

/** Breast bones (chest physics, not hair chains). */
const CHEST = /breast|bust|boob|oppai|胸|おっぱい/i;

/** Emotes that hold their last frame (they're states, not gestures). */
const HOLD = new Set(['defeat', 'sleep', 'lie_down']);
const LYING = new Set(['defeat', 'sleep', 'lie_down']);

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
  /** Hair, cloth, tail and chest springs. */
  readonly physics = new SpringSolver();
  /** Body sliders: morphs by name on every mesh, garments included. */
  readonly morphs: MorphController;
  /** Off-screen (the stage pauses its springs). */
  physicsPaused = false;
  /** The avatar's own physics switch (the device's quality can still turn springs off). */
  wantsPhysics = true;
  /** Hold the file's rest pose, no animation (fitting a garment). */
  restPose = false;
  /** Runs after the pose is applied each frame (inverse kinematics for paired animations). */
  postPose: ((avatar: Avatar, dt: number) => void) | null = null;
  /** Skin layers baked onto the skin texture. */
  skin: SkinPainter | null = null;
  /** Hair and eye colours (re-applied to garments as they load). */
  appearance: Appearance | null = null;
  /** Wakes the stage's render loop (set by the stage). */
  kick: (() => void) | null = null;
  /** Has drawn at least one frame (before that, slider changes jump instead of easing). */
  started = false;
  private headTopOffset = 0;
  framingWidth = 0;
  /** True while anything besides the quiet idle is happening (the stage renders faster then). */
  busy = false;
  /** The face an emote wears while it plays (a laugh looks amused), and a held pose's own face. */
  private shotFace: Emotion | null = null;
  private baseFace: Emotion | null = null;
  /** Faces for emotes that aren't built in (imported clips). */
  static faces: Record<string, Emotion> = {};
  private faceOf(id: string): Emotion | null {
    return Avatar.faces[id] ?? BUILTIN_EMOTES.find((e) => e.id === id)?.emotion ?? null;
  }
  /** Playback rate for dances, so they follow the music's tempo. */
  danceRate = 1;
  get dancing() {
    return BUILTIN_EMOTES.find((e) => e.id === this.basePoseId)?.category === 'dance' || /^dance/.test(this.basePoseId);
  }
  /** The dance's own tempo (for fitting it to music), when known. */
  get danceBpm(): number | null {
    return BUILTIN_EMOTES.find((e) => e.id === this.basePoseId)?.bpm ?? null;
  }
  setDanceRate(r: number) {
    this.danceRate = r;
    if (this.base && this.dancing) (this.base as Layer & { rate?: number }).rate = r;
  }
  /** Where the held pose's clip is (group dances keep everyone on the same step). */
  get baseTime() {
    return this.base?.time ?? 0;
  }
  set baseTime(t: number) {
    if (this.base) this.base.time = t;
  }
  /** Parts, hidden regions and accessories (set by whoever placed the avatar). */
  wardrobe: Wardrobe | null = null;
  garments: Garments | null = null;
  /** A fixed pose instead of the animation layers (the import wizard's checks). */
  override: CanonicalPose | null = null;
  /** Fixed morph weights instead of the expression system (the wizard's face preview). */
  faceOverride: Record<string, number> | null = null;

  constructor(model: LoadedModel, options: AvatarOptions) {
    this.model = model;
    this.options = options;
    this.group.add(model.scene);
    this.morphs = new MorphController(model.scene);
    this.rig = prepareRig(model.scene, model.bones);
    // Models built facing away (VRM 0.x, MMD) are turned to face the camera. Retargeting works in
    // the rig's own frame, so this changes nothing else.
    if (Math.abs(this.rig.facing.w) < 0.5) model.scene.rotation.y += Math.PI;
    this.baseYaw = model.scene.rotation.y;
    // The model's feet stand on the group's origin.
    model.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model.scene);
    const headY = model.bones.head?.getWorldPosition(new THREE.Vector3()).y;
    this.headTopOffset = headY === undefined ? model.height * 0.1 : Math.max(0, box.max.y - headY);
    this.framingWidth = model.height * 0.18;
    for (const mesh of model.meshes) if (/head|face|hair/i.test(mesh.name)) this.framingWidth = Math.max(this.framingWidth, new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).x * 1.12);
    model.scene.position.y -= box.min.y - model.floor;
    this.setLook(options.look, { outlines: options.outlines });
    if (options.budget) { this.physics.maxPoints = options.budget.points; this.physics.hz = options.budget.hz || 30; }
    this.setupSprings();
    void this.setBase('idle');
  }

  get height() {
    return this.model.height;
  }

  /** How tall the character is right now (lower when sitting, kneeling or lying), smoothed. */
  poseHeight = 0;
  /** Lying down (or knocked down): the stage frames the whole body from above. */
  get lying() {
    return LYING.has(this.basePoseId);
  }
  private baseYaw = 0;
  private lieTurn = 0;
  private measurePose(dt: number) {
    const head = this.rig.bones.head;
    let h = this.model.height;
    if (head) {
      this.group.updateWorldMatrix(true, false);
      const y = head.getWorldPosition(_v).y - this.group.position.y;
      // The head bone sits below the top of the head; keep a margin, and never frame below a third.
      h = Math.max(this.model.height * 0.3, Math.min(this.model.height, y + this.headTopOffset));
    }
    this.poseHeight = this.poseHeight ? damp(this.poseHeight, h, 3, dt) : h;
    // Lying clips lie along the view; turn the body across the screen so it reads.
    this.lieTurn = damp(this.lieTurn, this.lying ? -Math.PI / 2 : 0, 4, dt);
    this.model.scene.rotation.y = this.baseYaw + this.lieTurn;
  }

  setLook(look: Look, opts: Partial<LookOptions> = {}) {
    this.options.look = look;
    if (opts.outlines !== undefined) this.options.outlines = opts.outlines;
    applyLook(this.model.scene, look, { outlines: this.options.outlines, ...opts });
    this.garments?.relook(look, this.options.outlines);
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
    this.baseFace = this.faceOf(emoteId);
    if (this.base) {
      this.base.target = 0;
      this.base.speed = 1 / Math.max(0.05, fade);
      this.fading.push(this.base);
    }
    this.base = { clip, time: HOLD.has(emoteId) ? clip.duration : 0, weight: this.fading.length ? 0 : 1, target: 1, speed: (1 / Math.max(0.05, fade)) * 1, hold: HOLD.has(emoteId) };
    this.base.time = 0;
    (this.base as Layer & { rate?: number }).rate = speed * (this.dancing ? this.danceRate : 1);
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
    const face = this.faceOf(emoteId);
    this.shotFace = face;
    this.playShot(clip, { fade: 0.25, onEnd: () => void (this.shotFace === face && (this.shotFace = null)) });
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
    this.started = true;
    if (this.restPose) {
      // Fitting: the body exactly as it was skinned, neutral shape, nothing moving.
      applyRestPose(this.model);
      this.physics.rest();
      this.busy = this.morphs.update(dt);
      this.measurePose(dt);
      return;
    }
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
    this.postPose?.(this, dt);
    this.measurePose(dt);
    if (this.morphs.update(dt)) this.busy = true;
    this.face(dt);
    if (this.options.physics && !this.physicsPaused) this.physics.update(dt);
    else if (!this.options.physics) this.physics.rest();
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
    // An emote's face wins while it plays; a held pose's face only when the story has none.
    const emotion = this.shotFace ?? (this.emotion === 'neutral' && this.baseFace ? this.baseFace : this.emotion);
    const target = this.faceOverride ?? faceWeights(this.model.expressions, { emotion, strength: this.emotionStrength, visemes: this.speaking ? this.visemes : undefined, blink });
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

  private bodyColliders: Collider[] | null = null;
  /** The chest springs (breast bones), so the strength slider can change them live. */
  private chestChains: number[] = [];

  private setupSprings() {
    const s = this.options.settings ?? {};
    this.physics.windStrength = s.wind ?? 0;
    const vrm = this.model.vrm?.springBoneManager;
    if (vrm && vrm.joints.size) this.addVrmSprings();
    else this.addSpringChains(this.model.secondaryChains.filter((c) => !CHEST.test(c[0]!.name)));
    // Chains the owner picked in the editor.
    const byName = new Map<string, THREE.Object3D>();
    this.model.scene.traverse((o) => { if (!byName.has(o.name)) byName.set(o.name, o); });
    for (const pick of s.chains ?? []) {
      const start = byName.get(pick.bone);
      if (!pick.on || !start || this.model.secondaryChains.some((c) => c[0] === start)) continue;
      const chain: THREE.Object3D[] = [start];
      for (let cur: THREE.Object3D = start; chain.length < 12;) { const next = cur.children.find((c) => (c as THREE.Bone).isBone); if (!next) break; chain.push(next); cur = next; }
      this.addSpringChains([chain], jointSettings(pick.settings, this.options.stiffness, this.options.gravity, pick.kind === 'chest' ? 'chest' : pick.kind === 'cloth' ? 'cloth' : pick.kind === 'tail' ? 'tail' : 'hair'));
    }
    this.setupChest();
  }

  /** The body's spheres and capsules (made once, from its proportions). */
  colliders(): Collider[] {
    if (!this.bodyColliders) {
      try { this.bodyColliders = generateColliders(this.model, this.options.settings?.colliders ?? []); }
      catch { this.bodyColliders = []; }
    }
    return this.bodyColliders;
  }

  /** Re-measures the colliders after the owner edits them (springs keep their chains). */
  setColliderEdits(edits: Physics['colliders']) {
    const fresh = generateColliders(this.model, edits);
    const current = this.colliders();
    for (let i = 0; i < Math.min(fresh.length, current.length); i++) Object.assign(current[i]!, { radius: fresh[i]!.radius, offset: fresh[i]!.offset, tail: fresh[i]!.tail, on: fresh[i]!.on });
  }

  /** VRM spring bones, read with their own settings and colliders, solved by the same solver. */
  private addVrmSprings() {
    const mgr = this.model.vrm!.springBoneManager!;
    const k = this.options.stiffness ?? 1, g = this.options.gravity ?? 1;
    const converted = new Map<VRMSpringBoneCollider, Collider>();
    const depth = (o: THREE.Object3D) => { let d = 0; for (let p = o.parent; p; p = p.parent) d++; return d; };
    for (const j of [...mgr.joints].sort((a, b) => depth(a.bone) - depth(b.bone))) {
      const colliders: Collider[] = [];
      for (const group of j.colliderGroups) for (const c of group.colliders) {
        let mine = converted.get(c);
        if (!mine) {
          c.updateWorldMatrix(true, false);
          const scale = new THREE.Vector3().setFromMatrixScale(c.matrixWorld).x || 1;
          const shape = c.shape as unknown as { offset: THREE.Vector3; radius: number; tail?: THREE.Vector3 };
          mine = makeCollider(c, shape.radius * scale, shape.offset.clone(), c.shape instanceof VRMSpringBoneColliderShapeCapsule && shape.tail ? shape.tail.clone() : null, c.parent?.name ?? 'vrm');
          converted.set(c, mine);
        }
        colliders.push(mine);
      }
      const scale = new THREE.Vector3().setFromMatrixScale(j.bone.matrixWorld).x || 1;
      // Each VRM joint is one bone aiming at its child (or 7 cm along itself, as VRM does).
      const tail = j.child ? j.child.position.clone() : j.bone.position.lengthSq() > 1e-12 ? j.bone.position.clone().normalize().multiplyScalar(0.07 / scale) : new THREE.Vector3(0, -0.07 / scale, 0);
      this.physics.addChain([j.bone], { stiffness: j.settings.stiffness * k, drag: j.settings.dragForce, gravity: j.settings.gravityPower * g, gravityDir: j.settings.gravityDir.clone(), radius: j.settings.hitRadius * scale, wind: 0.6 }, colliders, tail);
    }
  }

  /** The chest: breast bones swing a little, stiffly, scaled by the strength slider. */
  private setupChest() {
    const chest = this.options.settings?.chest ?? { enabled: true, strength: 1 };
    const torso = this.rig.bones.upperChest ?? this.rig.bones.chest ?? this.rig.bones.spine;
    if (!torso) return;
    const bones: THREE.Object3D[] = [];
    torso.parent?.traverse((o) => { if (CHEST.test(o.name) && (o as THREE.Bone).isBone && !Object.values(this.rig.bones).includes(o) && !CHEST.test(o.parent?.name ?? '')) bones.push(o); });
    const h = this.model.height;
    for (const bone of bones) {
      bone.updateWorldMatrix(true, false);
      const scale = new THREE.Vector3().setFromMatrixScale(bone.matrixWorld).x || 1;
      // Forward from the chest (the model faces +Z in its frame).
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.rig.facing).applyQuaternion(this.model.scene.getWorldQuaternion(new THREE.Quaternion()));
      const child = bone.children.find((c) => (c as THREE.Bone).isBone);
      const tail = child ? undefined : forward.applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()).invert()).multiplyScalar((0.06 * h) / scale);
      const id = this.physics.addChain([bone], { ...jointSettings({}, 1, 1, 'chest'), strength: chest.enabled ? chest.strength * 0.6 : 0, maxAngle: THREE.MathUtils.degToRad(16), radius: 0, wind: 0 }, [], tail);
      this.chestChains.push(id);
    }
  }

  /** Live damping for every chain but the chest (which keeps its own). */
  setDamping(damping: number) {
    for (const id of this.physics.chainIds()) if (!this.chestChains.includes(id)) this.physics.setChainSettings(id, { drag: damping });
  }

  /** Live chest settings (the strength slider and the off switch). */
  setChest(enabled: boolean, strength: number) {
    for (const id of this.chestChains) this.physics.setChainSettings(id, { strength: enabled ? strength * 0.6 : 0 });
  }

  get hasChestBones() { return this.chestChains.length > 0; }

  /** Makes bone chains swing (hair, skirts, capes); returns ids so they can be removed. */
  addSpringChains(chains: THREE.Object3D[][], settings?: Partial<JointSettings>): number[] {
    if (!chains.length) return [];
    const k = this.options.stiffness ?? 1;
    const g = this.options.gravity ?? 1;
    const h = this.model.height;
    const made: number[] = [];
    const colliders = this.colliders();
    for (const chain of chains) {
      const skirt = /skirt|スカート|cloth|coat|cape|cloak|dress|robe|EvSwing/i.test(chain[0]!.name);
      const saved = chain[0]!.userData.everloomSpring ?? {};
      const finite = (value: unknown, fallback: number, max: number) => (typeof value === 'number' && Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, max) : fallback);
      const direction = Array.isArray(saved.gravityDir) && saved.gravityDir.length === 3 && saved.gravityDir.every((n: unknown) => typeof n === 'number' && Number.isFinite(n)) ? new THREE.Vector3().fromArray(saved.gravityDir).normalize() : new THREE.Vector3(0, -1, 0);
      const fromFile: Partial<JointSettings> = { radius: finite(saved.hitRadius, 0.012 * h, h * 0.2), stiffness: finite(saved.stiffness, skirt ? 1.2 : 0.7, 20) * k, gravity: finite(saved.gravityPower, skirt ? 0.4 : 0.15, 20) * g, gravityDir: direction, drag: finite(saved.dragForce, this.options.settings?.damping ?? (skirt ? 0.5 : 0.4), 1) };
      // Added in the rest pose, so contact the garment was made with (hair on the shoulders) is
      // measured as it was authored; then the chain starts from the pose the body is in now.
      made.push(withRestPose(this.model, () => this.physics.addChain(chain, { ...fromFile, ...settings }, colliders)));
    }
    for (const id of made) this.physics.reset(id);
    return made;
  }

  removeSpringJoints(chains: number[]) {
    for (const id of chains) this.physics.removeChain(id);
  }

  dispose() {
    this.wardrobe?.dispose();
    this.garments?.dispose();
    this.skin?.dispose();
    this.group.removeFromParent();
    this.model.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
    });
    for (const t of (this.model.scene.userData.disposables as THREE.Texture[] | undefined) ?? []) t.dispose();
  }
}
