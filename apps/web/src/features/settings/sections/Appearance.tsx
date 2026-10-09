/**
 * Settings › Appearance & themes: the theme gallery (live previews), light or dark, scenery, this
 * device's own choice, reading settings and motion. docs/ux/themes.md.
 */
import { Check } from 'lucide-react';
import { cx } from '@/lib/format';
import { applyLooks, applyMotion, applyPalette, applyReading, applyTextSize, applyTheme, useLookId } from '@/lib/theme';
import { Field, Icon, Segmented, Select, Slider, ToggleRow } from '@/ui';
import { setDeviceLook, useDeviceLook } from '@/themes/device';
import { FONTS, LOOKS, look as lookOf, type Scheme } from '@/themes/looks';
import { LookPreview } from '@/themes/LookPreview';
import { Section, useSettingsPatch } from '../common';

const PALETTES = [
  { value: 'amber', label: 'Amber', swatch: '#cf912f' },
  { value: 'dusk', label: 'Dusk', swatch: '#7a5ccf' },
  { value: 'sea', label: 'Sea', swatch: '#1b7978' },
  { value: 'rose', label: 'Rose', swatch: '#c24a6c' },
] as const;

const READING = { leading: 1.6, width: 760, paragraph: 0.75, storyFont: null, uiFont: null };

