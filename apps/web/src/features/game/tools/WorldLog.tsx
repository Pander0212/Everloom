import type { Op } from '@everloom/engine';
import { formatClock, formatDate } from '@everloom/engine';
import { History } from 'lucide-react';
import { useEffect } from 'react';
import { EmptyState } from '@/ui';
import { useGame } from '../context';
import { NoCampaign, ToolSheet } from './ToolSheet';

export default function WorldLog() {
  const { state: s, apply } = useGame();
  const unseen = s?.worldLog.filter((e) => !e.seen).length ?? 0;
  useEffect(() => {
    if (unseen) void apply({ type: 'world.seen' } as Op, { quiet: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return <ToolSheet title="Meanwhile…"><NoCampaign /></ToolSheet>;
  const log = s.worldLog.slice().reverse();
  let lastDay = '';
  return (
    <ToolSheet title="Meanwhile…" description="What happened in the world while time passed.">
      {log.length ? (
        <div className="flex flex-col">
          {log.map((e) => {
            const day = formatDate(e.at, s.meta.calendar, '{weekday}, {month} {day}');
            const header = day !== lastDay ? day : null;
            lastDay = day;
            return (
              <div key={e.id}>
                {header ? <h3 className="pb-1 pt-4 text-xs font-medium text-fg-3 first:pt-0">{header}</h3> : null}
                <div className="flex gap-3 py-1.5 text-sm">
                  <span className="w-16 flex-none tabular-nums text-fg-3">{formatClock(e.at, s.meta.calendar)}</span>
                  <span className={e.seen ? 'text-fg-2' : 'text-fg'}>{e.text}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={History} title="All quiet" body="Events, rumors and people's comings and goings appear here." />
      )}
    </ToolSheet>
  );
}
