import { describe, expect, it } from 'vitest';
import { OpSchema } from '@everloom/engine';
import { parseSteps } from '../src/features/game/tools/cutsceneScript';

describe('cutscene scripts', () => {
  it('reads dialogue, narration, emotes and outfit changes', () => {
    const steps = parseSteps('The hall falls silent.\nMara: Shall we? {bow}\nMara: {outfit: Ball gown} One moment.\nTomas: Back to normal {outfit: none}');
    expect(steps).toEqual([
      { text: 'The hall falls silent.' },
      { speaker: 'Mara', text: 'Shall we?', emote: 'bow' },
      { speaker: 'Mara', text: 'One moment.', outfit: 'Ball gown' },
      { speaker: 'Tomas', text: 'Back to normal', outfit: null },
    ]);
  });
  it('keeps the op valid, and refuses a malformed emote', () => {
    const add = (steps: unknown[]) => OpSchema.safeParse({ type: 'cutscene.add', name: 'Ball', steps });
    expect(add(parseSteps('Mara: Shall we? {bow}')).success).toBe(true);
    expect(add([{ text: 'x', speaker: 'Mara', emote: 'Not An Emote!' }]).success).toBe(false);
  });
});
