import { describe, expect, it } from 'vitest';
import { AI_OP_TYPES, applyOp, applyOps, createInitialState, invertOps, OpSchemas, pickPlaylist, validateOps, type CampaignState, type Op, type OpType, type Playlist } from '../src/index.js';

const ALL = Object.keys(OpSchemas) as OpType[];
const v = (op: unknown): Op => {
  const r = validateOps([op], ALL);
  if (!r.ok.length) throw new Error(`invalid op: ${r.rejected[0]?.error}`);
  return r.ok[0]!;
};
const ok = (s: CampaignState, op: unknown) => {
  const r = applyOp(s, v(op), { source: 'user' });
  if (r.error) throw new Error(r.error);
  return r.state;
};

describe('stage', () => {
  it('effect cues get their own ids and only the last 20 are kept', () => {
    let s = createInitialState({ style: 'fantasy' });
    for (let i = 0; i < 25; i++) s = ok(s, { type: 'fx.play', effect: i % 2 ? 'flash' : 'shake' });
    expect(s.stage!.cues).toHaveLength(20);
    expect(new Set(s.stage!.cues.map((c) => c.id)).size).toBe(20);
    expect(s.stage!.cues[0]).toMatchObject({ intensity: 0.6, seconds: 1.2 });
  });

  it('the director keeps one layer per character and bumps its cue on each change', () => {
    let s = createInitialState({ style: 'fantasy' });
    s = ok(s, { type: 'npc.upsert', name: 'Mara Quill' });
    s = ok(s, { type: 'stage.layer', character: 'mara', position: 'left', expression: 'joy', anim: 'bounce' });
    const a = s.stage!.layers['mara quill']!;
    expect(a).toMatchObject({ name: 'Mara Quill', position: 'left', expression: 'joy', anim: 'bounce' });
    s = ok(s, { type: 'stage.layer', character: 'Mara Quill', position: 'right' });
    expect(s.stage!.layers['mara quill']).toMatchObject({ position: 'right', expression: 'joy', anim: 'none' });
    expect(s.stage!.layers['mara quill']!.cue).toBeGreaterThan(a.cue);
    s = ok(s, { type: 'stage.clear' });
    expect(s.stage!.layers).toEqual({});
  });

  it('cutscenes are authored, played by name and stopped', () => {
    let s = createInitialState({ style: 'modern' });
    s = ok(s, { type: 'cutscene.add', name: 'Opening Night', steps: [{ text: 'The curtain rises.', fx: 'fade' }, { text: 'A spotlight finds you.', speaker: 'Narrator', mood: 'tense' }] });
    s = ok(s, { type: 'cutscene.play', name: 'opening night' });
    expect(s.stage!.playing?.id).toBe(Object.keys(s.stage!.cutscenes)[0]);
    expect(applyOp(s, v({ type: 'cutscene.play', name: 'Nope' })).error).toMatch(/No cutscene/);
    s = ok(s, { type: 'cutscene.stop' });
    expect(s.stage!.playing).toBeNull();
  });

  it('music and ambience; the model may direct the stage but not author cutscenes', () => {
    let s = createInitialState({ style: 'fantasy' });
    s = ok(s, { type: 'music.set', mood: 'Tense' });
    s = ok(s, { type: 'ambient.set', kind: 'rain' });
    expect(s.stage).toMatchObject({ music: { playlist: null, mood: 'tense' }, ambient: 'rain' });
    expect(AI_OP_TYPES).toEqual(expect.arrayContaining(['fx.play', 'stage.layer', 'music.set', 'ambient.set', 'cutscene.play']));
    expect(AI_OP_TYPES).not.toContain('cutscene.add');
  });

  it('every stage op is undone exactly by its inverse', () => {
    const s0 = createInitialState({ style: 'fantasy' });
    const ops: unknown[] = [
      { type: 'fx.play', effect: 'shake' },
      { type: 'stage.layer', character: 'Iris', position: 'center', anim: 'fade-in' },
      { type: 'cutscene.add', name: 'Dawn', steps: [{ text: 'Light.' }] },
      { type: 'cutscene.play', name: 'Dawn' },
      { type: 'music.set', mood: 'calm', playlist: 'Tavern' },
      { type: 'ambient.set', kind: 'fire' },
      { type: 'cutscene.remove', name: 'Dawn' },
      { type: 'stage.clear' },
    ];
    const r = applyOps(s0, ops.map(v), { source: 'user' });
    expect(r.errors).toEqual([]);
    expect(invertOps(r.state, r.inverses)).toEqual(s0);
  });
});

describe('music for the moment', () => {
  const lists: Playlist[] = [
    { id: 'a', name: 'Calm', mood: 'calm', tracks: ['m1'] },
    { id: 'b', name: 'Fights', mood: 'battle', tracks: ['m2'] },
    { id: 'c', name: 'Tavern nights', mood: 'calm', place: 'building', time: 'night', tracks: ['m3'] },
    { id: 'd', name: 'Any building', mood: 'calm', place: 'building', tracks: ['m4'] },
    { id: 'e', name: 'Nights', mood: 'calm', time: 'night', tracks: ['m5'] },
    { id: 'f', name: 'Empty', mood: 'tense', tracks: [] },
  ];
  const at = (hour: number) => {
    let s = createInitialState({ style: 'fantasy' });
    s = ok(s, { type: 'location.upsert', name: 'The Lantern', kind: 'building' });
    s = ok(s, { type: 'location.move', to: 'The Lantern' });
    return ok(s, { type: 'time.until', hour });
  };
  it('a scene request wins; battles get the battle playlist; then the most specific place and time', () => {
    expect(pickPlaylist(at(22), lists)?.id).toBe('c');
    expect(pickPlaylist(at(12), lists)?.id).toBe('d');
    let s = ok(at(12), { type: 'music.set', mood: 'calm' });
    expect(pickPlaylist(s, lists)?.id).toBe('a');
    s = ok(s, { type: 'battle.start', enemies: [{ name: 'Rat', level: 1, count: 1 }] });
    expect(pickPlaylist(s, lists)?.id).toBe('b');
    s = ok(s, { type: 'music.set', playlist: 'Tavern nights' });
    expect(pickPlaylist(s, lists)?.id).toBe('c');
    // A playlist with no tracks is never picked.
    expect(pickPlaylist(ok(at(12), { type: 'music.set', mood: 'tense' }), lists)?.id).toBe('d');
  });
  it('new effects are valid ops', () => {
    let s = createInitialState({ style: 'fantasy' });
    for (const effect of ['fog', 'embers', 'lightning'] as const) s = ok(s, { type: 'fx.play', effect });
    expect(s.stage!.cues.map((c) => c.effect)).toEqual(['fog', 'embers', 'lightning']);
  });
});
