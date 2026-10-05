/** App level: your own scripts that run "when Everloom opens" (outside any chat), and script panels and dialogs. */
import { lazy, Suspense } from 'react';
import { ScriptOverlays } from './Overlays';
import { useScripts } from './useScripts';

const ScriptLayer = lazy(() => import('./ScriptLayer'));

export function GlobalScripts() {
  const s = useScripts(null);
  const load = s.runnable.filter((x) => x.ref.scope === 'global' && x.script.triggers.includes('load'));
  return (
    <>
      <ScriptOverlays />
      {s.on && s.settings && load.length ? (
        <Suspense fallback={null}>
          <ScriptLayer global chatId={null} characterId={null} settings={s.settings} runnable={load} extensions={[]} />
        </Suspense>
      ) : null}
    </>
  );
}
