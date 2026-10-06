import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GlobalScripts } from '@/scripting/GlobalScripts';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router';
import { api, get, onAuthRequired, setCsrf } from '@/lib/api';
import { CustomCss } from '@/lib/customCss';
import { startEvents, stopEvents } from '@/lib/events';
import { useSettings } from '@/lib/queries';
import { applyMotion, applyPalette, applyTextSize, applyTheme, watchSystemTheme } from '@/lib/theme';
import { Button, ConfirmHost, PasswordHost, Spinner, Toaster } from '@/ui';
import { LoginPage, SetupPage, UnlockPage } from './AuthPages';
import { onVaultLocked, setVaultOn } from '@/lib/vaultMode';
import { StuckHelp } from './ErrorBoundary';
import { ConnectionBanner, Shell } from './Shell';

const ChatsPage = lazy(() => import('@/features/chats/ChatsPage'));
const CharactersPage = lazy(() => import('@/features/library/LibraryPage'));
const CharacterEditor = lazy(() => import('@/features/characters/CharacterEditor'));
const StudioPage = lazy(() => import('@/features/studio/StudioPage'));
const BrowsePage = lazy(() => import('@/features/sources/BrowsePage'));
const BridgeReceive = lazy(() => import('@/features/sources/BridgeReceive'));
const BridgeShare = lazy(() => import('@/features/sources/BridgeShare'));
const PersonasPage = lazy(() => import('@/features/personas/PersonasPage'));
const LorePage = lazy(() => import('@/features/lore/LorePage'));
const LoreEditor = lazy(() => import('@/features/lore/LoreEditor'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const StoryView = lazy(() => import('@/features/story/StoryView'));
const DesignPage = lazy(() => import('@/features/design/DesignPage'));
const ExtensionScreen = lazy(() => import('@/scripting/ExtensionScreen'));
const Lab3D = lazy(() => import('@/features/avatar3d/Lab3D'));
const AvatarsPage = lazy(() => import('@/features/avatars/AvatarsPage'));
const AvatarEditor = lazy(() => import('@/features/avatar3d/AvatarEditor'));

export function PageFallback() {
  return (
    <div className="flex h-full min-h-[40vh] flex-col items-center justify-center">
      <Spinner />
      <StuckHelp />
    </div>
  );
}

function AuthedApp() {
  const settings = useSettings();
  useEffect(() => {
    startEvents();
    return () => stopEvents();
  }, []);
  useEffect(() => {
    if (!settings.data) return;
    applyTheme(settings.data.theme);
    applyMotion(settings.data.motion);
    applyTextSize(settings.data.textSize);
    applyPalette(settings.data.palette);
    return watchSystemTheme(() => settings.data!.theme);
  }, [settings.data]);
  return (
    <Suspense fallback={<PageFallback />}>
      <CustomCss />
      <GlobalScripts />
      <Routes>
        <Route path="/chat/:id" element={<StoryView />} />
        <Route path="/design" element={<DesignPage />} />
        <Route path="/lab/3d" element={<Lab3D />} />
        <Route element={<Shell />}>
          <Route index element={<ChatsPage />} />
          <Route path="characters" element={<CharactersPage />} />
          <Route path="characters/studio" element={<StudioPage />} />
          <Route path="characters/browse" element={<BrowsePage />} />
          <Route path="bridge/receive" element={<BridgeReceive />} />
          <Route path="bridge/share" element={<BridgeShare />} />
          <Route path="characters/avatars" element={<AvatarsPage />} />
          <Route path="characters/avatars/:id" element={<AvatarEditor />} />
          <Route path="characters/:id" element={<CharacterEditor />} />
          <Route path="personas" element={<PersonasPage />} />
          <Route path="lore" element={<LorePage />} />
          <Route path="lore/:id" element={<LoreEditor />} />
          <Route path="settings/*" element={<SettingsPage />} />
          <Route path="x/:ext/:screen" element={<ExtensionScreen />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export function App() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const status = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      // Never wait forever on the first request: a stuck one becomes a retry and then an error screen.
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 15_000);
      const s = await api<{ setupRequired: boolean; authenticated: boolean; username: string | null; csrf: string | null; vault?: { enabled: boolean; locked: boolean } }>('/api/auth/status', { signal: ac.signal }).finally(() => clearTimeout(t));
      setCsrf(s.csrf);
      setVaultOn(!!s.vault?.enabled);
      return s;
    },
    staleTime: Infinity,
    retry: 1,
    // While the server can't be reached, keep trying quietly; it comes back after an update or a network blip.
    refetchInterval: (q) => (q.state.status === 'error' ? 5000 : false),
  });
  const [, force] = useState(0);
  // The vault locked (idle, Lock now, another device): drop everything held in memory and ask again.
  useEffect(
    () =>
      onVaultLocked(() => {
        stopEvents();
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
        void qc.invalidateQueries({ queryKey: ['auth'] });
      }),
    [qc],
  );
  useEffect(
    () =>
      onAuthRequired(() => {
        stopEvents();
        void qc.invalidateQueries({ queryKey: ['auth'] });
      }),
    [qc],
  );
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['auth'] });
    force((n) => n + 1);
    navigate('/', { replace: true });
  };
  let body: React.ReactNode;
  if (status.isLoading) body = <PageFallback />;
  else if (status.isError)
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="font-medium">Can't reach the server</p>
        <p className="text-sm text-fg-2">Check your connection. Everloom keeps trying every few seconds.</p>
        {/^[\d.]+$|^\[?[0-9a-f:]+\]?$/i.test(location.hostname) && location.protocol === 'https:' ? (
          // IP-only mode uses a self-signed certificate that renews itself; Safari then silently refuses it
          // until the new one is accepted, while this page still opens from its offline copy.
          <p className="mt-2 max-w-[380px] text-sm text-fg-2">
            Opened by IP address? Your browser may need to accept the server's certificate again.{' '}
            <a className="font-medium text-accent-text underline" href="/api/health">
              Open the server check
            </a>
            , accept the warning, then come back here.
          </p>
        ) : null}
        <Button className="mt-2" loading={status.isFetching} onClick={() => void status.refetch()}>
          Try again
        </Button>
      </div>
    );
  else if (status.data?.setupRequired) body = <SetupPage onDone={refresh} />;
  else if (!status.data?.authenticated) body = <LoginPage onDone={refresh} />;
  else if (status.data.vault?.locked) body = <UnlockPage onDone={refresh} />;
  else body = <AuthedApp />;
  return (
    <>
      <ConnectionBanner />
      {body}
      <Toaster />
      <ConfirmHost />
      <PasswordHost />
    </>
  );
}
