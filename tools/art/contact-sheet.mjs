// A contact sheet of reference images for review: node tools/art/contact-sheet.mjs out.jpg a.jpg b.jpg …
import sharp from 'sharp';
import path from 'node:path';
const [out, ...files] = process.argv.slice(2);
const cell = 256, cols = 4, rows = Math.ceil(files.length / cols);
const tiles = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(cell, cell, { fit: 'contain', background: '#fff' }).composite([{ input: Buffer.from(`<svg width="${cell}" height="22"><rect width="100%" height="22" fill="#000a"/><text x="4" y="16" font-size="14" fill="#fff" font-family="sans-serif">${path.basename(f).replace(/^(\d+).*parts-/, '$1 ').replace(/\.\w+$/, '')}</text></svg>`), top: 0, left: 0 }]).toBuffer(), left: (i % cols) * cell, top: Math.floor(i / cols) * cell })));
await sharp({ create: { width: cols * cell, height: rows * cell, channels: 3, background: '#fff' } }).composite(tiles).jpeg({ quality: 82 }).toFile(out);
console.log(out);
