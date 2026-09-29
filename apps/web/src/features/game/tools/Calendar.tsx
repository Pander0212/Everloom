import type { CalendarConfig, CalendarEvent, Op } from '@everloom/engine';
import { currentSlot, formatClock, fromDate, MIN_PER_DAY, occurrencesBetween, toDate } from '@everloom/engine';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cx } from '@/lib/format';
import { Badge, Button, Dialog, EmptyState, Field, IconButton, Input, Segmented, Select, Textarea } from '@/ui';
import { useGame } from '../context';
import { NoCampaign, ToolSheet } from './ToolSheet';

export default function Calendar() {
  const { state: s } = useGame();
  const [tab, setTab] = useState<'calendar' | 'schedules' | 'settings'>('calendar');
  if (!s) return <ToolSheet title="Calendar"><NoCampaign /></ToolSheet>;
  return (
    <ToolSheet title="Calendar" description={`${s.meta.calendar.name} · ${s.meta.dayLength.mode === 'realtime' ? `1 day = ${s.meta.dayLength.realMinutesPerDay} real minutes` : 'time passes with the story'}`}>
      <Segmented
        label="View"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'calendar', label: 'Calendar' },
          { value: 'schedules', label: 'Schedules' },
          { value: 'settings', label: 'Settings' },
        ]}
      />
      <div className="mt-4">{tab === 'calendar' ? <Month /> : tab === 'schedules' ? <Schedules /> : <CalendarSettings />}</div>
    </ToolSheet>
  );
}

