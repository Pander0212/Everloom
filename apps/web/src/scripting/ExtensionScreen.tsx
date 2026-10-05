/** A full screen from an extension (/x/<extension>/<screen>), in its sandboxed frame. */
import { ArrowLeft } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Page } from '@/app/Shell';
import { EmptyState, IconButton, Spinner } from '@/ui';
import { useScripts } from './useScripts';

const EntryFrame = lazy(() => import('./EntryFrame'));

export default function ExtensionScreen() {
  const { ext = '', screen = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const s = useScripts(null);
  const e = s.extensions.find((x) => x.id === ext);
  const sc = e?.screens.find((x) => x.id === screen);
  const chatId = params.get('chat');
  const back = <IconButton icon={ArrowLeft} label="Back" onClick={() => navigate(-1)} />;
  if (!s.on) return <Page title="Extension" back={back}><EmptyState title="Extensions are off" body={s.safe ? 'Safe mode is on (remove ?safe=1 from the address).' : 'Turn scripts on in Settings › Scripts.'} /></Page>;
  if (!e || !sc) return <Page title="Extension" back={back}>{s.extensions.length ? <EmptyState title="Not found" body="This extension or screen isn't installed, or it's turned off." /> : <div className="flex justify-center py-10"><Spinner /></div>}</Page>;
  return (
    <Page title={sc.title} back={back}>
      <Suspense fallback={<Spinner />}>
        <EntryFrame spec={{ kind: 'screen', key: e.key, name: e.name, permissions: e.permissions, chatId, characterId: null, extId: e.id, entry: { extId: e.id, file: sc.file, updatedAt: e.updatedAt } }} minHeight={300} maxHeight={6000} title={sc.title} />
      </Suspense>
    </Page>
  );
}
