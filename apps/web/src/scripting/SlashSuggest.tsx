/** Autocomplete for slash commands while the composer starts with "/". */
import { useMemo } from 'react';
import { installBuiltins } from './commands';
import { slashRegistry } from './registry';

export function SlashSuggest({ value, onPick }: { value: string; onPick: (text: string) => void }) {
  installBuiltins();
  const head = /^\/([a-z0-9-]*)$/i.exec(value.trim());
  const prefix = head?.[1];
  const list = useMemo(() => (prefix !== undefined ? slashRegistry.suggest(prefix).slice(0, 8) : []), [prefix]);
  if (!head || !list.length) return null;
  return (
    <ul className="mb-2 overflow-hidden rounded-lg border border-line bg-surface shadow-2" role="listbox" aria-label="Commands">
      {list.map((d) => (
        <li key={d.name}>
          <button role="option" aria-selected={false} className="pressable flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => onPick(`/${d.name} `)}>
            <span className="font-mono font-medium">/{d.name}</span>
            <span className="min-w-0 flex-1 truncate text-fg-2">{d.help}</span>
            {d.source && d.source !== 'Everloom' ? <span className="text-xs text-fg-3">{d.source.replace(/^script:/, '')}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
