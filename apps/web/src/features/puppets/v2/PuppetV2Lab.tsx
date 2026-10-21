/**
 * The Puppets v2 lab (/lab/puppets2): one to three auto-rigged characters (the procedural test figure,
 * or a built character via ?model=), every motion of the library, turning, walking across the stage,
 * outfits, every parameter on a slider and the frame stats. Used to review rigs by looking, for the
 * evidence clips in docs/puppets-v2/evidence, and by the tests (window.__puppet2Lab).
 */
import { buildCharacter, EXPRESSIONS, hiddenParts, testFigure, type FigureShape, type Model, type TestFigure } from '@everloom/engine/puppet2';
import { useEffect, useRef, useState } from 'react';
import { Button, Select } from '@/ui';
import { Puppet2Stage, type View2, type ViewSource } from './stage';
import { loadPuppet } from './StageLayer';

declare global {
  interface Window { __puppet2Lab?: { stage: Puppet2Stage; ready: number } }
}

const SPOTS = [[0.5], [0.33, 0.67], [0.2, 0.5, 0.8]];

/** Paints the test figure's layers into canvases (one texture per layer, cut to its rectangle). */
function paintFigure(fig: TestFigure): Record<string, TexImageSource> {
  const out: Record<string, TexImageSource> = {};
  for (const l of fig.input.layers) {
    const [x, y, w, h] = l.rect;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    g.translate(-x, -y);
    const draw = (s: FigureShape, outline: boolean) => {
      g.fillStyle = g.strokeStyle = outline ? 'rgba(60,40,30,0.55)' : s.color;
      if (s.type === 'ellipse') {
        g.beginPath(); g.ellipse(s.cx, s.cy, s.rx + (outline ? 1.5 : 0), s.ry + (outline ? 1.5 : 0), 0, 0, Math.PI * 2); g.fill();
        return;
      }
      // A capsule chain: round-capped segments, the width interpolated along the chain.
      const ws = Array.isArray(s.w) ? s.w : s.pts.map(() => s.w as number);
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (let i = 0; i + 1 < s.pts.length; i++) {
        const [a, b] = [s.pts[i]!, s.pts[i + 1]!];
        for (let k = 0; k < 8; k++) {
          const t0 = k / 8, t1 = (k + 1) / 8;
          g.lineWidth = ws[i]! + (ws[i + 1]! - ws[i]!) * (t0 + t1) / 2 + (outline ? 3 : 0);
          g.beginPath(); g.moveTo(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0); g.lineTo(a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1); g.stroke();
        }
      }
    };
    const shapes = fig.paint[l.id] ?? [];
    for (const s of shapes) draw(s, true);
    for (const s of shapes) draw(s, false);
    out[l.texture] = c;
  }
  return out;
}

function testViews(legScale = 1): Record<'front' | 'side', ViewSource> {
  const front = testFigure({ legScale }), side = testFigure({ legScale, view: 'side' });
  return {
    front: { model: buildCharacter(front.input), images: paintFigure(front) },
    side: { model: buildCharacter(side.input), images: paintFigure(side) },
  };
}

async function loadModel(url: string): Promise<ViewSource> {
  const model = (await (await fetch(url)).json()) as Model;
  const images: Record<string, TexImageSource> = {};
  await Promise.all(model.textures.map(async (t) => {
    const blob = await (await fetch(new URL(t.path, new URL(url, location.href)))).blob();
    images[t.id] = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply' });
  }));
  return { model, images };
}

