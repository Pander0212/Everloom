#!/usr/bin/env node
// Creates a new extension folder from the template: everloom-extension.json, a background script,
// a panel, and a README. Then point Everloom at the folder (Settings › Extensions › Developing an
// extension) and it reloads as you save.
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const name = process.argv[2];
if (!name || name.startsWith('-')) {
  console.log('Usage: create-everloom-extension <folder> [--name "Display name"]');
  process.exit(1);
}
const dir = path.resolve(name);
if (existsSync(dir) && readdirSync(dir).length) {
  console.error(`${dir} already exists and isn't empty`);
  process.exit(1);
}
const id = path.basename(dir).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'my-extension';
const at = process.argv.indexOf('--name');
const display = at > 0 && process.argv[at + 1] ? process.argv[at + 1] : id.replace(/[-_.]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const template = path.join(path.dirname(fileURLToPath(import.meta.url)), 'template');
cpSync(template, dir, { recursive: true });
for (const f of readdirSync(dir)) {
  const p = path.join(dir, f);
  const text = readFileSync(p, 'utf8').replaceAll('__ID__', id).replaceAll('__NAME__', display);
  writeFileSync(p, text);
}
console.log(`Created ${display} in ${dir}

Next:
  1. Settings › Extensions › Developing an extension: enter ${dir}
     (it must be inside EVERLOOM_IMPORT_ROOTS, your home folder by default)
  2. Open a chat: the panel is in the actions menu, /hello in the message box.
  3. Edit the files; Everloom reloads the extension when you save.
  4. To share it, zip the folder (or push it to a Git repository).`);
