import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { get } from '@/lib/api';
import { cx } from '@/lib/format';
import { Button, Input, Sheet } from '@/ui';
import { ITEM_ART, itemArtLabel, itemArtUrl } from './itemArt';

interface IconAsset {
  id: string;
  url: string;
  name: string;
}

/**
 * Pick an item's picture: Everloom's bundled pixel art ("art:<key>") or an icon from the asset
 * library ("media:<id>"). "Automatic" goes back to the picture the item's name suggests.
 */
export function IconPicker({ open, onOpenChange, value, onPick, automatic }: { open: boolean; onOpenChange: (o: boolean) => void; value: string; onPick: (icon: string) => void; automatic: string }) {
  const [q, setQ] = useState('');
  const lib = useQuery({ queryKey: ['assets', 'icons'], queryFn: () => get<{ assets: IconAsset[] }>('/api/assets', { type: 'icon' }), enabled: open });
  const bundled = useMemo(() => ITEM_ART.filter((k) => !q || itemArtLabel(k).includes(q.toLowerCase())), [q]);
  const mine = (lib.data?.assets ?? []).filter((a) => !q || a.name.toLowerCase().includes(q.toLowerCase()));
  const tile = (key: string, src: string, label: string, pixel: boolean) => (
    <button
      key={key}
      type="button"
      onClick={() => onPick(key)}
      aria-label={label}
      aria-pressed={value === key}
      title={label}
      className={cx('pressable flex aspect-square items-center justify-center rounded-md border-2 bg-surface-2', value === key ? 'border-accent' : 'border-transparent')}
    >
      <img src={src} alt="" loading="lazy" width={48} height={48} className="h-12 w-12 object-contain" style={pixel ? { imageRendering: 'pixelated' } : undefined} />
    </button>
  );
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Choose a picture" description="Everloom's item pictures, or icons from your asset library" size="md">
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Input aria-label="Search pictures" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button variant="secondary" onClick={() => onPick(automatic)}>
            Automatic
          </Button>
        </div>
        {mine.length ? (
          <section>
            <h3 className="mb-2 text-xs font-medium text-fg-3">Your icons</h3>
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-7">{mine.map((a) => tile(`media:${a.id}`, a.url, a.name, false))}</div>
          </section>
        ) : null}
        <section>
          <h3 className="mb-2 text-xs font-medium text-fg-3">Everloom</h3>
          {bundled.length ? <div className="grid grid-cols-5 gap-2 sm:grid-cols-7">{bundled.map((k) => tile(`art:${k}`, itemArtUrl(k), itemArtLabel(k), true))}</div> : <p className="text-sm text-fg-2">No picture matches.</p>}
        </section>
      </div>
    </Sheet>
  );
}
