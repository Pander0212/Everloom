import { newEntry, type LoreProposal, type LorebookDTO, type WIEntry, type WorldBook } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, MoreHorizontal, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Page } from '@/app/Shell';
import { del, download, get, post, put } from '@/lib/api';
import { useCharacters } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, Checkbox, confirm, EmptyState, Field, Icon, IconButton, Input, Menu, Segmented, Select, Sheet, Spinner, Textarea, ToggleRow } from '@/ui';

const POSITIONS: Array<[number, string]> = [
  [0, 'Before character definition'],
  [1, 'After character definition'],
  [2, "Top of author's note"],
  [3, "Bottom of author's note"],
  [4, 'In chat at depth'],
  [5, 'Before example messages'],
  [6, 'After example messages'],
  [7, 'Outlet (manual)'],
];
const LOGIC: Array<[number, string]> = [
  [0, 'AND ANY — one secondary key matches'],
  [3, 'AND ALL — every secondary key matches'],
  [2, 'NOT ANY — no secondary key matches'],
  [1, 'NOT ALL — at least one is missing'],
];
const TRI = (v: boolean | null) => (v === null || v === undefined ? '' : v ? 'yes' : 'no');
const FROM_TRI = (s: string): boolean | null => (s === '' ? null : s === 'yes');

