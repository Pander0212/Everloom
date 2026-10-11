/**
 * Story cards: the chat's lorebook with a friendlier face (docs/ux/hakawati.md). A card is a
 * lorebook entry with a type (character, place, thing, idea), a title, the words that bring it up
 * and what the narrator should know; pinned cards are always read. The AI can propose cards from
 * the story so far. One system: these are the same entries the lorebook editor shows.
 */
import type { ChatDTO, LorebookDTO, WIEntry } from '@everloom/engine';
import { newEntry } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Box, Lightbulb, MapPin, Pin, PinOff, Plus, Sparkles, Trash2, User } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { get, post, put } from '@/lib/api';
import { cx } from '@/lib/format';
import { toast, toastError } from '@/lib/store';
import { Button, EmptyState, Field, Icon, IconButton, Input, Segmented, Textarea } from '@/ui';

type CardType = 'character' | 'place' | 'thing' | 'concept';
const TYPES: Array<{ id: CardType; label: string; icon: typeof User }> = [
  { id: 'character', label: 'Character', icon: User },
  { id: 'place', label: 'Place', icon: MapPin },
  { id: 'thing', label: 'Thing', icon: Box },
  { id: 'concept', label: 'Idea', icon: Lightbulb },
];
const typeOf = (e: WIEntry): CardType => (TYPES.some((t) => t.id === e.cardType) ? (e.cardType as CardType) : 'concept');

interface Proposal {
  type: CardType;
  title: string;
  keys: string[];
  content: string;
}

