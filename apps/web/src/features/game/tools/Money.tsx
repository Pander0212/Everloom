import { formatDate, formatMoney, installment, type Bill, type CampaignState, type Op } from '@everloom/engine';
import { ArrowLeftRight, Car, Coins, Landmark, Plus, Receipt } from 'lucide-react';
import { useState } from 'react';
import { cx } from '@/lib/format';
import { Badge, Button, EmptyState, Field, Icon, Input, Select, Sheet, Switch, TabPanel, Tabs } from '@/ui';
import { useGame } from '../context';
import { NoCampaign, ToolSheet } from './ToolSheet';

const dueText = (s: CampaignState, b: Bill) => {
  const days = Math.floor(b.nextDue / 1440) - Math.floor(s.time.minutes / 1440);
  if (b.missed) return `${b.missed} missed`;
  if (days <= 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due ${formatDate(b.nextDue, s.meta.calendar, '{mon} {day}')}`;
};

export default function Money({ arg }: { arg?: string }) {
  const { state: s } = useGame();
  const [tab, setTab] = useState(arg ?? 'overview');
  if (!s) return <NoCampaign />;
  return (
    <ToolSheet title="Money">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Wallet' },
          { value: 'bank', label: 'Bank' },
          { value: 'bills', label: 'Bills' },
          { value: 'assets', label: 'Assets' },
          { value: 'history', label: 'History' },
        ]}
      >
        <TabPanel value="overview" className="pt-4">
          <Wallet s={s} />
        </TabPanel>
        <TabPanel value="bank" className="pt-4">
          <Bank s={s} />
        </TabPanel>
        <TabPanel value="bills" className="pt-4">
          <Bills s={s} />
        </TabPanel>
        <TabPanel value="assets" className="pt-4">
          <Assets s={s} />
        </TabPanel>
        <TabPanel value="history" className="pt-4">
          <History s={s} />
        </TabPanel>
      </Tabs>
    </ToolSheet>
  );
}

function Wallet({ s }: { s: CampaignState }) {
  const { apply } = useGame();
  const extra = Object.values(s.economy.currencies);
  const [ex, setEx] = useState<{ from: string; to: string; amount: string }>({ from: 'main', to: extra[0]?.id ?? 'main', amount: '' });
  const [defining, setDefining] = useState(false);
  const saved = Object.values(s.economy.accounts).reduce((n, a) => n + a.balance, 0);
  const due = Object.values(s.economy.bills).filter((b) => b.status === 'active' && (b.missed || b.nextDue - s.time.minutes < 7 * 1440));
  const name = (id: string) => (id === 'main' ? s.meta.currency.name : s.economy.currencies[id]?.name ?? id);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-fg-2">In hand</p>
        <p className="text-3xl font-semibold tabular-nums tracking-tight" aria-label="Money in hand">
          {formatMoney(s, s.player.currency)}
        </p>
        {saved ? <p className="mt-1 text-sm text-fg-2">Plus {formatMoney(s, saved)} in the bank</p> : null}
        {extra.length ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {extra.map((c) => (
              <li key={c.id}>
                <Badge>
                  {(s.economy.wallet[c.id] ?? 0).toLocaleString()} {c.symbol}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {due.length ? (
        <section aria-label="Coming up">
          <h3 className="mb-2 text-sm font-semibold">Coming up</h3>
          <ul className="flex flex-col gap-1.5">
            {due.map((b) => (
              <li key={b.id} className="flex items-center gap-2 text-sm">
                <Icon icon={Receipt} size={16} className="text-fg-3" />
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                <span className={cx('text-xs', b.missed ? 'font-medium text-danger' : 'text-fg-2')}>{dueText(s, b)}</span>
                <span className="tabular-nums">{formatMoney(s, b.amount + b.owed)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-label="Exchange">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Exchange</h3>
          <Button size="sm" variant="quiet" icon={Plus} onClick={() => setDefining(true)}>
            Currency
          </Button>
        </div>
        {extra.length ? (
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <Select aria-label="From currency" value={ex.from} onChange={(e) => setEx({ ...ex, from: e.target.value })}>
              {['main', ...extra.map((c) => c.id)].map((id) => (
                <option key={id} value={id}>
                  {name(id)}
                </option>
              ))}
            </Select>
            <Icon icon={ArrowLeftRight} size={16} className="mb-3 text-fg-3" />
            <Select aria-label="To currency" value={ex.to} onChange={(e) => setEx({ ...ex, to: e.target.value })}>
              {['main', ...extra.map((c) => c.id)].map((id) => (
                <option key={id} value={id}>
                  {name(id)}
                </option>
              ))}
            </Select>
            <Input className="col-span-2" inputMode="decimal" aria-label="Amount to exchange" placeholder="Amount" value={ex.amount} onChange={(e) => setEx({ ...ex, amount: e.target.value })} />
            <Button disabled={!(Number(ex.amount) > 0) || ex.from === ex.to} onClick={() => apply({ type: 'currency.exchange', from: ex.from, to: ex.to, amount: Number(ex.amount) } as Op).then(() => setEx({ ...ex, amount: '' }))}>
              Exchange
            </Button>
          </div>
        ) : (
          <p className="text-sm text-fg-2">Only {s.meta.currency.name} so far. Add another currency to exchange between them (a 2% fee applies).</p>
        )}
      </section>
      <DefineCurrency open={defining} onOpenChange={setDefining} />
    </div>
  );
}

function DefineCurrency({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { apply, state: s } = useGame();
  const [d, setD] = useState({ name: '', symbol: '', rate: '1' });
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Add a currency" size="md" footer={<Button variant="primary" block disabled={!d.name.trim() || !d.symbol.trim() || !(Number(d.rate) > 0)} onClick={() => apply({ type: 'currency.define', name: d.name, symbol: d.symbol, rate: Number(d.rate) } as Op).then(() => onOpenChange(false))}>Add</Button>}>
      <div className="flex flex-col gap-4">
        <Field label="Name" htmlFor="cur-name">
          <Input id="cur-name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Elven Crowns" />
        </Field>
        <Field label="Symbol" htmlFor="cur-sym">
          <Input id="cur-sym" value={d.symbol} onChange={(e) => setD({ ...d, symbol: e.target.value })} placeholder="ec" maxLength={8} />
        </Field>
        <Field label={`Worth in ${s?.meta.currency.name ?? 'main currency'}`} htmlFor="cur-rate" hint="How much one of these is worth in your main currency.">
          <Input id="cur-rate" inputMode="decimal" value={d.rate} onChange={(e) => setD({ ...d, rate: e.target.value })} />
        </Field>
      </div>
    </Sheet>
  );
}

function Bank({ s }: { s: CampaignState }) {
  const { apply } = useGame();
  const accounts = Object.values(s.economy.accounts);
  const loans = Object.values(s.economy.loans);
  const [amount, setAmount] = useState<Record<string, string>>({});
  const [loan, setLoan] = useState({ lender: '', amount: '', installments: '6' });
  const via = s.meta.style === 'fantasy' ? 'branch' : 'app';
  const here = s.currentLocationId ? s.locations[s.currentLocationId] : null;
  const atBank = !!here && (here.kind === 'bank' || /\bbank\b/i.test(here.name) || here.tags.some((t) => /bank/i.test(t)));
  const perPayment = Number(loan.amount) > 0 ? installment(Number(loan.amount), 0.12, 30, Number(loan.installments) || 6) : 0;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-fg-2">
        {via === 'app' ? 'Banking works from your phone anywhere.' : atBank ? `You're at ${here!.name}.` : 'Visit a bank to deposit or withdraw.'} Savings earn interest every day.
      </p>
      {accounts.length ? (
        <ul className="flex flex-col gap-3">
          {accounts.map((a) => (
            <li key={a.id} className="rounded-md border border-line p-3">
              <div className="flex items-center gap-2">
                <Icon icon={Landmark} size={16} className="text-fg-3" />
                <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                <span className="tabular-nums">{formatMoney(s, a.balance)}</span>
              </div>
              <p className="mt-0.5 text-xs text-fg-2">{(a.apr * 100).toFixed(1)}% a year</p>
              <div className="mt-2 flex gap-2">
                <Input inputMode="decimal" aria-label={`Amount for ${a.name}`} placeholder="Amount" value={amount[a.id] ?? ''} onChange={(e) => setAmount({ ...amount, [a.id]: e.target.value })} />
                <Button size="sm" disabled={!(Number(amount[a.id]) > 0)} onClick={() => apply({ type: 'bank.deposit', account: a.id, amount: Number(amount[a.id]), via } as Op).then(() => setAmount({ ...amount, [a.id]: '' }))}>
                  Deposit
                </Button>
                <Button size="sm" disabled={!(Number(amount[a.id]) > 0)} onClick={() => apply({ type: 'bank.withdraw', account: a.id, amount: Number(amount[a.id]), via } as Op).then(() => setAmount({ ...amount, [a.id]: '' }))}>
                  Withdraw
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Landmark} title="No accounts" body={atBank || via === 'app' ? 'Open one to keep your money safe and earning.' : 'Open one at a bank.'} action={atBank || via === 'app' ? <Button onClick={() => apply({ type: 'bank.open', name: 'Savings' } as Op)}>Open an account</Button> : undefined} />
      )}
      {accounts.length && (atBank || via === 'app') ? (
        <Button variant="quiet" size="sm" icon={Plus} className="self-start" onClick={() => apply({ type: 'bank.open', name: `Account ${accounts.length + 1}` } as Op)}>
          Another account
        </Button>
      ) : null}
      <section aria-label="Loans">
        <h3 className="mb-2 text-sm font-semibold">Loans</h3>
        {loans.length ? (
          <ul className="mb-3 flex flex-col gap-1.5 text-sm">
            {loans.map((l) => (
              <li key={l.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{l.lender}</span>
                <Badge tone={l.status === 'active' ? 'neutral' : l.status === 'paid' ? 'success' : 'danger'}>{l.status}</Badge>
                <span className="tabular-nums">{formatMoney(s, l.balance)} left</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Input aria-label="Lender" placeholder="Lender" value={loan.lender} onChange={(e) => setLoan({ ...loan, lender: e.target.value })} />
          <Input aria-label="Loan amount" inputMode="decimal" placeholder="Amount" value={loan.amount} onChange={(e) => setLoan({ ...loan, amount: e.target.value })} />
          <Select aria-label="Installments" value={loan.installments} onChange={(e) => setLoan({ ...loan, installments: e.target.value })}>
            {[3, 6, 12, 24].map((n) => (
              <option key={n} value={n}>
                {n} monthly payments
              </option>
            ))}
          </Select>
          <Button disabled={!loan.lender.trim() || !(Number(loan.amount) > 0)} onClick={() => apply({ type: 'loan.take', lender: loan.lender, amount: Number(loan.amount), apr: 0.12, periodDays: 30, installments: Number(loan.installments) } as Op).then(() => setLoan({ lender: '', amount: '', installments: '6' }))}>
            Borrow
          </Button>
        </div>
        {perPayment ? <p className="mt-1.5 text-xs text-fg-2">12% a year: {formatMoney(s, perPayment)} a month, paid automatically. Missed payments hurt your reputation.</p> : null}
      </section>
    </div>
  );
}

function Bills({ s }: { s: CampaignState }) {
  const { apply } = useGame();
  const bills = Object.values(s.economy.bills).sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || a.nextDue - b.nextDue);
  if (!bills.length) return <EmptyState icon={Receipt} title="No bills" body="Rent, subscriptions, dues and upkeep show up here when the story or your purchases create them." />;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {bills.map((b) => (
        <li key={b.id} className={cx('flex flex-col gap-2 py-3', b.status !== 'active' && 'opacity-60')}>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{b.name}</span>
              <span className={cx('block text-xs', b.missed ? 'font-medium text-danger' : 'text-fg-2')}>
                {b.status === 'active' ? `${formatMoney(s, b.amount)} every ${b.periodDays} days · ${dueText(s, b)}${b.owed ? ` · ${formatMoney(s, b.owed)} late` : ''}` : 'Ended'}
              </span>
            </span>
            {b.status === 'active' ? (
              <Button size="sm" variant={b.missed ? 'primary' : 'secondary'} onClick={() => apply({ type: 'bill.pay', bill: b.id } as Op)}>
                Pay {formatMoney(s, b.amount + b.owed)}
              </Button>
            ) : null}
          </div>
          {b.status === 'active' ? (
            <label className="flex items-center justify-between text-xs text-fg-2">
              Pay automatically when due
              <Switch label={`Autopay ${b.name}`} checked={b.autopay} onChange={(v) => apply({ type: 'bill.set', bill: b.id, autopay: v } as Op, { quiet: true })} />
            </label>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Assets({ s }: { s: CampaignState }) {
  const { apply } = useGame();
  const assets = Object.values(s.economy.assets);
  if (!assets.length) return <EmptyState icon={Car} title="Nothing owned yet" body="Property, vehicles, businesses and animals you come to own appear here, with their upkeep and income." />;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {assets.map((a) => (
        <li key={a.id} className="flex items-center gap-3 py-3">
          <Icon icon={a.kind === 'vehicle' ? Car : Coins} size={18} className="text-fg-3" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{a.name}</span>
            <span className="block text-xs text-fg-2">
              {a.kind} · worth {formatMoney(s, a.value)}
              {a.income ? ` · earns ${formatMoney(s, a.income)}/${a.periodDays}d` : ''}
              {a.upkeep ? ` · costs ${formatMoney(s, a.upkeep)}/${a.periodDays}d` : ''}
              {a.modes.length ? ` · travel: ${a.modes.join(', ')}` : ''}
            </span>
          </span>
          {a.status === 'owned' ? (
            <Button size="sm" variant="quiet" onClick={() => apply({ type: 'asset.sell', name: a.id } as Op)}>
              Sell
            </Button>
          ) : (
            <Badge tone={a.status === 'lost' ? 'danger' : 'neutral'}>{a.status}</Badge>
          )}
        </li>
      ))}
    </ul>
  );
}

function History({ s }: { s: CampaignState }) {
  const list = [...s.economy.ledger].reverse().slice(0, 100);
  if (!list.length) return <EmptyState title="No transactions yet" />;
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Transactions">
      {list.map((t) => (
        <li key={t.id} className="flex items-baseline gap-2 text-sm">
          <span className="w-14 flex-none text-xs tabular-nums text-fg-3">{formatDate(t.at, s.meta.calendar, '{mon} {day}')}</span>
          <span className="min-w-0 flex-1 truncate">{t.text}</span>
          <span className={cx('tabular-nums', t.amount > 0 ? 'text-success' : t.amount < 0 ? 'text-fg' : 'text-fg-3')}>{t.amount > 0 ? '+' : ''}{formatMoney(s, t.amount)}</span>
        </li>
      ))}
    </ul>
  );
}
