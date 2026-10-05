/** Script UI state (console, running frames, panels, dialogs): light, so the app shell can show it. */
import { create } from 'zustand';
import { post } from '@/lib/api';
import type { FrameKind, FrameSpec } from './host';

export interface ConsoleEntry {
  at: number;
  level: 'log' | 'info' | 'warn' | 'error';
  text: string;
}

interface ScriptUi {
  console: Record<string, ConsoleEntry[]>;
  running: Record<string, { name: string; kind: FrameKind; count: number; stopped?: string }>;
  panels: Array<{ id: string; title: string; spec: FrameSpec }>;
  /** Bumped to restart a script's frames. */
  restarts: Record<string, number>;
  modal: null | { title: string; body?: string; fields: ModalField[]; buttons: Array<{ id: string; label: string; tone?: 'primary' | 'danger' }>; from: string; resolve: (r: { button: string | null; values: Record<string, string> }) => void };
}
export interface ModalField {
  id: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'select' | 'checkbox';
  options?: Array<{ value: string; label: string }>;
  value?: string;
}

export const useScriptUi = create<ScriptUi>(() => ({ console: {}, running: {}, panels: [], modal: null, restarts: {} }));
export const restartScript = (key: string) => useScriptUi.setState((s) => ({ restarts: { ...s.restarts, [key]: (s.restarts[key] ?? 0) + 1 } }));

export function logTo(key: string, level: ConsoleEntry['level'], text: string) {
  useScriptUi.setState((s) => {
    const list = [...(s.console[key] ?? []), { at: Date.now(), level, text: text.slice(0, 4000) }].slice(-200);
    return { console: { ...s.console, [key]: list } };
  });
  // Extension errors also go to the extension's error log on the server.
  if (level === 'error' && key.startsWith('extension:')) {
    const id = key.split(':')[1]!;
    void post(`/api/extensions/${encodeURIComponent(id)}/errors`, { where: 'app', message: text.slice(0, 1900) }).catch(() => undefined);
  }
}

export function markRunning(spec: FrameSpec, delta: number, stopped?: string) {
  useScriptUi.setState((s) => {
    const cur = s.running[spec.key] ?? { name: spec.name, kind: spec.kind, count: 0 };
    const next = { ...cur, count: Math.max(0, cur.count + delta), ...(stopped ? { stopped } : delta > 0 ? { stopped: undefined } : {}) };
    return { running: { ...s.running, [spec.key]: next } };
  });
}


/** Open an extension's panel (from the command menu or a composer button). */
export function openExtensionPanel(ext: { id: string; key: string; name: string; permissions: FrameSpec['permissions']; updatedAt: number }, panel: { id: string; title: string; file: string }, chatId: string | null, characterId: string | null) {
  const id = `${ext.key}:${panel.id}`;
  const spec: FrameSpec = { kind: 'panel', key: ext.key, name: ext.name, permissions: ext.permissions, chatId, characterId, extId: ext.id, entry: { extId: ext.id, file: panel.file, updatedAt: ext.updatedAt } };
  useScriptUi.setState((s) => ({ panels: [...s.panels.filter((p) => p.id !== id), { id, title: panel.title, spec }] }));
}
