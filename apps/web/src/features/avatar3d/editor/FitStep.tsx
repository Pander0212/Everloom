/** Step 4: size, floor, facing, look and hair/cloth physics. */
import type { AvatarConfig } from '@everloom/engine';
import { useEffect, useState } from 'react';
import { Field, Input, SectionTitle, Segmented, Slider, Switch } from '@/ui';
import type { PreviewHandle } from '../Preview3D';
import { PhysicsEditor } from './PhysicsEditor';

export function FitStep({ config, set, handle }: { config: AvatarConfig; set: (p: Partial<AvatarConfig>) => void; handle: PreviewHandle | null }) {
  const raw = handle?.model.rawHeight ?? null;
  const shown = handle?.model.height ?? null;
  const [height, setHeight] = useState('');
  useEffect(() => {
    if (shown) setHeight(shown.toFixed(2));
  }, [shown]);
  useEffect(() => {
    handle?.stage.setFraming('full');
  }, [handle]);

  const applyHeight = () => {
    const h = Number(height);
    if (!raw || !Number.isFinite(h) || h < 0.4 || h > 3) {
      if (shown) setHeight(shown.toFixed(2));
      return;
    }
    // The rendered height before scaling (the model's own units), so scale = wanted / raw.
    set({ scale: Math.round((h / raw) * 1e6) / 1e6 });
  };

  return (
    <div className="flex flex-col gap-4">
      <Field label="Height" hint={handle?.model.autoFit ? 'The file used odd units, so it was fitted to a typical height. Set the real height here.' : 'In metres, from the floor to the top of the head (or hair).'}>
        <div className="flex items-center gap-2">
          <Input aria-label="Height in metres" inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} onBlur={applyHeight} onKeyDown={(e) => e.key === 'Enter' && applyHeight()} className="w-28" />
          <span className="text-sm text-fg-2">m</span>
        </div>
      </Field>
      <Field label={`Floor (${Math.round(config.floor * 100)} cm)`} hint="Raise or lower the model so its feet meet the floor shadow.">
        <Slider label="Floor offset" min={-0.25} max={0.25} step={0.005} value={config.floor} onChange={(v) => set({ floor: v })} />
      </Field>
      <Field label="Facing" hint="Turn the model if it doesn't face the camera.">
        <Segmented<string>
          label="Facing"
          value={String(config.facing)}
          onChange={(v) => set({ facing: Number(v) as AvatarConfig['facing'] })}
          options={[
            { value: '0', label: 'As is' },
            { value: '90', label: '90°' },
            { value: '180', label: '180°' },
            { value: '270', label: '270°' },
          ]}
        />
      </Field>

      <SectionTitle>Look</SectionTitle>
      <Segmented<AvatarConfig['look']>
        label="Look"
        value={config.look}
        onChange={(v) => set({ look: v })}
        options={[
          { value: 'auto', label: 'Automatic' },
          { value: 'toon', label: 'Anime (toon)' },
          { value: 'pbr', label: 'Realistic' },
        ]}
      />
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Outlines (toon look)</span>
        <Switch checked={config.outlines} onChange={(v) => set({ outlines: v })} label="Outlines" />
      </label>

      <SectionTitle>Hair and cloth</SectionTitle>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Physics</span>
        <Switch checked={config.physics.enabled} onChange={(v) => set({ physics: { ...config.physics, enabled: v } })} label="Physics" />
      </label>
      {config.physics.enabled ? (
        <>
          <Field label={`Stiffness (${config.physics.stiffness.toFixed(1)}×)`} hint="Higher keeps hair and cloth closer to their shape.">
            <Slider label="Stiffness" min={0.2} max={3} step={0.1} value={config.physics.stiffness} onChange={(v) => set({ physics: { ...config.physics, stiffness: v } })} />
          </Field>
          <Field label={`Gravity (${config.physics.gravity.toFixed(1)}×)`}>
            <Slider label="Gravity" min={0} max={3} step={0.1} value={config.physics.gravity} onChange={(v) => set({ physics: { ...config.physics, gravity: v } })} />
          </Field>
          <PhysicsEditor config={config} set={set} handle={handle} />
        </>
      ) : null}
    </div>
  );
}
