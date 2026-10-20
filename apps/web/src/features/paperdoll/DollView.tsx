/**
 * Shows characters in a paper-doll template: composites each into its slot (cached), then draws
 * them with idle motion. Used by the Character Studio preview and the story stage.
 */
import { composeScene, migrateTemplate, type ComposeState, type Template, type TraitSheet } from '@everloom/engine/studio';
import { useEffect, useRef, useState } from 'react';
import { compositeExtras, compositeSlot } from './compositor';
import { DollRenderer, type DollDraw } from './motion';

const templates = new Map<string, Promise<Template>>();
/** Loads a template once per page. */
export function loadTemplate(base: string): Promise<Template> {
  let p = templates.get(base);
  if (!p) {
    p = fetch(`${base}template.json`, { credentials: 'same-origin' }).then(async (r) => { if (!r.ok) throw new Error(`Template not found (${r.status})`); return migrateTemplate(await r.json()); });
    p.catch(() => templates.delete(base));
    templates.set(base, p);
  }
  return p;
}

export interface DollViewProps {
  base: string;
  cast: TraitSheet[];
  state?: ComposeState;
  className?: string;
  /** Idle motion strength (0 = still). */
  motion?: number;
  /** Fit: the whole template ('contain') or cover the area ('cover'). */
  fit?: 'contain' | 'cover';
  onInfo?: (info: { fallbacks: string[]; template: Template | null; error?: string }) => void;
  testId?: string;
}

export function DollView({ base, cast, state, className, motion = 1, fit = 'contain', onInfo, testId = 'doll-view' }: DollViewProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const r = useRef<{ renderer: DollRenderer; draws: DollDraw[]; raf: number; textures: WebGLTexture[]; bg: HTMLCanvasElement | null; size: [number, number] } | null>(null);
  const [ready, setReady] = useState(false);
  const info = useRef(onInfo);
  info.current = onInfo;
  const key = JSON.stringify([base, cast, state]);

  useEffect(() => {
    let renderer: DollRenderer;
    try { renderer = new DollRenderer(ref.current!); } catch (e) { info.current?.({ fallbacks: [], template: null, error: (e as Error).message }); return; }
    const st = { renderer, draws: [] as DollDraw[], raf: 0, textures: [] as WebGLTexture[], bg: null, size: [1, 1] as [number, number] };
    r.current = st;
    const t0 = performance.now();
    const loop = () => {
      st.raf = requestAnimationFrame(loop);
      const c = ref.current!, rect = c.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.max(1, Math.round(rect.width * ratio)), H = Math.max(1, Math.round(rect.height * ratio));
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const [tw, th] = st.size;
      const s = fit === 'cover' ? Math.max(W / tw, H / th) : Math.min(W / tw, H / th);
      for (const d of st.draws) { d.scale = s; d.x = (W - tw * s) / 2; d.y = H - th * s - (fit === 'contain' ? (H - th * s) / 2 : 0); }
      renderer.draw(st.draws, (performance.now() - t0) / 1000);
    };
    st.raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(st.raf); for (const t of st.textures) renderer.release(t); r.current = null; };
  }, [fit]);

  useEffect(() => {
    let live = true;
    setReady(false);
    (async () => {
      const st = r.current;
      if (!st) return;
      try {
        const t = await loadTemplate(base);
        const plan = composeScene(t, cast, state);
        const comps = await Promise.all(plan.slots.map((p) => compositeSlot(t, base, p)));
        const extras = await compositeExtras(t, base, plan.options);
        if (!live || !r.current) return;
        for (const x of st.textures) st.renderer.release(x);
        st.textures = [];
        const draws: DollDraw[] = [];
        const add = (c: HTMLCanvasElement, rig: DollDraw['rig'], phase: number, m: number) => {
          const tex = st.renderer.texture(c);
          st.textures.push(tex);
          draws.push({ texture: tex, width: t.width, height: t.height, x: 0, y: 0, scale: 1, rig, phase, alpha: 1, motion: m });
        };
        if (extras.background) add(extras.background, { bounce: [] }, 0, 0);
        plan.slots.forEach((p, i) => add(comps[i]!, { breathe: p.slot.rig.breathe as never, pivot: p.slot.rig.pivot as never, bounce: p.slot.rig.bounce as never }, i * 1.3, motion));
        if (extras.pov) add(extras.pov, { bounce: [] }, 0.4, motion * 0.5);
        st.draws = draws;
        st.size = [t.width, t.height];
        setReady(true);
        info.current?.({ fallbacks: plan.slots.flatMap((p) => p.fallbacks), template: t });
      } catch (e) {
        info.current?.({ fallbacks: [], template: null, error: (e as Error).message });
      }
    })();
    return () => { live = false; };
    // The key covers base, cast and state.
  }, [key, motion]);

  return <canvas ref={ref} data-testid={testId} data-ready={ready ? 'true' : 'false'} className={className} />;
}
