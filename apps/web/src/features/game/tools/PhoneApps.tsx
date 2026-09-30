import { COURIERS, courierFor, deliveryMinutes, formatDate, formatDuration, formatMoney, hasEmail, inbox, mailKm, outbox, type CampaignState, type Courier, type Mail, type Op } from '@everloom/engine';
import {
  ArrowLeft,
  Bike,
  BookOpen,
  Cloud,
  Compass,
  Dice5,
  Heart,
  Mail as MailIcon,
  MessageCircle,
  Music,
  Phone as PhoneIcon,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Star,
  Trash2,
  Utensils,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { post } from '@/lib/api';
import { cx } from '@/lib/format';
import { setCampaignState } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Avatar, Button, EmptyState, Field, Icon, IconButton, Input, Select, Sheet, Spinner, TabPanel, Tabs, Textarea, ToggleRow } from '@/ui';
import { useGame } from '../context';
import type { Screen } from './Phone';
import { ToolSheet } from './ToolSheet';

export const APP_ICONS: Record<string, LucideIcon> = { sparkles: Sparkles, cloud: Cloud, dice: Dice5, music: Music, star: Star, compass: Compass, book: BookOpen, food: Utensils, bike: Bike, heart: Heart };

const back = (onBack: () => void) => <IconButton icon={ArrowLeft} label="Back to home" onClick={onBack} />;

// ------------------------------------------------------------------ mail

export function MailView({ state: s, compose, onBack }: { state: CampaignState; compose?: string; onBack: () => void }) {
  const { chat } = useGame();
  const [tab, setTab] = useState('inbox');
  const [writing, setWriting] = useState<string | null>(compose ?? null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const codex = !hasEmail(s);
  const ins = inbox(s);
  const outs = outbox(s);
  const open = async (m: Mail) => {
    setOpenId(m.id);
    if (m.direction === 'in' && (m.pending || !m.read)) {
      setOpening(true);
      try {
        const r = await post<{ state: CampaignState; error: string | null }>(`/api/campaigns/${chat.campaignId}/mail/${m.id}/open`, { chatId: chat.id });
        setCampaignState(chat.campaignId!, r.state);
        if (r.error) toast({ title: 'Could not read it yet', lines: [r.error], tone: 'danger' });
      } catch (e) {
        toastError(e);
      } finally {
        setOpening(false);
      }
    }
  };
  const cur = openId ? s.mail[openId] : null;
  const row = (m: Mail) => {
    const arrived = m.deliverAt <= s.time.minutes;
    return (
      <li key={m.id}>
        <button onClick={() => open(m)} className="pressable -mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-md px-2 py-2.5 text-left hover:bg-surface-2">
          <Icon icon={MailIcon} size={16} className={cx('mt-0.5', m.direction === 'in' && !m.read ? 'text-accent' : 'text-fg-3')} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className={cx('truncate text-sm', m.direction === 'in' && !m.read ? 'font-semibold' : 'font-medium')}>{m.direction === 'in' ? m.from : `To ${m.to}`}</span>
              <span className="flex-1" />
              <span className="flex-none text-xs text-fg-3">{formatDate(m.direction === 'in' ? m.deliverAt : m.sentAt, s.meta.calendar, '{mon} {day}')}</span>
            </span>
            <span className="block truncate text-sm text-fg-2">{m.subject}</span>
            {m.direction === 'out' ? (
              <span className="block text-xs text-fg-3">
                {arrived ? 'Delivered' : `Arrives in ${formatDuration(m.deliverAt - s.time.minutes)}`}
                {m.replied ? ' · answered' : m.replyDue ? ' · awaiting a reply' : ''}
              </span>
            ) : null}
          </span>
        </button>
      </li>
    );
  };
  return (
    <ToolSheet
      title={codex ? 'Letters' : 'Mail'}
      headerActions={back(onBack)}
      footer={
        <Button variant="primary" icon={Send} block onClick={() => setWriting('')}>
          {codex ? 'Write a letter' : 'Compose'}
        </Button>
      }
    >
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'inbox', label: `Received${ins.filter((m) => !m.read).length ? ` (${ins.filter((m) => !m.read).length})` : ''}` },
          { value: 'sent', label: 'Sent' },
        ]}
      >
        <TabPanel value="inbox" className="pt-2">
          {ins.length ? <ul className="flex flex-col">{ins.map(row)}</ul> : <EmptyState icon={MailIcon} title={codex ? 'No letters yet' : 'Inbox empty'} body="Replies and letters from people you know arrive as time passes." />}
        </TabPanel>
        <TabPanel value="sent" className="pt-2">
          {outs.length ? <ul className="flex flex-col">{outs.map(row)}</ul> : <EmptyState icon={Send} title="Nothing sent yet" />}
        </TabPanel>
      </Tabs>
      <Sheet open={!!cur} onOpenChange={(o) => !o && setOpenId(null)} title={cur?.subject ?? ''} description={cur ? (cur.direction === 'in' ? `From ${cur.from}` : `To ${cur.to}`) : undefined} size="md">
        {cur ? (
          <div className="flex flex-col gap-3">
            {opening && cur.pending ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{cur.body || '…'}</p>
            )}
            <div className="flex gap-2">
              {cur.direction === 'in' && cur.npcId ? (
                <Button
                  variant="secondary"
                  icon={Send}
                  onClick={() => {
                    setOpenId(null);
                    setWriting(cur.npcId!);
                  }}
                >
                  Reply
                </Button>
              ) : null}
              <DeleteMail id={cur.id} onDone={() => setOpenId(null)} />
            </div>
          </div>
        ) : null}
      </Sheet>
      <ComposeSheet s={s} to={writing} onClose={() => setWriting(null)} />
    </ToolSheet>
  );
}

