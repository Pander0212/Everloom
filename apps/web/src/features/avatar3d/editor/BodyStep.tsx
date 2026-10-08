/**
 * Body: the base-model check, sliders made from the file's morph targets (Body, Face, Other; the
 * mapping is editable and saved with the model), generated adjusters where the file has no morph,
 * and body presets that apply to any character made from the same base.
 */
import { BODY_KIND_LABEL, baseKey, baseReport, FALLBACK_FOR_KIND, mergeMorphSliders, MORPH_GROUPS, visibleSliders, type AvatarConfig, type MorphGroup, type MorphPreset, type MorphSettings, type MorphSlider } from '@everloom/engine';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, Info, Link2, Pencil, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { get } from '@/lib/api';
import { useSettings } from '@/lib/queries';
import { toastError } from '@/lib/store';
import { cx } from '@/lib/format';
import { Badge, Button, Checkbox, Field, IconButton, Input, SectionTitle, Segmented, Select, Slider, Switch } from '@/ui';
import type { PreviewHandle } from '../Preview3D';
import { adultContentAllowed } from '../Preview3D';
import { SHAPE_KEYS } from '../runtime/body-shape';
import { baseFacts, fileMorphs } from '../runtime/base-facts';

const GENERATED_LABEL = { chest: 'Breast / chest size', buttocks: 'Butt size', hips: 'Hip width', waist: 'Waist width', thighs: 'Thigh size', shoulders: 'Shoulder width' };
const zero = { chest: 0, buttocks: 0, hips: 0, waist: 0, thighs: 0, shoulders: 0 };
const GROUP_LABEL: Record<MorphGroup, string> = { body: 'Body', face: 'Face', other: 'Other' };
const emptySettings = (): MorphSettings => ({ base: null, sliders: [], values: {}, linkPairs: true, presets: [] });
const presetId = (name: string, taken: string[]) => { const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'preset'; let id = base, n = 2; while (taken.includes(id)) id = `${base}-${n++}`; return id; };