export default function AppearanceSection() {
  const { settings, update } = useSettingsPatch();
  const device = useDeviceLook();
  const shown = useLookId();
  if (!settings) return null;
  const account = settings.look?.id ?? 'everloom';
  const deviceOnly = device.id !== null;
  const chosen = device.id ?? account;
  const scheme: Scheme = settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  const reading = { ...READING, ...(settings.look?.reading ?? {}) };
  const scenery = device.scenery ?? settings.look?.scenery ?? 'animated';
  const pick = (id: string) => {
    if (deviceOnly) {
      setDeviceLook({ id });
      applyLooks({ device: id });
    } else {
      applyLooks({ account: id });
      void update({ look: { id } });
    }
  };
  const setReading = (p: Partial<typeof reading>) => {
    const next = { ...reading, ...p };
    applyReading(next);
    void update({ look: { reading: next } });
  };
  const current = lookOf(chosen);

  return (
    <>
      <Section title="Theme" description="Each theme is a whole design: colors, type, shapes, motion, and on the play screen, scenery around the story. Tap one to use it.">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Segmented
            size="sm"
            label="Use the theme on"
            value={deviceOnly ? 'device' : 'all'}
            onChange={(v) => {
              if (v === 'device') setDeviceLook({ id: chosen });
              else {
                setDeviceLook({ id: null });
                applyLooks({ device: null });
              }
            }}
            options={[
              { value: 'all', label: 'All my devices' },
              { value: 'device', label: 'This device only' },
            ]}
          />
          {shown !== chosen ? <span className="text-xs text-fg-2">This chat's world uses {lookOf(shown).name} right now.</span> : null}
        </div>
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {LOOKS.map((l) => {
            const on = l.id === chosen;
            return (
              <button key={l.id} role="radio" aria-checked={on} aria-label={l.name} onClick={() => pick(l.id)} className="pressable group flex flex-col gap-1.5 rounded-lg p-1 text-left">
                <LookPreview id={l.id} scheme={scheme} active={on} />
                <span className="flex items-center gap-1.5 px-0.5 text-sm font-medium">
                  {on ? <Icon icon={Check} size={14} className="text-accent-text" /> : null}
                  {l.name}
                </span>
                <span className="line-clamp-2 px-0.5 text-xs text-fg-2">{l.description}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Light or dark" description={current.schemes.length === 1 ? `${current.name} is always ${current.schemes[0]}; this choice applies to themes that have both.` : 'Follow this device, or always light or dark.'}>
        <Segmented
          label="Light or dark"
          value={settings.theme}
          onChange={(v) => {
            applyTheme(v);
            void update({ theme: v });
          }}
          options={[
            { value: 'system', label: 'Like this device' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
        {current.id === 'everloom' ? (
          <Field label="Accent" className="mt-4">
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
        ) : null}
      </Section>

      <Section title="Scenery" description="Animated scenes around the story on the play screen: in the margins on a wide screen, a thin band at the top on a phone. They pause while you type on a phone and when the tab is hidden.">
        <div className="flex flex-col gap-3">
          <Segmented
            label="Scenery"
            value={scenery}
            onChange={(v) => {
              if (device.scenery !== null) setDeviceLook({ scenery: v });
              else void update({ look: { scenery: v } });
            }}
            options={[
              { value: 'animated', label: 'Animated' },
              { value: 'still', label: 'Still' },
              { value: 'off', label: 'Off' },
            ]}
          />
          <ToggleRow label="Different scenery on this device" description="For example off on your phone and animated on your computer." checked={device.scenery !== null} onChange={(v) => setDeviceLook({ scenery: v ? scenery : null })} />
          <ToggleRow label="Let a world use its own theme on this device" description="A chat can have its own theme (tap its title, then Theme for this world)." checked={device.worlds} onChange={(v) => {
            setDeviceLook({ worlds: v });
            applyLooks({ worlds: v });
          }} />
        </div>
      </Section>

      <Section title="Reading" description="How the story reads. Fonts set here win over the theme's.">
        <div className="flex flex-col gap-4">
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
                { value: 'xlarge', label: 'Larger' },
              ]}
            />
          </Field>
          <Field label={`Line spacing: ${reading.leading.toFixed(2)}`}>
            <Slider label="Line spacing" min={1.3} max={2.1} step={0.05} value={reading.leading} onChange={(v) => setReading({ leading: v })} />
          </Field>
          <Field label={`Column width: ${reading.width}px`}>
            <Slider label="Column width" min={520} max={1000} step={20} value={reading.width} onChange={(v) => setReading({ width: v })} />
          </Field>
          <Field label={`Space between paragraphs: ${reading.paragraph.toFixed(2)}em`}>
            <Slider label="Space between paragraphs" min={0} max={1.6} step={0.05} value={reading.paragraph} onChange={(v) => setReading({ paragraph: v })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Story font" htmlFor="font-story">
              <Select id="font-story" value={reading.storyFont ?? ''} onChange={(e) => setReading({ storyFont: e.target.value || null })}>
                <option value="">The theme's ({current.name})</option>
                {FONTS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Interface font" htmlFor="font-ui">
              <Select id="font-ui" value={reading.uiFont ?? ''} onChange={(e) => setReading({ uiFont: e.target.value || null })}>
                <option value="">The theme's ({current.name})</option>
                {FONTS.filter((f) => f.id !== 'fell').map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="rounded-md bg-surface-2 p-4" aria-label="Sample">
            <div className="story">
              <p>
                Rain taps the window. <em>Mara sets down her cup.</em> &ldquo;We leave at first light,&rdquo; she says, &ldquo;whether the bridge holds or not.&rdquo;
              </p>
              <p>You look at the map again. The pass is narrower than you remembered.</p>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Motion and pictures">
        <div className="flex flex-col gap-4">
          <Field label="Motion" hint="Reduced turns animations into simple fades and holds the scenery still. Your device setting is also respected.">
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
          {current.id === 'everloom' ? <ToggleRow label="Match the story's genre" description="Fantasy stories get warm parchment tones, science fiction cool ones. Only in the story view, with the Everloom theme." checked={settings.genreTheme !== false} onChange={(v) => void update({ genreTheme: v })} /> : null}
          <ToggleRow label="Illustrations" description="Everloom's own pictures: item icons, genre cards, empty states and Pip. Off shows simple line icons instead." checked={settings.art?.enabled !== false} onChange={(v) => void update({ art: { enabled: v } })} />
          <Field label="New chats open in">
            <Segmented
              label="Default view"
              value={settings.chat.defaultMode}
              onChange={(v) => update({ chat: { defaultMode: v } })}
              options={[
                { value: 'chat', label: 'Chat view' },
                { value: 'stage', label: 'Stage view' },
              ]}
            />
          </Field>
        </div>
      </Section>
    </>
  );
}
