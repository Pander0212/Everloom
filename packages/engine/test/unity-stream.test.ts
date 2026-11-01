import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { streamTar } from '../src/unity/stream';
import { readTar, DEFAULT_TAR_LIMITS } from '../src/unity/tar';
const data = gunzipSync(readFileSync(join(__dirname, '../../../tests/fixtures/unity/Ava.unitypackage')));
async function* split(bytes: Uint8Array, n = 137) { for (let i = 0; i < bytes.length; i += n) yield bytes.subarray(i, i + n); }
it('reads arbitrary stream boundaries with backpressure, matching the synchronous parser', async () => {
  const actual = [];
  for await (const e of streamTar(split(data))) {
    const chunks = [];
    for await (const c of e.chunks) chunks.push(c);
    actual.push({ name: e.name, size: e.size, data: Buffer.concat(chunks) });
  }
  const expected = readTar(data);
  expect(actual.map(e => [e.name, e.size])).toEqual(expected.map(e => [e.name, e.size]));
  for (let i = 0; i < actual.length; i++) expect(actual[i]!.data.equals(Buffer.from(expected[i]!.data))).toBe(true);
});
it('drains entries skipped by the consumer and rejects corrupt or truncated headers', async () => {
  const names = [];
  for await (const e of streamTar(split(data))) names.push(e.name);
  expect(names).toEqual(readTar(data).map(e => e.name));
  const bad = Buffer.from(data); bad[0] = bad[0]! ^ 1;
  await expect(streamTar(split(bad)).next()).rejects.toThrow(/checksum/);
  await expect(streamTar(split(data.subarray(0, 200))).next()).rejects.toThrow(/Truncated/);
  const consume = async () => { for await (const _ of streamTar(split(data), { ...DEFAULT_TAR_LIMITS, maxTotalBytes: 10 })) {} };
  await expect(consume()).rejects.toThrow(/limit/);
});
