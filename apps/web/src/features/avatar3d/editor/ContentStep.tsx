import { ageYears, type AvatarConfig } from '@everloom/engine';
import { Button, confirm, Field, Input, Textarea, ToggleRow } from '@/ui';
import { useSettingsPatch } from '@/features/settings/common';
export function ContentStep({ config, set }: { config: AvatarConfig; set: (p: Partial<AvatarConfig>) => void }) {
  const { settings, update } = useSettingsPatch(), content = config.content;
  const eligible = (content.age ?? 0) >= 18 && (!config.makehuman || ageYears(config.makehuman.macro.age) >= 18);
  return <div className="flex flex-col gap-4">
    <Field label="Recorded character age"><Input aria-label="Recorded character age" type="number" min={0} max={120} value={content.age ?? ''} onChange={e => set({ content: { ...content, age: e.target.value === '' ? null : Number(e.target.value), adult: false, confirmedAdult: false } })} /></Field>
    <Field label="Character description" hint="The server also checks linked character cards."><Textarea aria-label="Character description" value={content.description} maxLength={4000} onChange={e => set({ content: { ...content, description: e.target.value, adult: false, confirmedAdult: false } })} /></Field>
    <ToggleRow label="Adult character (18+)" description={settings?.library.nsfw && settings.library.adultConfirmed ? 'Requires a recorded adult age and adult confirmation. Save to apply server validation.' : 'Enable Adult content (18+) in Settings › Features first.'} checked={content.adult} disabled={!eligible || !settings?.library.nsfw || !settings.library.adultConfirmed} onChange={async adult => {
      if (adult && !await confirm({ title: 'Confirm this character is an adult', description: 'Confirm the depicted character is 18 or older. Imported geometry cannot determine age. Descriptions identifying a minor will still be refused.', confirmLabel: 'This character is an adult' })) return;
      set({ content: { ...content, adult, confirmedAdult: adult } });
    }} />
    {content.adult ? <Button variant="secondary" onClick={() => void update({ library: { nsfw: false } })}>Hide adult content now</Button> : null}
  </div>;
}
