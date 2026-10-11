import { useSyncExternalStore } from 'react';
import type { Settings } from '@everloom/engine';
import { FONTS, look, looksCss, schemeFor, tokensOf } from '@/themes/looks';
import '@/themes/fonts';
import '@/themes/interactions.css';

/**
 * What the page looks like: light or dark, the theme ("look") and the reading settings. The look in
 * force is, in order: this world's (a chat's own theme, unless this device ignores world themes),
 * this device's override, then the account's (Settings › Appearance & themes).
 */
const state = {
  mode: 'system' as Settings['theme'],
  palette: 'amber' as Settings['palette'],
  account: 'everloom',
  device: null as string | null,
  world: null as string | null,
  worlds: true,
};

function save(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

let styled = false;
function ensureStyles() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const el = document.createElement('style');
  el.id = 'ev-looks';
  el.textContent = looksCss();
  document.head.appendChild(el);
}

/** The look in force right now. */
export function currentLook() {
  return look((state.worlds && state.world) || state.device || state.account);
}

function render() {
  ensureStyles();
  const root = document.documentElement;
  const l = currentLook();
  const wantDark = state.mode === 'dark' || (state.mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const scheme = schemeFor(l, wantDark ? 'dark' : 'light');
  root.dataset.theme = scheme;
  root.dataset.look = l.id;
  // The accent palettes belong to the Everloom look.
  if (l.id === 'everloom' && state.palette && state.palette !== 'amber') root.dataset.palette = state.palette;
  else delete root.dataset.palette;
  const bg = tokensOf(l, scheme).bg;
  // Painted before the stylesheet loads next time (public/theme-init.js).
  save('everloom.lookBoot', JSON.stringify({ look: l.id, scheme, bg }));
  root.style.removeProperty('background-color');
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
  document.dispatchEvent(new CustomEvent('everloom:look', { detail: l.id }));
}

export function applyTheme(theme: Settings['theme']) {
  state.mode = theme;
  save('everloom.theme', theme);
  render();
}

export function applyPalette(palette: Settings['palette'] | undefined) {
  state.palette = palette ?? 'amber';
  save('everloom.palette', state.palette);
  render();
}

/** The account's theme, this device's override (null: none), and whether world themes apply here. */
export function applyLooks(o: { account?: string; device?: string | null; worlds?: boolean }) {
  if (o.account !== undefined) state.account = o.account;
  if (o.device !== undefined) state.device = o.device;
  if (o.worlds !== undefined) state.worlds = o.worlds;
  render();
}

/** A chat's own theme while it is open (null when it closes). */
export function applyWorldLook(id: string | null) {
  if (state.world === id) return;
  state.world = id;
  render();
}

export function applyMotion(motion: Settings['motion']) {
  save('everloom.motion', motion);
  if (motion === 'reduced') document.documentElement.dataset.motion = 'reduced';
  else delete document.documentElement.dataset.motion;
}

export function applyTextSize(size: Settings['textSize']) {
  save('everloom.textSize', size);
  document.documentElement.dataset.textSize = size;
}

/** Reading settings, as variables on the page (a font chosen here beats the theme's). */
export function applyReading(r: Settings['look']['reading'] | undefined) {
  const s = document.documentElement.style;
  if (!r) return;
  s.setProperty('--story-leading', String(r.leading));
  s.setProperty('--story-width', `${r.width}px`);
  s.setProperty('--story-paragraph', `${r.paragraph}em`);
  const story = FONTS.find((f) => f.id === r.storyFont);
  const ui = FONTS.find((f) => f.id === r.uiFont);
  if (story) s.setProperty('--font-story', story.css);
  else s.removeProperty('--font-story');
  if (ui) s.setProperty('--font-ui', ui.css);
  else s.removeProperty('--font-ui');
}

export function watchSystemTheme(get: () => Settings['theme']) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const fn = () => get() === 'system' && applyTheme('system');
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
}

const lookSubs = new Set<() => void>();
if (typeof document !== 'undefined') document.addEventListener('everloom:look', () => lookSubs.forEach((f) => f()));
/** The id of the look in force, kept up to date. */
export function useLookId(): string {
  return useSyncExternalStore(
    (f) => {
      lookSubs.add(f);
      return () => lookSubs.delete(f);
    },
    () => currentLook().id,
    () => 'everloom',
  );
}
