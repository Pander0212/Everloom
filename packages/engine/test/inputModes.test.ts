import { describe, expect, it } from 'vitest';
import { frameInput } from '../src/inputModes.js';

describe('input modes', () => {
  it('frames each mode for the model, leaves plain chat alone', () => {
    expect(frameInput('act', 'open the door')).toBe('*open the door*');
    expect(frameInput('act', '*waves*')).toBe('*waves*');
    expect(frameInput('say', 'Hello there')).toBe('"Hello there"');
    expect(frameInput('say', '"Hi"')).toBe('"Hi"');
    expect(frameInput('story', 'The storm breaks.')).toMatch(/^\[Narration written by the player.*\]\nThe storm breaks\.$/);
    expect(frameInput('direct', 'Make it scarier')).toMatch(/^\[Out of character.*\]\nMake it scarier$/);
    expect(frameInput(null, 'plain')).toBe('plain');
  });
});
