import { post } from '@/lib/api';
import { toast, toastError } from '@/lib/store';
import { Button, Field, Input, ToggleRow } from '@/ui';
import { Section, useSettingsPatch } from '../common';

export default function LoreSection() {
  const { settings, update } = useSettingsPatch();
  if (!settings) return null;
  const wi = settings.wi;
  const n = (k: keyof typeof wi, label: string, hint?: string, step = 1) => (
    <Field label={label} htmlFor={`wi-${k}`} hint={hint}>
      <Input id={`wi-${k}`} type="number" step={step} value={wi[k] as number} onChange={(e) => update({ wi: { [k]: Number(e.target.value) } })} />
    </Field>
  );
  return (
    <>
      <Section title="Activation" description="Matches SillyTavern's World Info behavior.">
        <div className="grid grid-cols-2 gap-3">
          {n('scanDepth', 'Scan depth', 'Recent messages scanned for keys.')}
          {n('budgetPercent', 'Budget (% of context)')}
          {n('budgetCap', 'Budget cap (tokens)', '0 = no cap.')}
          {n('minActivations', 'Min activations', 'Scan deeper until reached.')}
          {n('maxRecursionSteps', 'Max recursion steps', '0 = unlimited.')}
        </div>
        <div className="mt-2 flex flex-col divide-y divide-line">
          <ToggleRow label="Recursive scanning" description="Activated entries can trigger others." checked={wi.recursive} onChange={(v) => update({ wi: { recursive: v } })} />
          <ToggleRow label="Case sensitive keys" checked={wi.caseSensitive} onChange={(v) => update({ wi: { caseSensitive: v } })} />
          <ToggleRow label="Match whole words" checked={wi.matchWholeWords} onChange={(v) => update({ wi: { matchWholeWords: v } })} />
          <ToggleRow label="Include speaker names" checked={wi.includeNames} onChange={(v) => update({ wi: { includeNames: v } })} />
        </div>
      </Section>
      <Section title="Semantic retrieval" description="Also activate entries whose meaning is close to the conversation, using the embeddings connection. Keywords keep working if it's off or fails.">
        <div className="flex flex-col divide-y divide-line">
          <ToggleRow label="Enable semantic retrieval" checked={wi.semantic} onChange={(v) => update({ wi: { semantic: v } })} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {n('semanticTopK', 'Max entries')}
          {n('semanticThreshold', 'Similarity threshold', '0–1', 0.05)}
        </div>
        <Button
          className="mt-4"
          variant="secondary"
          disabled={!wi.semantic}
          onClick={async () => {
            try {
              const r = await post<{ embedded: number }>('/api/lorebooks/embed');
              toast({ title: `Indexed ${r.embedded} entries`, tone: 'success' });
            } catch (e) {
              toastError(e);
            }
          }}
        >
          Build index now
        </Button>
      </Section>
    </>
  );
}
