/**
 * Where clips come from: the bundled and authored ones under /avatar/clips, and the owner's
 * imported ones (registered by id). Loaded on first use and cached.
 */
import { decodeClip, type Clip, type ClipJSON } from './clip';

/** Emote id → the clip that plays it (when the names differ). */
const CLIP_FOR: Record<string, string> = {
  walk_in: 'walk',
  walk_out: 'walk',
  idle_neutral: 'idle',
};

const loaded = new Map<string, Promise<Clip | null>>();
const registered = new Map<string, Clip>();

export function registerClip(id: string, json: ClipJSON) {
  registered.set(id, decodeClip({ ...json, id }));
}

/** Forget a cached clip (after an imported one is replaced or deleted). */
export function forgetClip(id: string) {
  registered.delete(id);
  loaded.delete(id);
}

export function clipIdFor(emote: string): string {
  return CLIP_FOR[emote] ?? emote;
}

export function getClip(id: string): Promise<Clip | null> {
  const r = registered.get(id);
  if (r) return Promise.resolve(r);
  let p = loaded.get(id);
  if (!p) {
    // Built-in clips are static files; the owner's imported ones come from the server.
    p = fetch(`/avatar/clips/${encodeURIComponent(id)}.json`)
      .then((res) => (res.ok ? res : fetch(`/api/avatar-clips/${encodeURIComponent(id)}`, { credentials: 'same-origin' })))
      .then((res) => (res.ok ? (res.json() as Promise<ClipJSON>) : null))
      .then((j) => (j ? decodeClip(j) : null))
      .catch(() => null);
    loaded.set(id, p);
  }
  return p;
}

/** A clip that is already in memory (or null), for code that can't wait. */
export function peekClip(id: string): Clip | null {
  return registered.get(id) ?? null;
}
