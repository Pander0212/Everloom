/**
 * Everloom's bundled art: the starter pack goes into the asset library once (and only when the
 * owner asks), the demo character brings its expression set, and a missing or tampered manifest
 * can't reach outside the art folder.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { createClient, type TestClient } from './helpers.js';

let c: TestClient;
afterEach(async () => c?.close());

const pic = (r: number, g: number, b: number) => sharp({ create: { width: 64, height: 36, channels: 3, background: { r, g, b } } }).webp().toBuffer();

async function writeStarter(webDir: string) {
  const dir = path.join(webDir, 'art', 'starter');
  mkdirSync(path.join(dir, 'bg'), { recursive: true });
  mkdirSync(path.join(dir, 'mira'), { recursive: true });
  writeFileSync(path.join(dir, 'bg', 'tavern.webp'), await pic(120, 80, 40));
  writeFileSync(path.join(dir, 'bg', 'park.webp'), await pic(60, 160, 60));
  writeFileSync(path.join(dir, 'mira', 'neutral.webp'), await pic(200, 180, 160));
  writeFileSync(path.join(dir, 'mira', 'joy.webp'), await pic(220, 190, 150));
  writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify([
      { file: 'bg/tavern.webp', name: 'Tavern', type: 'background', tags: ['fantasy'], pack: 'starter' },
      { file: 'bg/park.webp', name: 'City park', type: 'background', tags: ['modern'], pack: 'starter' },
      { file: '../../../secret.webp', name: 'Escape', type: 'background', tags: [], pack: 'starter' },
      { file: 'mira/neutral.webp', name: 'Mira Vale · neutral', type: 'sprite', tags: ['demo'], set: 'Mira Vale', expression: 'neutral', pack: 'demo' },
      { file: 'mira/joy.webp', name: 'Mira Vale · joy', type: 'sprite', tags: ['demo'], set: 'Mira Vale', expression: 'joy', pack: 'demo' },
    ]),
  );
}

describe('bundled art', () => {
  it('adds the starter pack on request, once', async () => {
    c = await createClient();
    expect((await c.req('GET', '/api/assets/starter')).json).toMatchObject({ available: false });
    expect((await c.req('POST', '/api/assets/starter', {})).status).toBe(404);
    // Nothing is added on its own.
    expect((await c.req('GET', '/api/assets')).json.assets).toHaveLength(0);

    await writeStarter(c.built.ctx.cfg.webDir);
    expect((await c.req('GET', '/api/assets/starter')).json).toMatchObject({ available: true, count: 2, backgrounds: 2 });
    expect((await c.req('POST', '/api/assets/starter', {})).json).toEqual({ added: 2, skipped: 0 });
    expect((await c.req('POST', '/api/assets/starter', {})).json).toEqual({ added: 0, skipped: 2 });
    const lib = (await c.req('GET', '/api/assets', undefined)).json;
    expect(lib.assets.map((a: any) => a.name).sort()).toEqual(['City park', 'Tavern']);
    expect(lib.assets.every((a: any) => a.type === 'background' && a.tags.includes('everloom'))).toBe(true);

    // They're ordinary assets: the owner can delete one, and adding again only restores that one.
    const tavern = lib.assets.find((a: any) => a.name === 'Tavern');
    expect((await c.req('DELETE', `/api/assets/${tavern.id}`)).status).toBe(200);
    expect((await c.req('POST', '/api/assets/starter', {})).json).toEqual({ added: 1, skipped: 1 });
  });

  it('adds the demo character with her expressions, without duplicating pictures', async () => {
    c = await createClient();
    await writeStarter(c.built.ctx.cfg.webDir);
    const mira = (await c.req('POST', '/api/characters/demo', {})).json;
    expect(mira.name).toBe('Mira Vale');
    expect(mira.avatar).toBeTruthy();
    expect(Object.keys(mira.game.expressions).sort()).toEqual(['joy', 'neutral']);
    const sets = (await c.req('GET', '/api/assets')).json.sets;
    expect(sets).toEqual([{ name: 'Mira Vale', expressions: mira.game.expressions }]);
    // A second Mira reuses the same expression pictures.
    const again = (await c.req('POST', '/api/characters/demo', {})).json;
    expect(again.game.expressions).toEqual(mira.game.expressions);
    expect((await c.req('GET', '/api/assets', undefined)).json.assets.filter((a: any) => a.set === 'Mira Vale')).toHaveLength(2);
    // The card is all-ages and says where her pictures came from.
    const full = (await c.req('GET', `/api/characters/${mira.id}`)).json;
    expect(full.card.creator_notes).toMatch(/CREDITS/);
  });
});
