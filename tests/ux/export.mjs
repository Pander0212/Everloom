// Copies a UX run's screenshots (as WebP) and numbers into docs/ux: node tests/ux/export.mjs <label>
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const sharp = createRequire(path.resolve('apps/server/package.json'))('sharp');
const label = process.argv[2] ?? 'after';
const src = `tests/ux/.artifacts/out/screens/${label}`;
for (const project of readdirSync(src)) {
  const out = `docs/ux/screens/${label}/${project}`;
  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(`${src}/${project}`)) {
    await sharp(`${src}/${project}/${f}`).resize({ width: 900, withoutEnlargement: true }).webp({ quality: 72 }).toFile(`${out}/${f.replace(/\.png$/, '.webp')}`);
  }
}
for (const f of [`tasks-${label}.json`, `controls-${label}.json`]) if (existsSync(`tests/ux/.artifacts/out/${f}`)) cpSync(`tests/ux/.artifacts/out/${f}`, `docs/ux/evidence/${f}`);
console.log('exported', label);