export function BodyStep({ config, set, handle }: { config: AvatarConfig; set: (p: Partial<AvatarConfig>) => void; handle: PreviewHandle | null }) {
  const settings = useSettings();
  const adultAllowed = adultContentAllowed(config.content, settings.data?.library.nsfw === true);
  const [group, setGroup] = useState<MorphGroup>('body');
  const [editing, setEditing] = useState(false);
  const [presetName, setPresetName] = useState('');
  const model = handle?.model;
  const names = useMemo(() => (model ? fileMorphs(model) : []), [model]);
  const report = useMemo(() => (model ? baseReport(baseFacts(model)) : null), [model]);
  const key = useMemo(() => (model ? baseKey({ morphs: names, bones: (model.rigBones ?? []).map((b) => b.name), vertices: model.meshes.reduce((n, m) => n + (m.geometry.getAttribute('position')?.count ?? 0), 0) }) : null), [model, names]);
  const morphs = config.morphs ?? emptySettings();

  // The mapping is made from the file once, then kept with the owner's edits (and saved with the model).
  useEffect(() => {
    if (!key || !model) return;
    const merged = mergeMorphSliders(morphs.sliders, names);
    if (morphs.base === key && JSON.stringify(merged) === JSON.stringify(morphs.sliders)) return;
    set({ morphs: { ...morphs, base: key, sliders: merged } });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const others = useQuery({ queryKey: ['avatar-morph-presets', key], queryFn: () => get<Array<{ avatarId: string; avatarName: string; preset: MorphPreset; current: boolean }>>('/api/avatar-morph-presets', { base: key! }), enabled: !!key && names.length > 0 });

  if (!handle || !model) return <p className="text-sm text-fg-2">Wait for the model preview.</p>;
  const setMorphs = (patch: Partial<MorphSettings>) => set({ morphs: { ...morphs, ...patch } });
  const setValue = (s: MorphSlider, v: number) => {
    const values = { ...morphs.values, [s.id]: v };
    if (s.pair && morphs.linkPairs) values[s.pair] = v;
    setMorphs({ values });
  };
  const editSlider = (id: string, patch: Partial<MorphSlider>) => {
    const before = morphs.sliders.find((s) => s.id === id);
    setMorphs({ sliders: morphs.sliders.map((s) => {
      if (s.id === id) return { ...s, ...patch };
      // Pairs go both ways: the new twin points back, the old one lets go.
      if (patch.pair !== undefined && s.id === patch.pair) return { ...s, pair: id };
      if (patch.pair !== undefined && before?.pair && s.id === before.pair && s.id !== patch.pair) return { ...s, pair: null };
      return s;
    }) });
  };
  const shown = visibleSliders(morphs.sliders, { adultAllowed, showHidden: editing }).filter((s) => s.group === group);
  const counts = Object.fromEntries(MORPH_GROUPS.map((g) => [g, visibleSliders(morphs.sliders, { adultAllowed, showHidden: editing }).filter((s) => s.group === g).length]));
  const shape = config.bodyShape ?? zero;
  // Generated adjusters stand in for body kinds the file has no morph for.
  const fallback = SHAPE_KEYS.filter((k) => !report?.bodyKinds.some((kind) => FALLBACK_FOR_KIND[kind as keyof typeof FALLBACK_FOR_KIND] === k));

  return (
    <div className="flex flex-col gap-4" data-testid="body-step">
      {report ? <BaseCheck report={report} /> : null}
      {morphs.sliders.length ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented size="sm" label="Slider group" value={group} onChange={setGroup} options={MORPH_GROUPS.map((g) => ({ value: g, label: `${GROUP_LABEL[g]} ${counts[g] ? `(${counts[g]})` : ''}` }))} />
            <Button size="sm" variant={editing ? 'primary' : 'secondary'} icon={Pencil} onClick={() => setEditing(!editing)}>{editing ? 'Done editing' : 'Edit sliders'}</Button>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-1.5"><Link2 className="size-4" aria-hidden /> Move left and right together</span><Switch checked={morphs.linkPairs} onChange={(v) => setMorphs({ linkPairs: v })} label="Link left and right sliders" /></label>
          {editing ? <p className="text-sm text-fg-2">Rename, regroup, hide, set ranges and pair left/right sliders. The mapping saves with the model and comes back when it's read again.</p> : null}
          {!shown.length ? <p className="text-sm text-fg-2">No {GROUP_LABEL[group].toLowerCase()} sliders{editing ? '' : ' (hidden ones show while editing)'}.</p> : null}
          <div className="flex flex-col gap-3">
            {shown.map((s) => editing ? (
              <SliderEditor key={s.id} slider={s} sliders={morphs.sliders} onChange={(p) => editSlider(s.id, p)} />
            ) : (
              <Field key={s.id} label={<span className="flex items-center gap-2">{s.label}{s.pair && morphs.linkPairs ? <Badge>L/R</Badge> : null}{s.adult ? <Badge tone="warning">Adults</Badge> : null}</span>}>
                <div className="flex items-center gap-3" onDoubleClick={() => setValue(s, 0)}>
                  <Slider label={s.label} min={s.min} max={s.max} step={0.01} value={morphs.values[s.id] ?? 0} onChange={(v) => setValue(s, v)} />
                  <Input aria-label={`${s.label} value`} className="w-20 flex-none" type="number" min={s.min} max={s.max} step={0.01} value={Number((morphs.values[s.id] ?? 0).toFixed(2))} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setValue(s, Math.min(s.max, Math.max(s.min, v))); }} />
                </div>
              </Field>
            ))}
          </div>
        </>
      ) : null}

      {group === 'body' || !morphs.sliders.length ? (
        <section className="flex flex-col gap-3">
          <SectionTitle>Generated adjusters</SectionTitle>
          <p className="text-sm text-fg-2">{names.length ? 'The file has no morph for these, so they are made by Everloom: they push regions of the mesh (and its clothes) in or out.' : 'This model has no morph targets, so these are made by Everloom instead: they push regions of the mesh (and its clothes) in or out.'} Generated, not sculpted: check the pose tester for clipping.</p>
          {model.bodyMorphs ? fallback.map((k) => (
            <Field key={k} label={<span className="flex items-center gap-2">{GENERATED_LABEL[k]}<Badge>Generated</Badge></span>}>
              <div className="flex items-center gap-3" onDoubleClick={() => set({ bodyShape: { ...shape, [k]: 0 } })}>
                <Slider label={`${GENERATED_LABEL[k]} (generated)`} min={-0.35} max={0.35} step={0.01} value={shape[k]} onChange={(value) => set({ bodyShape: { ...shape, [k]: value } })} />
                <Input aria-label={`${GENERATED_LABEL[k]} generated value`} className="w-20 flex-none" type="number" min={-0.35} max={0.35} step={0.01} value={shape[k]} onChange={(e) => { const value = Number(e.target.value); if (Number.isFinite(value)) set({ bodyShape: { ...shape, [k]: Math.min(0.35, Math.max(-0.35, value)) } }); }} />
              </div>
            </Field>
          )) : <p role="status" className="text-sm text-fg-2">{model.bodyMorphError ?? 'Generated adjusters are unavailable for this model.'}</p>}
          {!fallback.length ? <p className="text-sm text-fg-2">Not needed: the file has its own morphs for every region.</p> : null}
        </section>
      ) : null}

      {morphs.sliders.length ? (
        <section className="flex flex-col gap-3">
          <SectionTitle>Body presets</SectionTitle>
          <p className="text-sm text-fg-2">Save these slider values to use again, here or on any character made from this same base.</p>
          <div className="flex gap-2">
            <Input aria-label="Preset name" placeholder="Athletic" value={presetName} maxLength={60} onChange={(e) => setPresetName(e.target.value)} />
            <Button disabled={!presetName.trim()} onClick={() => { setMorphs({ presets: [...morphs.presets, { id: presetId(presetName, morphs.presets.map((p) => p.id)), name: presetName.trim(), values: { ...morphs.values } }].slice(-32) }); setPresetName(''); }}>Save</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {morphs.presets.map((p) => (
              <span key={p.id} className="flex items-center gap-1 rounded-full border border-line pl-3">
                <button type="button" className="pressable text-sm" onClick={() => setMorphs({ values: { ...p.values } })}>{p.name}</button>
                <IconButton size="sm" icon={Trash2} label={`Delete preset ${p.name}`} onClick={() => setMorphs({ presets: morphs.presets.filter((x) => x.id !== p.id) })} />
              </span>
            ))}
          </div>
          {(others.data ?? []).length > 1 ? (
            <Select aria-label="Apply a body from another character" value="" onChange={(e) => {
              const pick = others.data?.[Number(e.target.value)];
              if (!pick) return;
              // Only sliders this character has; others are left as they are.
              const values = Object.fromEntries(Object.entries(pick.preset.values).filter(([id]) => morphs.sliders.some((s) => s.id === id)));
              setMorphs({ values: { ...morphs.values, ...values } });
            }}>
              <option value="">From another character on this base…</option>
              {(others.data ?? []).map((o, i) => <option key={`${o.avatarId}:${o.preset.id}`} value={i}>{o.current ? o.preset.name : `${o.preset.name} (${o.avatarName})`}</option>)}
            </Select>
          ) : null}
        </section>
      ) : null}

      <Button variant="secondary" onClick={() => { try { set({ bodyShape: { ...zero }, ...(config.morphs ? { morphs: { ...morphs, values: {} } } : {}) }); } catch (e) { toastError(e); } }}>Reset body</Button>
    </div>
  );
}

