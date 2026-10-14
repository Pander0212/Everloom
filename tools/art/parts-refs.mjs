#!/usr/bin/env node
// Reference images for the 3D parts library (docs/art/parts-queue.json), one at a time through
// gen.mjs (free models, quota and ledger checks there), with a pause between calls.
//
//   NANOGPT_API_KEY=… node tools/art/parts-refs.mjs [--model z-image-turbo] [--max 10] [--only id,id]
//
// Images go to ART_RAW_DIR (default ~/Everloom-Tripo/refs). Items that already have a kept or
// pending reference in the ledger are skipped. Stops at the first refusal or quota message.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { values: a } = parseArgs({ options: { model: { type: 'string', default: 'z-image-turbo' }, max: { type: 'string', default: '10' }, only: { type: 'string' }, pause: { type: 'string', default: '4' } } });
const queue = JSON.parse(readFileSync(path.join(root, 'docs/art/parts-queue.json'), 'utf8'));
const ledger = () => JSON.parse(readFileSync(path.join(root, 'docs/art/ledger.json'), 'utf8'));
const out = process.env.ART_RAW_DIR || path.join(os.homedir(), 'Everloom-Tripo', 'refs');
mkdirSync(out, { recursive: true });

const only = a.only ? new Set(a.only.split(',')) : null;
const done = new Set(ledger().entries.filter((e) => e.ok && e.kept !== false && /^parts-/.test(e.label)).map((e) => e.label.replace(/^parts-/, '')));
const todo = queue.items.filter((i) => (only ? only.has(i.id) : !done.has(i.id)));
let made = 0;
for (const item of todo) {
  if (made >= Number(a.max)) break;
  const prompt = queue.templates[item.category].replace('{subject}', item.subject);
  const model = item.model ?? a.model;
  const res = model === 'z-image-turbo' ? '1024*1024' : '1024x1024';
  let line = null;
  for (let attempt = 0; attempt < 4 && !line; attempt++) {
    try {
      line = execFileSync(process.execPath, [path.join(root, 'tools/art/gen.mjs'), '--service', 'nano', '--model', model, '--res', res, '--label', `parts-${item.id}`, '--prompt', prompt], { encoding: 'utf8', env: { ...process.env, ART_RAW_DIR: out } }).trim().split('\n').at(-1);
    } catch (e) {
      // A transient outage (HTTP 503) is retried after a pause; anything else stops the batch.
      const last = ledger().entries.at(-1);
      if (ledger().stopped || !/HTTP 50[23]/.test(last?.error ?? '')) {
        console.log(JSON.stringify({ id: item.id, error: last?.error ?? String(e.message).slice(0, 300), stopped: ledger().stopped ?? null }));
        process.exit(1);
      }
      await new Promise((s) => setTimeout(s, 20_000 * (attempt + 1)));
    }
  }
  if (!line) break;
  const r = JSON.parse(line);
  console.log(JSON.stringify({ id: item.id, n: r.n, ok: r.ok, file: r.file, today: r.nanoToday }));
  if (r.stopped || !r.ok) break;
  made++;
  await new Promise((s) => setTimeout(s, Number(a.pause) * 1000));
}
console.log(`made ${made}; ${existsSync(out) ? out : ''}`);
