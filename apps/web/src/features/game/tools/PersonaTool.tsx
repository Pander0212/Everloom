import type { Op, PersonaDTO } from '@everloom/engine';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { patch } from '@/lib/api';
import { qk, usePersonas } from '@/lib/queries';
import { toastError } from '@/lib/store';
import { Avatar, Badge, Button, EmptyState, Field, Input, Textarea } from '@/ui';
import { PersonaStudio } from '@/features/personas/PersonaStudio';
import { useGame } from '../context';
import { ToolSheet } from './ToolSheet';

/** Who you are in this chat: the persona card plus the in-game identity the tracker keeps. */
export default function PersonaTool() {
  const { chat, state: s, apply } = useGame();
  const personas = usePersonas();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<PersonaDTO | 'new' | null>(null);
  const active = personas.data?.find((p) => p.id === chat.personaId) ?? personas.data?.find((p) => p.isDefault) ?? null;
  const [id, setId] = useState({ name: '', className: '', age: '', appearance: '' });
  useEffect(() => {
    if (s) setId({ name: s.player.name, className: s.player.className, age: s.player.age == null ? '' : String(s.player.age), appearance: s.player.appearance });
  }, [s?.player.name, s?.player.className, s?.player.age, s?.player.appearance]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = async (personaId: string | null) => {
    try {
      const c = await patch(`/api/chats/${chat.id}`, { personaId });
      qc.setQueryData(qk.chat(chat.id), (x: any) => ({ ...x, ...c }));
    } catch (e) {
      toastError(e);
    }
  };
  const dirty = s && (id.name !== s.player.name || id.className !== s.player.className || id.appearance !== s.player.appearance || id.age !== (s.player.age == null ? '' : String(s.player.age)));

  return (
    <ToolSheet title="Persona" description="Who you are in this story">
      <div className="flex flex-col gap-6">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">Persona for this chat</h3>
          {personas.data?.length ? (
            <div role="radiogroup" aria-label="Persona" className="flex flex-col gap-1">
              {personas.data.map((p) => {
                const on = active?.id === p.id;
                return (
                  <div key={p.id} className={`flex items-center gap-3 rounded-md border px-3 py-2 ${on ? 'border-accent bg-accent-soft' : 'border-line'}`}>
                    <button role="radio" aria-checked={on} onClick={() => choose(p.id)} className="pressable flex min-w-0 flex-1 items-center gap-3 text-left">
                      <Avatar src={p.avatar} name={p.name} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{p.name}</span>
                          {p.isDefault ? <Badge>Default</Badge> : null}
                        </span>
                        <span className="block truncate text-xs text-fg-2">{p.title || p.description.slice(0, 80) || 'No description'}</span>
                      </span>
                    </button>
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
                      Edit
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={UserRound} title="No personas yet" body="A persona tells the model who you are." />
          )}
          <Button variant="secondary" className="mt-2" block onClick={() => setEditing('new')}>
            New persona
          </Button>
        </section>

        {s ? (
          <section className="flex flex-col gap-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-3">In-game identity</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name" htmlFor="pi-name">
                <Input id="pi-name" value={id.name} onChange={(e) => setId({ ...id, name: e.target.value })} maxLength={80} />
              </Field>
              <Field label="Class or role" htmlFor="pi-class">
                <Input id="pi-class" value={id.className} onChange={(e) => setId({ ...id, className: e.target.value })} maxLength={80} />
              </Field>
              <Field label="Age" htmlFor="pi-age">
                <Input id="pi-age" inputMode="numeric" value={id.age} onChange={(e) => setId({ ...id, age: e.target.value.replace(/\D/g, '') })} maxLength={5} />
              </Field>
            </div>
            <Field label="Appearance" htmlFor="pi-app" hint="What others see. Sent to the model with the game state.">
              <Textarea id="pi-app" value={id.appearance} onChange={(e) => setId({ ...id, appearance: e.target.value })} maxLength={2000} />
            </Field>
            {active && !id.appearance && active.description ? (
              <Button variant="quiet" size="sm" onClick={() => setId({ ...id, appearance: active.description.slice(0, 2000) })}>
                Copy from persona description
              </Button>
            ) : null}
            <Button
              variant="primary"
              disabled={!dirty || !id.name.trim()}
              onClick={() => apply({ type: 'player.update', name: id.name.trim(), className: id.className.trim(), age: id.age ? Number(id.age) : null, appearance: id.appearance.trim() } as Op)}
            >
              Save identity
            </Button>
          </section>
        ) : null}
      </div>
      <PersonaStudio persona={editing === 'new' ? null : editing} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} />
    </ToolSheet>
  );
}
