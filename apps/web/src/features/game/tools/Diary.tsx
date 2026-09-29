import { formatDate } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Anchor, Bird, Bold, BookHeart, Italic, Quote, Camera, Cat, ChevronLeft, ChevronRight, Coffee, Crown, Feather, Flame, Flower2, Heart, ImagePlus, Key, Leaf, Moon, Music, Pencil, Plus, Snowflake, Sparkles, Star, Sun, Trash2, Umbrella, Wand2, X, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRef, useState } from 'react';
import { del, get, post, put, upload } from '@/lib/api';
import { cx } from '@/lib/format';
import { renderStory } from '@/lib/render';
import { useImageGen } from '@/lib/imagegen';
import { t } from '@/lib/motion';
import { toastError } from '@/lib/store';
import { Button, confirm, EmptyState, Field, FileButton, Icon, IconButton, Input, Popover, Textarea, useMedia } from '@/ui';
import { useGame } from '../context';
import { NoCampaign, ToolSheet } from './ToolSheet';

const STICKERS: Record<string, LucideIcon> = { star: Star, heart: Heart, sparkles: Sparkles, moon: Moon, sun: Sun, flower: Flower2, leaf: Leaf, music: Music, coffee: Coffee, feather: Feather, key: Key, crown: Crown, anchor: Anchor, cat: Cat, bird: Bird, umbrella: Umbrella, flame: Flame, snow: Snowflake };

interface Content {
  text: string;
  mood?: string;
  photos: Array<{ mediaId: string; caption: string; rot: number }>;
  stickers: Array<{ icon: string; x: number; y: number; rot: number }>;
}
interface Entry {
  id: string;
  number: number;
  title: string;
  content: Content;
  gameTime: number | null;
  createdAt: number;
}

const empty = (): Content => ({ text: '', photos: [], stickers: [] });
/** Small deterministic tilt so pages feel hand-made but stay stable. */
const tilt = (seed: string, span = 6) => ((seed.split('').reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5) % (span * 2 + 1)) - span);

