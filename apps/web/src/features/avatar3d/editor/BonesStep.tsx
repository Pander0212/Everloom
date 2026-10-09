/**
 * The Bones tab: every bone of the model, what it is, and how sure the mapping is.
 *  - Skeleton: the bone tree with search, filters and multi-select; assign bones to a humanoid slot,
 *    the spine chain or a role (with a side); reorder the spine; the 3D view shows each bone by role,
 *    the selected bone's skin weights, and picks a bone when you tap near it.
 *  - Humanoid: the core slots, one bone each.
 *  - Test poses: T-pose, A-pose, arms up, squat, a shake for the breast physics, a short walk.
 * See docs/3d-import/bones.md.
 */
import { AvatarConfigSchema, BoneMapSchema, HUMANOID_BONES, REQUIRED_BONES, RIG_ROLES, RigMappingSchema, automap, type AutomapBone, type AvatarConfig, type HumanBone, type RigMapping, type RigRole } from '@everloom/engine';
import { ArrowDown, ArrowUp, ListTree, RotateCcw, Search, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { AvatarDetail } from '@/features/avatars/api';
import { cx } from '@/lib/format';
import { toastError } from '@/lib/store';
import { Badge, Button, FileButton, Input, SectionTitle, Segmented, Select, Sheet, Switch, useDesktop } from '@/ui';
import type { PreviewHandle } from '../Preview3D';
import { BoneOverlay, ROLE_COLORS } from '../runtime/bone-overlay';
import { CHECK_POSES } from '../runtime/poses';
import { downloadPreset, readPreset } from './presets';

const GROUPS: Array<{ label: string; bones: HumanBone[]; folded?: boolean }> = [
  { label: 'Body', bones: ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'jaw', 'leftEye', 'rightEye'] },
  { label: 'Left arm', bones: ['leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand'] },
  { label: 'Right arm', bones: ['rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand'] },
  { label: 'Left leg', bones: ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes'] },
  { label: 'Right leg', bones: ['rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'] },
  { label: 'Left fingers', bones: HUMANOID_BONES.filter((b) => /^left(Thumb|Index|Middle|Ring|Little)/.test(b)), folded: true },
  { label: 'Right fingers', bones: HUMANOID_BONES.filter((b) => /^right(Thumb|Index|Middle|Ring|Little)/.test(b)), folded: true },
];

const ROLE_LABEL: Record<RigRole, string> = {
  breast: 'Breast', butt: 'Butt', belly: 'Belly', thighHelper: 'Thigh helper', upperArmHelper: 'Upper-arm helper', forearmHelper: 'Forearm helper', shoulderHelper: 'Shoulder helper',
  hair: 'Hair', skirt: 'Skirt', coat: 'Coat tail', tail: 'Tail', ears: 'Ears', wings: 'Wings', eyelid: 'Eyelid', tongue: 'Tongue', teeth: 'Teeth', accessory: 'Accessory',
};

/** "leftUpperArm" → "Upper arm"; "leftIndexProximal" → "Index 1". */
function label(b: HumanBone): string {
  const s = b.replace(/^(left|right)/, '');
  const f = /^(Thumb|Index|Middle|Ring|Little)(Metacarpal|Proximal|Intermediate|Distal)$/.exec(s);
  if (f) return `${f[1]} ${{ Metacarpal: 0, Proximal: 1, Intermediate: 2, Distal: 3 }[f[2] as 'Proximal']}`;
  const words = s.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
const sideOf = (b: HumanBone) => (b.startsWith('left') ? 'L ' : b.startsWith('right') ? 'R ' : '');

type Info = { kind: 'humanoid' | 'spine' | 'role' | 'ignore' | 'none'; text: string; color: string; confidence: number; why?: string };
type Filter = 'all' | 'unmapped' | 'review' | RigRole | 'humanoid';

/** Rest positions and skin-weight centres of every bone of the loaded model (for the auto-mapper). */
function skeletonOf(scene: THREE.Object3D): AutomapBone[] {
  scene.updateMatrixWorld(true);
  const out: AutomapBone[] = [];
  const sums = new Map<string, { w: number; x: number; y: number; z: number }>();
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.skeleton) return;
    const pos = m.geometry.getAttribute('position');
    const si = m.geometry.getAttribute('skinIndex');
    const sw = m.geometry.getAttribute('skinWeight');
    if (!pos || !si || !sw) return;
    const step = Math.max(1, Math.floor(pos.count / 20000));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.bindMatrix).applyMatrix4(m.matrixWorld);
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w < 0.3) continue;
        const b = m.skeleton.bones[si.getComponent(i, k)];
        if (!b) continue;
        const s = sums.get(b.name) ?? { w: 0, x: 0, y: 0, z: 0 };
        s.w += w;
        s.x += v.x * w;
        s.y += v.y * w;
        s.z += v.z * w;
        sums.set(b.name, s);
      }
    }
  });
  scene.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    let p = o.parent;
    while (p && !(p as THREE.Bone).isBone) p = p.parent;
    const w = o.getWorldPosition(new THREE.Vector3());
    const s = sums.get(o.name);
    out.push({ name: o.name, parent: p?.name ?? null, pos: [w.x, w.y, w.z], ...(s && s.w > 5 ? { footprint: { count: Math.round(s.w), center: [s.x / s.w, s.y / s.w, s.z / s.w] as [number, number, number] } } : {}) });
  });
  return out;
}

