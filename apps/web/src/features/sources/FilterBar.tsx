/**
 * The filter bar shared by every online source: tags to include or exclude (with suggestions from the
 * site), creator, token range, time range, lorebook, alternate greetings and language. Filters a site
 * can't apply itself still work: the server checks each page, and the bar says which were page-only.
 */
import { useQuery } from '@tanstack/react-query';
import { Minus, Plus, X } from 'lucide-react';
import { useId, useState } from 'react';
import { get } from '@/lib/api';
import { Input, Select } from '@/ui';

export interface Filters {
  tags: string[];
  exclude: string[];
  creator: string;
  minTokens: string;
  maxTokens: string;
  time: '' | 'day' | 'week' | 'month' | 'year';
  lorebook: '' | '1' | '0';
  greetings: '' | '1' | '0';
  lang: string;
}
export const NO_FILTERS: Filters = { tags: [], exclude: [], creator: '', minTokens: '', maxTokens: '', time: '', lorebook: '', greetings: '', lang: '' };

export const activeCount = (f: Filters) =>
  f.tags.length + f.exclude.length + [f.creator, f.minTokens, f.maxTokens, f.time, f.lorebook, f.greetings, f.lang].filter(Boolean).length;

/** The bar's fields as query-string parameters for the search endpoints. */
export function filterParams(f: Filters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.tags.length) out.tags = f.tags.join(',');
  if (f.exclude.length) out.exclude = f.exclude.join(',');
  if (f.creator.trim()) out.creator = f.creator.trim();
  if (/^\d+$/.test(f.minTokens)) out.minTokens = f.minTokens;
  if (/^\d+$/.test(f.maxTokens)) out.maxTokens = f.maxTokens;
  if (f.time) out.time = f.time;
  if (f.lorebook) out.lorebook = f.lorebook;
  if (f.greetings) out.greetings = f.greetings;
  if (f.lang.trim()) out.lang = f.lang.trim();
  return out;
}

