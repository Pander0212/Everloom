import type { LucideIcon, LucideProps } from 'lucide-react';

/** One icon style everywhere: outline, 20 px, 1.5 px stroke. */
export function Icon({ icon: I, size = 20, strokeWidth = 1.5, ...rest }: { icon: LucideIcon } & LucideProps) {
  return <I size={size} strokeWidth={strokeWidth} aria-hidden="true" {...rest} />;
}
