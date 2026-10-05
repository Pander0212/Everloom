/**
 * Chat history: every chat across all characters and groups, with search (titles, names and,
 * optionally, the messages themselves), filters, sorts and presets. A message hit jumps straight
 * to that message.
 */
import { contentStorageAllowed } from '@/lib/vaultMode';
import type { ChatSummary, FilterPreset } from '@everloom/engine';
import { useQuery } from '@tanstack/react-query';
import { Check, MessageSquarePlus, MessagesSquare, Plug, Save, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Page } from '@/app/Shell';
import { get } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useCharacters, useChats, useConnections, useGroups, useSettings } from '@/lib/queries';
import { Avatar, Button, EmptyState, Icon, IconButton, Input, Segmented, Sheet, ToggleRow } from '@/ui';
import { VirtualGrid } from '../library/VirtualGrid';
import { useSettingsPatch } from '../settings/common';
import { NewChatSheet } from './NewChatSheet';

type ChatSort = 'recent' | 'oldest' | 'longest' | 'name';
type Kind = 'all' | 'game' | 'plain' | 'group';
interface View {
  q: string;
  messages: boolean;
  sort: ChatSort;
  kind: Kind;
}
const KEY = 'everloom.chats.view';
const initial: View = { q: '', messages: false, sort: 'recent', kind: 'all' };
const load = (): View => {
  try {
    return { ...initial, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return initial;
  }
};
// Presets share the library's storage; the kind rides in tagStates, the sort in `sort`.
const SORT_TO_LIB: Record<ChatSort, FilterPreset['sort']> = { recent: 'recent', oldest: 'created', longest: 'tokens', name: 'name' };

export default function ChatsPage() {
  const chats = useChats();
  const chars = useCharacters();
  const groups = useGroups();
  const conns = useConnections();
  const settings = useSettings();
  const { update } = useSettingsPatch();
  const [view, setView] = useState<View>(load);
  const [debounced, setDebounced] = useState(view.q);
  const [newOpen, setNewOpen] = useState(false);
  const [filters, setFilters] = useState(false);
  const [presetName, setPresetName] = useState('');
  const navigate = useNavigate();
  useEffect(() => {
    try {
      if (contentStorageAllowed()) localStorage.setItem(KEY, JSON.stringify(view));
    } catch {
      /* private mode */
    }
    const t = setTimeout(() => setDebounced(view.q.trim()), 250);
    return () => clearTimeout(t);
  }, [view]);
  // The default chats preset applies when the page opens.
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || !settings.data) return;
    applied.current = true;
    const p = settings.data.library.presets.find((x) => x.scope === 'chats' && x.id === settings.data!.library.defaultPreset);
    if (p) setView(fromPreset(p));
  }, [settings.data]);
  const hits = useQuery({ queryKey: ['chat-search', debounced], queryFn: () => get<Array<{ chatId: string; messageId: string; count: number; snippet: string }>>('/api/chat-search', { q: debounced }), enabled: view.messages && debounced.length > 1 });
  const byId = useMemo(() => new Map((chars.data ?? []).map((c) => [c.id, c])), [chars.data]);
  const groupById = useMemo(() => new Map((groups.data ?? []).map((g) => [g.id, g])), [groups.data]);
  const who = (c: ChatSummary) => (c.characterId ? byId.get(c.characterId) : undefined) ?? (c.groupId ? groupById.get(c.groupId) : undefined);
  const hitBy = useMemo(() => new Map((hits.data ?? []).map((h) => [h.chatId, h])), [hits.data]);
  const list = useMemo(() => {
    const n = debounced.toLowerCase();
    let l = (chats.data ?? []).filter((c) => (view.kind === 'all' ? true : view.kind === 'game' ? !!c.campaignId : view.kind === 'plain' ? !c.campaignId && !c.groupId : !!c.groupId));
    if (n) l = l.filter((c) => c.title.toLowerCase().includes(n) || ((who(c) as any)?.displayName ?? who(c)?.name ?? '').toLowerCase().includes(n) || hitBy.has(c.id));
    const name = (c: ChatSummary) => (who(c)?.name ?? c.title).toLowerCase();
    const by: Record<ChatSort, (a: ChatSummary, b: ChatSummary) => number> = {
      recent: (a, b) => b.updatedAt - a.updatedAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
      longest: (a, b) => b.messageCount - a.messageCount,
      name: (a, b) => name(a).localeCompare(name(b)) || b.updatedAt - a.updatedAt,
    };
    return l.slice().sort(by[view.sort]);
  }, [chats.data, view, debounced, hitBy, byId, groupById]);
  const noConnection = conns.data && !conns.data.some((c) => ['openai', 'anthropic', 'gemini', 'textgen'].includes(c.provider));
  const presets = (settings.data?.library.presets ?? []).filter((p) => p.scope === 'chats');
  const def = settings.data?.library.defaultPreset ?? null;
  const savePresets = (next: FilterPreset[], defaultPreset = def) => update({ library: { presets: [...(settings.data?.library.presets ?? []).filter((p) => p.scope !== 'chats'), ...next], defaultPreset } });
  const active = (view.kind !== 'all' ? 1 : 0) + (view.sort !== 'recent' ? 1 : 0) + (view.messages ? 1 : 0);

  return (
    <Page
      title="Chats"
      actions={
        <>
          <IconButton icon={MessageSquarePlus} label="New chat" className="md:hidden" onClick={() => setNewOpen(true)} />
          <span className="hidden md:contents">
            <Button variant="primary" icon={MessageSquarePlus} onClick={() => setNewOpen(true)}>
              New chat
            </Button>
          </span>
        </>
      }
    >
      {noConnection ? (
        <Link to="/settings/connections" className="pressable mb-4 flex items-center gap-3 rounded-md bg-accent-soft px-4 py-3 text-sm">
          <Icon icon={Plug} className="text-accent-text" />
          <span className="flex-1">
            <span className="font-medium text-fg">Connect a model</span>
            <span className="block text-fg-2">Add an API connection so characters can reply.</span>
          </span>
        </Link>
      ) : null}
      {chats.data?.length ? (
        <div className="mb-2 flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Icon icon={Search} size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
            <Input placeholder={view.messages ? 'Search chats and messages' : 'Search chats'} value={view.q} onChange={(e) => setView((v) => ({ ...v, q: e.target.value }))} className="pl-10 pr-9" aria-label="Search chats" />
            {view.q ? <IconButton size="sm" icon={X} label="Clear search" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => setView((v) => ({ ...v, q: '' }))} /> : null}
          </div>
          <span className="relative">
            <IconButton icon={SlidersHorizontal} label="Filter and sort chats" active={active > 0} onClick={() => setFilters(true)} />
            {active ? <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-fg">{active}</span> : null}
          </span>
        </div>
      ) : null}
      {chats.isLoading ? null : list.length ? (
        <>
          {debounced || view.kind !== 'all' ? <p className="mb-1 text-xs text-fg-2" aria-live="polite">{list.length} of {chats.data?.length} chats</p> : null}
          <VirtualGrid
            items={list}
            mode="list"
            gap={0}
            rowHeight={() => 72}
            getKey={(c) => c.id}
            label="Chats"
            render={(c) => {
              const w = who(c);
              const name = (w as any)?.displayName || w?.name || 'Chat';
              const hit = hitBy.get(c.id);
              return (
                <button type="button" onClick={() => navigate(hit ? `/chat/${c.id}?m=${hit.messageId}` : `/chat/${c.id}`)} className="pressable -mx-2 flex h-full w-[calc(100%+16px)] items-center gap-3 rounded-md px-2 text-left hover:bg-surface-2">
                  <Avatar src={w?.avatar} name={name} size="lg" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-base font-medium">{name}</span>
                      <span className="ml-auto flex-none text-xs text-fg-3">{relativeTime(c.updatedAt)}</span>
                    </span>
                    <span className="block truncate text-sm text-fg-2">{hit ? <><span className="text-accent-text">{hit.count} match{hit.count > 1 ? 'es' : ''}:</span> {hit.snippet}</> : c.lastMessage ? c.lastMessage.replace(/[*_]/g, '') : c.title}</span>
                    <span className="block truncate text-xs text-fg-3">{[c.title !== name ? c.title : '', `${c.messageCount} messages`, c.campaignId ? 'game' : ''].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
              );
            }}
          />
        </>
      ) : (
        <EmptyState
          icon={MessagesSquare}
          title={view.q || view.kind !== 'all' ? 'No chats match' : 'No chats yet'}
          body={view.q ? (view.messages ? undefined : 'Turn on “Search inside messages” to look through what was said.') : 'Pick a character to start your first story.'}
          action={
            view.q || view.kind !== 'all' ? (
              <Button variant="ghost" onClick={() => setView(initial)}>Clear filters</Button>
            ) : (
              <Button variant="primary" onClick={() => (chars.data?.length ? setNewOpen(true) : navigate('/characters'))}>
                {chars.data?.length ? 'Start a chat' : 'Add a character'}
              </Button>
            )
          }
        />
      )}
      <Sheet open={filters} onOpenChange={setFilters} title="Filter chats" size="md" footer={<Button variant="primary" block onClick={() => setFilters(false)}>Show {list.length}</Button>}>
        <div className="flex flex-col gap-5">
          <ToggleRow label="Search inside messages" description="Finds chats by what was said, and opens right at that message." checked={view.messages} onChange={(v) => setView((x) => ({ ...x, messages: v }))} />
          <div>
            <p className="mb-1.5 text-sm font-semibold text-fg-2">Show</p>
            <Segmented size="sm" label="Which chats" value={view.kind} onChange={(v) => setView((x) => ({ ...x, kind: v }))} options={[{ value: 'all', label: 'All' }, { value: 'game', label: 'Games' }, { value: 'plain', label: 'Plain' }, { value: 'group', label: 'Groups' }]} />
          </div>
          <div>
            <p className="mb-1.5 text-sm font-semibold text-fg-2">Sort</p>
            <Segmented size="sm" label="Sort chats" value={view.sort} onChange={(v) => setView((x) => ({ ...x, sort: v }))} options={[{ value: 'recent', label: 'Recent' }, { value: 'oldest', label: 'Oldest' }, { value: 'longest', label: 'Longest' }, { value: 'name', label: 'Name' }]} />
          </div>
          <section>
            <h3 className="text-sm font-semibold text-fg-2">Presets</h3>
            {presets.map((p) => (
              <div key={p.id} className="flex min-h-11 items-center gap-1">
                <button type="button" className="pressable min-w-0 flex-1 truncate rounded-md px-2 py-2 text-left hover:bg-surface-2" onClick={() => setView(fromPreset(p))}>
                  {p.name}
                  {def === p.id ? <span className="ml-2 text-xs text-accent-text">default</span> : null}
                </button>
                <IconButton size="sm" icon={Check} active={def === p.id} label={def === p.id ? 'Stop opening with this' : 'Open chats with this'} onClick={() => savePresets(presets, def === p.id ? null : p.id)} />
                <IconButton size="sm" icon={Trash2} label={`Delete ${p.name}`} onClick={() => savePresets(presets.filter((x) => x.id !== p.id), def === p.id ? null : def)} />
              </div>
            ))}
            <div className="mt-2 flex gap-2">
              <Input aria-label="Preset name" placeholder="Save these filters as…" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
              <Button variant="secondary" icon={Save} disabled={!presetName.trim()} onClick={() => {
                savePresets([...presets, { id: `fp_${Date.now().toString(36)}`, name: presetName.trim(), query: `${view.q}${view.messages ? ' \u0000messages' : ''}`, tagStates: view.kind !== 'all' ? { [view.kind]: 'include' } : {}, sort: SORT_TO_LIB[view.sort], desc: false, scope: 'chats' }]);
                setPresetName('');
              }}>
                Save
              </Button>
            </div>
          </section>
        </div>
      </Sheet>
      <NewChatSheet open={newOpen} onOpenChange={setNewOpen} />
    </Page>
  );
}

function fromPreset(p: FilterPreset): View {
  const sort = (Object.entries(SORT_TO_LIB).find(([, v]) => v === p.sort)?.[0] ?? 'recent') as ChatSort;
  const kind = (Object.keys(p.tagStates)[0] ?? 'all') as Kind;
  return { q: p.query.replace(' \u0000messages', ''), messages: p.query.includes('\u0000messages'), sort, kind };
}
