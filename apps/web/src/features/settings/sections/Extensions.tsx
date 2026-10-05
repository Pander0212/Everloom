/**
 * Settings › Extensions: install from a zip, a Git address or (for development) a folder on the
 * server; see what each asks for before it runs; update, turn off, uninstall; read its error log.
 */
import { PERMISSION_INFO, type ScriptPermission } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FolderCode, GitBranch, RefreshCw, Settings2, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { api, del, get, patch, post } from '@/lib/api';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, Checkbox, EmptyState, Field, FileButton, IconButton, Input, Sheet, Spinner, Switch } from '@/ui';
import { CodeView } from '@/scripting/CodeView';
import { PermissionList } from '@/scripting/ReviewSheet';
import { Section } from '../common';

const EntryFrame = lazy(() => import('@/scripting/EntryFrame'));

interface Ext {
  id: string;
  manifest: { id: string; name: string; version: string; author: string; description: string; homepage?: string; permissions: ScriptPermission[]; domains: string[]; changelog?: string; entries: { settings?: string }; server?: { main: string } };
  enabled: boolean;
  source: string;
  dev: boolean;
  approved: boolean;
  changed: boolean;
  errors: Array<{ at: number; where: string; message: string }>;
  updatedAt: number;
  server: { state: string; detail?: string } | null;
}
interface Preview {
  token: string;
  manifest: Ext['manifest'];
  update: null | { from: string; to: string; addedPermissions: ScriptPermission[]; removedPermissions: ScriptPermission[]; addedDomains: string[] };
  files: string[];
  server: null | { allowed: boolean; main: string; code: string };
}

