import { formatClock, formatMoney, iconForItem, itemValue, priceOf, QUALITY_MULT, shopOpen, type CampaignState, type Op, type Shop as ShopT } from '@everloom/engine';
import { Dices, Minus, Plus as PlusIcon, Store } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cx } from '@/lib/format';
import { Badge, Button, EmptyState, Icon, IconButton, ListRow, TabPanel, Tabs } from '@/ui';
import { useGame } from '../context';
import { ItemGlyph } from '../ItemGlyph';
import { NoCampaign, ToolSheet } from './ToolSheet';

/** Shops: the ones here first. Buy, sell, haggle once a day. */
export default function Shop({ arg }: { arg?: string }) {
  const { state: s } = useGame();
  const [openId, setOpenId] = useState<string | null>(arg ?? null);
  const shops = useMemo(() => {
    if (!s) return [];
    const here = s.currentLocationId;
    return Object.values(s.economy.shops).sort((a, b) => Number(b.locationId === here) - Number(a.locationId === here) || a.name.localeCompare(b.name));
  }, [s]);
  if (!s) return <NoCampaign />;
  const shop = openId ? s.economy.shops[openId] : shops.length === 1 ? shops[0] : null;
  if (shop) return <ShopView s={s} shop={shop} onBack={shops.length > 1 ? () => setOpenId(null) : undefined} />;
  return (
    <ToolSheet title="Shops">
      {shops.length ? (
        <div className="flex flex-col">
          {shops.map((x) => {
            const here = x.locationId === s.currentLocationId;
            return (
              <ListRow
                key={x.id}
                title={x.name}
                subtitle={`${x.kind}${x.locationId ? ` · ${s.locations[x.locationId]?.name ?? ''}` : ''}${here ? ' · here' : ''}`}
                leading={<Icon icon={Store} size={18} className="text-fg-3" />}
                trailing={<Badge tone={shopOpen(s, x) ? 'success' : 'neutral'}>{shopOpen(s, x) ? 'Open' : 'Closed'}</Badge>}
                onClick={() => setOpenId(x.id)}
                chevron
              />
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Store} title="No shops yet" body="Shops appear as the story finds them. You can also ask the helper to set one up here." />
      )}
    </ToolSheet>
  );
}

function ShopView({ s, shop, onBack }: { s: CampaignState; shop: ShopT; onBack?: () => void }) {
  const { apply } = useGame();
  const [tab, setTab] = useState('buy');
  const [qty, setQty] = useState<Record<string, number>>({});
  const open = shopOpen(s, shop);
  const here = !shop.locationId || shop.locationId === s.currentLocationId;
  const can = open && here;
  const keeper = shop.npcId ? s.npcs[shop.npcId]?.name : null;
  const today = Math.floor(s.time.minutes / 1440);
  const haggled = shop.haggle?.day === today ? shop.haggle.mult : null;
  const sellable = Object.values(s.inventory).filter((i) => !i.holder && !i.equipped && !i.locked && i.category !== 'quest');
  const n = (id: string) => qty[id] ?? 1;
  const hours = shop.open === shop.close ? 'Always open' : `${formatClock(shop.open, s.meta.calendar)}–${formatClock(shop.close, s.meta.calendar)}`;
  return (
    <ToolSheet
      title={shop.name}
      description={`${keeper ? `${keeper} · ` : ''}${hours}`}
      headerActions={onBack ? <Button size="sm" variant="quiet" onClick={onBack}>All shops</Button> : undefined}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium tabular-nums">{formatMoney(s, s.player.currency)}</span>
        <span className="text-fg-3">in hand</span>
        <span className="flex-1" />
        {!here ? <Badge>Not here</Badge> : !open ? <Badge>Closed</Badge> : haggled ? <Badge tone={haggled >= 1 ? 'success' : 'warning'}>{haggled >= 1 ? `Haggled ${Math.round((haggled - 1) * 100)}% better` : `${Math.round((1 - haggled) * 100)}% worse today`}</Badge> : (
          <Button size="sm" variant="quiet" icon={Dices} onClick={() => apply({ type: 'shop.haggle', shop: shop.id } as Op)}>
            Haggle
          </Button>
        )}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'buy', label: 'Buy' }, { value: 'sell', label: 'Sell' }]}>
        <TabPanel value="buy" className="pt-3">
          <ul className="flex flex-col divide-y divide-line" aria-label="For sale">
            {Object.values(shop.stock)
              .filter((st) => st.maxQty > 0 || st.qty > 0)
              .map((st) => (
                <li key={st.id} className={cx('flex items-center gap-3 py-2.5', !st.qty && 'opacity-50')}>
                  <ItemGlyph icon={iconForItem(st.name, st.category)} size={20} className="text-fg-2" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{st.name}</span>
                    <span className="block text-xs text-fg-2">{st.qty ? `${st.qty} left` : 'Sold out'}</span>
                  </span>
                  {st.qty > 1 ? <Qty value={n(st.id)} max={st.qty} onChange={(v) => setQty({ ...qty, [st.id]: v })} label={st.name} /> : null}
                  <Button size="sm" disabled={!can || !st.qty} onClick={() => apply({ type: 'shop.buy', shop: shop.id, item: st.id, qty: Math.min(n(st.id), st.qty) } as Op, { quiet: true })} aria-label={`Buy ${st.name}`}>
                    {formatMoney(s, priceOf(s, shop, st.basePrice, 'buy', Math.min(n(st.id), Math.max(1, st.qty))))}
                  </Button>
                </li>
              ))}
          </ul>
        </TabPanel>
        <TabPanel value="sell" className="pt-3">
          {sellable.length ? (
            <ul className="flex flex-col divide-y divide-line" aria-label="Your items">
              {sellable.map((it) => (
                <li key={it.id} className="flex items-center gap-3 py-2.5">
                  <ItemGlyph icon={it.icon} size={20} className="text-fg-2" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{it.name}</span>
                    <span className="block text-xs text-fg-2">
                      ×{it.qty}
                      {it.quality ? ` · ${it.quality}` : ''}
                    </span>
                  </span>
                  {it.qty > 1 ? <Qty value={n(it.id)} max={it.qty} onChange={(v) => setQty({ ...qty, [it.id]: v })} label={it.name} /> : null}
                  <Button size="sm" disabled={!can} onClick={() => apply({ type: 'shop.sell', shop: shop.id, item: it.id, qty: Math.min(n(it.id), it.qty) } as Op, { quiet: true })} aria-label={`Sell ${it.name}`}>
                    {formatMoney(s, priceOf(s, shop, itemValue(it) * (it.quality ? QUALITY_MULT[it.quality] : 1), 'sell', Math.min(n(it.id), it.qty)))}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing to sell" body="Items you carry (not equipped or stored) can be sold here." />
          )}
        </TabPanel>
      </Tabs>
      {!here ? <p className="mt-4 text-sm text-fg-2">Go to {shop.locationId ? s.locations[shop.locationId]?.name : 'the shop'} to buy or sell.</p> : null}
    </ToolSheet>
  );
}

function Qty({ value, max, onChange, label }: { value: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <span className="flex items-center gap-0.5" role="group" aria-label={`Quantity of ${label}`}>
      <IconButton size="sm" icon={Minus} label="Fewer" disabled={value <= 1} onClick={() => onChange(Math.max(1, value - 1))} />
      <span className="w-6 text-center text-sm tabular-nums">{value}</span>
      <IconButton size="sm" icon={PlusIcon} label="More" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} />
    </span>
  );
}
