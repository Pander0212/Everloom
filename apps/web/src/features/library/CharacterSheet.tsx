/**
 * Character detail sheet: Details (creator notes in a sandboxed frame, greetings, lorebook),
 * Edit (opens locked; changes reviewed as a diff before saving; unsaved-changes guard), Chats,
 * Gallery, Related, Versions, and Info (debug only). Prev/next walk the current filtered list;
 * on a phone, swipe the header.
 */
import { CARD_FIELDS, diffCards, type CardData, type CharacterDTO, type CharacterSummary, type FieldDiff } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, ChevronLeft, ChevronRight, Download, ExternalLink, History, Link2, Lock, LockOpen, MessageSquare, RefreshCw, RotateCcw, Save, Star, Trash2 } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { del, download, get, patch, post } from '@/lib/api';
import { cx, relativeTime } from '@/lib/format';
import { useFeatures } from '@/lib/features';
import { useSettings } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { NewChatSheet } from '@/features/chats/NewChatSheet';
import { Avatar, Badge, Button, confirm, Dialog, EmptyState, Field, Icon, IconButton, Input, ListRow, Sheet, Spinner, TabPanel, Tabs, Textarea, useDesktop } from '@/ui';
import { CharacterChats, CharacterGallery, CharacterLore } from '../characters/CharacterEditor';
import { UpdatesSheet } from '../sources/SourceSheets';
import { SandboxedHtml } from './SandboxedHtml';

interface VersionRow {
  id: string;
  kind: string;
  label: string;
  name: string;
  createdAt: number;
  changed: string[];
}

export function CharacterSheet({ id, onClose, onPrev, onNext, position, onDeleted, onOpenOther }: { id: string | null; onClose: () => void; onPrev?: () => void; onNext?: () => void; position?: string; onDeleted: () => void; onOpenOther: (id: string) => void }) {
  const qc = useQueryClient();
  const settings = useSettings();
  const desktop = useDesktop();
  const navigate = useNavigate();
  const c = useQuery({ queryKey: ['character', id], queryFn: () => get<CharacterDTO>(`/api/characters/${id}`), enabled: !!id });
  const [tab, setTab] = useState('details');
  const [dirty, setDirty] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const debug = !!settings.data?.library.debug;
  const prevNext = settings.data?.library.prevNext !== false;
  useEffect(() => {
    setDirty(false);
  }, [id]);
  const guard = async (then: () => void) => {
    if (dirty && !(await confirm({ title: 'Discard your changes?', description: 'The edits on this card are not saved.', confirmLabel: 'Discard', danger: true }))) return;
    setDirty(false);
    then();
  };
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['character', id] });
    await qc.invalidateQueries({ queryKey: ['characters'] });
  };
  // Swipe the header left/right for next/previous (phones).
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const d = c.data;
  const name = d ? d.displayName || d.name : '';
  const tabs = [
    { value: 'details', label: 'Details' },
    { value: 'edit', label: 'Edit' },
    { value: 'chats', label: 'Chats', count: d?.chatCount || undefined },
    { value: 'gallery', label: 'Gallery' },
    { value: 'related', label: 'Related' },
    { value: 'versions', label: 'Versions' },
    ...(debug ? [{ value: 'info', label: 'Info' }] : []),
  ];
  return (
    <>
      <Sheet
        open={!!id}
        onOpenChange={(o) => !o && void guard(onClose)}
        size="full"
        title={
          <span
            className="flex items-center gap-3"
            onPointerDown={(e) => {
              if (e.pointerType !== 'mouse') swipe.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUp={(e) => {
              const s = swipe.current;
              swipe.current = null;
              if (!s || !prevNext) return;
              const dx = e.clientX - s.x;
              if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) {
                if (dx < 0 && onNext) void guard(onNext);
                if (dx > 0 && onPrev) void guard(onPrev);
              }
            }}
          >
            <Avatar src={d?.avatar} name={name || '?'} size="md" shape="rounded" />
            <span className="min-w-0">
              <span className="block truncate">{name}</span>
              <span className="block truncate text-xs font-normal text-fg-2">{[d?.displayName ? d.name : '', d?.creator && `by ${d.creator}`, position].filter(Boolean).join(' · ')}</span>
            </span>
          </span>
        }
        headerActions={
          <>
            {prevNext && desktop ? (
              <>
                <IconButton icon={ChevronLeft} label="Previous character" disabled={!onPrev} onClick={() => onPrev && void guard(onPrev)} />
                <IconButton icon={ChevronRight} label="Next character" disabled={!onNext} onClick={() => onNext && void guard(onNext)} />
              </>
            ) : null}
            {d ? <IconButton icon={Star} label={d.fav ? 'Remove from favorites' : 'Add to favorites'} active={d.fav} onClick={() => void patch(`/api/characters/${d.id}`, { fav: !d.fav }).then(refresh)} /> : null}
          </>
        }
        footer={
          d ? (
            <Button variant="primary" block icon={MessageSquare} onClick={() => setChatOpen(true)}>
              Chat
            </Button>
          ) : undefined
        }
      >
        {!d ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : (
          <Tabs value={tab} onChange={setTab} tabs={tabs}>
            <TabPanel value="details" className="pt-4">
              <Details c={d} onDeleted={() => {
                onDeleted();
                onClose();
              }} onFullEditor={() => void guard(() => navigate(`/characters/${d.id}`))} />
            </TabPanel>
            <TabPanel value="edit" className="pt-4">
              <EditTab c={d} onDirty={setDirty} onSaved={refresh} />
            </TabPanel>
            <TabPanel value="chats" className="pt-2">
              <CharacterChats characterId={d.id} onNew={() => setChatOpen(true)} />
            </TabPanel>
            <TabPanel value="gallery" className="pt-4">
              <CharacterGallery characterId={d.id} name={d.name} />
            </TabPanel>
            <TabPanel value="related" className="pt-2">
              <Related id={d.id} onOpen={(x) => void guard(() => onOpenOther(x))} />
            </TabPanel>
            <TabPanel value="versions" className="pt-3">
              <Versions c={d} onRestored={refresh} />
            </TabPanel>
            {debug ? (
              <TabPanel value="info" className="pt-3">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                  {[['id', d.id], ['content hash', d.hash], ['tokens', String(d.tokens)], ['created', new Date(d.createdAt).toLocaleString()], ['modified', new Date(d.updatedAt).toLocaleString()], ['linked', d.linked ?? '—'], ['spec version', d.card.character_version || '—']].map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-fg-2">{k}</dt>
                      <dd className="break-all font-mono">{v}</dd>
                    </div>
                  ))}
                </dl>
                <pre className="mt-3 max-h-[50vh] overflow-auto rounded-md bg-surface-2 p-3 text-[11px] leading-4">{JSON.stringify(d.card, null, 2)}</pre>
              </TabPanel>
            ) : null}
          </Tabs>
        )}
      </Sheet>
      {d ? <NewChatSheet open={chatOpen} onOpenChange={setChatOpen} characterId={d.id} /> : null}
    </>
  );
}

