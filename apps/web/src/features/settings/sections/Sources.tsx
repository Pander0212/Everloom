/**
 * Settings › Character sources: adult content, site accounts (stored encrypted on the server and
 * never sent back), site notices, the self-test and fixture recorder, and the browser bridge.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Copy, Download, FlaskConical, MonitorSmartphone, Trash2, XCircle } from 'lucide-react';
import { apiFetch, del, get, post, put } from '@/lib/api';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, Checkbox, confirm, EmptyState, Field, IconButton, Input, Select, Spinner, ToggleRow } from '@/ui';
import type { ProviderInfo, Providers } from '../../sources/BrowsePage';
import { Section, useSettingsPatch } from '../common';

export default function SourcesSection() {
  const { settings, update } = useSettingsPatch();
  const qc = useQueryClient();
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => get<Providers>('/api/sources') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['sources'] });
  if (!settings) return null;
  return (
    <>
      <Section title="Online sources" description="Browse and import characters from public sites. Everything is fetched by your Everloom server, only when you ask.">
        <ToggleRow
          label="Show adult content"
          description="Off by default. When off, adult characters are hidden from browsing and can't be imported."
          checked={settings.library.nsfw}
          onChange={async (v) => {
            await update({ library: { nsfw: v } });
            await refresh();
            await qc.invalidateQueries({ queryKey: ['source-search'] });
          }}
        />
      </Section>
      <section id="accounts">
        <Section title="Accounts" description="Some sites show more to members. Your sign-in is stored encrypted on your server and is never sent back to this page.">
          {sources.data ? (
            <ul className="flex flex-col gap-4" aria-label="Site accounts">
              {sources.data.providers
                .filter((p) => p.account)
                .map((p) => (
                  <li key={p.id} className="rounded-lg border border-line p-3">
                    <AccountRow p={p} onChange={refresh} />
                  </li>
                ))}
            </ul>
          ) : (
            <Spinner />
          )}
          <p className="mt-3 text-xs text-fg-3">Pygmalion, Wyvern and Character Tavern have no sign-in here yet: their public catalogues already work signed out, and their member features need a session Everloom can't create without a browser.</p>
        </Section>
      </section>
      {sources.data?.providers.some((p) => p.notice) ? (
        <Section title="Site notices" description="Sites that ask crawlers to stay away show a notice once before Everloom fetches anything from them.">
          <ul className="flex flex-col gap-2 text-sm">
            {sources.data.providers
              .filter((p) => p.notice)
              .map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <span className="flex-1">{p.name}</span>
                  {p.noticeAccepted ? (
                    <Badge tone="success">Accepted</Badge>
                  ) : (
                    <Button size="sm" onClick={() => post(`/api/sources/${p.id}/notice`, {}).then(refresh, toastError)}>
                      Read and accept
                    </Button>
                  )}
                </li>
              ))}
          </ul>
        </Section>
      ) : null}
      <section id="diagnostics">{sources.data ? <SourceDiagnostics providers={sources.data.providers} /> : null}</section>
      <BridgeSection />
    </>
  );
}

const STATUS: Record<string, { label: string; tone: 'success' | 'danger' | 'neutral' }> = {
  ok: { label: 'Working', tone: 'success' },
  failed: { label: 'Not working', tone: 'danger' },
  unknown: { label: 'Not checked', tone: 'neutral' },
};

function AccountRow({ p, onChange }: { p: ProviderInfo; onChange: () => void }) {
  const a = p.account!;
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [token, setToken] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (what: string, f: () => Promise<unknown>, done?: string) => {
    setBusy(what);
    try {
      await f();
      if (done) toast({ title: done, tone: 'success' });
      onChange();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  const status = a.status ? STATUS[a.status] : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{p.name}</span>
        {a.connected ? <Badge tone={status?.tone ?? 'neutral'}>{status?.label ?? 'Connected'}</Badge> : <Badge>Not connected</Badge>}
        {a.connected && a.username ? <span className="text-xs text-fg-2">as {a.username}</span> : null}
      </div>
      <p className="text-xs text-fg-2">{a.hint}</p>
      {a.connected && a.status === 'failed' && a.statusDetail ? <p className="text-xs text-danger">{a.statusDetail}</p> : null}
      {a.connected ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={busy === 'test'} onClick={() => run('test', () => post(`/api/sources/${p.id}/account/test`, {}))}>
            Test
          </Button>
          <Button
            size="sm"
            variant="quiet"
            loading={busy === 'out'}
            onClick={async () => {
              if (await confirm({ title: `Sign out of ${p.name}?`, description: 'The stored sign-in is deleted from your server.', confirmLabel: 'Sign out' })) await run('out', () => del(`/api/sources/${p.id}/account`), `Signed out of ${p.name}`);
            }}
          >
            Sign out
          </Button>
          {a.kind === 'password' && !a.remembersPassword ? <span className="self-center text-xs text-fg-3">Password not kept: you'll sign in again when the session ends.</span> : null}
        </div>
      ) : a.kind === 'token' ? (
        <Field label={`${p.name} API key`} htmlFor={`tok-${p.id}`} hint="Stored encrypted on your server; it is never shown again.">
          <div className="flex gap-2">
            <Input id={`tok-${p.id}`} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste your key" />
            <Button loading={busy === 'key'} disabled={!token.trim()} onClick={() => run('key', () => put(`/api/sources/${p.id}/token`, { token }).then(() => setToken('')), `${p.name} key saved`)}>
              Save
            </Button>
          </div>
        </Field>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run('in', () => post(`/api/sources/${p.id}/account`, { username: user, password: pass, remember }).then(() => setPass('')), `Signed in to ${p.name}`);
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <Input aria-label={`${p.name} ${a.usernameLabel ?? 'username'}`} placeholder={a.usernameLabel ?? 'Username'} autoComplete="off" value={user} onChange={(e) => setUser(e.target.value)} />
            <Input aria-label={`${p.name} password`} placeholder="Password" type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} />
          </div>
          <Checkbox checked={remember} onChange={setRemember} label="Keep the password (encrypted) so Everloom can sign in again when the session ends" />
          <div>
            <Button type="submit" size="sm" loading={busy === 'in'} disabled={!user.trim() || !pass}>
              Sign in
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

interface Step {
  step: string;
  ok: boolean;
  ms: number;
  detail: string;
}

/** Checks a site the way the app uses it, signed out, and can record its answers for a bug report. */
function SourceDiagnostics({ providers }: { providers: ProviderInfo[] }) {
  const ready = providers.filter((p) => !p.notice || p.noticeAccepted);
  const [id, setId] = useState(ready[0]?.id ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; steps: Step[] } | null>(null);
  const test = async () => {
    setBusy('test');
    setResult(null);
    try {
      setResult(await post<{ name: string; steps: Step[] }>(`/api/sources/${id}/self-test`, {}));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  const record = async () => {
    setBusy('rec');
    try {
      const r = await apiFetch(`/api/sources/${id}/record-fixtures`, { method: 'POST', body: {} });
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `everloom-fixtures-${id}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Section title="Diagnostics" description="When a site stops working, the self-test shows which step fails. Recorded fixtures are the site's raw answers (signed out), packed so the problem can be reproduced.">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Site" htmlFor="diag-site">
            <Select id="diag-site" value={id} onChange={(e) => setId(e.target.value)} className="min-w-44">
              {ready.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button icon={FlaskConical} loading={busy === 'test'} disabled={!id || !!busy} onClick={test}>
            Run self-test
          </Button>
          <Button variant="quiet" icon={Download} loading={busy === 'rec'} disabled={!id || !!busy} onClick={record}>
            Record fixtures
          </Button>
        </div>
        {result ? (
          <ul className="flex flex-col gap-1.5 text-sm" aria-label={`${result.name} self-test`}>
            {result.steps.map((s) => (
              <li key={s.step} className="flex items-start gap-2">
                {s.ok ? <CheckCircle2 size={16} className="mt-0.5 flex-none text-success" /> : <XCircle size={16} className="mt-0.5 flex-none text-danger" />}
                <span>
                  <span className="font-medium capitalize">{s.step}</span> <span className="text-fg-3">({s.ms} ms)</span>
                  <span className="block text-xs text-fg-2">{s.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-fg-3">Recorded answers contain other people's characters: share them only to report a problem.</p>
      </div>
    </Section>
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
  const [pairLabel, setPairLabel] = useState('');
  const pair = async () => {
    try {
      const r = await post<{ userscriptUrl: string }>('/api/bridge/pairing', { label: pairLabel.trim() });
      setPairLabel('');
      window.open(r.userscriptUrl, '_blank', 'noopener');
      toast({ title: 'Install the script in the tab that opened', lines: ['It pairs itself the first time it runs.'] });
      setTimeout(() => qc.invalidateQueries({ queryKey: ['bridge-devices'] }), 15_000);
    } catch (e) {
      toastError(e);
    }
  };
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
            <li>Install a userscript manager in this browser: Tampermonkey or Violentmonkey (desktop, or Firefox and Kiwi on Android).</li>
            <li>
              Name this browser and press <strong className="font-medium text-fg">Install and pair</strong>. The script it opens signs itself in the first time it runs (the link works once, for ten minutes).
            </li>
            <li>On a character page, press <strong className="font-medium text-fg">Send to Everloom</strong>. On a search or profile page, <strong className="font-medium text-fg">Send all</strong> sends every character listed.</li>
          </ol>
          <div className="flex items-end gap-2">
            <Field label="This browser" htmlFor="pair-label" className="flex-1">
              <Input id="pair-label" placeholder="Laptop Firefox, phone…" value={pairLabel} maxLength={60} onChange={(e) => setPairLabel(e.target.value)} />
            </Field>
            <Button variant="primary" disabled={!pairLabel.trim()} onClick={pair}>
              Install and pair
            </Button>
          </div>
          <p className="text-xs text-fg-3">
            Or install{' '}
            <a className="font-medium text-accent-text" href={q.data?.userscriptUrl} target="_blank" rel="noreferrer">
              the plain script
            </a>{' '}
            and paste a device token from below into its settings (the ⚙ button next to Send to Everloom).
          </p>
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
            <Field label="Add a device by token" htmlFor="bridge-label" className="flex-1">
              <Input id="bridge-label" placeholder="Laptop, phone…" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Button disabled={!label.trim()} onClick={add}>
              Add
            </Button>
          </div>
          <div className="text-sm text-fg-2">
            <p>
              No userscript manager? Drag this bookmarklet to your bookmarks bar (on a phone: bookmark any page, then edit it and paste the bookmarklet as its address) and use it on a character page. It opens Everloom to confirm the import; no token needed. If the window is blocked it copies the card for <em>Paste from bridge</em>:{' '}
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
