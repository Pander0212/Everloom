/** In-memory handoff between import and wardrobe; source assets already live in the private library. */
const pending = new Map<string, File>();
export function queueUnityFit(avatar: string, file: File) { pending.clear(); pending.set(avatar, file); window.dispatchEvent(new Event('everloom-unity-fit')); }
export function takeUnityFit(avatar: string) { const file = pending.get(avatar); pending.delete(avatar); return file; }
