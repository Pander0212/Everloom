/**
 * Recovery after an update. A tab (or an installed app) still running the previous build asks for
 * script files that no longer exist; instead of hanging, reload once to pick up the new build. If
 * that doesn't help, the person can reset the offline copy of the app (their data is on the server).
 */
const KEY = 'everloom.reloaded-at';

/** Reloads, unless we already did in the last 30 seconds (then returns false: stop and show the error). */
export function reloadOnce(): boolean {
  try {
    if (Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < 30_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* no storage: reload anyway */
  }
  location.reload();
  return true;
}

/** Drops the service worker and every cached file, then reloads from the server. */
export async function resetApp() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    /* not supported */
  }
  try {
    for (const k of await caches.keys()) await caches.delete(k);
  } catch {
    /* not supported */
  }
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  location.reload();
}

export function installRecovery() {
  // Vite fires this when a lazily loaded part of the app fails to download.
  window.addEventListener('vite:preloadError', (e) => {
    if (reloadOnce()) e.preventDefault();
  });
}
