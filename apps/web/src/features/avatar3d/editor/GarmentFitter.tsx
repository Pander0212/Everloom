/**
 * Fitting mode: a raw or unrigged garment (GLB, OBJ, FBX) is placed on the body by hand, then rigged
 * to the body's own skeleton in a worker (weights and body-slider morphs carried over, skin under it
 * hidden), reviewed in poses and at slider extremes, and saved as a garment of this avatar. Fitting
 * is done once per garment and base.
 */
import { GarmentPhysicsSchema, GARMENT_SLOTS, type AvatarConfig, type Garment, type GarmentPhysics, type GarmentSlot } from '@everloom/engine';
import { FlipHorizontal2, Minus, Move3d, Plus, RotateCcw, Scaling, Shirt } from 'lucide-react';
import { useEffect, useReducer, useRef, useState } from 'react';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { addOutfitModel, type AvatarDetail } from '@/features/avatars/api';
import { cx } from '@/lib/format';
import { toast } from '@/lib/store';
import { Badge, Button, Checkbox, Field, FileButton, Input, Segmented, Select, Slider, Switch, useDesktop } from '@/ui';
import type { PreviewHandle } from '../Preview3D';
import { adultContentAllowed } from '../Preview3D';
import { useSettings } from '@/lib/queries';
import { browserModel } from '../runtime/import';
import { loaderFor } from '../runtime/loader';
import { CHECK_POSES, type CheckPose } from '../runtime/poses';
import { bodyWeights, shapeBody } from '../runtime/wardrobe';
import { FittingSession, type SnapTarget } from '../runtime/fit/session';

type Phase = 'idle' | 'loading' | 'place' | 'rigging' | 'review' | 'saving';
type Mode = 'move' | 'turn' | 'size';

/** A slot from a file name ("red_skirt.obj" → bottom). */
export function guessSlot(name: string): GarmentSlot {
  const n = name.toLowerCase();
  if (/hair|wig/.test(n)) return 'hair';
  if (/hat|cap|helm|hood|crown/.test(n)) return 'head';
  if (/dress|gown|robe|jumpsuit|suit/.test(n)) return 'full';
  if (/coat|jacket|cape|cloak/.test(n)) return 'outer';
  if (/skirt|pants|trouser|shorts|jeans/.test(n)) return 'bottom';
  if (/shoe|boot|sandal|heel/.test(n)) return 'feet';
  if (/glove|gauntlet/.test(n)) return 'hands';
  if (/sock|stocking/.test(n)) return 'socks';
  if (/bra|underwear|brief|pant(ie|y)|lingerie|bikini/.test(n)) return 'underwear';
  return 'top';
}

/** Skirts and dresses swing on chains; long hair hangs from the head; everything else follows the body. */
export function guessPhysics(name: string, slot: GarmentSlot): GarmentPhysics {
  const n = name.toLowerCase();
  const mode = slot === 'hair' && /long|ponytail|braid|tail/.test(n) ? 'hair' : /skirt|dress|gown|robe|kilt|cape|cloak/.test(n) ? 'chains' : 'none';
  return GarmentPhysicsSchema.parse({ mode, ...(mode === 'hair' ? { pinStart: 0.25, pinEnd: 0.7, chains: 10 } : {}) });
}

const AXES = ['x', 'y', 'z'] as const;
const AXIS_WORDS: Record<Mode, Record<(typeof AXES)[number], [string, string]>> = {
  move: { x: ['Right', 'Left'], y: ['Down', 'Up'], z: ['Back', 'Forward'] },
  turn: { x: ['Tilt back', 'Tilt forward'], y: ['Turn right', 'Turn left'], z: ['Lean right', 'Lean left'] },
  size: { x: ['Narrower', 'Wider'], y: ['Shorter', 'Taller'], z: ['Thinner', 'Deeper'] },
};
const STEPS: Record<Mode, { fine: number; coarse: number }> = { move: { fine: 0.25, coarse: 2 }, turn: { fine: 1, coarse: 10 }, size: { fine: 0.01, coarse: 0.06 } };