export default function PuppetV2Lab() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Puppet2Stage | null>(null);
  const [stats, setStats] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [motions, setMotions] = useState<string[]>([]);
  const [params, setParams] = useState<Model['parameters']>([]);
  const [values, setValues] = useState<Record<string, number>>({});
  const [wardrobe, setWardrobe] = useState<Array<{ id: string; outfit?: string; adult?: boolean }>>([]);
  const [outfit, setOutfit] = useState<string>('');
  const [hair, setHair] = useState<string>('');
  /** Each puppet's own wardrobe (a mixed cast has different parts). */
  const wardrobes = useRef(new Map<string, Array<{ id: string; outfit?: string; adult?: boolean }>>());
  const [talking, setTalking] = useState(false);
  const q = new URLSearchParams(location.search);
  const url = q.get('model');
  const p2 = q.get('p2');

  useEffect(() => {
    let s: Puppet2Stage;
    try { s = new Puppet2Stage(canvas.current!); }
    catch (e) { setError((e as Error).message); return; }
    const pr = Number(q.get('pr'));
    if (pr > 0) s.maxPixelRatio = pr;
    stage.current = s;
    window.__puppet2Lab = { stage: s, ready: 0 };
    let tick = 0;
    s.onFrame = () => {
      if (++tick % 15 === 0) setStats(`${s.stats.fps} fps · ${s.stats.frameMs} ms · ${s.stats.drawCalls} draw calls · ${s.stats.triangles} triangles · ${s.stats.puppets} puppet(s)${s.stats.paused ? ' · paused' : ''}`);
    };
    return () => { s.dispose(); delete window.__puppet2Lab; };
  }, []);

  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    let live = true;
    (async () => {
      try {
        for (const id of s.ids()) s.remove(id);
        for (let i = 0; i < count; i++) {
          // ?p2=a,b,c puts different puppets on stage (the i-th takes the i-th id, cycling).
          const ids = p2 ? p2.split(',') : [];
          const loaded = ids.length ? await loadPuppet(ids[i % ids.length]!) : null;
          const views: Partial<Record<View2, ViewSource>> = loaded ? loaded.views : url ? { front: await loadModel(url) } : testViews(i === 1 ? 1.15 : 1);
          const w = loaded ? loaded.meta.parts.front ?? [] : url ? [] : testFigure().input.layers.map((l) => ({ id: l.id, ...(l.outfit ? { outfit: l.outfit } : {}) }));
          wardrobes.current.set(`p${i + 1}`, w);
          if (i === 0) setWardrobe(w);
          if (!live) return;
          const p = s.add(`p${i + 1}`, views, { x: SPOTS[count - 1]![i]!, height: count === 1 ? 0.9 : 0.78, floor: 0.97 });
          const m = (views.front ?? Object.values(views)[0]!).model;
          setMotions(m.animations.map((a) => a.id));
          setParams(m.parameters);
          void p;
        }
        // Dressed in the first outfit (the default wardrobe state).
        for (const id of s.ids()) s.get(id)!.hidden = hiddenParts(wardrobes.current.get(id) ?? [], null);
        if (window.__puppet2Lab) window.__puppet2Lab.ready = count;
        document.querySelector('[data-testid=puppet2-lab]')?.setAttribute('data-ready', String(count));
      } catch (e) { setError((e as Error).message); }
    })();
    return () => { live = false; };
  }, [count, url, p2]);

  const all = (fn: (id: string) => void) => { for (const id of stage.current?.ids() ?? []) fn(id); };
  const BASE = new Set(['idle', 'walk', 'armsCrossed', 'handsOnHips', 'armsUp']);

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg md:flex-row" data-testid="puppet2-lab">
      <div className="relative min-h-0 flex-1" style={{ background: 'linear-gradient(#d9e1ea, #f1f3f5)' }}>
        <canvas ref={canvas} data-testid="puppet2-canvas" className="block h-full w-full touch-none" />
        <pre data-testid="puppet2-stats" className="pointer-events-none absolute left-2 top-2 rounded bg-surface/80 p-2 text-xs">{stats || 'no frames yet'}{error ? `\n${error}` : ''}</pre>
      </div>
      <div className="flex max-h-[45dvh] flex-col gap-3 overflow-y-auto border-t border-line p-3 md:max-h-none md:w-80 md:border-l md:border-t-0">
        <div className="flex flex-wrap gap-2">
          <Select aria-label="How many" value={String(count)} onChange={(e) => setCount(Number(e.target.value))} className="w-auto">
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n} on stage</option>)}
          </Select>
          <Select aria-label="Expression" defaultValue="0" onChange={(e) => all((id) => (stage.current!.get(id)!.expression = Number(e.target.value)))} className="w-auto">
            {EXPRESSIONS.map((x, i) => <option key={x} value={i}>{x}</option>)}
          </Select>
          <Button size="sm" variant={talking ? 'primary' : 'ghost'} aria-pressed={talking} onClick={() => { const t = !talking; setTalking(t); all((id) => (stage.current!.get(id)!.speaking = t)); }}>Talk</Button>
          {wardrobe.some((w) => w.outfit && !w.outfit.startsWith('hair:')) ? (
            <Select aria-label="Outfit" value={outfit} onChange={(e) => { setOutfit(e.target.value); all((id) => (stage.current!.get(id)!.hidden = hiddenParts(wardrobes.current.get(id) ?? [], e.target.value || null, hair || null))); }} className="w-auto">
              {[...new Set(wardrobe.flatMap((w) => (w.outfit && !w.outfit.startsWith('hair:') ? [w.outfit] : [])))].map((o, i) => <option key={o} value={i === 0 ? '' : o}>{o}</option>)}
              <option value="none">No outfit</option>
            </Select>
          ) : null}
          {wardrobe.some((w) => w.outfit?.startsWith('hair:')) ? (
            <Select aria-label="Hair" value={hair} onChange={(e) => { setHair(e.target.value); all((id) => (stage.current!.get(id)!.hidden = hiddenParts(wardrobes.current.get(id) ?? [], outfit || null, e.target.value || null))); }} className="w-auto">
              {[...new Set(wardrobe.flatMap((w) => (w.outfit?.startsWith('hair:') ? [w.outfit] : [])))].map((o, i) => <option key={o} value={i === 0 ? '' : o}>{o.slice(5)}</option>)}
              <option value="none">Bald</option>
            </Select>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Motions">
          {motions.map((m) => (
            <Button key={m} size="sm" variant="ghost" onClick={() => all((id) => (BASE.has(m) ? stage.current!.setBase(id, m) : stage.current!.gesture(id, m)))}>{m}</Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Views and walking">
          <Button size="sm" variant="ghost" onClick={() => all((id) => stage.current!.setView(id, 'front'))}>Front</Button>
          <Button size="sm" variant="ghost" onClick={() => all((id) => stage.current!.setView(id, 'side'))}>Side</Button>
          <Button size="sm" variant="ghost" onClick={() => all((id) => stage.current!.walkTo(id, 0.15))}>Walk left</Button>
          <Button size="sm" variant="ghost" onClick={() => all((id) => stage.current!.walkTo(id, 0.85))}>Walk right</Button>
        </div>
        <div className="flex flex-col gap-1">
          {params.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 truncate">{p.id}</span>
              <input type="range" aria-label={p.id} min={p.min} max={p.max} step={(p.max - p.min) / 100} value={values[p.id] ?? p.default} className="min-w-0 flex-1"
                onChange={(e) => { const v = Number(e.target.value); setValues({ ...values, [p.id]: v }); all((id) => (stage.current!.get(id)!.params[p.id] = v)); }} />
              <button type="button" className="text-muted" aria-label={`Release ${p.id}`} onClick={() => { const { [p.id]: _, ...rest } = values; setValues(rest); all((id) => delete stage.current!.get(id)!.params[p.id]); }}>×</button>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
