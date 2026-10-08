/**
 * Puppets on one canvas: loads models and their texture pages (cached by URL), runs each puppet's
 * animator, and draws them back to front. Rendering runs at the frame cap while anyone is talking
 * or moving and drops to 30 fps when only breathing; it stops when the tab or the canvas is hidden.
 * The resolution follows the quality setting.
 */
import { PuppetAnimator, parsePuppet, type PuppetModel } from '@everloom/engine';
import { NO_SHIFT, PuppetRenderer, type ColorShift, type DrawInstance } from './renderer';

export type PuppetQuality = 'low' | 'medium' | 'high';
const PIXEL_RATIO: Record<PuppetQuality, number> = { low: 1, medium: 1.5, high: 2 };

const models = new Map<string, Promise<PuppetModel>>();
export function loadModel(url: string): Promise<PuppetModel> {
  let p = models.get(url);
  if (!p) {
    p = fetch(url).then(async (r) => { if (!r.ok) throw new Error(`Puppet not found (${r.status})`); return parsePuppet(await r.json()); });
    p.catch(() => models.delete(url));
    models.set(url, p);
  }
  return p;
}

async function loadImage(url: string): Promise<ImageBitmap> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Puppet texture not found (${r.status})`);
  // Premultiplied here: WebGL's UNPACK_PREMULTIPLY_ALPHA flag doesn't apply to ImageBitmaps.
  return createImageBitmap(await r.blob(), { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' });
}

export interface PuppetSlotOptions {
  /** Where the puppet stands: centre x (0–1 of the width), floor y (0–1 of the height), height (0–1). */
  x: number;
  floor: number;
  height: number;
  flip?: boolean;
  /** 0 (front) to 1 (back): further back draws first and a little dimmer. */
  depth?: number;
  opacity?: number;
}

export class PuppetInstance {
  readonly animator: PuppetAnimator;
  textures: WebGLTexture[] = [];
  place: PuppetSlotOptions = { x: 0.5, floor: 1, height: 0.9 };
  shifts = new Map<string, ColorShift>();
  hidden = new Set<string>();
  /** Lighting to match the background (multiplied). */
  light: [number, number, number] = [1, 1, 1];
  constructor(readonly id: string, readonly model: PuppetModel) {
    this.animator = new PuppetAnimator(model);
  }
  /** Shift a colour group so its base colour becomes `hex` (shading kept). */
  recolor(group: string, hex: string | null) {
    const base = this.model.colors[group];
    if (!base || !hex) { this.shifts.delete(group); return; }
    this.shifts.set(group, shiftBetween(base, hex));
  }
}

/** The hue/saturation/brightness shift that turns colour a into colour b. */
export function shiftBetween(a: string, b: string): ColorShift {
  const [h0, s0, v0] = hsv(a), [h1, s1, v1] = hsv(b);
  if (s0 < 0.04) return { hue: 0, sat: 1, val: v0 > 0.01 ? v1 / v0 : 1 };
  return { hue: h1 - h0, sat: s0 > 0.01 ? s1 / s0 : 1, val: v0 > 0.01 ? v1 / v0 : 1 };
}
function hsv(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h / 6) + 1) % 1, max ? d / max : 0, max];
}

export class PuppetStage {
  readonly renderer: PuppetRenderer;
  private list = new Map<string, PuppetInstance>();
  private textureCache = new Map<string, Promise<WebGLTexture>>();
  private raf = 0;
  /** Set by dispose: a stage that is gone never draws again (its canvas may already have a new stage). */
  private disposed = false;
  private last = 0;
  private lastDraw = 0;
  private hidden = false;
  private offscreen = false;
  private io: IntersectionObserver | null = null;
  quality: PuppetQuality = 'medium';
  fpsCap = 60;
  /** Frame stats for tests and the performance check. */
  stats = { fps: 0, frameMs: 0, drawCalls: 0, puppets: 0, paused: false };
  private frameTimes: number[] = [];
  onFrame: (() => void) | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new PuppetRenderer(canvas);
    document.addEventListener('visibilitychange', this.onVisibility);
    if (typeof IntersectionObserver !== 'undefined') {
      this.io = new IntersectionObserver((es) => { this.offscreen = !es.some((e) => e.isIntersecting); this.kick(); });
      this.io.observe(canvas);
    }
    this.kick();
  }

  private onVisibility = () => { this.hidden = document.hidden; this.kick(); };

  private tex(url: string): Promise<WebGLTexture> {
    let t = this.textureCache.get(url);
    if (!t) {
      t = loadImage(url).then((img) => { const tx = this.renderer.texture(img); img.close(); return tx; });
      t.catch(() => this.textureCache.delete(url));
      this.textureCache.set(url, t);
    }
    return t;
  }

  /** Adds (or replaces) a puppet from a model URL; textures resolve next to it. */
  async add(id: string, url: string): Promise<PuppetInstance> {
    const model = await loadModel(url);
    const base = new URL(url, location.href);
    const inst = new PuppetInstance(id, model);
    inst.textures = await Promise.all(model.textures.map((t) => this.tex(new URL(t, base).href)));
    // Disposed while loading (a remount): don't bring a dead stage back to life.
    if (this.disposed) return inst;
    this.list.set(id, inst);
    this.kick();
    return inst;
  }

  get(id: string) { return this.list.get(id); }
  ids() { return [...this.list.keys()]; }
  remove(id: string) { this.list.delete(id); this.kick(); }

  kick() {
    if (!this.raf && !this.disposed) this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    const paused = this.hidden || this.offscreen;
    this.stats.paused = paused;
    if (paused) { this.last = now; return; }
    const busy = [...this.list.values()].some((p) => p.animator.busy);
    const cap = busy ? this.fpsCap : Math.min(30, this.fpsCap);
    if (now - this.lastDraw < 1000 / cap - 2) { this.raf = requestAnimationFrame(this.frame); return; }
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    this.lastDraw = now;
    const t0 = performance.now();
    this.step(dt);
    this.render();
    this.measure(performance.now() - t0, dt);
    this.onFrame?.();
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Advances every puppet by dt seconds (tests drive it directly). */
  step(dt: number) { for (const p of this.list.values()) p.animator.update(dt); }

  render() {
    const pr = Math.min(window.devicePixelRatio || 1, PIXEL_RATIO[this.quality]);
    const W = Math.max(1, Math.round(this.canvas.clientWidth * pr)), H = Math.max(1, Math.round(this.canvas.clientHeight * pr));
    this.renderer.resize(W, H);
    const order = [...this.list.values()].sort((a, b) => (b.place.depth ?? 0) - (a.place.depth ?? 0));
    const draws: DrawInstance[] = order.map((p) => {
      const m = p.model, top = m.anchors.headTop ?? 0, floor = m.anchors.floor ?? m.canvas.height;
      // The figure from the top of the head to the floor anchor fills `height` of the canvas.
      const scale = (p.place.height * H) / Math.max(1, floor - top);
      const cx = m.anchors.centerX ?? m.canvas.width / 2;
      const dim = 1 - (p.place.depth ?? 0) * 0.15;
      return { model: m, rig: p.animator.rig, textures: p.textures, x: p.place.x * W - cx * scale, y: p.place.floor * H - floor * scale, scale, flip: !!p.place.flip, shifts: p.shifts.size ? p.shifts : new Map([['', NO_SHIFT]]), tint: [p.light[0] * dim, p.light[1] * dim, p.light[2] * dim, p.place.opacity ?? 1], hidden: p.hidden };
    });
    this.renderer.draw(draws);
    this.stats.drawCalls = this.renderer.drawCalls;
    this.stats.puppets = draws.length;
  }

  private measure(ms: number, dt: number) {
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.stats.fps = Math.round(1000 / Math.max(1, avg));
    this.stats.frameMs = Math.round(ms * 10) / 10;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.io?.disconnect();
    this.renderer.dispose();
    this.list.clear();
  }
}
