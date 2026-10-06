/**
 * 3D in the asset library: avatar models, their garments and accessories, and motion clips. Search
 * and tags; select some to export a zip, or import one (avatars come with their garments).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, Download, FileArchive, Footprints, Search, Shirt, Sparkles, Tag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { apiFetch, exportHeaders, get, put, upload } from '@/lib/api';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, Checkbox, EmptyState, FileButton, Icon, Input, Segmented } from '@/ui';

type Type3d = 'model' | 'garment' | 'accessory' | 'animation';
interface Item {
  key: string;
  type: Type3d;
  name: string;
  tags: string[];
  avatar: { id: string; name: string } | null;
  detail: string;
  thumb: string | null;
}

const TYPES: Array<{ value: Type3d | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'model', label: 'Models' },
  { value: 'garment', label: 'Garments' },
  { value: 'accessory', label: 'Accessories' },
  { value: 'animation', label: 'Animations' },
];
const ICON = { model: Box, garment: Shirt, accessory: Sparkles, animation: Footprints } as const;
const KEY = ['assets3d'];

export function Assets3D() {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState<Type3d | 'all'>('all');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [tagText, setTagText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const lib = useQuery({ queryKey: [...KEY, q, type], queryFn: () => get<{ items: Item[]; tags: string[] }>('/api/assets3d', { q, ...(type !== 'all' ? { type } : {}) }) });
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const toggle = (k: string, on: boolean) => setSel((s) => {
    const n = new Set(s);
    if (on) n.add(k);
    else n.delete(k);
    return n;
  });
  const exportZip = async () => {
    setBusy(true);
    try {
      const headers = await exportHeaders();
      if (!headers) return;
      const res = await apiFetch('/api/assets3d/export', { method: 'POST', body: { keys: [...sel] }, headers });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob());
      a.download = `everloom-3d-${new Date().toISOString().slice(0, 10)}.zip${headers['x-export-password'] ? '.evlt' : ''}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const saveTags = async (key: string) => {
    try {
      await put('/api/assets3d/tags', { key, tags: tagText.split(',').map((t) => t.trim()).filter(Boolean) });
      setEditing(null);
      await refresh();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="assets3d">
      <div className="relative">
        <Icon icon={Search} size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search names, tags and avatars" aria-label="Search 3D assets" className="pl-10" />
      </div>
      <div className="-mx-1 overflow-x-auto px-1">
        <Segmented label="3D type" size="sm" value={type} onChange={setType} options={TYPES} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={Download} disabled={!sel.size} loading={busy} onClick={exportZip}>
          Export {sel.size ? `${sel.size} ` : ''}as zip
        </Button>
        <FileButton
          accept=".zip,application/zip"
          variant="secondary"
          icon={FileArchive}
          onFiles={async ([f]) => {
            if (!f) return;
            try {
              const r = await upload<{ avatars: string[]; animations: string[]; skipped: number }>('/api/assets3d/import', f);
              toast({ title: `Added ${r.avatars.length} model${r.avatars.length === 1 ? '' : 's'} and ${r.animations.length} animation${r.animations.length === 1 ? '' : 's'}`, lines: r.skipped ? [`${r.skipped} skipped (an animation name already taken, or a file that couldn't be read)`] : undefined, tone: 'success' });
              await refresh();
            } catch (e) {
              toastError(e);
            }
          }}
        >
          Import a zip
        </FileButton>
      </div>
      <p className="-mt-2 text-xs text-fg-2">Garments and accessories travel with the avatar they were made for. Character bundles include each character's 3D avatar too.</p>
      {lib.data && !lib.data.items.length ? (
        <EmptyState icon={Box} title={q || type !== 'all' ? 'Nothing matches' : 'No 3D assets yet'} body={q || type !== 'all' ? 'Try other words or another type.' : 'Import or make an avatar in Characters › 3D avatars, or import motions in Settings › 3D characters.'} />
      ) : (
        <ul className="flex flex-col divide-y divide-line" aria-label="3D assets">
          {(lib.data?.items ?? []).map((a) => (
            <li key={a.key} className="flex flex-col gap-2 py-2">
              <div className="flex items-center gap-3">
                <Checkbox label={`Select ${a.name}`} checked={sel.has(a.key)} onChange={(v) => toggle(a.key, v)} />
                {a.thumb ? <img src={a.thumb} alt="" className="size-10 flex-none rounded-md bg-surface-2 object-cover" /> : <span className="grid size-10 flex-none place-items-center rounded-md bg-surface-2 text-fg-3"><Icon icon={ICON[a.type]} size={18} /></span>}
                <span className="min-w-0 flex-1">
                  {a.type === 'model' && a.avatar ? (
                    <Link to={`/characters/avatars/${a.avatar.id}`} className="block truncate text-sm font-medium hover:underline">{a.name}</Link>
                  ) : (
                    <span className="block truncate text-sm font-medium">{a.name}</span>
                  )}
                  <span className="block truncate text-xs text-fg-2">{[a.detail, a.type !== 'model' && a.avatar ? `on ${a.avatar.name}` : ''].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="hidden flex-wrap justify-end gap-1 sm:flex">
                  {a.tags.map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                </span>
                <Button size="sm" variant="ghost" icon={Tag} aria-label={`Tags for ${a.name}`} onClick={() => {
                  setEditing(editing === a.key ? null : a.key);
                  setTagText(a.tags.join(', '));
                }}>
                  <span className="sr-only sm:not-sr-only">Tags</span>
                </Button>
              </div>
              {editing === a.key ? (
                <form className="flex gap-2 pl-9" onSubmit={(e) => {
                  e.preventDefault();
                  void saveTags(a.key);
                }}>
                  <Input autoFocus aria-label={`Tags for ${a.name}`} value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="fantasy, armor, blue" />
                  <Button type="submit" size="sm">Save</Button>
                </form>
              ) : a.tags.length ? (
                <span className="flex flex-wrap gap-1 pl-9 sm:hidden">
                  {a.tags.map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
