import type { CharacterSummary, FilterPreset, LibrarySort } from '@everloom/engine';
import { nextTagState, tagCounts } from '@everloom/engine';
import { Check, Save, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cx } from '@/lib/format';
import { useSettings } from '@/lib/queries';
import { Button, Icon, IconButton, Input, Segmented, Sheet } from '@/ui';
import { useSettingsPatch } from '../settings/common';
import type { useLibraryState } from './useLibrary';

const SORTS: Array<{ value: LibrarySort; label: string }> = [
  { value: 'recent', label: 'Recent' },
  { value: 'name', label: 'Name' },
  { value: 'modified', label: 'Modified' },
  { value: 'created', label: 'Created' },
  { value: 'tokens', label: 'Tokens' },
  { value: 'random', label: 'Random' },
];

const HELP: Array<[string, string]> = [
  ['tag:fantasy  -tag:nsfw', 'with / without a tag'],
  ['creator:ann', 'creator contains'],
  ['tokens>1500', 'token count (>, <, >=, <=, =)'],
  ['has:lorebook  has:gallery', 'also has:greetings, has:chats; -has: for without'],
  ['fav  fav:no', 'favorites'],
  ['linked:yes  linked:chub', 'linked to an online source'],
  ['in:backlog  in:none', 'in a collection'],
];

export function FiltersSheet({ open, onOpenChange, lib, chars }: { open: boolean; onOpenChange: (o: boolean) => void; lib: ReturnType<typeof useLibraryState>; chars: CharacterSummary[] }) {
  const { state, setState } = lib;
  const settings = useSettings();
  const { update } = useSettingsPatch();
  const [tagQ, setTagQ] = useState('');
  const [presetName, setPresetName] = useState('');
  const tags = useMemo(() => tagCounts(chars), [chars]);
  const shown = tags.filter((t) => !tagQ || t.tag.includes(tagQ.toLowerCase())).slice(0, 80);
  const presets = (settings.data?.library.presets ?? []).filter((p) => p.scope === 'characters');
  const def = settings.data?.library.defaultPreset ?? null;
  const savePresets = (next: FilterPreset[], defaultPreset = def) => update({ library: { presets: [...(settings.data?.library.presets ?? []).filter((p) => p.scope !== 'characters'), ...next], defaultPreset } });
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Filters" size="md" footer={<><Button variant="ghost" onClick={lib.reset}>Clear all</Button><Button variant="primary" className="flex-1" onClick={() => onOpenChange(false)}>Show {lib.list.length}</Button></>}>
      <div className="flex flex-col gap-5">
        <section>
          <h3 className="text-sm font-semibold text-fg-2">Sort</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SORTS.map((s) => (
              <button key={s.value} type="button" aria-pressed={state.sort === s.value} onClick={() => setState((x) => ({ ...x, sort: s.value, desc: x.sort === s.value ? !x.desc : false }))} className={cx('pressable h-8 rounded-full px-3 text-sm', state.sort === s.value ? 'bg-accent-soft font-medium text-accent-text' : 'bg-surface-2 text-fg-2')}>
                {s.label}
                {state.sort === s.value && s.value !== 'random' && s.value !== 'recent' ? (state.desc ? ' ↑' : ' ↓') : ''}
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3 className="text-sm font-semibold text-fg-2">Tags</h3>
          <p className="text-xs text-fg-3">Tap once to require, twice to exclude, again to clear.</p>
          {tags.length > 12 ? <Input className="mt-2" aria-label="Find a tag" placeholder="Find a tag" value={tagQ} onChange={(e) => setTagQ(e.target.value)} /> : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {shown.map(({ tag, count }) => {
              const s = state.tagStates[tag];
              return (
                <button
                  key={tag}
                  type="button"
                  aria-label={`${tag}: ${s === 'include' ? 'required' : s === 'exclude' ? 'excluded' : 'any'}`}
                  onClick={() => setState((x) => {
                    const n = { ...x.tagStates };
                    const v = nextTagState(n[tag]);
                    if (v) n[tag] = v;
                    else delete n[tag];
                    return { ...x, tagStates: n };
                  })}
                  className={cx('pressable flex h-8 items-center gap-1 rounded-full px-3 text-sm', s === 'include' ? 'bg-accent-soft font-medium text-accent-text' : s === 'exclude' ? 'bg-danger-soft font-medium text-danger line-through' : 'bg-surface-2 text-fg-2')}
                >
                  {s === 'include' ? '+ ' : s === 'exclude' ? '− ' : ''}
                  {tag} <span className="text-xs opacity-60">{count}</span>
                </button>
              );
            })}
            {!tags.length ? <p className="text-sm text-fg-3">No tags yet.</p> : null}
          </div>
        </section>
        <section>
          <h3 className="text-sm font-semibold text-fg-2">Presets</h3>
          <div className="mt-1 flex flex-col">
            {presets.map((p) => (
              <div key={p.id} className="flex min-h-11 items-center gap-1">
                <button type="button" className="pressable min-w-0 flex-1 truncate rounded-md px-2 py-2 text-left hover:bg-surface-2" onClick={() => setState((x) => ({ ...x, query: p.query, tagStates: p.tagStates, sort: p.sort, desc: p.desc }))}>
                  {p.name}
                  {def === p.id ? <span className="ml-2 text-xs text-accent-text">default</span> : null}
                </button>
                <IconButton size="sm" icon={Check} active={def === p.id} label={def === p.id ? 'Stop opening with this' : 'Open the library with this'} onClick={() => savePresets(presets, def === p.id ? null : p.id)} />
                <IconButton size="sm" icon={Trash2} label={`Delete ${p.name}`} onClick={() => savePresets(presets.filter((x) => x.id !== p.id), def === p.id ? null : def)} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Input aria-label="Preset name" placeholder="Save these filters as…" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
            <Button variant="secondary" icon={Save} disabled={!presetName.trim()} onClick={() => {
              savePresets([...presets, lib.presetFrom(presetName.trim())]);
              setPresetName('');
            }}>
              Save
            </Button>
          </div>
        </section>
        <section>
          <h3 className="text-sm font-semibold text-fg-2">Search filters</h3>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {HELP.map(([k, v]) => (
              <div key={k} className="contents">
                <dt><button type="button" className="font-mono text-accent-text" onClick={() => setState((x) => ({ ...x, query: `${x.query} ${k.split('  ')[0]}`.trim() }))}>{k}</button></dt>
                <dd className="text-fg-2">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <Segmented size="sm" label="View" value={settings.data?.library.view ?? 'grid'} onChange={(v) => update({ library: { view: v } })} options={[{ value: 'grid', label: 'Grid' }, { value: 'list', label: 'List' }]} />
      </div>
      <span className="hidden"><Icon icon={Check} /></span>
    </Sheet>
  );
}
