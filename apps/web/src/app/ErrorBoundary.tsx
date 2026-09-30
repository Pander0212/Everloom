import { Component, useEffect, useState, type ReactNode } from 'react';
import { reloadOnce, resetApp } from '@/lib/recover';
import { Button } from '@/ui';

function Recovery({ title, body, detail }: { title: string; body: string; detail?: string }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 p-6 text-center">
      <p className="font-medium">{title}</p>
      <p className="max-w-[360px] text-sm text-fg-2">{body}</p>
      {detail ? <p className="max-w-[360px] break-words font-mono text-xs text-fg-3">{detail}</p> : null}
      <div className="flex gap-2">
        <Button onClick={() => location.reload()}>Reload</Button>
        <Button variant="primary" onClick={() => void resetApp()}>
          Reset app
        </Button>
      </div>
      <p className="text-xs text-fg-3">Resetting clears this device's offline copy of the app. Your chats and characters are safe on the server.</p>
    </div>
  );
}

/** Shown under a spinner that has been going for too long. */
export function StuckHelp({ after = 12_000 }: { after?: number }) {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setStuck(true), after);
    return () => clearTimeout(t);
  }, [after]);
  return stuck ? <Recovery title="This is taking longer than it should" body="Everloom may have been updated while this page was open. Reload, or reset the app if that doesn't help." /> : null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error) {
    // A missing script after an update: one automatic reload usually fixes it.
    if (/dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch/i.test(error.message)) reloadOnce();
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-bg">
        <Recovery title="Something went wrong" body="Everloom hit an error while loading. Reload, or reset the app if it keeps happening." detail={this.state.error.message} />
      </div>
    );
  }
}
