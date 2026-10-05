import { Icon } from '@/ui';
import { useSettings } from '@/lib/queries';
import { itemIcon } from './icons';
import { itemArtFor, itemArtUrl } from './itemArt';

/**
 * Item icon: the owner's own picture ("media:<id>"), else Everloom's pixel-art picture for the
 * item (by name, then icon key; see itemArt.ts) unless illustrations are off, else the line icon.
 */
export function ItemGlyph({ icon, name, size = 20, strokeWidth, className }: { icon: string; name?: string; size?: number; strokeWidth?: number; className?: string }) {
  const settings = useSettings();
  if (icon?.startsWith('media:')) {
    return <img src={`/media/${icon.slice(6)}`} alt="" width={size} height={size} loading="lazy" className="flex-none rounded-sm object-cover" style={{ width: size, height: size }} />;
  }
  const art = settings.data?.art?.enabled !== false ? itemArtFor(icon, name) : null;
  if (art) {
    // 32×32 pixel art: crisp at whole multiples, smooth below the native size.
    return <img src={itemArtUrl(art)} alt="" width={size} height={size} loading="lazy" decoding="async" className="flex-none" style={{ width: size, height: size, imageRendering: size >= 32 ? 'pixelated' : 'auto' }} />;
  }
  return <Icon icon={itemIcon(icon?.startsWith('art:') ? 'package' : icon)} size={size} strokeWidth={strokeWidth} className={className} />;
}
