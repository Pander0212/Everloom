import { AMENITIES, formatClock, formatMoney, isAtHome, memberWhere, presentAt, type CampaignState, type Home as HomeT, type Op } from '@everloom/engine';
import { Bath, Bed, ChefHat, House, Plus, UserPlus, Warehouse } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cx } from '@/lib/format';
import { Badge, Button, EmptyState, Field, Icon, Input, Select, Sheet, TabPanel, Tabs } from '@/ui';
import { useGame } from '../context';
import { ItemGlyph } from '../ItemGlyph';
import { NoCampaign, ToolSheet } from './ToolSheet';

const KINDS = ['house', 'apartment', 'room', 'guild', 'castle', 'cabin', 'campsite', 'cave', 'vehicle', 'other'] as const;
const ROLES = ['head', 'resident', 'dependent', 'guardian', 'guest'] as const;
const upgradeCost = (s: CampaignState, level: number) => (s.meta.style === 'fantasy' ? 25 : s.meta.style === 'scifi' ? 800 : 500) * level;

export default function Home() {
  const { state: s } = useGame();
  const homes = Object.values(s?.homes ?? {});
  const [id, setId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (!s || (id && s.homes[id])) return;
    const here = homes.find((h) => isAtHome(s, h));
    setId(here?.id ?? homes.find((h) => h.primary)?.id ?? homes[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, id]);
  if (!s) return <NoCampaign />;
  const home = id ? s.homes[id] : null;
  return (
    <ToolSheet
      title="Home"
      headerActions={
        <Button size="sm" variant="quiet" icon={Plus} onClick={() => setAdding(true)}>
          Add home
        </Button>
      }
    >
      {homes.length > 1 ? (
        <Select aria-label="Which home" value={id ?? ''} onChange={(e) => setId(e.target.value)} className="mb-4">
          {homes.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
              {h.primary ? ' (primary)' : ''}
              {h.ownership === 'lost' ? ' — lost' : ''}
            </option>
          ))}
        </Select>
      ) : null}
      {home ? <HomeView s={s} home={home} /> : <EmptyState icon={House} title="No home yet" body="Find a place in the story, or add one: a house, a rented room, a campsite, a ship's cabin…" action={<Button onClick={() => setAdding(true)}>Add a home</Button>} />}
      <AddHome open={adding} onOpenChange={setAdding} />
    </ToolSheet>
  );
}

