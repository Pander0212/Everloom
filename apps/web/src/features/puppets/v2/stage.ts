/**
 * The Puppets v2 stage: several characters on one canvas, each a set of views (front, three-quarter,
 * side, back: one auto-rigged Rev2D model per view) with a base motion (idle, walk…), one-shot
 * gestures layered on top, turning between views (a short cross-fade) and walking across the stage
 * (profile view, feet locked to the floor by the walk's ground speed). Physics runs per character in
 * a Rev2D Player at a fixed 60 Hz. Pauses when the tab is hidden.
 */
import { Player, Rig, buildRenderList, type AnimationLayer, type Model } from '@everloom/engine/puppet2';
import { Puppet2Renderer, type Draw2 } from './renderer';

export type View2 = 'front' | 'threeQuarter' | 'side' | 'back';
export interface ViewSource { model: Model; images: Record<string, TexImageSource> }

interface ViewState { rig: Rig; player: Player; textures: Map<string, WebGLTexture>; rootX: number; rootY: number; walkSpeed: number }

export interface Puppet2 {
  id: string;
  views: Partial<Record<View2, ViewState>>;
  view: View2;
  /** The view being faded out after a turn, and when the turn started. */
  turning: { from: View2; at: number } | null;
  /** Feet position as a fraction of the stage width, floor as a fraction of its height, height of the figure likewise. */
  x: number; floor: number; height: number;
  /** Mirror the art (side art faces left; flipped it faces right). */
  flip: boolean;
  base: { id: string; at: number };
  prevBase: { id: string; at: number; until: number } | null;
  gesture: { id: string; at: number } | null;
  /** Walking to this x (fraction of the stage), then back to idle and the front view. */
  walkTo: number | null;
  /** Held parameter values (the lab sliders, a pose from the story). */
  params: Record<string, number>;
  hidden: Set<string>;
  alpha: number;
  /** Talking (lip-sync from the line being spoken), the face's expression index, and blinking. */
  speaking: boolean;
  expression: number;
  life: { blinkAt: number; mouthAt: number; mouth: number };
}

const FADE = 0.3, TURN = 0.25;

