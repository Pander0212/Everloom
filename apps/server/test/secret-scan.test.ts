/** The pre-commit key scan: finds a listed secret by hash, wherever it sits, without storing it. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { findSecrets, loadHashes } from '../../../scripts/check-secrets.mjs';

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
});