function DeleteMail({ id, onDone }: { id: string; onDone: () => void }) {
  const { apply } = useGame();
  return <IconButton icon={Trash2} label="Delete" onClick={async () => (await apply({ type: 'mail.delete', id } as Op, { quiet: true })) && onDone()} />;
}

function ComposeSheet({ s, to, onClose }: { s: CampaignState; to: string | null; onClose: () => void }) {
  const { apply } = useGame();
  const [kind, setKind] = useState<'letter' | 'email'>(hasEmail(s) ? 'email' : 'letter');
  const [npc, setNpc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [courier, setCourier] = useState<Courier>(courierFor(s).id);
  const [expect, setExpect] = useState(true);
  const people = Object.values(s.npcs).filter((n) => n.status === 'alive');
  const target = npc || to || '';
  const eta = target ? deliveryMinutes(s, kind, kind === 'letter' ? courier : null, mailKm(s, target)) : null;
  const cost = kind === 'letter' ? courierFor(s, courier).cost : 0;
  const reset = () => (setNpc(''), setSubject(''), setBody(''), onClose());
  return (
    <Sheet
      open={to !== null}
      onOpenChange={(o) => !o && reset()}
      title={kind === 'letter' ? 'Write a letter' : 'New email'}
      size="md"
      footer={
        <Button
          variant="primary"
          icon={Send}
          block
          disabled={!target || !body.trim() || cost > s.player.currency}
          onClick={async () => {
            if (await apply({ type: 'mail.send', kind, to: target, subject: subject.trim(), body: body.trim(), courier: kind === 'letter' ? courier : undefined, expectReply: expect } as Op, { quiet: true })) {
              toast({ title: kind === 'letter' ? 'Letter sent' : 'Email sent', lines: eta ? [`Arrives in ${formatDuration(eta)}`] : [] });
              reset();
            }
          }}
        >
          Send{cost ? ` · ${formatMoney(s, cost)}` : ''}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {hasEmail(s) ? (
          <Field label="Send as" htmlFor="mail-kind">
            <Select id="mail-kind" value={kind} onChange={(e) => setKind(e.target.value as 'letter' | 'email')}>
              <option value="email">Email</option>
              <option value="letter">Letter</option>
            </Select>
          </Field>
        ) : null}
        <Field label="To" htmlFor="mail-to">
          <Select id="mail-to" value={target} onChange={(e) => setNpc(e.target.value)}>
            <option value="">Choose someone…</option>
            {people.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </Select>
        </Field>
        {kind === 'letter' ? (
          <Field label="Sent by" htmlFor="mail-courier" hint={eta ? `Arrives in about ${formatDuration(eta)}` : undefined}>
            <Select id="mail-courier" value={courier} onChange={(e) => setCourier(e.target.value as Courier)}>
              {(COURIERS[s.meta.style] ?? COURIERS.fantasy).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} · {formatMoney(s, c.cost)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Subject" htmlFor="mail-subject">
          <Input id="mail-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} />
        </Field>
        <Field label={kind === 'letter' ? 'Letter' : 'Message'} htmlFor="mail-body">
          <Textarea id="mail-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={8000} className="min-h-40" />
        </Field>
        <ToggleRow label="Expect a reply" description="They answer after reading it; a letter's reply makes the trip back." checked={expect} onChange={setExpect} />
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ feed

export function FeedView({ state: s, onBack }: { state: CampaignState; onBack: () => void }) {
  const { chat, apply } = useGame();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [commenting, setCommenting] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const codex = !hasEmail(s);
  const posts = [...s.feed].reverse();
  const refresh = async () => {
    setBusy(true);
    try {
      const r = await post<{ state: CampaignState; added: number }>(`/api/campaigns/${chat.campaignId}/feed/refresh`, { chatId: chat.id });
      setCampaignState(chat.campaignId!, r.state);
      if (!r.added) toast({ title: 'Nothing new' });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ToolSheet
      title={codex ? 'Notice board' : 'Social'}
      headerActions={
        <>
          <IconButton icon={RefreshCw} label="Check for new posts" disabled={busy} onClick={refresh} />
          {back(onBack)}
        </>
      }
      footer={
        <div className="flex w-full items-end gap-2">
          <Textarea aria-label={codex ? 'Pin a notice' : 'Write a post'} placeholder={codex ? 'Pin a notice…' : "What's happening?"} value={text} maxRows={4} onChange={(e) => setText(e.target.value)} className="min-h-11 flex-1" maxLength={1000} />
          <IconButton icon={Send} label="Post" tone="accent" disabled={!text.trim()} onClick={async () => (await apply({ type: 'feed.post', text: text.trim() } as Op, { quiet: true })) && setText('')} />
        </div>
      }
    >
      {busy ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : null}
      {posts.length ? (
        <ul className="flex flex-col divide-y divide-line" aria-label="Posts">
          {posts.map((p) => (
            <li key={p.id} className="flex flex-col gap-1.5 py-3">
              <span className="flex items-center gap-2">
                <Avatar name={p.author} size="sm" />
                <span className="text-sm font-medium">{p.author}</span>
                <span className="text-xs text-fg-3">{formatDate(p.at, s.meta.calendar, '{mon} {day}')}</span>
              </span>
              <p className="whitespace-pre-wrap text-[15px] leading-snug">{p.text}</p>
              <span className="flex items-center gap-1">
                <Button size="sm" variant="quiet" icon={Heart} aria-pressed={p.liked} className={cx(p.liked && '!text-accent')} onClick={() => apply({ type: 'feed.like', id: p.id } as Op, { quiet: true })}>
                  {p.likes || ''}
                </Button>
                <Button size="sm" variant="quiet" icon={MessageCircle} onClick={() => setCommenting(commenting === p.id ? null : p.id)}>
                  {p.comments.length || ''}
                </Button>
              </span>
              {p.comments.length ? (
                <ul className="ml-3 flex flex-col gap-1 border-l border-line pl-3 text-sm">
                  {p.comments.map((c) => (
                    <li key={c.id}>
                      <span className="font-medium">{c.author}</span> <span className="text-fg-2">{c.text}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {commenting === p.id ? (
                <span className="flex gap-2">
                  <Input aria-label="Comment" placeholder="Comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
                  <Button size="md" disabled={!comment.trim()} onClick={async () => (await apply({ type: 'feed.comment', id: p.id, text: comment.trim() } as Op, { quiet: true })) && (setComment(''), setCommenting(null))}>
                    Reply
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Sparkles} title={codex ? 'The board is bare' : 'Nothing here yet'} body="Check for new posts to hear what people are saying, or post something yourself." />
      )}
    </ToolSheet>
  );
}

// ------------------------------------------------------------------ browser / archive

interface Page {
  title: string;
  source: string;
  sections: Array<{ heading: string; text: string }>;
}

export function BrowserView({ state: s, onBack }: { state: CampaignState; onBack: () => void }) {
  const { chat } = useGame();
  const [q, setQ] = useState('');
  const [page, setPage] = useState<Page | null>(null);
  const [busy, setBusy] = useState(false);
  const codex = !hasEmail(s);
  const go = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      setPage(await post<Page>(`/api/campaigns/${chat.campaignId}/browser`, { chatId: chat.id, query: q.trim() }));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ToolSheet title={codex ? 'Archive' : 'Browser'} description={codex ? 'Look things up in the records of this world' : 'The web, inside this world'} headerActions={back(onBack)}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <Input aria-label={codex ? 'Look up' : 'Search'} placeholder={codex ? 'Look up a name, place or legend…' : 'Search…'} value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} />
        <Button type="submit" icon={Search} loading={busy} disabled={!q.trim()}>
          {codex ? 'Look up' : 'Go'}
        </Button>
      </form>
      {page ? (
        <article className="mt-4 flex flex-col gap-3">
          <header>
            <h3 className="text-lg font-semibold">{page.title}</h3>
            {page.source ? <p className="text-xs text-fg-3">{page.source}</p> : null}
          </header>
          {page.sections.map((x, i) => (
            <section key={i}>
              {x.heading ? <h4 className="mb-1 text-sm font-semibold">{x.heading}</h4> : null}
              <p className="text-[15px] leading-relaxed text-fg-2">{x.text}</p>
            </section>
          ))}
          <p className="text-xs text-fg-3">Written by the utility model from what the story has established. It doesn't change the game.</p>
        </article>
      ) : !busy ? (
        <EmptyState icon={codex ? BookOpen : Search} title={codex ? 'What do you want to know?' : 'Search this world'} className="!py-8" />
      ) : null}
    </ToolSheet>
  );
}

// ------------------------------------------------------------------ contacts

export function ContactsView({ state: s, avatar, go, onBack }: { state: CampaignState; avatar: (id: string) => string | undefined; go: (sc: Screen) => void; onBack: () => void }) {
  const [q, setQ] = useState('');
  const people = Object.values(s.npcs)
    .filter((n) => n.status !== 'dead' && (!q || n.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => Number(b.phone) - Number(a.phone) || a.name.localeCompare(b.name));
  const phone = hasEmail(s);
  return (
    <ToolSheet title={phone ? 'Contacts' : 'Acquaintances'} headerActions={back(onBack)}>
      <Input aria-label="Search people" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className="mb-2" />
      {people.length ? (
        <ul className="flex flex-col">
          {people.map((n) => (
            <li key={n.id} className="flex items-center gap-3 py-2">
              <Avatar src={avatar(n.id)} name={n.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{n.name}</span>
                <span className="block truncate text-xs text-fg-2">
                  {[n.role !== 'NPC' ? n.role : null, n.locationId ? s.locations[n.locationId]?.name : null, n.phone ? (phone ? 'has your number' : 'writes to you') : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              <IconButton size="sm" icon={MessageCircle} label={`Message ${n.name}`} onClick={() => go({ kind: 'thread', npcId: n.id })} />
              {phone ? <IconButton size="sm" icon={PhoneIcon} label={`Call ${n.name}`} disabled={n.status !== 'alive'} onClick={() => go({ kind: 'call', npcId: n.id })} /> : null}
              <IconButton size="sm" icon={MailIcon} label={`Write to ${n.name}`} onClick={() => go({ kind: 'mail', compose: n.id })} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={MessageCircle} title="Nobody yet" body="People you meet in the story show up here." />
      )}
    </ToolSheet>
  );
}

// ------------------------------------------------------------------ custom apps

export function AppView({ state: s, id, onBack }: { state: CampaignState; id: string; onBack: () => void }) {
  const { chat, apply } = useGame();
  const a = s.phone.apps?.[id];
  const [input, setInput] = useState('');
  const [out, setOut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!a) return null;
  const run = async () => {
    setBusy(true);
    try {
      setOut((await post<{ text: string }>(`/api/campaigns/${chat.campaignId}/apps/${id}/run`, { chatId: chat.id, input: input.trim() })).text);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ToolSheet
      title={a.name}
      description={a.prompt}
      headerActions={
        <>
          <IconButton icon={Trash2} label={`Remove ${a.name}`} onClick={async () => (await apply({ type: 'phone.app', name: a.name, remove: true } as Op, { quiet: true })) && onBack()} />
          {back(onBack)}
        </>
      }
      footer={
        <form
          className="flex w-full gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <Input aria-label="Ask the app" placeholder="Ask something (optional)" value={input} onChange={(e) => setInput(e.target.value)} maxLength={500} />
          <Button type="submit" variant="primary" loading={busy}>
            Open
          </Button>
        </form>
      }
    >
      {out ? <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{out}</p> : <EmptyState icon={APP_ICONS[a.icon] ?? Sparkles} title={a.name} body="Open it to see what it shows right now." className="!py-8" />}
    </ToolSheet>
  );
}

export function NewAppSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { apply } = useGame();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('sparkles');
  const [prompt, setPrompt] = useState('');
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add an app"
      description="The utility model runs it with the current game state. It shows information and never changes the story."
      size="md"
      footer={
        <Button
          variant="primary"
          block
          disabled={!name.trim() || !prompt.trim()}
          onClick={async () => {
            if (await apply({ type: 'phone.app', name: name.trim(), icon, prompt: prompt.trim() } as Op, { quiet: true })) {
              onOpenChange(false);
              setName('');
              setPrompt('');
            }
          }}
        >
          Add app
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" htmlFor="app-name">
          <Input id="app-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Weather, Horoscope, Train times…" />
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Icon</legend>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Icon">
            {Object.entries(APP_ICONS).map(([k, I]) => (
              <button key={k} role="radio" aria-checked={icon === k} aria-label={k} onClick={() => setIcon(k)} className={cx('pressable flex h-10 w-10 items-center justify-center rounded-md border', icon === k ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2')}>
                <Icon icon={I} size={18} />
              </button>
            ))}
          </div>
        </fieldset>
        <Field label="What it does" htmlFor="app-prompt">
          <Textarea id="app-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={1500} className="min-h-28" placeholder="Show a three-day forecast for where I am, in one line per day." />
        </Field>
      </div>
    </Sheet>
  );
}

