import type { ConnectionDTO } from '@everloom/engine';
import { AudioLines, Bot, Image, Plus } from 'lucide-react';
import { useState } from 'react';
import { useConnections } from '@/lib/queries';
import { Badge, Button, Field, Icon, ListRow, Select } from '@/ui';
import { ConnectionSheet, PRESETS } from '../ConnectionSheet';
import { Section, useSettingsPatch } from '../common';

const GROUPS = [
  { id: 'llm' as const, title: 'Language models', icon: Bot, match: (p: string) => ['openai', 'anthropic', 'gemini', 'textgen'].includes(p) },
  { id: 'tts' as const, title: 'Voice', icon: AudioLines, match: (p: string) => p.startsWith('tts-') },
  { id: 'image' as const, title: 'Images', icon: Image, match: (p: string) => p.startsWith('img-') },
];

export default function ConnectionsSection() {
  const conns = useConnections();
  const { settings, update } = useSettingsPatch();
  const [edit, setEdit] = useState<{ c: ConnectionDTO | null; group: 'llm' | 'tts' | 'image' } | null>(null);
  const list = conns.data ?? [];
  const llms = list.filter((c) => GROUPS[0].match(c.provider));
  const label = (c: ConnectionDTO) => PRESETS.find((p) => p.provider === c.provider && p.baseUrl === c.baseUrl)?.label ?? c.provider;
  const roleBadge = (c: ConnectionDTO) => {
    const r = settings?.roles;
    if (!r) return null;
    const roles = [r.main === c.id && 'Main', r.utility === c.id && 'Utility', r.tts === c.id && 'Voice', r.image === c.id && 'Images', r.embeddings === c.id && 'Embeddings'].filter(Boolean) as string[];
    return roles.length ? <Badge tone="accent">{roles.join(' · ')}</Badge> : null;
  };
  const roleSelect = (key: 'main' | 'utility' | 'embeddings' | 'tts' | 'image', label2: string, options: ConnectionDTO[], hint: string, emptyLabel: string) => (
    <Field label={label2} htmlFor={`role-${key}`} hint={hint}>
      <Select id={`role-${key}`} value={settings?.roles[key] ?? ''} onChange={(e) => update({ roles: { [key]: e.target.value || null } })}>
        <option value="">{emptyLabel}</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.model ? ` — ${c.model}` : ''}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <>
      {GROUPS.map((g) => {
        const items = list.filter((c) => g.match(c.provider));
        return (
          <Section
            key={g.id}
            title={g.title}
            action={
              <Button size="sm" variant="secondary" icon={Plus} onClick={() => setEdit({ c: null, group: g.id })}>
                Add
              </Button>
            }
          >
            {items.length ? (
              <div className="flex flex-col">
                {items.map((c) => (
                  <ListRow key={c.id} leading={<Icon icon={g.icon} className="text-fg-3" />} title={c.name} subtitle={[label(c), c.model].filter(Boolean).join(' · ')} trailing={roleBadge(c)} chevron onClick={() => setEdit({ c, group: g.id })} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-fg-2">{g.id === 'llm' ? 'Add at least one model to start chatting.' : g.id === 'tts' ? 'Optional. Without one, the browser voice is used.' : 'Optional. Pollinations works without a key.'}</p>
            )}
          </Section>
        );
      })}
      <Section title="Roles" description="The main model writes the story. The utility model handles trackers, summaries and generators — pick something cheap and fast.">
        <div className="flex flex-col gap-4">
          {roleSelect('main', 'Main model', llms, 'Used for story replies.', 'First connection')}
          {roleSelect('utility', 'Utility model', llms, 'Falls back to the main model.', 'Same as main model')}
          {roleSelect('embeddings', 'Embeddings', llms.filter((c) => c.provider !== 'anthropic'), 'For semantic lorebook retrieval.', 'Same as main model')}
          {roleSelect('tts', 'Voice', list.filter((c) => c.provider.startsWith('tts-')), 'Used when voice provider is set to a connection.', 'None')}
          {roleSelect('image', 'Images', list.filter((c) => c.provider.startsWith('img-')), 'Portraits, sprites, backgrounds.', 'None')}
        </div>
      </Section>
      <ConnectionSheet open={!!edit} onOpenChange={(o) => !o && setEdit(null)} connection={edit?.c ?? null} group={edit?.group ?? 'llm'} />
    </>
  );
}
