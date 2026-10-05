/**
 * Applies the user's custom CSS snippets. Two escape hatches keep a bad snippet from locking
 * anyone out: Settings never gets custom CSS, and `?safe-mode` (or `?safe=1`) turns it all off,
 * scripts and extensions included, for the rest of the browser session (`?safe-mode=0` turns it
 * back on).
 */
import type { CssSnippet } from '@everloom/engine';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { useSettings } from './queries';

const KEY = 'everloom.safe-mode';

/** `?safe-mode` or `?safe=1` (also turns off every script and extension; see scripting/bus.ts). */
export function readSafeMode(search: string): boolean {
  const p = new URLSearchParams(search);
  if (!p.has('safe-mode') && p.has('safe')) p.set('safe-mode', p.get('safe') === '0' ? '0' : '1');
  try {
    if (p.has('safe-mode')) {
      const on = p.get('safe-mode') !== '0';
      if (on) sessionStorage.setItem(KEY, '1');
      else sessionStorage.removeItem(KEY);
      return on;
    }
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return p.has('safe-mode') && p.get('safe-mode') !== '0';
  }
}

export function setSafeMode(on: boolean) {
  try {
    if (on) sessionStorage.setItem(KEY, '1');
    else sessionStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event('everloom:safe-mode'));
}

/** The combined stylesheet: enabled snippets, in list order (later ones win). */
export function snippetsCss(snippets: CssSnippet[]): string {
  return snippets
    .filter((s) => s.enabled && s.css.trim())
    .map((s) => `/* ${s.name.replace(/\*\//g, '')} */\n${s.css}`)
    .join('\n\n');
}

export function CustomCss() {
  const settings = useSettings();
  const { pathname, search } = useLocation();
  const [safe, setSafe] = useState(() => readSafeMode(search));
  useEffect(() => setSafe(readSafeMode(search)), [search]);
  useEffect(() => {
    const on = () => setSafe(readSafeMode(''));
    window.addEventListener('everloom:safe-mode', on);
    return () => window.removeEventListener('everloom:safe-mode', on);
  }, []);
  const css = safe || pathname.startsWith('/settings') ? '' : snippetsCss(settings.data?.css?.snippets ?? []);
  useEffect(() => {
    document.documentElement.toggleAttribute('data-safe-mode', safe);
    let el = document.getElementById('everloom-custom-css') as HTMLStyleElement | null;
    if (!css) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement('style');
      el.id = 'everloom-custom-css';
      document.head.appendChild(el);
    }
    el.textContent = css;
  }, [css, safe]);
  return null;
}
