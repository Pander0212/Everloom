import { useQueryClient } from '@tanstack/react-query';
import { Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { post } from '@/lib/api';
import { useCharacters, useGroups, usePersonas, useSettings } from '@/lib/queries';
import { FEATURE_PRESETS, PRESET_INFO, type FeaturePreset } from '@everloom/engine';
import { toastError } from '@/lib/store';
import { Avatar, Button, EmptyState, Field, Icon, Input, ListRow, Segmented, Select, Sheet } from '@/ui';

export function NewChatSheet({ open, onOpenChange, characterId }: { open: boolean; onOpenChange: (o: boolean) => void; characterId?: string }) {
  const chars = useCharacters();
  const groups = useGroups();
  const personas = usePersonas();
  const [kind, setKind] = useState<'character' | 'group'>('character');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(characterId ?? null);
  const [personaId, setPersonaId] = useState<string>('');
  const [mode, setMode] = useState<'' | FeaturePreset>('');
  const settings = useSettings();
  const global = settings.data?.features.preset ?? 'full';
  // Ask only when the character has no default mode of its own.
  const pickedChar = kind === 'character' ? chars.data?.find((c) => c.id === picked) : null;
  const charDefault = pickedChar?.chatMode ?? null;
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useMemo(() => {
    const items = kind === 'character' ? (chars.data ?? []).map((c) => ({ id: c.id, name: c.name, avatar: c.avatar, sub: c.tags.slice(0, 3).join(', ') })) : (groups.data ?? []).map((g) => ({ id: g.id, name: g.name, avatar: g.avatar, sub: `${g.members.length} members` }));
    const n = q.trim().toLowerCase();
    return n ? items.filter((i) => i.name.toLowerCase().includes(n)) : items;
  }, [kind, chars.data, groups.data, q]);
  const start = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      const chat = await post('/api/chats', { [kind === 'character' ? 'characterId' : 'groupId']: picked, personaId: personaId || undefined, ...(mode ? { features: mode } : {}) });
      await qc.invalidateQueries({ queryKey: ['chats'] });
      onOpenChange(false);
      navigate(`/chat/${chat.id}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="New chat"
      size="lg"
      footer={
        <Button variant="primary" size="lg" block disabled={!picked} loading={busy} onClick={start}>
          Start chat
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {!characterId ? (
          <Segmented
            label="Chat type"
            value={kind}
            onChange={(v) => {
              setKind(v);
              setPicked(null);
            }}
            options={[
              { value: 'character', label: 'Character' },
              { value: 'group', label: 'Group' },
            ]}
          />
        ) : null}
        {!characterId ? (
          <div className="relative">
            <Icon icon={Search} size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
            <Input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" aria-label="Search" />
          </div>
        ) : null}
        {!characterId ? (
          list.length ? (
            <div className="flex flex-col">
              {list.map((i) => (
                <ListRow key={i.id} title={i.name} subtitle={i.sub || undefined} leading={<Avatar src={i.avatar} name={i.name} />} onClick={() => setPicked(i.id)} active={picked === i.id} />
              ))}
            </div>
          ) : (
            <EmptyState icon={Users} title={kind === 'character' ? 'No characters yet' : 'No groups yet'} body={kind === 'character' ? 'Import a card or create a character first.' : 'Create a group from the Characters tab.'} />
          )
        ) : null}
        {charDefault ? null : (
          <Field label="Mode" htmlFor="newchat-mode" hint="Classic is a plain roleplay chat; Story adds memory and the stage; Full RPG adds the whole game.">
            <Select id="newchat-mode" value={mode} onChange={(e) => setMode(e.target.value as '' | FeaturePreset)}>
              <option value="">{global === 'custom' ? 'My feature settings' : `${PRESET_INFO[global].label} (from Settings)`}</option>
              {FEATURE_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {PRESET_INFO[p].label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Play as" htmlFor="persona">
          <Select id="persona" value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
            <option value="">Default persona</option>
            {(personas.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.title ? ` — ${p.title}` : ''}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Sheet>
  );
}
