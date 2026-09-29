import { describe, expect, it } from 'vitest';
import { applyOps, buildNewGameState, createInitialState, defaultNewGame, generateMapScene, locationPath, validateOps, type Op } from '../src/index.js';

function world() {
  return applyOps(createInitialState({ seed: 11 }), [
    { type: 'location.upsert', name: 'Aurel', level: 'world', parent: null, x: 500, y: 500 } as Op,
    { type: 'location.upsert', name: 'Greenmarch', level: 'region', parent: 'Aurel', x: 400, y: 450 } as Op,
    { type: 'location.upsert', name: 'Saltreach', level: 'region', parent: 'Aurel', x: 700, y: 300 } as Op,
    { type: 'location.upsert', name: 'Northcrest', parent: 'Greenmarch', kind: 'town' } as Op,
    { type: 'location.upsert', name: 'The Lantern', parent: 'Northcrest', kind: 'building' } as Op,
    { type: 'location.move', to: 'The Lantern' } as Op,
  ], { source: 'user' }).state;
}

describe('procedural map', () => {
  it('is deterministic and includes terrain, roads and nodes', () => {
    const s = world();
    const a = generateMapScene(s, 'loc_aurel');
    const b = generateMapScene(s, 'loc_aurel');
    expect(a).toEqual(b);
    expect(a.level).toBe('region');
    expect(a.nodes.map((n) => n.name).sort()).toEqual(['Greenmarch', 'Saltreach']);
    expect(a.terrain.find((t) => t.kind === 'land')!.d.length).toBeGreaterThan(50);
    expect(a.roads.length).toBe(1);
    expect(a.nodes.find((n) => n.name === 'Greenmarch')!.containsCurrent).toBe(true);
  });
  it('uses street grids for towns and floor plans indoors', () => {
    const s = world();
    const town = generateMapScene(s, 'loc_northcrest');
    expect(town.grid).not.toBe('hex');
    expect(town.nodes[0].current).toBe(true);
    expect(town.nodes[0].pin).toBe('you');
    const inside = generateMapScene(s, 'loc_the_lantern');
    expect(inside.base).toBe('floor');
  });
  it('different seeds give different maps', () => {
    const s = world();
    const t = { ...s, meta: { ...s.meta, seed: 99 } };
    expect(generateMapScene(s, 'loc_aurel').terrain).not.toEqual(generateMapScene(t, 'loc_aurel').terrain);
  });
  it('locationPath walks up to the root', () => {
    expect(locationPath(world(), 'loc_the_lantern').map((l) => l.name)).toEqual(['Aurel', 'Greenmarch', 'Northcrest', 'The Lantern']);
  });
  it('location.set refuses cycles', () => {
    const r = applyOps(world(), [{ type: 'location.set', id: 'loc_aurel', patch: { parentId: 'loc_the_lantern' } } as Op], { source: 'user' });
    expect(r.errors[0].error).toMatch(/inside itself/);
    expect(validateOps([{ type: 'location.set', id: 'x', patch: {} }]).ok).toHaveLength(0);
  });
});

describe('new game', () => {
  it('builds a complete starting state', () => {
    const cfg = defaultNewGame(5);
    cfg.title = 'Rainy Northcrest';
    cfg.style = 'modern';
    cfg.character = { ...cfg.character, name: 'Anala', className: 'Bard', resourceProfile: 'mp', level: 3, customBars: [{ label: 'Sanity', max: 50 }] };
    cfg.currency = { name: 'Dollars', symbol: '$', amount: 42 };
    cfg.items = [{ name: 'Guitar', qty: 1, category: 'tool' }, { name: 'Leather Jacket', qty: 1, category: 'clothing', equipped: true }];
    cfg.groups = [{ name: 'The Ravens', type: 'band', standing: 70 }];
    cfg.quests = [{ title: 'Find a stage', objectives: ['Ask around'] }];
    cfg.npcs = [{ name: 'Iris Thorne', role: 'Bartender' }];
    cfg.location = { world: 'Earth', region: 'Northcrest', local: 'Market Row', description: 'Wet cobbles and neon.', kind: 'district' };
    cfg.facts = ['It has rained for three days.'];
    const s = buildNewGameState(cfg);
    expect(s.player.name).toBe('Anala');
    expect(s.player.level).toBe(3);
    expect(s.player.bars.ap).toBeUndefined();
    expect(s.player.bars.sanity.max).toBe(60);
    expect(s.player.currency).toBe(42);
    expect(Object.values(s.inventory).find((i) => i.name === 'Leather Jacket')!.equipped).toBe(true);
    expect(Object.values(s.orgs)[0].standing).toBe(70);
    expect(s.locations[s.currentLocationId!].name).toBe('Market Row');
    expect(locationPath(s, s.currentLocationId).map((l) => l.name)).toEqual(['Earth', 'Northcrest', 'Market Row']);
    expect(Object.values(s.npcs)[0].locationId).toBe(s.currentLocationId);
    expect(Object.keys(s.trackers)).toEqual(['hunger', 'energy', 'hygiene']);
    expect(buildNewGameState(cfg)).toEqual(s);
  });
});
