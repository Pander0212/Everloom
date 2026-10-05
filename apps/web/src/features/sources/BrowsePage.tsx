/**
 * Browse online character sources: one search box (with the library's filter syntax), a filter bar,
 * saved searches, every site at once, preview and import, or import from a link. Everything comes
 * through the Everloom server, pictures included; adult content stays hidden unless turned on in
 * Settings. Sites the server must not fetch are listed with how to bring cards in (the browser bridge).
 */
import { contentStorageAllowed } from '@/lib/vaultMode';
import type { SourceItem } from '@everloom/engine';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bookmark, Check, Download, ExternalLink, Info, Link2, Lock, Search, SlidersHorizontal, Star, Trash2, UserRound } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Page } from '@/app/Shell';
import { ApiError, del, get, post } from '@/lib/api';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, EmptyState, Field, Icon, IconButton, Input, Segmented, Select, Sheet, Spinner } from '@/ui';
import { SandboxedHtml } from '../library/SandboxedHtml';
import { activeCount, FILTER_LABELS, FilterBar, filterParams, NO_FILTERS, type Filters } from './FilterBar';

type Item = SourceItem & { ownedId: string | null; also?: Array<{ provider: string; key: string; url: string }> };
interface Capability {
  id: string;
  name: string;
  site: string;
  access: 'server' | 'bridge' | 'none';
  search: boolean;
  preview: boolean;
  import: boolean;
  updates: boolean;
  note: string;
}
export interface AccountInfo {
  kind: 'token' | 'password' | null;
  hint: string | null;
  usernameLabel: string | null;
  connected: boolean;
  username: string | null;
  remembersPassword: boolean;
  status: 'ok' | 'failed' | 'unknown' | null;
  statusDetail: string | null;
  checkedAt: number | null;
}
export interface ProviderInfo {
  id: string;
  name: string;
  site: string;
  onSite: string[];
  sorts: Sort[];
  hasTags: boolean;
  notice: string | null;
  noticeAccepted: boolean;
  account: AccountInfo | null;
  hasToken: boolean;
}
export interface Providers {
  nsfwAllowed: boolean;
  providers: ProviderInfo[];
  capabilities: Capability[];
}
type Sort = 'popular' | 'new' | 'updated' | 'trending' | 'top' | 'views' | 'stars' | 'random';
interface SearchPage {
  items: Item[];
  hasMore: boolean;
  total?: number | null;
  local?: string[];
  errors?: string[];
  sites?: Array<{ provider: string; name: string; ok: boolean; count: number; error: string | null }>;
}
const SOURCE_KEY = 'everloom:browse-source';
const ALL = 'all';

/** How each source was last browsed (sort, filters, scrolling), remembered on this device. */
interface BrowsePrefs {
  sort: Sort;
  hideOwned: boolean;
  adult: boolean;
  /** Load the next page on reaching the end instead of a "Load more" button. */
  auto: boolean;
  filters: Filters;
  showFilters: boolean;
}
const DEFAULT_PREFS: BrowsePrefs = { sort: 'popular', hideOwned: false, adult: false, auto: false, filters: NO_FILTERS, showFilters: false };
function readPrefs(id: string): BrowsePrefs {
  try {
    const p = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(`everloom:browse:${id}`) ?? '{}') };
    return { ...p, filters: { ...NO_FILTERS, ...p.filters } };
  } catch {
    return DEFAULT_PREFS;
  }
}
function writePrefs(id: string, p: BrowsePrefs) {
  try {
    if (contentStorageAllowed()) localStorage.setItem(`everloom:browse:${id}`, JSON.stringify(p));
  } catch {
    /* remembered for this visit only */
  }
}
interface Detail extends Item {
  hidden: boolean;
  description: string;
  version: string;
  needsAccount?: boolean;
  preview: { first_mes: string; alternate_greetings: number; tokens: number | null } | null;
}

/** A picture from a source, through the server; `w` asks for a shrunk copy. */
export const imgUrl = (provider: string, url: string | null, w?: number) => (url ? `/api/sources/${provider}/image?url=${encodeURIComponent(url)}${w ? `&w=${w}` : ''}` : null);
const SORT_LABELS: Record<Sort, string> = { popular: 'Popular', new: 'New', updated: 'Updated', trending: 'Trending', top: 'Top rated', views: 'Most viewed', stars: 'Stars', random: 'Random' };
const TIMED: Sort[] = ['popular', 'top', 'trending', 'views', 'stars'];

