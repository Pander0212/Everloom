import { describe, expect, it } from 'vitest';
import { applyOps, buildSceneBlock, createInitialState, DROP_ORDER, NARRATOR_CONTRACT, SCENE_LINE_LABELS, SCENE_SECTIONS, type CampaignState, type Op } from '../src/index.js';

const world = (): CampaignState => {
  let s = createInitialState({ seed: 3, playerName: 'Anala' });
  const ops: object[] = [
    { type: 'location.upsert', name: 'Northcrest', level: 'region' },
    { type: 'location.upsert', name: 'The Lantern', parent: 'Northcrest', kind: 'building', description: 'A small bar lit by paper lanterns.' },
    { type: 'location.upsert', name: 'Market Square', parent: 'Northcrest' },
    { type: 'location.move', to: 'The Lantern' },
    { type: 'item.add', name: 'Umbrella' },
    { type: 'item.add', name: 'Guitar' },
    { type: 'quest.add', title: 'Find a singer', objectives: ['Ask Tobias'] },
    { type: 'org.upsert', name: 'The Ravens', location: 'The Lantern' },
  ];
  for (let i = 0; i < 8; i++) ops.push({ type: 'npc.upsert', name: `Patron ${String.fromCharCode(65 + i)}`, location: 'The Lantern', appearance: 'A regular with a long coat and a longer story.' });
  ops.push({ type: 'npc.upsert', name: 'Tobias Moreno', location: 'The Lantern' }, { type: 'outfit.set', who: 'Tobias Moreno', text: 'a soaked green raincoat' }, { type: 'npc.vitals', name: 'Patron A', state: 'unconscious' });
  s = applyOps(s, ops as Op[], { source: 'user' }).state;
  return s;
};
const tobias = (s: CampaignState) => Object.values(s.npcs).find((n) => n.name === 'Tobias Moreno')!.id;
const view = (s: CampaignState) => ({
  storySoFar: ['Anala arrived in Northcrest on a rainy night and found work at the Lantern.'],
  recalled: [{ text: 'Tobias asked Anala to sing for the Ravens.', gameTime: s.time.minutes }],
  people: { [tobias(s)]: { knows: ['Tobias asked Anala to sing for the Ravens.'], heard: [], doesNotKnow: ['Iris told Anala where the key is.'] } },
  referenced: new Set([tobias(s)]),
  dice: ['Agility check (hard, 40% odds): a failure.'],
  happens: ['A song starts up.'],
});

describe('scene block', () => {
  it('the narrator contract names every section and line label exactly as the engine writes them', () => {
    for (const sec of SCENE_SECTIONS) expect(NARRATOR_CONTRACT, sec).toContain(sec);
    for (const label of SCENE_LINE_LABELS) expect(NARRATOR_CONTRACT, label).toContain(label.replace(/:$/, ''));
    const s = world();
    const text = buildSceneBlock(s, view(s), { budgetTokens: 5000 }).text;
    for (const m of text.matchAll(/^## (.+)$/gm)) expect(SCENE_SECTIONS as readonly string[]).toContain(m[1]);
    for (const m of text.matchAll(/^ {2}([A-Z][A-Z ()]+(?:\([^)]*\))?):/gm)) expect(SCENE_LINE_LABELS.map((l) => l.replace(/:$/, '')), m[1]).toContain(m[1]);
    expect(text).toContain('WEARING: a soaked green raincoat');
    expect(text).toContain('WARNING: UNCONSCIOUS');
  });

  it('drops lines in the documented order and never drops the core', () => {
    const s = world();
    const full = buildSceneBlock(s, view(s), { budgetTokens: 5000 });
    expect(full.dropped).toEqual([]);
    const tight = buildSceneBlock(s, view(s), { budgetTokens: 250 });
    // Dropped kinds appear in DROP_ORDER order.
    const kinds = tight.dropped.map((d) => DROP_ORDER.indexOf(d.drop as any));
    expect(kinds.length).toBeGreaterThan(0);
    for (let i = 1; i < kinds.length; i++) expect(kinds[i]).toBeGreaterThanOrEqual(kinds[i - 1]);
    // "Does not know" is the first thing to go, before any person's own detail.
    expect(tight.dropped[0].drop).toBe('does-not-know');
    // The core stays: where you are, who is referenced, the dice, what happens, the exits.
    for (const must of ['## NOW', '## LOCATION', 'The Lantern', '- Tobias Moreno', '## THE DICE', 'Agility check', '## SOMETHING HAPPENS', '## EXITS']) expect(tight.text, must).toContain(must);
    expect(tight.tokens).toBeLessThan(full.tokens);
  });

  it('is deterministic', () => {
    const s = world();
    expect(buildSceneBlock(s, view(s), { budgetTokens: 600 }).text).toBe(buildSceneBlock(s, view(s), { budgetTokens: 600 }).text);
  });
});