const LANGS = [
  ['', 'Any language'],
  ['en', 'English'],
  ['es', 'Spanish'],
  ['pt', 'Portuguese'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['ru', 'Russian'],
  ['ja', 'Japanese'],
  ['zh', 'Chinese'],
  ['ko', 'Korean'],
] as const;

export const FILTER_LABELS: Record<string, string> = {
  text: 'search words',
  tags: 'tags',
  excludeTags: 'excluded tags',
  creator: 'creator',
  tokens: 'tokens',
  time: 'time range',
  lorebook: 'lorebook',
  greetings: 'greetings',
  language: 'language',
  nsfw: 'adult content',
};

export function FilterBar({ provider, value, onChange, timeMatters }: { provider: string; value: Filters; onChange: (f: Filters) => void; timeMatters: boolean }) {
  const set = (p: Partial<Filters>) => onChange({ ...value, ...p });
  const id = useId();
  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-line bg-surface-2/60 p-3" role="group" aria-label="Filters">
      <TagPicker provider={provider} include={value.tags} exclude={value.exclude} onChange={(tags, exclude) => set({ tags, exclude })} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs text-fg-2">
          Creator
          <Input value={value.creator} onChange={(e) => set({ creator: e.target.value })} placeholder="Anyone" aria-label="Creator" />
        </label>
        <div className="flex flex-col gap-1 text-xs text-fg-2">
          <span id={`${id}-tok`}>Tokens</span>
          <div className="flex items-center gap-1" aria-labelledby={`${id}-tok`} role="group">
            <Input inputMode="numeric" value={value.minTokens} onChange={(e) => set({ minTokens: e.target.value.replace(/\D/g, '') })} placeholder="min" aria-label="Fewest tokens" />
            <span aria-hidden>–</span>
            <Input inputMode="numeric" value={value.maxTokens} onChange={(e) => set({ maxTokens: e.target.value.replace(/\D/g, '') })} placeholder="max" aria-label="Most tokens" />
          </div>
        </div>
        <label className="flex flex-col gap-1 text-xs text-fg-2">
          Lorebook
          <Select value={value.lorebook} onChange={(e) => set({ lorebook: e.target.value as Filters['lorebook'] })} aria-label="Lorebook">
            <option value="">Either</option>
            <option value="1">Has one</option>
            <option value="0">None</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-2">
          Other greetings
          <Select value={value.greetings} onChange={(e) => set({ greetings: e.target.value as Filters['greetings'] })} aria-label="Other greetings">
            <option value="">Either</option>
            <option value="1">Has some</option>
            <option value="0">None</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-2">
          Language
          <Select value={value.lang} onChange={(e) => set({ lang: e.target.value })} aria-label="Language">
            {LANGS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </label>
        {timeMatters ? (
          <label className="flex flex-col gap-1 text-xs text-fg-2">
            Popular within
            <Select value={value.time} onChange={(e) => set({ time: e.target.value as Filters['time'] })} aria-label="Popular within">
              <option value="">All time</option>
              <option value="day">A day</option>
              <option value="week">A week</option>
              <option value="month">A month</option>
              <option value="year">A year</option>
            </Select>
          </label>
        ) : null}
      </div>
    </div>
  );
}

/** Tag chips: tap to switch include → exclude → off. Suggestions come from the site's own tag list. */
function TagPicker({ provider, include, exclude, onChange }: { provider: string; include: string[]; exclude: string[]; onChange: (include: string[], exclude: string[]) => void }) {
  const [text, setText] = useState('');
  const listId = useId();
  const suggest = useQuery({
    queryKey: ['source-tags', provider, text.trim().toLowerCase()],
    enabled: provider !== 'all' && text.trim().length >= 1,
    queryFn: () => get<Array<{ tag: string; count: number }>>(`/api/sources/${provider}/tags`, { q: text.trim() }),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const add = (t: string, neg = false) => {
    const tag = t.trim().replace(/^-/, '');
    if (!tag) return;
    const negative = neg || t.trim().startsWith('-');
    const inc = include.filter((x) => x.toLowerCase() !== tag.toLowerCase());
    const exc = exclude.filter((x) => x.toLowerCase() !== tag.toLowerCase());
    onChange(negative ? inc : [...inc, tag], negative ? [...exc, tag] : exc);
    setText('');
  };
  const cycle = (t: string) => {
    if (include.includes(t)) onChange(include.filter((x) => x !== t), [...exclude, t]);
    else onChange(include, exclude.filter((x) => x !== t));
  };
  const chips = [...include.map((t) => ({ t, neg: false })), ...exclude.map((t) => ({ t, neg: true }))];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(text);
            }
          }}
          list={listId}
          placeholder="Add a tag (start with - to exclude)"
          aria-label="Add a tag"
        />
        <datalist id={listId}>
          {(suggest.data ?? []).map((s) => (
            <option key={s.tag} value={s.tag}>
              {s.count ? `${s.tag} (${s.count.toLocaleString()})` : s.tag}
            </option>
          ))}
        </datalist>
      </div>
      {chips.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tag filters">
          {chips.map(({ t, neg }) => (
            <li key={`${neg ? '-' : '+'}${t}`} className="flex items-center">
              <button
                type="button"
                onClick={() => cycle(t)}
                className={`pressable flex items-center gap-1 rounded-l-full border px-2.5 py-1 text-xs font-medium ${neg ? 'border-line-strong bg-danger-soft text-danger line-through' : 'border-accent bg-accent-soft text-accent-text'}`}
                aria-label={neg ? `Excluding ${t}; tap to stop filtering` : `Including ${t}; tap to exclude instead`}
              >
                {neg ? <Minus size={12} /> : <Plus size={12} />}
                {t}
              </button>
              <button type="button" onClick={() => onChange(include.filter((x) => x !== t), exclude.filter((x) => x !== t))} className="pressable rounded-r-full border border-l-0 border-line px-1.5 py-1 text-fg-3" aria-label={`Remove ${t}`}>
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
