/**
 * The placeholder puppet: simple shapes in every slot of the part schema, rigged by the same
 * template rig as the art templates. It ships in the repository (the only puppet art that does)
 * for tests, as a fallback, and so rigging work could start before the art existed.
 *
 *   npx tsx tools/puppets/build-placeholder.ts
 *
 * Writes apps/web/public/puppets/placeholder/{puppet.json, page0.png}. CC0, made by Everloom.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { buildTemplateRig, checkPuppet, type TemplateLandmarks } from '../../packages/engine/src/index.js';
import { packAtlas, puppetJson, trimRgba, type PartImage } from './atlas.js';

const W = 600, H = 1000;
export const PLACEHOLDER_LANDMARKS: TemplateLandmarks = {
  canvas: [W, H],
  head: { cx: 300, cy: 250, r: 95, top: 150, chin: 348 },
  eyeR: { cx: 262, cy: 262, w: 34, h: 22 },
  eyeL: { cx: 338, cy: 262, w: 34, h: 22 },
  browR: { cx: 262, cy: 226, w: 40 },
  browL: { cx: 338, cy: 226, w: 40 },
  mouth: { cx: 300, cy: 312, w: 44 },
  neck: { cx: 300, cy: 372 },
  shoulderR: [218, 412],
  shoulderL: [382, 412],
  chest: { cy: 470, w: 160 },
  waist: { cy: 560, w: 122 },
  hips: { cy: 640, w: 160 },
  bottom: 960,
};

const SKIN = '#f2c9a8', SKIN_D = '#d9a888', HAIR = '#5a3a2b', LINE = '#3b2a24', EYE = '#3d6fa8', SHIRT = '#e9edf3', PANTS = '#3b4a6b', LIP = '#8a3a3a';
const eye = (cx: number, cy: number) => ({
  white: `<ellipse cx="${cx}" cy="${cy}" rx="17" ry="11" fill="#ffffff"/>`,
  iris: `<circle cx="${cx}" cy="${cy}" r="10" fill="${EYE}"/><circle cx="${cx}" cy="${cy}" r="4.5" fill="#1d2633"/><circle cx="${cx - 3}" cy="${cy - 4}" r="2.5" fill="#ffffff"/>`,
  lash: `<path d="M${cx - 19} ${cy + 1} Q${cx} ${cy - 17} ${cx + 19} ${cy + 1}" stroke="${LINE}" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M${cx - 14} ${cy + 9} Q${cx} ${cy + 14} ${cx + 14} ${cy + 9}" stroke="${LINE}" stroke-width="1.5" fill="none"/>`,
  half: `<path d="M${cx - 17} ${cy + 2} Q${cx} ${cy - 3} ${cx + 17} ${cy + 2} Q${cx} ${cy + 11} ${cx - 17} ${cy + 2}Z" fill="#ffffff"/><path d="M${cx - 8} ${cy + 1} A8 8 0 0 0 ${cx + 8} ${cy + 1}Z" fill="${EYE}"/><path d="M${cx - 19} ${cy + 3} Q${cx} ${cy - 5} ${cx + 19} ${cy + 3}" stroke="${LINE}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  closed: `<path d="M${cx - 18} ${cy + 3} Q${cx} ${cy + 12} ${cx + 18} ${cy + 3}" stroke="${LINE}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
  smile: `<path d="M${cx - 17} ${cy + 6} Q${cx} ${cy - 10} ${cx + 17} ${cy + 6}" stroke="${LINE}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
});
const R = eye(262, 262), L = eye(338, 262);
const m = { cx: 300, cy: 312 };
const arm = (x0: number, y0: number, x1: number, y1: number, x2?: number, y2?: number) => `<path d="M${x0} ${y0} L${x1} ${y1}${x2 !== undefined ? ` L${x2} ${y2}` : ''}" stroke="${SKIN}" stroke-width="32" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="${x2 ?? x1}" cy="${y2 ?? y1}" r="19" fill="${SKIN_D}"/>`;

/** [id, slot, svg body, colour group] */
const PARTS: Array<[string, string, string, string?]> = [
  ['hair-back', 'hair.back', `<path d="M196 230 Q200 120 300 118 Q400 120 404 230 L418 520 Q300 560 182 520Z" fill="${HAIR}"/>`, 'hair'],
  ['body-skin', 'body', `<rect x="280" y="320" width="40" height="110" fill="${SKIN}"/><path d="M226 410 Q300 395 374 410 L360 640 Q300 660 240 640Z" fill="${SKIN}"/><path d="M240 630 L360 630 L352 960 L306 960 L300 700 L294 960 L248 960Z" fill="${SKIN}"/>`, 'skin'],
  ['bottom', 'bottom', `<path d="M236 590 L364 590 L356 960 L308 960 L300 700 L292 960 L244 960Z" fill="${PANTS}"/>`, 'cloth2'],
  ['top', 'top', `<path d="M214 412 Q300 392 386 412 L372 612 Q300 628 228 612Z" fill="${SHIRT}"/><path d="M276 402 Q300 424 324 402" stroke="#c9d0da" stroke-width="5" fill="none"/>`, 'cloth1'],
  ['arm-r', 'arm.r:relaxed', arm(218, 420, 200, 560, 196, 690), 'skin'],
  ['arm-r-raised', 'arm.r:raised', arm(218, 420, 150, 400, 130, 300), 'skin'],
  ['arm-l', 'arm.l:relaxed', arm(382, 420, 400, 560, 404, 690), 'skin'],
  ['arm-l-hip', 'arm.l:hip', arm(382, 420, 440, 520, 372, 610), 'skin'],
  ['sleeve-r', 'sleeve.r:relaxed', `<path d="M200 410 L240 405 L236 480 L196 486Z" fill="${SHIRT}"/>`, 'cloth1'],
  ['sleeve-r-raised', 'sleeve.r:raised', `<path d="M196 392 L236 400 L210 450 L172 438Z" fill="${SHIRT}"/>`, 'cloth1'],
  ['sleeve-l', 'sleeve.l:relaxed', `<path d="M360 405 L400 410 L404 486 L364 480Z" fill="${SHIRT}"/>`, 'cloth1'],
  ['sleeve-l-hip', 'sleeve.l:hip', `<path d="M362 404 L402 410 L424 470 L388 482Z" fill="${SHIRT}"/>`, 'cloth1'],
  ['face-skin', 'face', `<ellipse cx="205" cy="268" rx="12" ry="20" fill="${SKIN_D}"/><ellipse cx="395" cy="268" rx="12" ry="20" fill="${SKIN_D}"/><path d="M206 230 Q206 150 300 150 Q394 150 394 230 Q394 320 300 348 Q206 320 206 230Z" fill="${SKIN}"/>${R.closed}${L.closed}<path d="M290 312 Q300 315 310 312" stroke="${LIP}" stroke-width="3" fill="none" stroke-linecap="round"/>`, 'skin'],
  ['eye-r-white', 'eye.r.white', R.white], ['eye-l-white', 'eye.l.white', L.white],
  ['eye-r-iris', 'eye.r.iris', R.iris, 'eyes'], ['eye-l-iris', 'eye.l.iris', L.iris, 'eyes'],
  ['eye-r-lash', 'eye.r.lash', R.lash], ['eye-l-lash', 'eye.l.lash', L.lash],
  ['eye-r-half', 'eye.r.half', R.half], ['eye-l-half', 'eye.l.half', L.half],
  ['eye-r-closed', 'eye.r.closed', R.closed], ['eye-l-closed', 'eye.l.closed', L.closed],
  ['eye-r-smile', 'eye.r.smile', R.smile], ['eye-l-smile', 'eye.l.smile', L.smile],
  ['brow-r', 'brow.r', `<path d="M244 228 Q262 218 282 224" stroke="${HAIR}" stroke-width="6" fill="none" stroke-linecap="round"/>`, 'hair'],
  ['brow-l', 'brow.l', `<path d="M318 224 Q338 218 356 228" stroke="${HAIR}" stroke-width="6" fill="none" stroke-linecap="round"/>`, 'hair'],
  ['nose', 'nose', `<path d="M300 272 L295 292 L303 293" stroke="${SKIN_D}" stroke-width="3" fill="none" stroke-linecap="round"/>`],
  ['mouth-open', 'mouth.open', `<ellipse cx="${m.cx}" cy="${m.cy + 2}" rx="12" ry="8" fill="${LIP}"/><ellipse cx="${m.cx}" cy="${m.cy + 6}" rx="7" ry="3" fill="#d46f6f"/>`],
  ['mouth-wide', 'mouth.wide', `<ellipse cx="${m.cx}" cy="${m.cy + 6}" rx="15" ry="14" fill="${LIP}"/><rect x="${m.cx - 10}" y="${m.cy - 6}" width="20" height="5" fill="#ffffff"/><ellipse cx="${m.cx}" cy="${m.cy + 13}" rx="9" ry="4" fill="#d46f6f"/>`],
  ['mouth-smile', 'mouth.smile', `<path d="M${m.cx - 16} ${m.cy - 2} Q${m.cx} ${m.cy + 10} ${m.cx + 16} ${m.cy - 2}" stroke="${LIP}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`],
  ['mouth-e', 'mouth.e', `<path d="M${m.cx - 18} ${m.cy} Q${m.cx} ${m.cy + 14} ${m.cx + 18} ${m.cy} Z" fill="${LIP}"/><rect x="${m.cx - 12}" y="${m.cy}" width="24" height="3" fill="#ffffff"/>`],
  ['mouth-i', 'mouth.i', `<path d="M${m.cx - 20} ${m.cy} Q${m.cx} ${m.cy + 18} ${m.cx + 20} ${m.cy} Q${m.cx} ${m.cy + 4} ${m.cx - 20} ${m.cy}Z" fill="${LIP}"/><rect x="${m.cx - 15}" y="${m.cy + 1}" width="30" height="7" fill="#ffffff"/>`],
  ['mouth-u', 'mouth.u', `<ellipse cx="${m.cx}" cy="${m.cy + 2}" rx="6" ry="6" fill="${LIP}"/>`],
  ['mouth-o', 'mouth.o', `<ellipse cx="${m.cx}" cy="${m.cy + 4}" rx="9" ry="12" fill="${LIP}"/>`],
  ['blush', 'blush', `<ellipse cx="248" cy="292" rx="18" ry="8" fill="#ff8a8a" fill-opacity="0.45"/><ellipse cx="352" cy="292" rx="18" ry="8" fill="#ff8a8a" fill-opacity="0.45"/>`],
  ['hair-side', 'hair.side', `<path d="M196 210 Q190 330 214 440 L234 430 Q218 330 226 220Z" fill="${HAIR}"/><path d="M404 210 Q410 330 386 440 L366 430 Q382 330 374 220Z" fill="${HAIR}"/>`, 'hair'],
  ['hair-front', 'hair.front', `<path d="M200 236 Q196 132 300 130 Q404 132 400 236 L380 214 L362 238 L340 206 L318 236 L296 204 L272 236 L250 208 L232 238 L216 214Z" fill="${HAIR}"/>`, 'hair'],
];

