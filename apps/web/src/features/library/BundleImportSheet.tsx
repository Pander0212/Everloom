import { PackageOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { post, upload } from '@/lib/api';
import { cx } from '@/lib/format';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, EmptyState, FileButton, Segmented, Sheet, Spinner } from '@/ui';

interface Item {
  index: number;
  name: string;
  creator: string;
  chats: number;
  gallery: number;
  worlds: number;
  avatar3d?: boolean;
  conflict: { id: string; name: string; reason: 'identical' | 'same name' } | null;
}
type Choice = 'new' | 'replace' | 'skip';

/** Import a bundle (Everloom or a zip of SillyTavern files): preview, resolve conflicts, import. */
export function BundleImportSheet({ open, onOpenChange, file, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; file: File | null; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<{ token: string; items: Item[] } | null>(null);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const read = async (f: File) => {
    setBusy(true);
    try {
      const p = await upload<{ token: string; items: Item[] }>('/api/library/bundle/preview', f);
      setPreview(p);
      setChoices(Object.fromEntries(p.items.map((i) => [i.index, i.conflict ? (i.conflict.reason === 'identical' ? 'skip' : 'new') : 'new'])));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (open && file) void read(file);
    if (!open) setPreview(null);
  }, [open, file]);
  const go = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await post<{ created: string[]; replaced: string[]; skipped: number }>('/api/library/bundle/import', { token: preview.token, choices });
      toast({ title: 'Bundle imported', lines: [`${r.created.length} added`, ...(r.replaced.length ? [`${r.replaced.length} replaced (a snapshot of each was kept)`] : []), ...(r.skipped ? [`${r.skipped} skipped`] : [])], tone: 'success' });
      onDone();
      onOpenChange(false);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const count = Object.values(choices).filter((c) => c !== 'skip').length;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Import a bundle" description="Characters with their chats, gallery and lorebooks, from Everloom or SillyTavern." size="md" footer={preview ? <Button variant="primary" block loading={busy} disabled={!count} onClick={go}>Import {count}</Button> : undefined}>
      {busy && !preview ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : preview ? (
        <ul className="flex flex-col divide-y divide-line">
          {preview.items.map((i) => (
            <li key={i.index} className="py-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{i.name}</p>
                  <p className="text-xs text-fg-2">{[i.creator && `by ${i.creator}`, `${i.chats} chats`, `${i.gallery} media`, i.worlds ? `${i.worlds} lorebook` : '', i.avatar3d ? '3D model' : ''].filter(Boolean).join(' · ')}</p>
                </div>
                {i.conflict ? <Badge tone="warning">{i.conflict.reason === 'identical' ? 'Already here' : 'Name taken'}</Badge> : <Badge tone="success">New</Badge>}
              </div>
              {i.conflict ? (
                <Segmented
                  size="sm"
                  className="mt-2"
                  label={`What to do with ${i.name}`}
                  value={choices[i.index]}
                  onChange={(v) => setChoices((c) => ({ ...c, [i.index]: v }))}
                  options={[{ value: 'skip', label: 'Skip' }, { value: 'new', label: 'Keep both' }, { value: 'replace', label: 'Replace' }]}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) void read(f);
          }}
          className={cx('rounded-lg border-2 border-dashed border-line-strong', drag && 'border-accent bg-accent-soft')}
        >
          <EmptyState icon={PackageOpen} title="Drop a .zip here" body="Or choose one. Nothing is added until you confirm." action={<FileButton accept=".zip,.evlt,application/zip" onFiles={(f) => void read(f[0])} variant="secondary">Choose a file</FileButton>} />
        </div>
      )}
    </Sheet>
  );
}
