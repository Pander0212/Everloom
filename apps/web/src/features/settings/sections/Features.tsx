/**
 * Settings › Features: a preset (Classic chat, Story, Full RPG) or one switch per module. Off means
 * completely off: no screens, no prompt text, no model calls. Nothing is deleted, so switching back
 * brings everything back. A switch that takes others with it says so before applying.
 */
import { FEATURES, FEATURE_PRESETS, featureDef, PRESET_INFO, toggleFeature, type FeatureGroup, type FeatureId, type FeaturePreset, type FeatureSet, type MemoryMode } from '@everloom/engine';
import { Check } from 'lucide-react';
import { cx } from '@/lib/format';
import { confirm, Segmented, Switch, ToggleRow } from '@/ui';
import { Section, useSettingsPatch } from '../common';

const GROUPS: Array<{ id: FeatureGroup; title: string; description: string }> = [
  { id: 'game', title: 'Game layer', description: 'The world state the story keeps track of. Off, Everloom is a plain roleplay chat.' },
  { id: 'story', title: 'Story presentation', description: 'How the story looks and sounds.' },
  { id: 'helpers', title: 'AI helpers', description: 'Extra model work around a reply. Each one costs calls when on.' },
  { id: 'tools', title: 'Tools', description: 'Everything else you might not want.' },
];

const MEMORY: Array<{ value: MemoryMode; label: string }> = [
  { value: 'full', label: 'Full memory' },
  { value: 'summary', label: 'Rolling summary' },
  { value: 'off', label: 'Off' },
];

export default function FeaturesSection() {
  const { settings, update } = useSettingsPatch();
  if (!settings) return null;
  const f = settings.features;
  const set = f.set;

  const pick = async (p: FeaturePreset) => {
    if (p === f.preset) return;
    await update({ features: { preset: p } });
  };
  const flip = async (id: FeatureId, value: boolean) => {
    const r = toggleFeature(set, id, value);
    if (r.also.length) {
      const names = r.also.map((x) => featureDef(x).label).join(', ');
      const ok = await confirm({
        title: value ? `Turn on ${featureDef(id).label}?` : `Turn off ${featureDef(id).label}?`,
        description: value ? `It needs these, so they turn on too: ${names}.` : `This also turns off: ${names}. Nothing is deleted; turning them back on restores everything.`,
        confirmLabel: value ? 'Turn on' : 'Turn off',
      });
      if (!ok) return;
    }
    await update({ features: { set: { on: r.set.on } } as never });
  };

  return (
    <>
      <Section title="Mode" description="Pick a starting point; every switch below can still be changed. A chat can also have its own mode: tap its title, then Mode.">
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Mode">
          {FEATURE_PRESETS.map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={f.preset === p}
              onClick={() => pick(p)}
              className={cx('pressable flex flex-col gap-1 rounded-lg border p-3 text-left', f.preset === p ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2')}
            >
              <span className="flex items-center gap-2 font-medium">
                {PRESET_INFO[p].label}
                {f.preset === p ? <Check size={16} className="text-accent-text" /> : null}
              </span>
              <span className="text-xs text-fg-2">{PRESET_INFO[p].description}</span>
            </button>
          ))}
        </div>
        {f.preset === 'custom' ? <p className="mt-2 text-xs text-fg-2">Custom: your own mix of switches.</p> : null}
      </Section>
      <Section title="Memory" description="Full memory recalls what each person knows; a rolling summary only keeps the story so far (one background call every few replies); off sends nothing extra.">
        <Segmented label="Memory" value={set.memory} onChange={(v) => update({ features: { set: { memory: v } } as never })} options={MEMORY} />
      </Section>
      {GROUPS.map((g) => (
        <Section key={g.id} title={g.title} description={g.description}>
          <ul className="flex flex-col divide-y divide-line" aria-label={g.title}>
            {FEATURES.filter((x) => x.group === g.id).map((x) => (
              <FeatureRow key={x.id} id={x.id} set={set} onChange={flip} master={x.id === 'game'} />
            ))}
          </ul>
        </Section>
      ))}
      <Section title="Experimental" description="Pages for testing and building Everloom itself: the design system, the 3D lab and the puppet lab. They appear in Tools › Advanced.">
        <ToggleRow label="Show experimental tools" checked={!!settings.ui?.experimental} onChange={(v) => void update({ ui: { experimental: v } as never })} />
      </Section>
    </>
  );
}

function FeatureRow({ id, set, onChange, master }: { id: FeatureId; set: FeatureSet; onChange: (id: FeatureId, v: boolean) => void; master: boolean }) {
  const d = featureDef(id);
  const blocked = d.requires.filter((r) => !set.on[r]);
  return (
    <li className={cx('flex items-start gap-3 py-3', !master && d.group === 'game' && 'pl-3')}>
      <span className="min-w-0 flex-1">
        <span className={cx('block text-sm', master ? 'font-semibold' : 'font-medium')}>{d.label}</span>
        <span className="block text-xs text-fg-2">{d.description}</span>
        {blocked.length ? <span className="mt-0.5 block text-xs text-fg-3">Needs {blocked.map((r) => featureDef(r).label).join(', ')}</span> : null}
      </span>
      <Switch label={d.label} checked={set.on[id]} onChange={(v) => onChange(id, v)} />
    </li>
  );
}
