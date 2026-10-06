import { describe, expect, it } from 'vitest';
import { AI_OP_TYPES, BUILTIN_EMOTES, buildTrackerPrompt, createInitialState, installedEmotes, normalizeAvatarOps, opReferenceFor, resolveEmote } from '../src/index.js';

describe('emotes for the story', () => {
  const installed = installedEmotes([{ id: 'salute', label: 'Salute', category: 'social' }, { id: 'tango', label: 'Tango', category: 'dance' }]);

  it('resolves ids, labels and aliases, and never guesses', () => {
    expect(resolveEmote(installed, 'waves')?.id).toBe('wave');
    expect(resolveEmote(installed, 'Shake head')?.id).toBe('shake_head');
    expect(resolveEmote(installed, 'salute')?.id).toBe('salute');
    expect(resolveEmote(installed, 'backflip')).toBeNull();
    expect(installed.find((e) => e.id === 'tango')?.loop).toBe(true);
  });

  it('keeps known emotes (as ids) and drops unknown ones and non-pose poses', () => {
    const r = normalizeAvatarOps(
      [
        { type: 'avatar.emote', who: 'Mara', emote: 'hello' },
        { type: 'avatar.emote', who: 'Mara', emote: 'moonwalk' },
        { type: 'avatar.pose', who: 'Mara', pose: 'sitting' },
        { type: 'avatar.pose', who: 'Mara', pose: 'wave' },
        { type: 'avatar.pose', who: 'Mara', pose: null },
        { type: 'time.advance', minutes: 5 },
      ],
      installed,
    );
    expect(r.ok).toEqual([
      { type: 'avatar.emote', who: 'Mara', emote: 'wave' },
      { type: 'avatar.pose', who: 'Mara', pose: 'sit' },
      { type: 'avatar.pose', who: 'Mara', pose: null },
      { type: 'time.advance', minutes: 5 },
    ]);
    expect(r.rejected.map((x) => x.reason)).toEqual(['No emote called "moonwalk"', 'No pose called "wave"']);
  });

  it('lists the installed emotes in the prompt only when given', () => {
    const allowed = [...AI_OP_TYPES];
    expect(opReferenceFor(allowed)).not.toContain('avatar.emote');
    const ref = opReferenceFor(allowed, { emotes: installed });
    expect(ref).toContain('"type":"avatar.emote"');
    expect(ref).toContain('salute');
    expect(ref).toMatch(/pose is one of: [^\n]*\bsit\b/);
    const { system } = buildTrackerPrompt(createInitialState(), [{ name: 'Mara', role: 'assistant', text: 'She waves.' }], { allowed, emotes: BUILTIN_EMOTES });
    expect(system).toContain('wave');
  });
});
