import { DEFAULT_WI_SETTINGS, defaultFeatureSettings, defaultShieldSettings, makeStandin, FEATURE_PRESETS, normalizeFeatures, presetFeatures, presetOf, WORLD_PROFILES, type FeaturePreset, type Settings } from '@everloom/engine';
import type { AppContext } from '../context.js';
import { sanitizeCss } from '../util/css.js';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  motion: 'full',
  textSize: 'medium',
  palette: 'amber',
  genreTheme: true,
  audio: { music: false, ambient: false, musicVolume: 0.5, ambientVolume: 0.35, crossfadeMs: 2500, playlists: [], ambientFiles: {} },
  stage: { bubbles: false, live2d: false },
  roles: { main: null, utility: null, background: null, embeddings: null, tts: null, image: null },
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
  css: { snippets: [] },
  studio: { presets: [], preset: 'balanced', connection: null },
  library: { view: 'grid', presets: [], defaultPreset: null, versionRetention: 30, debug: false, prevNext: true, cardInfo: true, nsfw: false },
  world: { profile: 'balanced', recallLimit: 6, sceneBudget: 1100, ...WORLD_PROFILES.balanced },
  // Existing installs keep everything on; first-run setup offers the presets.
  features: defaultFeatureSettings(),
  privacy: { shield: defaultShieldSettings() },
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

function storedSettings(ctx: AppContext, owner: string): Record<string, unknown> {
  const row = ctx.db.prepare("SELECT value FROM settings WHERE owner_id = ? AND key = 'app'").get(owner) as { value: string } | undefined;
  try {
    return row ? JSON.parse(row.value) : {};
  } catch {
    return {};
  }
}

/** Defaults deep-merged with only what the user changed, so a new default reaches everyone who never touched it. */
export function getSettings(ctx: AppContext, owner: string): Settings {
  return merge(DEFAULT_SETTINGS, storedSettings(ctx, owner));
}

export function updateSettings(ctx: AppContext, owner: string, patch: Partial<Settings>): Settings {
  const p: any = patch ? { ...patch } : {};
  // Choosing a profile sets all of its switches at once.
  const profile = p.world?.profile;
  if (profile && profile !== 'custom' && WORLD_PROFILES[profile as keyof typeof WORLD_PROFILES]) p.world = { ...p.world, ...WORLD_PROFILES[profile as keyof typeof WORLD_PROFILES], profile };
  // Flipping a single switch makes the setup custom.
  else if (!profile && p.world && Object.keys(p.world).some((k) => k in WORLD_PROFILES.balanced)) p.world = { ...p.world, profile: 'custom' };
  // Features: a preset sets every switch; switches set by hand are made consistent (dependencies)
  // and the preset becomes whichever one they now equal, or "custom".
  if (p.features) {
    const pre = p.features.preset as FeaturePreset | 'custom' | undefined;
    if (pre && pre !== 'custom' && FEATURE_PRESETS.includes(pre)) p.features = { preset: pre, set: presetFeatures(pre) };
    else if (p.features.set) {
      const current = getSettings(ctx, owner).features.set;
      const set = normalizeFeatures({ on: { ...current.on, ...(p.features.set.on ?? {}) }, memory: p.features.set.memory ?? current.memory });
      p.features = { preset: presetOf(set), set };
    } else delete p.features;
  }
  // Name shield terms: cleaned, and no two real names may share a stand-in.
  if (Array.isArray(p.privacy?.shield?.terms)) {
    const seen = new Set<string>();
    const kinds = ['first', 'last', 'full', 'place', 'other'];
    p.privacy = {
      ...p.privacy,
      shield: {
        ...p.privacy.shield,
        terms: p.privacy.shield.terms.slice(0, 200).map((t: any, i: number) => {
          const kind = kinds.includes(t?.kind) ? t.kind : 'full';
          const real = String(t?.real ?? '').trim().slice(0, 120);
          let standin = String(t?.standin ?? '').trim().slice(0, 120) || makeStandin(kind, real || String(i));
          if (seen.has(standin.toLowerCase())) standin = makeStandin(kind, `${real}:${i}`, [...seen]);
          seen.add(standin.toLowerCase());
          const sc = t?.scope;
          const scope = sc && ['persona', 'character', 'chat'].includes(sc.type) && typeof sc.id === 'string' ? { type: sc.type, id: sc.id.slice(0, 80) } : { type: 'all' };
          return { id: String(t?.id || `t${Date.now().toString(36)}${i}`).slice(0, 40), real, standin, kind, forms: (Array.isArray(t?.forms) ? t.forms : []).map((f: unknown) => String(f).trim().slice(0, 120)).filter(Boolean).slice(0, 20), scope, enabled: t?.enabled !== false };
        }),
      },
    };
  }
  // Custom CSS is cleaned on the way in, whoever wrote it.
  if (Array.isArray(p.css?.snippets))
    p.css = { ...p.css, snippets: p.css.snippets.slice(0, 100).map((x: any) => ({ id: String(x?.id ?? '').slice(0, 40), name: String(x?.name ?? 'Snippet').slice(0, 80), css: sanitizeCss(String(x?.css ?? '')), enabled: x?.enabled !== false })) };
  const next = merge(storedSettings(ctx, owner), p);
  ctx.db
    .prepare("INSERT INTO settings (owner_id, key, value) VALUES (?, 'app', ?) ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value")
    .run(owner, JSON.stringify(next));
  return merge(DEFAULT_SETTINGS, next);
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