export function StoryCards({ chat }: { chat: ChatDTO }) {
  const qc = useQueryClient();
  const books = useQuery({ queryKey: ['lorebooks'], queryFn: () => get<LorebookDTO[]>('/api/lorebooks') });
  const mine = books.data?.find((b) => b.scope === 'chat' && b.scopeId === chat.id) ?? null;
  const others = (books.data ?? []).filter((b) => b.enabled && b !== mine && ((b.scope === 'character' && b.scopeId === chat.characterId) || b.scope === 'global'));
  const entries = useMemo(() => Object.values(mine?.book.entries ?? {}).sort((a, b) => Number(b.constant) - Number(a.constant) || a.comment.localeCompare(b.comment)), [mine]);
  const [editing, setEditing] = useState<WIEntry | 'new' | null>(null);
  const [proposals, setProposals] = useState<Array<Proposal & { take: boolean }> | null>(null);
  const [busy, setBusy] = useState(false);

  /** This chat's own book, made the first time a card is added. */
  const ensureBook = async (): Promise<LorebookDTO> => mine ?? (await post<LorebookDTO>('/api/lorebooks', { name: `${chat.title} — story cards`, scope: 'chat', scopeId: chat.id }));
  const saveEntries = async (book: LorebookDTO, list: WIEntry[]) => {
    const next = { ...book.book, entries: Object.fromEntries(list.map((e) => [String(e.uid), e])) };
    await put(`/api/lorebooks/${book.id}`, { book: next });
    await qc.invalidateQueries({ queryKey: ['lorebooks'] });
  };
  const nextUid = (list: WIEntry[]) => list.reduce((m, e) => Math.max(m, e.uid), -1) + 1;

  const addCards = async (cards: Array<Proposal & { pinned?: boolean }>) => {
    try {
      const book = await ensureBook();
      const list = Object.values(book.book.entries);
      let uid = nextUid(list);
      for (const c of cards) list.push(newEntry(uid++, { comment: c.title, key: c.keys, content: c.content, cardType: c.type, constant: !!c.pinned } as Partial<WIEntry>));
      await saveEntries(book, list);
      toast({ title: cards.length === 1 ? 'Card added' : `${cards.length} cards added`, tone: 'success' });
    } catch (e) {
      toastError(e);
    }
  };
  const update = async (e: WIEntry) => {
    if (!mine) return;
    await saveEntries(mine, Object.values(mine.book.entries).map((x) => (x.uid === e.uid ? e : x))).catch(toastError);
  };
  const remove = async (e: WIEntry) => {
    if (!mine) return;
    await saveEntries(mine, Object.values(mine.book.entries).filter((x) => x.uid !== e.uid)).catch(toastError);
  };
  const generate = async () => {
    setBusy(true);
    try {
      const known = [...entries.map((e) => e.comment), ...others.flatMap((b) => Object.values(b.book.entries).map((e) => e.comment))].filter(Boolean);
      const r = await post<{ cards: Proposal[] }>(`/api/chats/${chat.id}/cards/generate`, { count: 5, known });
      if (!r.cards.length) toast('Nothing new to add yet');
      else setProposals(r.cards.map((c) => ({ ...c, take: true })));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  if (editing) return <CardEditor entry={editing === 'new' ? null : editing} onCancel={() => setEditing(null)} onSave={async (c, e) => {
    if (e) await update({ ...e, comment: c.title, key: c.keys, content: c.content, cardType: c.type, constant: c.pinned } as WIEntry);
    else await addCards([c]);
    setEditing(null);
  }} />;

  if (proposals) {
    const n = proposals.filter((p) => p.take).length;
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg-2">Cards the AI found in the story. Keep the ones you want.</p>
        {proposals.map((p, i) => (
          <label key={i} className="flex cursor-pointer gap-3 rounded-md border border-line p-3">
            <input type="checkbox" checked={p.take} onChange={() => setProposals((l) => l!.map((x, j) => (j === i ? { ...x, take: !x.take } : x)))} className="mt-1" aria-label={`Keep ${p.title}`} />
            <CardBody type={p.type} title={p.title} keys={p.keys} content={p.content} />
          </label>
        ))}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setProposals(null)}>
            Discard
          </Button>
          <Button variant="primary" disabled={!n} onClick={async () => {
            await addCards(proposals.filter((p) => p.take));
            setProposals(null);
          }}>
            Add {n} {n === 1 ? 'card' : 'cards'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon={Plus} onClick={() => setEditing('new')}>
          New card
        </Button>
        <Button size="sm" variant="secondary" icon={Sparkles} loading={busy} onClick={() => void generate()}>
          Make cards from the story
        </Button>
      </div>
      {entries.length ? (
        <ul className="flex flex-col gap-2" aria-label="Story cards">
          {entries.map((e) => (
            <li key={e.uid} className="group flex gap-2 rounded-md border border-line p-3">
              <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(e)}>
                <CardBody type={typeOf(e)} title={e.comment || 'Untitled'} keys={e.key} content={e.content} pinned={e.constant} />
              </button>
              <div className="flex flex-col gap-1">
                <IconButton size="sm" icon={e.constant ? PinOff : Pin} label={e.constant ? `Unpin ${e.comment}` : `Pin ${e.comment}`} onClick={() => void update({ ...e, constant: !e.constant })} />
                <IconButton size="sm" icon={Trash2} label={`Delete ${e.comment}`} onClick={() => void remove(e)} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={BookOpen} title="No story cards yet" body="Cards tell the narrator about people, places and things when they come up. Add one, or let the AI make cards from the story so far." />
      )}
      {others.length ? (
        <p className="text-xs text-fg-2">
          Also used here: {others.map((b) => b.name).join(', ')} (<Link to="/lore" className="text-accent-text">Lorebooks</Link>).
        </p>
      ) : null}
    </div>
  );
}

function CardBody({ type, title, keys, content, pinned }: { type: CardType; title: string; keys: string[]; content: string; pinned?: boolean }) {
  const t = TYPES.find((x) => x.id === type)!;
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <Icon icon={t.icon} size={15} className="text-fg-2" />
        {title}
        {pinned ? <span className="rounded-sm bg-accent-soft px-1.5 text-[11px] font-medium text-accent-text">Pinned</span> : null}
      </span>
      {keys.length ? <span className="truncate text-xs text-fg-3">{keys.join(', ')}</span> : <span className="text-xs text-fg-3">{pinned ? 'Always read' : 'No trigger words'}</span>}
      <span className="line-clamp-3 text-sm text-fg-2">{content}</span>
    </span>
  );
}

function CardEditor({ entry, onSave, onCancel }: { entry: WIEntry | null; onSave: (c: Proposal & { pinned: boolean }, e: WIEntry | null) => Promise<void>; onCancel: () => void }) {
  const [type, setType] = useState<CardType>(entry ? typeOf(entry) : 'character');
  const [title, setTitle] = useState(entry?.comment ?? '');
  const [keys, setKeys] = useState((entry?.key ?? []).join(', '));
  const [content, setContent] = useState(entry?.content ?? '');
  const [pinned, setPinned] = useState(!!entry?.constant);
  return (
    <div className="flex flex-col gap-3">
      <Segmented label="Card type" value={type} onChange={setType} options={TYPES.map((t) => ({ value: t.id, label: t.label }))} />
      <Field label="Title" htmlFor="card-title">
        <Input id="card-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Words that bring it up" htmlFor="card-keys" hint="Separated by commas. When one comes up in the story, the narrator reads this card.">
        <Input id="card-keys" value={keys} onChange={(e) => setKeys(e.target.value)} placeholder="Tobias, the drummer" />
      </Field>
      <Field label="What the narrator should know" htmlFor="card-content">
        <Textarea id="card-content" rows={4} value={content} onChange={(e) => setContent(e.target.value)} />
      </Field>
      <label className={cx('flex items-center gap-2 text-sm')}>
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pinned: always read, whatever comes up
      </label>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!title.trim() || !content.trim()} onClick={() => void onSave({ type, title: title.trim(), keys: keys.split(',').map((k) => k.trim()).filter(Boolean), content: content.trim(), pinned }, entry)}>
          Save card
        </Button>
      </div>
    </div>
  );
}
