import { Icon } from '@/ui';
import { itemIcon } from './icons';

/** Item icon: a drawn image ("media:<id>") or a named line icon. */
export function ItemGlyph({ icon, size = 20, strokeWidth, className }: { icon: string; size?: number; strokeWidth?: number; className?: string }) {
  if (icon?.startsWith('media:')) {
    return <img src={`/media/${icon.slice(6)}`} alt="" width={size} height={size} loading="lazy" className="flex-none rounded-sm object-cover" style={{ width: size, height: size }} />;
  }
  return <Icon icon={itemIcon(icon)} size={size} strokeWidth={strokeWidth} className={className} />;
}
