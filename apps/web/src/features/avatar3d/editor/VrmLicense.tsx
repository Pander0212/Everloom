/**
 * VRM license information. For an imported VRM: its own metadata (who may use it, modify it,
 * redistribute it, sexual and violent use, commercial use), shown for information only; nothing is
 * blocked, everything runs on the owner's own install, and exports keep it. A warning appears where
 * it matters: exporting or sharing a model whose license forbids redistribution. For the owner's
 * own characters: a form for the license their VRM export carries.
 */
import type { AvatarConfig } from '@everloom/engine';
import type { VRMMeta } from '@pixiv/three-vrm';
import { Field, Input, Select, Switch } from '@/ui';

interface Row { label: string; value: string; bad?: boolean }

/** VRM 0.x and 1.0 metadata as plain rows, and whether redistribution is forbidden. */
export function licenseRows(meta: VRMMeta): { title: string; rows: Row[]; noRedistribution: boolean; url: string | null } {
  if (meta.metaVersion === '1') {
    const m = meta;
    const yes = (b: boolean | undefined) => (b ? 'Allowed' : 'Not allowed');
    return {
      title: m.name || 'Untitled',
      url: m.licenseUrl || null,
      noRedistribution: m.allowRedistribution !== true,
      rows: [
        { label: 'Author', value: (m.authors ?? []).join(', ') || 'Not given' },
        { label: 'Who may use it', value: { onlyAuthor: 'Only the author', onlySeparatelyLicensedPerson: 'People the author licensed', everyone: 'Everyone' }[m.avatarPermission ?? 'onlyAuthor'] ?? String(m.avatarPermission) },
        { label: 'Commercial use', value: { personalNonProfit: 'Personal, non-profit', personalProfit: 'Personal, for profit', corporation: 'Companies too' }[m.commercialUsage ?? 'personalNonProfit'] ?? String(m.commercialUsage) },
        { label: 'Modification', value: { prohibited: 'Not allowed', allowModification: 'Allowed', allowModificationRedistribution: 'Allowed, and sharing modified versions' }[m.modification ?? 'prohibited'] ?? String(m.modification), bad: m.modification === 'prohibited' },
        { label: 'Redistribution', value: yes(m.allowRedistribution), bad: m.allowRedistribution !== true },
        { label: 'Sexual use', value: yes(m.allowExcessivelySexualUsage) },
        { label: 'Violent use', value: yes(m.allowExcessivelyViolentUsage) },
        { label: 'Credit', value: m.creditNotation === 'unnecessary' ? 'Not needed' : 'Required' },
      ],
    };
  }
  const m = meta;
  const ok = (v: string | undefined) => (v === 'Allow' ? 'Allowed' : v === 'Disallow' ? 'Not allowed' : v || 'Not given');
  const noRedist = m.licenseName === 'Redistribution_Prohibited' || /ND/.test(m.licenseName ?? '');
  return {
    title: m.title || 'Untitled',
    url: m.otherLicenseUrl || null,
    noRedistribution: noRedist,
    rows: [
      { label: 'Author', value: m.author || 'Not given' },
      { label: 'Who may use it', value: { OnlyAuthor: 'Only the author', ExplicitlyLicensedPerson: 'People the author licensed', Everyone: 'Everyone' }[m.allowedUserName ?? 'OnlyAuthor'] ?? String(m.allowedUserName) },
      { label: 'Commercial use', value: ok(m.commercialUssageName) },
      { label: 'Sexual use', value: ok(m.sexualUssageName) },
      { label: 'Violent use', value: ok(m.violentUssageName) },
      { label: 'License', value: m.licenseName || 'Not given', bad: noRedist },
    ],
  };
}

