/**
 * Renders the procedural test figure (packages/engine/src/puppet2/testfigure.ts) as one flat
 * transparent picture, plus its landmarks: a stand-in for a generated character when testing the
 * decomposition (tools/puppets2/decompose.py) without spending anything.
 *
 *   npx tsx tools/puppets2/render-figure.ts samples/gen/puppets2/figure [--view side] [--clothes]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { LAYER_ROLES, testFigure, type FigureShape } from '../../packages/engine/src/puppet2/index.js';

const out = process.argv[2] ?? 'samples/gen/puppets2/figure';
const view = process.argv.includes('--view') ? (process.argv[process.argv.indexOf('--view') + 1] as 'front' | 'side') : 'front';
const fig = testFigure({ view, clothes: process.argv.includes('--clothes') });
const shape = (s: FigureShape, outline: boolean) => {
  const stroke = outline ? 'rgba(60,40,30,0.6)' : s.color;
  if (s.type === 'ellipse') return `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx + (outline ? 1.5 : 0)}" ry="${s.ry + (outline ? 1.5 : 0)}" fill="${stroke}"/>`;
  const w = Math.max(...[s.w].flat()) + (outline ? 3 : 0);
  return `<polyline points="${s.pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
};
const layers = [...fig.input.layers].sort((a, b) => (a.z ?? LAYER_ROLES[a.role].z) - (b.z ?? LAYER_ROLES[b.role].z));
const body = layers.map((l) => (fig.paint[l.id] ?? []).map((s) => shape(s, true) + shape(s, false)).join('')).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${fig.input.width}" height="${fig.input.height}">${body}</svg>`;
mkdirSync(out, { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(path.join(out, `${view}.png`));
writeFileSync(path.join(out, `${view}-keypoints.json`), JSON.stringify(fig.input.keypoints));
console.log('wrote', path.join(out, `${view}.png`));
