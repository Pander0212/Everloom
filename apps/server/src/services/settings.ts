import { DEFAULT_WI_SETTINGS, type Settings } from '@everloom/engine';
import type { AppContext } from '../context.js';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  motion: 'full',
  textSize: 'medium',
  roles: { main: null, utility: null, embeddings: null, tts: null, image: null },
  activePresetId: null,
  defaultPersonaId: null,
  tracker: { mode: 'separate', injectBudget: 600, injectState: true },
  hud: { pinned: ['time', 'weather', 'location', 'hp', 'hunger', 'energy'] },
  wi: { ...DEFAULT_WI_SETTINGS, semantic: false, semanticTopK: 4, semanticThreshold: 0.35 },
  memory: { auto: true, every: 24, maxWords: 250 },
  chat: { enterToSend: false, showReasoning: true, autoTts: false, defaultMode: 'chat', stt: true },
  tts: { provider: 'browser', narratorVoice: '', rate: 1, pitch: 1 },
  images: { autoBackground: false, style: 'painterly illustration, soft light' },
  backups: { nightly: true, retention: 14, hour: 4 },
  helper: { visible: true, name: 'Pip' },
  atmosphere: { enabled: true, particles: true },
};

function merge<T>(base: T, patch: any): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return (patch === undefined ? base : patch) as T;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const [k, v] of Object.entries(patch)) {
    const b = (base as any)?.[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object' && !Array.isArray(v) ? merge(b, v) : v;
  }
  return out;
}

export function getSettings(ctx: AppContext, owner: string): Settings {
  const row = ctx.db.prepare("SELECT value FROM settings WHERE owner_id = ? AND key = 'app'").get(owner) as { value: string } | undefined;
  let stored = {};
  try {
    stored = row ? JSON.parse(row.value) : {};
  } catch {
    stored = {};
  }
  return merge(DEFAULT_SETTINGS, stored);
}

export function updateSettings(ctx: AppContext, owner: string, patch: Partial<Settings>): Settings {
  const next = merge(getSettings(ctx, owner), patch);
  ctx.db
    .prepare("INSERT INTO settings (owner_id, key, value) VALUES (?, 'app', ?) ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value")
    .run(owner, JSON.stringify(next));
  return next;
}

export function getKv<T>(ctx: AppContext, owner: string, key: string, fallback: T): T {
  const row = ctx.db.prepare('SELECT value FROM settings WHERE owner_id = ? AND key = ?').get(owner, key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setKv(ctx: AppContext, owner: string, key: string, value: unknown) {
  ctx.db
    .prepare('INSERT INTO settings (owner_id, key, value) VALUES (?, ?, ?) ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value')
    .run(owner, key, JSON.stringify(value));
}
