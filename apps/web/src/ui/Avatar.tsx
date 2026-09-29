import { useState } from 'react';
import { cx, initials } from '@/lib/format';

const SIZES = { xs: 'h-6 w-6 text-xs', sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-base', xl: 'h-24 w-24 text-xl' } as const;

export function Avatar({ src, name, size = 'md', shape = 'circle', className }: { src?: string | null; name: string; size?: keyof typeof SIZES; shape?: 'circle' | 'rounded'; className?: string }) {
  const radius = shape === 'circle' ? 'rounded-full' : 'rounded-md';
  // A deleted or missing image falls back to initials.
  const [broken, setBroken] = useState<string | null>(null);
  if (src && broken !== src) return <img src={src} alt="" loading="lazy" onError={() => setBroken(src)} className={cx(SIZES[size], radius, 'flex-none bg-surface-2 object-cover object-top', className)} />;
  return (
    <span aria-hidden="true" className={cx(SIZES[size], radius, 'inline-flex flex-none items-center justify-center bg-surface-3 font-semibold text-fg-2', className)}>
      {initials(name)}
    </span>
  );
}
