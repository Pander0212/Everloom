/**
 * Android's share sheet sends a character page here (Web Share Target). Pages on sites the server
 * fetches are imported straight away; anything else gets the bridge instructions.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Page } from '@/app/Shell';
import { ApiError, post } from '@/lib/api';
import { toast } from '@/lib/store';
import { Button, EmptyState, Spinner } from '@/ui';

/** The shared link: the url field, or the first link inside the shared text. */
export function sharedLink(params: URLSearchParams): string | null {
  const direct = params.get('url');
  if (direct && /^https?:\/\//i.test(direct)) return direct;
  const m = /https?:\/\/\S+/i.exec(`${params.get('text') ?? ''} ${params.get('title') ?? ''}`);
  return m ? m[0].replace(/[).,]+$/, '') : null;
}

export default function BridgeShare() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const link = sharedLink(params);
  const [state, setState] = useState<{ error: string; bridge: boolean } | null>(null);
  useEffect(() => {
    if (!link) return;
    let live = true;
    post<{ character: { id: string; name: string }; via: string }>('/api/sources/import-url', { url: link })
      .then(async (r) => {
        await qc.invalidateQueries({ queryKey: ['characters'] });
        toast({ title: `${r.character.name} added to your library`, lines: [`From ${r.via}`], tone: 'success' });
        if (live) navigate(`/characters/${r.character.id}`, { replace: true });
      })
      .catch((e) => live && setState({ error: (e as Error).message, bridge: e instanceof ApiError && e.code === 'use_bridge' }));
    return () => {
      live = false;
    };
  }, [link]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Page title="Import shared link" narrow>
      {!link ? (
        <EmptyState title="No link in what was shared" body="Share a character page or a card file from your browser." />
      ) : state ? (
        <EmptyState
          title={state.bridge ? 'This site needs the browser bridge' : "Couldn't import that"}
          body={state.bridge ? `${state.error} On Android, the bookmarklet works in Chrome and Firefox: add it once from Settings › Character sources.` : state.error}
          action={<Button onClick={() => navigate('/settings/sources#bridge')}>Bridge settings</Button>}
        />
      ) : (
        <div className="flex flex-col items-center gap-3 py-16 text-sm text-fg-2">
          <Spinner />
          <span className="max-w-full truncate">Importing {link}</span>
        </div>
      )}
    </Page>
  );
}
