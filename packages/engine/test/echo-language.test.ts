import { describe, expect, it } from 'vitest';
import { echo } from '../src/index.js';

describe('story language (live: a German story switched to English with ECHO on)', () => {
  it('detects the language and asks to keep it', () => {
    expect(echo.storyLanguage('Miki hält inne und sieht Rin an. "Das ist nicht dein Ernst", sagt sie und legt die Feder auf den Tresen, die Augen auf den Stiefel gerichtet, und lächelt dann.')).toBe('German');
    expect(echo.storyLanguage('Miki stops and looks at Rin. "You cannot be serious," she says, and puts the pen on the counter with her eyes on the boot.')).toBe('English');
    expect(echo.languageLine('English')).toBe('');
    expect(echo.languageLine('German')).toContain('Keep writing in German');
  });
});
