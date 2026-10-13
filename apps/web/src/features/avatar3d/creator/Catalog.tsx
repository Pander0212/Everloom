import { useState } from 'react';
import { Star } from 'lucide-react';
import { HAIR_PRESETS, CLOTHING_TEMPLATES } from '@everloom/engine';
import { Button, Input, Select } from '@/ui';
import { usePrefs3D } from '@/features/avatars/prefs';

const hairItems = HAIR_PRESETS.map(p => ({ id: p.id, label: p.label, tags: [...new Set(Object.values(p.hair).filter((s): s is string => typeof s === 'string' && s !== 'none'))] }));
const clothingItems = CLOTHING_TEMPLATES.map(p => ({ id: p.id, label: p.label, tags: [p.kind] }));

/** Browses installed procedural parts; thumbnails are rendered from these same recipes. */
export function CreatorCatalog({ kind, choose, disabled = false }: { kind: 'hair' | 'clothes'; choose: (id: string) => void; disabled?: boolean }) {
  const [search, setSearch] = useState(''), [tag, setTag] = useState(''), [onlyFavorites, setOnlyFavorites] = useState(false);
  const prefs = usePrefs3D();
  const favorites = Array.isArray(prefs.creatorFavorites) ? prefs.creatorFavorites : [];
  const items = kind === 'hair' ? hairItems : clothingItems;
  const tags = [...new Set(items.flatMap(i => i.tags))].sort();
  const shown = items.filter(i => (!tag || i.tags.includes(tag)) && (!onlyFavorites || favorites.includes(`${kind}:${i.id}`)) && search.toLowerCase().trim().split(/\s+/).every(q => `${i.label} ${i.tags.join(' ')}`.toLowerCase().includes(q)));
  const title = kind === 'hair' ? 'hairstyles' : 'clothing';
  return <details className="rounded-lg border border-line p-3" data-testid={`creator-catalog-${kind}`}>
    <summary>Browse {title}</summary>
    <div className="mt-3 flex flex-col gap-3">
      <Input aria-label={`Search ${title}`} placeholder={`Search ${title}…`} value={search} onChange={e => setSearch(e.target.value)} />
      <Select aria-label={`Filter ${title} by tag`} value={tag} onChange={e => setTag(e.target.value)}><option value="">All tags</option>{tags.map(t => <option key={t} value={t}>{t}</option>)}</Select>
      <Button variant="secondary" aria-pressed={onlyFavorites} onClick={() => setOnlyFavorites(v => !v)}>Favourites only</Button>
      <p className="text-xs text-fg-2">{shown.length} parts. Favourites are kept on this device.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {shown.map(item => {
          const id = `${kind}:${item.id}`, favorite = favorites.includes(id);
          return <div key={id} className="min-w-0 rounded-md border border-line p-2">
            <button type="button" className="w-full text-left disabled:opacity-50" aria-label={`${kind === 'hair' ? 'Use' : 'Add'} ${item.label}`} disabled={disabled} onClick={() => choose(item.id)}>
              <img className="aspect-square w-full rounded bg-surface-2 object-cover" src={`/avatar/creator-thumbnails/${kind}/${item.id}.png`} alt="" loading="lazy" width={192} height={192} />
              <span className="mt-1 block text-sm">{item.label}</span>
            </button>
            <button type="button" className="mt-1 flex min-h-11 w-full items-center gap-2 text-xs" aria-label={`Favourite ${item.label}`} aria-pressed={favorite} onClick={() => prefs.set({ creatorFavorites: favorite ? favorites.filter(f => f !== id) : [...favorites, id] })}><Star size={16} fill={favorite ? 'currentColor' : 'none'} />{favorite ? 'Favourite' : 'Save favourite'}</button>
          </div>;
        })}
      </div>
      {!shown.length ? <p className="text-sm text-fg-2">No parts match these filters.</p> : null}
    </div>
  </details>;
}
