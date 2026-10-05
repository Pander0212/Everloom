/**
 * Script panels and dialogs, shown by the app shell. Light: the sandbox host only loads when a
 * panel actually opens.
 */
import { lazy, Suspense, useState } from 'react';
import { Button, Checkbox, Dialog, Field, Input, Select, Sheet, Spinner, Textarea } from '@/ui';
import { useScriptUi } from './ui-store';

const PanelFrame = lazy(() => import('./EntryFrame'));

export function ScriptOverlays() {
  const panels = useScriptUi((s) => s.panels);
  const modal = useScriptUi((s) => s.modal);
  const close = (id: string) => useScriptUi.setState((s) => ({ panels: s.panels.filter((p) => p.id !== id) }));
  return (
    <>
      {panels.map((p) => (
        <Sheet key={p.id} open onOpenChange={(o) => !o && close(p.id)} title={p.title} description={`From ${p.spec.name}`} size="lg">
          <Suspense fallback={<Spinner />}>
            <PanelFrame spec={p.spec} minHeight={80} maxHeight={2400} title={p.title} />
          </Suspense>
        </Sheet>
      ))}
      {modal ? <ScriptModal key={modal.title + modal.from} /> : null}
    </>
  );
}

/** A dialog a script asked for, built from Everloom's own components (the script never touches it). */
function ScriptModal() {
  const modal = useScriptUi((s) => s.modal)!;
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(modal.fields.map((f) => [f.id, f.value ?? (f.type === 'checkbox' ? 'false' : '')])));
  const finish = (button: string | null) => {
    modal.resolve({ button, values });
    useScriptUi.setState({ modal: null });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && finish(null)}
      title={modal.title}
      description={modal.body ? <span className="whitespace-pre-wrap">{modal.body}</span> : `From ${modal.from}`}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {modal.buttons.map((b) => (
            <Button key={b.id} variant={b.tone === 'primary' ? 'primary' : b.tone === 'danger' ? 'danger' : 'secondary'} onClick={() => finish(b.id)}>
              {b.label}
            </Button>
          ))}
        </div>
      }
    >
      {modal.fields.length ? (
        <div className="flex flex-col gap-3">
          {modal.fields.map((f) =>
            f.type === 'checkbox' ? (
              <label key={f.id} className="flex cursor-pointer items-center gap-2.5 text-sm">
                <Checkbox checked={values[f.id] === 'true'} onChange={(v) => setValues({ ...values, [f.id]: String(v) })} label={f.label} />
                <span aria-hidden="true">{f.label}</span>
              </label>
            ) : (
              <Field key={f.id} label={f.label} htmlFor={`sm-${f.id}`}>
                {f.type === 'textarea' ? (
                  <Textarea id={`sm-${f.id}`} rows={3} value={values[f.id]} onChange={(e) => setValues({ ...values, [f.id]: e.target.value })} />
                ) : f.type === 'select' ? (
                  <Select id={`sm-${f.id}`} value={values[f.id]} onChange={(e) => setValues({ ...values, [f.id]: e.target.value })}>
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input id={`sm-${f.id}`} type={f.type === 'number' ? 'number' : 'text'} value={values[f.id]} onChange={(e) => setValues({ ...values, [f.id]: e.target.value })} />
                )}
              </Field>
            ),
          )}
        </div>
      ) : null}
    </Dialog>
  );
}
