/**
 * The story panel (docs/ux/hakawati.md): what shapes this story, in five tabs: Story (the note to
 * the AI and the memory), Cards (story cards), Character (who you meet and who you play), AI (the
 * model and how hard it thinks) and Display (theme and reading). Beside the story on a desktop,
 * resizable; a bottom sheet on a phone.
 */
import type { ChatDTO, ConnectionDTO } from '@everloom/engine';
import { useQueryClient } from '@tanstack/react-query';
import { GripVertical, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { patch, put } from '@/lib/api';
import { applyReading, applyTextSize } from '@/lib/theme';
import { qk, useCharacter, useConnections, usePersonas, useSettings } from '@/lib/queries';
import { toastError } from '@/lib/store';
import { Button, Field, IconButton, Segmented, Select, Sheet, Slider, Tabs, Textarea, useDesktop } from '@/ui';
import { LOOKS } from '@/themes/looks';
import { useSettingsPatch } from '../settings/common';
import { StoryCards } from './StoryCards';

const KEY = 'everloom.storyPanel';
type Tab = 'story' | 'cards' | 'character' | 'ai' | 'display';

export function StoryPanel({ chat, open, onOpenChange, onOpenSheet, want }: { chat: ChatDTO; open: boolean; onOpenChange: (o: boolean) => void; onOpenSheet: (s: 'memory' | 'inspector') => void; /** Open at this tab (from the palette). */ want?: { tab: Tab; n: number } | null }) {
  const desktop = useDesktop();
  const [tab, setTab] = useState<Tab>('story');
  useEffect(() => {
    if (want) setTab(want.tab);
  }, [want]);
  const body = (
    <Tabs
      value={tab}
      onChange={(v) => setTab(v as Tab)}
      tabs={[
        { value: 'story', label: 'Story' },
        { value: 'cards', label: 'Cards' },
        { value: 'character', label: 'Character' },
        { value: 'ai', label: 'AI' },
        { value: 'display', label: 'Display' },
      ]}
    >
      <div className="pt-3">
        {tab === 'story' ? <StoryTab chat={chat} onOpenSheet={onOpenSheet} /> : null}
        {tab === 'cards' ? <StoryCards chat={chat} /> : null}
        {tab === 'character' ? <CharacterTab chat={chat} /> : null}
        {tab === 'ai' ? <AiTab chat={chat} onOpenSheet={onOpenSheet} /> : null}
        {tab === 'display' ? <DisplayTab chat={chat} /> : null}
      </div>
    </Tabs>
  );
  if (!desktop) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title="Story panel" size="lg" help="What shapes this story, in one place: the note to the AI and the memory, story cards, the characters, the model and how it looks.">
        {body}
      </Sheet>
    );
  }
  if (!open) return null;
  return <Aside onClose={() => onOpenChange(false)}>{body}</Aside>;
}

/** A side panel whose width you drag (kept on this device). */
function Aside({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const [width, setWidth] = useState(() => {
    try {
      return Math.min(640, Math.max(300, Number(localStorage.getItem(KEY)) || 380));
    } catch {
      return 380;
    }
  });
  const drag = useRef<{ x: number; w: number } | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, String(width));
    } catch {
      /* private mode */
    }
  }, [width]);
  return (
    <aside aria-label="Story panel" className="relative flex h-full flex-none flex-col border-l border-line bg-surface" style={{ width }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the story panel"
        aria-valuenow={width}
        aria-valuemin={300}
        aria-valuemax={640}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setWidth((w) => Math.min(640, w + 20));
          if (e.key === 'ArrowRight') setWidth((w) => Math.max(300, w - 20));
        }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, w: width };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => drag.current && setWidth(Math.min(640, Math.max(300, drag.current.w - (e.clientX - drag.current.x))))}
        onPointerUp={() => (drag.current = null)}
        className="absolute -left-1.5 top-0 z-10 flex h-full w-3 cursor-col-resize items-center justify-center opacity-0 hover:opacity-100 focus-visible:opacity-100"
      >
        <GripVertical size={14} className="text-fg-3" />
      </div>
      <div className="flex items-center gap-2 px-4 pb-1 pt-3">
        <h2 className="flex-1 text-base font-semibold">Story panel</h2>
        <IconButton icon={X} label="Close the story panel" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
    </aside>
  );
}

