/** Write or edit one script: code, permissions, when it runs and its buttons. */
import { PERMISSION_INFO, SCRIPT_PERMISSIONS, SCRIPT_TRIGGERS, TRIGGER_LABELS, type Script, type ScriptInput, type ScriptPermission, type ScriptTrigger } from '@everloom/engine';
import { useEffect, useState } from 'react';
import { Button, Checkbox, Field, Input, Sheet, Textarea } from '@/ui';

const blank = (): ScriptInput => ({ id: `s${Date.now().toString(36)}`, name: 'New script', description: '', code: "everloom.on('message', (e) => {\n  everloom.log('A reply arrived', e.messageId);\n});\n", permissions: [], domains: [], triggers: ['chatOpen'], buttons: [], enabled: true, compat: false });

/** Download a JSON file (scripts and rules export). */
export function saveJson(name: string, data: unknown) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = name.replace(/[^\w .-]+/g, '').trim() || 'script.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function ScriptEditor({ open, onOpenChange, initial, onSave, note }: { open: boolean; onOpenChange: (o: boolean) => void; initial: ScriptInput | null; onSave: (s: ScriptInput) => Promise<void>; note?: string }) {
  const [s, setS] = useState<ScriptInput>(initial ?? blank());
  const [domains, setDomains] = useState('');
  const [buttons, setButtons] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const v = initial ?? blank();
    setS(v);
    setDomains((v.domains ?? []).join(', '));
    setButtons((v.buttons ?? []).map((b) => b.label).join(', '));
  }, [open, initial]);
  const perms = new Set(s.permissions ?? []);
  const triggers = new Set(s.triggers ?? []);
  const toggle = <T,>(set: Set<T>, v: T, on: boolean) => {
    const n = new Set(set);
    if (on) n.add(v);
    else n.delete(v);
    return [...n];
  };
  const save = async () => {
    setBusy(true);
    try {
      const labels = buttons.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8);
      const out: ScriptInput = {
        ...s,
        domains: domains.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean),
        buttons: labels.map((label, i) => ({ id: s.buttons?.find((b) => b.label === label)?.id ?? `b${i}`, label })),
        triggers: labels.length ? toggle(triggers, 'button' as ScriptTrigger, true) : (s.triggers ?? []),
      };
      await onSave(out);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      size="full"
      title={initial ? `Edit ${initial.name}` : 'New script'}
      description={note ?? 'Runs in a sealed frame with only the permissions you tick. See docs/scripting.md for the API.'}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save} disabled={!s.name.trim()}>
            Save
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="se-name">
            <Input id="se-name" value={s.name} maxLength={80} onChange={(e) => setS({ ...s, name: e.target.value })} />
          </Field>
          <Field label="Description" htmlFor="se-desc">
            <Input id="se-desc" value={s.description ?? ''} onChange={(e) => setS({ ...s, description: e.target.value })} />
          </Field>
        </div>
        <Field label="Code" htmlFor="se-code" hint="JavaScript. The everloom object is the whole API; nothing else outside the frame is reachable.">
          <Textarea id="se-code" value={s.code} onChange={(e) => setS({ ...s, code: e.target.value })} rows={14} maxRows={40} spellCheck={false} className="!font-mono !text-[13px] !leading-5" />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Permissions</legend>
          {SCRIPT_PERMISSIONS.map((p: ScriptPermission) => (
            <label key={p} className="flex cursor-pointer items-start gap-2.5 text-sm">
              <Checkbox checked={perms.has(p)} onChange={(v) => setS({ ...s, permissions: toggle(perms, p, v) })} label={PERMISSION_INFO[p].label} />
              <span aria-hidden="true">
                <span className="font-medium">{PERMISSION_INFO[p].label}</span> <span className="text-fg-2">— {PERMISSION_INFO[p].detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {perms.has('network') ? (
          <Field label="Sites it may reach" htmlFor="se-dom" hint="Comma separated, e.g. api.example.com, *.example.org">
            <Input id="se-dom" value={domains} onChange={(e) => setDomains(e.target.value)} />
          </Field>
        ) : null}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">When it runs</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {SCRIPT_TRIGGERS.map((t) => (
              <label key={t} className="flex cursor-pointer items-center gap-2.5 text-sm">
                <Checkbox checked={triggers.has(t)} onChange={(v) => setS({ ...s, triggers: toggle(triggers, t, v) })} label={TRIGGER_LABELS[t]} />
                <span aria-hidden="true">{TRIGGER_LABELS[t]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {triggers.has('timer') ? (
          <Field label="Every (seconds)" htmlFor="se-int">
            <Input id="se-int" type="number" min={5} value={s.intervalSeconds ?? 60} onChange={(e) => setS({ ...s, intervalSeconds: Math.max(5, Number(e.target.value) || 60) })} />
          </Field>
        ) : null}
        <Field label="Buttons above the message box" htmlFor="se-btn" hint="Comma separated labels. Pressing one sends a 'button' event with its id.">
          <Input id="se-btn" value={buttons} onChange={(e) => setButtons(e.target.value)} placeholder="Roll, Status" />
        </Field>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <Checkbox checked={!!s.compat} onChange={(v) => setS({ ...s, compat: v })} label="Tavern Helper compatible globals" />
          <span aria-hidden="true">Tavern Helper compatible globals (getVariables, eventOn, triggerSlash…)</span>
        </label>
      </div>
    </Sheet>
  );
}

export type { Script };
