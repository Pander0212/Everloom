/** The procedural test figure as a Puppets v2 character pack (zip), for the e2e tests. */
import { testFigure, type FigureShape } from '@everloom/engine/puppet2';
import { strToU8, zipSync } from 'fflate';
import sharp from 'sharp';

export async function figurePack(o: { rating?: '18+' | 'all-ages'; adult?: boolean; outfits?: boolean } = {}) {
  const files: Record<string, Uint8Array> = {};
  const index: { name: string; rating: string; views: Record<string, unknown> } = { name: 'Figure', rating: o.rating ?? 'all-ages', views: {} };
  for (const view of ['front', 'side'] as const) {
    const fig = testFigure({ view });
    const layers = [];
    for (const l of fig.input.layers) {
      const [x, y, w, h] = l.rect;
      const svg = (s: FigureShape) => s.type === 'ellipse'
        ? `<ellipse cx="${s.cx - x}" cy="${s.cy - y}" rx="${s.rx}" ry="${s.ry}" fill="${s.color}"/>`
        : `<polyline points="${s.pts.map((p) => `${p[0] - x},${p[1] - y}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="${Math.max(...[s.w].flat())}" stroke-linecap="round" stroke-linejoin="round"/>`;
      files[`${view}/${l.id}.png`] = new Uint8Array(await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${(fig.paint[l.id] ?? []).map(svg).join('')}</svg>`)).png().toBuffer());
      const { texture: _t, ...rest } = l;
      layers.push(rest);
    }
    if (o.outfits) {
      // A second outfit: the top again, recoloured by name only (same picture), as "formal".
      const top = layers.find((l) => l.id === 'top');
      if (top) { layers.push({ ...top, id: 'dress', outfit: 'formal' }); files[`${view}/dress.png`] = files[`${view}/top.png`]!; }
    }
    index.views[view] = { keypoints: fig.input.keypoints, layers };
  }
  files['character.json'] = strToU8(JSON.stringify(index));
  return Buffer.from(zipSync(files));
}
