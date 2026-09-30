/**
 * Cast strip: who is here, under the latest reply. Tap someone for their dossier: how they feel,
 * what they wear and want, what's true about them, and what they know.
 */
import type { CampaignState, Npc, Op } from '@everloom/engine';
import { relationshipLabel } from '@everloom/engine';
import { useQuery } from '@tanstack/react-query';
import { Crown, Pencil } from 'lucide-react';
import { useMemo, useState } from 'react';
import { get } from '@/lib/api';
import { cx } from '@/lib/format';
import { useCharacters } from '@/lib/queries';
import { Avatar, Badge, Button, EmptyState, Icon, Sheet, Spinner, StatBar, ToggleRow } from '@/ui';
import { useGame } from './context';

export function presentPeople(s: CampaignState): Npc[] {
  const inParty = new Set(Object.values(s.party).map((m) => m.npcId));
  return Object.values(s.npcs)
    .filter((n) => n.status === 'alive' && ((n.locationId && n.locationId === s.currentLocationId) || inParty.has(n.id)))
    .sort((a, b) => Number(inParty.has(b.id)) - Number(inParty.has(a.id)) || b.lastSeenAt - a.lastSeenAt);
}

export function CastStrip() {
  const { state: s } = useGame();
  const chars = useCharacters();
  const [open, setOpen] = useState<string | null>(null);
  const people = useMemo(() => (s ? presentPeople(s) : []), [s]);
  if (!s || !people.length) return null;
  const avatar = (n: Npc) => (n.portrait ? `/media/${n.portrait}` : chars.data?.find((c) => c.id === n.characterId)?.avatar ?? undefined);
  const party = new Set(Object.values(s.party).map((m) => m.npcId));
  // First names unless two people share one.
  const firsts = people.map((n) => n.name.split(' ')[0]);
  const short = (n: Npc, i: number) => (firsts.filter((f) => f === firsts[i]).length > 1 ? n.name : firsts[i]);
  return (
    <>
      <div className="no-scrollbar -mx-1 mb-2 flex items-center gap-1.5 overflow-x-auto px-1" role="group" aria-label="Who is here">
        {people.map((n, i) => (
          <button
            key={n.id}
            type="button"
            onClick={() => setOpen(n.id)}
            className={cx('pressable flex h-8 flex-none items-center gap-1.5 rounded-full bg-surface-2 pl-1 pr-3 text-xs', n.unconscious && 'opacity-60')}
            aria-label={`${n.name}${n.unconscious ? ', unconscious' : ''}${party.has(n.id) ? ', in your party' : ''} — open dossier`}
          >
            <Avatar src={avatar(n)} name={n.name} size="xs" />
            <span className="max-w-[10rem] truncate font-medium text-fg">{short(n, i)}</span>
            {party.has(n.id) ? <span className="text-xs text-fg-3">party</span> : null}
          </button>
        ))}
      </div>
      <Dossier npcId={open} onClose={() => setOpen(null)} avatar={open && s.npcs[open] ? avatar(s.npcs[open]) : undefined} />
    </>
  );
}

interface MemoryDTO {
  items: Array<{ id: string; text: string; witnesses: Array<{ id: string }>; heardBy: Array<{ id: string; distortion: number }>; forgotten: boolean; when: string | null }>;
  facts: Array<{ id: string; entityId: string; text: string; status: string }>;
}

