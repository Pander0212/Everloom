import { describe, expect, it } from 'vitest';
import { AvatarConfigSchema, regionMask, resolveWardrobe } from '../src/index.js';

const cfg = AvatarConfigSchema.parse({
  parts: [
    { id: 'hair_long', name: 'Long hair', meshes: ['HairLong'], group: 'hair' },
    { id: 'hair_bun', name: 'Bun', meshes: ['HairBun'], group: 'hair', on: false },
    { id: 'coat', name: 'Coat', meshes: ['Coat'], hides: ['chest', 'belly', 'upperArms'], on: false },
    { id: 'helmet', name: 'Helmet', meshes: ['Helmet'], on: false, items: ['Iron Helmet'], hides: ['head'] },
    { id: 'shirt', name: 'Shirt', meshes: ['Shirt'], hides: ['chest', 'belly'] },
  ],
  outfits: [
    { id: 'winter', name: 'Winter', parts: ['coat', 'hair_bun'], items: ['Fur Coat'] },
    { id: 'ball', name: 'Ballgown', model: 'm_ballgownmodel', parts: [] },
  ],
  outfit: null,
  accessories: [
    { id: 'sword', name: 'Sword', model: 'm_sword', bone: 'rightHand', items: ['Longsword'] },
    { id: 'glasses', name: 'Glasses', model: 'm_glasses', bone: 'head' },
  ],
});

describe('wardrobe', () => {
  it('defaults: parts as set, unlinked accessories on', () => {
    const w = resolveWardrobe(cfg);
    expect(w.outfit).toBeNull();
    expect(w.parts).toEqual({ hair_long: true, hair_bun: false, coat: false, helmet: false, shirt: true });
    expect(w.accessories.map((a) => a.id)).toEqual(['glasses']);
    expect(w.hidden).toEqual(['chest', 'belly']);
  });

  it('equipped items pick an outfit, show linked parts and accessories', () => {
    const w = resolveWardrobe(cfg, { equipped: ['fur coat', 'Iron Helmet', 'Longsword'] });
    expect(w.reason).toBe('items');
    expect(w.outfit?.id).toBe('winter');
    expect(w.parts).toMatchObject({ coat: true, hair_bun: true, hair_long: false, helmet: true });
    expect(w.accessories.map((a) => a.id)).toEqual(['sword', 'glasses']);
    expect(w.hidden).toEqual(['head', 'chest', 'belly', 'upperArms']);
    expect(regionMask(w.hidden)).toBe((1 << 0) | (1 << 2) | (1 << 3) | (1 << 5));
  });

  it("the story's outfit wins over items and default (by id or name)", () => {
    expect(resolveWardrobe({ ...cfg, outfit: 'winter' }, { story: 'Ballgown', equipped: ['Fur Coat'] })).toMatchObject({ reason: 'story', outfit: { id: 'ball', model: 'm_ballgownmodel' } });
    expect(resolveWardrobe({ ...cfg, outfit: 'winter' })).toMatchObject({ reason: 'default', outfit: { id: 'winter' } });
    // An unknown story outfit falls back rather than failing.
    expect(resolveWardrobe(cfg, { story: 'pirate costume' }).reason).toBe('none');
  });
});

describe('garments (wardrobe level 3)', () => {
  const g = (id: string, slot: string, layer: number, extra: object = {}) => ({ id, name: id, model: `m_${id}`, slot, layer, ...extra });
  const c = AvatarConfigSchema.parse({
    garments: [
      g('tee', 'top', 1, { hides: ['chest', 'belly'], variants: [{ id: 'red', name: 'Red', tint: '#cc2222' }] }),
      g('blouse', 'top', 1, { on: false, hides: ['chest', 'belly', 'upperArms'] }),
      g('coat', 'outer', 3, { on: false, items: ['Wool Coat'], hides: ['forearms'] }),
      g('jeans', 'bottom', 1, { hides: ['hips', 'thighs', 'knees'] }),
      g('gown', 'full', 1, { on: false }),
    ],
    outfits: [{ id: 'party', name: 'Party', garments: [{ id: 'gown' }, { id: 'tee', variant: 'red' }] }],
  });

  it('wears the defaults, one per slot and layer, inner layers first', () => {
    const w = resolveWardrobe(c);
    expect(w.garments.map((x) => x.garment.id)).toEqual(['tee', 'jeans']);
    expect(w.hidden).toEqual(['chest', 'belly', 'hips', 'thighs', 'knees']);
  });

  it('an outfit replaces the defaults; equipped items layer on top', () => {
    const w = resolveWardrobe({ ...c, outfit: 'party' }, { equipped: ['wool coat'] });
    expect(w.garments.map((x) => [x.garment.id, x.variant])).toEqual([
      ['gown', null],
      ['tee', 'red'],
      ['coat', null],
    ]);
    expect(w.hidden).toContain('forearms');
  });
});
