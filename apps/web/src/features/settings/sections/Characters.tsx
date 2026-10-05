import { Field, Select, ToggleRow } from '@/ui';
import { Section, useSettingsPatch } from '../common';

export default function CharactersSection() {
  const { settings, update } = useSettingsPatch();
  if (!settings) return null;
  const lib = settings.library;
  return (
    <>
      <Section title="Library">
        <div className="flex flex-col gap-1">
          <ToggleRow label="Card details on hover" description="Show tokens, chats and flags when you hover or long-press a card." checked={lib.cardInfo} onChange={(v) => update({ library: { cardInfo: v } })} />
          <ToggleRow label="Previous and next in the detail sheet" description="Step through the filtered list without closing the sheet." checked={lib.prevNext} onChange={(v) => update({ library: { prevNext: v } })} />
          <ToggleRow label="Info tab" description="Show ids and the raw card in the detail sheet, for troubleshooting." checked={lib.debug} onChange={(v) => update({ library: { debug: v } })} />
          <Field label="Automatic versions kept per character" htmlFor="lib-ret" hint="A version is saved before every change. Versions you save yourself are kept until you delete them." className="mt-3">
            <Select id="lib-ret" value={String(lib.versionRetention)} onChange={(e) => update({ library: { versionRetention: Number(e.target.value) } })}>
              {[10, 30, 100, 300].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Section>
    </>
  );
}
