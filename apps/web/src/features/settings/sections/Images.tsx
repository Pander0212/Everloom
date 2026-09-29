import { Field, Input, ToggleRow } from '@/ui';
import { Section, useSettingsPatch } from '../common';

export default function ImagesSection() {
  const { settings, update } = useSettingsPatch();
  if (!settings) return null;
  return (
    <Section title="Images" description="Pick the image connection under Connections → Roles.">
      <div className="flex flex-col divide-y divide-line">
        <ToggleRow label="Suggest scene backgrounds" description="Offer a background when you arrive somewhere new." checked={settings.images.autoBackground} onChange={(v) => update({ images: { autoBackground: v } })} />
      </div>
      <Field label="Style" htmlFor="ist" hint="Appended to every image prompt." className="mt-3">
        <Input id="ist" value={settings.images.style} onChange={(e) => update({ images: { style: e.target.value } })} />
      </Field>
    </Section>
  );
}