function HomeView({ s, home }: { s: CampaignState; home: HomeT }) {
  const { apply, open } = useGame();
  const [tab, setTab] = useState('now');
  const here = isAtHome(s, home);
  const people = presentAt(s, home);
  const place = home.locationId ? s.locations[home.locationId]?.name : null;
  const bill = home.billId ? s.economy.bills[home.billId] : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold">{home.name}</span>
        {home.primary ? <Badge tone="accent">Primary</Badge> : null}
        <Badge tone={home.ownership === 'lost' ? 'danger' : 'neutral'}>{home.ownership}</Badge>
        <span className="text-sm text-fg-2">
          {home.kind}
          {place ? ` · ${place}` : ''}
          {bill && bill.status === 'active' ? ` · rent ${formatMoney(s, bill.amount)}/${bill.periodDays}d` : ''}
        </span>
        {!home.primary && home.ownership !== 'lost' ? (
          <Button size="sm" variant="quiet" onClick={() => apply({ type: 'home.update', home: home.id, primary: true } as Op)}>
            Make primary
          </Button>
        ) : null}
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'now', label: 'Now' },
          { value: 'rooms', label: 'Rooms' },
          { value: 'storage', label: 'Storage' },
          { value: 'household', label: 'Household' },
        ]}
      >
        <TabPanel value="now" className="flex flex-col gap-5 pt-4">
          <section aria-label="Who's home">
            <h3 className="mb-2 text-sm font-semibold">Home now</h3>
            {people.length ? (
              <ul className="flex flex-col gap-1 text-sm">
                {people.map((p) => (
                  <li key={p.member.id}>
                    <span className="font-medium">{p.member.name}</span>
                    <span className="text-fg-2">
                      {p.member.relation ? ` · ${p.member.relation}` : ''}
                      {p.resident ? '' : ' · visiting'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-2">Nobody else is home.</p>
            )}
          </section>
          {here ? (
            <section aria-label="Home actions" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Button icon={Bed} onClick={() => apply({ type: 'activity', kind: 'sleep' } as Op)}>
                Sleep
              </Button>
              <Button icon={Bed} onClick={() => apply({ type: 'activity', kind: 'rest' } as Op)}>
                Rest
              </Button>
              <Button icon={Bath} onClick={() => apply({ type: 'activity', kind: 'bathe' } as Op)}>
                Bathe
              </Button>
              <Button icon={ChefHat} onClick={() => open('crafting', 'cooking')}>
                Cook
              </Button>
            </section>
          ) : (
            <p className="rounded-md bg-surface-2 p-3 text-sm text-fg-2">You're away{place ? ` from ${place}` : ''}. Resting, cooking, storage and inviting people over work when you're there.</p>
          )}
          {here ? <Invite s={s} /> : null}
        </TabPanel>
        <TabPanel value="rooms" className="pt-4">
          <Rooms s={s} home={home} />
        </TabPanel>
        <TabPanel value="storage" className="pt-4">
          <StorageTab s={s} home={home} here={here} />
        </TabPanel>
        <TabPanel value="household" className="pt-4">
          <Household s={s} home={home} />
        </TabPanel>
      </Tabs>
    </div>
  );
}

function Invite({ s }: { s: CampaignState }) {
  const { apply } = useGame();
  const [npc, setNpc] = useState('');
  const npcs = Object.values(s.npcs).filter((n) => n.status === 'alive');
  if (!npcs.length) return null;
  return (
    <section aria-label="Invite someone" className="flex items-end gap-2">
      <Field label="Invite someone over" htmlFor="invite" className="flex-1">
        <Select id="invite" value={npc} onChange={(e) => setNpc(e.target.value)}>
          <option value="">Choose…</option>
          {npcs.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </Select>
      </Field>
      <Button icon={UserPlus} disabled={!npc} onClick={() => apply({ type: 'home.invite', npc, hours: 3 } as Op).then(() => setNpc(''))}>
        Invite
      </Button>
    </section>
  );
}

function Rooms({ s, home }: { s: CampaignState; home: HomeT }) {
  const { apply } = useGame();
  const [name, setName] = useState('');
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {home.rooms.map((r) => (
          <li key={r.id} className="rounded-md border border-line p-3">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
              <span className="text-xs text-fg-2">Level {r.level}</span>
              {r.level < 3 && home.ownership !== 'lost' ? (
                <Button size="sm" variant="quiet" onClick={() => apply({ type: 'room.update', home: home.id, room: r.id, upgrade: true } as Op)}>
                  Upgrade · {formatMoney(s, upgradeCost(s, r.level))}
                </Button>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {r.amenities.map((a) => (
                <Badge key={a}>{AMENITIES.find((x) => x.id === a)?.label ?? a}</Badge>
              ))}
              <Select
                aria-label={`Add to ${r.name}`}
                value=""
                className="!h-7 w-auto !py-0 text-xs"
                onChange={(e) => e.target.value && apply({ type: 'room.update', home: home.id, room: r.id, addAmenity: e.target.value } as Op, { quiet: true })}
              >
                <option value="">+ Add</option>
                {AMENITIES.filter((a) => !r.amenities.includes(a.id)).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input aria-label="New room name" placeholder="New room (Study, Workshop…)" value={name} onChange={(e) => setName(e.target.value)} />
        <Button disabled={!name.trim()} onClick={() => apply({ type: 'room.add', home: home.id, name } as Op, { quiet: true }).then(() => setName(''))}>
          Add
        </Button>
      </div>
      <p className="text-xs text-fg-2">A bed makes sleep restore more (more with each upgrade); a kitchen, forge, alchemy bench, enchanting table or workbench is a crafting station.</p>
    </div>
  );
}

function StorageTab({ s, home, here }: { s: CampaignState; home: HomeT; here: boolean }) {
  const { apply } = useGame();
  const carried = Object.values(s.inventory).filter((i) => !i.holder && !i.equipped && !i.containerId);
  return (
    <div className="flex flex-col gap-4">
      {!here ? <p className="text-sm text-fg-2">You can see what's stored here from anywhere; storing and taking things needs you at home.</p> : null}
      {home.storage.map((st) => {
        const items = Object.values(s.inventory).filter((i) => i.holder === `store:${st.id}`);
        return (
          <section key={st.id} aria-label={st.name} className="rounded-md border border-line p-3">
            <div className="mb-2 flex items-center gap-2">
              <Icon icon={Warehouse} size={16} className="text-fg-3" />
              <span className="flex-1 font-medium">{st.name}</span>
              <span className={cx('text-xs tabular-nums', items.length >= st.capacity ? 'text-warning' : 'text-fg-2')}>
                {items.length}/{st.capacity}
              </span>
            </div>
            {items.length ? (
              <ul className="flex flex-col gap-1">
                {items.map((it) => (
                  <li key={it.id} className="flex items-center gap-2 text-sm">
                    <ItemGlyph icon={it.icon} name={it.name} size={16} className="text-fg-3" />
                    <span className="min-w-0 flex-1 truncate">
                      {it.name}
                      {it.qty > 1 ? ` ×${it.qty}` : ''}
                    </span>
                    <Button size="sm" variant="quiet" disabled={!here} onClick={() => apply({ type: 'item.move', name: it.id, to: 'me' } as Op, { quiet: true })}>
                      Take
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-2">Empty.</p>
            )}
            {here && carried.length && items.length < st.capacity ? (
              <Select aria-label={`Store in ${st.name}`} value="" className="mt-2" onChange={(e) => e.target.value && apply({ type: 'item.move', name: e.target.value, to: st.id } as Op, { quiet: true })}>
                <option value="">Store something…</option>
                {carried.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                    {it.qty > 1 ? ` ×${it.qty}` : ''}
                  </option>
                ))}
              </Select>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function Household({ s, home }: { s: CampaignState; home: HomeT }) {
  const { apply } = useGame();
  const members = Object.values(s.household).filter((m) => m.homeId === home.id);
  const [d, setD] = useState({ name: '', role: 'resident' as (typeof ROLES)[number], relation: '', awayFrom: '', awayTo: '', place: '' });
  const add = () => {
    const schedule =
      d.awayFrom && d.awayTo
        ? [{ days: [], from: toMin(d.awayFrom), to: toMin(d.awayTo), activity: d.role === 'guest' ? 'visiting' : 'away', location: d.role === 'guest' ? (home.locationId ? s.locations[home.locationId]?.name : undefined) : d.place || undefined }]
        : undefined;
    void apply({ type: 'household.add', name: d.name, home: home.id, role: d.role, relation: d.relation, schedule } as Op).then(() => setD({ name: '', role: 'resident', relation: '', awayFrom: '', awayTo: '', place: '' }));
  };
  return (
    <div className="flex flex-col gap-4">
      {members.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {members.map((m) => {
            const w = memberWhere(s, m);
            const atHome = home.locationId && w.locationId === home.locationId;
            return (
              <li key={m.id} className="flex items-center gap-2 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{m.name}</span>
                  <span className="block text-xs text-fg-2">
                    {m.role}
                    {m.relation ? ` · ${m.relation}` : ''} · {atHome ? 'home now' : w.locationId ? `at ${s.locations[w.locationId]?.name ?? 'somewhere'}` : w.activity}
                    {m.schedule.length ? ` · ${m.schedule.map((sl) => `${sl.activity || 'away'} ${formatClock(sl.from, s.meta.calendar)}–${formatClock(sl.to, s.meta.calendar)}`).join(', ')}` : ''}
                  </span>
                </span>
                <Button size="sm" variant="quiet" onClick={() => apply({ type: 'household.remove', member: m.id } as Op, { quiet: true })}>
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-fg-2">Nobody else lives here yet. Family, roommates, pets, a partner who visits: add them to see who's home when.</p>
      )}
      <section aria-label="Add to household" className="grid grid-cols-2 gap-2">
        <Input aria-label="Name" placeholder="Name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        <Input aria-label="Relation" placeholder="Relation (child, partner…)" value={d.relation} onChange={(e) => setD({ ...d, relation: e.target.value })} />
        <Select aria-label="Role" value={d.role} onChange={(e) => setD({ ...d, role: e.target.value as (typeof ROLES)[number] })}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r === 'guest' ? 'guest (visits)' : r}
            </option>
          ))}
        </Select>
        <Input aria-label={d.role === 'guest' ? 'Visiting place' : 'Where they go'} placeholder={d.role === 'guest' ? 'Visits here' : 'Away at (school, work…)'} value={d.place} onChange={(e) => setD({ ...d, place: e.target.value })} disabled={d.role === 'guest'} />
        <Input type="time" aria-label={d.role === 'guest' ? 'Visits from' : 'Away from'} value={d.awayFrom} onChange={(e) => setD({ ...d, awayFrom: e.target.value })} />
        <Input type="time" aria-label={d.role === 'guest' ? 'Visits until' : 'Away until'} value={d.awayTo} onChange={(e) => setD({ ...d, awayTo: e.target.value })} />
        <Button className="col-span-2" icon={UserPlus} disabled={!d.name.trim()} onClick={add}>
          Add to household
        </Button>
      </section>
    </div>
  );
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

function AddHome({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { apply, state: s } = useGame();
  const [d, setD] = useState({ name: '', kind: 'house' as (typeof KINDS)[number], ownership: 'owned' as 'owned' | 'rented' | 'borrowed', rent: '' });
  const here = s?.currentLocationId ? s.locations[s.currentLocationId]?.name : null;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add a home"
      description={here ? `It will be at ${here}.` : 'It gets its own place on the map.'}
      size="md"
      footer={
        <Button variant="primary" block disabled={!d.name.trim()} onClick={() => apply({ type: 'home.add', name: d.name, kind: d.kind, ownership: d.ownership, rent: d.ownership === 'rented' && Number(d.rent) > 0 ? Number(d.rent) : undefined, periodDays: 30 } as Op).then(() => onOpenChange(false))}>
          Add home
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" htmlFor="home-name">
          <Input id="home-name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Rose Cottage" />
        </Field>
        <Field label="Kind" htmlFor="home-kind">
          <Select id="home-kind" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as (typeof KINDS)[number] })}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Yours by" htmlFor="home-own">
          <Select id="home-own" value={d.ownership} onChange={(e) => setD({ ...d, ownership: e.target.value as typeof d.ownership })}>
            <option value="owned">Owning it</option>
            <option value="rented">Renting it</option>
            <option value="borrowed">Borrowing it</option>
          </Select>
        </Field>
        {d.ownership === 'rented' ? (
          <Field label="Monthly rent" htmlFor="home-rent" hint="Rent becomes a bill, due every 30 days.">
            <Input id="home-rent" inputMode="decimal" value={d.rent} onChange={(e) => setD({ ...d, rent: e.target.value })} />
          </Field>
        ) : null}
      </div>
    </Sheet>
  );
}