export default function Diary() {
  const { state: s, chat } = useGame();
  const qc = useQueryClient();
  const key = ['diary', chat.campaignId];
  const entries = useQuery({ queryKey: key, queryFn: () => get<Entry[]>(`/api/campaigns/${chat.campaignId}/diary`), enabled: !!chat.campaignId });
  const [page, setPage] = useState<number | null>(null);
  const [dir, setDir] = useState(1);
  const [editing, setEditing] = useState<{ id: string | null; title: string; content: Content } | null>(null);
  const [drafting, setDrafting] = useState(false);
  // Landscape screens show an open book: two pages side by side.
  const spread = useMedia('(orientation: landscape) and (min-width: 700px)');
  if (!s) return <ToolSheet title="Diary"><NoCampaign /></ToolSheet>;
  const list = entries.data ?? [];
  const step = spread ? 2 : 1;
  const first = page !== null ? page - (page % step) : null;
  const cur = first !== null ? list[first] : null;
  const facing = spread && first !== null ? list[first + 1] ?? null : null;
  const turn = (to: number) => {
    setDir(to > (page ?? 0) ? 1 : -1);
    setPage(to);
  };

  const draft = async () => {
    setDrafting(true);
    try {
      const d = await post<{ title: string; text: string; mood: string }>(`/api/campaigns/${chat.campaignId}/diary/draft`, { chatId: chat.id });
      setEditing({ id: null, title: d.title, content: { ...empty(), text: d.text, mood: d.mood } });
    } catch (e) {
      toastError(e);
    } finally {
      setDrafting(false);
    }
  };

  if (editing) {
    return (
      <Editor
        value={editing}
        onCancel={() => setEditing(null)}
        onSaved={async (saved) => {
          await qc.invalidateQueries({ queryKey: key });
          const fresh = await qc.fetchQuery({ queryKey: key, queryFn: () => get<Entry[]>(`/api/campaigns/${chat.campaignId}/diary`) });
          setEditing(null);
          setPage(Math.max(0, fresh.findIndex((e) => e.id === saved.id)));
        }}
      />
    );
  }

  return (
    <ToolSheet
      title="Diary"
      size={spread ? 'full' : 'lg'}
      description={cur ? (facing ? `Pages ${cur.number}–${facing.number} of ${list.length}` : `Page ${cur.number} of ${list.length}`) : `${list.length} ${list.length === 1 ? 'page' : 'pages'}`}
      headerActions={cur ? <IconButton icon={Pencil} label="Edit page" onClick={() => setEditing({ id: cur.id, title: cur.title, content: { ...empty(), ...cur.content } })} /> : null}
      footer={
        cur ? (
          <>
            <IconButton icon={ChevronLeft} label="Previous page" disabled={!first} onClick={() => turn(first! - step)} />
            <Button variant="ghost" className="flex-1" onClick={() => setPage(null)}>
              All pages
            </Button>
            <IconButton icon={ChevronRight} label="Next page" disabled={first! + step > list.length - 1} onClick={() => turn(first! + step)} />
          </>
        ) : (
          <>
            <Button variant="secondary" icon={Plus} className="flex-1" onClick={() => setEditing({ id: null, title: '', content: empty() })}>
              New page
            </Button>
            <Button variant="primary" icon={Wand2} className="flex-1" loading={drafting} onClick={draft}>
              Write today’s page
            </Button>
          </>
        )
      }
    >
      {cur ? (
        <div className="relative overflow-hidden">
          <AnimatePresence mode="wait" initial={false} custom={dir}>
            <motion.div key={cur.id} initial={{ opacity: 0, x: dir * 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -40 }} transition={t.base} className={cx(spread && 'grid grid-cols-2 gap-4')}>
              <Page entry={cur} calendar={s.meta.calendar} />
              {spread ? facing ? <Page entry={facing} calendar={s.meta.calendar} /> : <div className="rounded-md bg-surface-2/60" aria-hidden="true" /> : null}
            </motion.div>
          </AnimatePresence>
        </div>
      ) : list.length ? (
        <ol className="flex flex-col gap-2">
          {[...list].reverse().map((e) => (
            <li key={e.id}>
              <button onClick={() => turn(list.indexOf(e))} className="pressable flex w-full gap-3 rounded-md border border-line p-3 text-left hover:bg-surface-2">
                <span className="w-8 flex-none pt-0.5 text-right font-serif text-lg tabular-nums text-fg-3">{e.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.title}</span>
                  <span className="block text-xs text-fg-3">{e.gameTime !== null ? formatDate(e.gameTime, s.meta.calendar) : ''}{e.content.mood ? ` · ${e.content.mood}` : ''}</span>
                  <span className="mt-1 line-clamp-2 block font-serif text-sm text-fg-2">{e.content.text}</span>
                </span>
                {e.content.photos[0] ? <img src={`/media/${e.content.photos[0].mediaId}`} alt="" className="h-14 w-14 flex-none rounded-sm object-cover" loading="lazy" /> : null}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState icon={BookHeart} title="An empty diary" body="Write a page yourself, or let the model draft one from today’s events in your voice." />
      )}
    </ToolSheet>
  );
}

function Page({ entry, calendar }: { entry: Entry; calendar: Parameters<typeof formatDate>[1] }) {
  const c = entry.content;
  return (
    <article className="relative min-h-[60dvh] min-w-0 rounded-md bg-surface-2 px-5 pb-8 pt-6 shadow-1 sm:px-8">
      {c.stickers.map((st, i) => {
        const I = STICKERS[st.icon] ?? Star;
        return <I key={i} aria-hidden="true" className="pointer-events-none absolute text-accent-text opacity-80" size={28} strokeWidth={1.5} style={{ left: `${st.x}%`, top: `${st.y}%`, transform: `translate(-50%, -50%) rotate(${st.rot}deg)` }} />;
      })}
      <p className="text-xs uppercase tracking-wide text-fg-3">{entry.gameTime !== null ? formatDate(entry.gameTime, calendar) : ''}</p>
      <h2 className="mt-1 font-serif text-[28px] leading-tight">{entry.title}</h2>
      {c.mood ? <p className="mt-1 text-sm italic text-fg-2">Feeling {c.mood}</p> : null}
      {c.photos.length ? (
        <div className="my-5 flex flex-wrap justify-center gap-4">
          {c.photos.map((p) => (
            <figure key={p.mediaId} className="w-[min(240px,70%)] bg-surface p-2 pb-3 shadow-2" style={{ transform: `rotate(${p.rot || tilt(p.mediaId, 3)}deg)` }}>
              <img src={`/media/${p.mediaId}`} alt={p.caption || 'Diary photo'} className="aspect-square w-full object-cover" loading="lazy" />
              {p.caption ? <figcaption className="mt-2 text-center font-serif text-sm text-fg-2">{p.caption}</figcaption> : null}
            </figure>
          ))}
        </div>
      ) : null}
      <div className="diary-text mt-4 font-serif text-[17px] leading-7 text-fg" dangerouslySetInnerHTML={{ __html: renderStory(c.text) }} />
    </article>
  );
}

function Editor({ value, onCancel, onSaved }: { value: { id: string | null; title: string; content: Content }; onCancel: () => void; onSaved: (e: Entry) => void }) {
  const { chat } = useGame();
  const qc = useQueryClient();
  const gen = useImageGen();
  const [title, setTitle] = useState(value.title);
  const [c, setC] = useState<Content>(value.content);
  const [saving, setSaving] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  /** Wrap the selection (or insert at the cursor) with markdown markers. */
  const wrap = (before: string, after = before) => {
    const el = textRef.current;
    const start = el?.selectionStart ?? c.text.length;
    const end = el?.selectionEnd ?? c.text.length;
    const lineStart = after === '' ? c.text.lastIndexOf('\n', start - 1) + 1 : start;
    const next = after === '' ? c.text.slice(0, lineStart) + before + c.text.slice(lineStart) : c.text.slice(0, start) + before + c.text.slice(start, end) + after + c.text.slice(end);
    setC({ ...c, text: next.slice(0, 20000) });
    requestAnimationFrame(() => {
      el?.focus();
      const caret = after === '' ? end + before.length : end + before.length;
      el?.setSelectionRange(caret, caret);
    });
  };
  const addPhoto = (mediaId: string) => setC((x) => ({ ...x, photos: [...x.photos, { mediaId, caption: '', rot: tilt(mediaId, 4) }].slice(0, 12) }));
  const addSticker = (icon: string) =>
    setC((x) => {
      const n = x.stickers.length;
      const seed = `${icon}${n}${x.text.length}`;
      // Scatter along the margins so stickers don't cover the writing.
      const spots = [
        [88, 8],
        [10, 92],
        [92, 55],
        [6, 30],
        [85, 90],
        [50, 4],
      ];
      const [px, py] = spots[n % spots.length];
      return { ...x, stickers: [...x.stickers, { icon, x: px, y: py, rot: tilt(seed, 20) }].slice(0, 24) };
    });
  const save = async () => {
    setSaving(true);
    try {
      const body = { title: title.trim(), content: c };
      const saved = value.id ? await put<Entry>(`/api/diary/${value.id}`, body) : await post<Entry>(`/api/campaigns/${chat.campaignId}/diary`, body);
      onSaved(saved);
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <ToolSheet
      title={value.id ? 'Edit page' : 'New page'}
      headerActions={
        value.id ? (
          <IconButton
            icon={Trash2}
            label="Delete page"
            onClick={async () => {
              if (!(await confirm({ title: 'Tear out this page?', description: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
              try {
                await del(`/api/diary/${value.id}`);
                await qc.invalidateQueries({ queryKey: ['diary', chat.campaignId] });
                onCancel();
              } catch (e) {
                toastError(e);
              }
            }}
          />
        ) : null
      }
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" className="flex-1" loading={saving} disabled={!c.text.trim() && !c.photos.length} onClick={save}>
            Save page
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Title" htmlFor="di-title" hint="Leave empty to use today’s date.">
          <Input id="di-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Mood" htmlFor="di-mood">
          <Input id="di-mood" value={c.mood ?? ''} onChange={(e) => setC({ ...c, mood: e.target.value })} maxLength={30} placeholder="hopeful" />
        </Field>
        <Field
          label="Entry"
          htmlFor="di-text"
          hint="**bold**, *italic*, > a quote, - a list."
          trailing={
            <span className="flex gap-0.5">
              <IconButton size="sm" icon={Bold} label="Bold" onClick={() => wrap('**')} />
              <IconButton size="sm" icon={Italic} label="Italic" onClick={() => wrap('*')} />
              <IconButton size="sm" icon={Quote} label="Quote" onClick={() => wrap('> ', '')} />
            </span>
          }
        >
          <Textarea ref={textRef} id="di-text" value={c.text} onChange={(e) => setC({ ...c, text: e.target.value })} maxLength={20000} maxRows={20} className="min-h-40 font-serif text-[16px] leading-7" />
        </Field>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">Photos</h3>
          {c.photos.length ? (
            <div className="mb-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {c.photos.map((p, i) => (
                <div key={p.mediaId} className="flex flex-col gap-1.5">
                  <div className="relative">
                    <img src={`/media/${p.mediaId}`} alt="" className="aspect-square w-full rounded-sm object-cover" />
                    <IconButton size="sm" icon={X} label="Remove photo" className="absolute right-1 top-1 !bg-surface shadow-1" onClick={() => setC({ ...c, photos: c.photos.filter((_, j) => j !== i) })} />
                  </div>
                  <Input aria-label="Caption" placeholder="Caption" value={p.caption} onChange={(e) => setC({ ...c, photos: c.photos.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)) })} maxLength={200} />
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={Camera}
              loading={gen.busy === 'scene'}
              onClick={async () => {
                const r = await gen.run({ kind: 'scene', chatId: chat.id, prompt: c.text.slice(0, 600) || undefined });
                if (r) addPhoto(r.id);
              }}
            >
              Snap the scene
            </Button>
            <FileButton
              variant="secondary"
              icon={ImagePlus}
              accept="image/png,image/jpeg,image/webp,image/gif"
              onFiles={async (files) => {
                try {
                  const r = await upload<{ id: string }>('/api/media', files[0], { kind: 'photo' });
                  addPhoto(r.id);
                } catch (e) {
                  toastError(e);
                }
              }}
            >
              Add photo
            </FileButton>
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">Stickers</h3>
          <div className="flex flex-wrap items-center gap-2">
            {c.stickers.map((st, i) => (
              <button key={i} onClick={() => setC({ ...c, stickers: c.stickers.filter((_, j) => j !== i) })} aria-label={`Remove ${st.icon} sticker`} className="pressable flex h-10 w-10 items-center justify-center rounded-md bg-accent-soft text-accent-text">
                <Icon icon={STICKERS[st.icon] ?? Star} size={20} />
              </button>
            ))}
            <Popover
              trigger={
                <Button variant="quiet" size="sm" icon={Plus} disabled={c.stickers.length >= 24}>
                  Sticker
                </Button>
              }
            >
              <div className="grid grid-cols-6 gap-1">
                {Object.entries(STICKERS).map(([k, I]) => (
                  <button key={k} onClick={() => addSticker(k)} aria-label={`Add ${k} sticker`} className={cx('pressable flex h-10 w-10 items-center justify-center rounded-md text-fg-2 hover:bg-surface-2 hover:text-accent-text')}>
                    <Icon icon={I} size={20} />
                  </button>
                ))}
              </div>
            </Popover>
          </div>
        </section>
      </div>
    </ToolSheet>
  );
}
