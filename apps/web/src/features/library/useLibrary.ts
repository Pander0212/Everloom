/** Library view state: query, tri-state tags, sort, view and collection, with presets. */
import { contentStorageAllowed } from '@/lib/vaultMode';
import type { CharacterSummary, FilterPreset, LibrarySort, TagState } from '@everloom/engine';
import { matchItem, parseQuery, sortItems } from '@everloom/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from '@/lib/queries';

export interface LibraryState {
  query: string;
  tagStates: Record<string, TagState>;
  sort: LibrarySort;
  desc: boolean;
  collectionId: string | null;
}

const KEY = 'everloom.library.view';
const initial: LibraryState = { query: '', tagStates: {}, sort: 'recent', desc: false, collectionId: null };

function load(): LibraryState {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v ? { ...initial, ...v } : initial;
  } catch {
    return initial;
  }
}

export function useLibraryState(chars: CharacterSummary[] | undefined, collections: Array<{ id: string; name: string; characterIds: string[] }> | undefined) {
  const settings = useSettings();
  const [state, setState] = useState<LibraryState>(load);
  const [seed] = useState(() => Math.floor(Math.random() * 1e9));
  // The default preset is applied every time the library opens.
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || !settings.data) return;
    applied.current = true;
    const id = settings.data.library.defaultPreset;
    const p = id ? settings.data.library.presets.find((x) => x.id === id && x.scope === 'characters') : undefined;
    if (p) setState((s) => ({ ...s, query: p.query, tagStates: p.tagStates, sort: p.sort, desc: p.desc }));
  }, [settings.data]);
  useEffect(() => {
    try {
      if (contentStorageAllowed()) localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* private mode */
    }
  }, [state]);
  const parsed = useMemo(() => parseQuery(state.query), [state.query]);
  const names = useMemo(() => Object.fromEntries((collections ?? []).map((c) => [c.id, c.name])), [collections]);
  const list = useMemo(() => {
    let l = (chars ?? []).filter((c) => matchItem(c, parsed, { tagStates: state.tagStates, collectionNames: names }));
    if (state.collectionId) {
      const col = collections?.find((c) => c.id === state.collectionId);
      if (col) {
        // A collection keeps its own order unless a sort is chosen.
        const order = new Map(col.characterIds.map((id, i) => [id, i]));
        l = l.filter((c) => order.has(c.id));
        return state.sort === 'recent' ? l.sort((a, b) => order.get(a.id)! - order.get(b.id)!) : sortItems(l, state.sort, { desc: state.desc, seed });
      }
    }
    return sortItems(l, state.sort, { desc: state.desc, seed, favFirst: state.sort === 'recent' });
  }, [chars, parsed, state, names, collections, seed]);
  const presetFrom = (name: string): FilterPreset => ({ id: `fp_${Date.now().toString(36)}`, name, query: state.query, tagStates: state.tagStates, sort: state.sort, desc: state.desc, scope: 'characters' });
  const activeFilters = Object.keys(state.tagStates).length + (state.query.trim() ? 1 : 0) + (state.collectionId ? 1 : 0);
  return { state, setState, list, parsed, presetFrom, activeFilters, reset: () => setState(initial) };
}
