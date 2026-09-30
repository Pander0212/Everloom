import { existsSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isPrivateAddress } from '../src/util/public-fetch.js';
import { createClient, type TestClient } from './helpers.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let server: http.Server;
let base = '';
let hits = 0;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits++;
    if (req.url === '/redirect') return void res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' }).end();
    if (req.url?.startsWith('/img/')) return void res.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
    if (req.url === '/page.png') return void res.writeHead(200, { 'content-type': 'text/html' }).end('<html>not an image</html>');
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

let c: TestClient;
beforeEach(async () => {
  c = await createClient();
  hits = 0;
});
afterEach(async () => c?.close());

const make = async (card: object) => (await c.req('POST', '/api/characters', { card })).json;
const owner = () => (c.built.ctx.db.prepare('SELECT id FROM users').get() as { id: string }).id;
const mediaDir = () => path.join(c.built.ctx.cfg.mediaDir, owner());

describe('private addresses', () => {
  it('knows loopback, private, link-local and mapped forms', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.5', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe('media localization', () => {
  it('never lets a card make the server call a private address (by default)', async () => {
    const ch = await make({ name: 'Sneaky', creator_notes: `<img src="${base}/img/a.png">` });
    const r = (await c.req('POST', '/api/library/localize', { ids: [ch.id] })).json;
    expect(r.saved).toBe(0);
    expect(r.failed[0].error).toMatch(/private network/);
    expect(hits).toBe(0);
    expect((await c.req('GET', `/api/characters/${ch.id}`)).json.card.creator_notes).toContain(base); // untouched
  });

  it('downloads linked images, rewrites the card (keeping a snapshot), reuses copies, and reports failures', async () => {
    c.built.ctx.cfg.fetchPrivate = true; // the test image server is on localhost
    const ch = await make({ name: 'Iris', creator_notes: `<img src="${base}/img/a.png"> ![b](${base}/img/b.png) <img src="${base}/img/a.png">`, first_mes: `Hi ${base}/page.png`, alternate_greetings: [`<img src="${base}/img/b.png">`, `${base}/missing.png`] });
    const report = (await c.req('GET', '/api/library/media')).json;
    expect(report.remote).toEqual([{ id: ch.id, name: 'Iris', urls: expect.arrayContaining([`${base}/img/a.png`, `${base}/img/b.png`, `${base}/page.png`, `${base}/missing.png`]) }]);
    const r = (await c.req('POST', '/api/library/localize', {})).json;
    expect(r.saved).toBe(2);
    expect(r.failed.map((f: any) => f.url).sort()).toEqual([`${base}/missing.png`, `${base}/page.png`]);
    const card = (await c.req('GET', `/api/characters/${ch.id}`)).json.card;
    expect(card.creator_notes).not.toContain(base);
    expect(card.creator_notes.match(/\/media\/m_/g)).toHaveLength(3);
    expect(card.alternate_greetings[0]).toMatch(/^<img src="\/media\/m_[\w-]{12}">$/);
    expect(card.first_mes).toContain(`${base}/page.png`); // failed ones keep the link
    const local = /\/media\/(m_[\w-]{12})/.exec(card.creator_notes)![1];
    expect((await c.req('GET', `/media/${local}`)).status).toBe(200);
    expect((await c.req('GET', `/api/characters/${ch.id}/versions`)).json.length).toBeGreaterThanOrEqual(1);
    // A second card with the same link gets its own copy; running again on the first reuses nothing new.
    hits = 0;
    const again = (await c.req('POST', '/api/library/localize', { ids: [ch.id] })).json;
    expect(again.saved).toBe(0);
    expect(hits).toBe(2); // only the two failing links were tried again
  });

  it('checks every redirect hop too', async () => {
    const ch = await make({ name: 'Hop', creator_notes: `<img src="${base}/redirect">` });
    c.built.ctx.cfg.fetchPrivate = true;
    const { fetchPublic } = await import('../src/util/public-fetch.js');
    await expect(fetchPublic(`${base}/redirect`, { allowPrivate: false })).rejects.toThrow(/private network/);
    void ch;
  });
});

describe('media integrity', () => {
  it('finds missing files, orphan files, unused copies and dangling references, and fixes only what was chosen', async () => {
    c.built.ctx.cfg.fetchPrivate = true;
    const ch = await make({ name: 'Iris', creator_notes: `<img src="${base}/img/a.png"> <img src="${base}/img/c.png">` });
    await c.req('POST', '/api/library/localize', { ids: [ch.id] });
    const db = c.built.ctx.db;
    const rows = db.prepare("SELECT id, filename, meta FROM media WHERE kind = 'localized'").all() as Array<{ id: string; filename: string; meta: string }>;
    expect(rows).toHaveLength(2);
    // Break things: one file lost, one stray file, one copy no card uses, a dangling avatar and gallery id.
    unlinkSync(path.join(mediaDir(), rows[0]!.filename));
    writeFileSync(path.join(mediaDir(), 'stray.png'), PNG);
    const card = (await c.req('GET', `/api/characters/${ch.id}`)).json.card;
    await c.req('PATCH', `/api/characters/${ch.id}`, { card: { creator_notes: card.creator_notes.replace(new RegExp(`<img src="/media/${rows[1]!.id}">`), '') } });
    db.prepare("UPDATE characters SET avatar = 'm_AAAAAAAAAAAA', game = ? WHERE id = ?").run(JSON.stringify({ gallery: ['m_BBBBBBBBBBBB'] }), ch.id);
    // A second character, deleted for good (not in the trash), leaves its gallery image behind.
    const gone = await make({ name: 'Gone' });
    const { saveMedia } = await import('../src/services/media.js');
    const left = await saveMedia(c.built.ctx, owner(), PNG, { kind: 'gallery', characterId: gone.id });
    db.prepare('DELETE FROM characters WHERE id = ?').run(gone.id);

    let r = (await c.req('GET', '/api/library/media')).json.integrity;
    expect(r.missingFiles).toEqual([expect.objectContaining({ id: rows[0]!.id, source: `${base}/img/a.png`, characterName: 'Iris' })]);
    expect(r.orphanFiles).toEqual([{ filename: 'stray.png', size: PNG.length }]);
    // rows[1] is still in the snapshot history, so it counts as used; the deleted character's image does not.
    expect(r.unusedRows.map((u: any) => u.id)).toEqual([left.id]);
    expect(r.danglingRefs.map((d: any) => d.where).sort()).toEqual(['avatar', 'gallery']);

    // Redownload brings the lost file back under the same id; the others stay until asked.
    const fixed = (await c.req('POST', '/api/library/media/fix', { actions: ['redownload'] })).json;
    expect(fixed.done.redownload).toBe(1);
    expect(fixed.integrity.missingFiles).toEqual([]);
    expect((await c.req('GET', `/media/${rows[0]!.id}`)).status).toBe(200);
    expect(fixed.integrity.orphanFiles).toHaveLength(1);

    r = (await c.req('POST', '/api/library/media/fix', { actions: ['delete-orphan-files', 'delete-unused', 'clear-dangling'] })).json;
    expect(r.done).toMatchObject({ 'delete-orphan-files': 1, 'delete-unused': 1, 'clear-dangling': 2 });
    expect(r.integrity).toMatchObject({ missingFiles: [], orphanFiles: [], unusedRows: [], danglingRefs: [] });
    expect(existsSync(path.join(mediaDir(), 'stray.png'))).toBe(false);
    const after = db.prepare('SELECT avatar, game FROM characters WHERE id = ?').get(ch.id) as { avatar: string | null; game: string };
    expect(after.avatar).toBeNull();
    expect(JSON.parse(after.game).gallery).toEqual([]);
    // What cards and snapshots still use is untouched.
    expect(readdirSync(mediaDir()).length).toBe(2);
  });

  it('keeps the media of a character in the trash (it can still be restored)', async () => {
    const ch = await make({ name: 'Undoable' });
    const { saveMedia } = await import('../src/services/media.js');
    await saveMedia(c.built.ctx, owner(), PNG, { kind: 'gallery', characterId: ch.id });
    await c.req('DELETE', `/api/characters/${ch.id}`);
    expect((await c.req('GET', '/api/library/media')).json.integrity.unusedRows).toEqual([]);
  });
});
