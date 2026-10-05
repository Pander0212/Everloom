/**
 * "This contains scripts": what a character, preset or lorebook would run, with what permissions,
 * and the owner's choice: Enable, Enable once (this session) or Keep disabled.
 */
import { PERMISSION_INFO, TRIGGER_LABELS, type ScriptPermission, type ScriptTrigger } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Code2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { get, post } from '@/lib/api';
import { cx } from '@/lib/format';
import { toastError } from '@/lib/store';
import { Badge, Button, Checkbox, Icon, Sheet, Spinner } from '@/ui';
import { CodeView } from './CodeView';
import type { Review, ReviewItem, ReviewTarget } from './types';

export function PermissionList({ permissions, domains = [] }: { permissions: readonly ScriptPermission[]; domains?: readonly string[] }) {
  if (!permissions.length) return <p className="text-sm text-fg-2">No permissions: it can only draw inside its own frame.</p>;
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Permissions">
      {permissions.map((p) => {
        const info = PERMISSION_INFO[p];
        return (
          <li key={p} className="flex gap-2 text-sm">
            <Icon icon={info.risk === 'high' ? ShieldAlert : ShieldCheck} size={16} className={cx('mt-0.5 flex-none', info.risk === 'high' ? 'text-danger' : 'text-fg-3')} />
            <span>
              <span className="font-medium">{info.label}</span>
              <span className="text-fg-2"> — {info.detail}</span>
              {p === 'network' && domains.length ? <span className="block text-xs text-fg-2">Only: {domains.join(', ')}</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ItemCard({ it }: { it: ReviewItem }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{it.name}</span>
        <Badge>{it.type === 'script' ? (it.compat ? 'Script (Tavern Helper style)' : 'Script') : it.type === 'regex' ? 'Regex rules' : 'Message scripts'}</Badge>
        <span className="ml-auto">{it.granted ? <Badge tone="success">{it.once ? 'On for now' : 'On'}</Badge> : it.changed ? <Badge tone="warning">Changed since you allowed it</Badge> : <Badge>Off</Badge>}</span>
      </div>
      {it.description ? <p className="text-sm text-fg-2">{it.description}</p> : null}
      {it.type !== 'regex' ? <PermissionList permissions={it.permissions} domains={it.domains} /> : null}
      {it.triggers?.length ? <p className="text-xs text-fg-2">Runs: {it.triggers.map((t) => TRIGGER_LABELS[t as ScriptTrigger] ?? t).join(', ')}</p> : null}
      {it.code ? (
        <div>
          <Button size="sm" variant="ghost" icon={Code2} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Hide the code' : 'Show the code'}
          </Button>
          {open ? <CodeView code={it.code} className="mt-2" /> : null}
        </div>
      ) : null}
    </li>
  );
}

export function ReviewSheet({ target, open, onOpenChange }: { target: ReviewTarget | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['script-review', target?.kind, target?.id], queryFn: () => get<Review>('/api/scripts/review', target ?? undefined), enabled: open && !!target });
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const r = q.data;
  const decide = async (mode: 'on' | 'once' | 'off') => {
    if (!target || !r) return;
    setBusy(mode);
    try {
      const keys = r.items.map((i) => i.key);
      await post('/api/scripts/review', { ...target, approve: mode === 'off' ? [] : keys, revoke: mode === 'off' ? keys : [], once: mode === 'once', trustCreator: mode === 'on' && trust });
      await Promise.all([qc.invalidateQueries({ queryKey: ['script-review'] }), qc.invalidateQueries({ queryKey: ['scripts-active'] })]);
      onOpenChange(false);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  const anyHigh = r?.items.some((i) => i.permissions.some((p) => PERMISSION_INFO[p].risk === 'high'));
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={r ? `${r.name} contains scripts` : 'Scripts'}
      description="They run in a sealed frame and can only do what you allow here. Nothing runs until you choose."
      footer={
        r ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" loading={busy === 'off'} onClick={() => decide('off')}>
              Keep disabled
            </Button>
            <Button variant="secondary" loading={busy === 'once'} onClick={() => decide('once')}>
              Enable once
            </Button>
            <Button variant="primary" loading={busy === 'on'} onClick={() => decide('on')}>
              Enable
            </Button>
          </div>
        ) : null
      }
    >
      {!r ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {anyHigh ? (
            <p className="rounded-md bg-danger-soft p-3 text-sm text-danger">Some of this can spend money on your AI connection or reach the internet. Enable it only if you trust where it came from.</p>
          ) : null}
          <ul className="flex flex-col gap-3">
            {r.items.map((it) => (
              <ItemCard key={it.key} it={it} />
            ))}
          </ul>
          {r.creator ? (
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <Checkbox checked={trust} onChange={setTrust} label={`Also allow scripts from ${r.creator} in the future`} />
              <span aria-hidden="true">Also allow scripts from {r.creator} in the future</span>
            </label>
          ) : null}
          <p className="text-xs text-fg-2">“Enable once” lasts until you sign out or the server restarts. A script that changes later asks again.</p>
        </div>
      )}
    </Sheet>
  );
}
