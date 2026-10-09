/**
 * Interface scaling, per device: Ctrl/⌘ + plus/minus/0 scales the whole interface (50–200%),
 * Ctrl/⌘ + mouse wheel over the story changes only the story's text size.
 */
import type { Settings } from '@everloom/engine';

const KEY = 'everloom.uiScale';
const SIZES: Settings['textSize'][] = ['small', 'medium', 'large', 'xlarge'];

export function getUiScale(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v >= 0.5 && v <= 2 ? v : 1;
  } catch {
    return 1;
  }
}

export function setUiScale(v: number) {
  const s = Math.round(Math.min(2, Math.max(0.5, v)) * 20) / 20;
  try {
    localStorage.setItem(KEY, String(s));
  } catch {
    /* private mode */
  }
  document.documentElement.style.setProperty('zoom', s === 1 ? '' : String(s));
  document.dispatchEvent(new CustomEvent('everloom:scale', { detail: s }));
  return s;
}

/** Installs the shortcuts; `onTextSize` stores a new story text size. Returns the uninstaller. */
export function installScaling(getText: () => Settings['textSize'], onTextSize: (s: Settings['textSize']) => void) {
  setUiScale(getUiScale());
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === '=' || e.key === '+') setUiScale(getUiScale() + 0.1);
    else if (e.key === '-' || e.key === '_') setUiScale(getUiScale() - 0.1);
    else if (e.key === '0') setUiScale(1);
    else return;
    e.preventDefault();
  };
  const onWheel = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey) || !(e.target as HTMLElement)?.closest?.('.ev-story')) return;
    e.preventDefault();
    const i = SIZES.indexOf(getText());
    const next = SIZES[Math.min(SIZES.length - 1, Math.max(0, i + (e.deltaY < 0 ? 1 : -1)))]!;
    if (next !== getText()) onTextSize(next);
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('wheel', onWheel);
  };
}
