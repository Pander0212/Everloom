/**
 * Browse online character sources: search, preview, import, or import from a link. Everything comes
 * through the Everloom server, pictures included; adult content stays hidden unless turned on in
 * Settings. Sites the server must not fetch are listed with how to bring cards in (the browser bridge).
 */
import type { SourceItem } from '@everloom/engine';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Download, ExternalLink, Info, Link2, Lock, Search, Star } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Page } from '@/app/Shell';
import { get, post } from '@/lib/api';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, EmptyState, Field, Icon, IconButton, Input, Segmented, Select, Sheet, Spinner } from '@/ui';
import { SandboxedHtml } from '../library/SandboxedHtml';

type Item = SourceItem & { ownedId: string | null };
interface Capability {
  id: string;
  name: string;
  site: string;
  access: 'server' | 'bridge' | 'none';
  search: boolean;
  preview: boolean;
  import: boolean;
  updates: boolean;
  sorts: Array<'popular' | 'new' | 'updated' | 'stars'>;
  note: string;
}
interface Providers {
  nsfwAllowed: boolean;
  providers: Array<{ id: string; name: string; site: string; hasToken: boolean }>;
  capabilities: Capability[];
}
const SOURCE_KEY = 'everloom:browse-source';

/** How each source was last browsed (sort, filters, scrolling), remembered on this device. */
interface BrowsePrefs {
  sort: 'popular' | 'new' | 'updated' | 'stars';
  hideOwned: boolean;
  adult: boolean;
  /** Load the next page on reaching the end instead of a "Load more" button. */
  auto: boolean;
}
const DEFAULT_PREFS: BrowsePrefs = { sort: 'popular', hideOwned: false, adult: false, auto: false };
function readPrefs(id: string): BrowsePrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(`everloom:browse:${id}`) ?? '{}') };
  } catch {
    return DEFAULT_PREFS;
  }
}
function writePrefs(id: string, p: BrowsePrefs) {
  try {
    localStorage.setItem(`everloom:browse:${id}`, JSON.stringify(p));
  } catch {
    /* remembered for this visit only */
  }
}
interface Detail extends Item {
  hidden: boolean;
  description: string;
  version: string;
  preview: { first_mes: string; alternate_greetings: number; tokens: number | null } | null;
}

export const imgUrl = (provider: string, url: string | null) => (url ? `/api/sources/${provider}/image?url=${encodeURIComponent(url)}` : null);
const SORTS = [
  { value: 'popular', label: 'Popular' },
  { value: 'new', label: 'New' },
  { value: 'updated', label: 'Updated' },
  { value: 'stars', label: 'Stars' },
] as const;

export default function BrowsePage() {
  const navigate = useNavigate();
  const providers = useQuery({ queryKey: ['sources'], queryFn: () => get<Providers>('/api/sources') });
  const [sourceId, setSourceId] = useState<string>(() => {
    try {
      return localStorage.getItem(SOURCE_KEY) ?? 'chub';
    } catch {
      return 'chub';
    }
  });
  const provider = providers.data?.providers.find((p) => p.id === sourceId) ?? providers.data?.providers[0];
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
  const caps = providers.data?.capabilities.find((c) => c.id === provider?.id);
  const sorts = SORTS.filter((x) => !caps || caps.sorts.includes(x.value));
  const sort = sorts.some((x) => x.value === prefs.sort) ? prefs.sort : (sorts[0]?.value ?? 'popular');
  const { hideOwned, adult } = prefs;
  const setPrefs = (p: Partial<BrowsePrefs>) => {
    const next = { ...prefs, ...p };
    setPrefsState(next);
    if (provider) writePrefs(provider.id, next);
  };
  useEffect(() => {
    if (provider) setPrefsState(readPrefs(provider.id));
  }, [provider?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState<Item | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 400);
    return () => clearTimeout(t);
  }, [text]);
  const results = useInfiniteQuery({
    queryKey: ['source-search', provider?.id, query, sort, hideOwned, adult],
    enabled: !!provider,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => get<{ items: Item[]; hasMore: boolean }>(`/api/sources/${provider!.id}/search`, { q: query, page: pageParam, sort, hideOwned: hideOwned ? '1' : '0', nsfw: adult ? '1' : '0' }),
    getNextPageParam: (last, all) => (last.hasMore ? all.length + 1 : undefined),
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
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (results.data?.pages ?? []).flatMap((p) => p.items).filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)));
  }, [results.data]);

  return (
    <Page
      back={<IconButton icon={ArrowLeft} label="Back" onClick={() => navigate('/characters')} />}
      title={provider ? `Browse ${provider.name}` : 'Browse online'}
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
            <Select aria-label="Source" value={provider?.id ?? ''} onChange={(e) => pickSource(e.target.value)} className="w-auto min-w-44">
              {providers.data.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="relative">
            <Icon icon={Search} size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Search ${provider?.name ?? ''}`} aria-label="Search online characters" className="pl-10" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {sorts.length > 1 ? <Segmented label="Sort" value={sort} onChange={(v) => setPrefs({ sort: v })} options={sorts.map((x) => ({ ...x }))} /> : null}
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
          </div>
          {results.isError ? (
            <EmptyState title={`Couldn't reach ${provider?.name}`} body={(results.error as Error).message} action={<Button onClick={() => results.refetch()}>Try again</Button>} className="mt-10" />
          ) : results.isLoading ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : items.length ? (
            <>
              <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Online characters">
                {items.map((i) => (
                  <li key={i.key}>
                    <button className="pressable group flex w-full flex-col text-left" onClick={() => setOpen(i)}>
                      <span className="relative block aspect-[3/4] w-full overflow-hidden rounded-lg bg-surface-2">
                        {i.avatarUrl ? <img src={imgUrl(i.provider, i.avatarUrl)!} alt="" loading="lazy" className="size-full object-cover transition-transform group-hover:scale-[1.02]" /> : null}
                        {i.ownedId ? (
                          <span className="absolute left-2 top-2">
                            <Badge tone="success">
                              <Check size={12} className="-ml-0.5 mr-0.5 inline" />
                              In library
                            </Badge>
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
            <EmptyState title="Nothing found" body={hideOwned ? 'You may already have everything that matches.' : 'Try different words.'} className="mt-10" />
          )}
        </>
      )}
      {open ? <PreviewSheet item={open} onClose={() => setOpen(null)} /> : null}
      <AboutSources open={about} onOpenChange={setAbout} caps={providers.data?.capabilities ?? []} />
      <LinkImport open={linking} onOpenChange={setLinking} caps={providers.data?.capabilities ?? []} />
    </Page>
  );
}

function PreviewSheet({ item, onClose }: { item: Item; onClose: () => void }) {
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
          <Button variant="primary" block icon={Download} loading={busy} disabled={!d.data} onClick={doImport}>
            {d.data?.hidden ? 'Import public profile' : 'Import'}
          </Button>
        )
      }
    >
      <div className="flex gap-4">
        {item.avatarUrl ? <img src={imgUrl(item.provider, item.avatarUrl)!} alt="" className="h-40 w-30 flex-none rounded-lg object-cover" /> : null}
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
            View on the site <ExternalLink size={12} />
          </a>
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
        <Button variant="secondary" block onClick={() => navigate('/settings/characters#bridge')}>
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
        setError(cap.access === 'none' ? `${cap.name} isn't supported. ${cap.note}` : `Everloom doesn't fetch pages from ${cap.name}. Open the page in your browser and use "Send to Everloom" (Settings → Characters → Browser bridge).`);
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
    </Sheet>
  );
}
