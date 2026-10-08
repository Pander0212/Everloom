/**
 * The scripts running for one chat: a hidden frame per approved script (and per extension
 * background), timers, the chat's bridge for sending, and the chat-open event. Loaded only when
 * there is something to run.
 */
import type { ScriptSettings } from '@everloom/engine';
import { useEffect, useMemo, useState } from 'react';
import { get } from '@/lib/api';
import { scriptBus } from './bus';
import { setChatBridge, type FrameSpec } from './host';
import { logTo, useScriptUi } from './ui-store';
import { noteStarting } from './registry';
import { ScriptFrame } from './ScriptFrame';
import type { ActiveScript, ExtensionUi } from './types';

export interface LayerProps {
  chatId: string | null;
  characterId: string | null;
  settings: ScriptSettings;
  runnable: ActiveScript[];
  extensions: ExtensionUi[];
  send?: (text: string) => Promise<void>;
  swipeNew?: () => Promise<void>;
  /** App level: only global scripts that run "when Everloom opens". */
  global?: boolean;
  /** Called once this chat's frames are attached (they count as starting from then on). */
  onReady?: () => void;
}

/** An extension's entry file, ready for a frame. */
export function useEntry(ext: { id: string; updatedAt: number } | null, file: string | null) {
  const [doc, setDoc] = useState<{ type: 'html' | 'js'; text: string } | null>(null);
  useEffect(() => {
    if (!ext || !file) return;
    let live = true;
    get<{ type: 'html' | 'js'; text: string }>(`/api/extensions/${encodeURIComponent(ext.id)}/entry`, { file })
      .then((d) => live && setDoc(d))
      .catch((e) => logTo(`extension:${ext.id}:main`, 'error', `Couldn't load ${file}: ${(e as Error).message}`));
    return () => {
      live = false;
    };
  }, [ext?.id, ext?.updatedAt, file]);
  return doc;
}

function ExtensionBackground({ ext, chatId, characterId, settings }: { ext: ExtensionUi; chatId: string | null; characterId: string | null; settings: ScriptSettings }) {
  const doc = useEntry(ext, ext.background);
  // Starting until its file is here (then the frame takes over).
  useEffect(() => {
    noteStarting(`entry:${ext.key}`, !doc);
    return () => noteStarting(`entry:${ext.key}`, false);
  }, [ext.key, doc]);
  if (!doc) return null;
  const spec: FrameSpec = { kind: 'script', key: ext.key, name: ext.name, permissions: ext.permissions, chatId, characterId, extId: ext.id, scriptId: 'main', budgetMs: settings.timeBudgetMs, ...(doc.type === 'js' ? { code: doc.text } : { html: doc.text }) };
  return <ScriptFrame spec={spec} hidden />;
}

export default function ScriptLayer({ chatId, characterId, settings, runnable, extensions, send, swipeNew, global, onReady }: LayerProps) {
  const scripts = useMemo(() => {
    const wanted = runnable.filter((s) => (global ? s.ref.scope === 'global' && s.script.triggers.includes('load') : !(s.ref.scope === 'global' && s.script.triggers.length === 1 && s.script.triggers[0] === 'load')));
    // Extension scripts come as their own frames (below); the rest is limited by "how many at once".
    const own = wanted.filter((s) => s.ref.scope !== 'extension');
    const over = own.slice(Math.max(0, settings.maxActive));
    for (const s of over) logTo(s.key, 'warn', `Not started: more than ${settings.maxActive} scripts at once (Settings › Scripts)`);
    return own.slice(0, Math.max(0, settings.maxActive));
  }, [runnable, settings.maxActive, global]);

  const restarts = useScriptUi((s) => s.restarts);
  // The frames below attach in their own effects, which run before this one.
  useEffect(() => { onReady?.(); }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps
  // The chat's bridge: sending a message runs the normal reply flow.
  useEffect(() => {
    if (!chatId || !send) return;
    setChatBridge({ chatId, send, swipeNew: swipeNew ?? (async () => undefined) });
    return () => setChatBridge(null, chatId);
  }, [chatId, send, swipeNew]);

  // Timers and the chat-open event.
  useEffect(() => {
    const timers = scripts
      .filter((s) => s.script.triggers.includes('timer') && s.script.intervalSeconds)
      .map((s) => setInterval(() => scriptBus.emit('timer', { chatId, key: s.key }), Math.max(5, s.script.intervalSeconds!) * 1000));
    const open = setTimeout(() => chatId && scriptBus.emit('chatOpen', { chatId }), 1500);
    return () => {
      timers.forEach(clearInterval);
      clearTimeout(open);
    };
  }, [scripts, chatId]);

  return (
    <div className="hidden" aria-hidden="true" data-scripts={scripts.length}>
      {scripts.map((s) => (
        <ScriptFrame
          key={`${s.key}:${s.fingerprint}:${restarts[s.key] ?? 0}`}
          hidden
          spec={{
            kind: 'script',
            key: s.key,
            name: s.script.name,
            permissions: s.script.permissions,
            code: s.script.code,
            compat: s.script.compat,
            chatId: global ? null : chatId,
            characterId: s.ref.scope === 'character' ? s.ref.scopeId : characterId,
            scriptId: s.ref.scriptId,
            budgetMs: settings.timeBudgetMs,
            entries: s.ref.scope === 'lorebook' ? { book: s.ref.scopeId, uids: s.script.entries ?? [] } : undefined,
          }}
        />
      ))}
      {global ? null : extensions.filter((e) => e.background).map((e) => <ExtensionBackground key={`${e.id}:${e.updatedAt}:${restarts[e.key] ?? 0}`} ext={e} chatId={chatId} characterId={characterId} settings={settings} />)}
    </div>
  );
}
