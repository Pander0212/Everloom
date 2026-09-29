import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Download, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { api, del, download, get, post } from '@/lib/api';
import { bytes, relativeTime } from '@/lib/format';
import { toast, toastError } from '@/lib/store';
import { Button, confirm, Field, FileButton, IconButton, Input, ListRow, ToggleRow } from '@/ui';
import { Section, useSettingsPatch } from '../common';
import { SillyTavernImport } from '../SillyTavernImport';

export default function DataSection() {
  const { settings, update } = useSettingsPatch();
  const qc = useQueryClient();
  const backups = useQuery({ queryKey: ['backups'], queryFn: () => get<Array<{ name: string; size: number; createdAt: number }>>('/api/backups') });
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      await post('/api/backups');
      await qc.invalidateQueries({ queryKey: ['backups'] });
      toast({ title: 'Backup created', tone: 'success' });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const restore = async (f: File) => {
    if (!(await confirm({ title: 'Restore this backup?', description: 'Everything on the server is replaced by the backup. A safety backup of the current data is made first, then Everloom restarts.', confirmLabel: 'Restore', danger: true }))) return;
    try {
      await api('/api/backups/restore', { method: 'POST', raw: f, contentType: 'application/zip' });
      toast({ title: 'Restoring… the app will reload shortly.' });
      setTimeout(() => location.reload(), 6000);
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <>
      <Section
        title="Backups"
        description="A backup holds the database and all images. Nightly backups run on the server."
        action={
          <Button size="sm" variant="secondary" icon={Archive} loading={busy} onClick={create}>
            Back up now
          </Button>
        }
      >
        {settings ? (
          <>
            <div className="flex flex-col divide-y divide-line">
              <ToggleRow label="Nightly backup" checked={settings.backups.nightly} onChange={(v) => update({ backups: { nightly: v } })} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Hour (server time)" htmlFor="bh">
                <Input id="bh" type="number" min={0} max={23} value={settings.backups.hour} onChange={(e) => update({ backups: { hour: Number(e.target.value) } })} />
              </Field>
              <Field label="Keep" htmlFor="br" hint="Number of backups">
                <Input id="br" type="number" min={1} max={365} value={settings.backups.retention} onChange={(e) => update({ backups: { retention: Number(e.target.value) } })} />
              </Field>
            </div>
          </>
        ) : null}
        <div className="mt-4 flex flex-col">
          {(backups.data ?? []).map((b) => (
            <ListRow
              key={b.name}
              title={b.name.replace(/^everloom-/, '').replace(/\.zip$/, '')}
              subtitle={`${bytes(b.size)} · ${relativeTime(b.createdAt)}`}
              trailing={
                <span className="flex">
                  <IconButton icon={Download} label="Download backup" onClick={() => download(`/api/backups/${b.name}`, b.name)} />
                  <IconButton
                    icon={Trash2}
                    label="Delete backup"
                    onClick={async () => {
                      if (!(await confirm({ title: 'Delete this backup?', confirmLabel: 'Delete', danger: true }))) return;
                      await del(`/api/backups/${b.name}`);
                      await qc.invalidateQueries({ queryKey: ['backups'] });
                    }}
                  />
                </span>
              }
            />
          ))}
        </div>
        <FileButton accept=".zip,application/zip" onFiles={(f) => restore(f[0])} variant="ghost" icon={Upload} className="mt-2">
          Restore from a file
        </FileButton>
      </Section>
      <Section title="Move from SillyTavern" description="Copies characters, chats (with swipes), personas, world info, backgrounds and presets. Your SillyTavern folder is only read, never changed.">
        <SillyTavernImport />
      </Section>
    </>
  );
}
