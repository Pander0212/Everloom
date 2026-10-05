#!/usr/bin/env node
/**
 * Refuses a commit that contains a known secret (the artwork API keys, or anything else listed).
 *
 * The secrets themselves are never stored: .git/info/everloom-secret-hashes (local, never committed)
 * holds "<length> <sha256>" per line, and EVERLOOM_SECRET_HASHES may add more ("len:sha256,…").
 * Every staged text file is split into runs of key-like characters; each window of a listed length
 * is hashed and compared. Run by the pre-commit hook (scripts/hooks/pre-commit); `--all` scans the
 * whole working tree instead of the staged files.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function loadHashes(root, env = process.env.EVERLOOM_SECRET_HASHES ?? '') {
  const list = [];
  const file = path.join(root, '.git', 'info', 'everloom-secret-hashes');
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  for (const l of [...lines, ...env.split(',').map((x) => x.replace(':', ' '))]) {
    const m = /^\s*(\d+)\s+([0-9a-f]{64})\s*$/.exec(l);
    if (m) list.push({ length: Number(m[1]), hash: m[2] });
  }
  return list;
}

/** Positions of any listed secret in the text (by hash; the secret itself is never needed). */
export function findSecrets(text, hashes) {
  if (!hashes.length) return [];
  const want = new Map();
  for (const h of hashes) want.set(h.length, [...(want.get(h.length) ?? []), h.hash]);
  const hits = [];
  for (const run of text.matchAll(/[A-Za-z0-9_\-.]{16,}/g)) {
    const s = run[0];
    for (const [len, list] of want) {
      for (let i = 0; i + len <= s.length; i++) {
        const digest = createHash('sha256').update(s.slice(i, i + len)).digest('hex');
        if (list.includes(digest)) hits.push(run.index + i);
      }
    }
  }
  return hits;
}

function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const hashes = loadHashes(root);
  if (!hashes.length) return 0;
  const all = process.argv.includes('--all');
  const files = (all ? execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }) : execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd: root, encoding: 'utf8' })).split('\n').filter(Boolean);
  const bad = [];
  for (const f of files) {
    let buf;
    try {
      buf = all ? readFileSync(path.join(root, f)) : execFileSync('git', ['show', `:${f}`], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
    } catch {
      continue;
    }
    // Text only: a NUL in the first 8 KB means binary (pictures can't carry a pasted key by accident).
    if (buf.subarray(0, 8192).includes(0)) continue;
    const text = buf.toString('utf8');
    for (const at of findSecrets(text, hashes)) bad.push(`${f}:${text.slice(0, at).split('\n').length}`);
  }
  if (bad.length) {
    console.error(`Commit refused: an API key is in ${bad.join(', ')}. Remove it (keys never go in the repository).`);
    return 1;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
