import { useQueryClient } from '@tanstack/react-query';
import { FolderSearch, Upload } from 'lucide-react';
import { useState } from 'react';
import { api, post } from '@/lib/api';
import { toast, toastError } from '@/lib/store';
import { Button, Checkbox, Field, FileButton, Input } from '@/ui';

interface Scan {
  root: string;
  counts: Record<string, number>;
  samples: Record<string, string[]>;
}

const KINDS: Array<[string, string]> = [
  ['characters', 'Characters'],
  ['chats', 'Chats'],
  ['groups', 'Groups'],
  ['personas', 'Personas'],
  ['worlds', 'World info'],
  ['backgrounds', 'Backgrounds'],
  ['presets', 'Presets'],
];

export function SillyTavernImport() {
  const qc = useQueryClient();
  const [path, setPath] = useState('/home/user/SillyTavern/data/default-user');
  const [scan, setScan] = useState<Scan | null>(null);
  const [pick, setPick] = useState<Record<string, boolean>>({ characters: true, chats: true, groups: true, personas: true, worlds: true, backgrounds: true, presets: true });
  const [busy, setBusy] = useState<'scan' | 'run' | 'upload' | null>(null);
  const doScan = async (p = path) => {
    setBusy('scan');
    try {
      setScan(await post<Scan>('/api/import/sillytavern/scan', { path: p }));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  const uploadZip = async (f: File) => {
    setBusy('upload');
    try {
      const r = await api<{ path: string }>('/api/import/sillytavern/upload', { method: 'POST', raw: f, contentType: 'application/zip' });
      setPath(r.path);
      await doScan(r.path);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  const run = async () => {
    if (!scan) return;
    setBusy('run');
    try {
      const r = await post<{ imported: Record<string, number>; errors: string[] }>('/api/import/sillytavern/run', { path: scan.root, include: pick });
      await qc.invalidateQueries();
      toast({ title: 'Import finished', lines: Object.entries(r.imported).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`), tone: 'success', duration: 8000 });
      if (r.errors.length) toast({ title: `${r.errors.length} items were skipped`, lines: r.errors.slice(0, 3), tone: 'danger' });
      setScan(null);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <Field label="Folder on this server" htmlFor="stp" hint="The user folder, e.g. …/SillyTavern/data/default-user">
        <div className="flex gap-2">
          <Input id="stp" value={path} onChange={(e) => setPath(e.target.value)} className="font-mono text-sm" />
          <Button variant="secondary" icon={FolderSearch} loading={busy === 'scan'} onClick={() => doScan()}>
            Scan
          </Button>
        </div>
      </Field>
      <div className="flex items-center gap-3 text-sm text-fg-2">
        <span>or</span>
        <FileButton accept=".zip" onFiles={(f) => uploadZip(f[0])} variant="ghost" icon={Upload} loading={busy === 'upload'}>
          Upload a zip of that folder
        </FileButton>
      </div>
      {scan ? (
        <div className="rounded-md bg-surface-2 p-4">
          <p className="text-sm font-medium">Found in {scan.root}</p>
          <div className="mt-3 flex flex-col gap-2.5">
            {KINDS.map(([k, label]) => (
              <label key={k} className="flex items-center gap-3 text-sm">
                <Checkbox checked={!!pick[k]} onChange={(v) => setPick({ ...pick, [k]: v })} label={label} disabled={!scan.counts[k]} />
                <span className="flex-1">{label}</span>
                <span className="tabular-nums text-fg-2">{scan.counts[k] ?? 0}</span>
              </label>
            ))}
          </div>
          <Button variant="primary" className="mt-4" block loading={busy === 'run'} onClick={run}>
            Import selected
          </Button>
        </div>
      ) : null}
    </div>
  );
}
