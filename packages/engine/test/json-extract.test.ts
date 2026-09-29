import { describe, expect, it } from 'vitest';
import { extractJson } from '../src/index.js';

describe('extractJson', () => {
  it('parses clean JSON', () => {
    expect(extractJson('{"ops":[]}').value).toEqual({ ops: [] });
  });
  it('handles fences and prose', () => {
    const r = extractJson('Sure! Here you go:\n```json\n{"ops":[{"type":"time.advance","minutes":5}]}\n```\nHope that helps.');
    expect(r.ok).toBe(true);
    expect((r.value as any).ops[0].minutes).toBe(5);
  });
  it('handles trailing commas and comments', () => {
    const r = extractJson('{"ops":[{"type":"item.add","name":"Tea",}, // added\n],}');
    expect(r.ok).toBe(true);
    expect((r.value as any).ops).toHaveLength(1);
  });
  it('handles single quotes, unquoted keys and Python literals', () => {
    const r = extractJson("{ops: [{type: 'item.add', name: 'Iced Lemon Tea', stackable: True}]}");
    expect(r.ok).toBe(true);
    expect((r.value as any).ops[0].name).toBe('Iced Lemon Tea');
    expect((r.value as any).ops[0].stackable).toBe(true);
  });
  it('closes truncated output', () => {
    const r = extractJson('{"ops":[{"type":"time.advance","minutes":20},{"type":"item.add","name":"Br');
    expect(r.ok).toBe(true);
    expect((r.value as any).ops[0].minutes).toBe(20);
  });
  it('handles smart quotes', () => {
    const r = extractJson('{“ops”: []}');
    expect(r.ok).toBe(true);
  });
  it('keeps apostrophes inside double-quoted strings', () => {
    const r = extractJson(`{"ops":[{"type":"databank.add","text":"Iris doesn't like crowds"}]}`);
    expect((r.value as any).ops[0].text).toBe("Iris doesn't like crowds");
  });
  it('fails cleanly on garbage', () => {
    expect(extractJson('no json here at all').ok).toBe(false);
    expect(extractJson('').ok).toBe(false);
  });
});
