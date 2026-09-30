/**
 * Letters, email and the social feed. Delivery times come from distance and the courier, replies
 * are scheduled by code, and the words of an incoming letter are written when it is first opened.
 */
import { createRng, seedFrom } from '../util/rng.js';
import { MIN_PER_DAY } from './calendar.js';
import { nextCounter } from './resolve.js';
import { distanceKm } from './travel.js';
import type { CampaignState, Mail, Style } from './state.js';

export type Courier = NonNullable<Mail['courier']>;
export interface CourierSpec {
  id: Courier;
  label: string;
  /** Fixed handling time, minutes. */
  base: number;
  kmPerDay: number;
  cost: number;
}

export const COURIERS: Record<Style, CourierSpec[]> = {
  fantasy: [
    { id: 'post', label: 'Post rider', base: 12 * 60, kmPerDay: 60, cost: 0.2 },
    { id: 'courier', label: 'Hired courier', base: 2 * 60, kmPerDay: 150, cost: 2 },
    { id: 'bird', label: 'Messenger bird', base: 60, kmPerDay: 400, cost: 0.8 },
  ],
  modern: [
    { id: 'post', label: 'Mail', base: MIN_PER_DAY, kmPerDay: 600, cost: 1.5 },
    { id: 'express', label: 'Express', base: 4 * 60, kmPerDay: 3000, cost: 25 },
  ],
  scifi: [
    { id: 'post', label: 'Standard relay', base: 6 * 60, kmPerDay: 50_000, cost: 2 },
    { id: 'express', label: 'Priority relay', base: 30, kmPerDay: 1_000_000, cost: 20 },
  ],
};

/** Email exists where the setting has it; fantasy uses letters only. */
export const hasEmail = (s: Pick<CampaignState, 'meta'>) => s.meta.style !== 'fantasy';

export function courierFor(s: CampaignState, id?: Courier | null): CourierSpec {
  const list = COURIERS[s.meta.style] ?? COURIERS.fantasy;
  return list.find((c) => c.id === id) ?? list[0]!;
}

/** How far the letter goes: player's place to the NPC's (or a nominal 5 km when unknown). */
export function mailKm(s: CampaignState, npcId: string | null): number {
  const npc = npcId ? s.npcs[npcId] : null;
  if (!npc?.locationId || !s.currentLocationId) return 5;
  return distanceKm(s, s.currentLocationId, npc.locationId);
}

export function deliveryMinutes(s: CampaignState, kind: Mail['kind'], courier: Courier | null, km: number): number {
  if (kind === 'email') return 1;
  const c = courierFor(s, courier);
  return Math.round(c.base + (km / c.kmPerDay) * MIN_PER_DAY);
}

/** When the reply to an outgoing letter or email arrives (seeded, so replays agree). */
export function replyDelay(s: CampaignState, m: Pick<Mail, 'id' | 'kind' | 'deliverAt' | 'sentAt'>): number {
  const rng = createRng(seedFrom(s.meta.seed, 'reply', m.id));
  if (m.kind === 'email') return rng.int(20, 240);
  // A letter: a few hours to write, then the trip back.
  return rng.int(3 * 60, 18 * 60) + (m.deliverAt - m.sentAt);
}

export function newMailId(s: CampaignState): string {
  return `mail_${nextCounter(s.counters, 'mail')}`;
}

/**
 * Advance mail from `from` to `to`: queue replies whose time has come (their words are written
 * when opened) and announce arrivals.
 */
export function processMail(s: CampaignState, from: number, to: number, notify: (t: string) => void) {
  if (!s.mail) return;
  for (const m of Object.values(s.mail)) {
    if (m.direction !== 'out' || m.replied || m.replyDue === null || m.replyDue > to) continue;
    m.replied = true;
    const npc = m.npcId ? s.npcs[m.npcId] : null;
    if (!npc || npc.status !== 'alive') continue;
    const id = newMailId(s);
    s.mail[id] = {
      id,
      kind: m.kind,
      direction: 'in',
      npcId: npc.id,
      from: npc.name,
      to: s.player.name,
      subject: m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`,
      body: '',
      sentAt: m.replyDue - (m.kind === 'email' ? 0 : m.deliverAt - m.sentAt),
      deliverAt: m.replyDue,
      courier: m.courier,
      read: false,
      replyDue: null,
      pending: true,
    };
  }
  for (const m of Object.values(s.mail)) {
    if (m.direction === 'in' && m.deliverAt > from && m.deliverAt <= to) notify(`${m.kind === 'email' ? 'An email' : 'A letter'} from ${m.from} arrived: ${m.subject}`);
  }
}

export const delivered = (s: CampaignState, m: Mail) => m.deliverAt <= s.time.minutes;

export function inbox(s: CampaignState): Mail[] {
  return Object.values(s.mail ?? {})
    .filter((m) => m.direction === 'in' && delivered(s, m))
    .sort((a, b) => b.deliverAt - a.deliverAt);
}
export function outbox(s: CampaignState): Mail[] {
  return Object.values(s.mail ?? {})
    .filter((m) => m.direction === 'out')
    .sort((a, b) => b.sentAt - a.sentAt);
}
export const unreadMail = (s: CampaignState) => inbox(s).filter((m) => !m.read).length;
