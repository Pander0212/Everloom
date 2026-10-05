/**
 * With the vault on, the browser keeps nothing readable: no drafts, searches or names in storage,
 * and everything in memory is dropped when it locks. This module tracks whether that applies.
 */
let on = false;
const listeners = new Set<() => void>();

/** Keys that can hold story or character text. */
const CONTENT_KEYS = ['everloom.studio', 'everloom.library.view', 'everloom.chats.view', 'everloom.helperName', 'everloom:browse-source'];
const CONTENT_PREFIXES = ['everloom:browse:', 'everloom.phone.seen'];

export function setVaultOn(v: boolean) {
  on = v;
  if (v) purgeContentStorage();
}
export const vaultOn = () => on;
const ASK_KEY = 'everloom.askExportPassword';
let askExports = (() => {
  try {
    return localStorage.getItem(ASK_KEY) === '1';
  } catch {
    return false;
  }
})();
/** Whether exports offer a password (a per-device choice in Settings › Privacy; always while the vault is on). */
export const setAskExportPassword = (v: boolean) => {
  askExports = v;
  try {
    localStorage.setItem(ASK_KEY, v ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
};
export const askExportPassword = () => on || askExports;
export const askExportPasswordChoice = () => askExports;
/** Whether a screen may remember content-bearing state on this device. */
export const contentStorageAllowed = () => !on;

export function purgeContentStorage() {
  try {
    for (const k of CONTENT_KEYS) localStorage.removeItem(k);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && CONTENT_PREFIXES.some((p) => k.startsWith(p))) localStorage.removeItem(k);
    }
    sessionStorage.clear();
  } catch {
    /* storage unavailable */
  }
  // Pictures cached by the service worker (only ever cached with the vault off, but clear anyway).
  if (typeof caches !== 'undefined') void caches.delete('media').catch(() => undefined);
}

/** Called when the server says the vault locked (a 423 or the live event). */
export function onVaultLocked(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function notifyVaultLocked() {
  for (const fn of listeners) fn();
}