export default function ExtensionsSection() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['extensions'], queryFn: () => get<{ items: Ext[]; serverAllowed: boolean }>('/api/extensions') });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [url, setUrl] = useState('');
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [settingsOf, setSettingsOf] = useState<Ext | null>(null);
  const [uninstall, setUninstall] = useState<Ext | null>(null);
  const refresh = () => Promise.all(['extensions', 'extensions-ui', 'scripts-active'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const run = async (what: string, f: () => Promise<unknown>) => {
    setBusy(what);
    try {
      await f();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  const fromZip = (files: File[]) => run('zip', async () => setPreview(await api<Preview>('/api/extensions/preview', { method: 'POST', raw: files[0]!, contentType: 'application/zip' })));
  const fromGit = () => run('git', async () => setPreview(await post<Preview>('/api/extensions/preview', { url: url.trim() })));
  const install = () =>
    run('install', async () => {
      const d = await post<Ext>('/api/extensions/install', { token: preview!.token });
      setPreview(null);
      setUrl('');
      await refresh();
      toast({ title: `${d.manifest.name} installed`, tone: 'success' });
    });
  const items = list.data?.items ?? [];
  return (
    <>
      <Section title="Extensions" description="Add-ons with their own screens, panels, commands and game rules. They run sandboxed like scripts and can only do what they ask for here.">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <FileButton accept=".zip,application/zip" onFiles={fromZip} icon={Upload} loading={busy === 'zip'}>
              Install from a zip
            </FileButton>
          </div>
          <Field label="Or from a Git repository" htmlFor="ext-url" hint="A GitHub, GitLab or Codeberg address, or a link to a .zip.">
            <div className="flex gap-2">
              <Input id="ext-url" value={url} placeholder="https://github.com/someone/everloom-extension" onChange={(e) => setUrl(e.target.value)} />
              <Button icon={GitBranch} disabled={!url.trim()} loading={busy === 'git'} onClick={fromGit}>
                Look at it
              </Button>
            </div>
          </Field>
          <details className="text-sm">
            <summary className="cursor-pointer text-fg-2">Developing an extension?</summary>
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-fg-2">Point Everloom at a folder on the server (inside the allowed import locations). It reloads whenever you save a file.</p>
              <div className="flex gap-2">
                <Input aria-label="Extension folder on the server" value={folder} placeholder="/home/me/my-extension" onChange={(e) => setFolder(e.target.value)} />
                <Button icon={FolderCode} disabled={!folder.trim()} loading={busy === 'dev'} onClick={() => run('dev', async () => (await post('/api/extensions/dev', { folder: folder.trim() }), setFolder(''), await refresh()))}>
                  Use folder
                </Button>
              </div>
            </div>
          </details>
          <p className="text-xs text-fg-2">SillyTavern extensions depend on SillyTavern's own page and can't run here. Cards written for Tavern Helper work through the compatibility layer in Settings › Scripts.</p>
        </div>
      </Section>
      <Section title="Installed">
        {list.isLoading ? <Spinner /> : !items.length ? <EmptyState title="No extensions yet" body="Examples to try are in the examples/extensions folder of the Everloom repository." /> : null}
        <ul className="flex flex-col gap-3" aria-label="Installed extensions">
          {items.map((e) => (
            <li key={e.id} className="flex flex-col gap-2 rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{e.manifest.name}</span>
                <span className="text-xs text-fg-2">
                  {e.manifest.version}
                  {e.manifest.author ? ` · ${e.manifest.author}` : ''}
                </span>
                {e.dev ? <Badge>Dev folder</Badge> : null}
                {e.changed ? <Badge tone="warning">Changed: needs a look</Badge> : !e.approved ? <Badge tone="warning">Not approved</Badge> : null}
                <span className="ml-auto flex items-center gap-1">
                  {e.manifest.entries.settings && e.approved && e.enabled ? <IconButton size="sm" icon={Settings2} label={`${e.manifest.name} settings`} onClick={() => setSettingsOf(e)} /> : null}
                  {/^https:\/\//.test(e.source) ? <IconButton size="sm" icon={RefreshCw} label={`Check ${e.manifest.name} for updates`} onClick={() => run(`up:${e.id}`, async () => setPreview(await post<Preview>(`/api/extensions/${e.id}/check-update`)))} /> : null}
                  <Switch label={`Turn ${e.manifest.name} on`} checked={e.enabled} onChange={(v) => run(`on:${e.id}`, async () => (await patch(`/api/extensions/${e.id}`, { enabled: v }), await refresh()))} />
                  <IconButton size="sm" icon={Trash2} label={`Uninstall ${e.manifest.name}`} onClick={() => setUninstall(e)} />
                </span>
              </div>
              {e.manifest.description ? <p className="text-sm text-fg-2">{e.manifest.description}</p> : null}
              <PermissionList permissions={e.manifest.permissions} domains={e.manifest.domains} />
              {e.manifest.server ? <ServerNote state={e.server} /> : null}
              {e.changed || !e.approved ? (
                <div>
                  <Button size="sm" icon={ShieldCheck} onClick={() => run(`ap:${e.id}`, async () => (await post(`/api/extensions/${e.id}/approve`), await refresh()))}>
                    Approve as it is now
                  </Button>
                </div>
              ) : null}
              {e.errors.length ? (
                <details className="text-sm">
                  <summary className="cursor-pointer text-danger">
                    {e.errors.length} error{e.errors.length === 1 ? '' : 's'}
                  </summary>
                  <ol className="mt-2 max-h-48 overflow-auto rounded-md bg-surface-2 p-2 font-mono text-xs leading-5">
                    {e.errors.map((x, i) => (
                      <li key={i} className="whitespace-pre-wrap break-words">
                        {new Date(x.at).toLocaleString()} · {x.where}: {x.message}
                      </li>
                    ))}
                  </ol>
                  <Button size="sm" variant="ghost" className="mt-1" onClick={() => run(`ce:${e.id}`, async () => (await del(`/api/extensions/${e.id}/errors`), await refresh()))}>
                    Clear
                  </Button>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>
      <Sheet
        open={!!preview}
        onOpenChange={(o) => !o && setPreview(null)}
        size="lg"
        title={preview ? (preview.update ? `Update ${preview.manifest.name}?` : `Install ${preview.manifest.name}?`) : ''}
        description={preview ? `${preview.manifest.version}${preview.manifest.author ? ` · by ${preview.manifest.author}` : ''}` : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy === 'install'} disabled={!!preview?.server && !preview.server.allowed} onClick={install}>
              {preview?.update ? 'Update' : 'Install'}
            </Button>
          </div>
        }
      >
        {preview ? (
          <div className="flex flex-col gap-4">
            {preview.manifest.description ? <p className="text-sm">{preview.manifest.description}</p> : null}
            {preview.manifest.homepage ? (
              <a className="text-sm text-accent-text underline" href={preview.manifest.homepage} target="_blank" rel="noreferrer noopener">
                {preview.manifest.homepage}
              </a>
            ) : null}
            {preview.update ? (
              <div className="rounded-md bg-surface-2 p-3 text-sm">
                <p className="font-medium">
                  {preview.update.from} → {preview.update.to}
                </p>
                {preview.update.addedPermissions.length ? <p className="mt-1 text-danger">New permissions: {preview.update.addedPermissions.map((p) => PERMISSION_INFO[p].label).join(', ')}</p> : <p className="mt-1 text-fg-2">No new permissions.</p>}
                {preview.update.addedDomains.length ? <p className="text-danger">New sites: {preview.update.addedDomains.join(', ')}</p> : null}
                {preview.manifest.changelog ? <p className="mt-2 whitespace-pre-wrap">{preview.manifest.changelog}</p> : null}
              </div>
            ) : null}
            <div>
              <h3 className="mb-2 text-sm font-semibold">It asks for</h3>
              <PermissionList permissions={preview.manifest.permissions} domains={preview.manifest.domains} />
            </div>
            {preview.server ? (
              <div className="flex flex-col gap-2 rounded-md bg-danger-soft p-3 text-sm text-danger">
                <p className="flex items-center gap-2 font-semibold">
                  <AlertTriangle size={16} aria-hidden="true" /> It has a server part
                </p>
                <p>
                  {preview.server.allowed
                    ? 'That code runs on your server with full access to it (in its own process). Install it only if you trust the author and have read the code.'
                    : 'Server extensions are off on this server, or only its first account may install them. It can’t be installed here.'}
                </p>
                <CodeView code={preview.server.code} maxHeight={280} />
              </div>
            ) : null}
            <details className="text-sm">
              <summary className="cursor-pointer text-fg-2">{preview.files.length} files</summary>
              <ul className="mt-1 font-mono text-xs text-fg-2">
                {preview.files.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </details>
          </div>
        ) : null}
      </Sheet>
      <UninstallSheet ext={uninstall} onClose={() => setUninstall(null)} onDone={refresh} />
      <Sheet open={!!settingsOf} onOpenChange={(o) => !o && setSettingsOf(null)} title={settingsOf ? `${settingsOf.manifest.name} settings` : ''} size="lg">
        {settingsOf ? (
          <Suspense fallback={<Spinner />}>
            <EntryFrame spec={{ kind: 'settings', key: `extension:${settingsOf.id}:main`, name: settingsOf.manifest.name, permissions: settingsOf.manifest.permissions, chatId: null, characterId: null, extId: settingsOf.id, entry: { extId: settingsOf.id, file: settingsOf.manifest.entries.settings!, updatedAt: settingsOf.updatedAt } }} title={`${settingsOf.manifest.name} settings`} />
          </Suspense>
        ) : null}
      </Sheet>
    </>
  );
}

function ServerNote({ state }: { state: Ext['server'] }) {
  if (!state) return null;
  const text: Record<string, string> = { running: 'Server part running', stopped: 'Server part stopped', crashed: 'Server part stopped after crashing', off: 'Server part off', 'not-allowed': 'Server extensions are off on this server' };
  return (
    <p className="text-xs text-fg-2">
      {text[state.state] ?? state.state}
      {state.detail ? ` — ${state.detail}` : ''}
    </p>
  );
}

function UninstallSheet({ ext, onClose, onDone }: { ext: Ext | null; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open={!!ext}
      onOpenChange={(o) => !o && onClose()}
      title={ext ? `Uninstall ${ext.manifest.name}?` : ''}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await del(`/api/extensions/${ext!.id}${keep ? '?keepData=1' : ''}`);
                await onDone();
                onClose();
              } catch (e) {
                toastError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Uninstall
          </Button>
        </div>
      }
    >
      <label className="flex cursor-pointer items-center gap-2.5 text-sm">
        <Checkbox checked={keep} onChange={setKeep} label="Keep its stored data" />
        <span aria-hidden="true">Keep its stored data (for a later reinstall)</span>
      </label>
      <p className="mt-2 text-xs text-fg-2">Game changes it made stay in your stories; they just stop being editable by it.</p>
    </Sheet>
  );
}
