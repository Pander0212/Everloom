import type { Settings } from '@everloom/engine';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { patch } from '@/lib/api';
import { qk, useSettings } from '@/lib/queries';
import { toastError } from '@/lib/store';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function useSettingsPatch() {
  const s = useSettings();
  const qc = useQueryClient();
  const update = async (p: DeepPartial<Settings>) => {
    const prev = qc.getQueryData<Settings>(qk.settings);
    if (prev) qc.setQueryData(qk.settings, mergeDeep(prev, p));
    try {
      const next = await patch<Settings>('/api/settings', p);
      qc.setQueryData(qk.settings, next);
    } catch (e) {
      if (prev) qc.setQueryData(qk.settings, prev);
      toastError(e);
    }
  };
  return { settings: s.data, update };
}

function mergeDeep<T>(a: T, b: any): T {
  const out: any = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? mergeDeep((a as any)[k] ?? {}, v) : v;
  return out;
}

export function Section({ title, description, children, action }: { title: string; description?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="py-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-fg-2">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
