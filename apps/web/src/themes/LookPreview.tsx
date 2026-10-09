/** A small live render of a theme: its colors, type and shapes on a tiny play screen, scenery running. */
import { useRef } from 'react';
import { cx } from '@/lib/format';
import { look as lookOf, schemeFor, type Scheme } from './looks';
import { SceneryLayer } from './scenery/SceneryLayer';

export function LookPreview({ id, scheme, active, className }: { id: string; scheme: Scheme; active?: boolean; className?: string }) {
  const l = lookOf(id);
  const s = schemeFor(l, scheme);
  const col = useRef<HTMLDivElement>(null);
  return (
    <div data-look={l.id} data-theme={s} className={cx('ev-preview relative h-36 overflow-hidden rounded-md text-fg', active ? 'ring-2 ring-accent' : 'ring-1 ring-line', className)} style={{ backgroundColor: 'var(--bg)', backgroundImage: 'var(--texture)', fontFamily: 'var(--font-ui)', colorScheme: s }}>
      {l.scenery ? <SceneryLayer lookId={l.id} column={col} fpsCap={15} minMargin={20} className="absolute inset-0 h-full w-full" /> : null}
      <div ref={col} className="relative mx-auto flex h-full w-[64%] flex-col gap-1.5 py-2" aria-hidden="true">
        <div className="flex items-center gap-1.5 rounded-sm px-1.5 py-1" style={{ background: 'var(--surface)' }}>
          <span className="size-3 rounded-full" style={{ background: 'var(--surface-3)' }} />
          <span className="truncate text-[10px] font-semibold leading-3" style={{ fontFamily: 'var(--font-heading)' }}>
            {l.name}
          </span>
        </div>
        <p className="line-clamp-3 px-0.5 text-[10px] leading-[13px]" style={{ fontFamily: 'var(--font-story)' }}>
          The lamp gutters. <em className="text-fg-2">She looks up.</em> &ldquo;You came back,&rdquo; she says.
        </p>
        <div className="ml-auto max-w-[80%] rounded-sm px-1.5 py-0.5 text-[10px] leading-[13px]" style={{ background: 'var(--surface-2)', fontFamily: 'var(--font-story)' }}>
          I promised.
        </div>
        <div className="mt-auto flex items-center gap-1 rounded-md px-1.5 py-1" style={{ background: 'var(--surface-2)' }}>
          <span className="h-1.5 flex-1 rounded-full" style={{ background: 'var(--surface-3)' }} />
          <span className="size-3.5 rounded-full" style={{ background: 'var(--accent)' }} />
        </div>
      </div>
    </div>
  );
}