function Month() {
  const { state: s, apply } = useGame();
  const cal = s!.meta.calendar;
  const now = toDate(s!.time.minutes, cal);
  const [view, setView] = useState({ year: now.year, month: now.month });
  const [selected, setSelected] = useState<number>(now.day);
  const [adding, setAdding] = useState(false);
  const days = cal.months[view.month]?.days ?? 30;
  const start = fromDate({ year: view.year, month: view.month, day: 1 }, cal);
  const end = start + days * MIN_PER_DAY;
  const firstWeekday = toDate(start, cal).weekday;
  const occ = useMemo(() => {
    const map = new Map<number, Array<{ ev: CalendarEvent; at: number }>>();
    for (const ev of Object.values(s!.events)) {
      for (const at of occurrencesBetween(ev.at, ev.recurring, start - 1, end - 1, cal, 40)) {
        const d = toDate(at, cal).day;
        if (!map.has(d)) map.set(d, []);
        map.get(d)!.push({ ev, at });
      }
    }
    return map;
  }, [s, start, end, cal]);
  const shift = (d: number) => {
    let m = view.month + d;
    let y = view.year;
    if (m < 0) {
      m = cal.months.length - 1;
      y--;
    }
    if (m >= cal.months.length) {
      m = 0;
      y++;
    }
    setView({ year: y, month: m });
    setSelected(1);
  };
  const wd = cal.weekdays.length || 7;
  const cells: Array<number | null> = [...Array(firstWeekday).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const dayEvents = occ.get(selected) ?? [];
  return (
    <div>
      <div className="flex items-center justify-between">
        <IconButton icon={ChevronLeft} label="Previous month" onClick={() => shift(-1)} />
        <p className="text-base font-semibold">
          {cal.months[view.month]?.name} {view.year}
        </p>
        <IconButton icon={ChevronRight} label="Next month" onClick={() => shift(1)} />
      </div>
      <div className="mt-2 grid text-center text-xs text-fg-3" style={{ gridTemplateColumns: `repeat(${wd}, minmax(0, 1fr))` }}>
        {cal.weekdays.map((w) => (
          <span key={w} className="py-1">
            {w.slice(0, 2)}
          </span>
        ))}
      </div>
      <div className="grid gap-y-1" style={{ gridTemplateColumns: `repeat(${wd}, minmax(0, 1fr))` }}>
        {cells.map((d, i) =>
          d === null ? (
            <span key={`e${i}`} />
          ) : (
            <button
              key={d}
              onClick={() => setSelected(d)}
              aria-label={`${cal.months[view.month]?.name} ${d}`}
              aria-pressed={selected === d}
              className={cx(
                'pressable relative mx-auto flex h-10 w-10 flex-col items-center justify-center rounded-full text-sm tabular-nums',
                selected === d ? 'bg-accent text-accent-fg' : view.year === now.year && view.month === now.month && d === now.day ? 'bg-accent-soft font-semibold text-accent-text' : 'hover:bg-surface-2',
              )}
            >
              {d}
              {occ.has(d) ? <span className={cx('absolute bottom-1 h-1 w-1 rounded-full', selected === d ? 'bg-accent-fg' : 'bg-accent')} /> : null}
            </button>
          ),
        )}
      </div>
      <div className="mt-5 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {cal.months[view.month]?.name} {selected}
        </h3>
        <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAdding(true)}>
          Event
        </Button>
      </div>
      {dayEvents.length ? (
        <div className="mt-1 flex flex-col divide-y divide-line">
          {dayEvents.map(({ ev, at }) => (
            <div key={`${ev.id}${at}`} className="flex min-h-12 items-center gap-3 py-2">
              <span className="w-16 flex-none text-sm tabular-nums text-fg-2">{formatClock(at, cal)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{ev.title}</span>
                {ev.notes ? <span className="block truncate text-xs text-fg-2">{ev.notes}</span> : null}
              </span>
              {ev.kind !== 'event' ? <Badge>{ev.kind}</Badge> : null}
              {ev.recurring !== 'none' ? <Badge tone="accent">{ev.recurring}</Badge> : null}
              <IconButton size="sm" icon={Trash2} label="Delete event" onClick={() => apply({ type: 'event.remove', title: ev.title } as Op, { quiet: true })} />
            </div>
          ))}
        </div>
      ) : (
        <p className="py-4 text-sm text-fg-2">Nothing planned.</p>
      )}
      <EventDialog open={adding} onOpenChange={setAdding} date={{ year: view.year, month: view.month + 1, day: selected }} />
    </div>
  );
}

function EventDialog({ open, onOpenChange, date }: { open: boolean; onOpenChange: (o: boolean) => void; date: { year: number; month: number; day: number } }) {
  const { apply, state: s } = useGame();
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('09:00');
  const [kind, setKind] = useState<CalendarEvent['kind']>('event');
  const [recurring, setRecurring] = useState<CalendarEvent['recurring']>('none');
  const [notes, setNotes] = useState('');
  const [npc, setNpc] = useState('');
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New event"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!title.trim()}
            onClick={async () => {
              const [h, m] = time.split(':').map(Number);
              await apply({ type: 'event.add', title: title.trim(), kind, recurring: kind === 'birthday' ? 'yearly' : recurring, notes, npc: npc || undefined, date: { ...date, hour: h || 0, minute: m || 0 } } as Op);
              onOpenChange(false);
              setTitle('');
              setNotes('');
            }}
          >
            Add
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Title" htmlFor="et">
          <Input id="et" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Time" htmlFor="etm">
            <Input id="etm" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Kind" htmlFor="ek">
            <Select id="ek" value={kind} onChange={(e) => setKind(e.target.value as CalendarEvent['kind'])}>
              <option value="event">Event</option>
              <option value="reminder">Reminder</option>
              <option value="birthday">Birthday</option>
              <option value="holiday">Holiday</option>
            </Select>
          </Field>
        </div>
        {kind === 'birthday' ? (
          <Field label="Whose birthday" htmlFor="enpc">
            <Select id="enpc" value={npc} onChange={(e) => setNpc(e.target.value)}>
              <option value="">Someone else</option>
              {Object.values(s?.npcs ?? {}).map((n) => (
                <option key={n.id} value={n.name}>
                  {n.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Repeats" htmlFor="er">
            <Select id="er" value={recurring} onChange={(e) => setRecurring(e.target.value as CalendarEvent['recurring'])}>
              <option value="none">Once</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </Select>
          </Field>
        )}
        <Field label="Notes" htmlFor="en">
          <Textarea id="en" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function Schedules() {
  const { state: s, open } = useGame();
  const withSchedule = Object.values(s!.npcs).filter((n) => n.schedule.length);
  if (!withSchedule.length) return <EmptyState title="No schedules yet" body="Give NPCs a routine in their profile; the world moves them as time passes." action={<Button onClick={() => open('npcs')}>Open NPCs</Button>} />;
  return (
    <div className="flex flex-col divide-y divide-line">
      {withSchedule.map((n) => {
        const slot = currentSlot(n, s!.time.minutes, s!);
        const loc = slot?.locationId ? s!.locations[slot.locationId]?.name : n.locationId ? s!.locations[n.locationId]?.name : null;
        return (
          <button key={n.id} onClick={() => open('npcs', n.id)} className="pressable flex min-h-14 items-start gap-3 py-3 text-left">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{n.name}</span>
              <span className="block text-sm text-fg-2">{slot ? slot.activity : 'No current activity'}</span>
            </span>
            {loc ? <span className="max-w-[45%] truncate text-right text-xs text-fg-2">{loc}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function CalendarSettings() {
  const { state: s, apply } = useGame();
  const [cal, setCal] = useState<CalendarConfig>(structuredClone(s!.meta.calendar));
  const [mode, setMode] = useState(s!.meta.dayLength.mode);
  const [realMin, setRealMin] = useState(s!.meta.dayLength.realMinutesPerDay);
  return (
    <div className="flex flex-col gap-4">
      <Field label="Calendar name" htmlFor="cn">
        <Input id="cn" value={cal.name} onChange={(e) => setCal({ ...cal, name: e.target.value })} />
      </Field>
      <Field label="Months" hint="Name and number of days.">
        <div className="flex flex-col gap-1.5">
          {cal.months.map((m, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label={`Month ${i + 1} name`} value={m.name} onChange={(e) => setCal({ ...cal, months: cal.months.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <Input aria-label={`Month ${i + 1} days`} type="number" min={1} max={60} value={m.days} onChange={(e) => setCal({ ...cal, months: cal.months.map((x, j) => (j === i ? { ...x, days: Number(e.target.value) } : x)) })} className="max-w-[90px]" />
              <IconButton icon={Trash2} label="Remove month" disabled={cal.months.length <= 1} onClick={() => setCal({ ...cal, months: cal.months.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <div>
            <Button size="sm" variant="quiet" icon={Plus} onClick={() => setCal({ ...cal, months: [...cal.months, { name: `Month ${cal.months.length + 1}`, days: 30 }] })}>
              Add month
            </Button>
          </div>
        </div>
      </Field>
      <Field label="Weekdays" htmlFor="cw" hint="Comma separated.">
        <Input id="cw" value={cal.weekdays.join(', ')} onChange={(e) => setCal({ ...cal, weekdays: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date format" htmlFor="cf" hint="{weekday} {month} {mon} {day} {year}">
          <Input id="cf" value={cal.dateFormat} onChange={(e) => setCal({ ...cal, dateFormat: e.target.value })} />
        </Field>
        <Field label="Clock" htmlFor="cc">
          <Select id="cc" value={cal.clock} onChange={(e) => setCal({ ...cal, clock: e.target.value as '12h' | '24h' })}>
            <option value="12h">12-hour</option>
            <option value="24h">24-hour</option>
          </Select>
        </Field>
      </div>
      <Field label="Day length" hint={mode === 'realtime' ? 'The world keeps moving while you are away (up to a week of catch-up).' : 'Time only moves when the story says so.'}>
        <Segmented
          label="Day length"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'turns', label: 'Story-driven' },
            { value: 'realtime', label: 'Real time' },
          ]}
        />
      </Field>
      {mode === 'realtime' ? (
        <Field label="Real minutes per game day" htmlFor="crm">
          <Input id="crm" type="number" min={1} max={1440} value={realMin} onChange={(e) => setRealMin(Number(e.target.value))} className="max-w-[140px]" />
        </Field>
      ) : null}
      <Button variant="primary" onClick={() => apply({ type: 'meta.update', calendar: cal, dayLengthMode: mode, realMinutesPerDay: realMin } as Op, { quiet: true })}>
        Save calendar
      </Button>
    </div>
  );
}
