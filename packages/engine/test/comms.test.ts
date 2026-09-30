import { describe, expect, it } from 'vitest';
import { applyOp, applyOps, buildSceneBlock, createInitialState, deliveryMinutes, inbox, invertOps, OpSchemas, unreadMail, validateOps, type CampaignState, type Op, type OpType } from '../src/index.js';

const ALL = Object.keys(OpSchemas) as OpType[];
const v = (op: unknown): Op => {
  const r = validateOps([op], ALL);
  if (!r.ok.length) throw new Error(`invalid op: ${r.rejected[0]?.error}`);
  return r.ok[0]!;
};
const ok = (s: CampaignState, op: unknown) => {
  const r = applyOp(s, v(op), { source: 'user' });
  if (r.error) throw new Error(r.error);
  return r.state;
};
const err = (s: CampaignState, op: unknown) => applyOp(s, v(op), { source: 'user' }).error;

function world(style: 'fantasy' | 'modern' = 'fantasy'): CampaignState {
  let s = createInitialState({ style, seed: 3 });
  s.player.name = 'Anala';
  s.player.currency = 50;
  const r = applyOps(
    s,
    ([
      { type: 'location.upsert', name: 'Realm', level: 'world', kind: 'realm' },
      { type: 'location.upsert', name: 'Ashford', level: 'region', kind: 'town', parent: 'Realm', x: 100, y: 100 },
      { type: 'location.upsert', name: 'Farhold', level: 'region', kind: 'city', parent: 'Realm', x: 900, y: 900 },
      { type: 'location.upsert', name: 'Nextdoor', level: 'region', kind: 'village', parent: 'Realm', x: 105, y: 100 },
      { type: 'location.move', to: 'Ashford' },
      { type: 'npc.upsert', name: 'Mara Quill', location: 'Farhold' },
      { type: 'npc.upsert', name: 'Tobias', location: 'Nextdoor' },
    ] as unknown[]).map(v),
    { source: 'user' },
  );
  expect(r.errors).toEqual([]);
  s = r.state;
  return s;
}

describe('letters', () => {
  it('delivery takes longer the farther it goes, and faster couriers cost more', () => {
    const s = world();
    const near = deliveryMinutes(s, 'letter', 'post', 1);
    const far = deliveryMinutes(s, 'letter', 'post', 400);
    expect(far).toBeGreaterThan(near);
    expect(deliveryMinutes(s, 'letter', 'bird', 400)).toBeLessThan(far);
    let a = ok(s, { type: 'mail.send', to: 'Mara Quill', subject: 'Hello', body: 'Are you well?', courier: 'post' });
    let b = ok(s, { type: 'mail.send', to: 'Tobias', subject: 'Hello', body: 'Are you well?', courier: 'post' });
    const ma = Object.values(a.mail)[0]!;
    const mb = Object.values(b.mail)[0]!;
    expect(ma.deliverAt - ma.sentAt).toBeGreaterThan(mb.deliverAt - mb.sentAt);
    expect(a.player.currency).toBe(49.8);
    b = ok(s, { type: 'mail.send', to: 'Mara Quill', body: 'Quick!', courier: 'courier' });
    expect(b.player.currency).toBe(48);
    void a;
  });

  it('a reply arrives after the round trip, written when opened', () => {
    let s = world();
    s = ok(s, { type: 'mail.send', to: 'Mara Quill', subject: 'The mill', body: 'Can you help?' });
    const out = Object.values(s.mail)[0]!;
    expect(out.replyDue).toBeGreaterThan(out.deliverAt);
    s = ok(s, { type: 'time.advance', minutes: out.replyDue! - s.time.minutes - 1 });
    expect(inbox(s)).toHaveLength(0);
    s = ok(s, { type: 'time.advance', minutes: 2 });
    const reply = inbox(s)[0]!;
    expect(reply).toMatchObject({ from: 'Mara Quill', subject: 'Re: The mill', pending: true, read: false });
    expect(unreadMail(s)).toBe(1);
    expect(s.worldLog.at(-1)?.text).toMatch(/A letter from Mara Quill arrived/);
    expect(buildSceneBlock(s).text).toContain('MAIL: unread letter from Mara Quill');
    s = ok(s, { type: 'mail.write', id: reply.id, body: 'Of course.' });
    s = ok(s, { type: 'mail.read', id: reply.id });
    expect(s.mail[reply.id]).toMatchObject({ body: 'Of course.', pending: false, read: true });
  });

  it('email is near-instant where it exists; fantasy has only letters', () => {
    expect(err(world('fantasy'), { type: 'mail.send', kind: 'email', to: 'Tobias', body: 'hi' })).toMatch(/no email/);
    const s = ok(world('modern'), { type: 'mail.send', kind: 'email', to: 'Mara Quill', body: 'hi' });
    const m = Object.values(s.mail)[0]!;
    expect(m.deliverAt - m.sentAt).toBe(1);
    expect(m.replyDue! - m.deliverAt).toBeLessThanOrEqual(240);
  });

  it('a letter the story sends arrives after its delivery time', () => {
    let s = world();
    s = ok(s, { type: 'mail.receive', from: 'Mara Quill', subject: 'News', body: 'The bridge is out.' });
    expect(inbox(s)).toHaveLength(0);
    const due = Object.values(s.mail)[0]!.deliverAt;
    expect(due - s.time.minutes).toBeGreaterThan(1440); // days by post rider
    s = ok(s, { type: 'time.advance', minutes: due - s.time.minutes });
    expect(inbox(s)[0]).toMatchObject({ subject: 'News', body: 'The bridge is out.', pending: false });
    expect(err(s, { type: 'mail.read', id: 'nope' })).toBeTruthy();
  });
});

