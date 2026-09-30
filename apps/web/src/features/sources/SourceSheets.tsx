import type { FieldDiff } from '@everloom/engine';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { get, post } from '@/lib/api';
import { cx } from '@/lib/format';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, Checkbox, EmptyState, Sheet, Spinner } from '@/ui';

interface UpdateInfo {
  characterId: string;
  name: string;
  provider: string;
  key: string;
  status: 'update' | 'current' | 'hidden' | 'gone' | 'error';
  diffs: FieldDiff[];
  error?: string;
}

/** Checks linked characters against their source and shows what changed, field by field. */
export function UpdatesSheet({ open, onOpenChange, ids }: { open: boolean; onOpenChange: (o: boolean) => void; ids?: string[] }) {
  const qc = useQueryClient();
  const [list, setList] = useState<UpdateInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, Set<string>>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setList(null);
    setError(null);
    post<UpdateInfo[]>('/api/sources/updates', ids ? { ids } : {})
      .then((r) => {
        setList(r);
        setPicked(Object.fromEntries(r.filter((u) => u.status === 'update').map((u) => [u.characterId, new Set(u.diffs.map((d) => d.key))])));
      })
      .catch((e) => setError((e as Error).message));
  }, [open, ids]);
  const updates = list?.filter((u) => u.status === 'update') ?? [];
  const other = list?.filter((u) => u.status !== 'update' && u.status !== 'current') ?? [];
  const chosen = updates.filter((u) => picked[u.characterId]?.size);
  const apply = async () => {
    setBusy(true);
    try {
      for (const u of chosen) await post('/api/sources/updates/apply', { characterId: u.characterId, fields: [...picked[u.characterId]!] });
      toast({ title: `Updated ${chosen.length} character${chosen.length === 1 ? '' : 's'}`, lines: ['Each previous version is kept in its history.'], tone: 'success' });
      await qc.invalidateQueries({ queryKey: ['characters'] });
      onOpenChange(false);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id: string, key: string, on: boolean) =>
    setPicked((p) => {
      const s = new Set(p[id] ?? []);
      if (on) s.add(key);
      else s.delete(key);
      return { ...p, [id]: s };
    });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Card updates"
      description="Linked characters compared with their source. Pick what to bring over; your current version is kept in each character's history."
      size="lg"
      footer={
        updates.length ? (
          <Button variant="primary" block loading={busy} disabled={!chosen.length} onClick={apply}>
            Update {chosen.length} character{chosen.length === 1 ? '' : 's'}
          </Button>
        ) : undefined
      }
    >
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : !list ? (
        <div className="flex flex-col items-center gap-2 py-10 text-sm text-fg-2">
          <Spinner />
          Checking… (sources are asked slowly, to be polite)
        </div>
      ) : !list.length ? (
        <EmptyState title="No linked characters" body="Characters imported from an online source are linked automatically. Use “Find source links” for ones you imported another way." />
      ) : (
        <div className="flex flex-col gap-3">
          {!updates.length ? <p className="text-sm text-fg-2">All {list.length} linked character{list.length === 1 ? ' is' : 's are'} up to date.</p> : null}
          {updates.map((u) => (
            <UpdateRow key={u.characterId} u={u} picked={picked[u.characterId] ?? new Set()} onToggle={(k, on) => toggle(u.characterId, k, on)} />
          ))}
          {other.map((u) => (
            <p key={u.characterId} className="flex items-center gap-2 text-sm">
              <span className="font-medium">{u.name}</span>
              <Badge tone={u.status === 'error' ? 'danger' : 'warning'}>{u.status === 'hidden' ? 'Now private' : u.status === 'gone' ? 'Removed from source' : 'Check failed'}</Badge>
              {u.error ? <span className="truncate text-xs text-fg-3">{u.error}</span> : null}
            </p>
          ))}
        </div>
      )}
    </Sheet>
  );
}

function UpdateRow({ u, picked, onToggle }: { u: UpdateInfo; picked: Set<string>; onToggle: (key: string, on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-line">
      <button className="pressable flex w-full items-center gap-2 px-3 py-2.5 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{u.name}</span>
        <span className="text-xs text-fg-2">
          {picked.size}/{u.diffs.length} changes
        </span>
        <ChevronDown size={16} className={cx('transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <ul className="flex flex-col gap-3 border-t border-line px-3 py-3" aria-label={`Changes to ${u.name}`}>
          {u.diffs.map((d) => (
            <li key={d.key} className="flex items-start gap-3">
              <Checkbox label={`Update ${d.label}`} checked={picked.has(d.key)} onChange={(v) => onToggle(d.key, v)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{d.label}</p>
                {d.words.length ? (
                  <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm leading-6">
                    {d.words.map((w, i) => (
                      <span key={i} className={w.op === 'add' ? 'rounded-sm bg-success-soft' : w.op === 'del' ? 'rounded-sm bg-danger-soft line-through opacity-70' : 'text-fg-2'}>
                        {w.text}
                      </span>
                    ))}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-fg-2">
                    {d.before || '(empty)'} → {d.after || '(empty)'}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

interface LinkCandidate {
  characterId: string;
  name: string;
  provider: string;
  key: string;
  url: string;
}

/** Bulk link scanner: unlinked characters whose cards name their source page. */
export function LinksSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [list, setList] = useState<LinkCandidate[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setList(null);
    get<LinkCandidate[]>('/api/sources/scan-links')
      .then((r) => {
        setList(r);
        setPicked(new Set(r.map((x) => x.characterId)));
      })
      .catch(toastError);
  }, [open]);
  const link = async () => {
    setBusy(true);
    try {
      for (const c of list!.filter((x) => picked.has(x.characterId))) await post('/api/sources/link', { characterId: c.characterId, provider: c.provider, key: c.key });
      toast({ title: `Linked ${picked.size} character${picked.size === 1 ? '' : 's'}`, lines: ['Check for updates to compare them with their source.'], tone: 'success' });
      await qc.invalidateQueries({ queryKey: ['characters'] });
      onOpenChange(false);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Find source links"
      description="Characters whose cards point to the page they came from. Linking them lets Everloom check for updates."
      size="md"
      footer={
        list?.length ? (
          <Button variant="primary" block loading={busy} disabled={!picked.size} onClick={link}>
            Link {picked.size}
          </Button>
        ) : undefined
      }
    >
      {!list ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : !list.length ? (
        <EmptyState title="Nothing to link" body="No unlinked card mentions its source page." />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Link candidates">
          {list.map((c) => (
            <li key={c.characterId} className="flex items-start gap-3">
              <Checkbox
                label={`Link ${c.name}`}
                checked={picked.has(c.characterId)}
                onChange={(v) =>
                  setPicked((s) => {
                    const n = new Set(s);
                    if (v) n.add(c.characterId);
                    else n.delete(c.characterId);
                    return n;
                  })
                }
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">{c.name}</p>
                <p className="truncate text-xs text-fg-2">{c.url}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
