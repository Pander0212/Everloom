import type { Item, ItemCategory, Op } from '@everloom/engine';
import { defaultEffects, formatMoney, iconForItem, isAtHome, isUsable } from '@everloom/engine';
import { Backpack, Image as ImageIcon, LayoutGrid, List, Plus, Search, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '@/lib/format';
import { useImageGen } from '@/lib/imagegen';
import { stagger, t } from '@/lib/motion';
import { Badge, Button, confirm, Dialog, EmptyState, Field, Icon, IconButton, Input, Select, Sheet, Textarea } from '@/ui';
import { useGame } from '../context';
import { IconPicker } from '../IconPicker';
import { ItemGlyph } from '../ItemGlyph';
import { NoCampaign, ToolSheet } from './ToolSheet';

const CATEGORIES: ItemCategory[] = ['food', 'drink', 'weapon', 'armor', 'clothing', 'accessory', 'key', 'tool', 'material', 'consumable', 'medicine', 'book', 'container', 'quest', 'valuable', 'misc'];

function describeEffects(it: Item): string {
  const e = Object.keys(it.effects?.trackers ?? {}).length || Object.keys(it.effects?.bars ?? {}).length ? it.effects : defaultEffects(it.name, it.category);
  const parts = [
    ...Object.entries(e.trackers ?? {}).map(([k, v]) => `${k[0].toUpperCase()}${k.slice(1)} ${v > 0 ? '+' : '−'}${Math.abs(v)}`),
    ...Object.entries(e.bars ?? {}).map(([k, v]) => `${k.toUpperCase()} ${v > 0 ? '+' : '−'}${Math.abs(v)}`),
    e.status ? e.status : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

/** Item tile that gives a small pop when its quantity changes. */
function ItemTile({ it, onOpen, index }: { it: Item; onOpen: () => void; index: number }) {
  const prev = useRef(it.qty);
  const [pop, setPop] = useState(0);
  useEffect(() => {
    if (it.qty !== prev.current) setPop((p) => p + 1);
    prev.current = it.qty;
  }, [it.qty]);
  return (
    <motion.button initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={stagger(index)} onClick={onOpen} className="pressable group flex flex-col items-center gap-1.5 rounded-md p-1.5 text-center hover:bg-surface-2">
      <motion.span key={pop} initial={pop ? { scale: 0.85 } : false} animate={{ scale: 1 }} transition={t.reward} className="relative flex aspect-square w-full items-center justify-center rounded-md bg-surface-2 group-hover:bg-surface-3">
        <ItemGlyph icon={it.icon} name={it.name} size={28} strokeWidth={1.4} className="text-fg-2" />
        {it.qty > 1 ? <span className="absolute bottom-1 right-1.5 text-xs font-semibold tabular-nums text-fg">{it.qty}</span> : null}
        {it.equipped ? <span className="absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" aria-label="Equipped" /> : null}
      </motion.span>
      <span className="line-clamp-2 w-full text-xs leading-4 text-fg">{it.name}</span>
    </motion.button>
  );
}

export default function Inventory() {
  const { state: s, apply } = useGame();
  const gen = useImageGen();
  const [cat, setCat] = useState<string>('all');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [openId, setOpenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);
  // Whose items: yours (carried), the shared party bag, or a party member's.
  const [holder, setHolder] = useState<string>('');
  const items = useMemo(() => Object.values(s?.inventory ?? {}).filter((i) => (i.holder ?? '') === holder), [s, holder]);
  const cats = useMemo(() => [...new Set(items.map((i) => i.category))], [items]);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return items
      .filter((i) => (cat === 'all' || i.category === cat) && (!n || i.name.toLowerCase().includes(n) || i.desc.toLowerCase().includes(n)))
      .filter((i) => !i.containerId || cat !== 'all' || n)
      .sort((a, b) => Number(b.equipped) - Number(a.equipped) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }, [items, cat, q]);
  if (!s) return <ToolSheet title="Inventory"><NoCampaign /></ToolSheet>;
  const equipped = items.filter((i) => i.equipped);
  const it = openId ? s.inventory[openId] : null;
  const containers = items.filter((i) => i.category === 'container');
  const contents = it ? items.filter((x) => x.containerId === it.id) : [];
  const people = Object.values(s.npcs).filter((n) => n.locationId === s.currentLocationId || Object.values(s.party).some((p) => p.npcId === n.id));

  const act = async (ops: Op[], closeAfter = false) => {
    const r = await apply(ops);
    if (r && closeAfter) setOpenId(null);
  };

  return (
    <ToolSheet
      title="Inventory"
      description={`${items.reduce((a, b) => a + b.qty, 0)} items${holder ? '' : ` · ${formatMoney(s, s.player.currency)}`}`}
      headerActions={<IconButton icon={view === 'grid' ? List : LayoutGrid} label={view === 'grid' ? 'List view' : 'Grid view'} onClick={() => setView(view === 'grid' ? 'list' : 'grid')} />}
      footer={
        <Button variant="secondary" icon={Plus} block onClick={() => setAdding(true)}>
          Add item
        </Button>
      }
    >
      {Object.keys(s.party).length ? (
        <Select aria-label="Whose items" value={holder} onChange={(e) => setHolder(e.target.value)} className="mb-3">
          <option value="">Yours</option>
          <option value="party">Party bag (shared)</option>
          {Object.values(s.party).map((m) => (
            <option key={m.id} value={`member:${m.id}`}>
              {m.name}
            </option>
          ))}
        </Select>
      ) : null}
      <div className="relative">
        <Icon icon={Search} size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
        <Input placeholder="Search items" aria-label="Search items" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
      </div>
      {cats.length > 1 ? (
        <div className="no-scrollbar -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
          {['all', ...cats].map((c) => (
            <button key={c} onClick={() => setCat(c)} className={cx('pressable h-8 flex-none rounded-full px-3 text-xs font-medium capitalize', cat === c ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-fg-2')}>
              {c}
            </button>
          ))}
        </div>
      ) : null}
      {equipped.length && cat === 'all' && !q ? (
        <section className="mt-5">
          <h3 className="mb-2 text-xs font-medium text-fg-3">Equipped</h3>
          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            {equipped.map((e) => (
              <button key={e.id} onClick={() => setOpenId(e.id)} className="pressable flex h-11 flex-none items-center gap-2 rounded-md bg-surface-2 pl-2 pr-3 text-sm">
                <ItemGlyph icon={e.icon} name={e.name} size={18} className="text-fg-2" />
                {e.name}
                <span className="text-xs text-fg-3">{e.slot}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {filtered.length ? (
        view === 'grid' ? (
          <div className="mt-4 grid grid-cols-4 gap-1 sm:grid-cols-5">
            {filtered.map((x, i) => (
              <ItemTile key={x.id} it={x} index={i} onOpen={() => setOpenId(x.id)} />
            ))}
          </div>
        ) : (
          <div className="mt-3 flex flex-col divide-y divide-line">
            {filtered.map((x) => (
              <button key={x.id} onClick={() => setOpenId(x.id)} className="pressable flex min-h-14 items-center gap-3 py-2 text-left">
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-surface-2">
                  <ItemGlyph icon={x.icon} name={x.name} className="text-fg-2" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{x.name}</span>
                  <span className="block truncate text-xs capitalize text-fg-2">
                    {x.category}
                    {x.equipped ? ' · equipped' : ''}
                  </span>
                </span>
                <span className="text-sm tabular-nums text-fg-2">×{x.qty}</span>
              </button>
            ))}
          </div>
        )
      ) : (
        <EmptyState icon={Backpack} art={items.length ? 'search' : 'bag'} title={items.length ? 'Nothing matches' : 'Your bag is empty'} body={items.length ? undefined : 'Items you pick up in the story show up here.'} />
      )}

      <Sheet open={!!it} onOpenChange={(o) => !o && setOpenId(null)} title={it?.name ?? ''} description={it ? `${it.category}${it.slot ? ` · ${it.slot}` : ''}${it.qty > 1 ? ` · ×${it.qty}` : ''}` : undefined} size="md">
        {it ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <span className="flex flex-none flex-col items-center gap-1.5">
                <span className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg bg-surface-2">
                  <ItemGlyph icon={it.icon} name={it.name} size={it.icon.startsWith('media:') ? 80 : 64} strokeWidth={1.3} className="text-fg-2" />
                </span>
                <Button
                  size="sm"
                  variant="quiet"
                  icon={Sparkles}
                  loading={gen.busy === 'item'}
                  onClick={async () => {
                    const r = await gen.run({ kind: 'item', itemName: [it.name, it.desc].filter(Boolean).join(' — ').slice(0, 120) });
                    if (r) await act([{ type: 'item.update', name: it.id, icon: `media:${r.id}` } as Op]);
                  }}
                >
                  Draw
                </Button>
                <Button size="sm" variant="quiet" icon={ImageIcon} onClick={() => setPicking(true)}>
                  Picture
                </Button>
                <IconPicker
                  open={picking}
                  onOpenChange={setPicking}
                  value={it.icon}
                  automatic={iconForItem(it.name, it.category)}
                  onPick={async (icon) => {
                    setPicking(false);
                    await act([{ type: 'item.update', name: it.id, icon } as Op]);
                  }}
                />
              </span>
              <div className="min-w-0 text-sm text-fg-2">
                {it.desc ? <p className="text-fg">{it.desc}</p> : null}
                {isUsable(it.category) || Object.keys(it.effects?.trackers ?? {}).length ? <p className="mt-1">{describeEffects(it)}</p> : null}
                {Object.entries(it.stats ?? {}).length ? (
                  <p className="mt-1">
                    {Object.entries(it.stats)
                      .map(([k, v]) => `${k.toUpperCase()} +${v}`)
                      .join(' · ')}
                  </p>
                ) : null}
                {it.value ? <p className="mt-1">Worth {it.value} {s.meta.currency.name}</p> : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {isUsable(it.category) || Object.keys(it.effects?.trackers ?? {}).length || Object.keys(it.effects?.bars ?? {}).length ? (
                <Button variant="primary" onClick={() => act([{ type: 'item.use', name: it.id } as Op], it.qty <= 1)}>
                  Use
                </Button>
              ) : null}
              {it.slot || ['weapon', 'armor', 'clothing', 'accessory'].includes(it.category) ? (
                <Button variant={it.equipped ? 'secondary' : 'primary'} onClick={() => act([{ type: 'item.equip', name: it.id, equipped: !it.equipped } as Op])}>
                  {it.equipped ? 'Unequip' : 'Equip'}
                </Button>
              ) : null}
              <Select
                aria-label="Move to"
                value=""
                onChange={(e) => e.target.value && act([{ type: 'item.move', name: it.id, to: e.target.value } as Op], true)}
              >
                <option value="">Move to…</option>
                {holder ? <option value="me">You</option> : null}
                {holder !== 'party' && Object.keys(s.party).length ? <option value="party">Party bag</option> : null}
                {Object.values(s.party)
                  .filter((m) => holder !== `member:${m.id}`)
                  .map((m) => (
                    <option key={m.id} value={`member:${m.id}`}>
                      {m.name}
                    </option>
                  ))}
                {Object.values(s.homes)
                  .filter((h) => isAtHome(s, h))
                  .flatMap((h) => h.storage)
                  .map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name} (home)
                    </option>
                  ))}
              </Select>
              {containers.filter((c) => c.id !== it.id).length && it.category !== 'container' ? (
                <Select aria-label="Move into container" value={it.containerId ?? ''} onChange={(e) => act([{ type: 'item.update', name: it.id, container: e.target.value || null } as Op])}>
                  <option value="">Loose in bag</option>
                  {containers
                    .filter((c) => c.id !== it.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        In {c.name}
                      </option>
                    ))}
                </Select>
              ) : null}
              {people.length ? (
                <Select
                  aria-label="Give to"
                  value=""
                  onChange={async (e) => {
                    const who = e.target.value;
                    if (!who) return;
                    await act([{ type: 'item.remove', name: it.id, qty: 1 } as Op, { type: 'relationship.memory', name: who, text: `You gave them ${it.name}.` } as Op, { type: 'relationship.delta', name: who, affection: 2 } as Op], it.qty <= 1);
                  }}
                >
                  <option value="">Give to…</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              ) : null}
              <Button
                variant="ghost"
                onClick={async () => {
                  if (!(await confirm({ title: `Drop ${it.name}?`, description: it.qty > 1 ? 'Drops one.' : undefined, confirmLabel: 'Drop', danger: true }))) return;
                  await act([{ type: 'item.remove', name: it.id, qty: 1 } as Op], it.qty <= 1);
                }}
              >
                Drop
              </Button>
            </div>
            {it.category === 'container' ? (
              <div>
                <h3 className="mb-1 text-sm font-semibold text-fg-2">Inside</h3>
                {contents.length ? (
                  <div className="flex flex-col">
                    {contents.map((c) => (
                      <button key={c.id} onClick={() => setOpenId(c.id)} className="pressable flex min-h-11 items-center gap-2 text-left text-sm">
                        <ItemGlyph icon={c.icon} name={c.name} size={18} className="text-fg-2" />
                        <span className="flex-1">{c.name}</span>
                        <span className="text-fg-2">×{c.qty}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-fg-2">Empty.</p>
                )}
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              {it.locked ? <Badge tone="accent">Locked from AI changes</Badge> : <span />}
              <Button size="sm" variant="quiet" onClick={() => act([{ type: 'item.update', name: it.id, locked: !it.locked } as Op])}>
                {it.locked ? 'Unlock' : 'Lock'}
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>
      <AddItemDialog open={adding} onOpenChange={setAdding} onAdd={(op) => act([op])} />
    </ToolSheet>
  );
}

function AddItemDialog({ open, onOpenChange, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; onAdd: (op: Op) => void }) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState(1);
  const [category, setCategory] = useState<string>('');
  const [desc, setDesc] = useState('');
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add item"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim()}
            onClick={() => {
              onAdd({ type: 'item.add', name: name.trim(), qty, ...(category ? { category } : {}), ...(desc ? { desc } : {}) } as Op);
              onOpenChange(false);
              setName('');
              setQty(1);
              setDesc('');
            }}
          >
            Add
          </Button>
        </>
      }
    >
      <AnimatePresence initial={false}>
        <div className="flex flex-col gap-3">
          <Field label="Name" htmlFor="in">
            <Input id="in" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity" htmlFor="iq">
              <Input id="iq" type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} />
            </Field>
            <Field label="Category" htmlFor="ic">
              <Select id="ic" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Guess</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Description" htmlFor="id">
            <Textarea id="id" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
          </Field>
        </div>
      </AnimatePresence>
    </Dialog>
  );
}
