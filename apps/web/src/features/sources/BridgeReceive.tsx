/**
 * Where the "Send to Everloom" bookmarklet hands a card over (postMessage from the page it ran on).
 * Nothing is imported until the player confirms; the card must come from the page it claims.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Download, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Page } from '@/app/Shell';
import { post } from '@/lib/api';
import { toast, toastError } from '@/lib/store';
import { Button, EmptyState, Spinner } from '@/ui';

interface Payload {
  page: string;
  site?: string;
  hidden?: boolean;
  nsfw?: boolean;
  file?: { name: string; data: string };
  card?: { name: string; creator_notes?: string };
  avatar?: string | null;
}

export default function BridgeReceive() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const d = e.data as { type?: string; payload?: Payload };
      if (d?.type !== 'everloom-bridge-card' || !d.payload?.page) return;
      try {
        // A card only counts if it claims the page it was sent from.
        if (new URL(d.payload.page).origin !== e.origin) return;
      } catch {
        return;
      }
      setFrom(new URL(e.origin).hostname);
      setPayload(d.payload);
    };
    window.addEventListener('message', on);
    window.opener?.postMessage('everloom-bridge-ready', '*');
    const t = setTimeout(() => setWaited(true), 4000);
    return () => {
      window.removeEventListener('message', on);
      clearTimeout(t);
    };
  }, []);
  const name = payload?.card?.name ?? payload?.file?.name ?? 'Character';
  const doImport = async () => {
    setBusy(true);
    try {
      const c = await post<{ id: string; name: string }>('/api/bridge/receive', payload);
      await qc.invalidateQueries({ queryKey: ['characters'] });
      toast({ title: `${c.name} added to your library`, tone: 'success' });
      navigate(`/characters/${c.id}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page title="Send to Everloom" narrow>
      {payload ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4 rounded-lg border border-line p-4">
            {payload.avatar ? <img src={`data:image/png;base64,${payload.avatar}`} alt="" className="h-20 w-16 flex-none rounded-md object-cover" /> : null}
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{name}</p>
              <p className="text-sm text-fg-2">From {from}{payload.file ? ' · card file' : ''}</p>
            </div>
          </div>
          {payload.hidden ? (
            <p className="flex items-start gap-2 rounded-md bg-surface-2 p-3 text-sm text-fg-2">
              <Lock size={15} className="mt-0.5 flex-none" />
              <span>
                <strong className="font-medium text-fg">Definition hidden by creator.</strong> Only the public profile comes across.
              </span>
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => window.close()}>
              Cancel
            </Button>
            <Button variant="primary" className="flex-1" icon={Download} loading={busy} onClick={doImport}>
              Import
            </Button>
          </div>
        </div>
      ) : waited ? (
        <EmptyState title="Nothing received" body="Open a character page and click the Send to Everloom bookmarklet. This page opens by itself and waits for the card." />
      ) : (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}
    </Page>
  );
}
