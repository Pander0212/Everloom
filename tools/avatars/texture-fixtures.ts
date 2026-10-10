/**
 * One small test texture (our own, CC0) in every texture format the importer converts: four
 * coloured quarters (red, green, blue, half-transparent white), so a test can check orientation,
 * colour and alpha after conversion.
 *
 *   npx tsx tools/avatars/texture-fixtures.ts tests/fixtures/textures
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { writePsd } from 'ag-psd';
import sharp from 'sharp';

const out = process.argv[2] ?? 'tests/fixtures/textures';
mkdirSync(out, { recursive: true });
const W = 64, H = 64;
export const QUARTERS = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 128]]; // TL, TR, BL, BR
const rgba = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgba.set(QUARTERS[(y >= H / 2 ? 2 : 0) + (x >= W / 2 ? 1 : 0)]!, (y * W + x) * 4);

const raw = () => sharp(Buffer.from(rgba), { raw: { width: W, height: H, channels: 4 } });
await raw().png().toFile(path.join(out, 'quarters.png'));

// TGA: uncompressed 32-bit, top-left origin (descriptor bit 5).
const tga = Buffer.alloc(18 + W * H * 4);
tga[2] = 2; tga.writeUInt16LE(W, 12); tga.writeUInt16LE(H, 14); tga[16] = 32; tga[17] = 0x28;
for (let i = 0; i < W * H; i++) { tga[18 + i * 4] = rgba[i * 4 + 2]!; tga[19 + i * 4] = rgba[i * 4 + 1]!; tga[20 + i * 4] = rgba[i * 4]!; tga[21 + i * 4] = rgba[i * 4 + 3]!; }
writeFileSync(path.join(out, 'quarters.tga'), tga);

// PSD with a flattened composite (what Photoshop's "Maximize compatibility" stores).
const imageData = { width: W, height: H, data: new Uint8ClampedArray(rgba), colorSpace: 'srgb' } as unknown as ImageData;
writeFileSync(path.join(out, 'quarters.psd'), Buffer.from(writePsd({ width: W, height: H, imageData, children: [{ name: 'Layer 1', imageData }] }, { generateThumbnail: false })));

// DDS, BC3 (DXT5): every 4x4 block here is one colour, so the encoding is exact.
const dds = Buffer.alloc(128 + (W / 4) * (H / 4) * 16);
dds.write('DDS ', 0, 'ascii');
dds.writeUInt32LE(124, 4); dds.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x1000 | 0x80000, 8); dds.writeUInt32LE(H, 12); dds.writeUInt32LE(W, 16);
dds.writeUInt32LE((W / 4) * (H / 4) * 16, 20); dds.writeUInt32LE(1, 28);
dds.writeUInt32LE(32, 76); dds.writeUInt32LE(0x4, 80); dds.write('DXT5', 84, 'ascii'); dds.writeUInt32LE(0x1000, 108);
const to565 = (r: number, g: number, b: number) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
for (let by = 0; by < H / 4; by++) for (let bx = 0; bx < W / 4; bx++) {
  const o = 128 + (by * (W / 4) + bx) * 16;
  const [r, g, b, a] = QUARTERS[(by * 4 >= H / 2 ? 2 : 0) + (bx * 4 >= W / 2 ? 1 : 0)]!;
  dds[o] = a!; dds[o + 1] = a!; // alpha endpoints; indices 0 → a0
  const c = to565(r!, g!, b!);
  dds.writeUInt16LE(c, o + 8); dds.writeUInt16LE(c, o + 10); // both endpoints the colour; indices 0
}
writeFileSync(path.join(out, 'quarters.dds'), dds);

// KTX2 (Basis ETC1S), with the same encoder the server's model optimizer uses.
const { encodeToKTX2 } = (await import('ktx2-encoder')) as unknown as { encodeToKTX2: (b: Uint8Array, o: Record<string, unknown>) => Promise<Uint8Array> };
const png = new Uint8Array(await raw().png().toBuffer());
const imageDecoder = async () => ({ width: W, height: H, data: rgba });
const write = process.stdout.write;
process.stdout.write = (() => true) as typeof process.stdout.write; // the encoder prints its progress
try {
  writeFileSync(path.join(out, 'quarters.ktx2'), await encodeToKTX2(png, { isUASTC: true, uastcLDRQualityLevel: 2, generateMipmap: false, isKTX2File: true, isSetKTX2SRGBTransferFunc: true, imageDecoder }));
} finally {
  process.stdout.write = write;
}
console.log('TEXTURES_OK');
