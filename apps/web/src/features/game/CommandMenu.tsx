import * as D from '@radix-ui/react-dialog';
import type { LucideIcon } from 'lucide-react';
import {
  Archive, Backpack, BookMarked, BookOpen, Brain, CalendarDays, Cat, Contact, Database, FastForward, Flag, HelpCircle, Map, NotebookPen, PartyPopper, Phone, Search, Settings, Shield, Sparkles, Swords, UserRound, Users, UsersRound, Wand2, CloudSun, ScrollText, UserRoundPen, Dumbbell, Heart,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Drawer } from 'vaul';
import { cx } from '@/lib/format';
import { t } from '@/lib/motion';
import { Icon, Kbd, useDesktop } from '@/ui';

export interface Command {
  id: string;
  label: string;
  icon: LucideIcon;
  group: 'Quick' | 'Story' | 'Character' | 'World' | 'System';
  keywords?: string;
  badge?: string | number;
  run: () => void;
}

export const TOOL_META = {
  journal: { label: 'Journal', icon: BookMarked, group: 'Story', keywords: 'quests objectives tasks' },
  diary: { label: 'Diary', icon: NotebookPen, group: 'Story', keywords: 'notes photos stickers' },
  map: { label: 'Map', icon: Map, group: 'Story', keywords: 'travel places locations' },
  orgs: { label: 'Organizations', icon: Flag, group: 'Story', keywords: 'factions groups standing' },
  activities: { label: 'Activities', icon: Dumbbell, group: 'Story', keywords: 'sleep work train cook rest wait' },
  battle: { label: 'Battle', icon: Swords, group: 'Story', keywords: 'fight combat' },
  persona: { label: 'Persona', icon: UserRound, group: 'Character', keywords: 'me lineage family' },
  inventory: { label: 'Inventory', icon: Backpack, group: 'Character', keywords: 'items bag equipment' },
  characters: { label: 'Characters', icon: Contact, group: 'Character', keywords: 'cards cast' },
  party: { label: 'Party', icon: UsersRound, group: 'Character', keywords: 'companions team' },
  social: { label: 'Social', icon: Heart, group: 'Character', keywords: 'relationships affection trust' },
  databank: { label: 'Databank', icon: Database, group: 'World', keywords: 'facts knowledge' },
  phone: { label: 'Phone', icon: Phone, group: 'World', keywords: 'texts messages contacts' },
  npcs: { label: 'NPCs', icon: Users, group: 'World', keywords: 'people characters' },
  calendar: { label: 'Calendar', icon: CalendarDays, group: 'World', keywords: 'time events schedules date' },
  atmosphere: { label: 'Atmosphere', icon: CloudSun, group: 'World', keywords: 'weather overlay background' },
  helper: { label: 'Helper', icon: Cat, group: 'World', keywords: 'assistant pet ask' },
} as const;

export const QUICK_ICONS = { FastForward, UserRoundPen, Wand2, NotebookPen, Brain, ScrollText, Sparkles, Settings, HelpCircle, Archive, Shield, BookOpen, PartyPopper };

const GROUPS: Command['group'][] = ['Quick', 'Story', 'Character', 'World', 'System'];

function useFiltered(commands: Command[], q: string) {
  return useMemo(() => {
    const n = q.trim().toLowerCase();
    const list = n ? commands.filter((c) => `${c.label} ${c.keywords ?? ''} ${c.group}`.toLowerCase().includes(n)) : commands;
    return GROUPS.map((g) => ({ group: g, items: list.filter((c) => c.group === g) })).filter((g) => g.items.length);
  }, [commands, q]);
}

function List({ groups, active, onRun, columns }: { groups: ReturnType<typeof useFiltered>; active: string | null; onRun: (c: Command) => void; columns: 1 | 2 }) {
  if (!groups.length) return <p className="py-10 text-center text-sm text-fg-2">Nothing matches</p>;
  return (
    <div className="flex flex-col gap-3">
      {groups.map(({ group, items }) => (
        <section key={group}>
          <h3 className="px-2 pb-1 text-xs font-medium text-fg-3">{group === 'Quick' ? 'Actions' : group}</h3>
          <div className={cx('grid gap-0.5', columns === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
            {items.map((c) => (
              <button
                key={c.id}
                data-cmd={c.id}
                onClick={() => onRun(c)}
                className={cx('pressable flex min-h-11 items-center gap-3 rounded-md px-2 text-left text-sm', active === c.id ? 'bg-surface-2 dark:bg-surface-3' : 'hover:bg-surface-2')}
              >
                <Icon icon={c.icon} className="flex-none text-fg-2" />
                <span className="flex-1 truncate">{c.label}</span>
                {c.badge ? <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-fg">{c.badge}</span> : null}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function CommandMenu({ open, onOpenChange, commands }: { open: boolean; onOpenChange: (o: boolean) => void; commands: Command[] }) {
  const desktop = useDesktop();
  const [q, setQ] = useState('');
  const groups = useFiltered(commands, q);
  const flat = groups.flatMap((g) => g.items);
  const [active, setActive] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setQ('');
      setActive(null);
    }
  }, [open]);
  useEffect(() => setActive(flat[0]?.id ?? null), [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = (c: Command) => {
    onOpenChange(false);
    setTimeout(c.run, 60);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const i = flat.findIndex((c) => c.id === active);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(flat[Math.min(flat.length - 1, i + 1)]?.id ?? null);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(flat[Math.max(0, i - 1)]?.id ?? null);
    } else if (e.key === 'Enter') {
      const c = flat.find((x) => x.id === active) ?? flat[0];
      if (c) run(c);
    }
  };
  const search = (
    <div className="relative">
      <Icon icon={Search} size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
        placeholder="Search tools and actions"
        aria-label="Search tools and actions"
        className="field pl-10"
        autoFocus={desktop}
      />
    </div>
  );

  if (desktop) {
    return (
      <D.Root open={open} onOpenChange={onOpenChange}>
        <AnimatePresence>
          {open ? (
            <D.Portal forceMount>
              <D.Overlay asChild>
                <motion.div className="fixed inset-0 z-[60] bg-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={t.fast} />
              </D.Overlay>
              <D.Content asChild aria-describedby={undefined}>
                <motion.div
                  className="fixed left-1/2 top-[12vh] z-[61] flex max-h-[72vh] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 flex-col rounded-lg bg-surface shadow-3 outline-none dark:bg-surface-2"
                  initial={{ opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={t.base}
                >
                  <D.Title className="sr-only">Command menu</D.Title>
                  <div className="p-3 pb-2">{search}</div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                    <List groups={groups} active={active} onRun={run} columns={1} />
                  </div>
                  <div className="hairline-t flex items-center gap-3 px-4 py-2 text-xs text-fg-3">
                    <span>
                      <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move
                    </span>
                    <span>
                      <Kbd>Enter</Kbd> to open
                    </span>
                    <span className="ml-auto">
                      <Kbd>Ctrl K</Kbd>
                    </span>
                  </div>
                </motion.div>
              </D.Content>
            </D.Portal>
          ) : null}
        </AnimatePresence>
      </D.Root>
    );
  }
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-[2px]" />
        <Drawer.Content aria-describedby={undefined} className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-lg bg-surface shadow-3 outline-none">
          <div className="mx-auto mt-2 h-1 w-9 flex-none rounded-full bg-line-strong" aria-hidden="true" />
          <Drawer.Title className="sr-only">Command menu</Drawer.Title>
          <div className="px-4 pb-2 pt-3">{search}</div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-[calc(var(--safe-bottom)+12px)]">
            <List groups={groups} active={null} onRun={run} columns={2} />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
