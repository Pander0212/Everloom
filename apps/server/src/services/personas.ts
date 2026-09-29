import type { PersonaDTO } from '@everloom/engine';
import { HttpError, type AppContext } from '../context.js';
import { json } from '../db/index.js';
import { newId } from '../security/crypto.js';
import { mediaUrl } from './media.js';

function toDTO(r: any): PersonaDTO {
  return {
    id: r.id,
    name: r.name,
    avatar: mediaUrl(r.avatar),
    description: r.description,
    title: r.title,
    age: r.age,
    ageStage: r.age_stage,
    phone: r.phone,
    isDefault: !!r.is_default,
    data: json(r.data, {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listPersonas(ctx: AppContext, owner: string): PersonaDTO[] {
  return (ctx.db.prepare('SELECT * FROM personas WHERE owner_id = ? ORDER BY is_default DESC, name').all(owner) as any[]).map(toDTO);
}

export function getPersona(ctx: AppContext, owner: string, id: string): PersonaDTO {
  const r = ctx.db.prepare('SELECT * FROM personas WHERE id = ? AND owner_id = ?').get(id, owner);
  if (!r) throw new HttpError(404, 'Persona not found');
  return toDTO(r);
}

export function defaultPersona(ctx: AppContext, owner: string): PersonaDTO | null {
  const r = ctx.db.prepare('SELECT * FROM personas WHERE owner_id = ? ORDER BY is_default DESC, created_at LIMIT 1').get(owner);
  return r ? toDTO(r) : null;
}

export interface PersonaInput {
  name: string;
  description?: string;
  title?: string;
  age?: number | null;
  ageStage?: string;
  phone?: string;
  isDefault?: boolean;
  avatar?: string | null;
  data?: PersonaDTO['data'];
}

export function savePersona(ctx: AppContext, owner: string, input: PersonaInput, id?: string): PersonaDTO {
  const now = Date.now();
  const tx = ctx.db.transaction(() => {
    if (input.isDefault) ctx.db.prepare('UPDATE personas SET is_default = 0 WHERE owner_id = ?').run(owner);
    if (id) {
      const cur = getPersona(ctx, owner, id);
      const avatarId = input.avatar === undefined ? undefined : input.avatar;
      ctx.db
        .prepare('UPDATE personas SET name = ?, description = ?, title = ?, age = ?, age_stage = ?, phone = ?, is_default = ?, data = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
        .run(
          input.name,
          input.description ?? cur.description,
          input.title ?? cur.title,
          input.age === undefined ? cur.age : input.age,
          input.ageStage ?? cur.ageStage,
          input.phone ?? cur.phone,
          input.isDefault === undefined ? (cur.isDefault ? 1 : 0) : input.isDefault ? 1 : 0,
          JSON.stringify({ ...cur.data, ...(input.data ?? {}) }),
          now,
          id,
          owner,
        );
      if (avatarId !== undefined) ctx.db.prepare('UPDATE personas SET avatar = ? WHERE id = ?').run(avatarId, id);
      return id;
    }
    const nid = newId('p_');
    const count = (ctx.db.prepare('SELECT COUNT(*) AS n FROM personas WHERE owner_id = ?').get(owner) as { n: number }).n;
    ctx.db
      .prepare('INSERT INTO personas (id, owner_id, name, avatar, description, title, age, age_stage, phone, data, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(nid, owner, input.name, input.avatar ?? null, input.description ?? '', input.title ?? '', input.age ?? null, input.ageStage ?? '', input.phone ?? '', JSON.stringify(input.data ?? {}), input.isDefault || count === 0 ? 1 : 0, now, now);
    return nid;
  });
  return getPersona(ctx, owner, tx());
}

export function deletePersona(ctx: AppContext, owner: string, id: string) {
  ctx.db.prepare('DELETE FROM personas WHERE id = ? AND owner_id = ?').run(id, owner);
  ctx.db.prepare('UPDATE chats SET persona_id = NULL WHERE persona_id = ? AND owner_id = ?').run(id, owner);
}
