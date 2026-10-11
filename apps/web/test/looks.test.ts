/** Every theme passes WCAG AA for text, and the base tokens match app.css (docs/ux/themes.md). */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASE, LOOKS, looksCss, tokensOf, type Scheme, type Tokens } from '@/themes/looks';

type RGB = [number, number, number];
function parse(c: string, over?: RGB): RGB {
  const hex = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = /^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(c.trim());
  if (!m) throw new Error(`can't read ${c}`);
  const rgb: RGB = [Number(m[1]), Number(m[2]), Number(m[3])];
  const a = m[4] === undefined ? 1 : Number(m[4]);
  if (a >= 1 || !over) return rgb;
  return rgb.map((v, i) => v * a + over[i]! * (1 - a)) as RGB;
}
const lum = ([r, g, b]: RGB) => {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export const contrast = (a: RGB, b: RGB) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

/** Text tokens against the backgrounds they sit on (AA for normal text: 4.5:1). */
const PAIRS: Array<[keyof Tokens, keyof Tokens]> = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'], ['text', 'surface-3'],
  ['text-2', 'bg'], ['text-2', 'surface'], ['text-2', 'surface-2'],
  ['text-3', 'bg'], ['text-3', 'surface'],
  ['accent-text', 'bg'], ['accent-text', 'surface'],
  ['accent-fg', 'accent'],
  ['danger', 'bg'], ['danger', 'surface'],
];

const cases = LOOKS.flatMap((l) => l.schemes.map((s) => [`${l.name} (${s})`, l, s] as const));

describe('themes pass WCAG AA', () => {
  it.each(cases)('%s', (_n, l, s) => {
    const t = tokensOf(l, s as Scheme);
    const bg = parse(t.bg);
    const fails: string[] = [];
    for (const [fg, on] of PAIRS) {
      const back = parse(t[on], bg);
      const r = contrast(parse(t[fg], back), back);
      if (r < 4.5) fails.push(`${fg} on ${on}: ${r.toFixed(2)}`);
    }
    // Accent-soft fills (selected rows, chips) still carry accent text.
    const soft = parse(t['accent-soft'], parse(t.surface));
    const r = contrast(parse(t['accent-text']), soft);
    if (r < 4.5) fails.push(`accent-text on accent-soft: ${r.toFixed(2)}`);
    expect(fails).toEqual([]);
  });
});

describe('the base tokens are app.css’s', () => {
  const css = readFileSync(path.resolve(import.meta.dirname, '../src/styles/app.css'), 'utf8');
  const block = (selector: string) => {
    const i = css.indexOf(selector);
    return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
  };
  it.each([
    ['light', ':root,'],
    ['dark', "[data-theme='dark'] {"],
  ] as const)('%s', (s, selector) => {
    const b = block(selector);
    for (const [k, v] of Object.entries(BASE[s as Scheme])) {
      const m = new RegExp(`--${k}:\\s*([^;]+);`).exec(b);
      expect(m?.[1]?.trim(), `--${k}`).toBe(v);
    }
  });
});

describe('the generated stylesheet', () => {
  it('scopes every look and keeps its extra rules inside it', () => {
    const css = looksCss();
    for (const l of LOOKS) expect(css).toContain(`[data-look='${l.id}']`);
    expect(css).not.toMatch(/(^|\n)\s*&/);
    expect(css).not.toContain('undefined');
  });
});
