/**
 * Settings › Privacy › Vault: encrypt everything on the server's disk. Turning it on shows the
 * recovery key once; the passphrase never leaves this page except to the server, which keeps the key
 * only in memory while unlocked.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, Lock } from 'lucide-react';
import { useState } from 'react';
import { get, post, put } from '@/lib/api';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, Checkbox, confirm, Field, Input, Select } from '@/ui';
import { Section } from '../common';

interface VaultStatus {
  enabled: boolean;
  locked: boolean;
  state: 'off' | 'enabling' | 'on' | 'disabling';
  resumable: boolean;
  loginIsPassphrase: boolean;
  idleMinutes: number;
  busy: string | null;
  plaintextBackups: number;
}

const IDLE = [5, 15, 30, 60, 240, 1440];

export function VaultSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['vault'], queryFn: () => get<VaultStatus>('/api/vault') });
  const set = (v: VaultStatus) => qc.setQueryData(['vault'], v);
  const [recovery, setRecovery] = useState<string | null>(null);
  const v = q.data;
  if (!v) return null;
  return (
    <Section
      title="Vault"
      description="Encrypts everything on the server's disk: chats, characters, memories, the search index, pictures, voices, backups. Without the passphrase (or the recovery key) nobody can read them from the disk or a backup."
    >
      {recovery ? (
        <RecoveryKey value={recovery} onDone={() => setRecovery(null)} />
      ) : v.state === 'off' || v.resumable ? (
        <EnableForm resumable={v.resumable} onDone={(s, key) => (set(s), setRecovery(key))} />
      ) : (
        <VaultOn v={v} onChange={set} />
      )}
      <ul className="mt-4 flex list-disc flex-col gap-1.5 pl-5 text-xs text-fg-2">
        <li>If you lose both the passphrase and the recovery key, the data is gone for good. Nobody can recover it.</li>
        <li>While unlocked, the key is in the server's memory: someone with full control of the running server could still reach it.</li>
        <li>What you send to the AI provider is readable by the provider (the name shield can hide names).</li>
        <li>It doesn't protect an unlocked phone someone else is holding. It locks after the idle time you choose.</li>
      </ul>
    </Section>
  );
}

function EnableForm({ resumable, onDone }: { resumable: boolean; onDone: (s: VaultStatus, recovery: string | null) => void }) {
  const [useLogin, setUseLogin] = useState(false);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [idle, setIdle] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setError(null);
    if (!useLogin && !resumable && a !== b) return setError("The passphrases don't match");
    if (a.length < 10) return setError('Use at least 10 characters');
    if (!resumable && !(await confirm({ title: 'Turn on the vault?', description: 'Everloom makes a backup, encrypts everything and checks it before switching over. This can take a while with many pictures. Keep this page open.', confirmLabel: 'Turn on' }))) return;
    setBusy(true);
    try {
      const r = await post<VaultStatus & { recoveryKey: string | null }>('/api/vault/enable', useLogin ? { useLoginPassword: a, idleMinutes: idle } : { passphrase: a, idleMinutes: idle });
      onDone(r, r.recoveryKey);
      toast({ title: 'The vault is on', tone: 'success' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {resumable ? <p className="rounded-md bg-warning-soft p-3 text-sm">Turning the vault on was interrupted. Enter the passphrase to finish.</p> : null}
      {!resumable ? (
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <Checkbox checked={useLogin} onChange={setUseLogin} label="Use my login password as the passphrase (signing in then unlocks)" />
          <span aria-hidden="true">Use my login password as the passphrase (signing in then unlocks)</span>
        </label>
      ) : null}
      <Field label={useLogin ? 'Your current login password' : 'Passphrase'} htmlFor="vault-a" error={error}>
        <Input id="vault-a" type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} />
      </Field>
      {!useLogin && !resumable ? (
        <Field label="Passphrase again" htmlFor="vault-b">
          <Input id="vault-b" type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} />
        </Field>
      ) : null}
      {!resumable ? (
        <Field label="Lock after" htmlFor="vault-idle-new">
          <Select id="vault-idle-new" value={String(idle)} onChange={(e) => setIdle(Number(e.target.value))}>
            {IDLE.map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : m === 1440 ? '1 day' : `${m / 60} hours`}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <div>
        <Button variant="primary" icon={Lock} loading={busy} disabled={!a} onClick={go}>
          {resumable ? 'Finish turning on' : 'Turn on the vault'}
        </Button>
      </div>
    </div>
  );
}

function RecoveryKey({ value, onDone }: { value: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`Everloom vault recovery key\n\n${value}\n\nKeep this somewhere safe and offline. It opens your vault if you forget the passphrase.\n`], { type: 'text/plain' }));
    a.download = 'everloom-recovery-key.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-accent bg-accent-soft p-4" role="region" aria-label="Recovery key">
      <p className="font-medium">Your recovery key</p>
      <p className="text-sm text-fg-2">It's shown once. If you forget the passphrase, this is the only other way in. Save it somewhere safe, away from this server.</p>
      <code className="break-all rounded-md bg-surface-2 p-3 font-mono text-sm" aria-label="Recovery key value">
        {value}
      </code>
      <div className="flex flex-wrap gap-2">
        <Button icon={Copy} onClick={() => navigator.clipboard?.writeText(value).then(() => toast({ title: 'Copied' }), () => undefined)}>
          Copy
        </Button>
        <Button icon={Download} onClick={download}>
          Download
        </Button>
      </div>
      <label className="flex cursor-pointer items-center gap-2.5 text-sm">
        <Checkbox checked={saved} onChange={setSaved} label="I saved the recovery key" />
        <span aria-hidden="true">I saved the recovery key</span>
      </label>
      <div>
        <Button variant="primary" disabled={!saved} onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function VaultOn({ v, onChange }: { v: VaultStatus; onChange: (s: VaultStatus) => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [off, setOff] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (what: string, f: () => Promise<VaultStatus>, done?: string) => {
    setBusy(what);
    try {
      onChange(await f());
      if (done) toast({ title: done, tone: 'success' });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="success">On</Badge>
        <span className="flex-1 text-sm text-fg-2">{v.loginIsPassphrase ? 'Signing in unlocks it.' : 'Unlocked with your passphrase.'}</span>
        <Button icon={Lock} onClick={() => post('/api/vault/lock', {}).catch(toastError)}>
          Lock now
        </Button>
      </div>
      <Field label="Lock after" htmlFor="vault-idle">
        <Select id="vault-idle" value={String(v.idleMinutes)} onChange={(e) => void run('idle', () => put<VaultStatus>('/api/vault/idle', { minutes: Number(e.target.value) }))}>
          {[...new Set([...IDLE, v.idleMinutes])].sort((x, y) => x - y).map((m) => (
            <option key={m} value={m}>
              {m < 60 ? `${m} minutes of inactivity` : m === 60 ? '1 hour of inactivity' : m === 1440 ? '1 day of inactivity' : `${m / 60} hours of inactivity`}
            </option>
          ))}
        </Select>
      </Field>
      {v.plaintextBackups ? (
        <div className="rounded-md bg-warning-soft p-3 text-sm">
          <p>{v.plaintextBackups === 1 ? 'One backup was' : `${v.plaintextBackups} backups were`} made before the vault was on and can still be read.</p>
          <Button
            className="mt-2"
            size="sm"
            loading={busy === 'plain'}
            onClick={async () => {
              if (await confirm({ title: 'Delete the readable backups?', description: 'They are overwritten and deleted. Backups made from now on are encrypted.', confirmLabel: 'Delete', danger: true }))
                await run('plain', () => post<VaultStatus>('/api/vault/delete-plaintext-backups', {}), 'Readable backups deleted');
            }}
          >
            Delete them
          </Button>
        </div>
      ) : null}
      {!v.loginIsPassphrase ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Change the passphrase</p>
          <Input type="password" aria-label="Current passphrase" placeholder="Current passphrase" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
          <Input type="password" aria-label="New passphrase" placeholder="New passphrase" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          <div>
            <Button size="sm" loading={busy === 'pass'} disabled={!cur || next.length < 10} onClick={() => void run('pass', () => post<VaultStatus>('/api/vault/passphrase', { current: { passphrase: cur }, next }), 'Passphrase changed').then(() => (setCur(''), setNext('')))}>
              Change
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Turn the vault off</p>
        <p className="text-xs text-fg-2">Everything is decrypted and checked before switching back. Backups made while it was on stay encrypted.</p>
        <Input type="password" aria-label="Passphrase to turn the vault off" placeholder="Passphrase" autoComplete="current-password" value={off} onChange={(e) => setOff(e.target.value)} />
        <div>
          <Button
            size="sm"
            variant="quiet"
            loading={busy === 'off'}
            disabled={!off}
            onClick={async () => {
              if (await confirm({ title: 'Turn the vault off?', description: 'Your data will be readable on the server again.', confirmLabel: 'Turn off', danger: true }))
                await run('off', () => post<VaultStatus>('/api/vault/disable', { passphrase: off }), 'The vault is off');
              setOff('');
            }}
          >
            Turn off
          </Button>
        </div>
      </div>
    </div>
  );
}