export function VrmLicensePanel({ meta, exporting }: { meta: VRMMeta; exporting?: boolean }) {
  const l = licenseRows(meta);
  return (
    <section className="rounded-md border border-line p-3 text-sm" aria-label="VRM license" data-testid="vrm-license">
      <p className="font-medium">VRM license: {l.title}</p>
      <p className="mt-0.5 text-xs text-fg-3">From the file. Information only: nothing here is blocked, and an export keeps this license.</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {l.rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-fg-2">{r.label}</dt>
            <dd className={r.bad ? 'text-warning' : undefined}>{r.value}</dd>
          </div>
        ))}
      </dl>
      {l.url ? <p className="mt-2 text-xs"><a className="underline" href={l.url} target="_blank" rel="noreferrer">The full license</a></p> : null}
      {exporting && l.noRedistribution ? <p role="note" className="mt-2 rounded bg-surface-2 p-2 text-warning" data-testid="vrm-license-warning">This model's license doesn't allow redistribution. Keep the export for yourself; don't share or upload it.</p> : null}
    </section>
  );
}

type Meta = NonNullable<AvatarConfig['vrmMeta']>;
const DEFAULT: Meta = { name: '', authors: [], licenseUrl: 'https://vrm.dev/licenses/1.0/', avatarPermission: 'onlyAuthor', commercialUsage: 'personalNonProfit', allowRedistribution: false, modification: 'prohibited', allowExcessivelySexualUsage: false, allowExcessivelyViolentUsage: false, creditNotation: 'required' };

/** The license the owner's own character carries in a VRM export. */
export function VrmLicenseForm({ value, onChange }: { value: AvatarConfig['vrmMeta']; onChange: (v: Meta) => void }) {
  const m = { ...DEFAULT, ...value };
  const set = (patch: Partial<Meta>) => onChange({ ...m, ...patch });
  return (
    <details className="rounded-md border border-line p-3 text-sm" data-testid="vrm-license-form">
      <summary className="cursor-pointer font-medium">VRM license for this character</summary>
      <div className="mt-3 flex flex-col gap-3">
        <Field label="Name in the file"><Input aria-label="VRM name" value={m.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Authors (comma-separated)"><Input aria-label="VRM authors" value={m.authors.join(', ')} onChange={(e) => set({ authors: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8) })} /></Field>
        <Field label="Who may use it"><Select aria-label="VRM who may use it" value={m.avatarPermission} onChange={(e) => set({ avatarPermission: e.target.value as Meta['avatarPermission'] })}><option value="onlyAuthor">Only me</option><option value="onlySeparatelyLicensedPerson">People I license</option><option value="everyone">Everyone</option></Select></Field>
        <Field label="Commercial use"><Select aria-label="VRM commercial use" value={m.commercialUsage} onChange={(e) => set({ commercialUsage: e.target.value as Meta['commercialUsage'] })}><option value="personalNonProfit">Personal, non-profit</option><option value="personalProfit">Personal, for profit</option><option value="corporation">Companies too</option></Select></Field>
        <Field label="Modification"><Select aria-label="VRM modification" value={m.modification} onChange={(e) => set({ modification: e.target.value as Meta['modification'] })}><option value="prohibited">Not allowed</option><option value="allowModification">Allowed</option><option value="allowModificationRedistribution">Allowed, and sharing modified versions</option></Select></Field>
        <label className="flex items-center justify-between gap-3">Redistribution allowed<Switch label="VRM redistribution" checked={m.allowRedistribution} onChange={(v) => set({ allowRedistribution: v })} /></label>
        <label className="flex items-center justify-between gap-3">Sexual use allowed<Switch label="VRM sexual use" checked={m.allowExcessivelySexualUsage} onChange={(v) => set({ allowExcessivelySexualUsage: v })} /></label>
        <label className="flex items-center justify-between gap-3">Violent use allowed<Switch label="VRM violent use" checked={m.allowExcessivelyViolentUsage} onChange={(v) => set({ allowExcessivelyViolentUsage: v })} /></label>
        <label className="flex items-center justify-between gap-3">Credit required<Switch label="VRM credit required" checked={m.creditNotation === 'required'} onChange={(v) => set({ creditNotation: v ? 'required' : 'unnecessary' })} /></label>
        <Field label="License link"><Input aria-label="VRM license link" value={m.licenseUrl} maxLength={300} onChange={(e) => set({ licenseUrl: e.target.value })} /></Field>
      </div>
    </details>
  );
}
