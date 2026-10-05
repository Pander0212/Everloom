/** A frame for an extension page: fetches the entry file (scripts and styles inlined), then runs it. */
import { Spinner } from '@/ui';
import type { FrameSpec } from './host';
import { useEntry } from './ScriptLayer';
import { ScriptFrame } from './ScriptFrame';

export default function EntryFrame({ spec, minHeight = 80, maxHeight = 2400, title }: { spec: FrameSpec; minHeight?: number; maxHeight?: number; title?: string }) {
  const doc = useEntry(spec.entry ? { id: spec.entry.extId, updatedAt: spec.entry.updatedAt } : null, spec.entry?.file ?? null);
  if (!spec.entry) return <ScriptFrame spec={spec} minHeight={minHeight} maxHeight={maxHeight} title={title} />;
  if (!doc) return <div className="flex justify-center py-8"><Spinner /></div>;
  return <ScriptFrame spec={{ ...spec, ...(doc.type === 'js' ? { code: doc.text } : { html: doc.text }) }} minHeight={minHeight} maxHeight={maxHeight} title={title} />;
}
