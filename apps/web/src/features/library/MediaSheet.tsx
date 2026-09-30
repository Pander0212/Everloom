import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { get, post } from '@/lib/api';
import { bytes } from '@/lib/format';
import { toast, toastError } from '@/lib/store';
import { Button, Checkbox, Icon, Sheet, Spinner } from '@/ui';

interface Report {
  remote: Array<{ id: string; name: string; urls: string[] }>;
  integrity: {
    missingFiles: Array<{ id: string; kind: string; characterName: string | null; source: string | null }>;
    orphanFiles: Array<{ filename: string; size: number }>;
    unusedRows: Array<{ id: string; kind: string; size: number; reason: string }>;
    danglingRefs: Array<{ characterId: string; name: string; where: string; mediaId: string }>;
    totals: { rows: number; files: number; bytes: number };
  };
}
type Fix = 'redownload' | 'forget-missing' | 'delete-orphan-files' | 'delete-unused' | 'clear-dangling';

/** Media check: keep linked images working offline, and find broken or unused media. */
export function MediaSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['library-media'], queryFn: () => get<Report>('/api/library/media'), enabled: open, staleTime: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<Array<{ url: string; error: string }>>([]);
  const [fixes, setFixes] = useState<Set<Fix>>(new Set());
  useEffect(() => {
    if (open) {
      setFailed([]);
      setFixes(new Set());
    }
  }, [open]);
  const r = q.data;
  const i = r?.integrity;
  const links = r?.remote.reduce((n, c) => n + c.urls.length, 0) ?? 0;
  const refetch = () => qc.invalidateQueries({ queryKey: ['library-media'] });

  const localize = async () => {
    setBusy('localize');
    try {
      const res = await post<{ characters: number; saved: number; reused: number; failed: Array<{ url: string; error: string }> }>('/api/library/localize', {});
      setFailed(res.failed);
      toast({ title: `${res.saved} image${res.saved === 1 ? '' : 's'} saved locally`, lines: res.failed.length ? [`${res.failed.length} couldn't be downloaded`] : [], tone: res.failed.length ? 'neutral' : 'success' });
      await refetch();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  const fix = async () => {
    setBusy('fix');
    try {
      const res = await post<{ done: Record<Fix, number> }>('/api/library/media/fix', { actions: [...fixes] });
      const n = Object.values(res.done).reduce((a, b) => a + b, 0);
      toast({ title: `Fixed ${n} item${n === 1 ? '' : 's'}`, tone: 'success' });
      setFixes(new Set());
      await refetch();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  const recoverable = i?.missingFiles.filter((m) => m.source).length ?? 0;
  const options: Array<{ key: Fix; count: number; label: string; detail: string }> = i
    ? [
        { key: 'redownload' as Fix, count: recoverable, label: `Download ${recoverable} lost file${recoverable === 1 ? '' : 's'} again`, detail: 'From the link it was saved from.' },
        { key: 'forget-missing' as Fix, count: i.missingFiles.length, label: `Forget ${i.missingFiles.length} lost file${i.missingFiles.length === 1 ? '' : 's'}`, detail: 'Removes the broken entries. Anything still showing them shows a placeholder.' },
        { key: 'clear-dangling' as Fix, count: i.danglingRefs.filter((d) => d.where !== 'text').length, label: `Remove ${i.danglingRefs.filter((d) => d.where !== 'text').length} broken avatar or gallery link${i.danglingRefs.filter((d) => d.where !== 'text').length === 1 ? '' : 's'}`, detail: i.danglingRefs.slice(0, 3).map((d) => d.name).join(', ') },
        { key: 'delete-unused' as Fix, count: i.unusedRows.length, label: `Delete ${i.unusedRows.length} unused file${i.unusedRows.length === 1 ? '' : 's'} (${bytes(i.unusedRows.reduce((n, u) => n + u.size, 0))})`, detail: 'Nothing in your library, chats or history uses them.' },
        { key: 'delete-orphan-files' as Fix, count: i.orphanFiles.length, label: `Delete ${i.orphanFiles.length} stray file${i.orphanFiles.length === 1 ? '' : 's'} (${bytes(i.orphanFiles.reduce((n, u) => n + u.size, 0))})`, detail: 'Files in the media folder that Everloom has no record of.' },
      ].filter((o) => o.count > 0)
    : [];
  const textRefs = i?.danglingRefs.filter((d) => d.where === 'text').length ?? 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Media check" size="md">
      {!r || !i ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <section aria-label="Linked images">
            <h3 className="text-sm font-semibold">Linked images</h3>
            {links ? (
              <>
                <p className="mt-1 text-sm text-fg-2">
                  {r.remote.length} character{r.remote.length === 1 ? '' : 's'} show {links} image{links === 1 ? '' : 's'} from other websites. Save them here so they keep working offline and if the links die. Each card keeps a version from before the change.
                </p>
                <Button className="mt-3" icon={Download} loading={busy === 'localize'} disabled={!!busy} onClick={localize}>
                  Save {links} image{links === 1 ? '' : 's'} locally
                </Button>
              </>
            ) : (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-fg-2">
                <Icon icon={CheckCircle2} size={16} className="text-success" /> Every image your cards show is stored here.
              </p>
            )}
            {failed.length ? (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-fg-2">{failed.length} couldn't be downloaded</summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {groupFailures(failed).map((f) => (
                    <li key={f.url} className="break-all text-xs text-fg-3">
                      {f.url} — {f.error}
                      {f.cards > 1 ? ` (${f.cards} cards)` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          <section aria-label="Integrity">
            <h3 className="text-sm font-semibold">Integrity</h3>
            <p className="mt-1 text-sm text-fg-2">
              {i.totals.rows} files, {bytes(i.totals.bytes)}.
            </p>
            {options.length ? (
              <>
                <ul className="mt-3 flex flex-col gap-3">
                  {options.map((o) => (
                    <li key={o.key} className="flex items-start gap-3">
                      <Checkbox label={o.label} checked={fixes.has(o.key)} onChange={(v) => setFixes((s) => { const n = new Set(s); if (v) n.add(o.key); else n.delete(o.key); return n; })} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{o.label}</p>
                        {o.detail ? <p className="text-xs text-fg-2">{o.detail}</p> : null}
                      </div>
                    </li>
                  ))}
                </ul>
                <Button className="mt-4" variant="primary" loading={busy === 'fix'} disabled={!fixes.size || !!busy} onClick={fix}>
                  Fix selected
                </Button>
              </>
            ) : (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-fg-2">
                <Icon icon={CheckCircle2} size={16} className="text-success" /> Nothing missing, broken or left over.
              </p>
            )}
            {textRefs ? <p className="mt-3 text-xs text-fg-2">{textRefs} card text link{textRefs === 1 ? '' : 's'} point to images that are gone. Edit those cards to replace them.</p> : null}
          </section>
        </div>
      )}
    </Sheet>
  );
}

function groupFailures(list: Array<{ url: string; error: string }>) {
  const by = new Map<string, { url: string; error: string; cards: number }>();
  for (const f of list) {
    const g = by.get(f.url);
    if (g) g.cards++;
    else by.set(f.url, { ...f, cards: 1 });
  }
  return [...by.values()];
}
