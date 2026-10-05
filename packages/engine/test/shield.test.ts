import { describe, expect, it } from 'vitest';
import { buildShield, makeStandin, mapJsonStrings, matchCase, standinClashes, termsInScope, type ShieldTerm } from '../src/index.js';

const T = (o: Partial<ShieldTerm>): ShieldTerm => ({ id: o.real ?? 'x', real: 'Lena Brook', standin: 'Mira Hollis', kind: 'full', forms: [], scope: { type: 'all' }, ...o });

describe('name shield', () => {
  const s = buildShield([T({ forms: ['Lenny'] }), T({ id: 'p', real: 'Brookfield', standin: 'Larkmoor', kind: 'place' }), T({ id: 'u', real: 'Åsa', standin: 'Elin', kind: 'first' })]);
  it('swaps whole words, keeps endings and the capitalization pattern', () => {
    expect(s.outbound("Lena's cat, LENA BROOK, lena, Lenny and Helena in Brookfield; the Brooks.")).toBe("Mira's cat, MIRA HOLLIS, mira, Mira and Helena in Larkmoor; the Holliss.");
    expect(s.outbound('Åsa och ÅSA')).toBe('Elin och ELIN');
    expect(s.inbound("Mira's friend MIRA HOLLIS went to Larkmoor.")).toBe("Lena's friend LENA BROOK went to Brookfield.");
    expect(matchCase('mira', 'LENA')).toBe('MIRA');
  });
  it('restores streamed text split anywhere, without the stand-in ever showing', () => {
    const text = 'She said "Mira Hollis is in Larkmoor." Mirage stays.';
    for (let size = 1; size <= 7; size++) {
      const r = s.restorer();
      let out = '';
      for (let i = 0; i < text.length; i += size) {
        const piece = r.push(text.slice(i, i + size));
        expect(piece).not.toMatch(/Mira |Hollis|Larkmoor/);
        out += piece;
      }
      out += r.flush();
      expect(out).toBe('She said "Lena Brook is in Brookfield." Mirage stays.');
    }
  });
  it('finds leaks, maps JSON strings only, and flags shortened stand-ins', () => {
    expect(s.leaks('hi Lena')).toEqual(['Lena']);
    expect(mapJsonStrings({ Lena: ['Lena', 1] }, (x) => s.outbound(x))).toEqual({ Lena: ['Mira', 1] });
    expect(buildShield([T({ standin: 'Marcus Hale' })]).possibleLeftovers('Hey Marc!')).toEqual(['Marc']);
  });
  it('scopes: a term for one chat only applies there (or when the context is unknown)', () => {
    const t = [T({ scope: { type: 'chat', id: 'c1' } })];
    expect(termsInScope(t, { chatId: 'c1' })).toHaveLength(1);
    expect(termsInScope(t, { chatId: 'c2' })).toHaveLength(0);
    expect(termsInScope(t, {})).toHaveLength(1);
  });
  it('stand-ins are plausible, stable for a seed, and avoid names in use', () => {
    expect(makeStandin('first', 'seed')).toBe(makeStandin('first', 'seed'));
    const avoid = ['Mira', 'Tomas', 'Elin'];
    expect(avoid).not.toContain(makeStandin('first', 'seed', avoid));
    expect(makeStandin('full', 'x').split(' ')).toHaveLength(2);
    expect(standinClashes([T({ standin: 'Iris Hale' })], ['Iris Thorne']).map((x) => x.standin)).toEqual(['Iris Hale']);
  });
});
