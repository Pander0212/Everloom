/** History notes, the reply guard's pre-filter, provisional actors, and the tracker ledger check. */
import { describe, expect, it } from 'vitest';
import { echo, ledgerGaps } from '../src/index.js';
import { ev, here, P } from './echo-helpers.js';

const names = { player: 'Rin', dwarf: 'Gravitas', miki: 'Miki' };
const story = () =>
  echo.project([
    ev({ actors: ['player'], visibility: 'secret', action: 'Rin slipped the black iron key into her left boot', establishes: [P('key', 'location', 'boot')], observers: here('player', 'dwarf'), messageId: 'm6' }, 6),
    ev({ actors: ['player'], action: 'Rin bought a bow at the market', observers: here('player', 'miki'), messageId: 'm7' }, 7),
  ], { names });

describe('ECHO guard rails', () => {
  it('private moments: who present did not perceive them, with distinctive words', () => {
    const ms = echo.privateMoments(story(), ['dwarf', 'miki'], names);
    expect(ms).toHaveLength(1);
    expect(ms[0].unaware.sort()).toEqual(['dwarf', 'miki']);
    expect(ms[0].terms).toEqual(expect.arrayContaining(['slipped', 'black', 'iron', 'boot']));
    expect(echo.historyNote(ms, names)).toContain('only Rin perceived');
  });

  it('the pre-filter only fires when a reply touches the moment', () => {
    const ms = echo.privateMoments(story(), ['dwarf'], names);
    expect(echo.guardCandidates(ms, '"Aye. Black iron, old work. I noticed it in your boot."')).toHaveLength(1);
    expect(echo.guardCandidates(ms, 'The dwarf shrugs and orders another ale.')).toHaveLength(0);
    expect(echo.parseGuard('{"violations":[{"who":"Gravitas","fact":1,"quote":"I noticed"}]}')).toEqual([{ who: 'Gravitas', fact: 1, quote: 'I noticed' }]);
    expect(echo.repairInstruction([{ who: 'Gravitas', fact: 1, quote: 'I noticed' }], echo.guardCandidates(ms, 'black iron boot'))).toContain('Gravitas cannot know');
  });

  it('provisional actors: "the one-armed dwarf" until an NPC fits, then merged', () => {
    expect(echo.provisionalId('the one-armed dwarf')).toBe('anon:one_armed_dwarf');
    const merged = echo.mergeProvisional(['anon:one_armed_dwarf', 'anon:dwarf'], [{ id: 'npc_g', text: 'Gravitas Hail Guildmaster A one-armed dwarf with a grey beard' }, { id: 'npc_m', text: 'Miki receptionist' }]);
    expect(merged.get('anon:one_armed_dwarf')).toBe('npc_g');
    expect(merged.get('anon:dwarf')).toBe('npc_g');
    const p = echo.project(echo.remapActors([ev({ type: 'speech', actors: ['player'], recipients: ['anon:one_armed_dwarf'], visibility: 'private', action: 'Rin whispered she died on Earth', observers: here('player') }, 1)], merged));
    expect(p.units.map((u) => u.owner).sort()).toEqual(['npc_g', 'player']);
  });

  it('ledger: a payment or purchase the ops missed (English and German)', () => {
    expect(ledgerGaps('Rin buys a used shortbow for 12 coins.', [])).toEqual([{ kind: 'payment', evidence: 'Rin buys a used shortbow for 12 coins.', amount: 12 }, { kind: 'purchase', evidence: 'Rin buys a used shortbow for 12 coins.' }]);
    expect(ledgerGaps('Rin kauft einen Bogen für zwölf Münzen.', [{ type: 'item.add', name: 'Bogen', qty: 1 } as never]).map((g) => g.kind)).toEqual(['payment']);
    expect(ledgerGaps('Rin pays 5 coins.', [{ type: 'currency.delta', amount: -5 } as never])).toEqual([]);
    expect(ledgerGaps('The merchant offers a bow. Rin walks away.', [])).toEqual([]);
  });
});
