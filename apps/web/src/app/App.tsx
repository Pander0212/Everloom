import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router';
import { get, onAuthRequired, setCsrf } from '@/lib/api';
import { CustomCss } from '@/lib/customCss';
import { startEvents, stopEvents } from '@/lib/events';
import { useSettings } from '@/lib/queries';
import { applyMotion, applyTextSize, applyTheme, watchSystemTheme } from '@/lib/theme';
import { ConfirmHost, Spinner, Toaster } from '@/ui';
import { LoginPage, SetupPage } from './AuthPages';
import { ConnectionBanner, Shell } from './Shell';

const ChatsPage = lazy(() => import('@/features/chats/ChatsPage'));
const CharactersPage = lazy(() => import('@/features/library/LibraryPage'));
const CharacterEditor = lazy(() => import('@/features/characters/CharacterEditor'));
const PersonasPage = lazy(() => import('@/features/personas/PersonasPage'));
const LorePage = lazy(() => import('@/features/lore/LorePage'));
const LoreEditor = lazy(() => import('@/features/lore/LoreEditor'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const StoryView = lazy(() => import('@/features/story/StoryView'));
const DesignPage = lazy(() => import('@/features/design/DesignPage'));

export function PageFallback() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center">
      <Spinner />
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
    return watchSystemTheme(() => settings.data!.theme);
  }, [settings.data]);
  return (
    <Suspense fallback={<PageFallback />}>
      <CustomCss />
      <Routes>
        <Route path="/chat/:id" element={<StoryView />} />
        <Route path="/design" element={<DesignPage />} />
        <Route element={<Shell />}>
          <Route index element={<ChatsPage />} />
          <Route path="characters" element={<CharactersPage />} />
          <Route path="characters/:id" element={<CharacterEditor />} />
          <Route path="personas" element={<PersonasPage />} />
          <Route path="lore" element={<LorePage />} />
          <Route path="lore/:id" element={<LoreEditor />} />
          <Route path="settings/*" element={<SettingsPage />} />
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
      const s = await get<{ setupRequired: boolean; authenticated: boolean; username: string | null; csrf: string | null }>('/api/auth/status');
      setCsrf(s.csrf);
      return s;
    },
    staleTime: Infinity,
    retry: 1,
  });
  const [, force] = useState(0);
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
        <p className="text-sm text-fg-2">Check your connection. Everloom will retry.</p>
      </div>
    );
  else if (status.data?.setupRequired) body = <SetupPage onDone={refresh} />;
  else if (!status.data?.authenticated) body = <LoginPage onDone={refresh} />;
  else body = <AuthedApp />;
  return (
    <>
      <ConnectionBanner />
      {body}
      <Toaster />
      <ConfirmHost />
    </>
  );
}
