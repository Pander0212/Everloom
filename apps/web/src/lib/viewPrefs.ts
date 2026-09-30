/**
 * Per-device view preferences: what the story view shows, cinematic mode, and where floating tool
 * panels sit on a desktop. Kept in this browser only (a phone and a desktop want different things).
 */
import { create } from 'zustand';

export interface PanelPos {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface ViewPrefs {
  hud: boolean;
  chips: boolean;
  avatars: boolean;
  /** Tools that open as floating panels on desktop, and where. */
  floating: Record<string, PanelPos>;
}
const KEY = 'everloom:view';
const DEFAULTS: ViewPrefs = { hud: true, chips: true, avatars: true, floating: {} };

function load(): ViewPrefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ViewPrefs>) };
  } catch {
    return DEFAULTS;
  }
}

function apply(p: ViewPrefs) {
  const d = document.documentElement.dataset;
  const flag = (k: 'hideHud' | 'hideChips' | 'hideAvatars', on: boolean) => (on ? (d[k] = '') : delete d[k]);
  flag('hideHud', !p.hud);
  flag('hideChips', !p.chips);
  flag('hideAvatars', !p.avatars);
}

export const useViewPrefs = create<ViewPrefs & { set: (patch: Partial<ViewPrefs>) => void }>((set, get) => {
  const initial = load();
  if (typeof document !== 'undefined') apply(initial);
  return {
    ...initial,
    set: (patch) => {
      const { set: _s, ...cur } = get();
      const next = { ...cur, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* remembered for this visit only */
      }
      apply(next);
      set(patch);
    },
  };
});