const idLists = new Map<string, string[]>();
/** A stable array per id, so the sheet doesn't re-run its check on every render. */
const updateIds = (id: string) => idLists.get(id) ?? (idLists.set(id, [id]), idLists.get(id)!);

// Loaded only when someone asks to see the model (nothing 3D downloads before that).
const StageLayer3D = lazy(() => import('@/features/avatar3d/StageLayer'));

/** The character's 3D avatar, on tap: the same stage as in chats (outfits, parts and garments included). */
function Model3D({ c }: { c: CharacterDTO }) {
  const features = useFeatures(null);
  const [show, setShow] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const avatarId = c.game?.avatar3d;
  if (!features.on.avatars3d || !avatarId) return null;
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-fg-2">3D model</h3>
      {failed ? (
        <p className="text-sm text-fg-2">The model couldn't be shown: {failed}</p>
      ) : show ? (
        <div className="relative h-72 overflow-hidden rounded-lg bg-surface-2" data-testid="detail-3d">
          <Suspense fallback={<div className="grid h-full place-items-center"><Spinner /></div>}>
            <StageLayer3D className="absolute inset-0" cast={[{ id: c.id, avatarId, emotion: 'neutral', speaking: false }]} speakerId={null} scene={null} onFail={(_id, reason) => setFailed(reason)} />
          </Suspense>
        </div>
      ) : (
        <Button variant="secondary" icon={Box} onClick={() => setShow(true)} data-testid="detail-3d-show">
          Show in 3D
        </Button>
      )}
    </section>
  );
}

