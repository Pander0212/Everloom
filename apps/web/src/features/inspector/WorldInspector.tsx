/**
 * World inspector: the exact scene block the narrator gets, every change to the world (with
 * revert), every model call (role, model, time, tokens, purpose), and a health check with fixes.
 */
import type { ChatDTO } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CheckCircle2, Copy, Import, RefreshCw, Undo2, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { get, post } from '@/lib/api';
import { cx, relativeTime } from '@/lib/format';
import { useCampaign, useLorebooks } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, Checkbox, confirm, EmptyState, Field, Icon, IconButton, Menu, Segmented, Select, Sheet, Spinner, TabPanel, Tabs } from '@/ui';

interface SceneDTO {
  source: 'last request' | 'preview';
  at: number;
  text: string;
  tokens: number;
  dropped: Array<{ section: string; drop: string; text: string }>;
}
interface TxDTO {
  id: string;
  messageId: string | null;
  swipeId: number | null;
  seq: number;
  source: string;
  ops: Array<{ type: string }>;
  summary: string[];
  createdAt: number;
  active: boolean;
}
interface CallDTO {
  id: string;
  messageId: string | null;
  purpose: string;
  role: string;
  provider: string | null;
  model: string | null;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  firstTokenMs: number | null;
  ok: boolean;
  error: string | null;
  createdAt: number;
}
interface HealthDTO {
  issues: Array<{ id: string; severity: 'error' | 'warning'; title: string; detail: string; fix?: { label: string } }>;
  unresolved: Array<{ name: string; kind: 'person' | 'place' | 'organization'; count: number; lastAt: number }>;
}

const SOURCE_LABEL: Record<string, string> = { ai: 'Story', user: 'You', sim: 'World', system: 'System', helper: 'Helper' };

export function WorldInspector({ chat, open, onOpenChange }: { chat: ChatDTO; open: boolean; onOpenChange: (o: boolean) => void }) {
  const game = !!chat.campaignId;
  const [tab, setTab] = useState(game ? 'scene' : 'calls');
  const health = useQuery({ queryKey: ['inspector', chat.id, 'health'], queryFn: () => get<HealthDTO>(`/api/chats/${chat.id}/health`), enabled: open && game });
  const problems = (health.data?.issues.length ?? 0) + (health.data?.unresolved.length ?? 0);
  const tabs = [
    ...(game ? [{ value: 'scene', label: 'Scene' }] : []),
    ...(game ? [{ value: 'changes', label: 'Changes' }] : []),
    { value: 'calls', label: 'Model calls' },
    ...(game ? [{ value: 'health', label: problems ? <span className="flex items-center gap-1.5">Health <Badge tone="warning">{problems}</Badge></span> : 'Health' }] : []),
    ...(game ? [{ value: 'import', label: 'Import' }] : []),
  ];
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="World inspector" description="What the narrator sees, what changed, and what it cost." size="lg">
      <Tabs value={tab} onChange={setTab} tabs={tabs}>
        {game ? (
          <TabPanel value="scene">
            <ScenePanel chatId={chat.id} open={open && tab === 'scene'} />
          </TabPanel>
        ) : null}
        {game ? (
          <TabPanel value="changes">
            <ChangesPanel chatId={chat.id} open={open && tab === 'changes'} />
          </TabPanel>
        ) : null}
        <TabPanel value="calls">
          <CallsPanel chatId={chat.id} open={open && tab === 'calls'} />
        </TabPanel>
        {game ? (
          <TabPanel value="import">
            <ImportPanel chatId={chat.id} hasCard={!!chat.characterId} />
          </TabPanel>
        ) : null}
        {game ? (
          <TabPanel value="health">
            <HealthPanel chatId={chat.id} campaignId={chat.campaignId!} data={health.data} loading={health.isLoading} />
          </TabPanel>
        ) : null}
      </Tabs>
    </Sheet>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-10">
      <Spinner />
    </div>
  );
}

