/**
 * Browse online character sources (Chub for now): search, preview, import. Everything comes through
 * the Everloom server, pictures included; adult content stays hidden unless turned on in Settings.
 */
import type { SourceItem } from '@everloom/engine';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Download, ExternalLink, Lock, Search, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Page } from '@/app/Shell';
import { get, post } from '@/lib/api';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, EmptyState, Icon, IconButton, Input, Segmented, Sheet, Spinner, ToggleRow } from '@/ui';
import { SandboxedHtml } from '../library/SandboxedHtml';

type Item = SourceItem & { ownedId: string | null };
interface Providers {
  nsfwAllowed: boolean;
  providers: Array<{ id: string; name: string; site: string; hasToken: boolean }>;
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
  const provider = providers.data?.providers[0];
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<(typeof SORTS)[number]['value']>('popular');
  const [hideOwned, setHideOwned] = useState(false);
  const [adult, setAdult] = useState(false);
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
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (results.data?.pages ?? []).flatMap((p) => p.items).filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)));
  }, [results.data]);

  return (
    <Page back={<IconButton icon={ArrowLeft} label="Back" onClick={() => navigate('/characters')} />} title={provider ? `Browse ${provider.name}` : 'Browse online'}>
      {!providers.data ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="relative">
            <Icon icon={Search} size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Search ${provider?.name ?? ''}`} aria-label="Search online characters" className="pl-10" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Segmented label="Sort" value={sort} onChange={(v) => setSort(v)} options={SORTS.map((s) => ({ ...s }))} />
            <label className="flex items-center gap-2 text-sm text-fg-2">
              <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={hideOwned} onChange={(e) => setHideOwned(e.target.checked)} />
              Hide ones I have
            </label>
            {providers.data.nsfwAllowed ? (
              <label className="flex items-center gap-2 text-sm text-fg-2">
                <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
                Adult
              </label>
            ) : null}
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
                <div className="flex justify-center py-6">
                  <Button loading={results.isFetchingNextPage} onClick={() => results.fetchNextPage()}>
                    Load more
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <EmptyState title="Nothing found" body={hideOwned ? 'You may already have everything that matches.' : 'Try different words.'} className="mt-10" />
          )}
        </>
      )}
      {open ? <PreviewSheet item={open} onClose={() => setOpen(null)} /> : null}
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
          <Button variant="primary" block icon={Download} loading={busy} disabled={!d.data || d.data.hidden} onClick={doImport}>
            Import
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
              <Lock size={16} className="mt-0.5 flex-none" /> The creator keeps this character's definition private, so it can't be imported. You can still chat with it on the site.
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
