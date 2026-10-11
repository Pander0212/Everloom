import type { CharacterSummary } from '@everloom/engine';
import { Check, MessageSquare, Star } from 'lucide-react';
import { memo } from 'react';
import { cx } from '@/lib/format';
import { useBlurAdult } from '@/lib/queries';
import { Avatar, Icon } from '@/ui';
import { useLongPress } from './useLongPress';

export const CARD_TEXT_H = 46;

function tokensLabel(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k tokens` : `${n} tokens`;
}

export interface CardProps {
  c: CharacterSummary;
  mode: 'grid' | 'list';
  selecting: boolean;
  selected: boolean;
  showInfo: boolean;
  onOpen: (c: CharacterSummary) => void;
  onToggle: (c: CharacterSummary) => void;
  onMenu: (c: CharacterSummary, at: { clientX: number; clientY: number }) => void;
}

export const LibraryCard = memo(function LibraryCard({ c, mode, selecting, selected, showInfo, onOpen, onToggle, onMenu }: CardProps) {
  const blurAdult = useBlurAdult();
  const lp = useLongPress((at) => onMenu(c, at));
  const name = c.displayName || c.name;
  const click = () => {
    if (lp.swallowClick()) return;
    if (selecting) onToggle(c);
    else onOpen(c);
  };
  const common = {
    type: 'button' as const,
    onClick: click,
    onPointerDown: lp.onPointerDown,
    onPointerMove: lp.onPointerMove,
    onPointerUp: lp.onPointerUp,
    onPointerCancel: lp.onPointerCancel,
    onPointerLeave: lp.onPointerLeave,
    onContextMenu: lp.onContextMenu,
    'aria-pressed': selecting ? selected : undefined,
    'aria-label': `${name}${c.displayName ? ` (${c.name})` : ''}${c.fav ? ', favorite' : ''}${selecting ? (selected ? ', selected' : ', not selected') : ''}`,
  };
  const check = selecting ? (
    <span className={cx('absolute left-2 top-2 flex size-6 items-center justify-center rounded-full border-2', selected ? 'border-accent bg-accent text-accent-fg' : 'border-white/80 bg-black/20')}>
      {selected ? <Icon icon={Check} size={14} strokeWidth={2.5} /> : null}
    </span>
  ) : null;

  if (mode === 'list')
    return (
      <button {...common} className={cx('ev-card pressable flex h-full w-full select-none items-center gap-3 rounded-md px-2 text-left hover:bg-surface-2', selected && 'bg-accent-soft')}>
        <span className="relative flex-none">
          <Avatar src={c.avatar} name={name} size="md" shape="rounded" className={c.adult && blurAdult ? 'blur-lg' : undefined} />
          {selecting ? <span className="absolute -left-1 -top-1 scale-75">{check}</span> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-medium text-fg">{name}</span>
            {c.fav ? <Icon icon={Star} size={13} className="flex-none fill-current text-accent" /> : null}
          </span>
          <span className="block truncate text-xs text-fg-2">{[c.creator && `by ${c.creator}`, c.tags.slice(0, 3).join(', ')].filter(Boolean).join(' · ') || 'No tags'}</span>
        </span>
        <span className="hidden flex-none text-right text-xs text-fg-3 sm:block">
          {tokensLabel(c.tokens)}
          <br />
          {c.chatCount ? `${c.chatCount} chat${c.chatCount > 1 ? 's' : ''}` : ''}
        </span>
      </button>
    );

  return (
    <button {...common} className="ev-card pressable group flex h-full w-full select-none flex-col text-left [-webkit-touch-callout:none]">
      <span className={cx('relative block w-full flex-1 overflow-hidden rounded-md bg-surface-2 transition-[box-shadow] duration-150', selected && 'ring-2 ring-accent ring-offset-2 ring-offset-bg')}>
        {c.avatar ? <img src={c.avatar} alt="" loading="lazy" decoding="async" draggable={false} className={cx('h-full w-full object-cover object-top motion-safe:transition-transform motion-safe:duration-300 group-hover:scale-[1.02]', c.adult && blurAdult && 'blur-lg')} /> : <Avatar name={name} size="xl" shape="rounded" className="absolute inset-0 m-auto" />}
        {c.fav ? <Icon icon={Star} size={16} className="absolute right-2 top-2 fill-current text-accent drop-shadow" /> : null}
        {check}
        {showInfo && !selecting ? (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/80 via-black/55 to-transparent px-2.5 pb-2 pt-8 text-xs text-white opacity-0 motion-safe:transition-all motion-safe:duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
            {c.creator ? <span className="block truncate">by {c.creator}</span> : null}
            <span className="block truncate opacity-90">
              {tokensLabel(c.tokens)}
              {c.chatCount ? ` · ${c.chatCount} chat${c.chatCount > 1 ? 's' : ''}` : ''}
            </span>
            {c.tags.length ? <span className="mt-0.5 block truncate opacity-80">{c.tags.slice(0, 4).join(' · ')}</span> : null}
          </span>
        ) : null}
      </span>
      <span className="mt-2 block truncate text-sm font-medium text-fg">{name}</span>
      <span className="flex items-center gap-1 truncate text-xs text-fg-2">
        {c.chatCount ? (
          <>
            <Icon icon={MessageSquare} size={12} /> {c.chatCount}
          </>
        ) : null}
        <span className="truncate">{c.chatCount ? '' : c.tags.slice(0, 2).join(', ') || c.creator || 'No chats yet'}</span>
      </span>
    </button>
  );
});
