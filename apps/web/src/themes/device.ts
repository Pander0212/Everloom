/** This device's own theme choices (kept in this browser only): a theme override, scenery, world themes. */
import { useSyncExternalStore } from 'react';

export interface DeviceLook {
  /** A theme for this device, over the account's; null follows the account. */
  id: string | null;
  /** Scenery on this device; null follows the account. */
  scenery: 'animated' | 'still' | 'off' | null;
  /** Whether a world's own theme applies on this device. */
  worlds: boolean;
}

const KEY = 'everloom.deviceLook';
const DEFAULT: DeviceLook = { id: null, scenery: null, worlds: true };
let cache: DeviceLook | null = null;
const subs = new Set<() => void>();

export function getDeviceLook(): DeviceLook {
  if (cache) return cache;
  try {
    cache = { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    cache = DEFAULT;
  }
  return cache!;
}

export function setDeviceLook(p: Partial<DeviceLook>) {
  cache = { ...getDeviceLook(), ...p };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* private mode: for this visit only */
  }
  subs.forEach((f) => f());
}

export function useDeviceLook(): DeviceLook {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    getDeviceLook,
    getDeviceLook,
  );
}