async function main() {
  const images: PartImage[] = [];
  for (const [id, slot, body, color] of PARTS) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
    const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const t = await trimRgba(data, info.width, info.height);
    if (!t) throw new Error(`part ${id} is empty`);
    images.push({ id, slot, ...t, color });
  }
  const { pages, parts } = await packAtlas(images, { max: 1024, meshScale: 0.6 });
  const model = buildTemplateRig(PLACEHOLDER_LANDMARKS, parts, { id: 'placeholder', name: 'Placeholder', template: 'placeholder', textures: pages.map((_, i) => `page${i}.png`), colors: { hair: HAIR, skin: SKIN, eyes: EYE, cloth1: SHIRT, cloth2: PANTS } });
  const c = checkPuppet(model);
  if (!c.ok) throw new Error(c.errors.join('\n'));
  const dir = 'apps/web/public/puppets/placeholder';
  mkdirSync(dir, { recursive: true });
  // Rounded to 0.01 px: smaller, and nothing visible changes.
  writeFileSync(`${dir}/puppet.json`, puppetJson(model));
  pages.forEach((p, i) => writeFileSync(`${dir}/page${i}.png`, p));
  console.log(`placeholder: ${parts.length} parts, ${model.deformers.length} deformers, ${model.bindings.length} bindings, ${pages.length} page(s), ${parts.reduce((n, p) => n + p.mesh.positions.length / 2, 0)} vertices`);
}

void main();
