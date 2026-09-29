import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiError, post } from '@/lib/api';
import { Button, Field, Input } from '@/ui';
import { Logo } from './Logo';

function Frame({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-full items-center justify-center px-4 py-12 safe-top">
      <div className="w-full max-w-[380px]">
        <Logo size={40} />
        <h1 className="mt-6 text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1.5 text-sm text-fg-2">{subtitle}</p>
        <div className="mt-8">{children}</div>
      </div>
    </main>
  );
}

export function SetupPage({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 10) return setError('Use at least 10 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    try {
      await post('/api/auth/setup', { username, password });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Frame title="Welcome to Everloom" subtitle="Create the owner account. This server is on the internet, so pick a strong password.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Username" htmlFor="u">
          <Input id="u" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password" htmlFor="p" hint="At least 10 characters.">
          <Input id="p" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Field label="Confirm password" htmlFor="c" error={error}>
          <Input id="c" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required invalid={!!error} />
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy} className="mt-2">
          Create account
        </Button>
      </form>
    </Frame>
  );
}

export function LoginPage({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await post('/api/auth/login', { username, password, code: needCode ? code : undefined });
      qc.clear();
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'totp_required') {
        setNeedCode(true);
        setError(null);
      } else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Frame title="Sign in" subtitle="Welcome back.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Username" htmlFor="u">
          <Input id="u" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password" htmlFor="p" error={needCode ? null : error}>
          <Input id="p" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required invalid={!!error && !needCode} />
        </Field>
        {needCode ? (
          <Field label="Authenticator code" htmlFor="t" error={error} hint="Six digits from your authenticator app.">
            <Input id="t" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
          </Field>
        ) : null}
        <Button type="submit" variant="primary" size="lg" block loading={busy} className="mt-2">
          Sign in
        </Button>
      </form>
    </Frame>
  );
}
