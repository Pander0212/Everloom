/**
 * The palette: one searchable place for every tool, action, setting, character, place, item and
 * person (docs/ux/navigation.md). Ctrl/⌘K on desktop; the Tools button opens it on phones, where it
 * is a bottom drawer that starts with a search field. Browsing shows the pinned few, then the
 * groups by what a player wants to do; searching also finds settings pages, feature switches and
 * the story's places, items and people. Every row says in one line what it does.
 */
import * as D from '@radix-ui/react-dialog';
import type { CampaignDTO, FeatureId } from '@everloom/engine';
import { FEATURES } from '@everloom/engine';
import type { LucideIcon } from 'lucide-react';
import { Backpack, Check, MapPin, Pin, PinOff, Search, ToggleRight, User, Users, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Drawer } from 'vaul';
import { cx } from '@/lib/format';
import { t } from '@/lib/motion';
import { available, ENTRIES, GROUPS, SETTINGS_PAGES, type Entry, type Scope } from '@/lib/registry';
import { Icon, Kbd, useDesktop } from '@/ui';

export interface PaletteItem {
  key: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  /** Heading it is listed under. */
  section: string;
  badge?: string | number;
  run?: () => void;
  toggle?: { on: boolean; set: (on: boolean) => void };
  /** A registry entry that can be pinned. */
  pin?: string;
  keywords?: string;
  searchOnly?: boolean;
}

/** The default pins for each way of playing. */
export function defaultPins(preset: string): string[] {
  if (preset === 'classic') return ['note', 'find', 'saves', 'chat-details', 'longer', 'write-for-me'];
  if (preset === 'story') return ['memory', 'journal', 'note', 'saves', 'diary', 'find', 'stage-view', 'chat-details'];
  return ['inventory', 'outfits', 'map', 'journal', 'status', 'people', 'memory', 'saves'];
}

export interface PaletteProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  scope: Scope;
  /** Runs a registry entry. */
  onEntry: (e: Entry) => void;
  /** Extra rows (extension panels, …). */
  extra?: PaletteItem[];
  badges?: Record<string, string | number | undefined>;
  pins: string[];
  onPins: (pins: string[]) => void;
  onFeature: (id: FeatureId, on: boolean) => void;
  onSettings: (page: string) => void;
  /** Story things to find by name. */
  campaign?: CampaignDTO | null;
  characters?: Array<{ id: string; name: string }>;
  onPlace?: (id: string) => void;
  onItem?: (id: string) => void;
  onPerson?: (id: string) => void;
  onCharacter?: (id: string) => void;
}

function rank(item: PaletteItem, q: string): number {
  const l = item.label.toLowerCase();
  if (l === q) return 0;
  if (l.startsWith(q)) return 1;
  if (l.split(/\s+/).some((w) => w.startsWith(q))) return 2;
  if (l.includes(q)) return 3;
  if ((item.keywords ?? '').toLowerCase().includes(q)) return 4;
  if ((item.description ?? '').toLowerCase().includes(q)) return 5;
  return 99;
}

export function usePaletteItems(p: PaletteProps) {
  return useMemo(() => {
    const entries = ENTRIES.filter((e) => available(e, p.scope));
    const items: PaletteItem[] = entries.map((e) => ({
      key: e.id,
      label: e.label,
      description: e.description,
      icon: e.icon,
      section: GROUPS.find((g) => g.id === e.group)!.label,
      keywords: `${e.keywords ?? ''} ${e.group}`,
      badge: p.badges?.[e.id],
      run: () => p.onEntry(e),
      pin: e.id,
      searchOnly: e.searchOnly,
    }));
    // A settings page that an entry already opens isn't listed twice.
    const routed = new Set(entries.flatMap((e) => (e.target.kind === 'route' ? [e.target.to] : [])));
    const pages = SETTINGS_PAGES.filter((s) => (!s.feature || p.scope.features.on[s.feature]) && !routed.has(`/settings/${s.id}`));
    for (const s of pages) items.push({ key: `settings:${s.id}`, label: s.label, description: s.description, icon: s.icon, section: 'Settings pages', keywords: s.keywords, run: () => p.onSettings(s.id), searchOnly: true });
    for (const f of FEATURES) {
      const on = p.scope.features.on[f.id];
      items.push({ key: `feature:${f.id}`, label: f.label, description: `${on ? 'On' : 'Off'} · ${f.description}`, icon: ToggleRight, section: 'Feature switches', keywords: `feature switch turn on off ${f.id}`, toggle: { on, set: (v) => p.onFeature(f.id, v) }, searchOnly: true });
    }
    const st = p.campaign?.state;
    if (st && p.scope.game && p.scope.features.on.game) {
      if (p.scope.features.on.map && p.onPlace) for (const l of Object.values(st.locations)) items.push({ key: `place:${l.id}`, label: l.name, description: l.id === st.currentLocationId ? 'Place · you are here' : 'Place · show on the map', icon: MapPin, section: 'Places', keywords: `place ${l.kind ?? ''}`, run: () => p.onPlace!(l.id), searchOnly: true });
      if (p.scope.features.on.inventory && p.onItem) for (const it of Object.values(st.inventory)) items.push({ key: `item:${it.id}`, label: it.name, description: `Item · ${it.qty > 1 ? `${it.qty} · ` : ''}${it.equipped ? 'worn' : it.category}`, icon: Backpack, section: 'Items', keywords: `item ${it.category}`, run: () => p.onItem!(it.id), searchOnly: true });
      if (p.scope.features.on.npcs && p.onPerson) for (const n of Object.values(st.npcs)) items.push({ key: `npc:${n.id}`, label: n.name, description: `Person${n.title ? ` · ${n.title}` : ''}`, icon: User, section: 'People', keywords: 'person npc', run: () => p.onPerson!(n.id), searchOnly: true });
    }
    for (const c of p.characters ?? []) items.push({ key: `char:${c.id}`, label: c.name, description: 'Character · open in the library', icon: Users, section: 'Characters', keywords: 'character card', run: () => p.onCharacter?.(c.id), searchOnly: true });
    return [...items, ...(p.extra ?? [])];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.scope, p.badges, p.campaign, p.characters, p.extra]);
}

