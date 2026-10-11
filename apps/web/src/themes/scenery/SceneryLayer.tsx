/**
 * Draws a theme's scenery around a column of text: in the margins beside it (a canvas behind the
 * story, clipped so nothing is drawn under the text), or as a thin band on a phone. Pauses while the
 * tab is hidden, while it is off screen, and (on a phone) while the player types; one still frame
 * under reduced motion or when the player chose "still".
 */
import { useEffect, useRef, type RefObject } from 'react';
import { cx } from '@/lib/format';
import { look } from '../looks';
import { run, type Rect, type Runner } from './runtime';

export interface SceneryProps {
  lookId: string;
  /** The column to keep clear (margins mode). */
  column?: RefObject<HTMLElement | null>;
  /** A thin band instead of margins (phones). */
  band?: boolean;
  /** Hour of the day for scenes that follow a clock. */
  hour?: number;
  still?: boolean;
  /** Frames per second at most, below the scene's own cap (gallery previews). */
  fpsCap?: number;
  /** Narrowest margin worth drawing in (px). */
  minMargin?: number;
  className?: string;
}

const reducedMotion = () => document.documentElement.dataset.motion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function SceneryLayer({ lookId, column, band, hour, still, fpsCap, minMargin = 72, className }: SceneryProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const runner = useRef<Runner | null>(null);
  const sceneId = look(lookId).scenery;

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !sceneId) return;
    let disposed = false;
    let ro: ResizeObserver | null = null;
    let io: IntersectionObserver | null = null;
    let typing = false;
    let offscreen = false;
    const cleanups: Array<() => void> = [];
    void import('./scenes').then(({ SCENES }) => {
      const make = SCENES[sceneId];
      if (disposed || !make) return;
      const scene = make();
      if (fpsCap) scene.fps = Math.min(scene.fps, fpsCap);
      // The phone's band is small and slow-moving: ten frames a second is plenty.
      if (band) scene.fps = Math.min(scene.fps, 10);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const areas = (): Rect[] => {
        const box = cv.getBoundingClientRect();
        if (band || !column?.current) return [{ x: 0, y: 0, w: box.width, h: box.height }];
        const col = column.current.getBoundingClientRect();
        const gap = Math.min(20, minMargin / 3);
        const left = { x: 0, y: 0, w: col.left - box.left - gap, h: box.height };
        const right = { x: col.right - box.left + gap, y: 0, w: box.right - col.right - gap, h: box.height };
        // Too narrow to draw anything tasteful: leave it empty.
        return [left, right].filter((a) => a.w >= minMargin);
      };
      const r = run(cv, scene, { hour: hour ?? new Date().getHours(), areas: [], band: !!band, dpr });
      runner.current = r;
      const measure = () => {
        const box = cv.getBoundingClientRect();
        r.setEnv({ areas: areas() });
        r.resize(box.width, box.height);
      };
      ro = new ResizeObserver(measure);
      ro.observe(cv);
      if (column?.current) ro.observe(column.current);
      measure();
      const update = () => r.setPaused(typing || offscreen);
      io = new IntersectionObserver((e) => {
        offscreen = !e[0]?.isIntersecting;
        update();
      });
      io.observe(cv);
      // Typing on a phone: hold the scenery still so the keyboard stays smooth.
      const phone = window.matchMedia('(max-width: 767px)').matches;
      if (phone) {
        const onIn = (e: FocusEvent) => {
          if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') {
            typing = true;
            update();
          }
        };
        const onOut = () => {
          typing = false;
          update();
        };
        document.addEventListener('focusin', onIn);
        document.addEventListener('focusout', onOut);
        cleanups.push(() => {
          document.removeEventListener('focusin', onIn);
          document.removeEventListener('focusout', onOut);
        });
      }
      const motion = () => r.setStill(!!still || reducedMotion());
      motion();
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', motion);
      const mo = new MutationObserver(motion);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
      cleanups.push(() => {
        mq.removeEventListener('change', motion);
        mo.disconnect();
      });
    });
    return () => {
      disposed = true;
      ro?.disconnect();
      io?.disconnect();
      cleanups.forEach((f) => f());
      runner.current?.dispose();
      runner.current = null;
    };
  }, [sceneId, band, column, still, fpsCap]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (hour !== undefined) runner.current?.setEnv({ hour });
  }, [hour]);

  if (!sceneId) return null;
  return <canvas ref={canvas} aria-hidden="true" data-scenery={sceneId} className={cx('ev-scenery pointer-events-none', className)} />;
}
