import { describe, expect, it } from 'vitest';
import { AI_OP_TYPES, applyOp, applyOps, createInitialState, invertOps, OpSchemas, validateOps, type CampaignState, type Op, type OpType } from '../src/index.js';

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
