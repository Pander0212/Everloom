/** Settings › Puppets: make an animated puppet from a picture (through the layering connection), import a layering result, and the owner's puppets. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Layers, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { del, get, upload } from '@/lib/api';
import { useConnections } from '@/lib/queries';
import { toastError } from '@/lib/store';
import { Button, confirm, Field, FileButton, IconButton, Input, ListRow, Segmented } from '@/ui';
import { Section } from '../common';

interface PuppetRow { id: string; name: string; rating: 'all-ages' | '18+'; createdAt: number; parts: number; url: string }
interface Job { id: string; state: 'running' | 'done' | 'failed'; progress: number; stage: string; error: string | null; puppet: string | null }

export default function PuppetsSection() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const puppets = useQuery({ queryKey: ['puppets'], queryFn: () => get<PuppetRow[]>('/api/puppets') });
  const conns = useConnections();
  const hasLayering = (conns.data ?? []).some((c) => c.provider.startsWith('layers-'));
  const [name, setName] = useState('');
  const [rating, setRating] = useState<'all-ages' | '18+'>('all-ages');
  const [job, setJob] = useState<Job | null>(null);
  const [importing, setImporting] = useState(false);

  // Follow a running job.
  useEffect(() => {
    if (!job || job.state !== 'running') return;
    const t = setInterval(async () => {
      try {
        const j = await get<Job>(`/api/puppets/make/${job.id}`);
        setJob(j);
        if (j.state === 'done') void qc.invalidateQueries({ queryKey: ['puppets'] });
      } catch (e) { toastError(e); }
    }, 3000);
    return () => clearInterval(t);
  }, [job, qc]);

  const query = () => ({ name: name.trim() || 'My puppet', rating, ...(rating === '18+' ? { bounce: 1.3 } : {}) });
  const make = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    try { setJob(await upload<Job>('/api/puppets/make', f, query())); } catch (e) { toastError(e); }
  };
  const importZip = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setImporting(true);
    try { await upload('/api/puppets/import', f, query()); await qc.invalidateQueries({ queryKey: ['puppets'] }); } catch (e) { toastError(e); } finally { setImporting(false); }
  };
  const open = (p: PuppetRow) => navigate(`/lab/puppets?puppet=${encodeURIComponent(p.url)}`);

  return (
    <>
      <Section title="Make a puppet from a picture" description="One character facing you, head to feet, arms a little away from the body, on a plain background. The picture is split into layers (hair, face, eyes, mouth, body, clothes) by your layering connection, then rigged: head turns, blinking, talking, breathing, hair and body physics.">
        <div className="flex flex-col gap-3">
          <Field label="Name" htmlFor="puppet-name"><Input id="puppet-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My puppet" maxLength={80} /></Field>
          <Field label="Rating" htmlFor="puppet-rating" hint="18+ puppets move their chest more.">
            <Segmented aria-label="Rating" value={rating} onChange={(v) => setRating(v as 'all-ages' | '18+')} options={[{ value: 'all-ages', label: 'All ages' }, { value: '18+', label: '18+' }]} />
          </Field>
          {hasLayering ? (
            <FileButton variant="primary" icon={Upload} accept="image/png,image/jpeg,image/webp" onFiles={make} disabled={job?.state === 'running'}>Choose a picture</FileButton>
          ) : (
            <p className="text-sm text-fg-2">Add a puppet layering connection first (Settings › Connections › Puppet layering): a See-through worker on your own GPU (16 GB or more) or a rented one. Or import a layering result below.</p>
          )}
          {job ? (
            <div className="rounded-md border border-line p-3 text-sm" role="status" aria-live="polite">
              {job.state === 'running' ? <>{job.stage}… {job.progress}%<div className="mt-2 h-1.5 rounded bg-surface-2"><div className="h-1.5 rounded bg-accent" style={{ width: `${job.progress}%` }} /></div><p className="mt-2 text-fg-3">A few minutes on a good GPU; you can leave this page.</p></>
                : job.state === 'done' ? <>Your puppet is ready. <Button size="sm" variant="secondary" onClick={() => { const p = puppets.data?.find((x) => x.id === job.puppet); if (p) open(p); }}>Open it</Button></>
                : <span className="text-danger">{job.error ?? 'It failed.'}</span>}
            </div>
          ) : null}
        </div>
      </Section>

      <Section title="Import puppets" description="A zip of finished puppets (each a puppet.json with its pictures; one zip can hold many), or a layering result from tools/see-through-worker (it holds <name>/layers.json), for layering done somewhere else.">
        <FileButton variant="secondary" icon={Layers} accept=".zip,application/zip" onFiles={importZip} disabled={importing}>{importing ? 'Importing…' : 'Import a zip'}</FileButton>
      </Section>

      <Section title="Your puppets">
        {puppets.data?.length ? (
          <div className="flex flex-col">
            {puppets.data.map((p) => (
              <ListRow key={p.id} title={p.name} subtitle={`${p.rating === '18+' ? '18+ · ' : ''}${p.parts} parts · ${new Date(p.createdAt).toLocaleDateString()}`} onClick={() => open(p)}
                trailing={<div className="flex gap-1"><IconButton icon={ExternalLink} label={`Open ${p.name}`} onClick={(e) => { e.stopPropagation(); open(p); }} /><IconButton icon={Trash2} label={`Delete ${p.name}`} onClick={async (e) => { e.stopPropagation(); if (await confirm({ title: `Delete ${p.name}?`, confirmLabel: 'Delete', danger: true })) { try { await del(`/api/puppets/${p.id}`); await qc.invalidateQueries({ queryKey: ['puppets'] }); } catch (err) { toastError(err); } } }} /></div>} />
            ))}
          </div>
        ) : <p className="text-sm text-fg-2">None yet.</p>}
      </Section>
    </>
  );
}
