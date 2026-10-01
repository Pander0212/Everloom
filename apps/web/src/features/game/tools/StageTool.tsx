/** Stage & sound: cutscenes, music and ambience, the sprite library, voices and optional Live2D. */
import { EMOTIONS, type CharacterDTO, type Op } from '@everloom/engine';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clapperboard, Music, Play, Plus, Sparkles, Trash2, Upload, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { del, get, patch, post, upload } from '@/lib/api';
import { cx } from '@/lib/format';
import { qk, useSettings } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, EmptyState, Field, FileButton, IconButton, Input, Select, Sheet, Slider, TabPanel, Tabs, Textarea, ToggleRow } from '@/ui';
import { useGame } from '../context';
import { FX_LIST } from '../StageFx';
import { NoCampaign, ToolSheet } from './ToolSheet';

const MOODS = ['calm', 'tense', 'battle', 'romantic', 'sad', 'mysterious', 'joyful'];
const AMBIENT = ['auto', 'none', 'rain', 'storm', 'wind', 'city', 'crowd', 'forest', 'sea', 'fire', 'night'] as const;

const toBase64 = (f: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

export default function StageTool({ arg }: { arg?: string }) {
  const { state: s, chat } = useGame();
  const [tab, setTab] = useState(arg ?? 'cutscenes');
  if (!s) return <NoCampaign />;
  return (
    <ToolSheet title="Stage & sound">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'cutscenes', label: 'Scene' },
          { value: 'sound', label: 'Sound' },
          { value: 'sprites', label: 'Sprites' },
          { value: 'voices', label: 'Voices' },
        ]}
      >
        <TabPanel value="cutscenes" className="flex flex-col gap-5 pt-4">
          <Cutscenes />
          <StageOptions />
        </TabPanel>
        <TabPanel value="sound" className="pt-4">
          <Sound />
        </TabPanel>
        <TabPanel value="sprites" className="pt-4">
          <Sprites chatCharacterIds={chat.characterId ? [chat.characterId] : []} />
        </TabPanel>
        <TabPanel value="voices" className="pt-4">
          <Voices chatCharacterIds={chat.characterId ? [chat.characterId] : []} />
        </TabPanel>
      </Tabs>
    </ToolSheet>
  );
}

// ------------------------------------------------------------------ cutscenes

type Draft = { name: string; steps: Array<{ text: string; speaker?: string; fx?: string; mood?: string; seconds?: number }> };

/** "Name: line" becomes a spoken step; other lines are narration. */
function parseSteps(text: string) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^([A-Z][\w .'-]{0,40}):\s+(.+)$/.exec(l);
      return m ? { speaker: m[1]!, text: m[2]! } : { text: l };
    });
}

