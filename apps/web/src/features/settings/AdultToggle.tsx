import { confirm, ToggleRow } from '@/ui';
import { useSettingsPatch } from './common';
import { queryClient } from '@/lib/queries';
export default function AdultToggle() {
  const { settings, update } = useSettingsPatch();
  if (!settings) return null;
  return <ToggleRow label="Adult content (18+)" description="Off by default. Shows adult characters when browsing and importing from online sites. Everything else in Everloom shows adult content without a setting." checked={settings.library.nsfw} onChange={async value => {
    if (value && !settings.library.adultConfirmed && !await confirm({ title: 'Adult content (18+)', description: 'Confirm that you are 18 or older. Adult editing is restricted to characters whose recorded age and description identify them as adults.', confirmLabel: 'I am 18 or older' })) return;
    await update({ library: { nsfw: value, ...(value ? { adultConfirmed: true } : {}) } });
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['makehuman'] }), queryClient.invalidateQueries({ queryKey: ['source-search'] })]);
  }} />;
}
