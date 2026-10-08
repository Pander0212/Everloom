import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
// @ts-expect-error Vendored MIT parser has no declarations.
import { MMDParser } from '../src/features/avatar3d/runtime/vendor/mmdparser.module.js';

it('reads a real converted PMX with UTF-8 names and retains its weighted rig', () => {
  const bytes = readFileSync(path.resolve(import.meta.dirname, '../../../tests/fixtures/models/robot.pmx'));
  const parsed = new MMDParser.Parser().parsePmx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), true);
  expect(parsed.metadata.modelName).toBe('RobotExpressive CC0');
  expect(parsed.metadata.vertexCount).toBe(7214);
  expect(parsed.metadata.boneCount).toBe(74);
  expect(parsed.bones.some((bone: { name: string }) => bone.name === 'Hips')).toBe(true);
  expect(parsed.vertices.every((vertex: { skinWeights: number[] }) => Math.abs(vertex.skinWeights.reduce((sum, value) => sum + value, 0) - 1) < 0.0001)).toBe(true);
});