function BaseCheck({ report }: { report: NonNullable<ReturnType<typeof baseReport>> }) {
  const issues = report.lines.filter((l) => l.tone === 'warn' || l.tone === 'off').length;
  const icon = { ok: Check, warn: AlertTriangle, off: X, info: Info } as const;
  const tone = { ok: 'text-success', warn: 'text-warning', off: 'text-danger', info: 'text-fg-2' } as const;
  return (
    <details className="rounded-md border border-line" data-testid="base-check" open={issues > 0}>
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium">
        <span className="flex-1">Base model check</span>
        {issues ? <Badge tone="warning">{issues} to look at</Badge> : <Badge tone="success">Ready</Badge>}
      </summary>
      <ul className="flex flex-col gap-2 border-t border-line p-3">
        {report.lines.map((l, i) => {
          const Icon = icon[l.tone];
          return (
            <li key={i} className="flex gap-2 text-sm">
              <Icon className={cx('mt-0.5 size-4 flex-none', tone[l.tone])} aria-label={l.tone} />
              <span><span className="font-medium">{l.title}.</span> <span className="text-fg-2">{l.detail}</span></span>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-line px-3 py-2 text-xs text-fg-2">
        Switched off: {Object.entries(report.features).filter(([, f]) => !f.on).map(([k, f]) => `${featureLabel(k)} (${f.why})`).join('; ') || 'nothing'}.
      </p>
    </details>
  );
}

const featureLabel = (k: string) => ({ animation: 'animation', bodySliders: 'body sliders', faceSliders: 'face sliders', expressions: 'expressions', fitting: 'clothes fitting', skinLayers: 'skin layers', chestPhysics: 'chest physics', fingers: 'finger animation' } as Record<string, string>)[k] ?? k;

function SliderEditor({ slider: s, sliders, onChange }: { slider: MorphSlider; sliders: MorphSlider[]; onChange: (p: Partial<MorphSlider>) => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line p-3" data-testid="slider-editor">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Input aria-label={`Label for ${s.plus.join(', ')}`} value={s.label} maxLength={60} onChange={(e) => onChange({ label: e.target.value || s.plus[0]! })} />
        <Select aria-label={`Group for ${s.label}`} value={s.group} onChange={(e) => onChange({ group: e.target.value as MorphGroup })} className="w-28">
          {MORPH_GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
        </Select>
      </div>
      <p className="text-xs text-fg-2">Drives {s.plus.join(', ')}{s.minus.length ? `; below zero ${s.minus.join(', ')}` : ''}{s.kind ? ` · ${BODY_KIND_LABEL[s.kind]}` : ''}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="From"><Input aria-label={`Minimum for ${s.label}`} type="number" step={0.1} min={-2} max={0} value={s.min} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange({ min: Math.max(-2, Math.min(0, v)) }); }} /></Field>
        <Field label="To"><Input aria-label={`Maximum for ${s.label}`} type="number" step={0.1} min={0} max={2} value={s.max} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange({ max: Math.max(0, Math.min(2, v)) }); }} /></Field>
        <Field label="Pair" className="col-span-2">
          <Select aria-label={`Left/right twin of ${s.label}`} value={s.pair ?? ''} onChange={(e) => onChange({ pair: e.target.value || null })}>
            <option value="">None</option>
            {sliders.filter((x) => x.id !== s.id).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </Select>
        </Field>
      </div>
      <Checkbox label="Hidden" checked={s.hidden} onChange={(v) => onChange({ hidden: v })} />
    </div>
  );
}
