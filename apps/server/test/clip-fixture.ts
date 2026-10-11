/** Clip Studio .clip files built from the format notes, for tests (see services/puppets/clipfile.ts). */
import { deflateSync } from 'node:zlib';
import Database from 'better-sqlite3-multiple-ciphers';

const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const u64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
const utf16 = (s: string) => Buffer.concat([u32(s.length), Buffer.from(s, 'utf16le').swap16()]);
const label = (s: string) => Buffer.from(s, 'utf16le').swap16();

/** Offscreen.Attribute for a W×H bitmap in 256-pixel tiles, `channels` = [1, 4] (RGBA) or [1, 0] (mask). */
function attribute(w: number, h: number, channels: [number, number]) {
  const packing = Array.from({ length: 16 }, (_, i) => (i === 1 ? channels[0] : i === 2 ? channels[1] : 0));
  return Buffer.concat([u32(16), u32(102), u32(42), u32(0), utf16('Parameter'), u32(w), u32(h), u32(Math.ceil(w / 256)), u32(Math.ceil(h / 256)), ...packing.map(u32), utf16('InitColor'), u32(0), u32(0), u32(0), u32(0), u32(0)]);
}

/** Block data: one 256×256 tile per grid cell (null = empty), then status and checksum. */
function blocks(list: (Buffer | null)[]) {
  const parts = list.map((raw, i) => {
    const body = raw ? (() => { const z = deflateSync(raw); const le = Buffer.alloc(4); le.writeUInt32LE(z.length); return Buffer.concat([u32(1), u32(z.length + 4), le, z]); })() : u32(0);
    const inner = Buffer.concat([u32(19), label('BlockDataBeginChunk'), u32(i), Buffer.from('000500000000010000000100', 'hex'), body, u32(17), label('BlockDataEndChunk')]);
    return Buffer.concat([u32(inner.length + 4), inner]);
  });
  const tail = (name: string) => Buffer.concat([u32(name.length), label(name), u32(12), u32(list.length), u32(4), ...list.map(() => u32(0))]);
  return Buffer.concat([...parts, tail('BlockStatus'), tail('BlockCheckSum')]);
}

/** An RGBA tile (alpha plane, then B,G,R,x) with a filled rectangle. */
function tile(rect: [number, number, number, number], [r, g, b]: [number, number, number]) {
  const t = Buffer.alloc(5 * 65536);
  for (let y = rect[1]; y < rect[3]; y++) for (let x = rect[0]; x < rect[2]; x++) {
    const i = y * 256 + x;
    t[i] = 255; t[65536 + i * 4] = b; t[65536 + i * 4 + 1] = g; t[65536 + i * 4 + 2] = r;
  }
  return t;
}