describe('feed, groups and apps', () => {
  it('posts, likes and comments', () => {
    let s = world();
    s = ok(s, { type: 'feed.post', author: 'Tobias', text: 'Gig tonight!' });
    s = ok(s, { type: 'feed.post', text: 'Heading to Farhold.' });
    expect(s.feed.map((p) => p.author)).toEqual(['Tobias', 'Anala']);
    s = ok(s, { type: 'feed.like', id: s.feed[0]!.id });
    s = ok(s, { type: 'feed.comment', id: s.feed[0]!.id, text: 'See you there' });
    expect(s.feed[0]).toMatchObject({ likes: 1, liked: true, comments: [{ author: 'Anala', text: 'See you there' }] });
    s = ok(s, { type: 'feed.like', id: s.feed[0]!.id });
    expect(s.feed[0]!.likes).toBe(0);
  });

  it('group chats need two people; custom apps need a prompt', () => {
    let s = world();
    expect(err(s, { type: 'phone.group', name: 'Band', members: ['Tobias'] })).toMatch(/at least two/);
    s = ok(s, { type: 'phone.group', name: 'Band', members: ['Tobias', 'Mara Quill'] });
    expect(Object.values(s.phone.groups!)[0]!.members).toHaveLength(2);
    expect(err(s, { type: 'phone.app', name: 'Weather' })).toMatch(/Describe/);
    s = ok(s, { type: 'phone.app', name: 'Weather', icon: 'cloud', prompt: 'A forecast for the next three days.' });
    s = ok(s, { type: 'phone.app', name: 'Weather', remove: true });
    expect(Object.values(s.phone.apps!)).toHaveLength(0);
  });
});

describe('rollback', () => {
  it('every communication op is undone exactly by its inverse', () => {
    const s0 = world('modern');
    const ops: unknown[] = [
      { type: 'mail.send', to: 'Mara Quill', subject: 'Hi', body: 'Hello there' },
      { type: 'mail.send', kind: 'email', to: 'Tobias', body: 'Ping' },
      { type: 'mail.receive', from: 'Tobias', subject: 'Yo' },
      { type: 'time.advance', minutes: 3 * 1440 },
      { type: 'feed.post', author: 'Tobias', text: 'Hey' },
      { type: 'feed.like', id: 'post_1' },
      { type: 'feed.comment', id: 'post_1', text: 'Hi' },
      { type: 'phone.group', name: 'Crew', members: ['Tobias', 'Mara Quill'] },
      { type: 'phone.app', name: 'Tarot', prompt: 'Draw a card.' },
    ];
    const r = applyOps(s0, ops.map(v), { source: 'user' });
    expect(r.errors).toEqual([]);
    expect(invertOps(r.state, r.inverses)).toEqual(s0);
  });
});
