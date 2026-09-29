import { DEFAULT_PRESET, type PresetDTO, type PromptPreset } from '@everloom/engine';
import { HttpError, type AppContext } from '../context.js';
import { json } from '../db/index.js';
import { newId } from '../security/crypto.js';
import { getSettings } from './settings.js';

function toDTO(r: any): PresetDTO {
  const preset = json<PromptPreset>(r.data, DEFAULT_PRESET);
  return { id: r.id, name: r.name, kind: 'prompt', preset: { ...DEFAULT_PRESET, ...preset, formats: { ...DEFAULT_PRESET.formats, ...(preset.formats ?? {}) }, name: r.name }, updatedAt: r.updated_at };
}

export function listPresets(ctx: AppContext, owner: string): PresetDTO[] {
  return (ctx.db.prepare("SELECT * FROM presets WHERE owner_id = ? AND kind = 'prompt' ORDER BY name").all(owner) as any[]).map(toDTO);
}

export function getPreset(ctx: AppContext, owner: string, id: string): PresetDTO {
  const r = ctx.db.prepare('SELECT * FROM presets WHERE id = ? AND owner_id = ?').get(id, owner);
  if (!r) throw new HttpError(404, 'Preset not found');
  return toDTO(r);
}

export function savePreset(ctx: AppContext, owner: string, name: string, preset: PromptPreset, id?: string): PresetDTO {
  const now = Date.now();
  if (id) {
    getPreset(ctx, owner, id);
    ctx.db.prepare('UPDATE presets SET name = ?, data = ?, updated_at = ? WHERE id = ? AND owner_id = ?').run(name, JSON.stringify({ ...preset, name }), now, id, owner);
    return getPreset(ctx, owner, id);
  }
  const nid = newId('pr_');
  ctx.db.prepare("INSERT INTO presets (id, owner_id, name, kind, data, created_at, updated_at) VALUES (?, ?, ?, 'prompt', ?, ?, ?)").run(nid, owner, name, JSON.stringify({ ...preset, name }), now, now);
  return getPreset(ctx, owner, nid);
}

export function deletePreset(ctx: AppContext, owner: string, id: string) {
  ctx.db.prepare('DELETE FROM presets WHERE id = ? AND owner_id = ?').run(id, owner);
}

export function activePreset(ctx: AppContext, owner: string, override?: string | null): PromptPreset {
  const id = override ?? getSettings(ctx, owner).activePresetId;
  if (id) {
    try {
      return getPreset(ctx, owner, id).preset;
    } catch {
      /* fall back */
    }
  }
  return DEFAULT_PRESET;
}
