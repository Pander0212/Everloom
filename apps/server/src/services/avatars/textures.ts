/**
 * Garment textures from the owner's image connection: a fabric or pattern tile from a description
 * (or a variant of an existing texture with an editing model), made seamless in code so it repeats
 * without visible edges, and stored like any picture.
 */
import sharp from 'sharp';
import { HttpError, type AppContext } from '../../context.js';
import { generateImage } from '../../media/imagegen.js';
import { connectionForRole } from '../connections.js';
import { mediaUrl, readMedia, saveImage } from '../media.js';
import { getAvatarRow, parseConfig } from './service.js';
import { isMinorAvatar, REFUSED } from '../minor-guard.js';

/**
 * Makes a tile repeat cleanly: a copy shifted by half (whose edges are the original's middle, so
 * they meet themselves) is blended in towards the borders, and the original keeps the middle.
 */
export async function makeSeamless(input: Buffer, size = 1024): Promise<Buffer> {
  const { data, info } = await sharp(input).resize(size, size, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const out = Buffer.alloc(w * h * 3);
  const band = Math.round(w * 0.22);
  for (let y = 0; y < h; y++) {
    const dy = Math.min(y, h - 1 - y);
    const sy = (y + h / 2) % h;
    for (let x = 0; x < w; x++) {
      const dx = Math.min(x, w - 1 - x);
      // 1 at the borders (use the shifted copy), 0 from `band` inwards (keep the original).
      const t = Math.max(0, 1 - Math.min(dx, dy) / band);
      const m = t * t * (3 - 2 * t);
      const sx = (x + w / 2) % w;
      const i = (y * w + x) * 3;
      const j = (sy * w + sx) * 3;
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(data[i + c]! * (1 - m) + data[j + c]! * m);
    }
  }
  return sharp(out, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

/** How visible the seam is when tiled: mean difference across the wrap edges, 0–255. */
export async function seamScore(png: Buffer): Promise<number> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let sum = 0;
  for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) sum += Math.abs(data[(y * w) * 3 + c]! - data[(y * w + w - 1) * 3 + c]!);
  for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) sum += Math.abs(data[x * 3 + c]! - data[((h - 1) * w + x) * 3 + c]!);
  return sum / ((w + h) * 3);
}

const TILE = 'Seamless tileable texture filling the whole frame edge to edge, seen straight from above, flat even lighting, no shadows, no perspective, no objects, no folds, no text.';

export async function generateTexture(ctx: AppContext, owner: string, input: { prompt: string; base?: string | null; adult?: boolean; avatarId?: string }) {
  const reference = input.base ? readMedia(ctx, owner, input.base) : undefined;
  const adult = input.adult === true || (reference && JSON.parse(reference.row.meta).adult === true);
  // Adult textures for a character: never for a minor (services/minor-guard.ts).
  if (adult && input.avatarId && isMinorAvatar(ctx, owner, parseConfig(getAvatarRow(ctx, owner, input.avatarId).config), input.avatarId)) throw new HttpError(403, REFUSED);
  const conn = connectionForRole(ctx, owner, 'image');
  if (!conn) throw new HttpError(400, 'Add an image connection first (Settings › Connections › Images)', 'no_connection');
  if (adult && conn.params.allowAdult !== true) throw new HttpError(403, 'This image connection is not marked as allowing adult content. Check its provider terms and connection settings.');
  const base = reference?.bytes;
  if (conn.params.edit && !base) throw new HttpError(400, 'This image model edits pictures: choose a texture to change', 'needs_image');
  const prompt = base && conn.params.edit ? `Change this texture: ${input.prompt}. Keep it a flat seamless tile, same scale and lighting.` : `${input.prompt}. ${TILE}`;
  const raw = await generateImage(conn, { prompt, width: 1024, height: 1024, image: base });
  const tile = await makeSeamless(raw);
  const saved = await saveImage(ctx, owner, tile, { kind: 'model-texture', maxDim: 1024, meta: { prompt: input.prompt.slice(0, 300), adult: adult === true } });
  return { id: saved.id, url: mediaUrl(saved.id), seam: Math.round(await seamScore(tile)) };
}
