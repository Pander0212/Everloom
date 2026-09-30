import { STUDIO_PRESETS } from '@everloom/engine';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useCharacters, useConnections } from '@/lib/queries';
import { Avatar, Button, Field, IconButton, Input, Select, Sheet, Textarea } from '@/ui';
import { useSettingsPatch } from '../settings/common';

const LLM = ['openai', 'anthropic', 'gemini', 'textgen'];

export function CharacterPicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (id: string) => void }) {
  const chars = useCharacters();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (chars.data ?? []).filter((c) => !t || c.name.toLowerCase().includes(t) || (c.displayName ?? '').toLowerCase().includes(t)).slice(0, 60);
  }, [chars.data, q]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Start from a character" description="Its card becomes the draft. Saving can overwrite it (keeping a snapshot) or make a new character." size="md">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search characters" aria-label="Search characters to start from" autoFocus />
      <ul className="mt-3 flex flex-col" aria-label="Characters to start from">
        {list.map((c) => (
          <li key={c.id}>
            <button className="pressable flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-2" onClick={() => onPick(c.id)}>
              <Avatar src={c.avatar} name={c.name} size="sm" shape="rounded" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.displayName || c.name}</span>
            </button>
          </li>
        ))}
        {!list.length ? <li className="py-6 text-center text-sm text-fg-2">No characters match.</li> : null}
      </ul>
    </Sheet>
  );
}

export function StudioSettings({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { settings, update } = useSettingsPatch();
  const conns = useConnections();
  const llms = (conns.data ?? []).filter((c) => LLM.includes(c.provider));
  if (!settings) return null;
  const studio = settings.studio;
  const custom = studio.presets;
  const setPresets = (presets: typeof custom) => update({ studio: { presets } });
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Studio settings" size="md">
      <div className="flex flex-col gap-5">
        <Field label="Model" htmlFor="studio-conn" hint="Card writing works best with your strongest model.">
          <Select id="studio-conn" value={studio.connection ?? ''} onChange={(e) => update({ studio: { connection: e.target.value || null } })}>
            <option value="">Main connection</option>
            {llms.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.model ? ` — ${c.model}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Style" htmlFor="studio-preset" hint="The system prompt the studio uses.">
          <Select id="studio-preset" value={studio.preset} onChange={(e) => update({ studio: { preset: e.target.value } })}>
            {[...STUDIO_PRESETS, ...custom].map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Your system prompts</p>
            <Button
              size="sm"
              icon={Plus}
              onClick={() => {
                const cur = [...STUDIO_PRESETS, ...custom].find((p) => p.id === studio.preset) ?? STUDIO_PRESETS[0]!;
                const id = `p${Date.now().toString(36)}`;
                void update({ studio: { presets: [...custom, { id, name: `${cur.name} (mine)`, system: cur.system }], preset: id } });
              }}
            >
              New
            </Button>
          </div>
          {custom.length ? (
            custom.map((p) => (
              <div key={p.id} className="flex flex-col gap-2 rounded-md border border-line p-3">
                <div className="flex items-center gap-2">
                  <Input defaultValue={p.name} aria-label="Prompt name" onBlur={(e) => e.target.value.trim() && e.target.value !== p.name && setPresets(custom.map((x) => (x.id === p.id ? { ...x, name: e.target.value.trim().slice(0, 60) } : x)))} />
                  <IconButton
                    size="sm"
                    icon={Trash2}
                    label={`Delete ${p.name}`}
                    onClick={() => update({ studio: { presets: custom.filter((x) => x.id !== p.id), ...(studio.preset === p.id ? { preset: 'balanced' } : {}) } })}
                  />
                </div>
                <Textarea defaultValue={p.system} rows={4} maxRows={14} aria-label={`${p.name} system prompt`} onBlur={(e) => e.target.value !== p.system && setPresets(custom.map((x) => (x.id === p.id ? { ...x, system: e.target.value.slice(0, 8000) } : x)))} />
              </div>
            ))
          ) : (
            <p className="text-sm text-fg-2">Copy a style to make your own: set the voice, length, or house rules the studio should follow.</p>
          )}
        </div>
      </div>
    </Sheet>
  );
}
