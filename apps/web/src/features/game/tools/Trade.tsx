import { describeFairness, formatMoney, guessCategory, itemValue, tradeAccepted, type Op } from '@everloom/engine';
import { ArrowLeftRight, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { cx } from '@/lib/format';
import { Button, EmptyState, Field, IconButton, Input, Select } from '@/ui';
import { useGame } from '../context';
import { NoCampaign, ToolSheet } from './ToolSheet';

type Want = { name: string; qty: number; value: string };

/** Offer items and/or money for something a person has. A fairness hint updates as you build the offer. */
export default function Trade({ arg }: { arg?: string }) {
  const { state: s, apply } = useGame();
  const [npcId, setNpcId] = useState(arg ?? '');
  const [give, setGive] = useState<Record<string, number>>({});
  const [pay, setPay] = useState('');
  const [want, setWant] = useState<Want[]>([{ name: '', qty: 1, value: '' }]);
  if (!s) return <NoCampaign />;
  const people = Object.values(s.npcs).filter((n) => n.status === 'alive');
  if (!people.length) return <ToolSheet title="Trade"><EmptyState icon={ArrowLeftRight} title="Nobody to trade with yet" /></ToolSheet>;
  const npc = s.npcs[npcId];
  const carried = Object.values(s.inventory).filter((i) => !i.holder && !i.equipped && !i.locked && i.category !== 'quest');
  const giveValue = Object.entries(give).reduce((n, [id, q]) => n + (s.inventory[id] ? itemValue(s.inventory[id]!) * q : 0), 0) + Math.max(0, Number(pay) || 0);
  const wanted = want.filter((w) => w.name.trim());
  const getValue = wanted.reduce((n, w) => n + (Number(w.value) > 0 ? Number(w.value) : itemValue({ value: 0, category: guessCategory(w.name) })) * w.qty, 0) + Math.max(0, -(Number(pay) || 0));
  const affection = npc ? (Object.values(s.relationships).find((r) => r.npcId === npc.id)?.affection ?? 0) : 0;
  const verdict = tradeAccepted(giveValue, getValue, affection);
  const fair = describeFairness(verdict.ratio);
  const offer = () =>
    apply({
      type: 'trade.exchange',
      npc: npc!.id,
      give: Object.entries(give).filter(([, q]) => q > 0).map(([id, qty]) => ({ name: s.inventory[id]!.name, qty })),
      pay: Number(pay) || 0,
      receive: wanted.map((w) => ({ name: w.name, qty: w.qty, value: Number(w.value) > 0 ? Number(w.value) : undefined })),
    } as Op).then((r) => r && (setGive({}), setPay(''), setWant([{ name: '', qty: 1, value: '' }])));
  return (
    <ToolSheet
      title="Trade"
      footer={
        npc ? (
          <div className="flex w-full items-center gap-3">
            <span className={cx('text-sm', verdict.ok ? 'text-fg-2' : 'text-warning')}>
              {giveValue || getValue ? (
                <>
                  Offer looks <strong className="font-medium">{fair}</strong>
                  {verdict.ok ? '' : ` — ${npc.name} will likely refuse`}
                </>
              ) : (
                'Build an offer'
              )}
            </span>
            <span className="flex-1" />
            <Button variant="primary" disabled={!wanted.length && !Object.values(give).some(Boolean)} onClick={offer}>
              Offer
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="Trade with" htmlFor="trade-npc">
          <Select id="trade-npc" value={npcId} onChange={(e) => setNpcId(e.target.value)}>
            <option value="">Choose someone…</option>
            {people.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </Select>
        </Field>
        {npc ? (
          <>
            <section aria-label="You give">
              <h3 className="mb-2 text-sm font-semibold">You give</h3>
              {carried.length ? (
                <ul className="flex flex-col gap-1.5">
                  {carried.map((it) => (
                    <li key={it.id} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">
                        {it.name} <span className="text-fg-3">×{it.qty}</span>
                      </span>
                      <span className="text-xs text-fg-3">{formatMoney(s, itemValue(it))} each</span>
                      <Input
                        className="!w-16"
                        type="number"
                        min={0}
                        max={it.qty}
                        aria-label={`Give how many ${it.name}`}
                        value={give[it.id] ?? 0}
                        onChange={(e) => setGive({ ...give, [it.id]: Math.max(0, Math.min(it.qty, Number(e.target.value) || 0)) })}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-fg-2">You aren't carrying anything to trade.</p>
              )}
              <Field label={`Money (${s.meta.currency.name}; negative means they pay you)`} htmlFor="trade-pay" className="mt-3">
                <Input id="trade-pay" inputMode="decimal" value={pay} onChange={(e) => setPay(e.target.value)} placeholder="0" />
              </Field>
            </section>
            <section aria-label="You get">
              <h3 className="mb-2 text-sm font-semibold">You get from {npc.name}</h3>
              <ul className="flex flex-col gap-2">
                {want.map((w, i) => (
                  <li key={i} className="grid grid-cols-[1fr_4rem_5.5rem_auto] items-center gap-2">
                    <Input aria-label="Item name" placeholder="What they have" value={w.name} onChange={(e) => setWant(want.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    <Input aria-label="How many" type="number" min={1} value={w.qty} onChange={(e) => setWant(want.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)))} />
                    <Input aria-label="Worth each" inputMode="decimal" placeholder="Worth" value={w.value} onChange={(e) => setWant(want.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                    <IconButton size="sm" icon={X} label="Remove" onClick={() => setWant(want.length > 1 ? want.filter((_, j) => j !== i) : [{ name: '', qty: 1, value: '' }])} />
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="quiet" icon={Plus} className="mt-1" onClick={() => setWant([...want, { name: '', qty: 1, value: '' }])}>
                Another item
              </Button>
            </section>
          </>
        ) : null}
      </div>
    </ToolSheet>
  );
}