export function BonesStep({ avatar, config, set, handle }: { avatar: AvatarDetail; config: AvatarConfig; set: (p: Partial<AvatarConfig>) => void; handle: PreviewHandle | null }) {
  const desktop = useDesktop();
  // The skeleton as the server read it (the same list the mapping was made from); the loaded model's
  // list stands in for models without one.
  const bones = avatar.info.bones?.length ? avatar.info.bones : (handle?.model.rigBones ?? []);
  const names = useMemo(() => bones.map((b) => b.name), [bones]);
  const rig: RigMapping = config.rig ?? (avatar.info as { rig?: RigMapping }).rig ?? RigMappingSchema.parse({});
  const [view, setView] = useState<'skeleton' | 'humanoid'>('skeleton');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState<string>('hair');
  const [side, setSide] = useState<'auto' | 'L' | 'R' | 'C'>('auto');
  const [showBones, setShowBones] = useState(true);
  const [pose, setPose] = useState<'idle' | 'tpose' | 'apose' | 'armsUp' | 'squat' | 'shake' | 'walk'>('idle');
  const [treeSheet, setTreeSheet] = useState(false);
  const overlay = useRef<BoneOverlay | null>(null);

  // What each bone is.
  const info = useMemo(() => {
    const m = new Map<string, Info>();
    for (const [k, v] of Object.entries(config.boneMap)) if (v) m.set(v, { kind: 'humanoid', text: `${sideOf(k as HumanBone)}${label(k as HumanBone)}`, color: ROLE_COLORS.humanoid!, confidence: 1 });
    for (const s of rig.spine) if (!m.has(s)) m.set(s, { kind: 'spine', text: 'Spine chain', color: ROLE_COLORS.spine!, confidence: 1 });
    for (const r of rig.roles) for (const b of r.bones) if (!m.has(b)) m.set(b, { kind: 'role', text: `${r.side !== 'C' ? `${r.side} ` : ''}${ROLE_LABEL[r.role]}`, color: r.confidence < 0.6 ? ROLE_COLORS.review! : ROLE_COLORS[r.role]!, confidence: r.confidence, why: r.why });
    for (const b of rig.ignore) if (!m.has(b)) m.set(b, { kind: 'ignore', text: 'Ignored', color: ROLE_COLORS.ignore!, confidence: 1 });
    return m;
  }, [config.boneMap, rig]);

  const depth = useMemo(() => {
    const parent = new Map(bones.map((b) => [b.name, b.parent]));
    const d = new Map<string, number>();
    for (const b of bones) {
      let n = 0;
      for (let p = b.parent; p && n < 40; p = parent.get(p) ?? null) n++;
      d.set(b.name, n);
    }
    return d;
  }, [bones]);
  const order = useMemo(() => new Map(names.map((n, i) => [n, i])), [names]);

  const shown = names.filter((n) => {
    const i = info.get(n);
    if (query && !n.toLowerCase().includes(query.toLowerCase()) && !(i?.text.toLowerCase().includes(query.toLowerCase()))) return false;
    if (filter === 'all') return true;
    if (filter === 'unmapped') return !i || i.kind === 'none';
    if (filter === 'review') return !!i && i.confidence < 0.6;
    if (filter === 'humanoid') return i?.kind === 'humanoid';
    return rig.roles.some((r) => r.role === filter && r.bones.includes(n));
  });

  // The 3D overlay: dots by role, the selection, picking.
  useEffect(() => {
    if (!handle || !showBones) return;
    const o = new BoneOverlay(handle.stage, handle.model.scene, handle.model.height || 1.6);
    overlay.current = o;
    const onDown = (e: PointerEvent) => {
      const hit = o.pick(e.clientX, e.clientY);
      if (hit) setSelected((s) => (e.shiftKey || e.ctrlKey || e.metaKey ? (s.includes(hit) ? s.filter((x) => x !== hit) : [...s, hit]) : [hit]));
    };
    handle.stage.canvas.addEventListener('pointerdown', onDown);
    return () => {
      handle.stage.canvas.removeEventListener('pointerdown', onDown);
      o.dispose();
      overlay.current = null;
    };
  }, [handle, showBones]);
  useEffect(() => overlay.current?.setColors(new Map([...info].map(([k, v]) => [k, v.color]))), [info, handle, showBones]);
  useEffect(() => overlay.current?.setSelected(selected), [selected, handle, showBones]);

  // Test poses.
  useEffect(() => {
    if (!handle) return;
    const a = handle.avatar;
    let timer: ReturnType<typeof setInterval> | undefined;
    if (pose === 'walk') {
      a.override = null;
      void a.emote('walk', { loop: true }).catch(() => {});
    } else if (pose === 'shake') {
      // A quick up-and-down bounce: the breast and butt physics should swing and settle.
      const base = CHECK_POSES.tpose();
      let t = 0;
      timer = setInterval(() => {
        t += 0.05;
        base.hips.y = Math.sin(t * 18) * 0.04 * Math.max(0, 1 - (t % 2));
        a.override = base;
        a.kick?.();
      }, 33);
    } else if (pose === 'apose') {
      const p = CHECK_POSES.tpose();
      p.rot.leftUpperArm = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(-40));
      p.rot.rightUpperArm = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(40));
      a.override = p;
    } else a.override = pose === 'idle' ? null : CHECK_POSES[pose]();
    a.kick?.();
    return () => {
      if (timer) clearInterval(timer);
      a.override = null;
    };
  }, [handle, pose]);

  const assignHumanoid = (b: HumanBone, v: string) => {
    const next = { ...config.boneMap };
    if (v) {
      for (const [k, x] of Object.entries(next)) if (x === v) delete next[k as HumanBone];
      next[b] = v;
    } else delete next[b];
    set({ boneMap: next });
  };

  /** Takes bones out of every assignment (humanoid slots stay unless asked). */
  const without = (r: RigMapping, bonesOut: Set<string>): RigMapping => ({
    ...r,
    spine: r.spine.filter((b) => !bonesOut.has(b)),
    roles: r.roles.map((x) => ({ ...x, bones: x.bones.filter((b) => !bonesOut.has(b)) })).filter((x) => x.bones.length),
    ignore: r.ignore.filter((b) => !bonesOut.has(b)),
  });

  const assign = () => {
    if (!selected.length) return;
    const pick = new Set(selected);
    const sorted = [...selected].sort((a, b) => (depth.get(a) ?? 0) - (depth.get(b) ?? 0) || (order.get(a) ?? 0) - (order.get(b) ?? 0));
    let next = without(rig, pick);
    let boneMap = config.boneMap;
    if (target.startsWith('human:')) {
      const slot = target.slice(6) as HumanBone;
      boneMap = { ...boneMap };
      for (const [k, x] of Object.entries(boneMap)) if (x === sorted[0]) delete boneMap[k as HumanBone];
      boneMap[slot] = sorted[0]!;
    } else {
      // Out of any humanoid slot they held.
      boneMap = Object.fromEntries(Object.entries(config.boneMap).filter(([, v]) => !pick.has(v!))) as AvatarConfig['boneMap'];
      if (target === 'spine') next = { ...next, spine: [...next.spine, ...sorted].sort((a, b) => (depth.get(a) ?? 0) - (depth.get(b) ?? 0)) };
      else if (target === 'ignore') next = { ...next, ignore: [...next.ignore, ...sorted] };
      else if (target !== 'clear') {
        const guessSide = (n: string) => (/(^|[^a-z])(l|left)([^a-z]|$)|左/i.test(n) ? 'L' : /(^|[^a-z])(r|right)([^a-z]|$)|右/i.test(n) ? 'R' : 'C');
        const s = side === 'auto' ? guessSide(sorted[0]!) : side;
        next = { ...next, roles: [...next.roles, { role: target as RigRole, side: s, bones: sorted.slice(0, 64), confidence: 1, why: 'set by you' }] };
      }
    }
    set({ rig: RigMappingSchema.parse(next), boneMap });
  };

  const moveSpine = (i: number, d: -1 | 1) => {
    const s = [...rig.spine];
    const j = i + d;
    if (j < 0 || j >= s.length) return;
    [s[i], s[j]] = [s[j]!, s[i]!];
    set({ rig: { ...rig, spine: s } });
  };

  const rerun = () => {
    if (!handle) return;
    const r = automap({ bones: skeletonOf(handle.model.scene), humanoid: config.boneMap, humanoidSource: 'your current mapping' });
    set({ rig: r.rig, boneMap: { ...r.boneMap, ...config.boneMap } });
  };

  const missing = REQUIRED_BONES.filter((b) => !config.boneMap[b]);
  const review = [...info.values()].filter((i) => i.confidence < 0.6).length;
  const unmapped = names.filter((n) => !info.has(n)).length;

  const tree = (
    <div className="flex flex-col gap-2" data-testid="bone-tree">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" aria-hidden />
          <Input aria-label="Search bones" placeholder="Search bones" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
        </div>
        <Select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="w-40">
          <option value="all">All bones ({names.length})</option>
          <option value="unmapped">Unmapped ({unmapped})</option>
          <option value="review">To review ({review})</option>
          <option value="humanoid">Humanoid</option>
          {RIG_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
      </div>
      <ul role="listbox" className="max-h-[50vh] overflow-y-auto rounded-md border border-line" aria-label="Bones" aria-multiselectable>
        {shown.map((n) => {
          const i = info.get(n);
          const on = selected.includes(n);
          return (
            <li key={n}>
              <button
                type="button"
                role="option"
                aria-selected={on}
                onClick={(e) => setSelected((s) => (e.shiftKey || e.ctrlKey || e.metaKey || s.length > 1 || (s.length === 1 && !desktop) ? (s.includes(n) ? s.filter((x) => x !== n) : [...s, n]) : [n]))}
                className={cx('flex min-h-11 w-full items-center gap-2 border-b border-line px-2 text-left text-sm last:border-0', on ? 'bg-accent-soft' : 'hover:bg-surface-2')}
                style={{ paddingLeft: 8 + Math.min(10, depth.get(n) ?? 0) * 10 }}
              >
                <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: i?.color ?? '#94a3b8' }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{n}</span>
                <span className="flex-none text-xs text-fg-2">{i?.text ?? 'Unmapped'}</span>
                {i && i.confidence < 1 ? (
                  <Badge tone={i.confidence < 0.6 ? 'warning' : undefined}>
                    {Math.round(i.confidence * 100)}%
                  </Badge>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  const assignPanel = selected.length ? (
    <div className="sticky bottom-0 z-10 flex flex-col gap-2 rounded-md border border-line bg-surface p-3 shadow-2" data-testid="bone-assign">
      <p className="text-sm">
        <span className="font-medium">{selected.length === 1 ? selected[0] : `${selected.length} bones`}</span>
        {selected.length === 1 && info.get(selected[0]!)?.why ? <span className="text-fg-2"> · {info.get(selected[0]!)!.why}</span> : null}
      </p>
      <div className="flex flex-wrap gap-2">
        <Select aria-label="Assign to" value={target} onChange={(e) => setTarget(e.target.value)} className="min-w-44 flex-1">
          <optgroup label="Roles">
            {RIG_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </optgroup>
          <optgroup label="Body">
            <option value="spine">Spine chain</option>
            {selected.length === 1
              ? HUMANOID_BONES.map((b) => (
                  <option key={b} value={`human:${b}`}>
                    {sideOf(b)}
                    {label(b)}
                  </option>
                ))
              : null}
          </optgroup>
          <option value="ignore">Ignore</option>
          <option value="clear">Clear</option>
        </Select>
        <Select aria-label="Side" value={side} onChange={(e) => setSide(e.target.value as typeof side)} className="w-28">
          <option value="auto">Side: auto</option>
          <option value="L">Left</option>
          <option value="R">Right</option>
          <option value="C">Middle</option>
        </Select>
        <Button variant="primary" onClick={assign}>
          Assign
        </Button>
        <Button variant="ghost" onClick={() => setSelected([])}>
          Clear selection
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-2">
        Every bone of the model: the humanoid core, the spine (any number of bones), and roles like breasts, butt, hair, skirt, tail and helpers. Roles drive physics, body sliders and retargeting. Tap a bone in the list or near its dot in the 3D view.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={missing.length ? 'danger' : 'success'}>{missing.length ? `Missing: ${missing.map(label).join(', ')}` : 'Main bones mapped'}</Badge>
        <Badge>{names.length} bones</Badge>
        {review ? <Badge tone="warning">{review} to review</Badge> : null}
        {unmapped ? <Badge>{unmapped} unmapped</Badge> : null}
        {rig.base ? <Badge>{rig.base}</Badge> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon={Wand2} disabled={!handle} onClick={rerun}>
          Map automatically
        </Button>
        <Button size="sm" variant="ghost" icon={RotateCcw} disabled={!handle} onClick={() => set({ boneMap: handle?.model.automaticBoneMap ?? avatar.info.boneMap ?? {}, rig: (avatar.info as { rig?: RigMapping }).rig })}>
          Back to the import’s mapping
        </Button>
        <FileButton
          size="sm"
          variant="secondary"
          onFiles={async ([file]) => {
            if (!file) return;
            try {
              const json = await readPreset(avatar.id, file);
              if (json.format !== 'everloom-rig-map' || json.version !== 1) throw new Error('Choose an Everloom rig mapping preset, version 1.');
              const boneMap = BoneMapSchema.parse(json.boneMap);
              if (Object.values(boneMap).some((name) => name && !names.includes(name))) throw new Error('This preset refers to bones missing from this model. Choose a preset for the same rig.');
              set({ boneMap, physics: AvatarConfigSchema.shape.physics.parse(json.physics ?? config.physics), ...(json.rig ? { rig: RigMappingSchema.parse(json.rig) } : {}) });
            } catch (e) {
              toastError(e);
            }
          }}
        >
          Import mapping preset
        </FileButton>
        <Button size="sm" variant="secondary" onClick={() => void downloadPreset(avatar.id, config, 'rig').catch(toastError)}>
          Save mapping preset
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Test pose" value={pose} onChange={(v) => setPose(v as typeof pose)} options={[{ value: 'idle', label: 'Idle' }, { value: 'tpose', label: 'T-pose' }, { value: 'apose', label: 'A-pose' }, { value: 'armsUp', label: 'Arms up' }, { value: 'squat', label: 'Squat' }, { value: 'shake', label: 'Shake' }, { value: 'walk', label: 'Walk' }]} />
        <Switch label="Show bones" checked={showBones} onChange={setShowBones} />
        <span className="text-sm text-fg-2">Show bones</span>
      </div>
      <Segmented label="Bones view" value={view} onChange={(v) => setView(v as typeof view)} options={[{ value: 'skeleton', label: 'Skeleton' }, { value: 'humanoid', label: 'Humanoid' }]} />
      {view === 'skeleton' ? (
        <>
          {rig.spine.length ? (
            <section aria-label="Spine chain">
              <SectionTitle className="p-0">Spine chain</SectionTitle>
              <p className="mb-1 text-xs text-fg-2">From the hips up. A bend is shared over all of them, so long spines move smoothly.</p>
              <ol className="flex flex-col gap-1">
                {rig.spine.map((b, i) => (
                  <li key={b} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">{b}</span>
                    <Button size="sm" variant="ghost" icon={ArrowUp} aria-label={`Move ${b} up`} disabled={i === 0} onClick={() => moveSpine(i, -1)} />
                    <Button size="sm" variant="ghost" icon={ArrowDown} aria-label={`Move ${b} down`} disabled={i === rig.spine.length - 1} onClick={() => moveSpine(i, 1)} />
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {desktop ? (
            tree
          ) : (
            <>
              <Button variant="secondary" icon={ListTree} onClick={() => setTreeSheet(true)}>
                Open the skeleton ({names.length} bones)
              </Button>
              <Sheet open={treeSheet} onOpenChange={setTreeSheet} title="Skeleton" size="lg">
                <div className="flex flex-col gap-3">
                  {tree}
                  {assignPanel}
                </div>
              </Sheet>
            </>
          )}
          {desktop || !treeSheet ? assignPanel : null}
        </>
      ) : (
        GROUPS.map((g) => {
          const mapped = g.bones.filter((b) => config.boneMap[b]).length;
          const isOpen = open[g.label] ?? !g.folded;
          return (
            <section key={g.label}>
              <button type="button" className="flex w-full items-center justify-between py-1" onClick={() => setOpen((o) => ({ ...o, [g.label]: !isOpen }))} aria-expanded={isOpen}>
                <SectionTitle className="p-0">{g.label}</SectionTitle>
                <Badge>
                  {mapped}/{g.bones.length}
                </Badge>
              </button>
              {isOpen ? (
                <div className="mt-1 flex flex-col gap-1.5">
                  {g.bones.map((b) => {
                    const req = (REQUIRED_BONES as HumanBone[]).includes(b);
                    return (
                      <label key={b} className="grid grid-cols-[7.5rem_1fr] items-center gap-2 text-sm">
                        <span className={cx(req && !config.boneMap[b] && 'font-medium text-danger')}>
                          {label(b)}
                          {req ? <span className="text-fg-3"> *</span> : null}
                        </span>
                        <Select aria-label={label(b)} value={config.boneMap[b] ?? ''} onChange={(e) => assignHumanoid(b, e.target.value)} className="h-9 py-0 text-sm">
                          <option value="">— none —</option>
                          {names.map((n) => (
                            <option key={n} value={n}>
                              {'· '.repeat(Math.min(8, depth.get(n) ?? 0))}
                              {n}
                            </option>
                          ))}
                        </Select>
                      </label>
                    );
                  })}
                </div>
              ) : null}
            </section>
          );
        })
      )}
    </div>
  );
}
