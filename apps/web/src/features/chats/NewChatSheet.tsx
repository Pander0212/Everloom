import { useQueryClient } from '@tanstack/react-query';
import { Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { post } from '@/lib/api';
import { useCharacter, useCharacters, useGroups, usePersonas, useSettings } from '@/lib/queries';
import { cardQuestions, FEATURE_PRESETS, PRESET_INFO, validAnswer, type FeaturePreset } from '@everloom/engine';
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
  // Scenario questions in the card (${…}): asked here, filled into this chat's copy.
  const detail = useCharacter(kind === 'character' ? picked : null);
  const questions = useMemo(() => (detail.data ? cardQuestions(detail.data.card) : []), [detail.data]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const unanswered = questions.filter((q) => !validAnswer(q, answers[q.key]));
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
      const filled = questions.length ? Object.fromEntries(questions.map((q) => [q.key, answers[q.key]!.trim()])) : undefined;
      const chat = await post('/api/chats', { [kind === 'character' ? 'characterId' : 'groupId']: picked, personaId: personaId || undefined, ...(mode ? { features: mode } : {}), ...(filled ? { answers: filled } : {}) });
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
        <Button variant="primary" size="lg" block disabled={!picked || unanswered.length > 0} loading={busy} onClick={start}>
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
        {questions.length ? (
          <section aria-label="Before you start" className="flex flex-col gap-3 rounded-md bg-surface-2 p-3">
            <div>
              <h3 className="text-sm font-semibold">Before you start</h3>
              <p className="text-xs text-fg-2">This story asks {questions.length === 1 ? 'one question' : `${questions.length} questions`}. Your answers go into this chat only; the character stays as it is.</p>
            </div>
            {questions.map((qq, i) => (
              <Field key={qq.key} label={qq.text} htmlFor={`q-${i}`}>
                {qq.fixed ? (
                  <Select id={`q-${i}`} value={answers[qq.key] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [qq.key]: e.target.value }))}>
                    <option value="">Choose…</option>
                    {qq.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <>
                    <Input id={`q-${i}`} value={answers[qq.key] ?? ''} maxLength={200} list={qq.options.length ? `ql-${i}` : undefined} onChange={(e) => setAnswers((a) => ({ ...a, [qq.key]: e.target.value }))} />
                    {qq.options.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {qq.options.map((o) => (
                          <button key={o} type="button" onClick={() => setAnswers((a) => ({ ...a, [qq.key]: o }))} className="pressable h-8 rounded-full bg-surface px-3 text-xs font-medium text-fg-2 hover:text-fg">
                            {o}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </Field>
            ))}
          </section>
        ) : null}
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
