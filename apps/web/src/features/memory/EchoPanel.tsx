/**
 * ECHO inspector (phone-first): the profile switch for this chat, each character's knowledge
 * (memories, beliefs with their sources, suspicions with how sure they are, what they know they
 * don't know), the knowledge at an earlier moment, undecided story details with "decide a twist",
 * and the leakage debugger (what each reply was given and why). Omniscient views and twists sit
 * behind the spoiler guard so the owner doesn't spoil their own story.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Brain, Eye, EyeOff, HelpCircle, Shield, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { get, patch, post } from '@/lib/api';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, EmptyState, Field, Input, Segmented, Select, Spinner, ToggleRow } from '@/ui';

type Profile = 'off' | 'light' | 'fast' | 'balanced' | 'strict';
interface EchoState {
  settings: { profile: Profile; narration: 'character' | 'persona' | 'omniscient'; tunneling: boolean; drift: boolean; semantic: boolean };
  on: boolean;
  counts?: { events: number; units: number; beliefs: number; hypotheses: number; undetermined: number };
  actors?: Array<{ id: string; name: string }>;
  issues?: Array<{ kind: string; detail: string; fix: string; messageId: string }>;
}
interface Knowledge {
  name: string;
  memories: Array<{ id: string; l1: string; level: string; status: string; seq: number; drift?: string }>;
  beliefs: Array<{ id: string; line: string; status: string; contested: boolean; truth?: string }>;
  hypotheses: Array<{ id: string; question: string; status: string; options: Array<{ label: string; amplitude: number }> }>;
  higher: Array<{ id: string; text: string }>;
  unknowns: string[];
  commitments: Array<{ id: string; what: string; status: string }>;
}
interface Undecided {
  key: string;
  label: string;
  status: string;
  constraints: Array<{ kind: string; values: string[]; why?: string }>;
  possible?: string[];
  value?: string;
}
interface Packet {
  messageId: string;
  swipeId: number;
  actor: string;
  scope: string;
  tokens: number;
  lines: Array<{ section: string; text: string; reason: string }>;
  recall: Array<{ unit: string; why: string[]; involuntary: boolean }>;
}

const PROFILES: Array<{ value: Profile; label: string; hint: string }> = [
  { value: 'off', label: 'Off', hint: 'Today’s memory only.' },
  { value: 'fast', label: 'Fast', hint: 'Who saw what, beliefs with sources; one reply call.' },
  { value: 'balanced', label: 'Balanced', hint: 'Plus suspicions, undecided details, checks.' },
  { value: 'strict', label: 'Strict', hint: 'Plus each character decides alone. For mysteries.' },
];
const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const STATUS: Record<string, string> = { open: 'open', predecided: 'decided by you', collapsed: 'settled by the story' };

export function EchoPanel({ chatId }: { chatId: string }) {
  const qc = useQueryClient();
  const [view, setView] = useState<'knows' | 'undecided' | 'debug'>('knows');
  const [actor, setActor] = useState('player');
  const [at, setAt] = useState('');
  const [spoilers, setSpoilers] = useState(false);
  const st = useQuery({ queryKey: ['echo', chatId], queryFn: () => get<EchoState>(`/api/chats/${chatId}/echo`) });
  const on = !!st.data?.on;
  const k = useQuery({
    queryKey: ['echo', chatId, 'knows', actor, at, spoilers],
    queryFn: () => get<Knowledge>(`/api/chats/${chatId}/echo/knowledge/${encodeURIComponent(actor)}`, { at: at || undefined, spoilers: spoilers ? '1' : undefined }),
    enabled: on && view === 'knows' && (actor !== 'all' || spoilers),
  });
  const und = useQuery({ queryKey: ['echo', chatId, 'undecided', spoilers], queryFn: () => get<Undecided[]>(`/api/chats/${chatId}/echo/undetermined`, { spoilers: spoilers ? '1' : undefined }), enabled: on && view === 'undecided' });
  const pk = useQuery({ queryKey: ['echo', chatId, 'packets'], queryFn: () => get<Packet[]>(`/api/chats/${chatId}/echo/packets`), enabled: on && view === 'debug' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['echo', chatId] });
  const setProfile = async (profile: Profile) => {
    try {
      await patch(`/api/chats/${chatId}/echo`, { profile });
      await refresh();
    } catch (e) {
      toastError(e);
    }
  };
  if (!st.data) return <Center />;
  const s = st.data.settings;
  return (
    <div className="flex flex-col gap-4 pt-3">
      <Field label="ECHO for this chat" hint={PROFILES.find((p) => p.value === s.profile)?.hint ?? 'Today’s memory only.'}>
        <Segmented label="ECHO profile" size="sm" value={s.profile === 'light' ? 'off' : s.profile} onChange={(v) => void setProfile(v)} options={PROFILES.map((p) => ({ value: p.value, label: p.label }))} />
      </Field>
      {!on ? (
        <EmptyState icon={Brain} title="ECHO is off" body="Turn it on to give every character their own memories and beliefs. Existing memory keeps working either way." />
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-xs text-fg-2">
            <Badge>{plural(st.data.counts?.events ?? 0, 'event', 'events')}</Badge>
            <Badge>{plural(st.data.counts?.beliefs ?? 0, 'belief', 'beliefs')}</Badge>
            <Badge>{plural(st.data.counts?.hypotheses ?? 0, 'suspicion', 'suspicions')}</Badge>
            {st.data.issues?.length ? <Badge tone="warning">{st.data.issues.length} to check</Badge> : null}
          </div>
          <ToggleRow label="Show spoilers" description="Everyone’s knowledge, what’s true, and decided twists." checked={spoilers} onChange={setSpoilers} />
          <Segmented label="ECHO view" size="sm" value={view} onChange={setView} options={[{ value: 'knows', label: 'Who knows' }, { value: 'undecided', label: 'Undecided' }, { value: 'debug', label: 'What the AI saw' }]} />
          {view === 'knows' && (
            <>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Select aria-label="Character" value={actor} onChange={(e) => setActor(e.target.value)}>
                  {(st.data.actors ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                  {!st.data.actors?.some((a) => a.id === 'player') && <option value="player">You</option>}
                  {spoilers && <option value="all">Everyone (spoilers)</option>}
                </Select>
                <Input aria-label="At story moment" inputMode="numeric" placeholder="Now" value={at} onChange={(e) => setAt(e.target.value.replace(/[^\d.]/g, ''))} className="w-24" />
              </div>
              {k.data ? <KnowledgeView k={k.data} /> : <Center />}
            </>
          )}
          {view === 'undecided' && (und.data ? <UndecidedView chatId={chatId} list={und.data} spoilers={spoilers} onDone={refresh} /> : <Center />)}
          {view === 'debug' && (pk.data ? <DebugView packets={pk.data} /> : <Center />)}
          {st.data.issues?.length ? (
            <section aria-label="Checks" className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Checks</h3>
              {st.data.issues.slice(0, 6).map((i, n) => (
                <p key={n} className="rounded-md bg-surface-2 p-2 text-sm">
                  <Badge tone="warning">{i.kind}</Badge> {i.detail}
                  {i.fix === 'regenerate-passage' ? <span className="block text-xs text-fg-2">Fix: swipe or regenerate that reply.</span> : null}
                </p>
              ))}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function Center() {
  return (
    <div className="flex justify-center py-8">
      <Spinner />
    </div>
  );
}

function Section({ title, icon, children, empty }: { title: string; icon?: typeof Brain; children: React.ReactNode; empty?: boolean }) {
  const I = icon;
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        {I ? <I size={16} aria-hidden /> : null}
        {title}
      </h3>
      {empty ? <p className="text-sm text-fg-3">Nothing yet.</p> : children}
    </section>
  );
}

function KnowledgeView({ k }: { k: Knowledge }) {
  return (
    <div className="flex flex-col gap-4">
      <Section title="Believes" icon={Eye} empty={!k.beliefs.length}>
        <ul className="flex flex-col gap-1 text-sm">
          {k.beliefs.map((b) => (
            <li key={b.id} className="rounded-md bg-surface-2 px-2 py-1.5">
              {b.line}
              {b.truth === 'false' ? <Badge tone="danger" className="ml-1">false</Badge> : null}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Suspects" icon={HelpCircle} empty={!k.hypotheses.length}>
        {k.hypotheses.map((h) => (
          <div key={h.id} className="rounded-md bg-surface-2 p-2 text-sm">
            <p className="font-medium">{h.question}{h.status === 'resolved' ? ' (settled)' : ''}</p>
            <ul className="mt-1 flex flex-col gap-1">
              {h.options.map((o) => (
                <li key={o.label} className="flex items-center gap-2">
                  <span className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.max(4, o.amplitude * 100)}px` }} aria-hidden />
                  <span className="min-w-0 flex-1">{o.label}</span>
                  <span className="text-xs text-fg-2">{pct(o.amplitude)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>
      <Section title="Knows they don’t know" icon={EyeOff} empty={!k.unknowns.length}>
        <ul className="list-disc pl-5 text-sm">{k.unknowns.map((u, i) => <li key={i}>{u}</li>)}</ul>
      </Section>
      <Section title="Thinks others know" empty={!k.higher.length}>
        <ul className="list-disc pl-5 text-sm">{k.higher.map((h) => <li key={h.id}>{h.text}</li>)}</ul>
      </Section>
      <Section title="Remembers" icon={Brain} empty={!k.memories.length}>
        <ul className="flex flex-col divide-y divide-line text-sm">
          {k.memories.slice(-40).reverse().map((m) => (
            <li key={m.id} className="py-1.5">
              {m.l1}
              {m.level !== 'content' ? <Badge className="ml-1">partly seen</Badge> : null}
              {m.drift ? <span className="block text-xs italic text-fg-2">As recalled now: {m.drift}</span> : null}
              <span className="block text-xs text-fg-3">moment {m.seq}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function UndecidedView({ chatId, list, spoilers, onDone }: { chatId: string; list: Undecided[]; spoilers: boolean; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  if (!list.length) return <EmptyState icon={Sparkles} title="Nothing undecided" body="Details the story hasn’t settled yet (what’s in the box, who the thief is) appear here." />;
  const decide = async (u: Undecided) => {
    const [s, p] = u.key.split('|');
    try {
      await post(`/api/chats/${chatId}/echo/ops`, { kind: 'predecide', s, p, value: values[u.key] });
      toast({ title: 'Twist decided', tone: 'success' });
      onDone();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <ul className="flex flex-col gap-3">
      {list.map((u) => (
        <li key={u.key} className="rounded-md bg-surface-2 p-2 text-sm">
          <p className="font-medium">
            {u.label} <Badge>{STATUS[u.status] ?? u.status}</Badge>
          </p>
          {u.constraints.map((c, i) => (
            <p key={i} className="text-xs text-fg-2">
              Clue: {c.kind === 'not' ? 'not' : c.kind === 'oneOf' ? 'one of' : 'fits'} {c.values.join(' / ')}
              {c.why ? ` (${c.why})` : ''}
            </p>
          ))}
          {u.value && (spoilers || u.status === 'collapsed') ? <p className="mt-1">Decided: {u.value}</p> : null}
          {spoilers && u.status !== 'collapsed' ? (
            <div className="mt-2 flex gap-2">
              <Select aria-label={`Decide ${u.label}`} value={values[u.key] ?? ''} onChange={(e) => setValues({ ...values, [u.key]: e.target.value })}>
                <option value="">Choose…</option>
                {(u.possible ?? []).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </Select>
              <Button size="sm" disabled={!values[u.key]} onClick={() => void decide(u)}>
                Decide
              </Button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function DebugView({ packets }: { packets: Packet[] }) {
  if (!packets.length) return <EmptyState icon={Shield} title="No replies yet" body="After the next reply you’ll see exactly what memory gave the AI, and why each line was allowed." />;
  return (
    <ul className="flex flex-col gap-3">
      {packets.map((p) => (
        <li key={`${p.messageId}:${p.swipeId}`} className="rounded-md bg-surface-2 p-2 text-sm">
          <p className="text-xs text-fg-2">
            Seen as {p.actor} · {p.scope} · {p.tokens} tokens · swipe {p.swipeId + 1}
          </p>
          {p.lines.length ? (
            <ul className="mt-1 flex flex-col gap-1">
              {p.lines.map((l, i) => (
                <li key={i}>
                  {l.text}
                  <span className="block text-xs text-fg-3">
                    {l.section} — {l.reason}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-fg-3">Nothing was relevant, so nothing was added.</p>
          )}
          {p.recall.some((r) => r.involuntary) ? <Badge tone="accent">involuntary recall</Badge> : null}
        </li>
      ))}
    </ul>
  );
}
