/**
 * A synthetic Character Studio template pack drawn from simple shapes (no art, safe for the repo's
 * tests): two standing poses and a two-option scene, with two hairstyles, bangs, a top and a skirt,
 * a smile, recolour masks and body cages. Used by the e2e tests and to try the studio without
 * generated templates.
 *
 *   npx tsx tools/studio/fixture-pack.ts out.zip
 */
import { writeFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import sharp from 'sharp';

const W = 400, H = 800;
const svg = (body: string) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`)).png().toBuffer();
const SKIN = '#f3cfb6', HAIR = '#3b2a22', LINE = 'stroke="#5a3a2a" stroke-width="2"';

/** One pose: arms down, or the left arm waving. */
async function pose(id: string, name: string, wave: boolean) {
  const armL = wave ? '<path d="M258 268 L300 200 L320 120" fill="none" stroke="#f3cfb6" stroke-width="26" stroke-linecap="round"/>' : '<path d="M258 268 L297 376 L333 475" fill="none" stroke="#f3cfb6" stroke-width="26" stroke-linecap="round"/>';
  const files: Record<string, Buffer> = {
    'body.png': await svg(`<g ${LINE}><ellipse cx="200" cy="150" rx="46" ry="58" fill="${SKIN}"/><rect x="185" y="200" width="30" height="40" fill="${SKIN}"/><path d="M148 250 Q200 230 252 250 L262 440 Q200 470 138 440 Z" fill="${SKIN}"/>
      <path d="M166 440 L160 605 L156 765" fill="none" stroke="${SKIN}" stroke-width="44" stroke-linecap="round"/><path d="M234 440 L240 605 L244 765" fill="none" stroke="${SKIN}" stroke-width="44" stroke-linecap="round"/>
      <path d="M142 268 L103 376 L67 475" fill="none" stroke="${SKIN}" stroke-width="26" stroke-linecap="round"/>${armL}
      <ellipse cx="183" cy="150" rx="5" ry="7" fill="#3b2a1f"/><ellipse cx="217" cy="150" rx="5" ry="7" fill="#3b2a1f"/><path d="M190 182 L210 182" stroke="#b5665a" stroke-width="3"/></g>`),
    'eyes-mask.png': await svg(`<ellipse cx="183" cy="150" rx="5" ry="7" fill="#fff"/><ellipse cx="217" cy="150" rx="5" ry="7" fill="#fff"/>`),
    'hair-long.png': await svg(`<path d="M150 120 Q200 60 250 120 L262 330 L138 330 Z" fill="${HAIR}" ${LINE}/>`),
    'hair-bob.png': await svg(`<path d="M150 120 Q200 60 250 120 L256 210 L144 210 Z" fill="${HAIR}" ${LINE}/>`),
    'bangs.png': await svg(`<path d="M154 120 Q200 80 246 120 L240 135 L160 135 Z" fill="${HAIR}"/>`),
    'tee.png': await svg(`<path d="M146 250 Q200 232 254 250 L262 330 L256 400 L144 400 L138 330 Z" fill="#ffffff" ${LINE}/>`),
    'skirt.png': await svg(`<path d="M140 420 L260 420 L285 520 L115 520 Z" fill="#2f3e75" ${LINE}/>`),
    'smile.png': await svg(`<path d="M188 180 Q200 192 212 180" fill="none" stroke="#b5665a" stroke-width="3"/>`),
  };
  const L = (lid: string, part: string, z: number, extra: object = {}) => ({ id: lid, part, file: `${lid}.png`, rect: [0, 0, W, H], z, ...extra });
  const template = {
    format: 'everloom-studio-template', version: 1, id, name, category: 'standing', rating: 'all-ages', width: W, height: H, tags: wave ? ['greeting'] : ['neutral'],
    supports: { hairBack: ['long_straight', 'bob'], hairFront: ['bangs', 'none'], expressions: ['neutral', 'smile'], wardrobe: { top: ['tee'], bottom: ['skirt'] } },
    slots: [{
      id: 'a', sex: ['female'],
      layers: [
        L('hair-long', 'hairBack', 5, { when: { 'hair.back': ['long_straight', 'long_wavy', 'twin_tails', 'braid'] }, recolor: [{ kind: 'hair', base: HAIR }] }),
        L('hair-bob', 'hairBack', 5, { when: { 'hair.back': ['bob', 'short', 'ponytail', 'bun'] }, recolor: [{ kind: 'hair', base: HAIR }] }),
        L('body', 'body', 10, { recolor: [{ kind: 'skin', base: SKIN }, { kind: 'eyes', base: '#3b2a1f', mask: 'eyes-mask.png' }] }),
        L('skirt', 'clothing', 18, { when: { 'wardrobe.bottom': 'skirt' } }),
        L('tee', 'clothing', 20, { when: { 'wardrobe.top': 'tee' } }),
        L('smile', 'expression', 31, { when: { expression: 'smile' } }),
        L('bangs', 'hairFront', 40, { when: { 'hair.front': ['bangs', 'side_swept', 'parted'] }, recolor: [{ kind: 'hair', base: HAIR }] }),
      ],
      cages: [
        { id: 'waist', slider: 'waist', rest: [[140, 330], [260, 330], [262, 420], [138, 420]], min: [[155, 330], [245, 330], [250, 420], [150, 420]], max: [[120, 330], [280, 330], [285, 420], [115, 420]], margin: 30 },
        { id: 'hips', slider: 'hips', rest: [[138, 420], [262, 420], [262, 500], [138, 500]], min: [[150, 420], [250, 420], [250, 500], [150, 500]], max: [[118, 420], [282, 420], [282, 500], [118, 500]], margin: 30 },
      ],
      rig: { breathe: [140, 240, 120, 120], pivot: [200, 440], bounce: [] },
      keypoints: { headTop: [200, 92], neck: [200, 210], pelvis: [200, 430] },
    }],
  };
  return { template, files };
}

async function scene() {
  const id = 'park-bench';
  const files: Record<string, Buffer> = {
    'bg-day.png': await svg('<rect width="400" height="800" fill="#bfe3ff"/><rect y="560" width="400" height="240" fill="#7fbf6a"/>'),
    'bg-evening.png': await svg('<rect width="400" height="800" fill="#f2a065"/><rect y="560" width="400" height="240" fill="#5f8f50"/>'),
  };
  const p = await pose(id, 'Park bench', false);
  Object.assign(files, p.files);
  const t = p.template as Record<string, any>;
  t.category = 'scene'; t.name = 'Park bench'; t.tags = ['outdoor'];
  t.options = [{ id: 'time', label: 'Time', values: [{ id: 'day', label: 'Afternoon' }, { id: 'evening', label: 'Evening' }], default: 'day' }];
  t.slots[0].layers.unshift(
    { id: 'bg-day', part: 'background', file: 'bg-day.png', rect: [0, 0, W, H], z: 0, when: { 'option.time': 'day' } },
    { id: 'bg-evening', part: 'background', file: 'bg-evening.png', rect: [0, 0, W, H], z: 0, when: { 'option.time': 'evening' } },
  );
  return { template: t, files };
}

export async function fixturePack(): Promise<Buffer> {
  const out: Record<string, Uint8Array> = {};
  for (const { template, files } of [await pose('stand-neutral', 'Standing', false), await pose('stand-wave', 'Waving', true), await scene()]) {
    out[`${template.id}/template.json`] = strToU8(JSON.stringify(template));
    for (const [f, b] of Object.entries(files)) out[`${template.id}/${f}`] = new Uint8Array(b);
  }
  return Buffer.from(zipSync(out));
}

if (process.argv[1]?.endsWith('fixture-pack.ts')) {
  writeFileSync(process.argv[2] ?? 'studio-fixture.zip', await fixturePack());
  console.log('wrote', process.argv[2] ?? 'studio-fixture.zip');
}
