/**
 * Per-device 3D settings: a phone and a desktop want different quality, frame rates and effects,
 * and some devices should simply show sprites. Kept in this browser only.
 */
import { create } from 'zustand';

export type Quality3D = 'low' | 'medium' | 'high' | 'auto';
export interface Prefs3D {
  quality: Quality3D;
  /** Highest frame rate (30 saves battery; 60 is smoother). */
  fpsCap: 30 | 60;
  physics: boolean;
  outlines: boolean;
  /** Show sprites instead of 3D on this device. */
  spritesOnly: boolean;
  /** Characters with no picture (most NPCs) appear as code-made 3D figures. */
  codeNpcs: boolean;
  experimentalProcedural: boolean;
}
const KEY = 'everloom:3d';
const isPhone = () => typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 600;
export const DEFAULT_PREFS_3D = (): Prefs3D => ({ quality: 'auto', fpsCap: isPhone() ? 30 : 60, physics: true, outlines: true, spritesOnly: false, codeNpcs: false, experimentalProcedural: false });

function load(): Prefs3D {
  try {
    return { ...DEFAULT_PREFS_3D(), ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs3D>) };
  } catch {
    return DEFAULT_PREFS_3D();
  }
}

export const usePrefs3D = create<Prefs3D & { set: (patch: Partial<Prefs3D>) => void }>((set, get) => ({
  ...load(),
  set: (patch) => {
    const { set: _s, ...cur } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...cur, ...patch }));
    } catch {
      /* this visit only */
    }
    set(patch);
  },
}));

let webgl2: boolean | null = null;
/** WebGL 2 is available (checked once, without loading any 3D code). */
export function hasWebGL2(): boolean {
  if (webgl2 !== null) return webgl2;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    webgl2 = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webgl2 = false;
  }
  return webgl2;
}

/** Should this device use the lighter model copy? */
export function wantsLowDetail(p: Pick<Prefs3D, 'quality'>): boolean {
  if (p.quality === 'low') return true;
  if (p.quality === 'high') return false;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return Math.min(window.innerWidth, window.innerHeight) < 600 || (mem !== undefined && mem <= 4);
}
