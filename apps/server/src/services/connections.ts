import type { ConnectionDTO } from '@everloom/engine';
import { HttpError, type AppContext } from '../context.js';
import { json } from '../db/index.js';
import type { ResolvedConnection } from '../llm/providers.js';
import { decrypt, encrypt, newId } from '../security/crypto.js';
import { getSettings } from './settings.js';

export const LLM_PROVIDERS = ['openai', 'anthropic', 'gemini', 'textgen'];

function toDTO(r: any): ConnectionDTO {
  return {
    id: r.id,
    name: r.name,
    provider: r.provider,
    baseUrl: r.base_url,
    model: r.model,
    hasKey: !!r.api_key_enc,
    params: json(r.params, {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listConnections(ctx: AppContext, owner: string): ConnectionDTO[] {
  return (ctx.db.prepare('SELECT * FROM connections WHERE owner_id = ? ORDER BY created_at').all(owner) as any[]).map(toDTO);
}

export function getConnection(ctx: AppContext, owner: string, id: string): ConnectionDTO {
  const r = ctx.db.prepare('SELECT * FROM connections WHERE id = ? AND owner_id = ?').get(id, owner);
  if (!r) throw new HttpError(404, 'Connection not found');
  return toDTO(r);
}

export interface ConnectionInput {
  name: string;
  provider: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string | null;
  params?: Record<string, unknown>;
}

export function saveConnection(ctx: AppContext, owner: string, input: ConnectionInput, id?: string): ConnectionDTO {
  const now = Date.now();
  if (id) {
    const existing = ctx.db.prepare('SELECT * FROM connections WHERE id = ? AND owner_id = ?').get(id, owner) as any;
    if (!existing) throw new HttpError(404, 'Connection not found');
    // apiKey: undefined = keep, '' or null = clear, string = replace.
    const keyEnc = input.apiKey === undefined ? existing.api_key_enc : input.apiKey ? encrypt(input.apiKey, ctx.cfg.secretKey) : null;
    ctx.db
      .prepare('UPDATE connections SET name = ?, provider = ?, base_url = ?, model = ?, api_key_enc = ?, params = ?, updated_at = ? WHERE id = ?')
      .run(input.name, input.provider, input.baseUrl ?? '', input.model ?? '', keyEnc, JSON.stringify(input.params ?? {}), now, id);
    return getConnection(ctx, owner, id);
  }
  const newIdv = newId('conn_');
  ctx.db
    .prepare('INSERT INTO connections (id, owner_id, name, provider, base_url, model, api_key_enc, params, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newIdv, owner, input.name, input.provider, input.baseUrl ?? '', input.model ?? '', input.apiKey ? encrypt(input.apiKey, ctx.cfg.secretKey) : null, JSON.stringify(input.params ?? {}), now, now);
  return getConnection(ctx, owner, newIdv);
}

export function deleteConnection(ctx: AppContext, owner: string, id: string) {
  ctx.db.prepare('DELETE FROM connections WHERE id = ? AND owner_id = ?').run(id, owner);
}

export function resolveConnection(ctx: AppContext, owner: string, id: string): ResolvedConnection {
  const r = ctx.db.prepare('SELECT * FROM connections WHERE id = ? AND owner_id = ?').get(id, owner) as any;
  if (!r) throw new HttpError(404, 'Connection not found');
  let apiKey = '';
  if (r.api_key_enc) {
    try {
      apiKey = decrypt(r.api_key_enc, ctx.cfg.secretKey);
    } catch {
      throw new HttpError(500, 'Stored API key could not be decrypted (was EVERLOOM_SECRET_KEY changed?)');
    }
  }
  return { id: r.id, name: r.name, provider: r.provider, baseUrl: r.base_url, model: r.model, apiKey, params: json(r.params, {}) };
}

export type Role = 'main' | 'utility' | 'background' | 'embeddings' | 'tts' | 'image';

/** Resolve a role to a connection. Utility falls back to main; main falls back to the first LLM connection. */
export function connectionForRole(ctx: AppContext, owner: string, role: Role, override?: string | null): ResolvedConnection | null {
  if (override) {
    try {
      return resolveConnection(ctx, owner, override);
    } catch {
      /* fall through */
    }
  }
  const s = getSettings(ctx, owner);
  const pick = (id: string | null) => {
    if (!id) return null;
    try {
      return resolveConnection(ctx, owner, id);
    } catch {
      return null;
    }
  };
  const direct = pick((s.roles as Record<string, string | null>)[role] ?? null);
  if (direct) return direct;
  // Background work (chronicler, consolidation, social sim) uses the utility model unless set.
  if (role === 'background') return connectionForRole(ctx, owner, 'utility');
  if (role === 'utility' || role === 'embeddings') {
    const main = connectionForRole(ctx, owner, 'main');
    if (role === 'embeddings' && main && !['openai', 'gemini', 'textgen'].includes(main.provider)) return null;
    return main;
  }
  if (role === 'main') {
    const first = ctx.db.prepare(`SELECT id FROM connections WHERE owner_id = ? AND provider IN (${LLM_PROVIDERS.map(() => '?').join(',')}) ORDER BY created_at LIMIT 1`).get(owner, ...LLM_PROVIDERS) as { id: string } | undefined;
    return first ? resolveConnection(ctx, owner, first.id) : null;
  }
  return null;
}
