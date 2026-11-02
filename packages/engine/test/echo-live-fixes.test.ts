/** Fixes found by the live NanoGPT runs (docs/echo/LIVE.md). */
import { describe, expect, it } from 'vitest';
import { echo, expandMacros, pronounsFrom } from '../src/index.js';
import { ev, here, P, persp } from './echo-helpers.js';

describe('ECHO live-run fixes', () => {
  it('ids and slot names never reach the writer', () => {
    expect(echo.humanize('npc_gravitas_hail asked_about player origin', { npc_gravitas_hail: 'Gravitas Hail', player: 'Rin' })).toBe('Gravitas Hail asked about Rin origin');
  });

  it('the narrator is told who present did not see a private moment', () => {
    const p = echo.project([
      ev({ actors: ['player'], visibility: 'secret', action: 'Rin slipped the black iron key into her left boot', establishes: [P('key', 'location', 'boot')], observers: here('player', 'dwarf') }, 1),
    ]);
    const view = echo.authorize(p, persp('player', { accessScope: 'persona-narrator' }));
    const pkt = echo.compilePacket({ view, query: echo.understand('Did anyone see what I put in my boot? The key?', { entities: {} }, 50), scene: { now: 50, present: ['player', 'dwarf'], locationId: 'hall' }, names: { dwarf: 'Gravitas Hail', player: 'Rin' }, unaware: () => ['Gravitas Hail'] });
    expect(pkt.text).toContain('[Gravitas Hail did not see or hear this and does not know it]');
    expect(pkt.text).toContain('cannot mention, notice or hint at it');
    // An NPC's own packet never gets such lines (and never the secret).
    const npc = echo.compilePacket({ view: echo.authorize(p, persp('dwarf')), query: echo.understand('the key in the boot', { entities: {} }, 50), scene: { now: 50, present: ['player', 'dwarf'], locationId: 'hall' }, names: {}, unaware: () => ['x'] });
    expect(npc.text).toBe('');
  });

  it('duplicate memories of one moment show once; an empty "to" reads cleanly', () => {
    const p = echo.project([
      ev({ actors: ['player'], action: 'Rin hid the black iron key in her left boot while unobserved', observers: here('player') }, 1),
      ev({ actors: ['player'], action: 'Rin hid the black iron key in his left boot while unobserved', observers: here('player') }, 1.01),
      ev({ type: 'promise', actors: ['player'], action: 'Rin promised to bring three wolf pelts', commitment: { id: 'c', by: 'player', to: [], what: 'bring three wolf pelts' }, observers: here('player') }, 2),
    ]);
    const pkt = echo.compilePacket({ view: echo.authorize(p, persp('player')), query: echo.understand('the iron key in my boot, and the wolf pelts', { entities: {} }, 50), scene: { now: 50, present: ['player'], locationId: 'hall' }, names: { player: 'Rin' } });
    expect(pkt.text.match(/hid the black iron key/g)).toHaveLength(1);
    expect(pkt.text).toContain('Rin promised: bring three wolf pelts');
  });

  it('pronoun macros come from the persona', () => {
    expect(expandMacros('{{user}} nods; nobody hurries {{obj}}, {{poss}} turn.', { user: 'Rin', pronouns: pronounsFrom('a lanky half-elf woman') })).toBe('Rin nods; nobody hurries her, her turn.');
    expect(expandMacros('{{sub}}', { pronouns: pronounsFrom('he/him, a sailor') })).toBe('he');
    expect(expandMacros('{{obj}}', {})).toBe('them');
  });
});