function Dossier({ npcId, onClose, avatar }: { npcId: string | null; onClose: () => void; avatar?: string }) {
  const { state: s, chat, apply, open } = useGame();
  const npc = npcId && s ? s.npcs[npcId] : null;
  const mem = useQuery({ queryKey: ['memory', chat.id, 'dossier', npcId], queryFn: () => get<MemoryDTO>(`/api/chats/${chat.id}/memory`, { viewer: npcId! }), enabled: !!npc });
  const allFacts = useQuery({ queryKey: ['memory', chat.id, '', ''], queryFn: () => get<MemoryDTO>(`/api/chats/${chat.id}/memory`), enabled: !!npc });
  if (!s) return null;
  const rel = npc ? Object.values(s.relationships).find((r) => r.npcId === npc.id) : undefined;
  const member = npc ? Object.values(s.party).find((m) => m.npcId === npc.id) : undefined;
  const where = npc?.locationId ? s.locations[npc.locationId]?.name : null;
  const goals = (npc?.goals ?? []).filter((g) => g.state === 'acting' || g.state === 'blocked' || g.state === 'dormant');
  const bonds = npc ? Object.values(s.bonds ?? {}).filter((b) => b.from === npc.id && s.npcs[b.to]) : [];
  const facts = (allFacts.data?.facts ?? []).filter((f) => f.entityId === npcId && f.status === 'active');
  const knows = (mem.data?.items ?? []).filter((m) => !m.forgotten).slice(0, 8);
  const outfitAge = npc?.outfit ? s.time.minutes - npc.outfit.at : 0;
  return (
    <Sheet
      open={!!npc}
      onOpenChange={(o) => !o && onClose()}
      title={npc?.name ?? ''}
      description={npc ? [npc.title || npc.role, where ? `at ${where}` : null].filter(Boolean).join(' · ') : undefined}
      size="md"
      footer={
        npc ? (
          <Button
            variant="secondary"
            icon={Pencil}
            block
            onClick={() => {
              onClose();
              open('npcs', npc.id);
            }}
          >
            Edit {npc.name.split(' ')[0]}
          </Button>
        ) : undefined
      }
    >
      {npc ? (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <Avatar src={avatar} name={npc.name} size="lg" />
            <div className="min-w-0">
              {npc.unconscious ? <Badge tone="danger">Unconscious</Badge> : null}
              {npc.outfit ? (
                <p className="text-sm text-fg-2">
                  {outfitAge > 12 * 60 ? 'Last seen wearing' : 'Wearing'} {npc.outfit.text}
                </p>
              ) : null}
              {npc.appearance ? <p className="mt-1 line-clamp-3 text-sm text-fg-2">{npc.appearance}</p> : null}
            </div>
          </div>

          {rel ? (
            <section>
              <h3 className="text-sm font-semibold text-fg-2">Toward you · {rel.label || relationshipLabel(rel)}</h3>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                <StatBar label="Affection" value={rel.affection + 100} max={200} showValue={false} compact />
                <StatBar label="Trust" value={rel.trust + 100} max={200} showValue={false} compact tone="success" />
                <StatBar label="Desire" value={Math.max(0, rel.desire ?? 0)} max={100} showValue={false} compact tone="danger" />
                <StatBar label="Tension" value={Math.max(0, rel.tension ?? 0)} max={100} showValue={false} compact tone="warning" />
              </div>
            </section>
          ) : null}

          {member ? (
            <section>
              <ToggleRow
                label={
                  <span className="inline-flex items-center gap-2">
                    <Icon icon={Crown} size={16} className="text-fg-3" /> Sovereign
                  </span>
                }
                description="The narrator may describe what happens to them, but never writes their words, thoughts or choices. For a companion someone else plays."
                checked={member.sovereign}
                onChange={(v) => void apply({ type: 'party.update', name: member.name, sovereign: v } as Op)}
              />
            </section>
          ) : null}

          {goals.length ? (
            <section>
              <h3 className="text-sm font-semibold text-fg-2">Wants</h3>
              <ul className="mt-1 flex flex-col gap-1 text-[15px]">
                {goals.map((g) => (
                  <li key={g.id}>
                    {g.text}
                    {g.state !== 'acting' ? <span className="text-xs text-fg-3"> · {g.state}</span> : null}
                    {g.targetLocationId && s.locations[g.targetLocationId] ? <span className="text-xs text-fg-3"> · heading for {s.locations[g.targetLocationId].name}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {bonds.length ? (
            <section>
              <h3 className="text-sm font-semibold text-fg-2">Toward others</h3>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {bonds.map((b) => (
                  <li key={b.to} className="flex justify-between gap-2">
                    <span>{s.npcs[b.to].name}</span>
                    <span className="text-fg-2">{[b.kind, b.affinity >= 20 ? 'likes' : b.affinity <= -20 ? 'dislikes' : null, b.tension >= 25 ? 'tense' : null].filter(Boolean).join(', ') || 'neutral'}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {facts.length ? (
            <section>
              <h3 className="text-sm font-semibold text-fg-2">Known facts</h3>
              <ul className="mt-1 flex flex-col gap-1 text-[15px]">
                {facts.map((f) => (
                  <li key={f.id}>{f.text}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <h3 className="text-sm font-semibold text-fg-2">What {npc.name.split(' ')[0]} knows</h3>
            {mem.isLoading ? (
              <div className="flex justify-center py-4">
                <Spinner />
              </div>
            ) : knows.length ? (
              <ul className="mt-1 flex flex-col divide-y divide-line">
                {knows.map((m) => {
                  const heard = m.heardBy.find((h) => h.id === npc.id);
                  return (
                    <li key={m.id} className="py-2">
                      <p className="text-[15px]">{m.text}</p>
                      <p className="text-xs text-fg-3">
                        {m.witnesses.some((w) => w.id === npc.id) ? 'was there' : heard && heard.distortion >= 2 ? 'heard a rumour' : 'heard about it'}
                        {m.when ? ` · ${m.when}` : ''}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="Nothing yet" className="py-4" />
            )}
          </section>
        </div>
      ) : null}
    </Sheet>
  );
}
