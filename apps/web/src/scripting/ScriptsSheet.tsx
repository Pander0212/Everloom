/** Chat menu › Scripts: what can run here, what's running, each script's console, stop and restart. */
import { RotateCcw, Settings2, ShieldQuestion, Square, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { cx } from '@/lib/format';
import { Badge, Button, EmptyState, IconButton, Sheet } from '@/ui';
import { restartScript, useScriptUi } from './ui-store';
import type { ActiveSet, ExtensionUi, ReviewTarget } from './types';

export function ScriptsSheet({ open, onOpenChange, active, extensions, safe, on, onReview }: { open: boolean; onOpenChange: (o: boolean) => void; active: ActiveSet | null; extensions: ExtensionUi[]; safe: boolean; on: boolean; onReview: (t: ReviewTarget) => void }) {
  const navigate = useNavigate();
  const consoleMap = useScriptUi((s) => s.console);
  const running = useScriptUi((s) => s.running);
  const rows = [
    ...(active?.scripts ?? []).filter((s) => s.ref.scope !== 'extension').map((s) => ({ key: s.key, name: s.script.name, origin: s.origin, granted: s.granted, enabled: s.script.enabled })),
    ...extensions.map((e) => ({ key: e.key, name: e.name, origin: 'Extension', granted: true, enabled: true })),
  ];
  const stop = async (key: string) => (await import('./host')).stopKey(key);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Scripts"
      description={safe ? 'Safe mode: nothing runs. Remove ?safe=1 from the address to turn scripts back on.' : !on ? 'Scripts are turned off in Settings › Scripts.' : 'Scripts and extensions that can run in this chat.'}
      headerActions={<IconButton icon={Settings2} label="Script settings" onClick={() => navigate('/settings/scripts')} />}
    >
      <div className="flex flex-col gap-4">
        {active?.pending.length ? (
          <ul className="flex flex-col gap-2">
            {active.pending.map((p) => (
              <li key={`${p.target.kind}:${p.target.id}`} className="flex items-center gap-3 rounded-md bg-warning-soft p-3 text-sm">
                <span className="flex-1">{p.name} has scripts that are off.</span>
                <Button size="sm" icon={ShieldQuestion} onClick={() => onReview(p.target)}>
                  Review
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {!rows.length ? <EmptyState title="No scripts here" body="Scripts come with characters, presets, lorebooks and extensions, or you can write your own in Settings › Scripts." /> : null}
        <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            const run = running[r.key];
            const log = consoleMap[r.key] ?? [];
            const state = !r.granted ? 'Needs review' : !r.enabled ? 'Off' : run?.count ? 'Running' : run?.stopped ? run.stopped : 'Not running';
            return (
              <li key={r.key} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-xs text-fg-2">{r.origin}</span>
                  <Badge tone={state === 'Running' ? 'success' : state === 'Needs review' ? 'warning' : 'neutral'} className="ml-auto">
                    {state}
                  </Badge>
                  {run?.count ? <IconButton size="sm" icon={Square} label={`Stop ${r.name}`} onClick={() => void stop(r.key)} /> : null}
                  {r.granted && r.enabled ? <IconButton size="sm" icon={RotateCcw} label={`Restart ${r.name}`} onClick={() => restartScript(r.key)} /> : null}
                </div>
                {log.length ? (
                  <div className="mt-2">
                    <div className="mb-1 flex items-center justify-between text-xs text-fg-2">
                      <span>Console</span>
                      <IconButton size="sm" icon={Trash2} label={`Clear the console of ${r.name}`} onClick={() => useScriptUi.setState((s) => ({ console: { ...s.console, [r.key]: [] } }))} />
                    </div>
                    <ol className="max-h-48 overflow-auto rounded-md bg-surface-2 p-2 font-mono text-xs leading-5" aria-label={`Console of ${r.name}`}>
                      {log.slice(-80).map((e, i) => (
                        <li key={i} className={cx('whitespace-pre-wrap break-words', e.level === 'error' ? 'text-danger' : e.level === 'warn' ? 'text-warning' : 'text-fg-2')}>
                          {e.text}
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </Sheet>
  );
}
