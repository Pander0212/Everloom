/**
 * The TypeScript half of the template gates (docs/character-studio/making-templates.md): schema and
 * semantic checks (duplicate ids, z conflicts, adult layers), and slider distortion — every cage
 * set at both slider extremes, and every body type with its smallest and largest sizes, must keep the grid's local area ratio within bounds (no folds, no
 * blow-ups). Exit code 1 on any failure.
 *
 *   npx tsx tools/studio/check-template.ts path/to/template.json
 */
import { readFileSync } from 'node:fs';
import { BODY_TYPES, gridDistortion, migrateTemplate, resolvedSliders, SLIDERS, TraitSheetSchema, validateTemplate } from '@everloom/engine/studio';

const AREA_MIN = 0.55, AREA_MAX = 1.8;
const file = process.argv[2];
if (!file) { console.error('usage: check-template.ts template.json'); process.exit(2); }
const t = migrateTemplate(JSON.parse(readFileSync(file, 'utf8')));
const errors = validateTemplate(t);
const distortion: Record<string, { min: number; max: number }> = {};
for (const slot of t.slots) {
  for (const s of SLIDERS) for (const v of [-1, 1]) {
    if (!slot.cages.some((c) => c.slider === s)) continue;
    const d = gridDistortion([0, 0, t.width, t.height], slot.cages, { [s]: v });
    distortion[`${slot.id}:${s}=${v}`] = { min: +d.min.toFixed(3), max: +d.max.toFixed(3) };
    if (d.min < AREA_MIN || d.max > AREA_MAX) errors.push(`slot ${slot.id}: ${s} at ${v} distorts the grid (area ×${d.min.toFixed(2)}…×${d.max.toFixed(2)})`);
  }
  // Every body type with the smallest and largest sizes (what sheets can actually ask for).
  for (const type of BODY_TYPES) for (const size of ['small', 'large'] as const) {
    const sheet = TraitSheetSchema.parse({ name: 'x', sex: 'female', age: 30, body: { type, breast: size, hips: size } });
    const d = gridDistortion([0, 0, t.width, t.height], slot.cages, resolvedSliders(sheet));
    distortion[`${slot.id}:${type}/${size}`] = { min: +d.min.toFixed(3), max: +d.max.toFixed(3) };
    if (d.min < AREA_MIN || d.max > AREA_MAX) errors.push(`slot ${slot.id}: a ${type} body with ${size} sizes distorts the grid (area ×${d.min.toFixed(2)}…×${d.max.toFixed(2)})`);
  }
}
console.log(JSON.stringify({ ok: !errors.length, errors, distortion }, null, 1));
process.exit(errors.length ? 1 : 0);
