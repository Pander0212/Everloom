import type { PersonaDTO } from '@everloom/engine';
import { Plus, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Page } from '@/app/Shell';
import { usePersonas } from '@/lib/queries';
import { Avatar, Badge, Button, EmptyState, IconButton, ListRow } from '@/ui';
import { PersonaStudio } from './PersonaStudio';

export default function PersonasPage() {
  const personas = usePersonas();
  const [editing, setEditing] = useState<PersonaDTO | 'new' | null>(null);
  return (
    <Page
      narrow
      title="Personas"
      actions={
        <>
          <IconButton icon={Plus} label="New persona" className="md:hidden" onClick={() => setEditing('new')} />
          <span className="hidden md:contents"><Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
            New persona
          </Button></span>
        </>
      }
    >
      <p className="mb-2 text-sm text-fg-2">Who you are in the story. Each chat can use a different persona.</p>
      {personas.data?.length ? (
        <div className="flex flex-col">
          {personas.data.map((p) => (
            <ListRow
              key={p.id}
              title={p.name}
              subtitle={[p.title, p.age != null ? `${p.age}` : '', p.description.slice(0, 80)].filter(Boolean).join(' · ') || 'No description'}
              leading={<Avatar src={p.avatar} name={p.name} size="lg" />}
              trailing={p.isDefault ? <Badge tone="accent">Default</Badge> : null}
              chevron
              onClick={() => setEditing(p)}
            />
          ))}
        </div>
      ) : personas.isLoading ? null : (
        <EmptyState icon={UserRound} title="No personas yet" body="Create one so characters know who they're talking to." action={<Button variant="primary" onClick={() => setEditing('new')}>Create persona</Button>} />
      )}
      <PersonaStudio persona={editing === 'new' ? null : editing} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} />
    </Page>
  );
}
