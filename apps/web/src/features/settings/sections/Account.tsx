import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { get, post } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, Dialog, Field, Input, ListRow } from '@/ui';
import { Section } from '../common';

interface Me {
  username: string;
  totpEnabled: boolean;
  sessions: Array<{ current: boolean; createdAt: number; lastSeen: number; userAgent: string; ip: string }>;
}

function device(ua: string) {
  if (/iPhone|iPad/.test(ua)) return 'iPhone / iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac OS/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Browser';
}

export default function AccountSection() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => get<Me>('/api/auth/me') });
  const [pw, setPw] = useState({ current: '', next: '' });
  const [totp, setTotp] = useState<{ svg: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePw, setDisablePw] = useState('');
  const changePw = async () => {
    try {
      await post('/api/auth/password', pw);
      setPw({ current: '', next: '' });
      toast({ title: 'Password changed. Other devices were signed out.', tone: 'success' });
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <>
      <Section title="Password" description={me.data ? `Signed in as ${me.data.username}.` : undefined}>
        <div className="flex flex-col gap-3">
          <Field label="Current password" htmlFor="cp">
            <Input id="cp" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </Field>
          <Field label="New password" htmlFor="np" hint="At least 10 characters.">
            <Input id="np" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </Field>
          <div>
            <Button variant="secondary" disabled={!pw.current || pw.next.length < 10} onClick={changePw}>
              Change password
            </Button>
          </div>
        </div>
      </Section>
      <Section title="Two-factor authentication" description="Require a code from an authenticator app when signing in." action={me.data?.totpEnabled ? <Badge tone="success">On</Badge> : null}>
        {me.data?.totpEnabled ? (
          <Button variant="danger" onClick={() => setDisableOpen(true)}>
            Turn off 2FA
          </Button>
        ) : totp ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-fg-2">Scan this with your authenticator app, then enter the 6-digit code.</p>
            <div className="w-48 rounded-md bg-white p-2" dangerouslySetInnerHTML={{ __html: totp.svg }} />
            <p className="break-all font-mono text-xs text-fg-2">{totp.secret}</p>
            <Field label="Code" htmlFor="tc">
              <Input id="tc" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="max-w-[160px]" />
            </Field>
            <div>
              <Button
                variant="primary"
                icon={ShieldCheck}
                disabled={code.length !== 6}
                onClick={async () => {
                  try {
                    await post('/api/auth/totp/enable', { code });
                    setTotp(null);
                    setCode('');
                    await qc.invalidateQueries({ queryKey: ['me'] });
                    toast({ title: 'Two-factor authentication is on', tone: 'success' });
                  } catch (e) {
                    toastError(e);
                  }
                }}
              >
                Turn on
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" icon={ShieldCheck} onClick={async () => setTotp(await post('/api/auth/totp/setup'))}>
            Set up 2FA
          </Button>
        )}
      </Section>
      <Section
        title="Signed-in devices"
        action={
          <Button
            size="sm"
            variant="quiet"
            onClick={async () => {
              await post('/api/auth/sessions/revoke-others');
              await qc.invalidateQueries({ queryKey: ['me'] });
            }}
          >
            Sign out others
          </Button>
        }
      >
        <div className="flex flex-col">
          {(me.data?.sessions ?? []).map((s, i) => (
            <ListRow key={i} title={device(s.userAgent)} subtitle={`${s.ip} · active ${relativeTime(s.lastSeen)}`} trailing={s.current ? <Badge tone="accent">This device</Badge> : null} />
          ))}
        </div>
        <Button
          className="mt-4"
          variant="ghost"
          icon={LogOut}
          onClick={async () => {
            await post('/api/auth/logout');
            location.href = '/';
          }}
        >
          Sign out
        </Button>
      </Section>
      <Dialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        title="Turn off 2FA?"
        description="Confirm with your password."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDisableOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await post('/api/auth/totp/disable', { password: disablePw });
                  setDisableOpen(false);
                  setDisablePw('');
                  await qc.invalidateQueries({ queryKey: ['me'] });
                } catch (e) {
                  toastError(e);
                }
              }}
            >
              Turn off
            </Button>
          </>
        }
      >
        <Input type="password" aria-label="Password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} />
      </Dialog>
    </>
  );
}
