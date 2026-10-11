/**
 * The 3D stage: one WebGL canvas for every 3D character in a scene, so they share lights, shadows
 * and a camera that moves between speakers. Sprites and Live2D stay in the page around it.
 *
 * Performance: rendering stops when the tab is hidden or the canvas is off screen, runs at a lower
 * rate when nothing is moving, and in "auto" quality steps resolution, shadows, outlines and
 * physics down when frames run long (and back up when there's room).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { PHYSICS_BUDGET } from '@everloom/engine';
import { Avatar, type AvatarOptions } from './avatar';
import { applyLighting, makeLights, PRESETS, type LightingPreset, type StageLights } from './lighting';
import type { LoadedModel } from './loader';

export type Quality = 'low' | 'medium' | 'high' | 'auto';
export type Framing = 'portrait' | 'half' | 'full';
export type Slot = 'left' | 'center' | 'right' | 'off';

interface Level {
  pixelRatio: number;
  shadows: boolean;
  outlines: boolean;
  physics: boolean;
}
const LEVELS: Level[] = [
  { pixelRatio: 0.75, shadows: false, outlines: false, physics: false },
  { pixelRatio: 1, shadows: false, outlines: true, physics: true },
  { pixelRatio: 1.5, shadows: true, outlines: true, physics: true },
  { pixelRatio: 2, shadows: true, outlines: true, physics: true },
];
const LEVEL_FOR: Record<Exclude<Quality, 'auto'>, number> = { low: 0, medium: 1, high: 3 };

export interface StageOptions {
  quality: Quality;
  fpsCap: number;
  physics: boolean;
  outlines: boolean;
  transparent?: boolean;
}

export interface StageStats {
  fps: number;
  frameMs: number;
  level: number;
  avatars: number;
  drawCalls: number;
  triangles: number;
  paused: boolean;
}

interface Entry {
  avatar: Avatar;
  slot: Slot;
  shadow: THREE.Mesh;
  x: number;
  /** Walk in from / out to the side. */
  enter: number;
  /** Held in place by a paired animation (position on the floor and facing). */
  pin: { x: number; z: number; yaw: number; face?: string } | null;
}

let blobTexture: THREE.Texture | null = null;
function blob(): THREE.Texture {
  if (blobTexture) return blobTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  blobTexture = new THREE.CanvasTexture(c);
  return blobTexture;
}