export default function LoreEditor() {
  const { id } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const chars = useCharacters();
  const q = useQuery({ queryKey: ['lorebook', id], queryFn: () => get<LorebookDTO>(`/api/lorebooks/${id}`), enabled: !!id });
  const [book, setBook] = useState<WorldBook | null>(null);
  const [meta, setMeta] = useState<{ name: string; scope: LorebookDTO['scope']; scopeId: string | null }>({ name: '', scope: 'global', scopeId: null });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<WIEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  useEffect(() => {
    if (q.data) {
      setBook(structuredClone(q.data.book));
      setMeta({ name: q.data.name, scope: q.data.scope, scopeId: q.data.scopeId });
    }
  }, [q.data]);
  const entries = useMemo(() => {
    const list = Object.values(book?.entries ?? {}).sort((a, b) => (a.displayIndex ?? a.uid) - (b.displayIndex ?? b.uid));
    const n = search.trim().toLowerCase();
    return n ? list.filter((e) => e.comment.toLowerCase().includes(n) || e.key.join(' ').toLowerCase().includes(n) || e.content.toLowerCase().includes(n)) : list;
  }, [book, search]);
  if (!book || !q.data) return <div className="flex h-[50vh] items-center justify-center"><Spinner /></div>;

  const persist = async (next: WorldBook, m = meta) => {
    setSaving(true);
    try {
      const saved = await put<LorebookDTO>(`/api/lorebooks/${q.data!.id}`, { name: m.name, scope: m.scope, scopeId: m.scope === 'global' ? null : m.scopeId, book: next });
      qc.setQueryData(['lorebook', id], saved);
      await qc.invalidateQueries({ queryKey: ['lorebooks'] });
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };
  const addEntry = () => {
    const uid = Math.max(-1, ...Object.keys(book.entries).map(Number)) + 1;
    setEditing(newEntry(uid, { comment: 'New entry', displayIndex: uid }));
  };
  const saveEntry = async (e: WIEntry) => {
    const next = { ...book, entries: { ...book.entries, [String(e.uid)]: e } };
    setBook(next);
    setEditing(null);
    await persist(next);
  };
  const removeEntry = async (e: WIEntry) => {
    const entriesCopy = { ...book.entries };
    delete entriesCopy[String(e.uid)];
    const next = { ...book, entries: entriesCopy };
    setBook(next);
    setEditing(null);
    await persist(next);
    toast({ title: 'Entry deleted', action: { label: 'Undo', run: () => saveEntry(e) } });
  };
  const removeBook = async () => {
    if (!(await confirm({ title: `Delete ${meta.name}?`, description: `${Object.keys(book.entries).length} entries will be removed.`, confirmLabel: 'Delete', danger: true }))) return;
    await del(`/api/lorebooks/${q.data.id}`);
    await qc.invalidateQueries({ queryKey: ['lorebooks'] });
    navigate('/lore');
  };
  return (
    <Page
      narrow
      back={<IconButton icon={ArrowLeft} label="Back" onClick={() => navigate('/lore')} />}
      title={meta.name}
      actions={
        <>
          {saving ? <Spinner /> : null}
          <Menu
            trigger={<IconButton icon={MoreHorizontal} label="More" />}
            items={[
              { label: 'Export (SillyTavern JSON)', icon: Download, onSelect: () => download(`/api/lorebooks/${q.data!.id}/export`, `${meta.name}.json`) },
              { label: 'Delete lorebook', icon: Trash2, danger: true, separatorBefore: true, onSelect: removeBook },
            ]}
          />
          <Button icon={Sparkles} aria-label="Generate entries" onClick={() => setGenOpen(true)}>
            <span className="hidden sm:inline">Generate</span>
          </Button>
          <Button variant="primary" icon={Plus} onClick={addEntry}>
            Entry
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <Field label="Name" htmlFor="bn">
          <Input id="bn" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} onBlur={() => persist(book)} />
        </Field>
        <Field label="Applies to" htmlFor="bs">
          <Select
            id="bs"
            value={meta.scope === 'character' ? `character:${meta.scopeId}` : meta.scope}
            onChange={(e) => {
              const v = e.target.value;
              const m = v.startsWith('character:') ? { ...meta, scope: 'character' as const, scopeId: v.slice(10) } : { ...meta, scope: v as 'global', scopeId: null };
              setMeta(m);
              void persist(book, m);
            }}
          >
            <option value="global">All chats</option>
            {meta.scope === 'chat' ? <option value="chat">This chat only</option> : null}
            {(chars.data ?? []).map((c) => (
              <option key={c.id} value={`character:${c.id}`}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="relative mt-5">
        <Icon icon={Search} size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
        <Input placeholder="Search entries" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" aria-label="Search entries" />
      </div>
      {entries.length ? (
        <div className="mt-2 flex flex-col divide-y divide-line">
          {entries.map((e) => (
            <button key={e.uid} onClick={() => setEditing(structuredClone(e))} className="pressable flex w-full items-start gap-3 py-3 text-left">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  <span className="truncate">{e.comment || e.key.join(', ') || `Entry ${e.uid}`}</span>
                  {e.constant ? <Badge tone="accent">Always</Badge> : null}
                  {e.disable ? <Badge>Off</Badge> : null}
                </p>
                <p className="mt-0.5 truncate text-xs text-fg-2">{e.constant ? 'Constant' : e.key.join(', ') || 'No keys'}</p>
                <p className="mt-1 line-clamp-2 text-sm text-fg-2">{e.content}</p>
              </div>
              <span className="flex-none pt-0.5 text-xs tabular-nums text-fg-3">#{e.order}</span>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState title={search ? 'No entries match' : 'No entries yet'} action={search ? undefined : <Button variant="secondary" icon={Plus} onClick={addEntry}>Add entry</Button>} />
      )}
      <GenerateSheet
        open={genOpen}
        onOpenChange={setGenOpen}
        bookId={q.data.id}
        onAdd={async (list) => {
          let uid = Math.max(-1, ...Object.keys(book.entries).map(Number)) + 1;
          const added = Object.fromEntries(list.map((p) => [String(uid), newEntry(uid, { comment: p.title, key: p.keys, content: p.content, constant: p.constant, displayIndex: uid++ })]));
          const next = { ...book, entries: { ...book.entries, ...added } };
          setBook(next);
          setGenOpen(false);
          await persist(next);
          toast({ title: `${list.length} ${list.length === 1 ? 'entry' : 'entries'} added`, tone: 'success' });
        }}
      />
      <EntrySheet bookId={q.data.id} entry={editing} onClose={() => setEditing(null)} onSave={saveEntry} onDelete={removeEntry} />
    </Page>
  );
}

function EntrySheet({ bookId, entry, onClose, onSave, onDelete }: { bookId: string; entry: WIEntry | null; onClose: () => void; onSave: (e: WIEntry) => void; onDelete: (e: WIEntry) => void }) {
  const [e, setE] = useState<WIEntry | null>(entry);
  const [writing, setWriting] = useState(false);
  const [before, setBefore] = useState<Pick<WIEntry, 'content' | 'key'> | null>(null);
  useEffect(() => {
    setE(entry);
    setBefore(null);
  }, [entry]);
  const aiWrite = async () => {
    if (!e) return;
    setWriting(true);
    try {
      const r = await post<{ keys: string[]; content: string }>(`/api/lorebooks/${bookId}/write-entry`, { entry: { comment: e.comment, key: e.key, content: e.content } });
      setBefore({ content: e.content, key: e.key });
      const lower = new Set(e.key.map((k) => k.toLowerCase()));
      set({ content: r.content, key: [...e.key, ...r.keys.filter((k) => !lower.has(k.toLowerCase()))] });
    } catch (err) {
      toastError(err);
    } finally {
      setWriting(false);
    }
  };
  const set = (p: Partial<WIEntry>) => setE((x) => (x ? { ...x, ...p } : x));
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const num = (s: string) => (s === '' ? null : Number(s));
  return (
    <Sheet
      open={!!entry}
      onOpenChange={(o) => !o && onClose()}
      title={e?.comment || 'Entry'}
      size="lg"
      footer={
        e ? (
          <>
            <Button variant="quiet" icon={Trash2} aria-label="Delete entry" onClick={() => onDelete(e)} />
            <Button variant="primary" size="lg" className="flex-1" onClick={() => onSave(e)}>
              Save entry
            </Button>
          </>
        ) : null
      }
    >
      {e ? (
        <div className="flex flex-col gap-4">
          <Field label="Title" htmlFor="ec">
            <Input id="ec" value={e.comment} onChange={(ev) => set({ comment: ev.target.value })} />
          </Field>
          <Field label="Strategy" htmlFor="est">
            <Select id="est" value={e.constant ? 'constant' : e.vectorized ? 'semantic' : 'keyword'} onChange={(ev) => set({ constant: ev.target.value === 'constant', vectorized: ev.target.value === 'semantic' })}>
              <option value="keyword">Keywords</option>
              <option value="constant">Always on (constant)</option>
              <option value="semantic">Keywords + semantic match</option>
            </Select>
          </Field>
          <Field label="Keys" htmlFor="ek" hint="Comma separated. Use /pattern/i for a regular expression.">
            <Input id="ek" value={e.key.join(', ')} onChange={(ev) => set({ key: list(ev.target.value) })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Secondary keys" htmlFor="ek2">
              <Input id="ek2" value={e.keysecondary.join(', ')} onChange={(ev) => set({ keysecondary: list(ev.target.value), selective: true })} />
            </Field>
            <Field label="Secondary logic" htmlFor="elog">
              <Select id="elog" value={e.selectiveLogic} onChange={(ev) => set({ selectiveLogic: Number(ev.target.value) })}>
                {LOGIC.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field
            label="Content"
            htmlFor="ect"
            trailing={
              <Button size="sm" variant="quiet" icon={Sparkles} loading={writing} onClick={aiWrite}>
                {e.content.trim() ? 'Improve with AI' : 'Write with AI'}
              </Button>
            }
          >
            <Textarea id="ect" rows={6} maxRows={24} value={e.content} onChange={(ev) => set({ content: ev.target.value })} />
            {before ? (
              <button className="pressable self-start text-xs font-medium text-accent-text" onClick={() => (set(before), setBefore(null))}>
                Undo the AI’s change
              </button>
            ) : null}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Position" htmlFor="epos">
              <Select id="epos" value={e.position} onChange={(ev) => set({ position: Number(ev.target.value) })}>
                {POSITIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            {e.position === 4 ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Depth" htmlFor="edep">
                  <Input id="edep" type="number" min={0} value={e.depth} onChange={(ev) => set({ depth: Number(ev.target.value) })} />
                </Field>
                <Field label="Role" htmlFor="erole">
                  <Select id="erole" value={e.role} onChange={(ev) => set({ role: Number(ev.target.value) })}>
                    <option value={0}>System</option>
                    <option value={1}>User</option>
                    <option value={2}>Assistant</option>
                  </Select>
                </Field>
              </div>
            ) : e.position === 7 ? (
              <Field label="Outlet name" htmlFor="eout">
                <Input id="eout" value={e.outletName} onChange={(ev) => set({ outletName: ev.target.value })} />
              </Field>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Order" htmlFor="eord">
              <Input id="eord" type="number" value={e.order} onChange={(ev) => set({ order: Number(ev.target.value) })} />
            </Field>
            <Field label="Probability %" htmlFor="eprob">
              <Input id="eprob" type="number" min={0} max={100} value={e.probability} onChange={(ev) => set({ probability: Number(ev.target.value), useProbability: true })} />
            </Field>
            <Field label="Scan depth" htmlFor="esd" hint="Blank = global">
              <Input id="esd" type="number" min={0} value={e.scanDepth ?? ''} onChange={(ev) => set({ scanDepth: num(ev.target.value) })} />
            </Field>
            <Field label="Token budget" htmlFor="etb" hint="0 = none">
              <Input id="etb" type="number" min={0} value={e.tokenBudget ?? 0} onChange={(ev) => set({ tokenBudget: Number(ev.target.value) })} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Sticky" htmlFor="esti" hint="Messages">
              <Input id="esti" type="number" min={0} value={e.sticky ?? ''} onChange={(ev) => set({ sticky: num(ev.target.value) })} />
            </Field>
            <Field label="Cooldown" htmlFor="ecool" hint="Messages">
              <Input id="ecool" type="number" min={0} value={e.cooldown ?? ''} onChange={(ev) => set({ cooldown: num(ev.target.value) })} />
            </Field>
            <Field label="Delay" htmlFor="edel" hint="Messages">
              <Input id="edel" type="number" min={0} value={e.delay ?? ''} onChange={(ev) => set({ delay: num(ev.target.value) })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Case sensitive" htmlFor="ecs">
              <Select id="ecs" value={TRI(e.caseSensitive)} onChange={(ev) => set({ caseSensitive: FROM_TRI(ev.target.value) })}>
                <option value="">Use global</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </Field>
            <Field label="Whole words" htmlFor="eww">
              <Select id="eww" value={TRI(e.matchWholeWords)} onChange={(ev) => set({ matchWholeWords: FROM_TRI(ev.target.value) })}>
                <option value="">Use global</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <Field label="Inclusion group" htmlFor="egr" hint="Only one entry per group activates.">
              <Input id="egr" value={e.group} onChange={(ev) => set({ group: ev.target.value })} />
            </Field>
            <Field label="Weight" htmlFor="egw">
              <Input id="egw" type="number" min={0} value={e.groupWeight} onChange={(ev) => set({ groupWeight: Number(ev.target.value) })} />
            </Field>
          </div>
          <div className="flex flex-col divide-y divide-line">
            <ToggleRow label="Enabled" checked={!e.disable} onChange={(v) => set({ disable: !v })} />
            <ToggleRow label="Prioritize in group" checked={e.groupOverride} onChange={(v) => set({ groupOverride: v })} />
            <ToggleRow label="Exclude from recursion" description="Other entries can't activate this one." checked={e.excludeRecursion} onChange={(v) => set({ excludeRecursion: v })} />
            <ToggleRow label="Prevent further recursion" description="This entry's text won't activate others." checked={e.preventRecursion} onChange={(v) => set({ preventRecursion: v })} />
            <ToggleRow label="Delay until recursion" checked={!!e.delayUntilRecursion} onChange={(v) => set({ delayUntilRecursion: v ? 1 : 0 })} />
            <ToggleRow label="Ignore budget" checked={e.ignoreBudget} onChange={(v) => set({ ignoreBudget: v })} />
            <ToggleRow label="Also scan persona description" checked={e.matchPersonaDescription} onChange={(v) => set({ matchPersonaDescription: v })} />
            <ToggleRow label="Also scan character description" checked={e.matchCharacterDescription} onChange={(v) => set({ matchCharacterDescription: v })} />
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

/** Propose entries on a topic with AI; nothing is added until you pick. */
function GenerateSheet({ open, onOpenChange, bookId, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; bookId: string; onAdd: (list: LoreProposal[]) => void }) {
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState('5');
  const [busy, setBusy] = useState(false);
  const [props, setProps] = useState<LoreProposal[]>([]);
  const [pick, setPick] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (open) setProps([]);
  }, [open]);
  const go = async () => {
    setBusy(true);
    try {
      const r = await post<{ entries: LoreProposal[] }>(`/api/lorebooks/${bookId}/generate`, { topic, count: Number(count) });
      setProps(r.entries);
      setPick(new Set(r.entries.map((_, i) => i)));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const chosen = props.filter((_, i) => pick.has(i));
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Generate entries"
      description="Describe what the book should cover. You'll see the entries before anything is added."
      size="lg"
      footer={
        props.length ? (
          <Button variant="primary" block disabled={!chosen.length} onClick={() => onAdd(chosen)}>
            Add {chosen.length} {chosen.length === 1 ? 'entry' : 'entries'}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Topic" htmlFor="gen-topic">
          <Textarea id="gen-topic" value={topic} onChange={(ev) => setTopic(ev.target.value)} rows={2} maxRows={6} placeholder="The factions of the harbor district, and the places they meet" />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented label="How many" value={count} onChange={setCount} options={[{ value: '3', label: '3' }, { value: '5', label: '5' }, { value: '8', label: '8' }]} />
          <Button icon={Sparkles} loading={busy} disabled={topic.trim().length < 3} onClick={go}>
            {props.length ? 'Generate again' : 'Generate'}
          </Button>
        </div>
        {props.length ? (
          <ul className="flex flex-col divide-y divide-line" aria-label="Proposed entries">
            {props.map((p, i) => (
              <li key={p.title} className="flex items-start gap-3 py-3">
                <Checkbox label={`Add ${p.title}`} checked={pick.has(i)} onChange={(v) => setPick((s) => { const n = new Set(s); if (v) n.add(i); else n.delete(i); return n; })} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {p.title}
                    {p.constant ? <Badge tone="accent">Always</Badge> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-2">{p.keys.join(', ')}</p>
                  <p className="mt-1 text-sm text-fg-2">{p.content}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Sheet>
  );
}
