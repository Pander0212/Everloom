/**
 * The puppet lab (/lab/puppets): one to three puppets, every parameter on a slider, expressions,
 * gestures, life switches, a talking test and the frame stats. Used to tune rigs by looking (and
 * for the parameter sweeps and clips in docs/puppets-evidence), and by the tests.
 */
import { DEFAULT_MOTIONS, PUPPET_EMOTIONS } from '@everloom/engine';
import { useEffect, useRef, useState } from 'react';
import { Button, Select } from '@/ui';
import { PuppetStage, type PuppetQuality } from './runtime/player';

declare global {
  interface Window {
    __puppetLab?: { stage: PuppetStage; set: (param: string, v: number | null) => void; add: (url: string) => Promise<void> };
  }
}

const PLACEHOLDER = '/puppets/placeholder/puppet.json';
const SPOTS = [[0.5], [0.33, 0.67], [0.2, 0.5, 0.8]];

export default function PuppetLab() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<PuppetStage | null>(null);
  const held = useRef(new Map<string, number>());
  const [params, setParams] = useState<Array<{ id: string; min: number; max: number; default: number }>>([]);
  const [values, setValues] = useState<Record<string, number>>({});
  const [stats, setStats] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [talking, setTalking] = useState(false);
  const [follow, setFollow] = useState(false);
  const url = new URLSearchParams(location.search).get('puppet') ?? PLACEHOLDER;

  useEffect(() => {
    let s: PuppetStage;
    try { s = new PuppetStage(canvas.current!); }
    catch (e) { setError((e as Error).message); return; }
    stage.current = s;
    let tick = 0;
    s.onFrame = () => {
      // Held slider values win over life and motions (set after the animator, before drawing).
      if (++tick % 15 === 0) setStats(`${s.stats.fps} fps · ${s.stats.frameMs} ms · ${s.stats.drawCalls} draw calls · ${s.stats.puppets} puppet(s)${s.stats.paused ? ' · paused' : ''}`);
    };
    const step = s.step.bind(s);
    s.step = (dt: number) => {
      step(dt);
      if (!held.current.size) return;
      for (const id of s.ids()) {
        const a = s.get(id)!.animator;
        for (const [p, v] of held.current) a.rig.set(p, v);
        a.rig.evaluate();
      }
    };
    const add = async (u: string) => {
      const id = `p${s.ids().length + 1}`;
      const inst = await s.add(id, u);
      setParams(inst.model.params.filter((p) => !p.internal));
    };
    window.__puppetLab = { stage: s, add, set: (p, v) => { if (v === null) held.current.delete(p); else held.current.set(p, v); } };
    return () => { s.dispose(); delete window.__puppetLab; };
  }, []);

  // Puppets on stage: 1–3, spread out.
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    let live = true;
    (async () => {
      try {
        for (const id of s.ids()) s.remove(id);
        for (let i = 0; i < count; i++) {
          const inst = await s.add(`p${i + 1}`, url);
          if (!live) return;
          inst.place = { x: SPOTS[count - 1]![i]!, floor: 1.02, height: count === 1 ? 0.95 : 0.85, depth: i === 1 && count === 3 ? 0.3 : 0 };
          setParams(inst.model.params.filter((p) => !p.internal));
        }
        document.querySelector('[data-testid=puppet-lab]')?.setAttribute('data-ready', String(count));
      } catch (e) { setError((e as Error).message); }
    })();
    return () => { live = false; };
  }, [count, url]);

  // Talking test: a syllable-like loudness curve.
  useEffect(() => {
    if (!talking) { for (const id of stage.current?.ids() ?? []) stage.current!.get(id)!.animator.speech = 0; return; }
    const t0 = performance.now();
    const h = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      const v = Math.max(0, Math.sin(t * 11) * 0.6 + Math.sin(t * 4.3) * 0.4);
      for (const id of stage.current?.ids() ?? []) stage.current!.get(id)!.animator.speech = v;
    }, 33);
    return () => clearInterval(h);
  }, [talking]);

  const all = (fn: (a: NonNullable<ReturnType<PuppetStage['get']>>) => void) => { for (const id of stage.current?.ids() ?? []) fn(stage.current!.get(id)!); };
  const onPointer = (e: React.PointerEvent) => {
    if (!follow) return;
    const r = (e.target as HTMLElement).getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1, y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    all((p) => (p.animator.look = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y + 0.4)) }));
  };

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg md:flex-row" data-testid="puppet-lab">
      <div className="relative min-h-0 flex-1" style={{ background: 'linear-gradient(#d9e1ea, #f1f3f5)' }} onPointerMove={onPointer}>
        <canvas ref={canvas} data-testid="puppet-canvas" className="block h-full w-full touch-none" />
        <pre data-testid="puppet-stats" className="pointer-events-none absolute left-2 top-2 rounded bg-surface/80 p-2 text-xs">{stats || 'no frames yet'}{error ? `\n${error}` : ''}</pre>
      </div>
      <div className="flex max-h-[45dvh] flex-col gap-3 overflow-y-auto border-t border-line p-3 md:max-h-none md:w-80 md:border-l md:border-t-0">
        <div className="flex flex-wrap gap-2">
          <Select aria-label="How many" value={String(count)} onChange={(e) => setCount(Number(e.target.value))} className="w-auto">
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n} on stage</option>)}
          </Select>
          <Select aria-label="Expression" defaultValue="neutral" onChange={(e) => all((p) => p.animator.setExpression(e.target.value))} className="w-auto">
            {PUPPET_EMOTIONS.map((x) => <option key={x}>{x}</option>)}
          </Select>
          <Select aria-label="Quality" defaultValue="medium" onChange={(e) => stage.current && (stage.current.quality = e.target.value as PuppetQuality)} className="w-auto">
            {['low', 'medium', 'high'].map((x) => <option key={x}>{x}</option>)}
          </Select>
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.keys(DEFAULT_MOTIONS).map((m) => <Button key={m} size="sm" variant="ghost" onClick={() => all((p) => void p.animator.play(m))}>{m}</Button>)}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={talking ? 'primary' : 'ghost'} aria-pressed={talking} onClick={() => setTalking(!talking)}>Talk</Button>
          <Button size="sm" variant={follow ? 'primary' : 'ghost'} aria-pressed={follow} onClick={() => { setFollow(!follow); if (follow) all((p) => (p.animator.look = null)); }}>Follow pointer</Button>
          {(['blink', 'breath', 'sway'] as const).map((k) => <Button key={k} size="sm" variant="ghost" onClick={() => all((p) => (p.animator.life = { ...p.animator.life, [k]: !p.animator.life[k] }))}>{k}</Button>)}
          <Button size="sm" variant="ghost" onClick={() => all((p) => (p.animator.physics.enabled = !p.animator.physics.enabled))}>physics</Button>
        </div>
        <div className="flex flex-col gap-1">
          {params.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 truncate">{p.id}</span>
              <input type="range" aria-label={p.id} min={p.min} max={p.max} step={(p.max - p.min) / 100} value={values[p.id] ?? p.default} className="min-w-0 flex-1"
                onChange={(e) => { const v = Number(e.target.value); setValues({ ...values, [p.id]: v }); held.current.set(p.id, v); }} />
              <button type="button" className="text-muted" aria-label={`Release ${p.id}`} onClick={() => { held.current.delete(p.id); const { [p.id]: _, ...rest } = values; setValues(rest); }}>×</button>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