function ScenePanel({ chatId, open }: { chatId: string; open: boolean }) {
  const [mode, setMode] = useState<'last' | 'next'>('last');
  const q = useQuery({ queryKey: ['inspector', chatId, 'scene', mode], queryFn: () => get<SceneDTO>(`/api/chats/${chatId}/scene`, mode === 'next' ? { fresh: '1' } : undefined), enabled: open, staleTime: 0 });
  const [copied, setCopied] = useState(false);
  const d = q.data;
  return (
    <div className="pt-3">
      <div className="flex items-center gap-2">
        <Segmented
          size="sm"
          label="Which scene block"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'last', label: 'Last reply' },
            { value: 'next', label: 'Next reply' },
          ]}
        />
        <span className="flex-1" />
        <IconButton size="sm" icon={RefreshCw} label="Refresh" onClick={() => q.refetch()} />
        <IconButton
          size="sm"
          icon={copied ? Check : Copy}
          label="Copy"
          disabled={!d?.text}
          onClick={async () => {
            await navigator.clipboard?.writeText(d?.text ?? '').catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        />
      </div>
      {q.isLoading ? (
        <Loading />
      ) : !d?.text ? (
        <EmptyState title="No scene block yet" body="It is built when a reply is written." />
      ) : (
        <>
          <p className="mt-2 text-xs text-fg-2">
            {d.source === 'last request' ? `Sent ${relativeTime(d.at)}, byte for byte.` : 'What the next reply would get right now.'} {d.tokens.toLocaleString()} tokens
            {d.dropped.length ? ` · left out to fit: ${d.dropped.length} line${d.dropped.length === 1 ? '' : 's'} (${[...new Set(d.dropped.map((x) => x.drop))].join(', ')})` : ''}
          </p>
          <pre className="mt-2 max-h-[62vh] overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-3 font-mono text-[12px] leading-5 text-fg-2">{d.text}</pre>
        </>
      )}
    </div>
  );
}

function ChangesPanel({ chatId, open }: { chatId: string; open: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['inspector', chatId, 'tx'], queryFn: () => get<TxDTO[]>(`/api/chats/${chatId}/transactions`), enabled: open });
  const revert = async (t: TxDTO) => {
    if (!(await confirm({ title: 'Undo this change?', description: t.summary.length ? t.summary.join(' · ') : `${t.ops.length} change${t.ops.length === 1 ? '' : 's'}`, confirmLabel: 'Undo change' }))) return;
    try {
      await post(`/api/chats/${chatId}/transactions/${t.id}/revert`);
      await qc.invalidateQueries({ queryKey: ['inspector', chatId] });
      toast({ title: 'Change undone', tone: 'success' });
    } catch (e) {
      toastError(e);
    }
  };
  if (q.isLoading) return <Loading />;
  if (!q.data?.length) return <EmptyState title="No changes yet" body="Every change to the world shows up here, with where it came from." />;
  return (
    <ul className="flex flex-col divide-y divide-line pt-1">
      {q.data.map((t) => (
        <li key={t.id} className={cx('flex items-start gap-3 py-3', !t.active && 'opacity-50')}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-2">
              <Badge tone={t.source === 'user' ? 'accent' : 'neutral'}>{SOURCE_LABEL[t.source] ?? t.source}</Badge>
              <span>{relativeTime(t.createdAt)}</span>
              {!t.active ? <span>· on a swipe that isn't showing</span> : null}
            </div>
            <p className="mt-1 text-sm text-fg">{t.summary.length ? t.summary.join(' · ') : t.ops.map((o) => o.type).join(', ')}</p>
          </div>
          <IconButton size="sm" icon={Undo2} label="Undo this change" onClick={() => revert(t)} />
        </li>
      ))}
    </ul>
  );
}