/** A small .clip: a canvas, a folder with a masked layer, a plain layer, a hidden layer and paper. */
export function makeClip(): Buffer {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE Canvas (MainId INTEGER, CanvasWidth REAL, CanvasHeight REAL, CanvasRootFolder INTEGER);
    CREATE TABLE Layer (MainId INTEGER, LayerName TEXT, LayerType INTEGER, LayerVisibility INTEGER, LayerOpacity INTEGER, LayerFolder INTEGER, LayerFirstChildIndex INTEGER, LayerNextIndex INTEGER, LayerOffsetX INTEGER, LayerOffsetY INTEGER, LayerRenderOffscrOffsetX INTEGER, LayerRenderOffscrOffsetY INTEGER, LayerRenderMipmap INTEGER, LayerLayerMaskMipmap INTEGER, LayerMaskOffsetX INTEGER, LayerMaskOffsetY INTEGER, LayerMaskOffscrOffsetX INTEGER, LayerMaskOffscrOffsetY INTEGER);
    CREATE TABLE Mipmap (MainId INTEGER, BaseMipmapInfo INTEGER);
    CREATE TABLE MipmapInfo (MainId INTEGER, Offscreen INTEGER);
    CREATE TABLE Offscreen (MainId INTEGER, BlockData BLOB, Attribute BLOB);
    CREATE TABLE CanvasPreview (ImageData BLOB);`);
  db.prepare('INSERT INTO Canvas VALUES (1, 300, 200, 1)').run();
  const L = db.prepare('INSERT INTO Layer VALUES (?,?,?,?,256,?,?,?,?,?,0,0,?,?,0,0,0,0)');
  // root(1) → paper(2) → folder(3){ masked(4) } → plain(5) → hidden(6)
  L.run(1, '', 256, 1, 1, 2, 0, 0, 0, 0, 0);
  L.run(2, 'Paper', 1584, 1, 0, 0, 3, 0, 0, 0, 0);
  L.run(3, 'Body', 0, 1, 1, 4, 5, 0, 0, 0, 0);
  L.run(4, 'Shirt', 1, 3, 0, 0, 0, 0, 0, 10, 11);
  L.run(5, 'Hair', 1, 1, 0, 0, 6, 20, 10, 12, 0);
  L.run(6, 'Sketch', 1, 0, 0, 0, 0, 0, 0, 13, 0);
  const ext = new Map<string, Buffer>();
  const add = (mip: number, rgba: (Buffer | null)[], w: number, h: number, ch: [number, number]) => {
    const id = `extrnlid${mip.toString(16).toUpperCase().padStart(32, '0')}`;
    ext.set(id, blocks(rgba));
    db.prepare('INSERT INTO Mipmap VALUES (?,?)').run(mip, mip);
    db.prepare('INSERT INTO MipmapInfo VALUES (?,?)').run(mip, mip);
    db.prepare('INSERT INTO Offscreen VALUES (?,?,?)').run(mip, Buffer.from(id, 'latin1'), attribute(w, h, ch));
  };
  // Shirt: a red 100×50 block at (10,20) in a 300×200 bitmap, its mask showing only x < 60.
  add(10, [tile([10, 20, 110, 70], [255, 0, 0]), null], 300, 200, [1, 4]);
  const mask = Buffer.alloc(65536);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 60; x++) mask[y * 256 + x] = 255;
  add(11, [mask, null], 300, 200, [1, 0]);
  // Hair: green, 40×30 at (5,5) of its own bitmap, the layer moved by (20,10).
  add(12, [tile([5, 5, 45, 35], [0, 255, 0]), null], 300, 200, [1, 4]);
  add(13, [tile([0, 0, 50, 50], [0, 0, 255]), null], 300, 200, [1, 4]);
  const sqlite = db.serialize();
  db.close();
  const chunk = (tag: string, body: Buffer) => Buffer.concat([Buffer.from(tag, 'latin1'), u64(body.length), body]);
  const head = chunk('CHNKHead', Buffer.alloc(40));
  const extas = [...ext].map(([id, body]) => chunk('CHNKExta', Buffer.concat([u64(40), Buffer.from(id, 'latin1'), u64(body.length), body])));
  const rest = Buffer.concat([head, ...extas, chunk('CHNKSQLi', sqlite), chunk('CHNKFoot', Buffer.alloc(0))]);
  return Buffer.concat([Buffer.from('CSFCHUNK', 'latin1'), u64(24 + rest.length), u64(24), rest]);
}

/** A .clip from full-canvas RGBA layers (bottom first); "Folder/Layer" names make one folder level. */
export function clipFromLayers(W: number, H: number, list: { name: string; rgba: Uint8Array }[]): Buffer {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE Canvas (MainId INTEGER, CanvasWidth REAL, CanvasHeight REAL, CanvasRootFolder INTEGER);
    CREATE TABLE Layer (MainId INTEGER, LayerName TEXT, LayerType INTEGER, LayerVisibility INTEGER, LayerOpacity INTEGER, LayerFolder INTEGER, LayerFirstChildIndex INTEGER, LayerNextIndex INTEGER, LayerOffsetX INTEGER, LayerOffsetY INTEGER, LayerRenderMipmap INTEGER);
    CREATE TABLE Mipmap (MainId INTEGER, BaseMipmapInfo INTEGER);
    CREATE TABLE MipmapInfo (MainId INTEGER, Offscreen INTEGER);
    CREATE TABLE Offscreen (MainId INTEGER, BlockData BLOB, Attribute BLOB);`);
  db.prepare('INSERT INTO Canvas VALUES (1, ?, ?, 1)').run(W, H);
  const ext = new Map<string, Buffer>();
  const gw = Math.ceil(W / 256), gh = Math.ceil(H / 256);
  // Root's children in order; a folder holds the layers named "<folder>/…" that follow it.
  type Node = { id: number; name: string; rgba?: Uint8Array; kids?: Node[] };
  let next = 2;
  const root: Node[] = [];
  for (const l of list) {
    const [folder, name] = l.name.includes('/') ? l.name.split('/') as [string, string] : [null, l.name];
    const leaf: Node = { id: next++, name, rgba: l.rgba };
    if (!folder) { root.push(leaf); continue; }
    let f = root.find((n) => n.kids && n.name === folder);
    if (!f) { f = { id: next++, name: folder, kids: [] }; root.push(f); }
    f.kids!.push(leaf);
  }
  const insert = db.prepare('INSERT INTO Layer VALUES (?,?,?,1,256,?,?,?,0,0,?)');
  const write = (nodes: Node[]) => nodes.forEach((n, i) => {
    const after = nodes[i + 1]?.id ?? 0;
    if (n.kids) { insert.run(n.id, n.name, 0, 1, n.kids[0]!.id, after, 0); write(n.kids); return; }
    const tilesOf: (Buffer | null)[] = [];
    for (let ty = 0; ty < gh; ty++) for (let tx = 0; tx < gw; tx++) {
      const t = Buffer.alloc(5 * 65536);
      let any = false;
      for (let y = 0; y < 256 && ty * 256 + y < H; y++) for (let x = 0; x < 256 && tx * 256 + x < W; x++) {
        const o = ((ty * 256 + y) * W + tx * 256 + x) * 4, k = y * 256 + x;
        if (!n.rgba![o + 3]) continue;
        any = true;
        t[k] = n.rgba![o + 3]!; t[65536 + k * 4] = n.rgba![o + 2]!; t[65536 + k * 4 + 1] = n.rgba![o + 1]!; t[65536 + k * 4 + 2] = n.rgba![o]!;
      }
      tilesOf.push(any ? t : null);
    }
    const id = `extrnlid${n.id.toString(16).toUpperCase().padStart(32, '0')}`;
    ext.set(id, blocks(tilesOf));
    db.prepare('INSERT INTO Mipmap VALUES (?,?)').run(n.id, n.id);
    db.prepare('INSERT INTO MipmapInfo VALUES (?,?)').run(n.id, n.id);
    db.prepare('INSERT INTO Offscreen VALUES (?,?,?)').run(n.id, Buffer.from(id, 'latin1'), attribute(W, H, [1, 4]));
    insert.run(n.id, n.name, 1, 0, 0, after, n.id);
  });
  insert.run(1, '', 256, 1, root[0]!.id, 0, 0);
  write(root);
  const sqlite = db.serialize();
  db.close();
  const chunk = (tag: string, body: Buffer) => Buffer.concat([Buffer.from(tag, 'latin1'), u64(body.length), body]);
  const extas = [...ext].map(([id, body]) => chunk('CHNKExta', Buffer.concat([u64(40), Buffer.from(id, 'latin1'), u64(body.length), body])));
  const rest = Buffer.concat([chunk('CHNKHead', Buffer.alloc(40)), ...extas, chunk('CHNKSQLi', sqlite), chunk('CHNKFoot', Buffer.alloc(0))]);
  return Buffer.concat([Buffer.from('CSFCHUNK', 'latin1'), u64(24 + rest.length), u64(24), rest]);
}