function Cutscenes() {
  const { state: s, apply, chat } = useGame();
  const list = Object.values(s?.stage?.cutscenes ?? {});
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [script, setScript] = useState('');
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const suggest = async () => {
    setBusy(true);
    try {
      setDraft((await post<{ cutscene: Draft }>(`/api/campaigns/${chat.campaignId}/cutscenes/generate`, { chatId: chat.id, idea })).cutscene);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      {list.length ? (
        <ul className="flex flex-col divide-y divide-line" aria-label="Cutscenes">
          {list.map((c) => (
            <li key={c.id} className="flex items-center gap-2 py-2.5">
              <Clapperboard size={16} className="flex-none text-fg-3" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{c.name}</span>
                <span className="block text-xs text-fg-2">
                  {c.steps.length} step{c.steps.length === 1 ? '' : 's'}
                  {c.source === 'ai' ? ' · drafted with AI' : ''}
                </span>
              </span>
              <Button size="sm" icon={Play} onClick={() => apply({ type: 'cutscene.play', name: c.id } as Op, { quiet: true })} aria-label={`Play ${c.name}`}>
                Play
              </Button>
              <IconButton size="sm" icon={Trash2} label={`Delete ${c.name}`} onClick={() => apply({ type: 'cutscene.remove', name: c.id } as Op, { quiet: true })} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Clapperboard} title="No cutscenes yet" body="Write one, or let the utility model draft one from the story for you to check." className="!py-6" />
      )}
      <div className="flex flex-wrap gap-2">
        <Button icon={Plus} onClick={() => setEditing(true)}>
          Write one
        </Button>
        <div className="flex min-w-0 flex-1 gap-2">
          <Input aria-label="Cutscene idea" placeholder="Idea (optional)" value={idea} onChange={(e) => setIdea(e.target.value)} maxLength={300} />
          <Button icon={Sparkles} loading={busy} onClick={suggest}>
            Draft
          </Button>
        </div>
      </div>
      <Sheet
        open={editing}
        onOpenChange={setEditing}
        title="Write a cutscene"
        description="One step per line. Start a line with a name and a colon for dialogue (Mara: Stay close)."
        size="md"
        footer={
          <Button
            variant="primary"
            block
            disabled={!name.trim() || !script.trim()}
            onClick={async () => {
              if (await apply({ type: 'cutscene.add', name: name.trim(), steps: parseSteps(script).slice(0, 40) } as Op, { quiet: true })) {
                setEditing(false);
                setName('');
                setScript('');
              }
            }}
          >
            Save cutscene
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Name" htmlFor="cs-name">
            <Input id="cs-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Steps" htmlFor="cs-steps">
            <Textarea id="cs-steps" value={script} onChange={(e) => setScript(e.target.value)} className="min-h-48" />
          </Field>
        </div>
      </Sheet>
      <Sheet
        open={!!draft}
        onOpenChange={(o) => !o && setDraft(null)}
        title={draft?.name ?? ''}
        description="Drafted from the story. Nothing is added until you say so."
        size="md"
        footer={
          <Button variant="primary" block onClick={() => draft && apply({ type: 'cutscene.add', name: draft.name, steps: draft.steps, source: 'ai' } as Op, { quiet: true }).then((r) => r && setDraft(null))}>
            Add “{draft?.name}”
          </Button>
        }
      >
        <ol className="flex flex-col gap-2 text-sm">
          {draft?.steps.map((x, i) => (
            <li key={i} className="rounded-md bg-surface-2 px-3 py-2">
              {x.speaker ? <span className="font-medium">{x.speaker}: </span> : null}
              {x.text}
              <span className="mt-1 flex flex-wrap gap-1">
                {x.fx ? <Badge>{x.fx}</Badge> : null}
                {x.mood ? <Badge>{x.mood}</Badge> : null}
              </span>
            </li>
          ))}
        </ol>
      </Sheet>
    </div>
  );
}

/** How the stage looks: speech bubbles and which scene effects may play. */
function StageOptions() {
  const settings = useSettings();
  const qc = useQueryClient();
  return (
    <div className="flex flex-col gap-3">
      <section aria-label="Scene effects" className="rounded-md border border-line p-3">
        <h3 className="mb-1 text-sm font-medium">Scene effects</h3>
        <p className="mb-2 text-xs text-fg-2">Effects the story or you can play. Turn off any you'd rather not see; with reduced motion on, they're already gentle.</p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {FX_LIST.map((f) => {
            const off = settings.data?.stage?.fxOff ?? [];
            const on = !off.includes(f.id);
            return (
              <label key={f.id} className="flex min-h-10 items-center gap-2 rounded-md bg-surface-2 px-3 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--accent)]"
                  checked={on}
                  onChange={async (e) => {
                    const next = e.target.checked ? off.filter((x) => x !== f.id) : [...off, f.id];
                    await patch('/api/settings', { stage: { ...settings.data?.stage, fxOff: next } });
                    await qc.invalidateQueries({ queryKey: qk.settings });
                  }}
                />
                {f.label}
              </label>
            );
          })}
        </div>
      </section>
      <ToggleRow
        label="Speech bubbles"
        description="Quoted lines appear as bubbles over the speaker on the stage."
        checked={settings.data?.stage?.bubbles === true}
        onChange={async (v) => {
          await patch('/api/settings', { stage: { ...settings.data?.stage, bubbles: v } });
          await qc.invalidateQueries({ queryKey: qk.settings });
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ sound

function Sound() {
  const { state: s, apply } = useGame();
  const settings = useSettings();
  const qc = useQueryClient();
  const a = settings.data?.audio;
  const media = useQuery({ queryKey: ['media', 'music'], queryFn: () => get<Array<{ id: string; url: string; meta?: Record<string, unknown> }>>('/api/media', { kind: 'music' }) });
  const [plName, setPlName] = useState('');
  const [plMood, setPlMood] = useState('calm');
  if (!a) return null;
  const save = async (p: Partial<typeof a>) => {
    try {
      await patch('/api/settings', { audio: { ...a, ...p } });
      await qc.invalidateQueries({ queryKey: qk.settings });
    } catch (e) {
      toastError(e);
    }
  };
  const now = s?.stage;
  // Places a playlist can belong to: kinds of place in this world (any tavern…), then named places.
  const locs = Object.values(s?.locations ?? {});
  const placeOptions = [
    ...new Map(
      [
        ...[...new Set(locs.map((l) => l.kind))].sort().map((k) => ({ value: k, label: `Any ${k}` })),
        ...locs
          .map((l) => l.name)
          .sort((x, y) => x.localeCompare(y))
          .slice(0, 60)
          .map((n) => ({ value: n, label: n })),
      ].map((o) => [o.value.toLowerCase(), o]),
    ).values(),
  ];
  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Now">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">In this scene</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Music mood" htmlFor="st-mood">
            <Select id="st-mood" value={now?.music.mood ?? ''} onChange={(e) => apply({ type: 'music.set', mood: e.target.value || null } as Op, { quiet: true })}>
              <option value="">Silence</option>
              {MOODS.map((m) => (
                <option key={m} value={m}>
                  {m[0]!.toUpperCase() + m.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ambience" htmlFor="st-amb">
            <Select id="st-amb" value={now?.ambient ?? 'auto'} onChange={(e) => apply({ type: 'ambient.set', kind: e.target.value } as Op, { quiet: true })}>
              {AMBIENT.map((k) => (
                <option key={k} value={k}>
                  {k === 'auto' ? 'Follow the scene' : k[0]!.toUpperCase() + k.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </section>
      <section aria-label="Music" className="flex flex-col gap-2">
        <ToggleRow label="Music" description="Plays the playlist the scene calls for: its mood, the battle playlist in a fight, or one for this place and time of day. Tracks crossfade." checked={a.music} onChange={(v) => save({ music: v })} />
        <Slider label="Music volume" min={0} max={1} step={0.05} value={a.musicVolume} onChange={(v) => save({ musicVolume: v })} />
        <ToggleRow label="Ambience" description="Rain, wind, the city at night… Your own loops if you add them, otherwise generated in the browser." checked={a.ambient} onChange={(v) => save({ ambient: v })} />
        <Slider label="Ambience volume" min={0} max={1} step={0.05} value={a.ambientVolume} onChange={(v) => save({ ambientVolume: v })} />
      </section>
      <section aria-label="Playlists">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">Playlists</h3>
        {a.playlists.length ? (
          <ul className="mb-3 flex flex-col gap-2">
            {a.playlists.map((p) => (
              <li key={p.id} className="rounded-md border border-line p-3">
                <div className="flex items-center gap-2">
                  <Music size={15} className="text-fg-3" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                  <Badge>{p.mood}</Badge>
                  <IconButton size="sm" icon={Trash2} label={`Delete ${p.name}`} onClick={() => save({ playlists: a.playlists.filter((x) => x.id !== p.id) })} />
                </div>
                <p className="mt-1 text-xs text-fg-2">{p.tracks.length} track{p.tracks.length === 1 ? '' : 's'}{p.mood === 'battle' ? ' · plays during battles' : ''}</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Select aria-label={`${p.name}: place`} value={p.place ?? ''} onChange={(e) => save({ playlists: a.playlists.map((x) => (x.id === p.id ? { ...x, place: e.target.value || undefined } : x)) })}>
                    <option value="">Any place</option>
                    {placeOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                  <Select aria-label={`${p.name}: time of day`} value={p.time ?? ''} onChange={(e) => save({ playlists: a.playlists.map((x) => (x.id === p.id ? { ...x, time: (e.target.value || undefined) as 'day' | 'night' | undefined } : x)) })}>
                    <option value="">Any time</option>
                    <option value="day">Day</option>
                    <option value="night">Night</option>
                  </Select>
                </div>
                <FileButton
                  accept="audio/*"
                  multiple
                  size="sm"
                  variant="quiet"
                  icon={Upload}
                  onFiles={async (files) => {
                    try {
                      const ids: string[] = [];
                      for (const f of files) ids.push((await upload<{ id: string }>('/api/media', f, { kind: 'music' })).id);
                      await save({ playlists: a.playlists.map((x) => (x.id === p.id ? { ...x, tracks: [...x.tracks, ...ids] } : x)) });
                      void media.refetch();
                    } catch (e) {
                      toastError(e);
                    }
                  }}
                >
                  Add tracks
                </FileButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-sm text-fg-2">Make a playlist for a mood (or a place, or the night) and add your own music files. Nothing ships with Everloom.</p>
        )}
        <div className="flex gap-2">
          <Input aria-label="Playlist name" placeholder="New playlist" value={plName} onChange={(e) => setPlName(e.target.value)} maxLength={60} />
          <Select aria-label="Playlist mood" value={plMood} onChange={(e) => setPlMood(e.target.value)} className="w-36">
            {MOODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
          <Button disabled={!plName.trim()} onClick={() => save({ playlists: [...a.playlists, { id: `pl_${Date.now().toString(36)}`, name: plName.trim(), mood: plMood, tracks: [] }] }).then(() => setPlName(''))}>
            Add
          </Button>
        </div>
      </section>
      <section aria-label="Ambience loops">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">Your ambience loops</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {AMBIENT.filter((k) => k !== 'auto' && k !== 'none').map((k) => (
            <div key={k} className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm">
              <span className="flex-1 capitalize">{k}</span>
              {a.ambientFiles[k] ? (
                <IconButton size="sm" icon={Trash2} label={`Use generated ${k}`} onClick={() => save({ ambientFiles: { ...a.ambientFiles, [k]: null as unknown as string } })} />
              ) : (
                <FileButton
                  accept="audio/*"
                  size="sm"
                  variant="quiet"
                  icon={Upload}
                  aria-label={`Upload a ${k} loop`}
                  onFiles={async ([f]) => {
                    if (!f) return;
                    try {
                      const r = await upload<{ id: string }>('/api/media', f, { kind: 'ambient' });
                      await save({ ambientFiles: { ...a.ambientFiles, [k]: r.id } });
                    } catch (e) {
                      toastError(e);
                    }
                  }}
                >
                  Own
                </FileButton>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ sprite library

function useCastCharacters(ids: string[]) {
  const { state: s } = useGame();
  const npcCards = Object.values(s?.npcs ?? {})
    .map((n) => n.characterId)
    .filter((x): x is string => !!x);
  const all = [...new Set([...ids, ...npcCards])];
  return useQueries({ queries: all.map((id) => ({ queryKey: qk.character(id), queryFn: () => get<CharacterDTO>(`/api/characters/${id}`) })) })
    .map((q) => q.data)
    .filter((c): c is CharacterDTO => !!c);
}

function Sprites({ chatCharacterIds }: { chatCharacterIds: string[] }) {
  const qc = useQueryClient();
  const settings = useSettings();
  const cast = useCastCharacters(chatCharacterIds);
  const [pick, setPick] = useState<string>('');
  const c = cast.find((x) => x.id === pick) ?? cast[0];
  const setExpr = async (emo: string, mediaId: string | null) => {
    if (!c) return;
    const expressions = { ...(c.game?.expressions ?? {}) };
    if (mediaId) expressions[emo] = mediaId;
    else delete expressions[emo];
    try {
      await patch(`/api/characters/${c.id}`, { game: { ...(c.game ?? {}), expressions } });
      await qc.invalidateQueries({ queryKey: qk.character(c.id) });
    } catch (e) {
      toastError(e);
    }
  };
  // Bulk: files named after an expression ("joy.png", "Sadness.webp") go straight to their slot.
  const bulk = async (files: File[]) => {
    let n = 0;
    for (const f of files) {
      const emo = EMOTIONS.find((e) => f.name.toLowerCase().replace(/\.[a-z0-9]+$/, '') === e);
      if (!emo) continue;
      const r = await upload<{ id: string }>('/api/media', f, { kind: 'expression', characterId: c!.id });
      await setExpr(emo, r.id);
      n++;
    }
    toast({ title: n ? `${n} sprite${n === 1 ? '' : 's'} added` : 'Name files after an expression, like joy.png' });
  };
  if (!cast.length) return <EmptyState title="No characters with cards here" body="Sprites belong to character cards. Link an NPC to a card to give them sprites." />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Character" value={c?.id ?? ''} onChange={(e) => setPick(e.target.value)} className="w-auto min-w-44">
          {cast.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
        <span className="flex-1" />
        <FileButton accept="image/*" multiple icon={Upload} onFiles={(files) => void bulk(files)}>
          Add many
        </FileButton>
      </div>
      {c ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label={`${c.name} sprites`}>
          {EMOTIONS.map((emo) => {
            const id = c.game?.expressions?.[emo];
            return (
              <li key={emo} className="flex flex-col gap-1">
                <span className={cx('relative flex aspect-[3/4] items-end justify-center overflow-hidden rounded-md border', id ? 'border-line' : 'border-dashed border-line-strong')}>
                  {id ? <img src={`/media/${id}`} alt={`${c.name}, ${emo}`} className="absolute inset-0 h-full w-full object-contain object-bottom" /> : null}
                </span>
                <span className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-xs capitalize text-fg-2">{emo}</span>
                  {id ? (
                    <IconButton size="sm" icon={Trash2} label={`Remove ${emo}`} onClick={() => void setExpr(emo, null)} />
                  ) : (
                    <FileButton
                      accept="image/*"
                      size="sm"
                      variant="quiet"
                      icon={Upload}
                      aria-label={`Upload ${emo}`}
                      onFiles={async ([f]) => {
                        if (!f) return;
                        try {
                          await setExpr(emo, (await upload<{ id: string }>('/api/media', f, { kind: 'expression', characterId: c.id })).id);
                        } catch (e) {
                          toastError(e);
                        }
                      }}
                    >
                      {''}
                    </FileButton>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <Live2DSettings c={c} enabled={settings.data?.stage?.live2d === true} />
    </div>
  );
}

function Live2DSettings({ c, enabled }: { c: CharacterDTO | undefined; enabled: boolean }) {
  const qc = useQueryClient();
  const settings = useSettings();
  const info = useQuery({ queryKey: ['live2d'], queryFn: () => get<{ coreInstalled: boolean; models: Record<string, string> }>('/api/live2d'), enabled });
  const setOn = async (v: boolean) => {
    await patch('/api/settings', { stage: { ...settings.data?.stage, live2d: v } });
    await qc.invalidateQueries({ queryKey: qk.settings });
  };
  return (
    <section aria-label="Live2D" className="rounded-md border border-line p-3">
      <ToggleRow label="Live2D (optional)" description="Animated models instead of still sprites. Off unless you turn it on." checked={enabled} onChange={(v) => void setOn(v)} />
      {enabled ? (
        <div className="mt-2 flex flex-col gap-3 text-sm">
          <p className="text-xs text-fg-2">
            Live2D needs the Cubism Core for Web (live2dcubismcore.min.js). It isn't open source, so Everloom can't include it: download it from Live2D's website under their license and upload it here. It stays on your server.
          </p>
          <div className="flex items-center gap-2">
            <Badge tone={info.data?.coreInstalled ? 'success' : 'neutral'}>{info.data?.coreInstalled ? 'Cubism Core installed' : 'No Cubism Core yet'}</Badge>
            <span className="flex-1" />
            <FileButton
              accept=".js,text/javascript"
              size="sm"
              icon={Upload}
              onFiles={async ([f]) => {
                if (!f) return;
                try {
                  await post('/api/live2d/core', { source: await f.text() });
                  await info.refetch();
                } catch (e) {
                  toastError(e);
                }
              }}
            >
              Upload core
            </FileButton>
          </div>
          {c ? (
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{info.data?.models[c.id] ? `${c.name} has a model` : `No model for ${c.name}`}</span>
              {info.data?.models[c.id] ? (
                <IconButton size="sm" icon={Trash2} label={`Remove ${c.name}'s model`} onClick={async () => (await del(`/api/live2d/models/${c.id}`), void info.refetch())} />
              ) : null}
              <FileButton
                accept=".zip,application/zip"
                size="sm"
                icon={Upload}
                onFiles={async ([f]) => {
                  if (!f) return;
                  try {
                    await post(`/api/live2d/models/${c.id}`, { zip: await toBase64(f) });
                    await info.refetch();
                  } catch (e) {
                    toastError(e);
                  }
                }}
              >
                Upload model (.zip)
              </FileButton>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------ voices

interface RefVoice {
  id: string;
  name: string;
  consentAt: number;
  url: string;
}

function Voices({ chatCharacterIds }: { chatCharacterIds: string[] }) {
  const qc = useQueryClient();
  const cast = useCastCharacters(chatCharacterIds);
  const presets = useQuery({ queryKey: ['tts-voices'], queryFn: () => get<{ voices: Array<{ id: string; name: string }> }>('/api/tts/voices') });
  const refs = useQuery({ queryKey: ['ref-voices'], queryFn: () => get<RefVoice[]>('/api/voices') });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const setVoice = async (c: CharacterDTO, value: string) => {
    const [kind, id] = value.split(':') as ['preset' | 'custom' | '', string];
    const voice = kind === 'custom' ? { ...(c.game?.voice ?? {}), kind: 'custom' as const, reference: id, voice: undefined } : kind === 'preset' ? { ...(c.game?.voice ?? {}), kind: 'preset' as const, voice: id, reference: undefined } : undefined;
    try {
      await patch(`/api/characters/${c.id}`, { game: { ...(c.game ?? {}), voice } });
      await qc.invalidateQueries({ queryKey: qk.character(c.id) });
    } catch (e) {
      toastError(e);
    }
  };
  const test = async (c: CharacterDTO) => {
    const v = c.game?.voice;
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': (await (await fetch('/api/auth/status')).json()).csrf },
        body: JSON.stringify({ text: `Hello, I'm ${c.name}.`, voice: v?.kind !== 'custom' ? v?.voice : undefined, reference: v?.kind === 'custom' ? v.reference : undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Voice failed (${res.status})`);
      void new Audio(URL.createObjectURL(await res.blob())).play();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Character voices" className="flex flex-col gap-2">
        {cast.map((c) => {
          const v = c.game?.voice;
          const value = v?.kind === 'custom' && v.reference ? `custom:${v.reference}` : v?.voice ? `preset:${v.voice}` : '';
          return (
            <div key={c.id} className="flex items-center gap-2">
              <span className="w-28 flex-none truncate text-sm font-medium">{c.name}</span>
              <Select aria-label={`${c.name}'s voice`} value={value} onChange={(e) => void setVoice(c, e.target.value)} className="min-w-0 flex-1">
                <option value="">Default voice</option>
                <optgroup label="Preset voices">
                  {(presets.data?.voices ?? []).map((p) => (
                    <option key={p.id} value={`preset:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
                {refs.data?.length ? (
                  <optgroup label="Your reference voices">
                    {refs.data.map((r) => (
                      <option key={r.id} value={`custom:${r.id}`}>
                        {r.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </Select>
              <IconButton icon={Volume2} label={`Hear ${c.name}`} onClick={() => void test(c)} />
            </div>
          );
        })}
      </section>
      <section aria-label="Reference voices">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-3">Your reference voices</h3>
        <p className="mb-2 text-xs text-fg-2">
          A short, clean sample for voice servers that clone from reference audio (XTTS, F5 and similar; turn on “Accepts reference audio” for that connection). Kept apart from preset voices.
        </p>
        {refs.data?.length ? (
          <ul className="mb-2 flex flex-col gap-1">
            {refs.data.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{r.name}</span>
                <span className="text-xs text-fg-3">consent {new Date(r.consentAt).toLocaleDateString()}</span>
                <IconButton size="sm" icon={Trash2} label={`Delete ${r.name}`} onClick={async () => (await del(`/api/voices/${r.id}`), void refs.refetch())} />
              </li>
            ))}
          </ul>
        ) : null}
        <Button variant="secondary" icon={Plus} onClick={() => setAdding(true)}>
          Add a reference voice
        </Button>
      </section>
      <Sheet
        open={adding}
        onOpenChange={setAdding}
        title="Add a reference voice"
        size="md"
        footer={
          <Button
            variant="primary"
            block
            disabled={!name.trim() || !file || !consent}
            onClick={async () => {
              try {
                await post('/api/voices', { name: name.trim(), data: await toBase64(file!), consent: true });
                setAdding(false);
                setName('');
                setFile(null);
                setConsent(false);
                void refs.refetch();
              } catch (e) {
                toastError(e);
              }
            }}
          >
            Add voice
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Name" htmlFor="rv-name">
            <Input id="rv-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </Field>
          <FileButton accept="audio/*" icon={Upload} onFiles={([f]) => setFile(f ?? null)}>
            {file ? file.name : 'Choose an audio sample'}
          </FileButton>
          <label className="flex items-start gap-3 rounded-md bg-surface-2 p-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 flex-none accent-[var(--accent)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              This is my own voice, or I have the speaker's permission to use it this way. I won't use it to pass as someone, and I'll respect the voice server's own terms.
            </span>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
