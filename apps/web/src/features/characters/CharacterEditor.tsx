import { FEATURE_PRESETS, PRESET_INFO } from '@everloom/engine';
import { EMOTIONS, type CardData, type CharacterDTO, type CharacterGame } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Copy, Download, FileJson, ImagePlus, MessageSquare, MoreHorizontal, Music, Play, Plus, Sparkles, Star, Trash2, Upload, Wand2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Page } from '@/app/Shell';
import { del, download, get, patch, post, upload } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useImageGen } from '@/lib/imagegen';
import { useCharacter, useChats, useConnections, useLorebooks } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { NewChatSheet } from '@/features/chats/NewChatSheet';
import { Avatar, Button, confirm, EmptyState, Field, FileButton, Icon, IconButton, Input, ListRow, Menu, Select, Sheet, Spinner, TabPanel, Tabs, Textarea } from '@/ui';

type Draft = { card: CardData; game: CharacterGame };

function tokensApprox(s: string) {
  return Math.ceil((s ?? '').length / 3.6);
}

export default function CharacterEditor() {
  const { id } = useParams();
  const q = useCharacter(id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState('profile');
  const [saving, setSaving] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const portraitGen = useImageGen();

  useEffect(() => {
    if (q.data) setDraft({ card: structuredClone(q.data.card), game: structuredClone(q.data.game ?? {}) });
  }, [q.data]);

  const dirty = useMemo(() => !!q.data && !!draft && (JSON.stringify(draft.card) !== JSON.stringify(q.data.card) || JSON.stringify(draft.game) !== JSON.stringify(q.data.game ?? {})), [q.data, draft]);

  if (q.isLoading || !draft || !q.data) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }
  const c = q.data;
  const setCard = (p: Partial<CardData>) => setDraft((d) => (d ? { ...d, card: { ...d.card, ...p } } : d));
  const setGame = (p: Partial<CharacterGame>) => setDraft((d) => (d ? { ...d, game: { ...d.game, ...p } } : d));

  const save = async () => {
    setSaving(true);
    try {
      const updated = await patch<CharacterDTO>(`/api/characters/${c.id}`, { card: draft.card, game: draft.game });
      qc.setQueryData(['character', c.id], updated);
      await qc.invalidateQueries({ queryKey: ['characters'] });
      toast({ title: 'Saved', tone: 'success' });
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };
  const drawPortrait = async () => {
    // Save pending edits first so the prompt uses the latest description.
    if (draft.card.description !== c.card.description) await patch(`/api/characters/${c.id}`, { card: { description: draft.card.description } }).catch(() => {});
    const r = await portraitGen.run({ kind: 'portrait', characterId: c.id, apply: true });
    if (!r) return;
    qc.setQueryData(['character', c.id], (x: any) => ({ ...x, avatar: r.url }));
    await qc.invalidateQueries({ queryKey: ['character', c.id] });
    await qc.invalidateQueries({ queryKey: ['characters'] });
  };
  const setAvatar = async (f: File) => {
    try {
      const m = await upload('/api/media', f, { kind: 'avatar', characterId: c.id });
      const updated = await patch<CharacterDTO>(`/api/characters/${c.id}`, { avatar: m.id });
      qc.setQueryData(['character', c.id], updated);
      await qc.invalidateQueries({ queryKey: ['characters'] });
    } catch (e) {
      toastError(e);
    }
  };
  const toggleFav = async () => {
    const updated = await patch<CharacterDTO>(`/api/characters/${c.id}`, { fav: !c.fav });
    qc.setQueryData(['character', c.id], updated);
    await qc.invalidateQueries({ queryKey: ['characters'] });
  };
  const remove = async () => {
    if (!(await confirm({ title: `Delete ${c.name}?`, description: 'The character card and its lorebook are removed. Existing chats stay.', confirmLabel: 'Delete', danger: true }))) return;
    await del(`/api/characters/${c.id}`);
    await qc.invalidateQueries({ queryKey: ['characters'] });
    navigate('/characters');
  };
  const duplicate = async () => {
    const d = await post(`/api/characters/${c.id}/duplicate`);
    await qc.invalidateQueries({ queryKey: ['characters'] });
    navigate(`/characters/${d.id}`);
  };

  return (
    <Page
      narrow
      back={<IconButton icon={ArrowLeft} label="Back" onClick={() => navigate('/characters')} />}
      title={draft.card.name || 'Unnamed'}
      actions={
        <>
          <IconButton icon={Star} label={c.fav ? 'Remove from favorites' : 'Add to favorites'} active={c.fav} onClick={toggleFav} />
          <Menu
            trigger={<IconButton icon={MoreHorizontal} label="More" />}
            items={[
              { label: 'Export PNG card', icon: Download, onSelect: () => download(`/api/characters/${c.id}/export?format=png`, `${c.name}.png`) },
              { label: 'Export JSON', icon: FileJson, onSelect: () => download(`/api/characters/${c.id}/export?format=json`, `${c.name}.json`) },
              { label: 'Open in studio', icon: Sparkles, onSelect: () => navigate(`/characters/studio?base=${c.id}`) },
              { label: 'Duplicate', icon: Copy, onSelect: duplicate },
              { label: 'Delete', icon: Trash2, danger: true, separatorBefore: true, onSelect: remove },
            ]}
          />
          {dirty ? (
            <Button variant="primary" loading={saving} onClick={save}>
              Save
            </Button>
          ) : (
            <Button variant="primary" icon={MessageSquare} onClick={() => setChatOpen(true)}>
              Chat
            </Button>
          )}
        </>
      }
    >
      <div className="flex items-center gap-4 py-2">
        <div className="relative">
          <Avatar src={c.avatar} name={draft.card.name} size="xl" shape="rounded" />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <FileButton accept="image/png,image/jpeg,image/webp" onFiles={(f) => setAvatar(f[0])} variant="secondary" size="sm" icon={ImagePlus}>
              Change image
            </FileButton>
            <Button variant="secondary" size="sm" icon={Sparkles} loading={portraitGen.busy === 'portrait'} onClick={drawPortrait}>
              Draw portrait
            </Button>
          </div>
          <p className="text-xs text-fg-2">~{tokensApprox(draft.card.description + draft.card.personality + draft.card.scenario + draft.card.mes_example)} tokens in the definition</p>
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        className="mt-2"
        tabs={[
          { value: 'profile', label: 'Profile' },
          { value: 'greetings', label: 'Greetings', count: 1 + draft.card.alternate_greetings.length },
          { value: 'prompts', label: 'Prompts' },
          { value: 'lore', label: 'Lore' },
          { value: 'game', label: 'Game' },
          { value: 'gallery', label: 'Gallery' },
          { value: 'chats', label: 'Chats' },
        ]}
      >
        <TabPanel value="profile" className="flex flex-col gap-5 pt-5">
          <Field label="Name" htmlFor="name">
            <Input id="name" value={draft.card.name} onChange={(e) => setCard({ name: e.target.value })} />
          </Field>
          <Field label="Description" htmlFor="desc" hint="Who they are, how they look, their history. Supports {{char}} and {{user}}.">
            <Textarea id="desc" rows={6} maxRows={24} value={draft.card.description} onChange={(e) => setCard({ description: e.target.value })} />
          </Field>
          <Field label="Personality" htmlFor="pers">
            <Textarea id="pers" rows={3} value={draft.card.personality} onChange={(e) => setCard({ personality: e.target.value })} />
          </Field>
          <Field label="Scenario" htmlFor="scen">
            <Textarea id="scen" rows={3} value={draft.card.scenario} onChange={(e) => setCard({ scenario: e.target.value })} />
          </Field>
          <Field label="Example dialogue" htmlFor="mes" hint="Separate examples with <START>.">
            <Textarea id="mes" rows={5} maxRows={20} value={draft.card.mes_example} onChange={(e) => setCard({ mes_example: e.target.value })} className="font-mono text-sm" />
          </Field>
          <Field label="Tags" htmlFor="tags" hint="Comma separated.">
            <Input id="tags" value={draft.card.tags.join(', ')} onChange={(e) => setCard({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} />
          </Field>
          <Field label="Creator notes" htmlFor="notes">
            <Textarea id="notes" rows={3} value={draft.card.creator_notes} onChange={(e) => setCard({ creator_notes: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Creator" htmlFor="creator">
              <Input id="creator" value={draft.card.creator} onChange={(e) => setCard({ creator: e.target.value })} />
            </Field>
            <Field label="Version" htmlFor="ver">
              <Input id="ver" value={draft.card.character_version} onChange={(e) => setCard({ character_version: e.target.value })} />
            </Field>
          </div>
        </TabPanel>

        <TabPanel value="greetings" className="flex flex-col gap-5 pt-5">
          <Field label="First message" htmlFor="first">
            <Textarea id="first" rows={6} maxRows={24} value={draft.card.first_mes} onChange={(e) => setCard({ first_mes: e.target.value })} />
          </Field>
          {draft.card.alternate_greetings.map((g, i) => (
            <Field
              key={i}
              label={`Alternate greeting ${i + 1}`}
              htmlFor={`alt${i}`}
              trailing={<IconButton size="sm" icon={X} label="Remove greeting" onClick={() => setCard({ alternate_greetings: draft.card.alternate_greetings.filter((_, j) => j !== i) })} />}
            >
              <Textarea id={`alt${i}`} rows={4} maxRows={20} value={g} onChange={(e) => setCard({ alternate_greetings: draft.card.alternate_greetings.map((x, j) => (j === i ? e.target.value : x)) })} />
            </Field>
          ))}
          <div>
            <Button variant="ghost" icon={Plus} onClick={() => setCard({ alternate_greetings: [...draft.card.alternate_greetings, ''] })}>
              Add greeting
            </Button>
          </div>
          <p className="text-xs text-fg-2">Alternate greetings appear as swipes on the first message of a new chat.</p>
        </TabPanel>

        <TabPanel value="prompts" className="flex flex-col gap-5 pt-5">
          <Field label="System prompt override" htmlFor="sys" hint="Replaces the main prompt when set. Use {{original}} to include the preset's main prompt.">
            <Textarea id="sys" rows={4} value={draft.card.system_prompt} onChange={(e) => setCard({ system_prompt: e.target.value })} />
          </Field>
          <Field label="Post-history instructions" htmlFor="phi" hint="Sent after the chat history. Use {{original}} to keep the preset's version.">
            <Textarea id="phi" rows={4} value={draft.card.post_history_instructions} onChange={(e) => setCard({ post_history_instructions: e.target.value })} />
          </Field>
          <Field label="Character note (in-chat, at depth)" htmlFor="dp">
            <Textarea
              id="dp"
              rows={3}
              value={draft.card.extensions?.depth_prompt?.prompt ?? ''}
              onChange={(e) => setCard({ extensions: { ...draft.card.extensions, depth_prompt: { depth: 4, role: 'system', ...(draft.card.extensions?.depth_prompt ?? {}), prompt: e.target.value } } })}
            />
          </Field>
          <Field label="Depth" htmlFor="dpd" hint="How many messages from the end the note is inserted.">
            <Input
              id="dpd"
              type="number"
              min={0}
              max={100}
              value={draft.card.extensions?.depth_prompt?.depth ?? 4}
              onChange={(e) => setCard({ extensions: { ...draft.card.extensions, depth_prompt: { prompt: '', role: 'system', ...(draft.card.extensions?.depth_prompt ?? {}), depth: Number(e.target.value) } } })}
              className="max-w-[120px]"
            />
          </Field>
        </TabPanel>

        <TabPanel value="lore" className="pt-5">
          <CharacterLore characterId={c.id} name={c.name} />
        </TabPanel>

        <TabPanel value="game" className="flex flex-col gap-5 pt-5">
          <GameFields game={draft.game} setGame={setGame} characterId={c.id} />
        </TabPanel>

        <TabPanel value="gallery" className="pt-5">
          <CharacterGallery characterId={c.id} name={draft.card.name} />
        </TabPanel>

        <TabPanel value="chats" className="pt-3">
          <CharacterChats characterId={c.id} onNew={() => setChatOpen(true)} />
        </TabPanel>
      </Tabs>
      <NewChatSheet open={chatOpen} onOpenChange={setChatOpen} characterId={c.id} />
    </Page>
  );
}

interface MediaItem {
  id: string;
  url: string;
  mime?: string;
  kind: string;
  meta: { prompt?: string; emotion?: string };
  createdAt: number;
}

/** Every image made for or uploaded to this character: portraits, sprites, drawings. */
export function CharacterGallery({ characterId, name }: { characterId: string; name: string }) {
  const qc = useQueryClient();
  const key = ['media', 'character', characterId];
  const media = useQuery({ queryKey: key, queryFn: () => get<MediaItem[]>('/api/media', { characterId }) });
  const gen = useImageGen();
  const [prompt, setPrompt] = useState('');
  const [open, setOpen] = useState<MediaItem | null>(null);
  const list = (media.data ?? []).filter((m) => m.kind !== 'avatar');
  const [uploading, setUploading] = useState(false);
  const add = async (files: File[]) => {
    setUploading(true);
    for (const f of files) {
      try {
        await upload('/api/media', f, { kind: 'gallery', characterId });
      } catch (e) {
        toastError(new Error(`${f.name}: ${(e as Error).message}`));
      }
    }
    setUploading(false);
    await qc.invalidateQueries({ queryKey: key });
    await qc.invalidateQueries({ queryKey: ['characters'] });
  };
  const isVideo = (m: MediaItem) => m.mime?.startsWith('video/');
  const isAudio = (m: MediaItem) => m.mime?.startsWith('audio/');
  return (
    <div className="flex flex-col gap-4">
      <FileButton accept="image/*,video/mp4,video/webm,audio/*" multiple onFiles={add} loading={uploading} variant="secondary" icon={Upload} className="self-start">
        Add pictures, video or audio
      </FileButton>
      <div className="flex gap-2">
        <Input aria-label="Describe a picture" placeholder={`${name} reading by the window…`} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={600} className="min-w-0 flex-1" />
        <Button
          variant="secondary"
          icon={Sparkles}
          loading={gen.busy === 'portrait'}
          onClick={async () => {
            const r = await gen.run({ kind: 'portrait', characterId, prompt: prompt.trim() || undefined });
            if (r) {
              setPrompt('');
              await qc.invalidateQueries({ queryKey: key });
            }
          }}
        >
          Draw
        </Button>
      </div>
      {list.length ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {list.map((m) => (
            <button key={m.id} onClick={() => setOpen(m)} className="pressable relative aspect-[3/4] overflow-hidden rounded-md bg-surface-2" aria-label={isVideo(m) ? 'Play video' : isAudio(m) ? 'Play audio' : m.meta.emotion ? `${m.meta.emotion} sprite` : 'Open image'}>
              {isVideo(m) ? (
                <>
                  <video src={`${m.url}#t=0.1`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                  <span className="absolute inset-0 m-auto flex size-10 items-center justify-center rounded-full bg-overlay text-white">
                    <Icon icon={Play} size={18} />
                  </span>
                </>
              ) : isAudio(m) ? (
                <span className="flex h-full w-full flex-col items-center justify-center gap-2 text-fg-2">
                  <Icon icon={Music} size={26} />
                  <span className="text-xs">Audio</span>
                </span>
              ) : (
                <img src={m.url} alt="" loading="lazy" className="h-full w-full object-cover object-top" />
              )}
            </button>
          ))}
        </div>
      ) : (
        <EmptyState icon={ImagePlus} title="No pictures yet" body="Portraits, sprites and drawings of this character collect here." />
      )}
      <Sheet
        open={!!open}
        onOpenChange={(o) => !o && setOpen(null)}
        title={isVideo(open ?? ({} as MediaItem)) ? 'Video' : isAudio(open ?? ({} as MediaItem)) ? 'Audio' : 'Picture'}
        description={open?.meta.prompt ? undefined : open ? relativeTime(open.createdAt) : undefined}
        size="md"
        footer={
          open ? (
            <>
              <IconButton
                icon={Trash2}
                label="Delete picture"
                onClick={async () => {
                  if (!(await confirm({ title: 'Delete this picture?', description: 'If it is used as the avatar or a sprite, that spot becomes empty.', confirmLabel: 'Delete', danger: true }))) return;
                  try {
                    await del(`/api/media/${open.id}`);
                    setOpen(null);
                    await qc.invalidateQueries({ queryKey: key });
                    await qc.invalidateQueries({ queryKey: ['character', characterId] });
                  } catch (e) {
                    toastError(e);
                  }
                }}
              />
              <Button
                variant="primary"
                className="flex-1"
                disabled={isVideo(open) || isAudio(open)}
                onClick={async () => {
                  try {
                    const updated = await patch<CharacterDTO>(`/api/characters/${characterId}`, { avatar: open.id });
                    qc.setQueryData(['character', characterId], updated);
                    await qc.invalidateQueries({ queryKey: ['characters'] });
                    toast({ title: 'Avatar updated', tone: 'success' });
                  } catch (e) {
                    toastError(e);
                  }
                }}
              >
                Use as avatar
              </Button>
            </>
          ) : undefined
        }
      >
        {open ? (
          <div className="flex flex-col gap-3">
            {isVideo(open) ? (
              <video src={open.url} controls playsInline className="max-h-[60dvh] w-full rounded-md bg-black" />
            ) : isAudio(open) ? (
              <audio src={open.url} controls className="w-full" />
            ) : (
              <img src={open.url} alt="" className="max-h-[60dvh] w-full rounded-md object-contain" />
            )}
            {open.meta.prompt ? <p className="text-xs text-fg-2">{open.meta.prompt}</p> : null}
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

export function CharacterLore({ characterId, name }: { characterId: string; name: string }) {
  const books = useLorebooks();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const mine = (books.data ?? []).filter((b) => b.scope === 'character' && b.scopeId === characterId);
  const create = async () => {
    const b = await post('/api/lorebooks', { name: `${name}'s lore`, scope: 'character', scopeId: characterId });
    await qc.invalidateQueries({ queryKey: ['lorebooks'] });
    navigate(`/lore/${b.id}`);
  };
  if (!mine.length)
    return (
      <EmptyState
        icon={BookOpen}
        title="No embedded lorebook"
        body="Entries in a character lorebook travel with the card when you export it."
        action={
          <Button variant="secondary" icon={Plus} onClick={create}>
            Create lorebook
          </Button>
        }
      />
    );
  return (
    <div className="flex flex-col">
      {mine.map((b) => (
        <ListRow key={b.id} title={b.name} subtitle={`${b.entryCount} entries`} chevron onClick={() => navigate(`/lore/${b.id}`)} />
      ))}
    </div>
  );
}

export function CharacterChats({ characterId, onNew }: { characterId: string; onNew: () => void }) {
  const chats = useChats({ characterId });
  const navigate = useNavigate();
  if (!chats.data?.length)
    return (
      <EmptyState
        icon={MessageSquare}
        title="No chats yet"
        action={
          <Button variant="primary" onClick={onNew}>
            Start a chat
          </Button>
        }
      />
    );
  return (
    <div className="flex flex-col">
      {chats.data.map((ch) => (
        <ListRow key={ch.id} title={ch.title} subtitle={`${ch.messageCount} messages · ${relativeTime(ch.updatedAt)}`} chevron onClick={() => navigate(`/chat/${ch.id}`)} />
      ))}
    </div>
  );
}

function GameFields({ game, setGame, characterId }: { game: CharacterGame; setGame: (p: Partial<CharacterGame>) => void; characterId: string }) {
  const conns = useConnections();
  const llms = (conns.data ?? []).filter((x) => ['openai', 'anthropic', 'gemini', 'textgen'].includes(x.provider));
  const [uploading, setUploading] = useState<string | null>(null);
  const gen = useImageGen();
  const [batch, setBatch] = useState(false);
  const drawExpression = async (emotion: string, current: Record<string, string>) => {
    setUploading(emotion);
    const r = await gen.run({ kind: 'expression', characterId, emotion }, emotion);
    setUploading(null);
    if (!r) return null;
    const next = { ...current, [emotion]: r.id };
    setGame({ expressions: next });
    return next;
  };
  const drawMissing = async () => {
    setBatch(true);
    let cur = { ...(game.expressions ?? {}) };
    for (const e of EMOTIONS) {
      if (cur[e]) continue;
      const next = await drawExpression(e, cur);
      if (!next) break;
      cur = next;
    }
    setBatch(false);
  };
  const setExpression = async (emotion: string, f: File) => {
    setUploading(emotion);
    try {
      const m = await upload('/api/media', f, { kind: 'sprite', characterId });
      setGame({ expressions: { ...(game.expressions ?? {}), [emotion]: m.id } });
    } catch (e) {
      toastError(e);
    } finally {
      setUploading(null);
    }
  };
  return (
    <>
      <Field label="Mode for new chats" htmlFor="chatmode" hint="New chats with this character start in this mode without asking.">
        <Select id="chatmode" value={game.chatMode ?? ''} onChange={(e) => setGame({ chatMode: (e.target.value || null) as never })}>
          <option value="">Ask (or follow Settings › Features)</option>
          {FEATURE_PRESETS.map((p) => (
            <option key={p} value={p}>
              {PRESET_INFO[p].label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Chat rules" htmlFor="rules" hint="Extra instructions sent with every reply from this character.">
        <Textarea id="rules" rows={3} value={game.chatRules ?? ''} onChange={(e) => setGame({ chatRules: e.target.value })} />
      </Field>
      <Field label="Drives and goals" htmlFor="drives">
        <Textarea id="drives" rows={3} value={game.drives ?? ''} onChange={(e) => setGame({ drives: e.target.value })} />
      </Field>
      <Field label="Organizations" htmlFor="orgs" hint="Comma separated. Used when this character appears as an NPC.">
        <Input id="orgs" value={(game.orgs ?? []).join(', ')} onChange={(e) => setGame({ orgs: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
      </Field>
      <Field label="Model for this character" htmlFor="conn">
        <Select id="conn" value={game.connectionId ?? ''} onChange={(e) => setGame({ connectionId: e.target.value || null })}>
          <option value="">Use the main model</option>
          {llms.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} — {x.model}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Voice" htmlFor="voice" hint="Voice id for the TTS provider.">
          <Input id="voice" value={game.voice?.voice ?? ''} onChange={(e) => setGame({ voice: { ...game.voice, voice: e.target.value } })} placeholder="alloy" />
        </Field>
        <Field label="Speed" htmlFor="speed">
          <Input id="speed" type="number" step={0.05} min={0.5} max={2} value={game.voice?.speed ?? 1} onChange={(e) => setGame({ voice: { ...game.voice, speed: Number(e.target.value) } })} />
        </Field>
      </div>
      <div>
        <p className="text-sm font-medium">Expressions</p>
        <p className="mt-0.5 text-xs text-fg-2">Sprites shown in Stage mode. The reply's mood picks one; neutral is the fallback. Drawn sprites are saved with the card when you save.</p>
        <Button variant="secondary" size="sm" icon={Wand2} className="mt-2" loading={batch} disabled={!!uploading && !batch} onClick={drawMissing}>
          Draw missing expressions
        </Button>
        <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5">
          {EMOTIONS.map((e) => {
            const id = game.expressions?.[e];
            return (
              <div key={e} className="flex flex-col gap-1.5">
                <div className="relative aspect-[3/4] overflow-hidden rounded-md bg-surface-2">
                  {id ? <img src={`/media/${id}`} alt={e} className="h-full w-full object-cover object-top" /> : null}
                  {uploading === e ? <Spinner className="absolute inset-0 m-auto" /> : null}
                </div>
                <div className="flex items-center justify-between">
                  <span className="truncate text-xs capitalize text-fg-2">{e}</span>
                  <span className="flex">
                    <IconButton size="sm" icon={Sparkles} label={`Draw ${e} sprite`} disabled={!!uploading} onClick={() => drawExpression(e, game.expressions ?? {})} />
                    <FileButton accept="image/*" onFiles={(f) => setExpression(e, f[0])} variant="quiet" size="sm" className="!px-1.5" aria-label={`Upload ${e} sprite`}>
                      {id ? 'Replace' : 'Add'}
                    </FileButton>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
