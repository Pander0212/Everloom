/**
 * Memory: everything the story remembers, and who knows what. A timeline of memories (search,
 * pin, edit, forget, "why recalled?"), a per-person view, versioned facts with conflicts to
 * settle, and the editable summaries (scene → day → chapter).
 */
import { entry } from '@/lib/registry';
import type { ChatDTO } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { BookOpen, Brain, EyeOff, HelpCircle, Lock, MoreHorizontal, Pencil, Pin, Plus, RefreshCw, Search, Sparkles, Star, Trash2, Undo2, Users } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { del, get, patch, post } from '@/lib/api';
import { cx, relativeTime } from '@/lib/format';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, Dialog, EmptyState, Field, Icon, IconButton, Input, Menu, Segmented, Select, Sheet, Spinner, TabPanel, Tabs, Textarea, useDesktop } from '@/ui';

interface Person {
  id: string;
  name: string;
}
export interface MemoryItemDTO {
  id: string;
  text: string;
  kind: 'beat' | 'scene' | 'chronicle' | 'note';
  importance: 1 | 2 | 3;
  secret: boolean;
  pinned: boolean;
  forgotten: boolean;
  folded: boolean;
  edited: boolean;
  source: string;
  messageId: string | null;
  gameTime: number;
  when: string | null;
  place: string | null;
  participants: Person[];
  witnesses: Person[];
  heardBy: Array<Person & { distortion: number }>;
}
interface FactDTO {
  id: string;
  entityId: string;
  entityName: string;
  key: string;
  value: string;
  text: string;
  status: 'active' | 'superseded' | 'conflict' | 'retracted';
  source: string;
  cite: string | null;
  supersedes: string | null;
}
interface SummaryDTO {
  id: string;
  level: 'scene' | 'day' | 'chapter';
  title: string;
  text: string;
  importance: number;
  edited: boolean;
}
interface MemoryDTO {
  people: Person[];
  items: MemoryItemDTO[];
  facts: FactDTO[];
  conflicts: Array<{ claim: { id: string; text: string; value: string; entityName: string; key: string }; against: { id: string; text: string; value: string } | null }>;
  summaries: SummaryDTO[];
}
interface StatusDTO {
  watermark: number;
  pending: number;
  running: boolean;
  lastRunAt: number | null;
}
interface WhyDTO {
  score: Record<string, number>;
  inLastPrompt: Array<{ viewer: string; as: string }>;
  knownBy: Array<{ name: string; knowledge: 'witnessed' | 'heard' | null }>;
  semanticNote: string;
}

const SOURCE: Record<string, string> = { turn: 'From a reply', chronicle: 'Chronicle', consolidate: 'Folded scene', sim: 'Gossip', user: 'Yours', migrated: 'From Phase 1' };