export default function BrowsePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const providers = useQuery({ queryKey: ['sources'], queryFn: () => get<Providers>('/api/sources') });
  const [sourceId, setSourceId] = useState<string>(() => {
    try {
      return localStorage.getItem(SOURCE_KEY) ?? 'chub';
    } catch {
      return 'chub';
    }
  });
  const all = sourceId === ALL;
  const provider = all ? null : (providers.data?.providers.find((p) => p.id === sourceId) ?? providers.data?.providers[0]);
  const scope = all ? ALL : provider?.id;
  const pickSource = (id: string) => {
    setSourceId(id);
    try {
      localStorage.setItem(SOURCE_KEY, id);
    } catch {
      /* remembered for this visit only */
    }
  };
  const [about, setAbout] = useState(false);
  const [linking, setLinking] = useState(false);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [prefs, setPrefsState] = useState<BrowsePrefs>(() => readPrefs(sourceId));
  const sortList: Sort[] = all ? ['popular', 'new'] : (provider?.sorts ?? ['popular']);
  const sort = sortList.includes(prefs.sort) ? prefs.sort : (sortList[0] ?? 'popular');
  const { hideOwned, adult, filters } = prefs;
  const setPrefs = (p: Partial<BrowsePrefs>) => {
    const next = { ...prefs, ...p };
    setPrefsState(next);
    if (scope) writePrefs(scope, next);
  };
  useEffect(() => {
    if (scope) setPrefsState(readPrefs(scope));
  }, [scope]);
  const [open, setOpen] = useState<Item | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 400);
    return () => clearTimeout(t);
  }, [text]);
  // Debounced so typing a token count doesn't fire a search per keystroke.
  const [params, setParams] = useState(() => filterParams(filters));
  useEffect(() => {
    const t = setTimeout(() => setParams(filterParams(filters)), 400);
    return () => clearTimeout(t);
  }, [filters]);
  const needsNotice = !!provider?.notice && !provider.noticeAccepted;
  const results = useInfiniteQuery({
    queryKey: ['source-search', scope, query, sort, hideOwned, adult, params],
    enabled: !!scope && !needsNotice,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => get<SearchPage>(`/api/sources/${scope}/search`, { q: query, page: pageParam, sort, hideOwned: hideOwned ? '1' : '0', nsfw: adult ? '1' : '0', ...params }),
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length + 1 : undefined),
    retry: false,
  });
  // Infinite scroll, when chosen: the next page loads as the end of the grid comes into view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!prefs.auto || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting && results.hasNextPage && !results.isFetchingNextPage) void results.fetchNextPage();
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  });
  const pages = results.data?.pages ?? [];
  const items = useMemo(() => {
    const seen = new Set<string>();
    return pages.flatMap((p) => p.items).filter((i) => (seen.has(`${i.provider}:${i.key}`) ? false : (seen.add(`${i.provider}:${i.key}`), true)));
  }, [results.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = pages[0];
  const pageOnly = [...new Set(pages.flatMap((p) => p.local ?? []))];
  const nameOf = (id: string) => providers.data?.providers.find((p) => p.id === id)?.name ?? id;

  const saved = useQuery({ queryKey: ['source-saved'], queryFn: () => get<Array<{ id: string; provider: string; name: string; query: string }>>('/api/sources/saved') });
  const mine = (saved.data ?? []).filter((s) => s.provider === scope);
  const fullQuery = () => [text.trim(), ...filters.tags.map((t) => `tag:"${t}"`), ...filters.exclude.map((t) => `-tag:"${t}"`), filters.creator.trim() && `creator:"${filters.creator.trim()}"`, filters.minTokens && `tokens>=${filters.minTokens}`, filters.maxTokens && `tokens<=${filters.maxTokens}`, filters.lorebook && (filters.lorebook === '1' ? 'has:lorebook' : 'no:lorebook'), filters.greetings && (filters.greetings === '1' ? 'has:greetings' : 'no:greetings'), filters.lang && `lang:${filters.lang}`, filters.time && `time:${filters.time}`, sort !== 'popular' && `sort:${sort}`].filter(Boolean).join(' ');
  const [savedOpen, setSavedOpen] = useState(false);
  const runSaved = (q: string) => {
    // The saved text goes back in the search box; the server reads filters from it.
    setPrefs({ filters: NO_FILTERS });
    setText(q);
    setSavedOpen(false);
  };

  const acceptNotice = async () => {
    if (!provider) return;
    try {
      await post(`/api/sources/${provider.id}/notice`, {});
      await qc.invalidateQueries({ queryKey: ['sources'] });
    } catch (e) {
      toastError(e);
    }
  };
  const errorCode = results.error instanceof ApiError ? results.error.code : undefined;

  return (
    <Page
      back={<IconButton icon={ArrowLeft} label="Back" onClick={() => navigate('/characters')} />}
      title={all ? 'Browse all sources' : provider ? `Browse ${provider.name}` : 'Browse online'}
      actions={
        <>
          <IconButton icon={Link2} label="Import from a link" onClick={() => setLinking(true)} />
          <IconButton icon={Info} label="About sources" onClick={() => setAbout(true)} />
        </>
      }
    >
      {!providers.data ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2">
            <Select aria-label="Source" value={scope ?? ''} onChange={(e) => pickSource(e.target.value)} className="w-auto min-w-44">
              {providers.data.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value={ALL}>All sources</option>
            </Select>
            <span className="flex-1" />
            <IconButton icon={Bookmark} label="Saved searches" onClick={() => setSavedOpen(true)} />
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Icon icon={Search} size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Search ${all ? 'every source' : (provider?.name ?? '')} — try tag:fantasy -tag:gore`} aria-label="Search online characters" className="pl-10" />
            </div>
            <Button variant={prefs.showFilters ? 'secondary' : 'ghost'} icon={SlidersHorizontal} onClick={() => setPrefs({ showFilters: !prefs.showFilters })} aria-expanded={prefs.showFilters}>
              Filters{activeCount(filters) ? ` (${activeCount(filters)})` : ''}
            </Button>
          </div>
          {first?.errors?.length ? <p className="mt-1 text-xs text-warning">{first.errors.join(' · ')}</p> : null}
          {prefs.showFilters && scope ? <FilterBar provider={scope} value={filters} onChange={(f) => setPrefs({ filters: f })} timeMatters={TIMED.includes(sort)} /> : null}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {sortList.length > 1 ? <Segmented label="Sort" value={sort} onChange={(v) => setPrefs({ sort: v as Sort })} options={sortList.map((v) => ({ value: v, label: SORT_LABELS[v] }))} /> : null}
            <label className="flex items-center gap-2 text-sm text-fg-2">
              <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={hideOwned} onChange={(e) => setPrefs({ hideOwned: e.target.checked })} />
              Hide ones I have
            </label>
            {providers.data.nsfwAllowed ? (
              <label className="flex items-center gap-2 text-sm text-fg-2">
                <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={adult} onChange={(e) => setPrefs({ adult: e.target.checked })} />
                Adult
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-sm text-fg-2">
              <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={prefs.auto} onChange={(e) => setPrefs({ auto: e.target.checked })} />
              Load as I scroll
            </label>
            {provider?.account && !provider.account.connected && provider.account.kind === 'password' ? (
              <button className="flex items-center gap-1 text-sm font-medium text-accent-text" onClick={() => navigate('/settings/sources#accounts')}>
                <UserRound size={14} /> Sign in to {provider.name}
              </button>
            ) : null}
          </div>
          {pageOnly.length ? (
            <p className="mt-2 text-xs text-fg-2" role="note">
              {all ? 'Some sites' : provider?.name} can't filter by {pageOnly.map((f) => FILTER_LABELS[f] ?? f).join(', ')}; those are checked on each page here, so a page may show fewer results.
            </p>
          ) : null}
          {all && first?.sites ? (
            <p className="mt-2 text-xs text-fg-3">
              {first.sites.map((s) => (s.ok ? `${s.name}: ${s.count}` : `${s.name}: unavailable`)).join(' · ')}
            </p>
          ) : null}
          {needsNotice && provider ? (
            <div className="mt-6 flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-4 text-sm" role="region" aria-label={`About ${provider.name}`}>
              <p className="font-medium">Before browsing {provider.name}</p>
              <p className="text-fg-2">{provider.notice}</p>
              <div>
                <Button variant="primary" onClick={acceptNotice}>
                  I understand, continue
                </Button>
              </div>
            </div>
          ) : results.isError ? (
            <EmptyState
              title={errorCode === 'cooling_down' ? `${nameOf(scope ?? '')} asked for a pause` : errorCode === 'site_changed' ? `${nameOf(scope ?? '')} changed` : `Couldn't reach ${all ? 'the sources' : provider?.name}`}
              body={(results.error as Error).message}
              action={<Button onClick={() => results.refetch()}>Try again</Button>}
              className="mt-10"
            />
          ) : results.isLoading ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : items.length ? (
            <>
              <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Online characters">
                {items.map((i) => (
                  <li key={`${i.provider}:${i.key}`}>
                    <button className="pressable group flex w-full flex-col text-left" onClick={() => setOpen(i)}>
                      <span className="relative block aspect-[3/4] w-full overflow-hidden rounded-lg bg-surface-2">
                        {i.avatarUrl ? <img src={imgUrl(i.provider, i.avatarUrl, 384)!} alt="" loading="lazy" decoding="async" className="size-full object-cover transition-transform group-hover:scale-[1.02]" /> : null}
                        {i.ownedId ? (
                          <span className="absolute left-2 top-2">
                            <Badge tone="success">
                              <Check size={12} className="-ml-0.5 mr-0.5 inline" />
                              In library
                            </Badge>
                          </span>
                        ) : null}
                        {all ? (
                          <span className="absolute bottom-2 left-2 flex flex-wrap gap-1">
                            <Badge>{nameOf(i.provider)}</Badge>
                            {i.also?.length ? <Badge tone="accent">+{i.also.length} more</Badge> : null}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-2 truncate text-sm font-semibold">{i.name}</span>
                      <span className="truncate text-xs text-fg-2">{i.tagline || `by ${i.creator}`}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {results.hasNextPage ? (
                prefs.auto ? (
                  <div ref={sentinel} className="flex justify-center py-6" aria-hidden={!results.isFetchingNextPage}>
                    {results.isFetchingNextPage ? <Spinner /> : null}
                  </div>
                ) : (
                  <div className="flex justify-center py-6">
                    <Button loading={results.isFetchingNextPage} onClick={() => results.fetchNextPage()}>
                      Load more
                    </Button>
                  </div>
                )
              ) : null}
            </>
          ) : (
            <EmptyState title="Nothing found" body={hideOwned ? 'You may already have everything that matches.' : activeCount(filters) ? 'Try fewer filters.' : 'Try different words.'} className="mt-10" />
          )}
        </>
      )}
      {open ? <PreviewSheet item={open} onClose={() => setOpen(null)} sourceName={nameOf} /> : null}
      {scope ? <SavedSearches open={savedOpen} onOpenChange={setSavedOpen} scope={scope} current={fullQuery()} list={mine} onRun={runSaved} /> : null}
      <AboutSources open={about} onOpenChange={setAbout} caps={providers.data?.capabilities ?? []} />
      <LinkImport open={linking} onOpenChange={setLinking} caps={providers.data?.capabilities ?? []} />
    </Page>
  );
}

/** Saved searches for this source: run one, delete one, or save what's on screen now. */
function SavedSearches({ open, onOpenChange, scope, current, list, onRun }: { open: boolean; onOpenChange: (o: boolean) => void; scope: string; current: string; list: Array<{ id: string; name: string; query: string }>; onRun: (q: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const save = async () => {
    try {
      await post('/api/sources/saved', { provider: scope, name: name.trim() || current.slice(0, 40) || 'My search', q: current });
      setName('');
      await qc.invalidateQueries({ queryKey: ['source-saved'] });
      toast({ title: 'Search saved', tone: 'success' });
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async (id: string) => {
    try {
      await del(`/api/sources/saved/${id}`);
      await qc.invalidateQueries({ queryKey: ['source-saved'] });
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Saved searches" description="Searches are kept as text, filters included, so you can also paste one into the search box." size="md">
      <div className="flex flex-col gap-4">
        <Field label="Save the current search" htmlFor="saved-name" hint={current ? <code className="break-all">{current}</code> : 'Nothing to save yet: type something or set a filter.'}>
          <div className="flex gap-2">
            <Input id="saved-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={80} />
            <Button variant="primary" disabled={!current} onClick={save}>
              Save
            </Button>
          </div>
        </Field>
        {list.length ? (
          <ul className="flex flex-col divide-y divide-line" aria-label="Saved searches">
            {list.map((s) => (
              <li key={s.id} className="flex items-center gap-2 py-2">
                <button className="pressable min-w-0 flex-1 text-left" onClick={() => onRun(s.query)}>
                  <span className="block truncate font-medium">{s.name}</span>
                  <span className="block truncate text-xs text-fg-2">{s.query}</span>
                </button>
                <IconButton icon={Trash2} label={`Delete ${s.name}`} onClick={() => remove(s.id)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-2">No saved searches for this source yet.</p>
        )}
      </div>
    </Sheet>
  );
}

function PreviewSheet({ item, onClose, sourceName }: { item: Item; onClose: () => void; sourceName: (id: string) => string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const d = useQuery({ queryKey: ['source-item', item.provider, item.key], queryFn: () => get<Detail>(`/api/sources/${item.provider}/item`, { key: item.key }), retry: false });
  const [busy, setBusy] = useState(false);
  const owned = d.data?.ownedId ?? item.ownedId;
  const doImport = async () => {
    setBusy(true);
    try {
      const c = await post<{ id: string; name: string }>(`/api/sources/${item.provider}/import`, { key: item.key });
      toast({ title: `${c.name} added to your library`, tone: 'success', action: { label: 'Open', run: () => navigate(`/characters/${c.id}`) } });
      await qc.invalidateQueries({ queryKey: ['source-search'] });
      await qc.invalidateQueries({ queryKey: ['source-item', item.provider, item.key] });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={item.name}
      description={`by ${item.creator}`}
      size="lg"
      footer={
        owned ? (
          <Button variant="primary" block onClick={() => navigate(`/characters/${owned}`)}>
            Open in library
          </Button>
        ) : (
          d.data?.needsAccount ? (
            <Button variant="primary" block icon={UserRound} onClick={() => navigate('/settings/sources#accounts')}>
              Sign in to {sourceName(item.provider)} to import
            </Button>
          ) : (
            <Button variant="primary" block icon={Download} loading={busy} disabled={!d.data} onClick={doImport}>
              {d.data?.hidden ? 'Import public profile' : 'Import'}
            </Button>
          )
        )
      }
    >
      <div className="flex gap-4">
        {item.avatarUrl ? <img src={imgUrl(item.provider, item.avatarUrl, 320)!} alt="" className="h-40 w-30 flex-none rounded-lg object-cover" /> : null}
        <div className="flex min-w-0 flex-col gap-2 text-sm">
          {item.tagline ? <p className="text-fg-2">{item.tagline}</p> : null}
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-2">
            {item.stars != null ? (
              <span className="flex items-center gap-1">
                <Star size={12} /> {item.stars}
              </span>
            ) : null}
            {item.tokens != null ? <span>{item.tokens.toLocaleString()} tokens</span> : null}
            {item.updatedAt ? <span>updated {new Date(item.updatedAt).toLocaleDateString()}</span> : null}
          </p>
          <div className="flex flex-wrap gap-1">
            {item.tags.slice(0, 10).map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </div>
          <a href={item.url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1 text-xs font-medium text-accent-text">
            View on {sourceName(item.provider)} <ExternalLink size={12} />
          </a>
          {item.also?.length ? (
            <p className="text-xs text-fg-2">
              Also on{' '}
              {item.also.map((a, n) => (
                <span key={`${a.provider}:${a.key}`}>
                  {n ? ', ' : ''}
                  <a href={a.url} target="_blank" rel="noreferrer noopener" className="text-accent-text">
                    {sourceName(a.provider)}
                  </a>
                </span>
              ))}
            </p>
          ) : null}
        </div>
      </div>
      {d.isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : d.isError ? (
        <p className="mt-4 text-sm text-danger">{(d.error as Error).message}</p>
      ) : d.data ? (
        <div className="mt-5 flex flex-col gap-4">
          {d.data.needsAccount ? (
            <p className="flex items-start gap-2 rounded-md bg-surface-2 p-3 text-sm text-fg-2">
              <UserRound size={16} className="mt-0.5 flex-none" />
              <span>
                <strong className="font-medium text-fg">{sourceName(item.provider)} shows definitions to members only.</strong> Sign in with your account under Settings › Character sources to preview and import. Fields the creator hid stay hidden either way.
              </span>
            </p>
          ) : null}
          {d.data.hidden ? (
            <p className="flex items-start gap-2 rounded-md bg-surface-2 p-3 text-sm text-fg-2">
              <Lock size={16} className="mt-0.5 flex-none" />
              <span>
                <strong className="font-medium text-fg">Definition hidden by creator.</strong> Only the public profile (name, picture, notes) comes across, labelled as such. You can still chat with the full character on the site.
              </span>
            </p>
          ) : null}
          {d.data.preview?.first_mes ? (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-3">First message</h3>
              <p className="story line-clamp-[10] whitespace-pre-wrap text-[15px]">{d.data.preview.first_mes}</p>
              {d.data.preview.alternate_greetings ? <p className="mt-1 text-xs text-fg-2">+ {d.data.preview.alternate_greetings} other greeting{d.data.preview.alternate_greetings === 1 ? "" : "s"}</p> : null}
            </section>
          ) : null}
          {d.data.description ? (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-3">Creator's notes</h3>
              <SandboxedHtml source={d.data.description} />
            </section>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}

const ACCESS: Record<Capability['access'], { label: string; tone: 'success' | 'accent' | 'neutral' }> = {
  server: { label: 'Built in', tone: 'success' },
  bridge: { label: 'Browser bridge', tone: 'accent' },
  none: { label: 'Not supported', tone: 'neutral' },
};

/** The capability matrix: what works for each site, and why. */
function AboutSources({ open, onOpenChange, caps }: { open: boolean; onOpenChange: (o: boolean) => void; caps: Capability[] }) {
  const navigate = useNavigate();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Character sources"
      description="Everloom only uses public endpoints, fetched by your server with polite limits. Sites that block automated requests work through the browser bridge instead."
      size="lg"
      footer={
        <Button variant="secondary" block onClick={() => navigate('/settings/sources#bridge')}>
          Set up the browser bridge
        </Button>
      }
    >
      <ul className="flex flex-col divide-y divide-line" aria-label="What each source supports">
        {caps.map((c) => (
          <li key={c.id} className="flex flex-col gap-1 py-3">
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
              <Badge tone={ACCESS[c.access].tone}>{ACCESS[c.access].label}</Badge>
            </span>
            <span className="text-xs text-fg-2">{c.note}</span>
            {c.access !== 'none' ? (
              <span className="text-xs text-fg-3">
                {[c.search && 'Search', c.preview && 'Preview', c.import && 'Import', c.updates && 'Update checks'].filter(Boolean).join(' · ')}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function LinkImport({ open, onOpenChange, caps }: { open: boolean; onOpenChange: (o: boolean) => void; caps: Capability[] }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setError(null);
    // Pages on sites Everloom doesn't fetch: say what to do instead of trying.
    try {
      const u = new URL(url.trim());
      const host = u.hostname.replace(/^www\./, '');
      const cap = caps.find((c) => c.access !== 'server' && c.site && new URL(c.site).hostname.replace(/^www\./, '') === host);
      if (cap && !/\.(png|json|charx)$/i.test(u.pathname)) {
        setError(cap.access === 'none' ? `${cap.name} isn't supported. ${cap.note}` : `Everloom doesn't fetch pages from ${cap.name}. Open the page in your browser and use "Send to Everloom" (Settings › Character sources › Browser bridge).`);
        return;
      }
    } catch {
      setError("That doesn't look like a link");
      return;
    }
    setBusy(true);
    try {
      const r = await post<{ character: { id: string; name: string }; via: string }>('/api/sources/import-url', { url: url.trim() });
      toast({ title: `${r.character.name} added to your library`, lines: [`From ${r.via}`], tone: 'success', action: { label: 'Open', run: () => navigate(`/characters/${r.character.id}`) } });
      await qc.invalidateQueries({ queryKey: ['source-search'] });
      setUrl('');
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Import from a link"
      description="A character page on a supported site, or a direct link to a card file (PNG, JSON or CHARX)."
      size="md"
      footer={
        <Button variant="primary" block icon={Download} loading={busy} disabled={url.trim().length < 8} onClick={go}>
          Import
        </Button>
      }
    >
      <Field label="Link" htmlFor="import-url" error={error ?? undefined}>
        <Input id="import-url" type="url" inputMode="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url.trim().length >= 8 && void go()} />
      </Field>
      <p className="mt-3 text-sm text-fg-2">
        Copied a card with the bookmarklet?{' '}
        <button className="font-medium text-accent-text" onClick={() => navigate('/bridge/receive')}>
          Paste from bridge
        </button>
      </p>
    </Sheet>
  );
}