export class Stage3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(28, 1, 0.05, 100);
  private lights: StageLights;
  private ground: THREE.Mesh;
  private entries = new Map<string, Entry>();
  private opts: StageOptions;
  private level: number;
  private raf = 0;
  private last = 0;
  private lastRender = 0;
  private hidden = false;
  private offscreen = false;
  private running = false;
  private io: IntersectionObserver | null = null;
  private ro: ResizeObserver | null = null;
  private frameTimes: number[] = [];
  private slowFor = 0;
  private fastFor = 0;
  private preset: LightingPreset = PRESETS.studio;
  private camTarget = new THREE.Vector3(0, 1.3, 0);
  private camPos = new THREE.Vector3(0, 1.4, 4);
  private framing: Framing = 'half';
  private speaker: string | null = null;
  private controls: OrbitControls | null = null;
  private drift = Math.random() * 10;
  /** Fraction of the canvas at the bottom that other UI covers (the dialogue box). */
  private safeBottom = 0;
  private environment: THREE.WebGLRenderTarget;
  private disposed = false;
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  /** Paired animations: positions and the shared clock, run before avatars update (see paired.ts). */
  pairs: ((dt: number) => void) | null = null;
  /** Run after the avatars each frame (editor overlays). */
  readonly tickers = new Set<(dt: number) => void>();
  /** Called after every rendered frame (tests read stats here). */
  onFrame: ((s: StageStats) => void) | null = null;
  onError: ((reason: string) => void) | null = null;
  stats: StageStats = { fps: 0, frameMs: 0, level: 0, avatars: 0, drawCalls: 0, triangles: 0, paused: false };

  constructor(readonly canvas: HTMLCanvasElement, opts: StageOptions) {
    this.opts = opts;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: opts.transparent ?? true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.debug.onShaderError = (gl, _program, _vertex, fragment) => { throw new Error(`The model shader could not compile on this device. ${(gl.getShaderInfoLog(fragment) ?? '').slice(0, 240)}`); };
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.35;
    room.dispose(); pmrem.dispose();
    if (opts.quality !== 'low') void this.loadEnvironment();
    this.level = opts.quality === 'auto' ? (window.innerWidth < 700 ? 1 : 2) : LEVEL_FOR[opts.quality];
    this.lights = makeLights(this.scene);
    // A floor that only shows shadows.
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.22 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.applyLevel();
    document.addEventListener('visibilitychange', this.onVisibility);
    if (typeof IntersectionObserver !== 'undefined') {
      this.io = new IntersectionObserver((es) => {
        this.offscreen = !es.some((e) => e.isIntersecting);
        this.kick();
      });
      this.io.observe(canvas);
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(canvas);
    }
    this.resize();
  }

  private async loadEnvironment() {
    let texture: THREE.DataTexture | undefined;
    try {
      const response = await fetch('/avatar/env/studio_small_09_1k.hdr', { signal: AbortSignal.timeout(15000) });
      if (!response.ok) return;
      const data = new HDRLoader().parse(await response.arrayBuffer());
      if (this.disposed || !data.data) return;
      texture = new THREE.DataTexture(data.data, data.width, data.height, data.format ?? THREE.RGBAFormat, data.type);
      texture.colorSpace = THREE.LinearSRGBColorSpace; texture.mapping = THREE.EquirectangularReflectionMapping; texture.flipY = true;
      texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
      const generator = new THREE.PMREMGenerator(this.renderer);
      try {
        const next = generator.fromEquirectangular(texture);
        this.environment.dispose(); this.environment = next; this.scene.environment = next.texture; this.scene.environmentIntensity = 0.25;
      } finally { generator.dispose(); }
      this.kick();
    } catch { /* Optional lighting never blocks the model; the room probe remains. */ }
    finally { texture?.dispose(); }
  }

  private onVisibility = () => {
    this.hidden = document.hidden;
    this.kick();
  };

  get qualityLevel() {
    return this.level;
  }

  setOptions(o: Partial<StageOptions>) {
    this.opts = { ...this.opts, ...o };
    if (o.quality && o.quality !== 'auto') this.level = LEVEL_FOR[o.quality];
    this.applyLevel();
  }

  private applyLevel() {
    const L = LEVELS[this.level]!;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, L.pixelRatio));
    this.renderer.shadowMap.enabled = L.shadows;
    this.lights.key.castShadow = L.shadows;
    this.ground.visible = L.shadows;
    for (const e of this.entries.values()) {
      e.avatar.options.physics = L.physics && this.opts.physics && e.avatar.wantsPhysics;
      this.physicsBudget(e.avatar);
      e.avatar.setLook(e.avatar.options.look, { outlines: L.outlines && this.opts.outlines });
      e.avatar.model.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = L.shadows;
      });
    }
    this.stats.level = this.level;
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || 300;
    const h = this.canvas.clientHeight || 400;
    this.renderer.setSize(w, h, false);
    // Frame the shot in the uncovered part; the rest of the picture continues below it, behind the UI.
    const vh = h * (1 - this.safeBottom);
    this.camera.aspect = w / vh;
    if (this.safeBottom > 0) this.camera.setViewOffset(w, vh, 0, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.kick();
  }

  /** The bottom fraction of the canvas that the page covers (0–0.6). */
  setSafeArea(bottom: number) {
    const b = Math.max(0, Math.min(0.6, bottom));
    if (Math.abs(b - this.safeBottom) < 0.001) return;
    this.safeBottom = b;
    this.resize();
  }

  // ------------------------------------------------------------------ avatars

  add(id: string, model: LoadedModel, opts: Partial<AvatarOptions> = {}): Avatar {
    this.remove(id);
    const L = LEVELS[this.level]!;
    const budget = PHYSICS_BUDGET[this.level] ?? PHYSICS_BUDGET[PHYSICS_BUDGET.length - 1]!;
    const avatar = new Avatar(model, { look: opts.look ?? 'toon', outlines: (opts.outlines ?? true) && L.outlines && this.opts.outlines, physics: (opts.physics ?? true) && L.physics && this.opts.physics, stiffness: opts.stiffness, gravity: opts.gravity, settings: opts.settings, rig: opts.rig, budget: { points: Math.max(PHYSICS_BUDGET[1].points, budget.points), hz: budget.hz } });
    avatar.wantsPhysics = opts.physics ?? true;
    avatar.kick = () => this.kick();
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blob(), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.002;
    shadow.scale.setScalar(model.height * 0.42);
    avatar.group.add(shadow);
    avatar.model.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = L.shadows;
    });
    this.scene.add(avatar.group);
    this.entries.set(id, { avatar, slot: 'center', shadow, x: 0, enter: 0, pin: null });
    this.layout(true);
    this.kick();
    return avatar;
  }

  /** Cheaper springs on lower quality levels: fewer simulated points and a slower step. */
  private physicsBudget(avatar: Avatar) {
    const budget = PHYSICS_BUDGET[this.level] ?? PHYSICS_BUDGET[PHYSICS_BUDGET.length - 1]!;
    // Points already simulated stay (removing chains mid-scene would pop); the rate drops at once.
    avatar.physics.hz = budget.hz || PHYSICS_BUDGET[1].hz;
  }

  get(id: string): Avatar | undefined {
    return this.entries.get(id)?.avatar;
  }

  ids() {
    return [...this.entries.keys()];
  }

  remove(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    e.avatar.dispose();
    this.entries.delete(id);
    this.layout(true);
  }

  /** Where each avatar stands. Avatars without a slot share the stage evenly. */
  setSlots(slots: Record<string, Slot | undefined>, speaker: string | null) {
    for (const [id, e] of this.entries) e.slot = slots[id] ?? e.slot;
    this.speaker = speaker;
    this.layout(false);
  }

  /** Holds a character at a spot and facing (paired animations); null hands it back to its slot. */
  pin(id: string, at: { x: number; z: number; yaw: number; face?: string } | null) {
    const e = this.entries.get(id);
    if (!e) return;
    e.pin = at;
    this.kick();
  }

  /** Where a character's slot puts it across the stage. */
  slotX(id: string): number | null {
    return this.entries.get(id)?.x ?? null;
  }

  setFraming(f: Framing) {
    this.framing = f;
    this.snapCamera();
    this.kick();
  }

  setLighting(p: LightingPreset) {
    this.preset = p;
    this.kick();
  }

  /** Pauses look-around while something else uses the pointer (the fitting gizmo). */
  setOrbitEnabled(on: boolean) {
    if (this.controls) this.controls.enabled = on;
  }

  /** Inspect mode: drag and pinch to orbit (true), back to the directed camera (false). */
  setInspect(on: boolean) {
    if (on && !this.controls) {
      this.controls = new OrbitControls(this.camera, this.canvas);
      this.controls.target.copy(this.camTarget);
      this.controls.enableDamping = true;
      this.controls.enablePan = false;
      this.controls.minDistance = 0.4;
      this.controls.maxDistance = 12;
      this.controls.addEventListener('change', () => this.kick());
    } else if (!on && this.controls) {
      this.controls.dispose();
      this.controls = null;
    }
    this.kick();
  }

  private layout(snap: boolean) {
    const list = [...this.entries.values()].filter((e) => e.slot !== 'off');
    const maxH = Math.max(1, ...list.map((e) => e.avatar.height));
    const gap = maxH * 0.42;
    const fixed: Record<string, number> = { left: -1, center: 0, right: 1 };
    const auto = list.length <= 1 ? [0] : list.map((_, i) => (i - (list.length - 1) / 2) * (2 / Math.max(1, list.length - 1)));
    list.forEach((e, i) => {
      const anyDirected = list.some((x) => x.slot !== 'center');
      e.x = (anyDirected ? fixed[e.slot]! : auto[i]!) * gap * (list.length > 2 ? 1.1 : 1);
      if (snap) e.avatar.group.position.x = e.x;
    });
    for (const e of this.entries.values()) e.avatar.group.visible = e.slot !== 'off';
  }

  // ------------------------------------------------------------------ loop

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Wake the loop (after it paused). */
  kick() {
    if (this.running && !this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (!this.running) return;
    const paused = this.hidden || this.offscreen;
    this.stats.paused = paused;
    if (paused) {
      // Sleep until visibility changes (kick() restarts us).
      this.last = now;
      return;
    }
    const busy = [...this.entries.values()].some((e) => e.avatar.busy) || !!this.controls;
    // Nothing moving but breathing: 30 fps is plenty.
    const cap = busy ? this.opts.fpsCap : Math.min(30, this.opts.fpsCap);
    if (now - this.lastRender < 1000 / cap - 2) {
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.lastRender = now;
    const t0 = performance.now();
    try {
      this.step(dt);
      this.renderer.render(this.scene, this.camera);
      this.measure(performance.now() - t0, dt);
      this.onFrame?.(this.stats);
    } catch (error) { this.stop(); this.onError?.((error as Error).message); return; }
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Advances everything by dt seconds without rendering (tests drive it directly). */
  step(dt: number) {
    const list = [...this.entries.entries()];
    const speakerEntry = this.speaker ? this.entries.get(this.speaker) : undefined;
    // Characters out of the shot don't need their springs solved.
    this.camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.projScreen.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    for (const [, e] of list) {
      const h = e.avatar.height;
      this.sphere.center.copy(e.avatar.group.position).setY(e.avatar.group.position.y + h * 0.5);
      this.sphere.radius = h * 0.75;
      e.avatar.physicsPaused = e.slot === 'off' || !this.frustum.intersectsSphere(this.sphere);
    }
    this.pairs?.(dt);
    for (const [id, e] of list) {
      const g = e.avatar.group;
      const k = 1 - Math.exp(-4 * dt);
      g.position.x += ((e.pin?.x ?? e.x) - g.position.x) * k;
      g.position.z += ((e.pin?.z ?? 0) - g.position.z) * k;
      // Turn a little toward whoever speaks (or toward the camera); a paired clip sets the facing.
      const towards = e.pin ? e.pin.yaw : speakerEntry && speakerEntry !== e ? Math.atan2(speakerEntry.avatar.group.position.x - g.position.x, 3) * 0.6 : 0;
      g.rotation.y += (towards - g.rotation.y) * (1 - Math.exp(-(e.pin ? 5 : 3) * dt));
      const partner = e.pin?.face ? this.entries.get(e.pin.face) : undefined;
      e.avatar.lookAt = partner ? partner.avatar.rig.bones.head?.getWorldPosition(new THREE.Vector3()) ?? null : !e.pin && speakerEntry && this.speaker !== id ? speakerEntry.avatar.rig.bones.head?.getWorldPosition(new THREE.Vector3()) ?? null : null;
      e.avatar.update(dt, this.camera);
    }
    this.syncDances();
    for (const t of this.tickers) t(dt);
    this.updateCamera(dt);
    const size = Math.max(1, ...list.map(([, e]) => e.avatar.height));
    applyLighting(this.lights, this.preset, this.camTarget.clone().setY(0), size, 1 - Math.exp(-2 * dt));
    this.renderer.toneMappingExposure += (this.preset.exposure - this.renderer.toneMappingExposure) * (1 - Math.exp(-2 * dt));
  }

  /** Characters doing the same dance stay on the same step (the first one leads). */
  private syncDances() {
    const lead = new Map<string, Avatar>();
    for (const e of this.entries.values()) {
      const a = e.avatar;
      if (!a.dancing) continue;
      const l = lead.get(a.basePoseId);
      if (!l) lead.set(a.basePoseId, a);
      else if (Math.abs(a.baseTime - l.baseTime) > 0.04) a.baseTime = l.baseTime;
    }
  }

  private updateCamera(dt: number) {
    const list = [...this.entries.values()].filter((e) => e.slot !== 'off');
    if (!list.length) return;
    // Frame what is standing there now: a seated or lying character brings the camera down.
    const h = list.every((e) => e.avatar.lying) ? Math.max(...list.map((e) => e.avatar.height)) : Math.max(...list.map((e) => e.avatar.poseHeight || e.avatar.height));
    const xs = list.map((e) => e.pin?.x ?? e.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const speaker = this.speaker ? this.entries.get(this.speaker) : undefined;
    // Frame everyone, leaning toward the speaker.
    const cx = (minX + maxX) / 2 * 0.7 + (speaker ? speaker.x * 0.3 : (minX + maxX) / 2 * 0.3);
    // Everyone lying down: the whole body, from a little above.
    const allLying = list.every((e) => e.avatar.lying);
    const frame = allLying ? { y: 0.12, span: 0.7 } : { portrait: { y: 0.9, span: 0.28 }, half: { y: 0.7, span: 0.62 }, full: { y: 0.5, span: 1.15 } }[this.framing];
    const spanY = h * frame.span;
    const spanX = (maxX - minX) + Math.max(h * (allLying ? 1.3 : this.framing === 'portrait' ? 0.24 : 0.62), ...list.map(entry => entry.avatar.framingWidth));
    const fovY = (this.camera.fov * Math.PI) / 180;
    const distY = spanY / 2 / Math.tan(fovY / 2);
    const distX = spanX / 2 / (Math.tan(fovY / 2) * this.camera.aspect);
    const dist = Math.max(distY, distX) * 1.08;
    // A slow drift so the shot never feels frozen.
    this.drift += dt;
    const dx = Math.sin(this.drift * 0.21) * h * 0.012;
    const dy = Math.sin(this.drift * 0.17 + 1) * h * 0.006;
    const target = new THREE.Vector3(cx, h * frame.y, 0);
    const pos = new THREE.Vector3(cx + dx, h * frame.y + h * (allLying ? 0.5 : 0.02) + dy, dist);
    const k = 1 - Math.exp(-2.5 * dt);
    this.camTarget.lerp(target, k);
    this.camPos.lerp(pos, k);
    if (this.controls) {
      this.controls.update();
      return;
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  /** Snap the camera to its framing (first frame, or after "reset view"). */
  snapCamera() {
    this.updateCamera(10);
    this.updateCamera(10);
    if (this.controls) {
      this.controls.target.copy(this.camTarget);
      this.camera.position.copy(this.camPos);
    }
  }

  private measure(ms: number, dt: number) {
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.stats.fps = Math.round(1000 / Math.max(1, avg));
    this.stats.frameMs = Math.round(ms * 10) / 10;
    this.stats.avatars = this.entries.size;
    this.stats.drawCalls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
    if (this.opts.quality !== 'auto') return;
    // Step down after ~2 s of slow frames; up after ~10 s of easy ones.
    const budget = 1000 / Math.min(this.opts.fpsCap, 60);
    if (avg > budget * 1.35) this.slowFor += dt;
    else this.slowFor = Math.max(0, this.slowFor - dt);
    if (avg < budget * 0.7 && ms < budget * 0.35) this.fastFor += dt;
    else this.fastFor = 0;
    if (this.slowFor > 2 && this.level > 0) {
      this.level--;
      this.slowFor = 0;
      this.frameTimes = [];
      this.applyLevel();
    } else if (this.fastFor > 10 && this.level < LEVELS.length - 2) {
      this.level++;
      this.fastFor = 0;
      this.applyLevel();
    }
  }

  dispose() {
    this.disposed = true;
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.io?.disconnect();
    this.ro?.disconnect();
    this.controls?.dispose();
    for (const id of [...this.entries.keys()]) this.remove(id);
    this.environment.dispose();
    this.renderer.dispose();
  }
}

/** WebGL2 and a reasonable device: otherwise characters stay sprites. */
export function canRender3D(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}
