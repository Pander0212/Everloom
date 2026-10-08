#!/usr/bin/env node
/**
 * Refuses a commit that stages puppet art (docs/puppets.md › Packs): generated parts, layer
 * results and built packs are shared as packs, never committed. The one exception is the
 * placeholder puppet made from simple shapes. Run by the pre-commit hook; `--all` checks every
 * tracked file instead of the staged ones.
 */
import { execFileSync } from 'node:child_process';

const ALLOWED = /^apps\/web\/public\/puppets\/placeholder\//;
const ART = /\.(png|webp|avif|jpe?g|psd|zip)$/i;

export function packArt(files) {
  return files.filter((f) => {
    if (ALLOWED.test(f)) return false;
    if (/(^|\/)\.puppets-work\//.test(f)) return true;
    if (/everloom-puppets-[^/]*\.zip$/i.test(f)) return true;
    return ART.test(f) && /(^|\/)(puppets?|puppet-packs?|seethrough[^/]*|see-through[^/]*)\//i.test(f);
  });
}

function main() {
  const all = process.argv.includes('--all');
  const files = execFileSync('git', all ? ['ls-files'] : ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const bad = packArt(files);
  if (bad.length) {
    console.error(`Commit refused: puppet art goes in packs, not the repository: ${bad.slice(0, 8).join(', ')}${bad.length > 8 ? ` (and ${bad.length - 8} more)` : ''}`);
    return 1;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
