import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Copy, MonitorSmartphone, Trash2 } from 'lucide-react';
import { del, post } from '@/lib/api';
import { get, put } from '@/lib/api';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, confirm, EmptyState, Field, IconButton, Input, Select, ToggleRow } from '@/ui';
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
          {sources.data?.providers.filter((p) => p.tokenHint).map((p) => <TokenField key={p.id} p={p} onSaved={() => qc.invalidateQueries({ queryKey: ['sources'] })} />)}
        </div>
      </Section>
      <BridgeSection />
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

interface Devices {
  devices: Array<{ id: string; label: string; createdAt: number; lastUsedAt: number | null }>;
  bookmarklet: string;
  userscriptUrl: string;
}

/** The browser bridge: per-device tokens for the "Send to Everloom" userscript, and the bookmarklet. */
function BridgeSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['bridge-devices'], queryFn: () => get<Devices>('/api/bridge/devices') });
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState<{ label: string; token: string } | null>(null);
  const ref = useRef<HTMLElement>(null);
  const bm = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (location.hash === '#bridge') ref.current?.scrollIntoView({ block: 'start' });
  }, [q.data]);
  // React refuses javascript: hrefs, so the bookmarklet link is set directly.
  useEffect(() => {
    if (bm.current && q.data) bm.current.setAttribute('href', q.data.bookmarklet);
  }, [q.data]);
  const add = async () => {
    try {
      const r = await post<{ device: { label: string }; token: string }>('/api/bridge/devices', { label: label.trim() });
      setFresh({ label: r.device.label, token: r.token });
      setLabel('');
      await qc.invalidateQueries({ queryKey: ['bridge-devices'] });
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <section ref={ref} id="bridge">
      <Section
        title="Browser bridge"
        description="Some sites block automated requests, so Everloom never fetches them. The bridge lets your own browser send the card you're looking at. It only sends what the page shows; hidden definitions stay hidden."
      >
        <div className="flex flex-col gap-4">
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-fg-2">
            <li>Install a userscript manager (Tampermonkey or Violentmonkey) in your browser.</li>
            <li>
              Install{' '}
              <a className="font-medium text-accent-text" href={q.data?.userscriptUrl} target="_blank" rel="noreferrer">
                the Send to Everloom script
              </a>
              .
            </li>
            <li>Add this device below and paste its token when the script asks.</li>
          </ol>
          {q.data?.devices.length ? (
            <ul className="flex flex-col divide-y divide-line rounded-md border border-line" aria-label="Devices">
              {q.data.devices.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                  <MonitorSmartphone size={16} className="flex-none text-fg-3" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{d.label}</span>
                    <span className="block text-xs text-fg-2">{d.lastUsedAt ? `Last used ${new Date(d.lastUsedAt).toLocaleString()}` : 'Not used yet'}</span>
                  </span>
                  <IconButton
                    size="sm"
                    icon={Trash2}
                    label={`Remove ${d.label}`}
                    onClick={async () => {
                      if (!(await confirm({ title: `Remove ${d.label}?`, description: 'Its token stops working right away.', confirmLabel: 'Remove', danger: true }))) return;
                      await del(`/api/bridge/devices/${d.id}`);
                      await qc.invalidateQueries({ queryKey: ['bridge-devices'] });
                    }}
                  />
                </li>
              ))}
            </ul>
          ) : q.data ? (
            <EmptyState title="No devices yet" className="!py-4" />
          ) : null}
          {fresh ? (
            <div className="rounded-md border border-accent bg-accent-soft p-3 text-sm" role="status">
              <p className="font-medium">Token for {fresh.label}</p>
              <p className="mb-2 text-xs text-fg-2">Shown once. Paste it into the script on that device.</p>
              <div className="flex gap-2">
                <Input readOnly value={fresh.token} aria-label="Device token" onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
                <IconButton
                  icon={Copy}
                  label="Copy token"
                  onClick={() => navigator.clipboard?.writeText(fresh.token).then(() => toast({ title: 'Copied' }), () => undefined)}
                />
              </div>
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <Field label="Add a device" htmlFor="bridge-label" className="flex-1">
              <Input id="bridge-label" placeholder="Laptop, phone…" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Button disabled={!label.trim()} onClick={add}>
              Add
            </Button>
          </div>
          <div className="text-sm text-fg-2">
            <p>
              No userscript manager? Drag this bookmarklet to your bookmarks bar and click it on a character page. It opens Everloom to confirm the import; no token needed:{' '}
              <a ref={bm} className="font-medium text-accent-text" onClick={(e) => e.preventDefault()} draggable>
                Send to Everloom
              </a>
            </p>
          </div>
        </div>
      </Section>
    </section>
  );
}
