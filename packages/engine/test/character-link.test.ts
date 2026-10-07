import { describe, expect, it } from 'vitest';
import { applyOps, createInitialState, nameMatchScore, OpSchemas, validateOps, type Op, type OpType } from '../src/index.js';

const ALL = Object.keys(OpSchemas) as OpType[];
const ops = (list: unknown[]): Op[] => validateOps(list, ALL).ok;

describe('linking story names to library characters', () => {
  it('prefers the exact name over one that only shares a first name', () => {
    // A bare first name is a close match too.
    expect(nameMatchScore('Wren', 'Wren Ashdown')).toBeGreaterThanOrEqual(0.9);
    const characters = [
      { id: 'ch_wren', name: 'Wren' },
      { id: 'ch_ash', name: 'Wren Ashdown' },
    ];
    const s0 = createInitialState({ seed: 1 });
    const r = applyOps(s0, ops([{ type: 'party.add', name: 'Wren Ashdown' }]), { source: 'user', characters });
    const m = Object.values(r.state.party)[0]!;
    expect(m.characterId).toBe('ch_ash');
    // Order in the library doesn't matter.
    const r2 = applyOps(s0, ops([{ type: 'party.add', name: 'Wren Ashdown' }]), { source: 'user', characters: [...characters].reverse() });
    expect(Object.values(r2.state.party)[0]!.characterId).toBe('ch_ash');
  });
});