export function MemorySheet({ chat, open, onOpenChange }: { chat: ChatDTO; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState('timeline');
  const [q, setQ] = useState('');
  const [viewer, setViewer] = useState('');
  const [debounced, setDebounced] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<MemoryItemDTO | 'new' | null>(null);
  const [why, setWhy] = useState<MemoryItemDTO | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const key = ['memory', chat.id, debounced, viewer];
  const mem = useQuery({ queryKey: key, queryFn: () => get<MemoryDTO>(`/api/chats/${chat.id}/memory`, { q: debounced || undefined, viewer: viewer || undefined }), enabled: open, placeholderData: (p) => p });
  const status = useQuery({ queryKey: ['memory', chat.id, 'status'], queryFn: () => get<StatusDTO>(`/api/chats/${chat.id}/memory/status`), enabled: open, refetchInterval: open ? 5000 : false });
  const refresh = () => qc.invalidateQueries({ queryKey: ['memory', chat.id] });
  const d = mem.data;
  const act = async (fn: () => Promise<unknown>, done?: string, undo?: () => Promise<unknown>) => {
    try {
      await fn();
      await refresh();
      if (done) toast({ title: done, tone: 'success', action: undo ? { label: 'Undo', run: () => void undo().then(refresh) } : undefined });
    } catch (e) {
      toastError(e);
    }
  };
  const updateNow = async () => {
    setBusy(true);
    try {
      const r = await post<{ ok: boolean; error?: string; memories?: number; consolidated?: { scenes: number; days: number; chapters: number } }>(`/api/chats/${chat.id}/summarize`, { force: true });
      await refresh();
      const c = r.consolidated;
      if (r.ok) toast({ title: 'Memory updated', lines: [`${r.memories ?? 0} new memories`, ...(c && c.scenes + c.days + c.chapters ? [`${c.scenes} scenes, ${c.days} days, ${c.chapters} chapters folded`] : [])], tone: 'success' });
      else toast({ title: 'Nothing new to remember', lines: r.error ? [r.error] : undefined });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const openConflicts = d?.conflicts.length ?? 0;
  const visible = (d?.items ?? []).filter((m) => tab !== 'timeline' || !m.forgotten || q);
  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title="Memory"
        help={entry('memory')?.help}
        description="What the story remembers, and who knows it."
        size="lg"
        headerActions={<IconButton icon={Plus} label="Add a memory" onClick={() => setEditing('new')} />}
        footer={
          <>
            <p className="min-w-0 flex-1 truncate text-xs text-fg-2">
              {status.data?.running ? 'Reading the chat…' : status.data ? `${status.data.pending} messages not yet read${status.data.lastRunAt ? ` · last read ${relativeTime(status.data.lastRunAt)}` : ''}` : ' '}
            </p>
            <Button variant="secondary" icon={RefreshCw} loading={busy} onClick={updateNow}>
              Update now
            </Button>
          </>
        }
      >
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'timeline', label: 'Timeline', count: d?.items.filter((m) => !m.forgotten).length },
            { value: 'people', label: 'People' },
            { value: 'facts', label: openConflicts ? <span className="flex items-center gap-1.5">Facts <Badge tone="warning">{openConflicts}</Badge></span> : 'Facts' },
            { value: 'summaries', label: 'Summaries', count: d?.summaries.length },
          ]}
        >
          <TabPanel value="timeline">
            <div className="sticky top-0 z-10 -mx-1 bg-surface px-1 pb-2 pt-3">
              <div className="relative">
                <Icon icon={Search} size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search memories" aria-label="Search memories" className="pl-10" />
              </div>
            </div>
            {!d ? (
              <Loading />
            ) : visible.length ? (
              <ul className="flex flex-col divide-y divide-line" aria-label="Memories">
                {visible.map((m) => (
                  <MemoryRow
                    key={m.id}
                    m={m}
                    onPin={() => act(() => patch(`/api/memory/items/${m.id}`, { pinned: !m.pinned }))}
                    onForget={() => act(() => patch(`/api/memory/items/${m.id}`, { forgotten: !m.forgotten }), m.forgotten ? 'Remembered again' : 'Forgotten — it won’t be recalled', () => patch(`/api/memory/items/${m.id}`, { forgotten: m.forgotten }))}
                    onMilestone={() => act(() => patch(`/api/memory/items/${m.id}`, { importance: m.importance === 3 ? 2 : 3 }))}
                    onEdit={() => setEditing(m)}
                    onWhy={() => setWhy(m)}
                    onDelete={() => act(() => del(`/api/memory/items/${m.id}`), 'Memory deleted')}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState icon={Brain} title={q ? 'No memories match' : 'Nothing remembered yet'} body={q ? 'Try other words.' : 'Memories are written as the story goes. You can also add your own.'} />
            )}
          </TabPanel>
          <TabPanel value="people">
            <PeopleView chatId={chat.id} people={d?.people ?? []} viewer={viewer} setViewer={setViewer} items={d?.items ?? []} loading={!d} onWhy={setWhy} />
          </TabPanel>
          <TabPanel value="facts">{d ? <FactsView d={d} act={act} /> : <Loading />}</TabPanel>
          <TabPanel value="summaries">{d ? <SummariesView summaries={d.summaries} act={act} /> : <Loading />}</TabPanel>
        </Tabs>
      </Sheet>
      <EditMemoryDialog chatId={chat.id} people={d?.people ?? []} target={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      <WhyDialog chatId={chat.id} item={why} onClose={() => setWhy(null)} />
    </>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-10">
      <Spinner />
    </div>
  );
}

/** Swipe right to pin, left to forget (phones); the same actions live in the row menu. */
function SwipeActions({ children, onLeft, onRight, leftLabel, rightLabel }: { children: ReactNode; onLeft: () => void; onRight: () => void; leftLabel: string; rightLabel: string }) {
  const desktop = useDesktop();
  const x = useMotionValue(0);
  const leftOpacity = useTransform(x, [-96, -24], [1, 0]);
  const rightOpacity = useTransform(x, [24, 96], [0, 1]);
  if (desktop) return <>{children}</>;
  return (
    <div className="relative overflow-hidden">
      <motion.div style={{ opacity: rightOpacity }} className="absolute inset-y-0 left-0 flex items-center bg-accent-soft pl-4 text-sm font-medium text-accent-text" aria-hidden="true">
        {rightLabel}
      </motion.div>
      <motion.div style={{ opacity: leftOpacity }} className="absolute inset-y-0 right-0 flex items-center bg-surface-2 pr-4 text-sm font-medium text-fg-2" aria-hidden="true">
        {leftLabel}
      </motion.div>
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.5}
        style={{ x, touchAction: 'pan-y' }}
        onDragEnd={(_, info) => {
          if (info.offset.x < -96) onLeft();
          else if (info.offset.x > 96) onRight();
          void animate(x, 0, { type: 'spring', stiffness: 500, damping: 40 });
        }}
        className="relative bg-surface"
      >
        {children}
      </motion.div>
    </div>
  );
}

function MemoryRow({ m, onPin, onForget, onMilestone, onEdit, onWhy, onDelete }: { m: MemoryItemDTO; onPin: () => void; onForget: () => void; onMilestone: () => void; onEdit: () => void; onWhy: () => void; onDelete: () => void }) {
  const knowers = m.witnesses.filter((w) => w.id !== 'player');
  return (
    <li>
      <SwipeActions onLeft={onForget} onRight={onPin} leftLabel={m.forgotten ? 'Remember' : 'Forget'} rightLabel={m.pinned ? 'Unpin' : 'Pin'}>
        <div className={cx('flex items-start gap-2 py-3', m.forgotten && 'opacity-50')}>
          <div className="min-w-0 flex-1">
            <p className={cx('text-[15px] leading-6 text-fg', m.kind === 'scene' && 'italic')}>{m.text}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-2">
              {m.when ? <span>{m.when}</span> : null}
              {m.place ? <span>· {m.place}</span> : null}
              {m.importance === 3 ? (
                <Badge tone="accent">
                  <Icon icon={Star} size={12} /> Milestone
                </Badge>
              ) : null}
              {m.secret ? (
                <Badge tone="warning">
                  <Icon icon={Lock} size={12} /> Secret
                </Badge>
              ) : null}
              {m.pinned ? (
                <Badge>
                  <Icon icon={Pin} size={12} /> Pinned
                </Badge>
              ) : null}
              {m.forgotten ? (
                <Badge>
                  <Icon icon={EyeOff} size={12} /> Forgotten
                </Badge>
              ) : null}
              {m.kind === 'scene' ? <Badge>Scene summary</Badge> : null}
              {m.folded ? <span className="text-fg-3">in a scene summary</span> : null}
              <span className="text-fg-3">{SOURCE[m.source] ?? m.source}{m.edited ? ' · edited' : ''}</span>
            </div>
            {knowers.length || m.heardBy.length ? (
              <p className="mt-1 truncate text-xs text-fg-3">
                {knowers.length ? `Saw it: ${knowers.map((w) => w.name).join(', ')}` : ''}
                {m.heardBy.length ? `${knowers.length ? ' · ' : ''}Heard: ${m.heardBy.map((h) => h.name).join(', ')}` : ''}
              </p>
            ) : null}
          </div>
          <IconButton size="sm" icon={Pin} active={m.pinned} label={m.pinned ? 'Unpin' : 'Pin — always considered'} onClick={onPin} />
          <Menu
            trigger={<IconButton size="sm" icon={MoreHorizontal} label="Memory actions" />}
            items={[
              { label: 'Why recalled?', icon: HelpCircle, onSelect: onWhy },
              { label: 'Edit', icon: Pencil, onSelect: onEdit },
              { label: m.importance === 3 ? 'Not a milestone' : 'Mark as milestone', icon: Star, onSelect: onMilestone },
              { label: m.forgotten ? 'Remember again' : 'Forget', icon: m.forgotten ? Undo2 : EyeOff, onSelect: onForget },
              { label: 'Delete', icon: Trash2, danger: true, onSelect: onDelete, separatorBefore: true },
            ]}
          />
        </div>
      </SwipeActions>
    </li>
  );
}

function PeopleView({ chatId, people, viewer, setViewer, items, loading, onWhy }: { chatId: string; people: Person[]; viewer: string; setViewer: (v: string) => void; items: MemoryItemDTO[]; loading: boolean; onWhy: (m: MemoryItemDTO) => void }) {
  void chatId;
  const others = people.filter((p) => p.id !== 'player');
  useEffect(() => {
    if (!viewer && others.length) setViewer(others[0].id);
  }, [viewer, others, setViewer]);
  const known = viewer ? items.filter((m) => !m.forgotten && (m.witnesses.some((w) => w.id === viewer) || m.heardBy.some((h) => h.id === viewer))) : [];
  if (!others.length) return <EmptyState icon={Users} title="No one yet" body="People appear here once they're part of the story." />;
  return (
    <div className="pt-3">
      <Field label="Whose memories" htmlFor="mem-viewer">
        <Select id="mem-viewer" value={viewer} onChange={(e) => setViewer(e.target.value)}>
          {others.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <p className="mt-2 text-xs text-fg-2">Only what they saw or were told. Secrets told to someone else never show up here.</p>
      {loading ? (
        <Loading />
      ) : known.length ? (
        <ul className="mt-2 flex flex-col divide-y divide-line">
          {known.map((m) => {
            const heard = m.heardBy.find((h) => h.id === viewer);
            const saw = m.witnesses.some((w) => w.id === viewer);
            return (
              <li key={m.id} className="flex items-start gap-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] leading-6">{m.text}</p>
                  <p className="mt-1 text-xs text-fg-2">
                    {saw ? 'Was there' : heard && heard.distortion >= 2 ? 'Heard it as a rumour (may be garbled)' : 'Heard it secondhand'}
                    {m.when ? ` · ${m.when}` : ''}
                  </p>
                </div>
                <IconButton size="sm" icon={HelpCircle} label="Why recalled?" onClick={() => onWhy(m)} />
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="They don't know anything yet" />
      )}
    </div>
  );
}

function FactsView({ d, act }: { d: MemoryDTO; act: (fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const [showOld, setShowOld] = useState(false);
  const byEntity = useMemo(() => {
    const m = new Map<string, FactDTO[]>();
    for (const f of d.facts) if (showOld || f.status === 'active' || f.status === 'conflict') (m.get(f.entityName) ?? m.set(f.entityName, []).get(f.entityName)!).push(f);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [d.facts, showOld]);
  return (
    <div className="pt-3">
      {d.conflicts.length ? (
        <div className="mb-4 flex flex-col gap-3">
          {d.conflicts.map((c) => (
            <div key={c.claim.id} className="rounded-md border border-warning/40 bg-warning-soft p-3">
              <p className="text-sm font-medium text-fg">
                {c.claim.entityName}: {c.claim.key}
              </p>
              <p className="mt-1 text-sm text-fg-2">
                Known: <span className="text-fg">{c.against?.value ?? '—'}</span> · New claim: <span className="text-fg">{c.claim.value}</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => act(() => post(`/api/memory/facts/${c.claim.id}/resolve`, { choice: 'keep-old' }), 'Kept the known fact')}>
                  Keep “{c.against?.value}”
                </Button>
                <Button size="sm" variant="secondary" onClick={() => act(() => post(`/api/memory/facts/${c.claim.id}/resolve`, { choice: 'use-new' }), 'Updated')}>
                  Use “{c.claim.value}”
                </Button>
                <Button size="sm" variant="ghost" onClick={() => act(() => post(`/api/memory/facts/${c.claim.id}/resolve`, { choice: 'both' }), 'Both kept')}>
                  Both are true
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <p className="text-sm text-fg-2">Standing truths. A change shown in the story replaces the old one; the history stays.</p>
      </div>
      <Segmented
        className="mt-2"
        size="sm"
        label="Which facts"
        value={showOld ? 'all' : 'current'}
        onChange={(v) => setShowOld(v === 'all')}
        options={[
          { value: 'current', label: 'Current' },
          { value: 'all', label: 'With history' },
        ]}
      />
      {byEntity.length ? (
        byEntity.map(([name, facts]) => (
          <section key={name} className="mt-4">
            <h3 className="text-sm font-semibold text-fg-2">{name}</h3>
            <ul className="mt-1 flex flex-col divide-y divide-line">
              {facts.map((f) => (
                <li key={f.id} className={cx('flex items-start gap-2 py-2.5', (f.status === 'superseded' || f.status === 'retracted') && 'opacity-55')}>
                  <div className="min-w-0 flex-1">
                    <p className={cx('text-[15px]', f.status === 'superseded' && 'line-through decoration-fg-3')}>{f.text}</p>
                    <p className="mt-0.5 text-xs text-fg-3">
                      {f.key}
                      {f.status !== 'active' ? ` · ${f.status}` : ''}
                      {f.cite ? ` · “${f.cite.slice(0, 80)}${f.cite.length > 80 ? '…' : ''}”` : ''}
                    </p>
                  </div>
                  {f.status === 'active' || f.status === 'retracted' ? (
                    <IconButton size="sm" icon={f.status === 'retracted' ? Undo2 : Trash2} label={f.status === 'retracted' ? 'Restore fact' : 'Retract fact'} onClick={() => act(() => patch(`/api/memory/facts/${f.id}`, { retracted: f.status !== 'retracted' }))} />
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <EmptyState icon={BookOpen} title="No facts yet" body="Facts are noted when the story establishes something lasting, like someone's job or home." />
      )}
    </div>
  );
}

function SummariesView({ summaries, act }: { summaries: SummaryDTO[]; act: (fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const [edit, setEdit] = useState<SummaryDTO | null>(null);
  const [text, setText] = useState('');
  const order = { chapter: 0, day: 1, scene: 2 };
  const list = summaries.slice().sort((a, b) => order[a.level] - order[b.level]);
  return (
    <div className="pt-3">
      <p className="text-sm text-fg-2">The story so far, as the narrator sees it. Finished scenes fold into days, days into chapters. Milestones are always kept.</p>
      {list.length ? (
        <ul className="mt-2 flex flex-col divide-y divide-line">
          {list.map((s) => (
            <li key={s.id} className="py-3">
              <div className="flex items-center gap-2">
                <Badge tone={s.level === 'chapter' ? 'accent' : 'neutral'}>{s.level}</Badge>
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{s.title}</p>
                {s.importance >= 3 ? <Icon icon={Star} size={14} className="text-accent-text" aria-label="Has a milestone" /> : null}
                <IconButton
                  size="sm"
                  icon={Pencil}
                  label="Edit summary"
                  onClick={() => {
                    setEdit(s);
                    setText(s.text);
                  }}
                />
                <IconButton size="sm" icon={Trash2} label="Delete summary" onClick={() => act(() => del(`/api/memory/summaries/${s.id}`), 'Summary deleted — it will be rewritten')} />
              </div>
              <p className="mt-1 text-[15px] leading-6 text-fg">{s.text}</p>
              {s.edited ? <p className="mt-1 text-xs text-fg-3">Edited by you — kept as written</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Sparkles} title="No summaries yet" body="They appear as scenes finish and days pass." />
      )}
      <Dialog
        open={!!edit}
        onOpenChange={(o) => !o && setEdit(null)}
        title="Edit summary"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!text.trim()}
              onClick={async () => {
                await act(() => patch(`/api/memory/summaries/${edit!.id}`, { text }), 'Summary saved');
                setEdit(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Textarea rows={6} aria-label="Summary text" value={text} onChange={(e) => setText(e.target.value)} />
      </Dialog>
    </div>
  );
}

function EditMemoryDialog({ chatId, people, target, onClose, onSaved }: { chatId: string; people: Person[]; target: MemoryItemDTO | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState('');
  const [importance, setImportance] = useState<'1' | '2' | '3'>('2');
  const [secret, setSecret] = useState(false);
  const [who, setWho] = useState<string[]>([]);
  useEffect(() => {
    if (!target) return;
    if (target === 'new') {
      setText('');
      setImportance('2');
      setSecret(false);
      setWho([]);
    } else {
      setText(target.text);
      setImportance(String(target.importance) as '1' | '2' | '3');
      setSecret(target.secret);
      setWho(target.witnesses.map((w) => w.id).filter((id) => id !== 'player'));
    }
  }, [target]);
  const save = async () => {
    try {
      const witnesses = ['player', ...who];
      if (target === 'new') await post(`/api/chats/${chatId}/memory`, { text, importance: Number(importance), secret, ...(who.length ? { witnesses } : {}) });
      else if (target) await patch(`/api/memory/items/${target.id}`, { text, importance: Number(importance), secret, witnesses });
      onSaved();
      onClose();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => !o && onClose()}
      title={target === 'new' ? 'Add a memory' : 'Edit memory'}
      description={target === 'new' ? 'Written by you: swipes and edits never remove it.' : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={text.trim().length < 3} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Textarea rows={3} aria-label="What happened" value={text} onChange={(e) => setText(e.target.value)} placeholder="Mara admitted she forged the letter." />
        <Segmented
          label="Importance"
          value={importance}
          onChange={setImportance}
          options={[
            { value: '1', label: 'Minor' },
            { value: '2', label: 'Lasting' },
            { value: '3', label: 'Milestone' },
          ]}
        />
        <div>
          <p className="text-sm font-medium text-fg-2">Who knows</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {people
              .filter((p) => p.id !== 'player')
              .map((p) => {
                const on = who.includes(p.id);
                return (
                  <button key={p.id} type="button" aria-pressed={on} onClick={() => setWho((w) => (on ? w.filter((x) => x !== p.id) : [...w, p.id]))} className={cx('pressable h-8 rounded-full px-3 text-sm', on ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-fg-2')}>
                    {p.name}
                  </button>
                );
              })}
          </div>
          <p className="mt-1 text-xs text-fg-3">{who.length ? 'Only you and the people selected.' : 'Everyone who is here now.'}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          Secret — never passed on as gossip
        </label>
      </div>
    </Dialog>
  );
}

function WhyDialog({ chatId, item, onClose }: { chatId: string; item: MemoryItemDTO | null; onClose: () => void }) {
  const why = useQuery({ queryKey: ['memory', chatId, 'why', item?.id], queryFn: () => get<WhyDTO>(`/api/chats/${chatId}/memory/why/${item!.id}`), enabled: !!item });
  const w = why.data;
  const LABELS: Record<string, string> = { lexical: 'Words in common', semantic: 'Similar meaning', entities: 'About who is here', place: 'Where it happened', named: 'Someone named just now', importance: 'Importance', recency: 'How recent', pinned: 'Pinned' };
  const max = w ? Math.max(1, ...Object.entries(w.score).filter(([k]) => k !== 'total').map(([, v]) => v)) : 1;
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()} title="Why recalled?" description={item?.text}>
      {!w ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium">
              Score {w.score.total?.toFixed(1)} <span className="font-normal text-fg-2">against the current scene</span>
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {Object.entries(w.score)
                .filter(([k, v]) => k !== 'total' && v > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => (
                  <li key={k} className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-sm">
                    <span className="text-fg-2">{LABELS[k] ?? k}</span>
                    <span className="tabular-nums">{v.toFixed(1)}</span>
                    <span className="col-span-2 h-1 overflow-hidden rounded-full bg-surface-3">
                      <span className="block h-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${v / max})` }} />
                    </span>
                  </li>
                ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-medium">In the last reply’s prompt</p>
            <p className="mt-1 text-sm text-fg-2">{w.inLastPrompt.length ? w.inLastPrompt.map((x) => `${x.viewer} (${x.as})`).join(', ') : 'Not used in the last reply.'}</p>
          </div>
          <div>
            <p className="text-sm font-medium">People here</p>
            <p className="mt-1 text-sm text-fg-2">{w.knownBy.length ? w.knownBy.map((k) => `${k.name}: ${k.knowledge === 'witnessed' ? 'was there' : k.knowledge === 'heard' ? 'heard about it' : 'doesn’t know'}`).join(' · ') : 'Only you.'}</p>
          </div>
        </div>
      )}
    </Dialog>
  );
}
