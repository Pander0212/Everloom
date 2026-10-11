/**
 * Quickstart: a whole new story from a short idea or a genre (docs/ux/hakawati.md). Each step shows
 * as it happens, with a timer; Cancel stops it, removes anything half-made and keeps what you typed.
 */
import { defaultNewGame, PRESET_INFO, type FeaturePreset, type NewGameConfig } from '@everloom/engine';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { del, post } from '@/lib/api';
import { cx } from '@/lib/format';
import { useSettings } from '@/lib/queries';
import { toastError } from '@/lib/store';
import { Button, Field, Icon, Segmented, Sheet, Textarea } from '@/ui';

const GENRES = ['Fantasy', 'Science fiction', 'Mystery', 'Romance', 'Horror', 'Slice of life', 'Adventure', 'Post-apocalyptic'];

interface Draft {
  card: { name: string; description: string; personality: string; scenario: string; first_mes: string; tags: string[] };
  premise: string;
  style: NewGameConfig['style'];
}

type Step = { id: string; label: string; state: 'waiting' | 'running' | 'done' };

export function QuickstartSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const settings = useSettings();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const preset = settings.data?.features.preset;
  const [idea, setIdea] = useState('');
  const [genre, setGenre] = useState<string>('');
  const [mode, setMode] = useState<FeaturePreset>(preset === 'classic' || preset === 'full' ? preset : 'story');
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(0);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!steps) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [steps]);

  const mark = (id: string, state: Step['state']) => setSteps((s) => s?.map((x) => (x.id === id ? { ...x, state } : x)) ?? null);

  const run = async () => {
    const game = mode !== 'classic';
    const plan: Step[] = [
      { id: 'draft', label: 'Writing the character and the opening', state: 'waiting' },
      { id: 'character', label: 'Making the character', state: 'waiting' },
      { id: 'chat', label: 'Starting the chat', state: 'waiting' },
      ...(game ? [{ id: 'world', label: 'Building the world', state: 'waiting' as const }] : []),
    ];
    setSteps(plan);
    setStarted(Date.now());
    setNow(Date.now());
    const ctrl = new AbortController();
    abort.current = ctrl;
    const made: { character?: string; chat?: string } = {};
    const opts = { signal: ctrl.signal };
    try {
      mark('draft', 'running');
      const draft = await post<Draft>('/api/quickstart/draft', { idea, genre, mode }, opts);
      mark('draft', 'done');
      mark('character', 'running');
      const ch = await post<{ id: string }>('/api/characters', { card: { ...draft.card, creator_notes: 'Made with Quickstart.' } }, opts);
      made.character = ch.id;
      mark('character', 'done');
      mark('chat', 'running');
      const chat = await post<{ id: string; campaignId: string | null }>('/api/chats', { characterId: ch.id, features: mode }, opts);
      made.chat = chat.id;
      mark('chat', 'done');
      if (game && chat.campaignId) {
        mark('world', 'running');
        const base: NewGameConfig = { ...defaultNewGame(Math.floor(Math.random() * 1e6)), title: draft.card.name, style: draft.style };
        const filled = await post<{ config: NewGameConfig }>('/api/newgame/fill', { config: base, premise: `${draft.premise}\n${draft.card.scenario}` }, opts);
        await post(`/api/chats/${chat.id}/newgame`, { config: filled.config, opening: false }, opts);
        mark('world', 'done');
      }
      await qc.invalidateQueries({ queryKey: ['chats'] });
      await qc.invalidateQueries({ queryKey: ['characters'] });
      onOpenChange(false);
      setSteps(null);
      navigate(`/chat/${chat.id}`);
    } catch (e) {
      // Cancelled or failed: nothing half-made stays behind; the idea and choices do.
      if (made.chat) await del(`/api/chats/${made.chat}`).catch(() => {});
      if (made.character) await del(`/api/characters/${made.character}`).catch(() => {});
      setSteps(null);
      if (!ctrl.signal.aborted) toastError(e);
    } finally {
      abort.current = null;
    }
  };

  const running = !!steps;
  const secs = running ? Math.max(0, Math.round((now - started) / 1000)) : 0;
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o && running) abort.current?.abort();
        onOpenChange(o);
      }}
      title="Quickstart"
      description="A new story from an idea: a character, the opening scene and, for a game, the world."
      help="Write an idea (or pick a genre) and Everloom writes a character to meet, an opening scene and, in Story or Full RPG, the world around it. It takes a minute or so. Cancel any time: nothing half-made is kept, and your idea stays here. Example: “A lighthouse keeper who hears the sea talk.”"
      size="md"
      footer={
        running ? (
          <Button variant="secondary" size="lg" block icon={X} onClick={() => abort.current?.abort()}>
            Cancel
          </Button>
        ) : (
          <Button variant="primary" size="lg" block icon={Sparkles} disabled={!idea.trim() && !genre} onClick={() => void run()}>
            Start the story
          </Button>
        )
      }
    >
      {running ? (
        <div className="flex flex-col gap-4 py-2" role="status" aria-live="polite">
          <p className="text-sm text-fg-2">
            Working… <span className="tabular-nums">{secs}s</span>
          </p>
          <ol className="flex flex-col gap-2" aria-label="Progress">
            {steps!.map((s) => (
              <li key={s.id} className={cx('flex items-center gap-2.5 text-sm', s.state === 'waiting' ? 'text-fg-3' : 'text-fg')}>
                {s.state === 'done' ? <Icon icon={Check} size={16} className="text-success" /> : s.state === 'running' ? <Icon icon={Loader2} size={16} className="animate-spin text-accent-text" /> : <span className="size-4 rounded-full border border-line-strong" />}
                {s.label}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Your idea" htmlFor="qs-idea" hint="A sentence is enough. Leave it empty and pick a genre to be surprised.">
            <Textarea id="qs-idea" rows={3} maxLength={2000} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="A lighthouse keeper who hears the sea talk…" />
          </Field>
          <Field label="Genre">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Genre">
              {GENRES.map((g) => (
                <button key={g} role="radio" aria-checked={genre === g} onClick={() => setGenre(genre === g ? '' : g)} className={cx('pressable h-9 rounded-full px-3.5 text-sm', genre === g ? 'bg-accent-soft font-medium text-accent-text' : 'bg-surface-2 text-fg-2')}>
                  {g}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Mode" hint={PRESET_INFO[mode].description}>
            <Segmented label="Mode" value={mode} onChange={setMode} options={(['classic', 'story', 'full'] as const).map((p) => ({ value: p, label: PRESET_INFO[p].label }))} />
          </Field>
        </div>
      )}
    </Sheet>
  );
}
