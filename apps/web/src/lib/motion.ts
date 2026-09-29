/** Shared motion tokens. Durations 120–250 ms for UI, up to 400 ms for sheets; transform/opacity only. */
import type { Transition, Variants } from 'motion/react';

export const ease = [0.22, 1, 0.36, 1] as const;

export const t = {
  fast: { duration: 0.14, ease } satisfies Transition,
  base: { duration: 0.2, ease } satisfies Transition,
  slow: { duration: 0.32, ease } satisfies Transition,
  sheet: { type: 'spring', stiffness: 380, damping: 38, mass: 0.9 } satisfies Transition,
  indicator: { type: 'spring', stiffness: 500, damping: 42 } satisfies Transition,
  reward: { type: 'spring', stiffness: 520, damping: 18 } satisfies Transition,
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: t.base },
};

/** Light list stagger: at most 30 ms per item, capped at 8 items. */
export function stagger(index: number): Transition {
  return { ...t.base, delay: Math.min(index, 8) * 0.03 };
}
