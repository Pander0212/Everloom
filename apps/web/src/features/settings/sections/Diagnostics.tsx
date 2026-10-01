import { useQuery } from '@tanstack/react-query';
import { Download, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, get, post } from '@/lib/api';
import { toastError } from '@/lib/store';
import { Badge, Button, Spinner } from '@/ui';
import { Section } from '../common';

interface Diag {
  app: { version: string; build: string | null; node: string; platform: string; uptimeMinutes: number; memoryMb: number };
  database: Record<string, number | null>;
  connections: Array<{ id: string; name: string; provider: string; model: string; endpoint: string; hasKey: boolean; roles: string[] }>;
  calls: { recent: number; failed: number; avgMs: number | null; lastErrors: Array<{ at: number; role: string; purpose: string; model: string | null; error: string | null }> };
  serverErrors: Array<{ at: number; method: string; url: string; message: string }>;
}

async function clientInfo() {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const sw = await navigator.serviceWorker?.getRegistration?.().catch(() => null);
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    viewport: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
    standalone: window.matchMedia('(display-mode: standalone)').matches,
    theme: document.documentElement.dataset.theme,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    online: navigator.onLine,
    serviceWorker: sw ? (sw.active ? 'active' : 'installing') : 'none',
    storageMb: est ? { used: Math.round((est.usage ?? 0) / 1048576), quota: Math.round((est.quota ?? 0) / 1048576) } : null,
  };
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
    <dt className="text-fg-2">{k}</dt>
    <dd className="min-w-0 truncate text-right font-medium tabular-nums">{v}</dd>
  </div>
);

export default function DiagnosticsSection() {
  const d = useQuery({ queryKey: ['diagnostics'], queryFn: () => get<Diag>('/api/diagnostics') });
  const [client, setClient] = useState<Awaited<ReturnType<typeof clientInfo>> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void clientInfo().then(setClient);
  }, []);
  const download = async () => {
    setBusy(true);
    try {
      const bundle = await api<unknown>('/api/diagnostics/bundle', { method: 'POST', body: { client: client ?? {} } });
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `everloom-debug-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  if (!d.data) return <div className="flex justify-center py-10">{d.isError ? <p className="text-sm text-danger">{(d.error as Error).message}</p> : <Spinner />}</div>;
  const x = d.data;
  return (
    <>
      <Section
        title="Diagnostics"
        description="What's running and how it's doing. The debug bundle is for bug reports: it leaves out API keys, tokens, passwords and your story text."
        action={<Button size="sm" variant="quiet" icon={RefreshCw} onClick={() => d.refetch()}>Refresh</Button>}
      >
        <dl className="divide-y divide-line">
          <Row k="Version" v={`${x.app.version}${x.app.build ? ` (${x.app.build.slice(0, 7)})` : ''}`} />
          <Row k="Server" v={`${x.app.platform}, Node ${x.app.node}`} />
          <Row k="Running for" v={`${x.app.uptimeMinutes} min, ${x.app.memoryMb} MB`} />
          <Row k="Database" v={`schema ${x.database.migration}${x.database.sizeBytes ? `, ${Math.round((x.database.sizeBytes as number) / 1048576)} MB` : ''}`} />
          <Row k="Characters · chats · saves" v={`${x.database.characters} · ${x.database.chats} · ${x.database.saves}`} />
          <Row k="Messages" v={x.database.messages} />
          {client ? <Row k="This browser" v={client.viewport} /> : null}
          {client?.storageMb ? <Row k="Stored in this browser" v={`${client.storageMb.used} MB`} /> : null}
          {client ? <Row k="Offline support" v={client.serviceWorker} /> : null}
        </dl>
        <Button variant="primary" icon={Download} loading={busy} className="mt-4" onClick={download}>
          Download debug bundle
        </Button>
      </Section>
      <Section title="Connections">
        {x.connections.length ? (
          <ul className="flex flex-col divide-y divide-line" aria-label="Connections">
            {x.connections.map((c) => (
              <li key={c.name} className="flex flex-col gap-0.5 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  {c.roles.map((r) => (
                    <Badge key={r}>{r}</Badge>
                  ))}
                </span>
                <span className="truncate text-xs text-fg-2">
                  {c.provider} · {c.model || 'default model'} · {c.endpoint || 'default endpoint'} · {c.hasKey ? 'key set' : 'no key'}
                </span>
                <ConnectionTest id={c.id} name={c.name} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-2">No connections yet.</p>
        )}
      </Section>
      <Section title="Recent model calls">
        <dl className="divide-y divide-line">
          <Row k="Last 200 calls" v={`${x.calls.recent}, ${x.calls.failed} failed`} />
          <Row k="Average time" v={x.calls.avgMs != null ? `${(x.calls.avgMs / 1000).toFixed(1)} s` : '—'} />
        </dl>
        {x.calls.lastErrors.length ? (
          <ul className="mt-2 flex flex-col gap-1.5 text-xs" aria-label="Failed calls">
            {x.calls.lastErrors.map((e, i) => (
              <li key={i} className="rounded-md bg-surface-2 px-3 py-2">
                <span className="font-medium">{e.purpose}</span> <span className="text-fg-2">({e.role}{e.model ? `, ${e.model}` : ''}) · {new Date(e.at).toLocaleString()}</span>
                <span className="block text-danger">{e.error}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>
      {x.serverErrors.length ? (
        <Section title="Server errors">
          <ul className="flex flex-col gap-1.5 text-xs" aria-label="Server errors">
            {x.serverErrors.map((e, i) => (
              <li key={i} className="rounded-md bg-surface-2 px-3 py-2">
                <span className="font-medium">
                  {e.method} {e.url}
                </span>{' '}
                <span className="text-fg-2">{new Date(e.at).toLocaleString()}</span>
                <span className="block text-danger">{e.message}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

/** Try a connection now and show the answer in place. */
function ConnectionTest({ id, name }: { id: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <span className="mt-1 flex items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        aria-label={`Test ${name}`}
        onClick={async () => {
          setBusy(true);
          try {
            setResult(await post<{ ok: boolean; message: string }>(`/api/connections/${id}/test`));
          } catch (e) {
            setResult({ ok: false, message: (e as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      >
        Test
      </Button>
      {result ? <span className={`min-w-0 truncate text-xs ${result.ok ? 'text-success' : 'text-danger'}`}>{result.ok ? 'Works' : 'Failed'}: {result.message}</span> : null}
    </span>
  );
}
