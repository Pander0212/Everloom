import { describe, expect, it } from 'vitest';
import { addressee } from '../src/services/echo.js';

const npc = (id: string, name: string, extra: object = {}) => ({ id, name, aliases: [], role: '', title: '', appearance: '', ...extra });
const state = { npcs: { a: npc('a', 'Gravitas Hail', { role: 'Guildmaster', appearance: 'A one-armed dwarf with a grey beard' }), b: npc('b', 'Miki', { role: 'Receptionist', appearance: 'A blonde young woman' }), c: npc('c', 'Bolin', { appearance: 'A broad young man' }) } } as any;

describe('who the player is talking to', () => {
  it('by name, role, or a descriptor only one present person fits; ambiguous gives null', () => {
    expect(addressee(state, ['player', 'a', 'b'], 'I ask Miki where the board is.')).toBe('b');
    expect(addressee(state, ['player', 'a', 'b'], 'I go up to the guildmaster.')).toBe('a');
    expect(addressee(state, ['player', 'a', 'b'], 'I go up to the one-armed dwarf and ask him quietly.')).toBe('a');
    expect(addressee(state, ['player', 'b'], 'I ask the dwarf.')).toBeNull();
    expect(addressee(state, ['player', 'a', 'b'], 'I ask Miki and Gravitas together.')).toBeNull();
    expect(addressee(state, ['player', 'a', 'b'], 'I look around the hall.')).toBeNull();
  });
});
