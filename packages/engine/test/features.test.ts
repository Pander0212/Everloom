import { describe, expect, it } from 'vitest';
import { AI_OP_TYPES, allowedOpTypes, buildTrackerPrompt, createInitialState, dependentsOf, effectiveFeatures, effectiveWorld, FEATURES, normalizeFeatures, opFeature, presetFeatures, presetOf, requirementsOf, toggleFeature, WORLD_PROFILES, type WorldSettings } from '../src/index.js';

const world: WorldSettings = { profile: 'max', recallLimit: 6, sceneBudget: 1100, ...WORLD_PROFILES.max };

describe('feature switches', () => {
  it('every requirement names a real feature, and there are no cycles', () => {
    const ids = new Set(FEATURES.map((f) => f.id));
    for (const f of FEATURES) for (const r of f.requires) expect(ids.has(r)).toBe(true);
    for (const f of FEATURES) expect(requirementsOf(f.id)).not.toContain(f.id);
  });
  it('turning something off turns off what depends on it, and says so first', () => {
    expect(dependentsOf('map')).toEqual(expect.arrayContaining(['travel', 'home']));
    expect(dependentsOf('time')).toEqual(expect.arrayContaining(['travel', 'npcs', 'weather', 'offscreen']));
    const r = toggleFeature(presetFeatures('full'), 'map', false);
    expect(r.also.sort()).toEqual(['home', 'travel']);
    expect(r.set.on).toMatchObject({ map: false, travel: false, home: false, time: true });
    // Turning travel back on brings back what it needs.
    const back = toggleFeature(r.set, 'travel', true);
    expect(back.also).toEqual(['map']);
  });
  it('presets: Classic has no game and no memory; a hand-made set that equals a preset is that preset', () => {
    const classic = presetFeatures('classic');
    expect(classic.memory).toBe('off');
    expect(FEATURES.filter((f) => f.group === 'game' || f.group === 'helpers').every((f) => !classic.on[f.id])).toBe(true);
    expect(presetOf(normalizeFeatures(classic))).toBe('classic');
    expect(presetOf(toggleFeature(presetFeatures('full'), 'dice', false).set)).toBe('custom');
    const story = presetFeatures('story');
    expect(story.on).toMatchObject({ stage: true, journal: true, inventory: false, battle: false, map: false });
    expect(normalizeFeatures(story)).toEqual(story);
  });
  it('a chat preset wins over the global switches', () => {
    expect(effectiveFeatures({ preset: 'full', set: presetFeatures('full') }, 'classic').on.game).toBe(false);
    expect(effectiveFeatures({ preset: 'classic', set: presetFeatures('classic') }, 'full').on.game).toBe(true);
    expect(effectiveFeatures({ preset: 'classic', set: presetFeatures('classic') }, null).on.game).toBe(false);
  });
  it('world switches are limited by the features', () => {
    const w = effectiveWorld(world, presetFeatures('classic'));
    expect(w).toMatchObject({ memory: false, semantic: false, chronicler: false, consolidate: false, social: false, preRead: false, pulse: false, threads: false, dice: false });
    const summary = effectiveWorld(world, { ...presetFeatures('full'), memory: 'summary' });
    expect(summary).toMatchObject({ chronicler: true, semantic: false, consolidate: false });
  });
  it('the tracker op list shrinks to the enabled modules', () => {
    expect(opFeature('item.add')).toBe('inventory');
    expect(opFeature('travel')).toBe('travel');
    expect(opFeature('music.set')).toBe('music');
    expect(opFeature('tracker.delta')).toBe('trackers');
    expect(allowedOpTypes(AI_OP_TYPES, presetFeatures('classic'))).toEqual([]);
    expect(allowedOpTypes(AI_OP_TYPES, presetFeatures('full'))).toEqual(AI_OP_TYPES);
    const story = allowedOpTypes(AI_OP_TYPES, presetFeatures('story'));
    expect(story).toContain('quest.add');
    expect(story).not.toContain('item.add');
    expect(story).not.toContain('battle.start');
    const state = createInitialState({ title: 't', seed: 1, playerName: 'P' });
    const full = buildTrackerPrompt(state, [], {});
    const lean = buildTrackerPrompt(state, [], { allowed: story });
    expect(lean.system).not.toContain('"type":"item.add"');
    expect(lean.system.length).toBeLessThan(full.system.length * 0.75);
  });
});
