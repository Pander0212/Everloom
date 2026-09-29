import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.resolve(here, '../../../tests/fixtures');
export function fixture(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES, rel)));
}