function StoryTab({ chat, onOpenSheet }: { chat: ChatDTO; onOpenSheet: (s: 'memory') => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState(chat.metadata.authorsNote?.content ?? '');
  useEffect(() => setNote(chat.metadata.authorsNote?.content ?? ''), [chat.id, chat.metadata.authorsNote?.content]);
  const save = async () => {
    try {
      const c = await patch(`/api/chats/${chat.id}`, { metadata: { authorsNote: { content: note, depth: chat.metadata.authorsNote?.depth ?? 4, role: chat.metadata.authorsNote?.role ?? 'system' } } });
      qc.setQueryData(qk.chat(chat.id), (x: any) => ({ ...x, ...c }));
    } catch (e) {
      toastError(e);
    }
  };
  const memory = chat.metadata.memory?.text ?? '';
  return (
    <div className="flex flex-col gap-4">
      <Field label="Note to the AI" htmlFor="sp-note" hint="A standing instruction read with every reply, like “keep it short” or “it is raining all day”.">
        <Textarea id="sp-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (chat.metadata.authorsNote?.content ?? '') && void save()} />
      </Field>
      <section>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-medium">Memory</h3>
          <Button size="sm" variant="quiet" onClick={() => onOpenSheet('memory')}>
            Open memory
          </Button>
        </div>
        <p className="whitespace-pre-wrap text-sm text-fg-2">{memory || 'Nothing summarized yet. The story writes its memory as it goes.'}</p>
      </section>
    </div>
  );
}

function CharacterTab({ chat }: { chat: ChatDTO }) {
  const ch = useCharacter(chat.characterId);
  const personas = usePersonas();
  const persona = personas.data?.find((p) => p.id === chat.personaId);
  return (
    <div className="flex flex-col gap-4">
      {ch.data ? (
        <section>
          <h3 className="text-sm font-medium">{ch.data.name}</h3>
          <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-sm text-fg-2">{ch.data.card.description}</p>
          {ch.data.card.scenario ? <p className="mt-2 text-sm text-fg-2"><span className="font-medium text-fg">Scenario: </span>{ch.data.card.scenario}</p> : null}
          <Link to={`/characters/${ch.data.id}`} className="mt-2 inline-block text-sm font-medium text-accent-text">
            Edit {ch.data.name}
          </Link>
        </section>
      ) : (
        <p className="text-sm text-fg-2">A group chat: each member's card is in Characters.</p>
      )}
      <section>
        <h3 className="text-sm font-medium">You play</h3>
        <p className="text-sm text-fg-2">{persona ? `${persona.name}${persona.title ? ` — ${persona.title}` : ''}` : 'Your default persona'}. Change it in This chat.</p>
      </section>
    </div>
  );
}

const LEVELS = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

function AiTab({ chat, onOpenSheet }: { chat: ChatDTO; onOpenSheet: (s: 'inspector') => void }) {
  const qc = useQueryClient();
  const conns = useConnections();
  const settings = useSettings();
  const llms = (conns.data ?? []).filter((c) => ['openai', 'anthropic', 'gemini', 'textgen'].includes(c.provider));
  const id = (chat.metadata.connectionId as string | null | undefined) ?? settings.data?.roles.main ?? null;
  const conn = llms.find((c) => c.id === id) ?? null;
  const level: (typeof LEVELS)[number]['value'] = !conn?.params.reasoning ? 'off' : (conn.params.reasoning_effort ?? 'medium');
  const setModel = async (v: string) => {
    try {
      const c = await patch(`/api/chats/${chat.id}`, { metadata: { connectionId: v || null } });
      qc.setQueryData(qk.chat(chat.id), (x: any) => ({ ...x, ...c }));
    } catch (e) {
      toastError(e);
    }
  };
  // Thinking is saved with the connection, so per provider and model.
  const setLevel = async (v: (typeof LEVELS)[number]['value']) => {
    if (!conn) return;
    try {
      const params = { ...conn.params, reasoning: v !== 'off', ...(v !== 'off' ? { reasoning_effort: v } : {}) };
      await put<ConnectionDTO>(`/api/connections/${conn.id}`, { name: conn.name, provider: conn.provider, baseUrl: conn.baseUrl, model: conn.model, params });
      await qc.invalidateQueries({ queryKey: qk.connections });
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <Field label="Model" htmlFor="sp-model" hint="For this chat. The main model is set in Settings › Models & connections.">
        <Select id="sp-model" value={(chat.metadata.connectionId as string | null | undefined) ?? ''} onChange={(e) => void setModel(e.target.value)}>
          <option value="">Main model</option>
          {llms.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.model ? ` — ${c.model}` : ''}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Thinking" hint={conn ? `How long ${conn.name} thinks before it writes, for models that can. Saved with this model, for every chat that uses it.` : 'Add a model first.'}>
        <Segmented label="Thinking" value={level} onChange={(v) => void setLevel(v)} options={LEVELS.map((l) => ({ value: l.value, label: l.label }))} />
      </Field>
      <Button variant="secondary" onClick={() => onOpenSheet('inspector')}>
        Everything sent to the AI
      </Button>
    </div>
  );
}

function DisplayTab({ chat }: { chat: ChatDTO }) {
  const qc = useQueryClient();
  const { settings, update } = useSettingsPatch();
  if (!settings) return null;
  const reading = settings.look?.reading ?? { leading: 1.6, width: 760, paragraph: 0.75, storyFont: null, uiFont: null };
  const setReading = (p: Partial<typeof reading>) => {
    const next = { ...reading, ...p };
    applyReading(next);
    void update({ look: { reading: next } });
  };
  const setLook = async (v: string) => {
    try {
      const c = await patch(`/api/chats/${chat.id}`, { metadata: { look: v || null } });
      qc.setQueryData(qk.chat(chat.id), (x: any) => ({ ...x, ...c }));
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <Field label="Theme for this world" htmlFor="sp-look">
        <Select id="sp-look" value={(chat.metadata.look as string | null | undefined) ?? ''} onChange={(e) => void setLook(e.target.value)}>
          <option value="">My theme</option>
          {LOOKS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Text size">
        <Segmented
          label="Text size"
          value={settings.textSize}
          onChange={(v) => {
            applyTextSize(v);
            void update({ textSize: v });
          }}
          options={[
            { value: 'small', label: 'S' },
            { value: 'medium', label: 'M' },
            { value: 'large', label: 'L' },
            { value: 'xlarge', label: 'XL' },
          ]}
        />
      </Field>
      <Field label={`Line spacing: ${reading.leading.toFixed(2)}`}>
        <Slider label="Line spacing" min={1.3} max={2.1} step={0.05} value={reading.leading} onChange={(v) => setReading({ leading: v })} />
      </Field>
      <Link to="/settings/appearance" className="text-sm font-medium text-accent-text">
        All themes and reading settings
      </Link>
    </div>
  );
}
