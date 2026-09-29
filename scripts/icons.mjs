// Generates the PWA icons from one SVG mark.
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = 'apps/web/public/icons';
mkdirSync(out, { recursive: true });
const mark = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 112}" fill="#0E0F11"/>
  <g transform="translate(256 256) scale(${pad ? 0.62 : 0.8}) translate(-256 -256)">
    <path d="M144 328c0-80 51-144 112-144s112 64 112 144M144 184c0 80 51 144 112 144s112-64 112-144" fill="none" stroke="#E1A94F" stroke-width="34" stroke-linecap="round"/>
  </g>
</svg>`;
writeFileSync(`${out}/icon.svg`, mark(false));
for (const [name, size, pad] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]]) {
  await sharp(Buffer.from(mark(pad))).resize(size, size).png().toFile(`${out}/${name}`);
}
console.log('icons written');