export function GarmentFitter({ avatar, config, set, handle }: { avatar: AvatarDetail; config: AvatarConfig; set: (patch: Partial<AvatarConfig>) => void; handle: PreviewHandle | null }) {
  const desktop = useDesktop();
  const settings = useSettings();
  const adultAllowed = adultContentAllowed(config.content, settings.data?.library.nsfw === true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ f: number; step: string }>({ f: 0, step: '' });
  const [name, setName] = useState('');
  const [slot, setSlot] = useState<GarmentSlot>('top');
  const [mode, setMode] = useState<Mode>('move');
  const [coarse, setCoarse] = useState(false);
  const [pushOut, setPushOut] = useState(true);
  const [physics, setPhysics] = useState<GarmentPhysics>(guessPhysics('', 'top'));
  const [pose, setPose] = useState<CheckPose | 'idle' | 'dance'>('idle');
  const [extreme, setExtreme] = useState<'set' | 'min' | 'max'>('set');
  const [flags, setFlags] = useState(false);
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  const session = useRef<FittingSession | null>(null);
  const abort = useRef<AbortController | null>(null);
  const files = useRef<File[]>([]);

  const end = () => {
    abort.current?.abort();
    session.current?.dispose();
    session.current = null;
    if (handle) { shapeBody(handle.avatar, config, { adultAllowed, snap: true }); handle.stage.kick(); }
    setPhase('idle'); setFlags(false); setPose('idle'); setExtreme('set');
  };
  // A new model in the preview (the optimized copy replaced the original, say): the garment is
  // loaded again on it, where it was placed, ready to fit again.
  const lastModel = useRef(handle?.model);
  useEffect(() => {
    const prev = lastModel.current;
    lastModel.current = handle?.model;
    const s = session.current;
    if (!prev || prev === handle?.model || !s) return;
    const placed = s.transform, keepSlot = slot;
    abort.current?.abort(); s.dispose(); session.current = null;
    if (!handle || !files.current.length) { setPhase('idle'); return; }
    void start(files.current, keepSlot).then(() => {
      session.current?.setTransform(placed); refresh();
      setNotice('The model was updated (its optimized copy is ready), so the garment was loaded again where you placed it. Fit it again.');
    });
  }, [handle?.model]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { abort.current?.abort(); session.current?.dispose(); session.current = null; }, []);
  const [notice, setNotice] = useState<string | null>(null);
  // The original model is usable at once, but its optimized copy replaces it shortly after: fit on that.
  const preparing = !!avatar.processingStage;

  const start = async (picked: File[], slotChoice?: GarmentSlot) => {
    if (!picked.length || !handle) return;
    setError(null); setPhase('loading'); setProgress({ f: 0.05, step: 'Reading the files…' });
    files.current = picked;
    try {
      const file = await browserModel(picked, (step) => setProgress({ f: 0.2, step }));
      const gltf = await loaderFor(handle.stage.renderer).parseAsync(await file.arrayBuffer(), '');
      const garmentName = picked[0]!.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Garment';
      const s = slotChoice ?? guessSlot(garmentName);
      session.current?.dispose();
      session.current = new FittingSession(handle.avatar, handle.model, gltf.scene, s);
      // Tests and the evidence script read the session (placement, results, timings).
      (window as unknown as { __everloomFit?: FittingSession }).__everloomFit = session.current;
      setName(garmentName); setSlot(s); setPhysics(guessPhysics(garmentName, s));
      // Skin under clothes can only hide on meshes listed as skin: a custom base starts with none.
      if (!config.body.length) set({ body: session.current.skinMeshes });
      handle.stage.setFraming(s === 'feet' || s === 'bottom' || s === 'full' ? 'full' : s === 'head' || s === 'hair' ? 'half' : 'half');
      handle.stage.kick();
      setPhase('place');
    } catch (e) { setError((e as Error).message); setPhase('idle'); }
  };

  // The gizmo on wider screens (phones get big buttons instead).
  useEffect(() => {
    const s = session.current;
    if (phase !== 'place' || !s || !handle || !desktop) return;
    const tc = new TransformControls(handle.stage.camera, handle.stage.canvas);
    tc.setMode(mode === 'move' ? 'translate' : mode === 'turn' ? 'rotate' : 'scale');
    tc.setSize(0.8);
    tc.attach(s.placer);
    const helper = tc.getHelper();
    handle.stage.scene.add(helper);
    const dragging = (e: { value: unknown }) => handle.stage.setOrbitEnabled(!e.value);
    const changed = () => handle.stage.kick();
    tc.addEventListener('dragging-changed', dragging);
    tc.addEventListener('change', changed);
    tc.addEventListener('objectChange', refresh);
    handle.stage.kick();
    return () => {
      tc.removeEventListener('dragging-changed', dragging);
      tc.removeEventListener('change', changed);
      tc.removeEventListener('objectChange', refresh);
      tc.detach(); helper.removeFromParent(); tc.dispose();
      handle.stage.setOrbitEnabled(true);
      handle.stage.kick();
    };
  }, [phase, mode, desktop, handle]);

  const act = (fn: (s: FittingSession) => void) => { const s = session.current; if (!s || !handle) return; fn(s); refresh(); handle.stage.kick(); };

  const rig = async () => {
    const s = session.current;
    if (!s || !handle) return;
    setError(null); setNotice(null); setPhase('rigging');
    abort.current = new AbortController();
    try {
      await s.rig({ pushOut, physics: physics.mode === 'none' ? null : physics, signal: abort.current.signal, progress: (f, step) => setProgress({ f, step }) });
      await s.wear(physics.mode === 'none' ? null : physics);
      handle.stage.setFraming('full');
      handle.stage.kick();
      setPhase('review');
    } catch (e) {
      if ((e as Error).message !== 'Cancelled') setError((e as Error).message);
      s.adjust(); setPhase('place');
    }
  };

  const review = (next: { pose?: typeof pose; extreme?: typeof extreme }) => {
    const s = session.current;
    if (!s || !handle) return;
    const p = next.pose ?? pose, x = next.extreme ?? extreme;
    setPose(p); setExtreme(x);
    const a = handle.avatar;
    a.override = p === 'idle' || p === 'dance' ? null : CHECK_POSES[p]();
    if (next.pose === 'dance') void a.setBase('dance'); else if (next.pose) void a.setBase('idle');
    // Every body slider at its lowest or highest, to see the garment follow.
    const sliders = config.morphs?.sliders ?? [];
    const values = x === 'set' ? config.morphs?.values ?? {} : Object.fromEntries(sliders.map((sl) => [sl.id, x === 'min' ? sl.min : sl.max]));
    const shape = x === 'set' ? config.bodyShape : Object.fromEntries(Object.keys(config.bodyShape ?? { chest: 0, buttocks: 0, hips: 0, waist: 0, thighs: 0, shoulders: 0 }).map((k) => [k, x === 'min' ? -0.35 : 0.35]));
    a.morphs.set(bodyWeights({ morphs: config.morphs ? { ...config.morphs, values } : undefined, bodyShape: shape as AvatarConfig['bodyShape'] }, { adultAllowed }));
    handle.stage.kick();
  };

  const save = async () => {
    const s = session.current;
    if (!s || !s.result) return;
    setPhase('saving');
    try {
      const stats = s.result.stats;
      const flagged = stats.filled + stats.far + stats.mixedLimbs;
      const bytes = await s.export({ slot, physics, base: config.morphs?.base ?? null, adult: config.content.adult, automaticallyFitted: true, flagged });
      const file = new File([bytes], `${name || 'garment'}.glb`, { type: 'model/gltf-binary' });
      const r = await addOutfitModel(avatar.id, file);
      const taken = new Set(config.garments.map((g) => g.id));
      let n = 1; while (taken.has(`fit${n}`)) n++;
      const entry: Garment = {
        id: `fit${n}`, name: name.trim().slice(0, 60) || 'Garment', model: r.model, modelLow: r.modelLow, slot, layer: slot === 'outer' ? 3 : slot === 'underwear' || slot === 'socks' ? 0 : slot === 'full' ? 2 : 1,
        hides: [], hidesSlots: [], variants: [], variant: null, springs: physics.mode !== 'none', physics, family: config.family, on: true, items: [],
        fit: { base: config.morphs?.base ?? null, morphs: s.result.meshes[0]?.morphs.length ?? 0, flagged, vertices: stats.vertices, ms: Math.round(stats.ms) },
      };
      // Covered skin hides only on the skin meshes: make sure they're listed.
      const body = config.body.length ? config.body : s.skinMeshes;
      end();
      set({ garments: [...config.garments, entry], body });
      toast({ title: `${entry.name} fitted and saved`, tone: 'success' });
    } catch (e) { setError((e as Error).message); setPhase('review'); }
  };

  const s = session.current;
  const t = s?.transform;
  const step = STEPS[mode][coarse ? 'coarse' : 'fine'];
  const stats = s?.result?.stats;

  return (
    <div className="my-3 flex flex-col gap-3 rounded-md border border-line p-3" data-testid="garment-fitter" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (phase === 'idle') void start(Array.from(e.dataTransfer.files)); }}>
      <div className="flex items-center gap-2"><Shirt className="size-4" aria-hidden /><p className="flex-1 text-sm font-medium">Fit clothes to this body</p>{phase !== 'idle' ? <Badge tone="accent">{({ loading: 'Loading', place: 'Step 1 of 3: place', rigging: 'Step 2 of 3: rigging', review: 'Step 3 of 3: check', saving: 'Saving' } as Record<string, string>)[phase]}</Badge> : null}</div>
      {phase === 'idle' ? (
        <>
          <p className="text-sm text-fg-2">Choose or drop a garment (GLB, OBJ or FBX, with its textures). You place it on the body, then Everloom rigs it to this skeleton in the background: it copies the skin weights from the nearest body surface and the body sliders' shapes, so it bends and reshapes with the body, and hides the skin under it.</p>
          <FileButton multiple disabled={!handle || preparing} onFiles={(f) => void start(f)} data-testid="fit-open">Choose a garment</FileButton>
          {preparing ? <p role="status" className="text-xs text-fg-2">Waiting for the model's optimized copy ({avatar.processingStage}); clothes are fitted to that.</p> : null}
        </>
      ) : null}
      {notice && phase === 'place' ? <p role="status" className="rounded-md bg-accent/10 p-2 text-sm">{notice}</p> : null}

      {phase === 'loading' || phase === 'rigging' || phase === 'saving' ? (
        <div className="flex flex-col gap-2" role="status" data-testid="fit-progress">
          <p className="text-sm">{phase === 'saving' ? 'Saving the rigged garment…' : progress.step}</p>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round((phase === 'saving' ? 1 : progress.f) * 100)}%` }} /></div>
          {phase === 'rigging' ? <Button size="sm" variant="secondary" onClick={() => abort.current?.abort()}>Cancel</Button> : null}
        </div>
      ) : null}

      {phase === 'place' && s && t ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-fg-2">The body stands in its rest pose with every slider at zero. {s.unitNote} {desktop ? 'Drag the handles, or use the buttons.' : 'Use the buttons; hold one to keep going.'}</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name"><Input aria-label="Garment name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Slot"><Select aria-label="Garment slot" value={slot} onChange={(e) => { const v = e.target.value as GarmentSlot; setSlot(v); setPhysics(guessPhysics(name, v)); }}>{GARMENT_SLOTS.map((v) => <option key={v} value={v}>{v}</option>)}</Select></Field>
          </div>
          {s.pieceInfo.length > 1 ? (
            <Field label="Pieces in the file">
              <div className="flex flex-wrap gap-x-4 gap-y-1">{s.pieceInfo.map((p, i) => <Checkbox key={i} label={`${p.name} (${p.vertices.toLocaleString()})`} checked={p.on} onChange={(v) => act((x) => x.setPieceOn(i, v))} />)}</div>
            </Field>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {(['chest', 'hips', 'feet', 'head'] as SnapTarget[]).map((to) => <Button key={to} size="sm" variant="secondary" onClick={() => act((x) => x.snap(to))}>Snap to {to}</Button>)}
            <Button size="sm" variant="secondary" onClick={() => act((x) => x.autoPlace(true))}>Auto-align</Button>
            <Button size="sm" variant="secondary" icon={FlipHorizontal2} onClick={() => act((x) => x.mirror())}>Mirror</Button>
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => act((x) => x.reset())}>Reset</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented size="sm" label="What the controls change" value={mode} onChange={setMode} options={[{ value: 'move', label: 'Move' }, { value: 'turn', label: 'Turn' }, { value: 'size', label: 'Size' }]} />
            <Segmented size="sm" label="Step" value={coarse ? 'coarse' : 'fine'} onChange={(v) => setCoarse(v === 'coarse')} options={[{ value: 'fine', label: 'Fine' }, { value: 'coarse', label: 'Coarse' }]} />
          </div>
          <div className={cx('grid gap-2', desktop ? 'grid-cols-3' : 'grid-cols-2')} data-testid="fit-nudges">
            {AXES.map((axis) => [-1, 1].map((dir) => (
              <HoldButton key={`${axis}${dir}`} label={AXIS_WORDS[mode][axis][dir < 0 ? 0 : 1]} icon={dir < 0 ? Minus : Plus} onStep={() => act((x) => x.nudge(mode, axis, dir * step))} />
            )))}
            {mode === 'size' ? [-1, 1].map((dir) => <HoldButton key={`all${dir}`} label={dir < 0 ? 'Smaller' : 'Bigger'} icon={Scaling} onStep={() => act((x) => x.nudge('size', 'all', dir * step))} />) : null}
          </div>
          <details className="rounded-md border border-line">
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm"><Move3d className="size-4" aria-hidden /> Exact numbers</summary>
            <div className="grid grid-cols-3 gap-2 border-t border-line p-3">
              {(['position', 'rotation', 'scale'] as const).map((k) => AXES.map((axis, i) => (
                <Field key={`${k}${axis}`} label={`${k === 'position' ? 'Move' : k === 'rotation' ? 'Turn' : 'Size'} ${axis} (${k === 'position' ? 'cm' : k === 'rotation' ? '°' : '%'})`}>
                  <Input aria-label={`${k} ${axis}`} type="number" step={k === 'scale' ? 1 : k === 'rotation' ? 1 : 0.5} value={Number(t[k][i]!.toFixed(k === 'position' ? 1 : 0))} onChange={(e) => { const v = Number(e.target.value); if (!Number.isFinite(v)) return; const next = [...t[k]] as [number, number, number]; next[i] = v; act((x) => x.setTransform({ [k]: next })); }} />
                </Field>
              )))}
            </div>
          </details>
          <label className="flex items-center justify-between gap-3 text-sm"><span>Push out where it goes into the skin</span><Switch checked={pushOut} onChange={setPushOut} label="Push out where it intersects" /></label>
          <Field label="Swing" hint="Skirts and dresses hang on generated bone chains; long hair hangs from the head. The top stays on the body; below the gradient it swings.">
            <Segmented size="sm" label="Swing" value={physics.mode} onChange={(v) => setPhysics({ ...physics, mode: v })} options={[{ value: 'none', label: 'Follows the body' }, { value: 'chains', label: 'Skirt or coat' }, { value: 'hair', label: 'Long hair' }]} />
          </Field>
          {physics.mode !== 'none' ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label={`Pinned to the body down to ${Math.round(physics.pinStart * 100)}%`}><Slider label="Pin gradient start" min={0} max={0.8} step={0.01} value={physics.pinStart} onChange={(v) => setPhysics({ ...physics, pinStart: v, pinEnd: Math.max(v + 0.05, physics.pinEnd) })} /></Field>
              <Field label={`Swinging freely below ${Math.round(physics.pinEnd * 100)}%`}><Slider label="Pin gradient end" min={0.1} max={1} step={0.01} value={physics.pinEnd} onChange={(v) => setPhysics({ ...physics, pinEnd: Math.max(physics.pinStart + 0.05, v) })} /></Field>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button onClick={() => void rig()} data-testid="fit-confirm">Fit to the body</Button>
            <Button variant="ghost" onClick={end}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {phase === 'review' && s && stats ? (
        <div className="flex flex-col gap-3" data-testid="fit-review">
          <p className="text-sm">Rigged {stats.vertices.toLocaleString()} vertices in {(stats.ms / 1000).toFixed(1)} s{s.result?.bones.length ? `, with ${s.result.bones.length} swing bones` : ''}. {s.coveredTriangles ? `${s.coveredTriangles.toLocaleString()} skin triangles hidden under it.` : ''}</p>
          <ul className="flex flex-col gap-1 text-sm text-fg-2">
            <li>{(stats.matched).toLocaleString()} matched to the body surface</li>
            {stats.filled ? <li>{stats.filled.toLocaleString()} too far from the body: weights taken from the nearest matched cloth (fine for hems and loose parts)</li> : null}
            {stats.mixedLimbs ? <li className="text-warning">{stats.mixedLimbs.toLocaleString()} pulled by both left and right limbs: check them in the poses</li> : null}
            {stats.far ? <li className="text-warning">{stats.far.toLocaleString()} in pieces nowhere near the body: move it closer and fit again</li> : null}
            {stats.pushed ? <li>{stats.pushed.toLocaleString()} pushed out of the skin</li> : null}
            {stats.flipped ? <li>The file's normals pointed inward; that was taken into account</li> : null}
          </ul>
          <Field label="Pose">
            <div className="flex flex-wrap gap-2">
              {(['idle', 'tpose', 'armsUp', 'squat', 'wave', 'dance'] as const).map((p) => <Button key={p} size="sm" variant={pose === p ? 'primary' : 'secondary'} onClick={() => review({ pose: p })}>{({ idle: 'Idle', tpose: 'T-pose', armsUp: 'Arms up', squat: 'Squat', wave: 'Right hand up', dance: 'Dance' } as Record<string, string>)[p]}</Button>)}
            </div>
          </Field>
          <Field label="Body sliders">
            <Segmented size="sm" label="Body sliders" value={extreme} onChange={(v) => review({ extreme: v })} options={[{ value: 'set', label: 'As set' }, { value: 'min', label: 'All lowest' }, { value: 'max', label: 'All highest' }]} />
          </Field>
          <label className="flex items-center justify-between gap-3 text-sm"><span>Show flagged areas (red: check; amber: filled in; yellow: pushed out)</span><Switch checked={flags} onChange={(v) => { setFlags(v); s.showFlags(v); handle?.stage.kick(); }} label="Show flagged areas" /></label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} data-testid="fit-save">Save garment</Button>
            <Button variant="secondary" onClick={() => { s.adjust(); setFlags(false); setPose('idle'); setExtreme('set'); setPhase('place'); handle?.stage.kick(); }}>Adjust the fit</Button>
            <Button variant="ghost" onClick={end}>Discard</Button>
          </div>
        </div>
      ) : null}

      {error ? <div role="alert" className="flex flex-col gap-1"><p className="text-sm text-danger">{error}</p><Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(error)}>Copy details</Button></div> : null}
    </div>
  );
}

/** A big button that repeats while held (phones have no gizmo). */
function HoldButton({ label, icon, onStep }: { label: string; icon: typeof Plus; onStep: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => stop, []);
  const begin = () => {
    stop();
    onStep();
    let delay = 320;
    const tick = () => { onStep(); delay = Math.max(50, delay * 0.8); timer.current = setTimeout(tick, delay); };
    timer.current = setTimeout(tick, delay);
  };
  return (
    <Button variant="secondary" icon={icon} className="min-h-12 justify-start" onPointerDown={(e) => { e.preventDefault(); begin(); }} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStep(); } }} aria-label={label}>
      {label}
    </Button>
  );
}
