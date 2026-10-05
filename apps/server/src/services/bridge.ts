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
import { emptyCardData, sniffImageType, type CardData } from '@everloom/engine';
import { fetchPublic } from '../util/public-fetch.js';
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

/**
 * Install-and-pair: a one-time code baked into a userscript download. The script trades it for its
 * own device token on first run. Codes live ten minutes, in memory only, and work once.
 */
const pairings = new Map<string, { owner: string; label: string; expires: number }>();
export function startPairing(ctx: AppContext, owner: string, label: string): { code: string; expiresAt: number } {
  for (const [k, v] of pairings) if (v.expires < Date.now()) pairings.delete(k);
  if ([...pairings.values()].filter((p) => p.owner === owner).length >= 5) throw new HttpError(429, 'Too many pairings waiting; use one of them first');
  const code = `evp_${randomToken(18)}`;
  const expiresAt = Date.now() + 10 * 60_000;
  pairings.set(sha256(code), { owner, label, expires: expiresAt });
  return { code, expiresAt };
}
export function completePairing(ctx: AppContext, code: string): { token: string; label: string } {
  const key = sha256(code);
  const p = pairings.get(key);
  pairings.delete(key);
  if (!p || p.expires < Date.now()) throw new HttpError(401, 'This pairing link has expired or was already used. Make a new one in Everloom: Settings › Character sources › Browser bridge.', 'pair_expired');
  const d = addDevice(ctx, p.owner, p.label);
  return { token: d.token, label: d.device.label };
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
  /** A picture the page couldn't read itself (its security policy blocked it); fetched here if it's an image. */
  avatarUrl: z.string().url().max(2000).optional(),
});
export type BridgePayload = z.infer<typeof bridgePayload>;

/** Only a picture, only over https, nothing private, and nothing if the host asks for a browser check. */
async function fetchPicture(ctx: AppContext, url: string): Promise<Buffer | null> {
  if (!url.startsWith('https://')) return null;
  try {
    const r = await fetchPublic(url, { headers: { accept: 'image/*' }, maxBytes: 12 * 1024 * 1024, timeoutMs: 15_000, allowPrivate: ctx.cfg.fetchPrivate });
    return r.status === 200 && sniffImageType(new Uint8Array(r.body.subarray(0, 16))) ? r.body : null;
  } catch {
    return null;
  }
}

function b64(data: string): Buffer {
  return Buffer.from(data.replace(/^data:[^;,]+;base64,/, ''), 'base64');
}

export async function bridgeImport(ctx: AppContext, owner: string, p: BridgePayload) {
  if (p.nsfw && getSettings(ctx, owner).library.nsfw !== true) throw new HttpError(403, 'This character is marked adult. Turn on adult content in Settings › Character sources to import it.');
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
  const picture = p.file ? null : p.avatar ? b64(p.avatar) : p.avatarUrl ? await fetchPicture(ctx, p.avatarUrl) : null;
  if (picture) {
    try {
      const img = await saveImage(ctx, owner, picture, { kind: 'avatar', maxDim: 1536, meta: { source: p.page } });
      ctx.db.prepare('UPDATE characters SET avatar = ? WHERE id = ?').run(img.id, created.id);
    } catch {
      /* the card works without its picture */
    }
  }
  return getCharacter(ctx, owner, created.id);
}
