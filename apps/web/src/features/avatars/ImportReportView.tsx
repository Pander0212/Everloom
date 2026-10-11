/** An import report: what came in, what was approximated, what was skipped, and guessed links. */
import { Check, CircleSlash, Link2, Wand2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ImportReport } from '@everloom/engine';
import { Icon } from '@/ui';

type Lines = ImportReport['imported'];

function Group({ title, icon, lines, tone }: { title: string; icon: LucideIcon; lines: Lines; tone: string }) {
  if (!lines.length) return null;
  return (
    <section aria-label={title}>
      <h3 className={`mb-1 flex items-center gap-1.5 text-sm font-medium ${tone}`}>
        <Icon icon={icon} /> {title}
      </h3>
      <ul className="flex flex-col gap-1 text-sm">
        {lines.map((l, i) => (
          <li key={i}>
            <span className="font-medium">{l.what}</span>
            {l.detail ? <span className="text-fg-2">: {l.detail}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ImportReportView({ report }: { report: Pick<ImportReport, 'imported' | 'approximated' | 'skipped' | 'guessed' | 'source' | 'thirdParty'> }) {
  return (
    <div className="flex flex-col gap-3" data-testid="import-report">
      <p className="text-xs text-fg-3">
        From a {report.source}
        {report.thirdParty ? ' · third-party asset, personal use' : ''}
      </p>
      <Group title="Imported" icon={Check} lines={report.imported} tone="text-success" />
      <Group title="Approximated" icon={Wand2} lines={report.approximated} tone="text-warning" />
      <Group title="Skipped" icon={CircleSlash} lines={report.skipped} tone="text-fg-2" />
      {report.guessed.length ? (
        <section aria-label="Guessed links">
          <h3 className="mb-1 flex items-center gap-1.5 text-sm font-medium">
            <Icon icon={Link2} /> Matched by name
          </h3>
          <ul className="flex flex-col gap-1 text-xs text-fg-2">
            {report.guessed.slice(0, 40).map((g, i) => (
              <li key={i}>
                {g.from.split('/').pop()} → {g.to.split('/').pop()} ({g.how})
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
