import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { packPath, packProblems, packSlots, partForItem, PackManifestSchema } from '../src/index.js';

const BASICS = path.resolve(__dirname, '../../../apps/web/public/avatar/packs/basics');
const manifest = PackManifestSchema.parse(JSON.parse(readFileSync(path.join(BASICS, 'manifest.json'), 'utf8')));

describe('part packs (CharacterStudio format)', () => {
  it('reads the built-in pack: body group, slots, files', () => {
    expect(packSlots(manifest)).toMatchObject({ body: 'BODY', slots: { HAIR: 'hair', TOP: 'top', SHOES: 'feet', HAT: 'head' } });
    expect(packPath(manifest, 'hair/bob.glb')).toBe('traits/hair/bob.glb');
    expect(packPath(manifest, 'hair/bob.png', 'thumbnail')).toBe('thumbnails/hair/bob.png');
    expect(packProblems(manifest, () => true)).toEqual([]);
  });

  it('explains what is wrong with a bad pack', () => {
    const missing = packProblems(manifest, (p) => !p.endsWith('bob.glb'));
    expect(missing).toEqual(['HAIR/bob: "traits/hair/bob.glb" is missing from the pack.']);
    const noBody = PackManifestSchema.parse({ traits: [{ trait: 'HAT', collection: [{ id: 'a', directory: 'a.fbx' }] }], initialTraits: { HAT: 'b' } });
    expect(packProblems(noBody, () => true)).toEqual([expect.stringMatching(/No body group/), expect.stringMatching(/not a VRM or GLB/), expect.stringMatching(/initialTraits/)]);
    expect(PackManifestSchema.safeParse({ traits: [] }).success).toBe(false);
    // CharacterStudio's own extra fields are accepted.
    expect(PackManifestSchema.safeParse({ ...manifest, price: 3, solanaPurchaseAssets: {}, traits: manifest.traits }).success).toBe(true);
  });

  it('finds the part an inventory item puts on', () => {
    expect(partForItem(manifest, { name: 'Iron Helmet', category: 'armor', slot: 'head' })).toMatchObject({ group: 'HAT', part: { id: 'helmet' } });
    expect(partForItem(manifest, { name: 'Old leather boots', slot: 'feet' })).toMatchObject({ group: 'SHOES', part: { id: 'boots' } });
    expect(partForItem(manifest, { name: 'Wool Sweater', slot: 'body' })).toMatchObject({ group: 'TOP', part: { id: 'sweater' } });
    expect(partForItem(manifest, { name: 'Travelling cape', slot: 'back' })).toMatchObject({ group: 'EXTRA', part: { id: 'cape' } });
    expect(partForItem(manifest, { name: 'Sword', category: 'weapon', slot: 'weapon' })).toBeNull();
  });
});
