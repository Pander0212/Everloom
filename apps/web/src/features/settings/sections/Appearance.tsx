import { Field, Segmented } from '@/ui';
import { applyMotion, applyTextSize, applyTheme } from '@/lib/theme';
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