function CallsPanel({ chatId, open }: { chatId: string; open: boolean }) {
  const q = useQuery({ queryKey: ['inspector', chatId, 'calls'], queryFn: () => get<CallDTO[]>('/api/calls', { chatId, limit: '150' }), enabled: open, refetchInterval: open ? 4000 : false });
  const totals = useMemo(() => {
    const byRole: Record<string, { n: number; tokens: number }> = {};
    for (const c of q.data ?? []) {
      const r = (byRole[c.role] ??= { n: 0, tokens: 0 });
      r.n++;
      r.tokens += c.tokensIn + c.tokensOut;
    }
    return byRole;
  }, [q.data]);
  if (q.isLoading) return <Loading />;
  if (!q.data?.length) return <EmptyState title="No model calls yet" body="Every call is listed here: what it was for, which model, how long it took and how many tokens." />;
  return (
    <div className="pt-3">
      <div className="flex flex-wrap gap-2 text-xs text-fg-2">
        {Object.entries(totals).map(([role, t]) => (
          <span key={role} className="rounded-sm bg-surface-2 px-2 py-1">
            {role}: {t.n} calls · {t.tokens.toLocaleString()} tokens
          </span>
        ))}
      </div>
      <ul className="mt-2 flex flex-col divide-y divide-line">
        {q.data.map((c) => (
          <li key={c.id} className="py-2.5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.purpose}</span>
              <Badge tone={c.role === 'main' ? 'accent' : 'neutral'}>{c.role}</Badge>
              {!c.ok ? <Badge tone="danger">failed</Badge> : null}
            </div>
            <p className="mt-0.5 truncate text-xs text-fg-2">
              {c.model ?? 'no model'} · {(c.ms / 1000).toFixed(1)} s{c.firstTokenMs != null ? ` (first token ${(c.firstTokenMs / 1000).toFixed(1)} s)` : ''} · {c.tokensIn.toLocaleString()} in / {c.tokensOut.toLocaleString()} out · {relativeTime(c.createdAt)}
            </p>
            {c.error ? <p className="mt-0.5 truncate text-xs text-danger">{c.error}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function HealthPanel({ chatId, campaignId, data, loading }: { chatId: string; campaignId: string; data?: HealthDTO; loading: boolean }) {
  const qc = useQueryClient();
  const campaign = useCampaign(campaignId);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(id);
    try {
      const r = await fn();
      qc.setQueryData(['inspector', chatId, 'health'], r);
      await qc.invalidateQueries({ queryKey: ['inspector', chatId, 'tx'] });
      toast({ title: done, tone: 'success' });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  if (loading || !data) return <Loading />;
  const npcs = Object.values(campaign.data?.state.npcs ?? {}).sort((a, b) => a.name.localeCompare(b.name));
  if (!data.issues.length && !data.unresolved.length) return <EmptyState icon={CheckCircle2} title="All good" body="No broken references, duplicates or unknown names." />;
  return (
    <div className="flex flex-col gap-5 pt-3">
      {data.issues.length ? (
        <section>
          <h3 className="text-sm font-semibold text-fg-2">Problems</h3>
          <ul className="mt-1 flex flex-col divide-y divide-line">
            {data.issues.map((i) => (
              <li key={i.id} className="flex items-start gap-3 py-3">
                <Icon icon={AlertTriangle} size={18} className={cx('mt-0.5 flex-none', i.severity === 'error' ? 'text-danger' : 'text-warning')} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{i.title}</p>
                  {i.detail ? <p className="mt-0.5 text-xs text-fg-2">{i.detail}</p> : null}
                </div>
                {i.fix ? (
                  <Button size="sm" variant="secondary" icon={Wrench} loading={busy === i.id} onClick={() => run(i.id, () => post(`/api/chats/${chatId}/health/fix`, { id: i.id }), 'Fixed')}>
                    {i.fix.label}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {data.unresolved.length ? (
        <section>
          <h3 className="text-sm font-semibold text-fg-2">Names the story used that match nothing</h3>
          <p className="mt-0.5 text-xs text-fg-2">Changes mentioning them were skipped. Create them, or say who they are.</p>
          <ul className="mt-1 flex flex-col divide-y divide-line">
            {data.unresolved.map((u) => (
              <li key={u.name} className="flex flex-wrap items-center gap-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{u.name}</p>
                  <p className="text-xs text-fg-2">
                    {u.kind} · seen {u.count}× · {relativeTime(u.lastAt)}
                  </p>
                </div>
                <Button size="sm" variant="secondary" loading={busy === u.name} onClick={() => run(u.name, () => post(`/api/chats/${chatId}/unresolved`, { name: u.name, action: 'create', kind: u.kind }), `${u.name} created`)}>
                  Create
                </Button>
                {u.kind === 'person' && npcs.length ? (
                  <Menu
                    trigger={
                      <Button size="sm" variant="ghost">
                        It's…
                      </Button>
                    }
                    items={npcs.slice(0, 30).map((n) => ({ label: n.name, onSelect: () => void run(u.name, () => post(`/api/chats/${chatId}/unresolved`, { name: u.name, action: 'alias', targetId: n.id }), `${u.name} is now another name for ${n.name}`) }))}
                  />
                ) : null}
                <Button size="sm" variant="quiet" onClick={() => run(u.name, () => post(`/api/chats/${chatId}/unresolved`, { name: u.name, action: 'dismiss' }), 'Dismissed')}>
                  Dismiss
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

interface Proposal {
  id: string;
  kind: 'place' | 'person' | 'group' | 'fact';
  label: string;
  detail: string;
  op: unknown;
}

function ImportPanel({ chatId, hasCard }: { chatId: string; hasCard: boolean }) {
  const qc = useQueryClient();
  const books = useLorebooks();
  const [book, setBook] = useState('');
  const [card, setCard] = useState(hasCard);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<Proposal[] | null>(null);
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const read = async () => {
    setBusy(true);
    try {
      const r = await post<{ proposals: Proposal[] }>(`/api/chats/${chatId}/world-import`, { lorebookId: book || null, includeCard: card });
      setList(r.proposals);
      setKeep(new Set(r.proposals.map((p) => p.id)));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!list) return;
    setBusy(true);
    try {
      const r = await post<{ applied: number; errors: string[] }>(`/api/chats/${chatId}/world-import/apply`, { ops: list.filter((p) => keep.has(p.id)).map((p) => p.op) });
      toast({ title: `Added ${r.applied} to the world`, lines: r.errors.slice(0, 3), tone: 'success' });
      setList(null);
      await qc.invalidateQueries({ queryKey: ['inspector', chatId] });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const groups: Array<[Proposal['kind'], string]> = [
    ['place', 'Places'],
    ['person', 'People'],
    ['group', 'Groups'],
    ['fact', 'Facts'],
  ];
  return (
    <div className="flex flex-col gap-4 pt-3">
      <p className="text-sm text-fg-2">Read a lorebook (and the character card) and turn it into places, people, groups and facts. You choose what gets added; it can be undone from Changes.</p>
      <Field label="Lorebook" htmlFor="wi-book">
        <Select id="wi-book" value={book} onChange={(e) => setBook(e.target.value)}>
          <option value="">None</option>
          {(books.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>
      {hasCard ? (
        <label className="flex items-center gap-2.5 text-sm">
          <Checkbox checked={card} onChange={setCard} label="Also read the character card" />
          Also read the character card
        </label>
      ) : null}
      <div>
        <Button variant="secondary" icon={Import} loading={busy && !list} disabled={!book && !card} onClick={read}>
          Read and propose
        </Button>
      </div>
      {list ? (
        list.length ? (
          <>
            {groups.map(([kind, title]) => {
              const items = list.filter((p) => p.kind === kind);
              if (!items.length) return null;
              return (
                <section key={kind}>
                  <h3 className="text-sm font-semibold text-fg-2">{title}</h3>
                  <ul className="mt-1 flex flex-col divide-y divide-line">
                    {items.map((p) => (
                      <li key={p.id} className="flex items-start gap-3 py-2.5">
                        <Checkbox
                          checked={keep.has(p.id)}
                          label={`Add ${p.label}`}
                          onChange={(v) =>
                            setKeep((k) => {
                              const n = new Set(k);
                              if (v) n.add(p.id);
                              else n.delete(p.id);
                              return n;
                            })
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{p.label}</p>
                          {p.detail ? <p className="text-xs text-fg-2">{p.detail}</p> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            <Button variant="primary" block loading={busy} disabled={!keep.size} onClick={apply}>
              Add {keep.size} to the world
            </Button>
          </>
        ) : (
          <EmptyState title="Nothing found" body="The model found no places, people or facts in that text." />
        )
      ) : null}
    </div>
  );
}
