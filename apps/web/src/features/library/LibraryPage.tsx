/**
 * The character library: a windowed grid or list with search filters, tri-state tags, sorts,
 * collections and presets; multi-select with batch actions; a context menu on right-click or
 * long-press; and the detail sheet with prev/next through the current view.
 */
import { useFeatures } from '@/lib/features';
import type { CharacterSummary } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, Copy, Dices, Download, Folder, FolderPlus, Globe, Image as ImageIcon, LayoutGrid, Link2, List, MoreHorizontal, PackageOpen, Pencil, Plus, RefreshCw, Search, SlidersHorizontal, Sparkles, Star, Tag, Trash2, Upload, Users, UsersRound, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Page } from '@/app/Shell';
import { api, apiFetch, get, post, upload } from '@/lib/api';
import { cx } from '@/lib/format';
import { useCharacters, useSettings } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, confirm, Dialog, EmptyState, Field, FileButton, Icon, IconButton, Input, Menu } from '@/ui';
import { GroupSheet } from '../characters/GroupSheet';
import { useSettingsPatch } from '../settings/common';
import { BundleImportSheet } from './BundleImportSheet';
import { CharacterSheet } from './CharacterSheet';
import { COLLECTION_COLORS, CollectionDialog, collectionIcon } from './Collections';
import { ContextMenu, type ContextItem } from './ContextMenu';
import { LinksSheet, UpdatesSheet } from '../sources/SourceSheets';
import { MediaSheet } from './MediaSheet';
import { RecommendSheet } from './RecommendSheet';
import { DuplicatesSheet } from './DuplicatesSheet';
import { FiltersSheet } from './FiltersSheet';
import { CARD_TEXT_H, LibraryCard } from './LibraryCard';
import { useLibraryState } from './useLibrary';
import { VirtualGrid } from './VirtualGrid';

export interface CollectionDTO {
  id: string;
  name: string;
  icon: string;
  color: string;
  position: number;
  characterIds: string[];
}

export const useCollections = () => useQuery({ queryKey: ['collections'], queryFn: () => get<CollectionDTO[]>('/api/library/collections') });

