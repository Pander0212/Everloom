/**
 * Every tool, sheet, action, page and settings page has an entry in lib/registry.ts with a name and a
 * plain description, and the palette reaches it (docs/ux/navigation.md). The lists of what exists are
 * read from the code that renders them, so adding a tool without an entry fails here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FEATURES, presetFeatures } from '@everloom/engine';
import { describe, expect, it } from 'vitest';
import { available, ENTRIES, entryForTool, GROUPS, SETTINGS_PAGES } from '@/lib/registry';

const src = (p: string) => readFileSync(path.resolve(import.meta.dirname, '../src', p), 'utf8');

/** Keys of an object literal `const NAME ... = { key: ..., }` in a source file. */
function keysOf(file: string, name: string): string[] {
  const s = src(file);
  const start = s.indexOf(`const ${name}`);
  const body = s.slice(s.indexOf('{', s.indexOf('=', start)) + 1);
  let depth = 0;
  const keys: string[] = [];
  for (const line of body.split('\n')) {
    if (depth === 0) {
      const m = /^\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z0-9_]+))\s*:/.exec(line);
      if (m) keys.push(m[1] ?? m[2] ?? m[3]!);
    }
    for (const ch of line) depth += ch === '{' || ch === '(' ? 1 : ch === '}' || ch === ')' ? -1 : 0;
    if (depth < 0) break;
  }
  return keys;
}

const TOOLS = keysOf('features/game/GameLayer.tsx', 'TOOLS');
const story = src('features/story/StoryView.tsx');
const SHEETS = /useState<null \| ([^>]+)>\(null\)/.exec(story)![1]!.split('|').map((x) => x.trim().replace(/'/g, ''));
const ROUTES = [...src('app/App.tsx').matchAll(/<Route (?:index )?(?:path="([^"]*)")?/g)].map((m) => m[1] ?? '');
const SETTINGS_ELEMENTS = keysOf('features/settings/SettingsPage.tsx', 'ELEMENTS');

const full = { features: presetFeatures('full'), chat: true, game: true, experimental: true };

describe('every tool has a reachable entry point and a description', () => {
  it('found the lists it checks', () => {
    expect(TOOLS.length).toBeGreaterThan(20);
    expect(SHEETS).toContain('memory');
    expect(SETTINGS_ELEMENTS.length).toBeGreaterThan(15);
  });

  it.each(TOOLS)('game tool "%s" has an entry', (tool) => {
    const e = entryForTool(tool);
    expect(e, `no registry entry opens the ${tool} tool`).toBeTruthy();
  });

  it.each(SHEETS)('play-screen sheet "%s" has an entry', (sheet) => {
    // The new-chat sheet is the "New chat with this character" action.
    if (sheet === 'newchat') return expect(ENTRIES.some((e) => e.target.kind === 'action' && e.target.action === 'new-chat-same')).toBe(true);
    expect(ENTRIES.some((e) => e.target.kind === 'sheet' && e.target.sheet === sheet), `no entry opens the ${sheet} sheet`).toBe(true);
  });

  it.each(SETTINGS_ELEMENTS)('settings page "%s" is registered with help', (id) => {
    const p = SETTINGS_PAGES.find((x) => x.id === id);
    expect(p, `settings page ${id} is not in SETTINGS_PAGES`).toBeTruthy();
    expect(p!.description.length).toBeGreaterThan(10);
    expect(p!.help.length).toBeGreaterThan(40);
  });

  it.each(ENTRIES.map((e) => [e.id, e] as const))('entry "%s" is described and goes somewhere real', (_id, e) => {
    expect(e.label.trim()).not.toBe('');
    expect(e.description.length, 'one-line description').toBeGreaterThan(10);
    expect(e.description.length, 'fits on one line').toBeLessThanOrEqual(70);
    expect(e.help.length, '"What is this?" text').toBeGreaterThan(40);
    expect(GROUPS.map((g) => g.id)).toContain(e.group);
    const t = e.target;
    if (t.kind === 'tool') expect(TOOLS).toContain(t.tool);
    if (t.kind === 'sheet') expect(SHEETS).toContain(t.sheet);
    if (t.kind === 'route') {
      const p = t.to.split('?')[0]!.replace(/^\//, '');
      const ok = p === '' || ROUTES.some((r) => r.replace(/^\//, '').replace(/\/\*$/, '') === p) || (p.startsWith('settings/') && SETTINGS_ELEMENTS.includes(p.slice(9)));
      expect(ok, `route ${t.to} doesn't exist`).toBe(true);
    }
    if (t.kind === 'action') expect(story.includes(`'${t.action}'`) || src('app/Shell.tsx').includes(`'${t.action}'`), `action ${t.action} isn't handled`).toBe(true);
  });

  it('every entry can be reached through the palette with everything on', () => {
    for (const e of ENTRIES) expect(available(e, full), e.id).toBe(true);
  });

  it('labels are unique, so one name means one thing (entries and the settings pages the palette lists)', () => {
    const routed = new Set(ENTRIES.flatMap((e) => (e.target.kind === 'route' ? [e.target.to] : [])));
    const labels = [...ENTRIES.map((e) => e.label), ...SETTINGS_PAGES.filter((p) => !routed.has(`/settings/${p.id}`)).map((p) => p.label)].map((l) => l.toLowerCase());
    expect(labels.filter((l, i) => labels.indexOf(l) !== i)).toEqual([]);
  });

  it('every feature switch has a name and a description (the palette lists them)', () => {
    for (const f of FEATURES) {
      expect(f.label.length).toBeGreaterThan(2);
      expect(f.description.length).toBeGreaterThan(10);
    }
  });
});

describe('switched-off modules leave no trace', () => {
  it('Classic chat offers no game entries', () => {
    const classic = { features: presetFeatures('classic'), chat: true, game: true, experimental: false };
    const shown = ENTRIES.filter((e) => available(e, classic));
    expect(shown.filter((e) => e.game)).toEqual([]);
    expect(shown.map((e) => e.id)).not.toContain('memory');
    expect(shown.map((e) => e.id)).toEqual(expect.arrayContaining(['longer', 'find', 'note', 'saves', 'chat-details', 'model']));
  });

  it('a module that is off hides its entries', () => {
    const f = presetFeatures('full');
    f.on.diary = false;
    f.on.map = false;
    const ids = ENTRIES.filter((e) => available(e, { features: f, chat: true, game: true, experimental: false })).map((e) => e.id);
    expect(ids).not.toContain('diary');
    expect(ids).not.toContain('map');
    expect(ids).toContain('journal');
  });

  it('experimental pages only show with Experimental on', () => {
    const ids = ENTRIES.filter((e) => available(e, { ...full, experimental: false })).map((e) => e.id);
    expect(ids).not.toContain('design');
    expect(ids).not.toContain('lab3d');
  });
});

describe('one name everywhere', () => {
  it('every glossary term is in docs/ux/glossary.md', async () => {
    const { GLOSSARY } = await import('@/lib/glossary');
    const doc = readFileSync(path.resolve(import.meta.dirname, '../../../docs/ux/glossary.md'), 'utf8');
    for (const g of GLOSSARY) expect(doc, g.term).toContain(`**${g.term}**`);
  });
});