export class Puppet2Stage {
  readonly renderer: Puppet2Renderer;
  private puppets = new Map<string, Puppet2>();
  private raf = 0;
  private last = 0;
  private time = 0;
  private frameTimes: number[] = [];
  /** Pixel ratio cap (phones: 1.5; the decision record's 60 fps budget assumes no MSAA). */
  maxPixelRatio = 1.5;
  stats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, puppets: 0, paused: false };
  onFrame: (() => void) | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new Puppet2Renderer(canvas);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  ids() { return [...this.puppets.keys()]; }
  get(id: string) { return this.puppets.get(id); }

  add(id: string, views: Partial<Record<View2, ViewSource>>, place: Partial<Pick<Puppet2, 'x' | 'floor' | 'height' | 'flip'>> = {}): Puppet2 {
    this.remove(id);
    const vs: Puppet2['views'] = {};
    for (const [v, src] of Object.entries(views) as Array<[View2, ViewSource]>) {
      const rig = new Rig(src.model);
      const textures = new Map<string, WebGLTexture>();
      for (const [tid, img] of Object.entries(src.images)) textures.set(tid, this.renderer.texture(img));
      const root = src.model.bones.find((b) => b.id === 'root');
      const walk = src.model.animations.find((a) => a.id === 'walk');
      const speed = (walk?.events?.find((e) => e.name === 'locomotion')?.data as { speed?: number } | undefined)?.speed ?? 0;
      vs[v] = { rig, player: rig.player(), textures, rootX: root?.x ?? src.model.meta.width / 2, rootY: root?.y ?? src.model.meta.height, walkSpeed: speed };
    }
    const first = (['front', 'threeQuarter', 'side', 'back'] as View2[]).find((v) => vs[v]);
    if (!first) throw new Error('A puppet needs at least one view.');
    const p: Puppet2 = { id, views: vs, view: first, turning: null, x: 0.5, floor: 0.97, height: 0.9, flip: false, ...place,
      base: { id: 'idle', at: this.time }, prevBase: null, gesture: null, walkTo: null, params: {}, hidden: new Set(), alpha: 1,
      speaking: false, expression: 0, life: { blinkAt: this.time + 1 + Math.random() * 3, mouthAt: 0, mouth: 0 } };
    this.puppets.set(id, p);
    return p;
  }

  remove(id: string) {
    const p = this.puppets.get(id);
    if (!p) return;
    for (const v of Object.values(p.views)) for (const t of v.textures.values()) this.renderer.deleteTexture(t);
    this.puppets.delete(id);
  }

  /** Changes the looping base motion (idle, walk, armsCrossed…), cross-fading from the old one. */
  setBase(id: string, motion: string) {
    const p = this.puppets.get(id);
    if (!p || p.base.id === motion) return;
    p.prevBase = { ...p.base, until: this.time + FADE };
    p.base = { id: motion, at: this.time };
  }
  /** Plays a one-shot or timed gesture over the base motion (wave_L, nod, jump…). */
  gesture(id: string, motion: string) {
    const p = this.puppets.get(id);
    if (p) p.gesture = { id: motion, at: this.time };
  }
  /** Turns to another view if the character has it (a short cross-fade between the two rigs). */
  setView(id: string, view: View2) {
    const p = this.puppets.get(id);
    if (!p || p.view === view || !p.views[view]) return false;
    p.turning = { from: p.view, at: this.time };
    p.view = view;
    return true;
  }
  /** Walks to x (fraction of the stage): turns to the profile, walks with locked feet, turns back. */
  walkTo(id: string, x: number) {
    const p = this.puppets.get(id);
    if (!p) return;
    p.walkTo = Math.max(0.05, Math.min(0.95, x));
    if (p.views.side) { this.setView(id, 'side'); p.flip = p.walkTo > p.x; }
    this.setBase(id, 'walk');
  }

  private layers(p: Puppet2, v: ViewState): AnimationLayer[] {
    const has = (a: string) => v.rig.model.animations.some((m) => m.id === a);
    const out: AnimationLayer[] = [];
    const t = this.time;
    if (p.prevBase && t < p.prevBase.until && has(p.prevBase.id)) out.push({ id: p.prevBase.id, start: p.prevBase.at, weight: (p.prevBase.until - t) / FADE });
    if (has(p.base.id)) out.push({ id: p.base.id, start: p.base.at, weight: p.prevBase && t < p.prevBase.until ? 1 - (p.prevBase.until - t) / FADE : 1 });
    if (p.gesture && has(p.gesture.id)) {
      const g = v.rig.model.animations.find((m) => m.id === p.gesture!.id)!;
      // A gesture plays one cycle (a looping one, such as the wave, once through), fading in and out.
      const age = t - p.gesture.at;
      if (age > g.duration + FADE) p.gesture = null;
      else out.push({ id: g.id, start: p.gesture.at, weight: Math.max(0, Math.min(1, age / FADE, (g.duration + FADE - age) / FADE)), hold: true });
    }
    return out;
  }

  step(dt: number) {
    this.time += dt;
    const W = this.canvas.width, H = this.canvas.height;
    for (const p of this.puppets.values()) {
      if (p.prevBase && this.time >= p.prevBase.until) p.prevBase = null;
      const v = p.views[p.view]!;
      if (p.walkTo !== null) {
        // Ground speed is in model pixels per second: scale to the stage.
        const s = (p.height * H) / v.rig.model.meta.height;
        const speed = ((v.walkSpeed || 0.4 * v.rig.model.meta.height) * s) / W;
        const d = p.walkTo - p.x;
        const step = Math.sign(d) * Math.min(Math.abs(d), speed * dt);
        p.x += step;
        if (Math.abs(p.walkTo - p.x) < 1e-4) {
          p.walkTo = null;
          this.setBase(p.id, 'idle');
          if (p.views.front) this.setView(p.id, 'front');
        }
      }
      if (p.turning && this.time - p.turning.at > TURN) p.turning = null;
    }
  }

  /**
   * Face life: a blink every 2–6 s (0.15 s), the mouth cycling through shapes while the character
   * speaks (a new shape every ~0.1 s, closed now and then, as syllables do), and the expression.
   */
  private face(p: Puppet2): Record<string, number> {
    const t = this.time, L = p.life;
    if (t > L.blinkAt + 0.15) L.blinkAt = t + 2 + Math.random() * 4;
    const blink = t >= L.blinkAt ? 1 - Math.abs((t - L.blinkAt) / 0.075 - 1) : 0;
    if (!p.speaking) L.mouth = 0;
    else if (t >= L.mouthAt) { L.mouth = Math.random() < 0.25 ? 0 : 1 + Math.floor(Math.random() * 5); L.mouthAt = t + 0.08 + Math.random() * 0.07; }
    return { EyeClose: Math.max(0, blink), Mouth: L.mouth, Expression: p.expression };
  }

  private draws(): Draw2[] {
    const W = this.canvas.width, H = this.canvas.height;
    const out: Draw2[] = [];
    let triangles = 0;
    const sorted = [...this.puppets.values()].sort((a, b) => a.floor - b.floor);
    for (const p of sorted) {
      const shown: Array<[View2, number]> = [[p.view, 1]];
      if (p.turning) { const k = Math.min(1, (this.time - p.turning.at) / TURN); shown[0]![1] = k; shown.unshift([p.turning.from, 1 - k]); }
      for (const [view, a] of shown) {
        const v = p.views[view];
        if (!v || a <= 0) continue;
        const pose = v.player.update({ time: this.time, animations: this.layers(p, v), params: { ...this.face(p), ...p.params } });
        const list = buildRenderList(v.rig, pose);
        const s = (p.height * H) / v.rig.model.meta.height, fx = p.flip ? -1 : 1;
        out.push({ list, textures: v.textures, alpha: a * p.alpha, hidden: p.hidden, matrix: [fx * s, 0, 0, s, p.x * W - fx * s * v.rootX, p.floor * H - s * v.rootY] });
        for (const d of list.draws) triangles += d.indices.length / 3;
      }
    }
    this.stats.triangles = triangles;
    return out;
  }

  private loop(now: number) {
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    const t0 = performance.now();
    const ratio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    const r = this.canvas.getBoundingClientRect();
    this.renderer.resize(Math.max(1, Math.round(r.width * ratio)), Math.max(1, Math.round(r.height * ratio)));
    this.step(dt);
    this.renderer.draw(this.draws());
    this.frameTimes.push(now);
    while (this.frameTimes.length && now - this.frameTimes[0]! > 1000) this.frameTimes.shift();
    this.stats = { ...this.stats, fps: this.frameTimes.length, frameMs: Math.round((performance.now() - t0) * 10) / 10, drawCalls: this.renderer.drawCalls, puppets: this.puppets.size };
    this.onFrame?.();
  }

  private onVisibility = () => {
    if (document.hidden) { cancelAnimationFrame(this.raf); this.raf = 0; this.stats.paused = true; }
    else if (!this.raf) { this.last = 0; this.stats.paused = false; this.raf = requestAnimationFrame(this.loop); }
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const id of this.ids()) this.remove(id);
    this.renderer.dispose();
  }
}
