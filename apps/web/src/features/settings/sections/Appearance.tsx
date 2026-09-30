import { cx } from '@/lib/format';
import { Field, Segmented, ToggleRow } from '@/ui';
import { applyMotion, applyPalette, applyTextSize, applyTheme } from '@/lib/theme';

const PALETTES = [
  { value: 'amber', label: 'Amber', swatch: '#cf912f' },
  { value: 'dusk', label: 'Dusk', swatch: '#7a5ccf' },
  { value: 'sea', label: 'Sea', swatch: '#1b7978' },
  { value: 'rose', label: 'Rose', swatch: '#c24a6c' },
] as const;
import { Section, useSettingsPatch } from '../common';

export default function AppearanceSection() {
  const { settings, update } = useSettingsPatch();
  if (!settings) return null;
  return (
    <Section title="Appearance">
      <div className="flex flex-col gap-5">
        <Field label="Theme">
          <Segmented
            label="Theme"
            value={settings.theme}
            onChange={(v) => {
              applyTheme(v);
              void update({ theme: v });
            }}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </Field>
        <Field label="Accent">
          <div role="radiogroup" aria-label="Accent" className="flex flex-wrap gap-2">
            {PALETTES.map((p) => {
              const on = (settings.palette ?? 'amber') === p.value;
              return (
                <button
                  key={p.value}
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    applyPalette(p.value);
                    void update({ palette: p.value });
                  }}
                  className={cx('pressable flex h-10 items-center gap-2 rounded-md border px-3 text-sm', on ? 'border-accent bg-accent-soft font-medium' : 'border-line hover:bg-surface-2')}
                >
                  <span className="size-4 rounded-full" style={{ background: p.swatch }} aria-hidden="true" />
                  {p.label}
                </button>
              );
            })}
          </div>
        </Field>
        <ToggleRow label="Match the story's genre" description="Fantasy stories get warm parchment tones, science fiction cool ones. Only in the story view." checked={settings.genreTheme !== false} onChange={(v) => void update({ genreTheme: v })} />
        <Field label="Motion" hint="Reduced turns animations into simple fades. Your device setting is also respected.">
          <Segmented
            label="Motion"
            value={settings.motion}
            onChange={(v) => {
              applyMotion(v);
              void update({ motion: v });
            }}
            options={[
              { value: 'full', label: 'Full' },
              { value: 'reduced', label: 'Reduced' },
            ]}
          />
        </Field>
        <Field label="Story text size">
          <Segmented
            label="Story text size"
            value={settings.textSize}
            onChange={(v) => {
              applyTextSize(v);
              void update({ textSize: v });
            }}
            options={[
              { value: 'small', label: 'Small' },
              { value: 'medium', label: 'Medium' },
              { value: 'large', label: 'Large' },
            ]}
          />
        </Field>
        <Field label="New chats open in">
          <Segmented
            label="Default mode"
            value={settings.chat.defaultMode}
            onChange={(v) => update({ chat: { defaultMode: v } })}
            options={[
              { value: 'chat', label: 'Chat' },
              { value: 'stage', label: 'Stage' },
            ]}
          />
        </Field>
      </div>
    </Section>
  );
}
