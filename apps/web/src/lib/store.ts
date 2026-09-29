import type { Settings } from '@everloom/engine';
import { create } from 'zustand';

export interface ToastItem {
  id: number;
  title: string;
  lines?: string[];
  tone?: 'neutral' | 'success' | 'danger' | 'reward';
  action?: { label: string; run: () => void };
  duration?: number;
}

interface UiState {
  connection: 'online' | 'reconnecting' | 'offline';
  toasts: ToastItem[];
  toast: (t: Omit<ToastItem, 'id'>) => number;
  dismiss: (id: number) => void;
  setConnection: (c: UiState['connection']) => void;
  settings: Settings | null;
  setSettings: (s: Settings) => void;
}

let toastId = 1;

export const useUi = create<UiState>((set) => ({
  connection: 'online',
  toasts: [],
  toast: (t) => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setConnection: (connection) => set({ connection }),
  settings: null,
  setSettings: (settings) => set({ settings }),
}));

export const toast = (t: Omit<ToastItem, 'id'> | string) => useUi.getState().toast(typeof t === 'string' ? { title: t } : t);
export const toastError = (e: unknown) => useUi.getState().toast({ title: e instanceof Error ? e.message : String(e), tone: 'danger' });
