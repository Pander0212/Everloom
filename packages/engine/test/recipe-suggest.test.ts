/** Found on live NanoGPT runs: models add an equipment slot to cooked food, which used to reject the whole recipe. */
import { describe, expect, it } from 'vitest';
import { parseRecipeSuggestion } from '../src/index.js';

describe('recipe suggestions from a model', () => {
  it('drops an invalid optional field instead of failing', () => {
    const r = parseRecipeSuggestion(JSON.stringify({ name: 'Campfire Stew', ingredients: [{ name: 'Rabbit meat', qty: 1 }, { name: 'Wild onion', qty: 2 }], result: { name: 'Campfire Stew', qty: 2, category: 'food', slot: 'consumable' } }), 'cooking');
    expect(r.name).toBe('Campfire Stew');
    expect(r.result.slot).toBeUndefined();
    expect(r.ingredients).toHaveLength(2);
  });
  it('still fails when something required is missing', () => {
    expect(() => parseRecipeSuggestion(JSON.stringify({ name: 'Stew', result: { name: 'Stew' } }), 'cooking')).toThrow(/incomplete/);
  });
});