export async function downloadBundle(ids: string[]) {
  const res = await apiFetch('/api/library/bundle', { method: 'POST', body: { ids } });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `everloom-characters-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export default function LibraryPage() {
  const chars = useCharacters();
  const collections = useCollections();
  const settings = useSettings();
  const { update } = useSettingsPatch();
  const lib = useLibraryState(chars.data, collections.data);
  const { state, setState, list } = lib;
  const view = settings.data?.library.view ?? 'grid';
  const qc = useQueryClient();
  const navigate = useNavigate();
  const features = useFeatures(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ c: CharacterSummary; at: { clientX: number; clientY: number } } | null>(null);
  const [sheet, setSheet] = useState<null | 'filters' | 'bundle' | 'dupes' | 'group' | 'recommend' | 'media' | 'updates' | 'links'>(null);
  const [bundleFile, setBundleFile] = useState<File | null>(null);
  const [colDialog, setColDialog] = useState<CollectionDTO | 'new' | null>(null);
  const [tagDialog, setTagDialog] = useState<null | 'tag' | 'untag'>(null);
  const [collectFor, setCollectFor] = useState<string[] | null>(null);
  const [nickFor, setNickFor] = useState<CharacterSummary | null>(null);
  const [importing, setImporting] = useState(false);

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ['characters'] });
    await qc.invalidateQueries({ queryKey: ['collections'] });
  }, [qc]);

  useEffect(() => {
    if (!selecting) setSelected(new Set());
  }, [selecting]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selecting) setSelecting(false);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [selecting]);

  const runBatch = async (ids: string[], action: object, done?: string) => {
    try {
      const r = await post<{ done: number; undoId?: string }>('/api/library/batch', { ids, action });
      await refresh();
      if (done)
        toast({
          title: done.replace('{n}', String(r.done)),
          tone: 'success',
          action: r.undoId
            ? {
                label: 'Undo',
                run: () =>
                  void post(`/api/library/undo/${r.undoId}`)
                    .then(refresh)
                    .then(() => toast({ title: 'Restored', tone: 'success' })),
              }
            : undefined,
        });
      return r;
    } catch (e) {
      toastError(e);
      return null;
    }
  };
  const remove = async (ids: string[]) => {
    const names = ids.map((id) => chars.data?.find((c) => c.id === id)?.name).filter(Boolean);
    if (!(await confirm({ title: ids.length === 1 ? `Delete ${names[0]}?` : `Delete ${ids.length} characters?`, description: 'Their chats are kept. You can undo this for a day.', confirmLabel: 'Delete', danger: true }))) return;
    await runBatch(ids, { action: 'delete' }, ids.length === 1 ? `${names[0]} deleted` : '{n} characters deleted');
    setSelecting(false);
  };

  const importFiles = async (files: File[]) => {
    const zip = files.find((f) => /\.zip$/i.test(f.name) || f.type.includes('zip'));
    if (zip) {
      setBundleFile(zip);
      setSheet('bundle');
      return;
    }
    setImporting(true);
    let ok = 0;
    for (const f of files) {
      try {
        await upload('/api/characters/import', f);
        ok++;
      } catch (e) {
        toastError(new Error(`${f.name}: ${(e as Error).message}`));
      }
    }
    setImporting(false);
    await refresh();
    if (ok) toast({ title: ok === 1 ? 'Character imported' : `${ok} characters imported`, tone: 'success' });
  };
  const create = async () => {
    try {
      const c = await post('/api/characters', { card: { name: 'New character' } });
      await refresh();
      navigate(`/characters/${c.id}`);
    } catch (e) {
      toastError(e);
    }
  };

  const onOpen = useCallback((c: CharacterSummary) => setOpenId(c.id), []);
  const onToggle = useCallback((c: CharacterSummary) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(c.id)) n.delete(c.id);
    else n.add(c.id);
    return n;
  }), []);
  const onMenu = useCallback((c: CharacterSummary, at: { clientX: number; clientY: number }) => setMenu({ c, at }), []);

  const menuItems = (c: CharacterSummary): ContextItem[] => [
    { label: 'Open', icon: Users, onSelect: () => setOpenId(c.id) },
    { label: c.fav ? 'Remove from favorites' : 'Add to favorites', icon: Star, onSelect: () => void runBatch([c.id], { action: 'fav', value: !c.fav }) },
    { label: 'Add to collection…', icon: FolderPlus, onSelect: () => setCollectFor([c.id]) },
    { label: 'Nickname…', icon: Pencil, onSelect: () => setNickFor(c) },
    { label: 'Select', icon: CheckSquare, onSelect: () => {
      setSelecting(true);
      setSelected(new Set([c.id]));
    } },
    { label: 'Duplicate', icon: Copy, onSelect: () => void post(`/api/characters/${c.id}/duplicate`).then(refresh).catch(toastError) },
    { label: 'Export bundle', icon: Download, onSelect: () => void downloadBundle([c.id]).catch(toastError) },
    { label: 'Delete', icon: Trash2, danger: true, separatorBefore: true, onSelect: () => void remove([c.id]) },
  ];

  const tagChips = Object.entries(state.tagStates);
  const total = chars.data?.length ?? 0;
  const activeCollection = collections.data?.find((c) => c.id === state.collectionId);
  const openIndex = openId ? list.findIndex((c) => c.id === openId) : -1;

  return (
    <Page
      title="Characters"
      actions={
        <>
          <FileButton accept=".png,.webp,.json,.zip,image/png,image/webp,application/json,application/zip" multiple onFiles={importFiles} loading={importing} icon={Upload} variant="secondary" size="md">
            <span className="hidden sm:inline">Import</span>
          </FileButton>
          <Menu
            trigger={<IconButton icon={Plus} label="Create" />}
            items={[
              { label: 'New character', icon: Plus, onSelect: create },
              { label: 'Character studio', icon: Sparkles, onSelect: () => navigate('/characters/studio') },
              ...(features.on.sources ? [{ label: 'Browse online', icon: Globe, onSelect: () => navigate('/characters/browse') }] : []),
              { label: 'New group', icon: UsersRound, onSelect: () => setSheet('group') },
            ]}
          />
          <Menu
            trigger={<IconButton icon={MoreHorizontal} label="Library tools" />}
            items={[
              { label: 'What should I play?', icon: Dices, onSelect: () => setSheet('recommend') },
              { label: selecting ? 'Stop selecting' : 'Select', icon: CheckSquare, onSelect: () => setSelecting((v) => !v), separatorBefore: true },
              { label: 'New collection', icon: FolderPlus, onSelect: () => setColDialog('new') },
              { label: 'Find duplicates', icon: Copy, onSelect: () => setSheet('dupes') },
              { label: 'Import a bundle', icon: PackageOpen, onSelect: () => setSheet('bundle') },
              { label: 'Media check', icon: ImageIcon, onSelect: () => setSheet('media') },
              { label: 'Check for card updates', icon: RefreshCw, onSelect: () => setSheet('updates'), separatorBefore: true },
              { label: 'Find source links', icon: Link2, onSelect: () => setSheet('links') },
            ]}
          />
        </>
      }
    >
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Icon icon={Search} size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
          <Input placeholder="Search or filter (tag:, creator:…)" value={state.query} onChange={(e) => setState((s) => ({ ...s, query: e.target.value }))} className="pl-10 pr-9" aria-label="Search characters" />
          {state.query ? <IconButton size="sm" icon={X} label="Clear search" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => setState((s) => ({ ...s, query: '' }))} /> : null}
        </div>
        <span className="relative">
          <IconButton icon={SlidersHorizontal} label="Filters and sort" onClick={() => setSheet('filters')} active={lib.activeFilters > 0} />
          {lib.activeFilters ? <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-fg">{lib.activeFilters}</span> : null}
        </span>
        <IconButton icon={view === 'grid' ? List : LayoutGrid} label={view === 'grid' ? 'Show as list' : 'Show as grid'} onClick={() => update({ library: { view: view === 'grid' ? 'list' : 'grid' } })} />
      </div>
      {lib.parsed.errors.length ? <p className="mt-1.5 text-xs text-warning">{lib.parsed.errors.join(' · ')}</p> : null}

      {collections.data?.length || total ? (
        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="group" aria-label="Collections">
          <Chip active={!state.collectionId} onClick={() => setState((s) => ({ ...s, collectionId: null }))}>
            All <span className="text-fg-3">{total}</span>
          </Chip>
          <Chip active={/(^|\s)fav(\s|$)/.test(state.query)} onClick={() => setState((s) => ({ ...s, query: /(^|\s)fav(\s|$)/.test(s.query) ? s.query.replace(/(^|\s)fav(?=\s|$)/, '').trim() : `${s.query} fav`.trim() }))}>
            <Icon icon={Star} size={14} /> Favorites
          </Chip>
          {(collections.data ?? []).map((col) => (
            <Chip key={col.id} active={state.collectionId === col.id} onClick={() => setState((s) => ({ ...s, collectionId: s.collectionId === col.id ? null : col.id }))} onEdit={() => setColDialog(col)} color={col.color}>
              <Icon icon={collectionIcon(col.icon)} size={14} /> {col.name} <span className="text-fg-3">{col.characterIds.length}</span>
            </Chip>
          ))}
          <button type="button" onClick={() => setColDialog('new')} className="pressable flex h-8 flex-none items-center gap-1.5 rounded-full border border-dashed border-line-strong px-3 text-sm text-fg-2" aria-label="New collection">
            <Icon icon={FolderPlus} size={14} />
          </button>
        </div>
      ) : null}

      {tagChips.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Tag filters">
          {tagChips.map(([t, s]) => (
            <button
              key={t}
              type="button"
              onClick={() => setState((st) => {
                const n = { ...st.tagStates };
                delete n[t];
                return { ...st, tagStates: n };
              })}
              className={cx('pressable flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium', s === 'include' ? 'bg-accent-soft text-accent-text' : 'bg-danger-soft text-danger')}
              aria-label={`Remove filter ${s === 'include' ? 'with' : 'without'} ${t}`}
            >
              {s === 'include' ? '+' : '−'} {t} <Icon icon={X} size={12} />
            </button>
          ))}
        </div>
      ) : null}

      {chars.isLoading ? null : total ? (
        <>
          <p className="mb-2 mt-3 text-xs text-fg-2" aria-live="polite">
            {list.length === total ? `${total} characters` : `${list.length} of ${total}`}
            {activeCollection ? ` in ${activeCollection.name}` : ''}
          </p>
          {list.length ? (
            <VirtualGrid
              items={list}
              mode={view}
              minColumnWidth={150}
              gap={view === 'grid' ? 14 : 2}
              rowHeight={(w) => (view === 'grid' ? Math.round((w * 4) / 3) + CARD_TEXT_H : 60)}
              getKey={(c) => c.id}
              label="Characters"
              render={(c) => <LibraryCard c={c} mode={view} selecting={selecting} selected={selected.has(c.id)} showInfo={settings.data?.library.cardInfo !== false} onOpen={onOpen} onToggle={onToggle} onMenu={onMenu} />}
            />
          ) : (
            <EmptyState title="Nothing matches" body="Try fewer filters." action={<Button variant="ghost" onClick={lib.reset}>Clear filters</Button>} />
          )}
        </>
      ) : (
        <EmptyState
          icon={Users}
          title="No characters yet"
          body="Import SillyTavern cards (PNG, WebP or JSON), a bundle (.zip), or create one."
          action={
            <div className="flex gap-2">
              <FileButton accept=".png,.webp,.json,.zip" multiple onFiles={importFiles} variant="primary" icon={Upload}>
                Import
              </FileButton>
              <Button variant="ghost" onClick={create}>
                Create
              </Button>
            </div>
          }
        />
      )}

      {selecting ? (
        <div className="sticky bottom-[calc(var(--tabbar-h)+var(--safe-bottom)+8px)] z-20 mt-4 flex items-center gap-1 rounded-lg bg-surface p-1.5 shadow-3 md:bottom-4 dark:bg-surface-2" role="toolbar" aria-label="Selected characters">
          <IconButton size="sm" icon={X} label="Stop selecting" onClick={() => setSelecting(false)} />
          <span className="min-w-0 flex-1 whitespace-nowrap text-sm font-medium">{selected.size} selected</span>
          <IconButton size="sm" icon={CheckSquare} active={selected.size === list.length && list.length > 0} label={selected.size === list.length ? 'Select none' : 'Select all shown'} onClick={() => setSelected(selected.size === list.length ? new Set() : new Set(list.map((c) => c.id)))} />
          <IconButton size="sm" icon={Tag} label="Add or remove tags" disabled={!selected.size} onClick={() => setTagDialog('tag')} />
          <IconButton size="sm" icon={Star} label="Favorite" disabled={!selected.size} onClick={() => void runBatch([...selected], { action: 'fav', value: true }, '{n} favorited')} />
          <IconButton size="sm" icon={Folder} label="Add to collection" disabled={!selected.size} onClick={() => setCollectFor([...selected])} />
          <IconButton size="sm" icon={Download} label="Export bundle" disabled={!selected.size} onClick={() => void downloadBundle([...selected]).catch(toastError)} />
          <IconButton size="sm" icon={Trash2} label="Delete selected" tone="danger" disabled={!selected.size} onClick={() => void remove([...selected])} />
        </div>
      ) : null}

      <ContextMenu at={menu?.at ?? null} onClose={() => setMenu(null)} items={menu ? menuItems(menu.c) : []} title={menu ? menu.c.displayName || menu.c.name : ''} header={menu ? <CardInfo c={menu.c} /> : null} />
      <FiltersSheet open={sheet === 'filters'} onOpenChange={(o) => setSheet(o ? 'filters' : null)} lib={lib} chars={chars.data ?? []} />
      <BundleImportSheet open={sheet === 'bundle'} onOpenChange={(o) => {
        setSheet(o ? 'bundle' : null);
        if (!o) setBundleFile(null);
      }} file={bundleFile} onDone={refresh} />
      <UpdatesSheet open={sheet === 'updates'} onOpenChange={(o) => setSheet(o ? 'updates' : null)} />
      <LinksSheet open={sheet === 'links'} onOpenChange={(o) => setSheet(o ? 'links' : null)} />
      <MediaSheet open={sheet === 'media'} onOpenChange={(o) => setSheet(o ? 'media' : null)} />
      <RecommendSheet
        open={sheet === 'recommend'}
        onOpenChange={(o) => setSheet(o ? 'recommend' : null)}
        collectionId={activeCollection?.id ?? null}
        collectionName={activeCollection?.name}
        onPick={(id) => {
          setSheet(null);
          setOpenId(id);
        }}
      />
      <DuplicatesSheet open={sheet === 'dupes'} onOpenChange={(o) => setSheet(o ? 'dupes' : null)} onDone={refresh} />
      <GroupSheet open={sheet === 'group'} onOpenChange={(o) => setSheet(o ? 'group' : null)} />
      <CollectionDialog target={colDialog} onClose={() => setColDialog(null)} onDone={refresh} />
      <TagDialog mode={tagDialog} onClose={() => setTagDialog(null)} onApply={async (mode, tags) => {
        await runBatch([...selected], { action: mode, tags }, mode === 'tag' ? 'Tags added to {n}' : 'Tags removed from {n}');
      }} />
      <CollectDialog ids={collectFor} collections={collections.data ?? []} onClose={() => setCollectFor(null)} onPick={async (colId) => {
        if (collectFor) await runBatch(collectFor, { action: 'collect', collectionId: colId }, 'Added to collection');
      }} onNew={() => setColDialog('new')} />
      <NicknameDialog c={nickFor} onClose={() => setNickFor(null)} onDone={refresh} />
      <CharacterSheet
        id={openId}
        onClose={() => setOpenId(null)}
        onPrev={openIndex > 0 ? () => setOpenId(list[openIndex - 1].id) : undefined}
        onNext={openIndex >= 0 && openIndex < list.length - 1 ? () => setOpenId(list[openIndex + 1].id) : undefined}
        position={openIndex >= 0 ? `${openIndex + 1} of ${list.length}` : undefined}
        onDeleted={refresh}
        onOpenOther={setOpenId}
      />
    </Page>
  );
}

function Chip({ active, onClick, onEdit, color, children }: { active: boolean; onClick: () => void; onEdit?: () => void; color?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={(e) => {
        if (!onEdit) return;
        e.preventDefault();
        onEdit();
      }}
      style={color && active ? { background: COLLECTION_COLORS[color]?.soft, color: COLLECTION_COLORS[color]?.fg } : undefined}
      className={cx('pressable flex h-8 flex-none items-center gap-1.5 rounded-full px-3 text-sm', active ? 'bg-accent-soft font-medium text-accent-text' : 'bg-surface-2 text-fg-2')}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function CardInfo({ c }: { c: CharacterSummary }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-xs text-fg-2">
      {c.creator ? <Badge>by {c.creator}</Badge> : null}
      <Badge>{c.tokens.toLocaleString()} tokens</Badge>
      {c.chatCount ? <Badge>{c.chatCount} chats</Badge> : null}
      {c.hasLorebook ? <Badge>lorebook</Badge> : null}
      {c.hasGallery ? <Badge>gallery</Badge> : null}
      {c.tags.slice(0, 6).map((t) => (
        <Badge key={t} tone="accent">
          {t}
        </Badge>
      ))}
    </div>
  );
}

function TagDialog({ mode, onClose, onApply }: { mode: null | 'tag' | 'untag'; onClose: () => void; onApply: (mode: 'tag' | 'untag', tags: string[]) => Promise<void> }) {
  const [text, setText] = useState('');
  const [m, setM] = useState<'tag' | 'untag'>('tag');
  useEffect(() => {
    if (mode) {
      setM(mode);
      setText('');
    }
  }, [mode]);
  const tags = text.split(',').map((t) => t.trim()).filter(Boolean);
  return (
    <Dialog
      open={!!mode}
      onOpenChange={(o) => !o && onClose()}
      title={m === 'tag' ? 'Add tags' : 'Remove tags'}
      footer={
        <>
          <Button variant="ghost" onClick={() => setM(m === 'tag' ? 'untag' : 'tag')}>
            {m === 'tag' ? 'Remove instead' : 'Add instead'}
          </Button>
          <Button
            variant="primary"
            disabled={!tags.length}
            onClick={async () => {
              await onApply(m, tags);
              onClose();
            }}
          >
            {m === 'tag' ? 'Add' : 'Remove'}
          </Button>
        </>
      }
    >
      <Field label="Tags, separated by commas" htmlFor="batch-tags">
        <Input id="batch-tags" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="fantasy, favorites" />
      </Field>
    </Dialog>
  );
}

function CollectDialog({ ids, collections, onClose, onPick, onNew }: { ids: string[] | null; collections: CollectionDTO[]; onClose: () => void; onPick: (id: string) => Promise<void>; onNew: () => void }) {
  return (
    <Dialog open={!!ids} onOpenChange={(o) => !o && onClose()} title="Add to collection" description={ids && ids.length > 1 ? `${ids.length} characters` : undefined}>
      <div className="flex flex-col">
        {collections.map((c) => (
          <button
            key={c.id}
            type="button"
            className="pressable flex min-h-11 items-center gap-3 rounded-md px-2 text-left hover:bg-surface-2"
            onClick={async () => {
              await onPick(c.id);
              onClose();
            }}
          >
            <span className="flex size-7 items-center justify-center rounded-md" style={{ background: COLLECTION_COLORS[c.color]?.soft, color: COLLECTION_COLORS[c.color]?.fg }}>
              <Icon icon={collectionIcon(c.icon)} size={16} />
            </span>
            <span className="flex-1">{c.name}</span>
            <span className="text-xs text-fg-3">{c.characterIds.length}</span>
          </button>
        ))}
        <Button
          variant="ghost"
          icon={FolderPlus}
          className="mt-1 justify-start"
          onClick={() => {
            onClose();
            onNew();
          }}
        >
          New collection
        </Button>
      </div>
    </Dialog>
  );
}

function NicknameDialog({ c, onClose, onDone }: { c: CharacterSummary | null; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState('');
  useEffect(() => setV(c?.displayName ?? ''), [c]);
  return (
    <Dialog
      open={!!c}
      onOpenChange={(o) => !o && onClose()}
      title="Nickname"
      description="Shown in your library instead of the card's name. The card itself doesn't change."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await api(`/api/characters/${c!.id}`, { method: 'PATCH', body: { displayName: v.trim() || null } });
                onDone();
                onClose();
              } catch (e) {
                toastError(e);
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <Input aria-label="Nickname" autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={c?.name} maxLength={120} />
    </Dialog>
  );
}