interface Section {
  title: string;
  items: PaletteItem[];
}

function sectionsFor(items: PaletteItem[], q: string): Section[] {
  const n = q.trim().toLowerCase();
  if (!n) {
    const order = [...GROUPS.map((g) => g.label), 'Extensions'];
    return order.map((title) => ({ title, items: items.filter((i) => i.section === title && !i.searchOnly) })).filter((s) => s.items.length);
  }
  const hits = items.map((i) => ({ i, r: rank(i, n) })).filter((x) => x.r < 99).sort((a, b) => a.r - b.r);
  const out: Section[] = [];
  for (const { i } of hits) {
    let s = out.find((x) => x.title === i.section);
    if (!s) out.push((s = { title: i.section, items: [] }));
    if (s.items.length < 8) s.items.push(i);
  }
  return out;
}

function Row({ item, active, editing, pinned, onRun, onPin }: { item: PaletteItem; active: boolean; editing: boolean; pinned: boolean; onRun: () => void; onPin: () => void }) {
  return (
    <div className={cx('flex items-center gap-1 rounded-md', active ? 'bg-surface-2 dark:bg-surface-3' : 'hover:bg-surface-2')}>
      <button
        data-cmd={item.key}
        onClick={editing && item.pin ? onPin : onRun}
        aria-label={item.toggle ? `${item.label}, feature switch, ${item.toggle.on ? 'on' : 'off'}` : item.badge ? `${item.label}, ${item.badge} new` : item.label}
        aria-description={item.description}
        className="pressable flex min-h-12 min-w-0 flex-1 items-center gap-3 px-2 py-1.5 text-left"
      >
        <Icon icon={item.icon} className="flex-none text-fg-2" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{item.label}</span>
          {item.description ? <span className="block truncate text-xs text-fg-2">{item.description}</span> : null}
        </span>
        {item.badge ? <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-fg">{item.badge}</span> : null}
        {item.toggle ? (
          <span className={cx('relative h-5 w-9 flex-none rounded-full transition-colors', item.toggle.on ? 'bg-accent' : 'bg-surface-3')} aria-hidden="true">
            <span className={cx('absolute top-0.5 size-4 rounded-full bg-surface shadow-1 transition-transform', item.toggle.on ? 'translate-x-[18px]' : 'translate-x-0.5')} />
          </span>
        ) : null}
        {editing && item.pin ? <Icon icon={pinned ? PinOff : Pin} size={16} className={pinned ? 'text-accent-text' : 'text-fg-3'} /> : null}
      </button>
    </div>
  );
}

export function Palette(p: PaletteProps) {
  const desktop = useDesktop();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(false);
  const items = usePaletteItems(p);
  const sections = useMemo(() => sectionsFor(items, q), [items, q]);
  const pinned = useMemo(() => p.pins.map((id) => items.find((i) => i.pin === id)).filter((x): x is PaletteItem => !!x), [p.pins, items]);
  const flat = useMemo(() => [...(q ? [] : pinned.map((i) => ({ ...i, key: `pin:${i.key}` }))), ...sections.flatMap((s) => s.items)], [sections, pinned, q]);
  const [active, setActive] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (p.open) {
      setQ('');
      setEditing(false);
      setActive(null);
    }
  }, [p.open]);
  useEffect(() => setActive(q ? (flat[0]?.key ?? null) : null), [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = (i: PaletteItem) => {
    if (i.toggle) return i.toggle.set(!i.toggle.on);
    p.onOpenChange(false);
    setTimeout(() => i.run?.(), 60);
  };
  const togglePin = (id: string) => p.onPins(p.pins.includes(id) ? p.pins.filter((x) => x !== id) : [...p.pins, id].slice(-8));
  const onKey = (e: React.KeyboardEvent) => {
    const i = flat.findIndex((c) => c.key === active);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(flat[Math.min(flat.length - 1, i + 1)]?.key ?? null);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(flat[Math.max(0, i - 1)]?.key ?? null);
    } else if (e.key === 'Enter') {
      const c = flat.find((x) => x.key === active) ?? flat[0];
      if (c) run(c);
    }
  };

  const body = (
    <>
      <div className="relative">
        <Icon icon={Search} size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search tools, settings, places…"
          aria-label="Search tools, settings and the story"
          className="field pl-10 pr-9"
          autoFocus={desktop}
        />
        {q ? (
          <button className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-fg-3 hover:text-fg" aria-label="Clear search" onClick={() => setQ('')}>
            <Icon icon={X} size={16} />
          </button>
        ) : null}
      </div>
      {!q ? (
        <section className="mt-3" aria-label="Pinned">
          <div className="flex items-center justify-between px-2 pb-1">
            <h3 className="text-xs font-medium text-fg-3">Pinned</h3>
            <button className="pressable rounded-sm px-1.5 py-0.5 text-xs font-medium text-accent-text" onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
              {editing ? (
                <span className="flex items-center gap-1">
                  <Icon icon={Check} size={14} /> Done
                </span>
              ) : (
                'Edit pins'
              )}
            </button>
          </div>
          {editing ? <p className="px-2 pb-2 text-xs text-fg-2">Tap a tool below to pin or unpin it (up to eight).</p> : null}
          {pinned.length ? (
            <div className="grid grid-cols-4 gap-1">
              {pinned.slice(0, 8).map((i) => (
                <button key={i.key} data-cmd={`pin:${i.key}`} onClick={() => (editing ? togglePin(i.pin!) : run(i))} aria-label={i.label} className={cx('pressable relative flex min-h-16 flex-col items-center justify-center gap-1 rounded-md px-1 text-center text-xs font-medium', active === `pin:${i.key}` ? 'bg-surface-2 dark:bg-surface-3' : 'bg-surface-2/60 hover:bg-surface-2 dark:bg-surface-3/40')}>
                  <Icon icon={i.icon} className="text-fg-2" />
                  <span className="line-clamp-1">{i.label}</span>
                  {i.badge ? <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-fg">{i.badge}</span> : null}
                  {editing ? <Icon icon={PinOff} size={12} className="absolute left-1 top-1 text-accent-text" /> : null}
                </button>
              ))}
            </div>
          ) : (
            <p className="px-2 text-xs text-fg-2">Nothing pinned. Use Edit pins to keep your favourite tools here.</p>
          )}
        </section>
      ) : null}
      <div className="mt-2 flex flex-col gap-3">
        {sections.length ? (
          sections.map((s) => (
            <section key={s.title} aria-label={s.title}>
              <h3 className="px-2 pb-1 text-xs font-medium text-fg-3">{s.title}</h3>
              <div className="flex flex-col gap-0.5">
                {s.items.map((i) => (
                  <Row key={i.key} item={i} active={active === i.key} editing={editing} pinned={!!i.pin && p.pins.includes(i.pin)} onRun={() => run(i)} onPin={() => togglePin(i.pin!)} />
                ))}
              </div>
            </section>
          ))
        ) : (
          <p className="py-10 text-center text-sm text-fg-2">Nothing matches “{q}”.</p>
        )}
      </div>
    </>
  );

  if (desktop) {
    return (
      <D.Root open={p.open} onOpenChange={p.onOpenChange}>
        <AnimatePresence>
          {p.open ? (
            <D.Portal forceMount>
              <D.Overlay asChild>
                <motion.div className="fixed inset-0 z-[60] bg-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={t.fast} />
              </D.Overlay>
              <D.Content asChild aria-describedby={undefined}>
                <motion.div
                  className="ev-palette fixed left-1/2 top-[10vh] z-[61] flex max-h-[78vh] w-[min(600px,calc(100vw-32px))] -translate-x-1/2 flex-col rounded-lg bg-surface shadow-3 outline-none dark:bg-surface-2"
                  initial={{ opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={t.base}
                >
                  <D.Title className="sr-only">Tools</D.Title>
                  <div className="min-h-0 flex-1 overflow-y-auto p-3">{body}</div>
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
    <Drawer.Root open={p.open} onOpenChange={p.onOpenChange} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-[2px]" />
        <Drawer.Content aria-describedby={undefined} className="ev-palette fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-lg bg-surface shadow-3 outline-none">
          <div className="mx-auto mt-2 h-1 w-9 flex-none rounded-full bg-line-strong" aria-hidden="true" />
          <Drawer.Title className="sr-only">Tools</Drawer.Title>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(var(--safe-bottom)+12px)] pt-3">{body}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