function Details({ c, onDeleted, onFullEditor }: { c: CharacterDTO; onDeleted: () => void; onFullEditor: () => void }) {
  const [g, setG] = useState(0);
  const greetings = [c.card.first_mes, ...(c.card.alternate_greetings ?? [])].filter(Boolean);
  const touch = useRef<number | null>(null);
  const [updates, setUpdates] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      {c.linked ? (
        <p className="-mb-2 flex items-center gap-2 text-sm text-fg-2">
          <Link2 size={15} className="flex-none" />
          <span className="min-w-0 flex-1 truncate">
            From{' '}
            <a className="font-medium text-accent-text" href={c.linkedUrl ?? `https://chub.ai/characters/${c.linked}`} target="_blank" rel="noreferrer noopener">
              {c.linked}
            </a>
          </span>
          <Button size="sm" variant="quiet" icon={RefreshCw} onClick={() => setUpdates(true)}>
            Check for update
          </Button>
        </p>
      ) : null}
      {(c.card.extensions as Record<string, unknown> | undefined)?.definition_hidden ? (
        <p className="flex items-start gap-2 rounded-md bg-surface-2 p-3 text-sm text-fg-2">
          <Lock size={15} className="mt-0.5 flex-none" />
          <span>
            <strong className="font-medium text-fg">Definition hidden by creator.</strong> Only the public profile was imported. Write your own description and greeting, or chat with the full character on its site.
          </span>
        </p>
      ) : null}
      {c.linked ? <UpdatesSheet open={updates} onOpenChange={setUpdates} ids={updateIds(c.id)} /> : null}
      <Model3D c={c} />
      {c.tags.length ? (
        <div className="flex flex-wrap gap-1.5">
          {c.tags.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </div>
      ) : null}
      {c.card.creator_notes?.trim() ? (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-fg-2">Creator notes</h3>
          <SandboxedHtml source={c.card.creator_notes} />
        </section>
      ) : null}
      {c.card.description?.trim() ? (
        <section>
          <h3 className="mb-1 text-sm font-semibold text-fg-2">Description</h3>
          <p className="line-clamp-[12] whitespace-pre-wrap text-[15px] leading-6">{c.card.description}</p>
        </section>
      ) : null}
      {greetings.length ? (
        <section>
          <div className="mb-1 flex items-center gap-2">
            <h3 className="flex-1 text-sm font-semibold text-fg-2">{greetings.length > 1 ? `Greetings · ${g + 1} of ${greetings.length}` : 'Greeting'}</h3>
            {greetings.length > 1 ? (
              <>
                <IconButton size="sm" icon={ChevronLeft} label="Previous greeting" disabled={g === 0} onClick={() => setG(g - 1)} />
                <IconButton size="sm" icon={ChevronRight} label="Next greeting" disabled={g === greetings.length - 1} onClick={() => setG(g + 1)} />
              </>
            ) : null}
          </div>
          <p
            className="whitespace-pre-wrap rounded-md bg-surface-2 p-3 font-serif text-[15px] leading-6"
            onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
            onTouchEnd={(e) => {
              if (touch.current === null) return;
              const dx = e.changedTouches[0].clientX - touch.current;
              touch.current = null;
              if (dx < -50 && g < greetings.length - 1) setG(g + 1);
              if (dx > 50 && g > 0) setG(g - 1);
            }}
          >
            {greetings[g]}
          </p>
        </section>
      ) : null}
      <section>
        <h3 className="mb-1 text-sm font-semibold text-fg-2">Lorebook</h3>
        <CharacterLore characterId={c.id} name={c.name} />
      </section>
      <section className="flex flex-col">
        <Button variant="ghost" icon={ExternalLink} className="justify-start" onClick={onFullEditor}>
          Full editor (game, expressions, voice)
        </Button>
        <Button variant="ghost" icon={Download} className="justify-start" onClick={() => download(`/api/characters/${c.id}/export`, `${c.name}.png`)}>
          Export card (PNG)
        </Button>
        <Button
          variant="ghost"
          icon={Trash2}
          className="justify-start !text-danger"
          onClick={async () => {
            if (!(await confirm({ title: `Delete ${c.name}?`, description: 'Chats are kept. You can undo this for a day.', confirmLabel: 'Delete', danger: true }))) return;
            try {
              const r = await del<{ undoId?: string }>(`/api/characters/${c.id}`);
              onDeleted();
              toast({ title: `${c.name} deleted`, tone: 'success', action: r.undoId ? { label: 'Undo', run: () => void post(`/api/library/undo/${r.undoId}`).then(onDeleted) } : undefined });
            } catch (e) {
              toastError(e);
            }
          }}
        >
          Delete
        </Button>
      </section>
    </div>
  );
}

