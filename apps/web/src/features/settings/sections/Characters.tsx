import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { get, put } from '@/lib/api';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, Field, Input, Select, ToggleRow } from '@/ui';
import { Section, useSettingsPatch } from '../common';

interface Providers {
  nsfwAllowed: boolean;
  providers: Array<{ id: string; name: string; site: string; tokenHint: string | null; hasToken: boolean }>;
}

export default function CharactersSection() {
  const { settings, update } = useSettingsPatch();
  const qc = useQueryClient();
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => get<Providers>('/api/sources') });
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
      <Section title="Online sources" description="Browse and import characters from public sites. Everything is fetched by your Everloom server.">
        <div className="flex flex-col gap-4">
          <ToggleRow
            label="Show adult content"
            description="Off by default. When off, adult characters are hidden from browsing and can't be imported."
            checked={lib.nsfw}
            onChange={async (v) => {
              await update({ library: { nsfw: v } });
              await qc.invalidateQueries({ queryKey: ['sources'] });
              await qc.invalidateQueries({ queryKey: ['source-search'] });
            }}
          />
          {sources.data?.providers.map((p) => <TokenField key={p.id} p={p} onSaved={() => qc.invalidateQueries({ queryKey: ['sources'] })} />)}
        </div>
      </Section>
    </>
  );
}

function TokenField({ p, onSaved }: { p: Providers['providers'][number]; onSaved: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (token: string | null) => {
    setBusy(true);
    try {
      await put(`/api/sources/${p.id}/token`, { token });
      setValue('');
      toast({ title: token ? `${p.name} key saved` : `${p.name} key removed`, tone: 'success' });
      onSaved();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Field label={`${p.name} API key`} htmlFor={`tok-${p.id}`} hint={`${p.tokenHint ?? ''} Stored encrypted on your server; it is never shown again.`} trailing={p.hasToken ? <Badge tone="success">Saved</Badge> : null}>
      <div className="flex gap-2">
        <Input id={`tok-${p.id}`} type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder={p.hasToken ? '••••••••' : 'Paste your key'} />
        <Button loading={busy} disabled={!value.trim()} onClick={() => save(value)}>
          Save
        </Button>
        {p.hasToken ? (
          <Button variant="quiet" disabled={busy} onClick={() => save(null)}>
            Remove
          </Button>
        ) : null}
      </div>
    </Field>
  );
}
