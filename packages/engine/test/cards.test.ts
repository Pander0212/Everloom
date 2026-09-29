import { describe, expect, it } from 'vitest';
import {
  base64ToUtf8, buildV2Json, characterBookToWorld, extractChunks, parseCardJson, readCardFile, readCardFromPng, readPngText,
  worldToCharacterBook, writeCardToPng,
} from '../src/index.js';
import { fixture } from './helpers.js';

describe('character cards', () => {
  const png = fixture('st/Seraphina.png');

  it('reads the SillyTavern sample card (ccv3 preferred)', () => {
    const card = readCardFromPng(png);
    expect(card.data.name).toBe('Seraphina');
    expect(card.data.first_mes.length).toBeGreaterThan(50);
    expect(card.data.description).toContain('Seraphina');
    expect(['v2', 'v3']).toContain(card.spec);
  });

  it('round-trips through our PNG writer without losing fields', () => {
    const original = readCardFromPng(png);
    const out = writeCardToPng(png, original.data, original.topLevelExtras);
    // Output is a valid PNG with chunks and both keys.
    expect(extractChunks(out).at(-1)!.name).toBe('IEND');
    const text = readPngText(out);
    expect(text.chara).toBeTruthy();
    expect(text.ccv3).toBeTruthy();
    const v2 = JSON.parse(base64ToUtf8(text.chara));
    expect(v2.spec).toBe('chara_card_v2');
    expect(v2.name).toBe('Seraphina');
    expect(v2.data.name).toBe('Seraphina');
    const again = readCardFromPng(out);
    const strip = (d: any) => JSON.parse(JSON.stringify(d));
    expect(strip(again.data)).toEqual(strip(original.data));
    // Image data chunks are untouched.
    const idat = (b: Uint8Array) => extractChunks(b).filter((c) => c.name === 'IDAT').map((c) => c.data.length);
    expect(idat(out)).toEqual(idat(png));
  });

  it('exports V2 shape matching SillyTavern (V1 mirror fields + data)', () => {
    const card = readCardFromPng(png);
    const json = buildV2Json(card.data);
    for (const k of ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creatorcomment', 'tags', 'spec', 'spec_version', 'data']) {
      expect(json).toHaveProperty(k);
    }
    expect(json.data.extensions).toHaveProperty('talkativeness');
    expect(json.data.extensions).toHaveProperty('depth_prompt');
  });

  it('parses V1 and V3 JSON', () => {
    const v1 = parseCardJson({ name: 'Old', description: 'd', first_mes: 'hi', talkativeness: '0.7' });
    expect(v1.spec).toBe('v1');
    expect(v1.data.extensions.talkativeness).toBe(0.7);
    const v3 = parseCardJson({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'New', description: 'x', group_only_greetings: ['yo'], custom_field: 1 } });
    expect(v3.spec).toBe('v3');
    expect(v3.data.group_only_greetings).toEqual(['yo']);
    expect(v3.data.custom_field).toBe(1);
  });

  it('reads JSON files via readCardFile', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'J', alternate_greetings: ['a', 'b'] } }));
    const card = readCardFile(bytes);
    expect(card.data.alternate_greetings).toEqual(['a', 'b']);
  });

  it('converts character_book to world and back', () => {
    const book = {
      name: 'Book',
      entries: [
        { id: 3, keys: ['sword'], secondary_keys: ['old'], content: 'An old sword.', insertion_order: 50, enabled: true, position: 'after_char' as const, extensions: { depth: 2, selectiveLogic: 3, probability: 80, useProbability: true } },
      ],
    };
    const world = characterBookToWorld(book);
    const e = world.entries['3'];
    expect(e.key).toEqual(['sword']);
    expect(e.position).toBe(1);
    expect(e.selectiveLogic).toBe(3);
    expect(e.probability).toBe(80);
    const back = worldToCharacterBook(world);
    expect(back.entries[0].keys).toEqual(['sword']);
    expect(back.entries[0].insertion_order).toBe(50);
    expect(back.entries[0].extensions.selectiveLogic).toBe(3);
  });
});
