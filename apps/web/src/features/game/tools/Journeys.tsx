import { blockers, carries, checkRequirements, formatClock, formatDate, formatDuration, formatMoney, linesAt, planTrip, recentPlaces, ticketName, ticketPrice, type CampaignState, type Location, type Op, type TransitLine } from '@everloom/engine';
import { History, MapPin, TrainFront } from 'lucide-react';
import { Badge, Button, EmptyState, Icon, Sheet } from '@/ui';
import { useGame } from '../context';

const H = ({ children }: { children: string }) => <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">{children}</h3>;

/** Scheduled rides from where you are to one place (or every stop), with tickets and blockers. */
export function RideList({ s, to }: { s: CampaignState; to?: Location }) {
  const { apply } = useGame();
  const lines = linesAt(s, s.currentLocationId).filter((l) => !to || l.stops.includes(to.id));
  if (!lines.length) return null;
  return (
    <ul className="flex flex-col gap-2">
      {lines.map((line) => (
        <LineRow key={line.id} s={s} line={line} only={to} onRide={(dest) => apply({ type: 'transit.ride', line: line.id, to: dest } as Op)} onTicket={() => apply({ type: 'transit.ticket', line: line.id } as Op, { quiet: true })} />
      ))}
    </ul>
  );
}

function LineRow({ s, line, only, onRide, onTicket }: { s: CampaignState; line: TransitLine; only?: Location; onRide: (to: string) => void; onTicket: () => void }) {
  const cal = s.meta.calendar;
  const tickets = Object.values(s.inventory).find((i) => !i.holder && i.name === ticketName(line))?.qty ?? 0;
  const stop = blockers(checkRequirements(s, line.requires))[0];
  const dests = line.stops.filter((id) => id !== s.currentLocationId && (!only || id === only.id));
  return (
    <li className="rounded-md border border-line p-3">
      <div className="flex items-center gap-2">
        <Icon icon={TrainFront} size={16} className="text-fg-3" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{line.name}</span>
        <Badge>{line.mode}</Badge>
        {tickets ? <Badge tone="accent">{tickets} ticket{tickets === 1 ? '' : 's'}</Badge> : null}
      </div>
      {stop ? (
        <p className="mt-2 text-xs text-warning">
          {stop.reason}. <span className="text-fg-2">{stop.fix}</span>
        </p>
      ) : null}
      <ul className="mt-2 flex flex-col divide-y divide-line">
        {dests.map((id) => {
          const trip = planTrip(s, line, s.currentLocationId!, id);
          const place = s.locations[id];
          if (!trip || !place) return null;
          const paid = carries(s, ticketName(line));
          return (
            <li key={id} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{place.discovered ? place.name : 'Unknown place'}</span>
                <span className="block text-xs text-fg-2">
                  {trip.wait < 1440 ? `Departs ${formatClock(trip.depart, cal)}` : `Next ${formatDate(trip.depart, cal)}`} · arrives {formatClock(trip.arrive, cal)} · {formatDuration(trip.ride)}
                </span>
              </span>
              <Button size="sm" disabled={!!stop || (!paid && trip.fare > s.player.currency)} onClick={() => onRide(id)} aria-label={`Ride the ${line.name} to ${place.name}`}>
                {paid ? 'Use ticket' : trip.fare ? formatMoney(s, trip.fare) : 'Ride'}
              </Button>
            </li>
          );
        })}
      </ul>
      {!only && ticketPrice(line) > 0 ? (
        <Button size="sm" variant="quiet" className="mt-1" disabled={ticketPrice(line) > s.player.currency} onClick={onTicket}>
          Buy a ticket · {formatMoney(s, ticketPrice(line))}
        </Button>
      ) : null}
    </li>
  );
}

/** Where you've been and how you can get around from here. */
export function JourneySheet({ open, onOpenChange, onShow }: { open: boolean; onOpenChange: (o: boolean) => void; onShow: (loc: Location) => void }) {
  const { state: s } = useGame();
  if (!s) return null;
  const arrival = s.arrival && s.arrival.locationId === s.currentLocationId ? s.arrival : null;
  const recent = recentPlaces(s, 6);
  const log = s.travelLog.slice(-20).reverse();
  const cal = s.meta.calendar;
  const name = (id: string) => s.locations[id]?.name ?? 'Somewhere';
  const hasLines = linesAt(s, s.currentLocationId).length > 0;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Journeys" description={s.currentLocationId ? `From ${name(s.currentLocationId)}` : undefined} size="md">
      <div className="flex flex-col gap-5">
        {arrival?.notes.length ? (
          <section aria-label="On arrival">
            <H>On arrival</H>
            <ul className="flex flex-col gap-1 rounded-md bg-surface-2 p-3 text-sm">
              {arrival.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <section aria-label="Transit from here">
          <H>Transit from here</H>
          {hasLines ? <RideList s={s} /> : <p className="text-sm text-fg-2">No scheduled lines stop here. Stations, docks and ports appear as the story finds them.</p>}
        </section>
        {recent.length ? (
          <section aria-label="Recent places">
            <H>Recent places</H>
            <div className="flex flex-wrap gap-1.5">
              {recent.map((l) => (
                <Button key={l.id} size="sm" variant="secondary" icon={MapPin} onClick={() => onShow(l)}>
                  {l.name}
                </Button>
              ))}
            </div>
          </section>
        ) : null}
        <section aria-label="Travel history">
          <H>History</H>
          {log.length ? (
            <ul className="flex flex-col divide-y divide-line">
              {log.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-16 flex-none text-xs tabular-nums text-fg-3">{formatDate(t.at, cal, '{month} {day}')}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {name(t.from)} → {name(t.to)}
                  </span>
                  <span className="flex-none text-xs text-fg-2">
                    {t.mode} · {formatDuration(t.minutes)}
                    {t.cost ? ` · ${formatMoney(s, t.cost)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={History} title="No journeys yet" />
          )}
        </section>
      </div>
    </Sheet>
  );
}