const TEXT_FIELDS = CARD_FIELDS.filter((f) => !['name', 'tags', 'alternate_greetings', 'creator', 'character_version'].includes(String(f.key)));

function EditTab({ c, onDirty, onSaved }: { c: CharacterDTO; onDirty: (d: boolean) => void; onSaved: () => void }) {
  const [locked, setLocked] = useState(true);
  const [draft, setDraft] = useState<CardData>(c.card);
  const [review, setReview] = useState<FieldDiff[] | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(c.card);
    setLocked(true);
  }, [c.id, c.updatedAt]);
  const changes = useMemo(() => diffCards(c.card, draft), [c.card, draft]);
  useEffect(() => onDirty(changes.length > 0), [changes.length, onDirty]);
  const set = (k: keyof CardData, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const save = async () => {
    setSaving(true);
    try {
      await patch(`/api/characters/${c.id}`, { card: draft });
      toast({ title: 'Saved', lines: ['The previous version is kept under Versions.'], tone: 'success' });
      setReview(null);
      setLocked(true);
      onSaved();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-md bg-surface-2 p-2 pl-3">
        <Icon icon={locked ? Lock : LockOpen} size={16} className="text-fg-2" />
        <span className="flex-1 text-sm text-fg-2">{locked ? 'Locked, so nothing changes by accident.' : changes.length ? `${changes.length} field${changes.length > 1 ? 's' : ''} changed` : 'Editing'}</span>
        {locked ? (
          <Button size="sm" variant="secondary" icon={LockOpen} onClick={() => setLocked(false)}>
            Unlock editing
          </Button>
        ) : (
          <>
            {changes.length ? (
              <Button size="sm" variant="ghost" onClick={() => setDraft(c.card)}>
                Discard
              </Button>
            ) : null}
            <Button size="sm" variant="primary" icon={Save} disabled={!changes.length} onClick={() => setReview(changes)}>
              Review and save
            </Button>
          </>
        )}
      </div>
      <Field label="Name" htmlFor="ed-name">
        <Input id="ed-name" readOnly={locked} value={draft.name} onChange={(e) => set('name', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Creator" htmlFor="ed-creator">
          <Input id="ed-creator" readOnly={locked} value={draft.creator ?? ''} onChange={(e) => set('creator', e.target.value)} />
        </Field>
        <Field label="Version" htmlFor="ed-version">
          <Input id="ed-version" readOnly={locked} value={draft.character_version ?? ''} onChange={(e) => set('character_version', e.target.value)} />
        </Field>
      </div>
      <Field label="Tags" htmlFor="ed-tags" hint="Separated by commas.">
        <Input id="ed-tags" readOnly={locked} value={(draft.tags ?? []).join(', ')} onChange={(e) => set('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))} />
      </Field>
      {TEXT_FIELDS.map((f) => (
        <Field key={String(f.key)} label={f.label} htmlFor={`ed-${String(f.key)}`}>
          <Textarea id={`ed-${String(f.key)}`} readOnly={locked} rows={3} maxRows={14} value={String(draft[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} className={cx(locked && 'text-fg-2')} />
        </Field>
      ))}
      <Field label="Alternate greetings" htmlFor="ed-alts" hint="One per block, separated by a line with ---">
        <Textarea id="ed-alts" readOnly={locked} rows={3} maxRows={14} value={(draft.alternate_greetings ?? []).join('\n---\n')} onChange={(e) => set('alternate_greetings', e.target.value.split(/\n-{3,}\n/).map((x) => x.trim()).filter(Boolean))} />
      </Field>
      <DiffDialog diff={review} title="Review changes" onClose={() => setReview(null)} action={<Button variant="primary" icon={Save} loading={saving} onClick={save}>Save</Button>} />
    </div>
  );
}

export function DiffView({ diff }: { diff: FieldDiff[] }) {
  if (!diff.length) return <p className="text-sm text-fg-2">No differences.</p>;
  return (
    <div className="flex flex-col gap-4">
      {diff.map((d) => (
        <section key={d.key}>
          <h4 className="text-sm font-semibold text-fg-2">{d.label}</h4>
          {d.words.length ? (
            <p className="mt-1 max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-2.5 text-sm leading-6">
              {d.words.map((w, i) => (w.op === 'same' ? <span key={i}>{w.text}</span> : w.op === 'add' ? <ins key={i} className="rounded-sm bg-success-soft text-success no-underline">{w.text}</ins> : <del key={i} className="rounded-sm bg-danger-soft text-danger">{w.text}</del>))}
            </p>
          ) : (
            <div className="mt-1 grid gap-1 text-sm">
              <p className="rounded-md bg-danger-soft px-2.5 py-1.5 text-danger"><del>{d.before || '—'}</del></p>
              <p className="rounded-md bg-success-soft px-2.5 py-1.5 text-success">{d.after || '—'}</p>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function DiffDialog({ diff, title, description, onClose, action }: { diff: FieldDiff[] | null; title: string; description?: string; onClose: () => void; action: React.ReactNode }) {
  return (
    <Dialog open={!!diff} onOpenChange={(o) => !o && onClose()} title={title} description={description} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>{action}</>}>
      <div className="max-h-[60vh] overflow-auto">{diff ? <DiffView diff={diff} /> : null}</div>
    </Dialog>
  );
}

function Related({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  const r = useQuery({ queryKey: ['related', id], queryFn: () => get<Array<CharacterSummary & { reasons: string[] }>>(`/api/characters/${id}/related`) });
  if (r.isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (!r.data?.length) return <EmptyState title="Nothing related yet" body="Characters with shared tags, the same creator or a similar description show up here." />;
  return (
    <div className="flex flex-col">
      {r.data.map((c) => (
        <ListRow key={c.id} leading={<Avatar src={c.avatar} name={c.name} size="md" shape="rounded" />} title={c.displayName || c.name} subtitle={c.reasons.join(' · ')} chevron onClick={() => onOpen(c.id)} />
      ))}
    </div>
  );
}

function Versions({ c, onRestored }: { c: CharacterDTO; onRestored: () => void }) {
  const q = useQuery({ queryKey: ['versions', c.id, c.updatedAt], queryFn: () => get<VersionRow[]>(`/api/characters/${c.id}/versions`) });
  const [label, setLabel] = useState('');
  const [open, setOpen] = useState<{ v: VersionRow; diff: FieldDiff[] } | null>(null);
  const kind = { auto: 'Before a save', manual: 'Snapshot', restore: 'Before a restore', update: 'Before an update' } as Record<string, string>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Input aria-label="Snapshot label" placeholder="Label a snapshot (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Button
          variant="secondary"
          icon={History}
          onClick={async () => {
            await post(`/api/characters/${c.id}/versions`, { label });
            setLabel('');
            await q.refetch();
            toast({ title: 'Snapshot saved', tone: 'success' });
          }}
        >
          Snapshot
        </Button>
      </div>
      {q.isLoading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : q.data?.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {q.data.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                className="pressable flex w-full items-start gap-3 py-2.5 text-left"
                onClick={async () => setOpen({ v, diff: await get<FieldDiff[]>(`/api/characters/${c.id}/versions/${v.id}/diff`) })}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{v.label || kind[v.kind] || v.kind}</span>
                  <span className="block truncate text-xs text-fg-2">
                    {relativeTime(v.createdAt)} · {v.changed.length ? `differs in ${v.changed.join(', ')}` : 'same as now'}
                  </span>
                </span>
                {v.kind === 'manual' ? <Badge tone="accent">kept</Badge> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={History} title="No versions yet" body="Every save keeps the version before it." />
      )}
      <DiffDialog
        diff={open?.diff ?? null}
        title="Changes since this version"
        description="Red is the old version, green is how it is now. Restoring brings the old one back (and keeps the current one as a version)."
        onClose={() => setOpen(null)}
        action={
          <Button
            variant="primary"
            icon={RotateCcw}
            disabled={!open?.diff.length}
            onClick={async () => {
              try {
                await post(`/api/characters/${c.id}/versions/${open!.v.id}/restore`);
                setOpen(null);
                onRestored();
                toast({ title: 'Version restored', tone: 'success' });
              } catch (e) {
                toastError(e);
              }
            }}
          >
            Restore
          </Button>
        }
      />
    </div>
  );
}
