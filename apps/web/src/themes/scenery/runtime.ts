/**
 * Scenery: small canvas scenes drawn around the story, never under it. The runner caps the frame
 * rate, stops while the tab is hidden or the player is typing on a phone, draws a single still frame
 * under reduced motion, and keeps count of what each frame costs (window.__scenery, read by the
 * performance test in tests/ux/scenery.spec.ts).
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Env {
  /** Hour of the day, 0–24 (the story's clock when there is one). */
  hour: number;
  /** Where the scene may draw: the margins beside the story column, or the whole band on phones. */
  areas: Rect[];
  /** A thin band on a phone instead of side margins. */
  band: boolean;
  /** Device pixel ratio the canvas is drawn at. */
  dpr: number;
}

export interface Scene {
  /** Frames per second at most. */
  fps: number;
  /** Called on size changes before drawing. */
  resize?(w: number, h: number, env: Env): void;
  /** Draws the frame at time t (seconds since start). The canvas is cleared before. */
  draw(ctx: CanvasRenderingContext2D, t: number, w: number, h: number, env: Env): void;
}

export type SceneFactory = () => Scene;

declare global {
  interface Window {
    __scenery?: { frames: number; ms: number; since: number };
  }
}

/** A seeded random, so a scene looks the same each time it starts. */
export function rng(seed = 7) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The largest area (for the moon, the compass rose…). */
export const biggest = (areas: Rect[]) => areas.reduce<Rect | null>((a, b) => (!a || b.w * b.h > a.w * a.h ? b : a), null);

export interface Runner {
  setEnv(env: Partial<Env>): void;
  setPaused(p: boolean): void;
  setStill(s: boolean): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

export function run(canvas: HTMLCanvasElement, scene: Scene, env0: Env): Runner {
  const ctx = canvas.getContext('2d', { alpha: true })!;
  let env = env0;
  let w = 0;
  let h = 0;
  let raf = 0;
  let last = 0;
  let paused = false;
  let still = false;
  let disposed = false;
  const start = performance.now();
  const stats = (window.__scenery ??= { frames: 0, ms: 0, since: performance.now() });

  const frame = (t: number) => {
    if (!w || !h) return;
    const t0 = performance.now();
    ctx.setTransform(env.dpr, 0, 0, env.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    for (const a of env.areas) ctx.rect(a.x, a.y, a.w, a.h);
    ctx.clip();
    scene.draw(ctx, t, w, h, env);
    ctx.restore();
    stats.frames++;
    stats.ms += performance.now() - t0;
  };
  const tick = (now: number) => {
    raf = 0;
    if (disposed || paused || still || document.hidden) return;
    if (now - last >= 1000 / scene.fps - 1) {
      last = now;
      frame((now - start) / 1000);
    }
    raf = requestAnimationFrame(tick);
  };
  const wake = () => {
    if (!raf && !disposed && !paused && !still && !document.hidden) raf = requestAnimationFrame(tick);
  };
  const onVis = () => {
    if (!document.hidden) return wake();
    cancelAnimationFrame(raf);
    raf = 0;
  };
  document.addEventListener('visibilitychange', onVis);

  return {
    setEnv(p) {
      env = { ...env, ...p };
      scene.resize?.(w, h, env);
      frame((performance.now() - start) / 1000);
      wake();
    },
    setPaused(p) {
      paused = p;
      if (p) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else wake();
    },
    setStill(s) {
      still = s;
      if (s) {
        cancelAnimationFrame(raf);
        raf = 0;
        frame(12);
      } else wake();
    },
    resize(nw, nh) {
      w = nw;
      h = nh;
      canvas.width = Math.round(nw * env.dpr);
      canvas.height = Math.round(nh * env.dpr);
      scene.resize?.(w, h, env);
      frame(still ? 12 : (performance.now() - start) / 1000);
      wake();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    },
  };
}
