/**
 * The browser bridge: a userscript (or a bookmarklet) running in the player's own browser sends the
 * card they are looking at to Everloom. It exists for sites the server must not fetch (bot
 * protection, robots.txt). The server never visits those sites; it only receives what the page
 * showed the player. Hidden definitions stay hidden: the extension sends only public fields and
 * says so, and the card is labelled.
 *
 * Each device gets its own token (only a hash is stored), which can be revoked on its own.
 */
import { z } from 'zod';
import { emptyCardData, type CardData } from '@everloom/engine';
import { HttpError, type AppContext } from '../context.js';
import { newId, randomToken, sha256 } from '../security/crypto.js';
import { getCharacter, importCard } from './characters.js';
import { saveImage } from './media.js';
import { getSettings } from './settings.js';

export interface BridgeDevice {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export function listDevices(ctx: AppContext, owner: string): BridgeDevice[] {
  return (ctx.db.prepare('SELECT id, label, created_at, last_used_at FROM bridge_devices WHERE owner_id = ? ORDER BY created_at').all(owner) as any[]).map((r) => ({ id: r.id, label: r.label, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
}

/** A new device token. It is shown once; only its hash is kept. */
export function addDevice(ctx: AppContext, owner: string, label: string): { device: BridgeDevice; token: string } {
  if ((ctx.db.prepare('SELECT COUNT(*) AS n FROM bridge_devices WHERE owner_id = ?').get(owner) as { n: number }).n >= 20) throw new HttpError(400, 'Up to 20 devices; remove one first');
  const token = `evb_${randomToken(32)}`;
  const id = newId('bd_');
  const now = Date.now();
  ctx.db.prepare('INSERT INTO bridge_devices (id, owner_id, label, token_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(id, owner, label, sha256(token), now);
  return { device: { id, label, createdAt: now, lastUsedAt: null }, token };
}

export function removeDevice(ctx: AppContext, owner: string, id: string) {
  ctx.db.prepare('DELETE FROM bridge_devices WHERE id = ? AND owner_id = ?').run(id, owner);
}

/** The owner a bearer token belongs to, or null. */
export function ownerForToken(ctx: AppContext, header: string | undefined): string | null {
  const m = /^Bearer\s+(evb_[A-Za-z0-9_-]{20,})$/.exec(String(header ?? '').trim());
  if (!m) return null;
  const row = ctx.db.prepare('SELECT id, owner_id FROM bridge_devices WHERE token_hash = ?').get(sha256(m[1]!)) as { id: string; owner_id: string } | undefined;
  if (!row) return null;
  ctx.db.prepare('UPDATE bridge_devices SET last_used_at = ? WHERE id = ?').run(Date.now(), row.id);
  return row.owner_id;
}

const text = (max: number) => z.string().max(max).default('');
export const bridgePayload = z.object({
  /** The page the card came from. */
  page: z.string().url().max(2000),
  site: z.string().max(40).default(''),
  /** A card file the browser downloaded from the page (PNG, JSON or CHARX), base64. */
  file: z.object({ name: z.string().max(200).default('card'), data: z.string().max(28_000_000) }).optional(),
  /** Or the fields the page shows. */
  card: z
    .object({
      name: z.string().trim().min(1).max(200),
      description: text(60_000),
      personality: text(30_000),
      scenario: text(30_000),
      first_mes: text(30_000),
      mes_example: text(60_000),
      creator_notes: text(30_000),
      system_prompt: text(20_000),
      alternate_greetings: z.array(z.string().max(30_000)).max(50).default([]),
      tags: z.array(z.string().max(60)).max(60).default([]),
      creator: text(200),
    })
    .optional(),
  /** The page said the definition is hidden; only public fields were sent. */
  hidden: z.boolean().default(false),
  nsfw: z.boolean().default(false),
  avatar: z.string().max(12_000_000).optional(),
});
export type BridgePayload = z.infer<typeof bridgePayload>;

function b64(data: string): Buffer {
  return Buffer.from(data.replace(/^data:[^;,]+;base64,/, ''), 'base64');
}

export async function bridgeImport(ctx: AppContext, owner: string, p: BridgePayload) {
  if (p.nsfw && getSettings(ctx, owner).library.nsfw !== true) throw new HttpError(403, 'This character is marked adult. Turn on adult content in Settings → Characters to import it.');
  let created;
  if (p.file) {
    created = await importCard(ctx, owner, b64(p.file.data));
  } else if (p.card) {
    const c = p.card;
    const card: CardData = {
      ...emptyCardData(c.name),
      ...c,
      tags: c.tags.filter((t) => !/^(nsfw|sfw)$/i.test(t)),
      extensions: { source_url: p.page, ...(p.hidden ? { definition_hidden: true } : {}) },
    };
    if (p.hidden) {
      // Belt and braces: whatever arrives, a hidden card keeps only its public profile.
      Object.assign(card, { description: '', personality: '', scenario: '', mes_example: '', system_prompt: '' });
    }
    created = await importCard(ctx, owner, Buffer.from(JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: card })));
  } else throw new HttpError(400, 'Nothing to import: send a card file or the card fields');
  if (p.avatar && !p.file) {
    try {
      const img = await saveImage(ctx, owner, b64(p.avatar), { kind: 'avatar', maxDim: 1536, meta: { source: p.page } });
      ctx.db.prepare('UPDATE characters SET avatar = ? WHERE id = ?').run(img.id, created.id);
    } catch {
      /* the card works without its picture */
    }
  }
  return getCharacter(ctx, owner, created.id);
}
