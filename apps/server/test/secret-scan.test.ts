/** The pre-commit key scan: finds a listed secret by hash, wherever it sits, without storing it. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { findKeyShapes, findSecrets, loadHashes } from '../../../scripts/check-secrets.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const fake = 'ek-TEST0000fake1111secret2222value3333xyz';
const entry = `${fake.length}:${createHash('sha256').update(fake).digest('hex')}`;

describe('secret scan', () => {
  it('finds a listed secret by hash, inside other text, and nothing else', () => {
    const hashes = loadHashes('/nonexistent', entry);
    expect(hashes).toHaveLength(1);
    expect(findSecrets(`const key = "${fake}";\n`, hashes)).toEqual([13]);
    expect(findSecrets(`Authorization: Bearer ${fake}`, hashes)).toHaveLength(1);
    expect(findSecrets(`prefix${fake}suffix`, hashes)).toHaveLength(1);
    expect(findSecrets(fake.slice(0, -1), hashes)).toEqual([]);
    expect(findSecrets('nothing to see', hashes)).toEqual([]);
  });
  it('the hash list file holds only lengths and digests', () => {
    expect(entry).toMatch(/^\d+:[0-9a-f]{64}$/);
    expect(entry).not.toContain(fake);
  });
  it('finds RunPod, NanoGPT and Hugging Face key shapes, not placeholders', () => {
    // Built at run time so this file never holds a key-shaped string.
    const runpod = ['rpa', 'A1B2C3D4E5F6G7H8J9K0L1M2N3P4Q5R6S7T8xyz'].join('_');
    const nano = ['sk', 'nano', '01234567-89ab-cdef-0123-456789abcdef'].join('-');
    const hf = ['hf', 'abcdefghijklmnopqrstuvwxyzABCDEFGH'].join('_');
    expect(findKeyShapes(`a\nRUNPOD_API_KEY=${runpod}\n`)).toEqual([2]);
    expect(findKeyShapes(`key: ${nano}`)).toEqual([1]);
    expect(findKeyShapes(`token ${hf}`)).toEqual([1]);
    expect(findKeyShapes('RUNPOD_API_KEY=rpa_… and sk-nano-xxxx and hf_token')).toEqual([]);
  });
  it('no tracked file holds a key-shaped string', () => {
    const root = path.resolve(__dirname, '../../..');
    let files: string[];
    try { files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return; }
    const bad: string[] = [];
    for (const f of files) {
      if (/(^|\/)check-secrets\.mjs$|secret-scan\.test\.ts$/.test(f)) continue;
      let buf: Buffer;
      try { buf = readFileSync(path.join(root, f)); } catch { continue; }
      if (buf.length > 20_000_000 || buf.subarray(0, 8192).includes(0)) continue;
      for (const line of findKeyShapes(buf.toString('utf8'))) bad.push(`${f}:${line}`);
    }
    expect(bad).toEqual([]);
  });
});
