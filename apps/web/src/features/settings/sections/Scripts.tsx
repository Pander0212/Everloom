/**
 * Settings › Scripts: the kill switch and limits, your own scripts, regex rules, quick replies, and
 * the creators you trust.
 */
import { importRegexScripts, RegexPlacement, type QuickReplySetInput, type RegexScript, type ScriptInput } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Pencil, Plus, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { del, get, post, put } from '@/lib/api';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, Checkbox, EmptyState, Field, FileButton, IconButton, Input, Select, Sheet, Switch, Textarea, ToggleRow, confirm } from '@/ui';
import { CodeView } from '@/scripting/CodeView';
import { saveJson, ScriptEditor } from '@/scripting/ScriptEditor';
import { Section, useSettingsPatch } from '../common';

interface Item<T> {
  id: string;
  data: T;
  approved?: boolean;
}

const useLib = <T,>(kind: 'script' | 'regex' | 'qr') => useQuery({ queryKey: ['script-lib', kind], queryFn: () => get<Item<T>[]>('/api/scripts/library', { kind }) });

export default function ScriptsSection() {
  const { settings, update } = useSettingsPatch();
  if (!settings) return null;
  const s = settings.scripts;
  const set = (patch: Partial<typeof s>) => void update({ scripts: patch } as never);
  return (
    <>
      <Section
        title="Scripts"
        description={
          <>
            Scripts from characters, presets, lorebooks and extensions, and your own. Each runs in a sealed frame and can only do what you allowed. Add <code className="whitespace-nowrap rounded-sm bg-surface-2 px-1">?safe=1</code> to the address to start with everything off.
          </>
        }
      >
        <div className="flex flex-col gap-1">
          <ToggleRow label="Allow scripts" description="Off stops every script, extension and message script at once." checked={s.enabled} onChange={(v) => set({ enabled: v })} />
          <ToggleRow label="Show HTML in messages" description="HTML blocks in messages, and text in the tag below, render as content in a frame. Off shows them as code." checked={s.renderHtml} onChange={(v) => set({ renderHtml: v })} />
          <ToggleRow label="Tavern Helper compatible globals" description="Cards written for Tavern Helper can use its common functions (same sandbox, same permissions)." checked={s.compat} onChange={(v) => set({ compat: v })} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Scripts inside messages" htmlFor="sc-mjs">
            <Select id="sc-mjs" value={s.messageJs} onChange={(e) => set({ messageJs: e.target.value as typeof s.messageJs })}>
              <option value="approved">Only for characters I approved</option>
              <option value="always">Always (no permissions unless approved)</option>
              <option value="never">Never</option>
            </Select>
          </Field>
          <Field label="HTML tag" htmlFor="sc-tag" hint={`Text inside <${s.htmlTag}>…</${s.htmlTag}> renders as HTML.`}>
            <Input id="sc-tag" defaultValue={s.htmlTag} onBlur={(e) => /^[a-z][a-z0-9-]{0,40}$/.test(e.target.value) && set({ htmlTag: e.target.value })} />
          </Field>
          <Field label="Scripts running at once" htmlFor="sc-max">
            <Input id="sc-max" type="number" min={1} max={20} defaultValue={s.maxActive} onBlur={(e) => set({ maxActive: Math.max(1, Math.min(20, Number(e.target.value) || 6)) })} />
          </Field>
          <Field label="Time limit per task (ms)" htmlFor="sc-time" hint="A loop that runs longer is stopped.">
            <Input id="sc-time" type="number" min={100} max={10000} defaultValue={s.timeBudgetMs} onBlur={(e) => set({ timeBudgetMs: Math.max(100, Math.min(10_000, Number(e.target.value) || 1500)) })} />
          </Field>
          <Field label="Model calls per minute (per script)" htmlFor="sc-gen" hint="Model calls cost money; they show in the call log.">
            <Input id="sc-gen" type="number" min={1} max={60} defaultValue={s.generatePerMinute} onBlur={(e) => set({ generatePerMinute: Math.max(1, Math.min(60, Number(e.target.value) || 6)) })} />
          </Field>
        </div>
      </Section>
      <MyScripts />
      <RegexRules />
      <QuickReplies />
      <Trusted />
    </>
  );
}

function MyScripts() {
  const qc = useQueryClient();
  const lib = useLib<ScriptInput>('script');
  const [editing, setEditing] = useState<Item<ScriptInput> | 'new' | null>(null);
  const [reviewing, setReviewing] = useState<Item<ScriptInput> | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['script-lib'] }), qc.invalidateQueries({ queryKey: ['scripts-active'] })]);
  const save = async (data: ScriptInput) => {
    try {
      if (editing && editing !== 'new') await put(`/api/scripts/library/${editing.id}`, { kind: 'script', data });
      else await post('/api/scripts/library', { kind: 'script', data });
      await refresh();
    } catch (e) {
      toastError(e);
      throw e;
    }
  };
  const importFiles = async (files: File[]) => {
    for (const f of files) {
      try {
        const raw = JSON.parse(await f.text());
        const list = Array.isArray(raw) ? raw : [raw];
        for (const data of list) await post('/api/scripts/library', { kind: 'script', data, imported: true });
        toast({ title: `Imported ${list.length} script${list.length === 1 ? '' : 's'}`, lines: ['Imported scripts stay off until you approve them.'] });
      } catch (e) {
        toastError(new Error(`${f.name}: ${(e as Error).message}`));
      }
    }
    await refresh();
  };
  const items = lib.data ?? [];
  return (
    <Section
      title="My scripts"
      description="Scripts you write here are yours, so they're approved as you save them."
      action={
        <div className="flex gap-1">
          <FileButton accept=".json,application/json" multiple onFiles={importFiles} icon={Upload} size="sm" variant="ghost">
            Import
          </FileButton>
          <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>
            New script
          </Button>
        </div>
      }
    >
      {!items.length ? <EmptyState title="No scripts yet" body="Write one, or import a script file." /> : null}
      <ul className="flex flex-col gap-2" aria-label="My scripts">
        {items.map((it) => (
          <li key={it.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{it.data.name}</span>
              <span className="block truncate text-xs text-fg-2">{(it.data.permissions ?? []).join(', ') || 'No permissions'}</span>
            </span>
            {it.approved ? null : (
              <Button size="sm" icon={ShieldCheck} onClick={() => setReviewing(it)}>
                Review
              </Button>
            )}
            <Switch
              label={`Run ${it.data.name}`}
              checked={it.data.enabled !== false}
              onChange={async (v) => {
                await put(`/api/scripts/library/${it.id}`, { kind: 'script', data: { ...it.data, enabled: v } }).catch(toastError);
                await refresh();
              }}
            />
            <IconButton size="sm" icon={Pencil} label={`Edit ${it.data.name}`} onClick={() => setEditing(it)} />
            <IconButton size="sm" icon={Download} label={`Export ${it.data.name}`} onClick={() => saveJson(`${it.data.name}.json`, it.data)} />
            <IconButton
              size="sm"
              icon={Trash2}
              label={`Delete ${it.data.name}`}
              onClick={async () => {
                if (!(await confirm({ title: `Delete ${it.data.name}?`, description: 'Its stored data goes too.', confirmLabel: 'Delete', danger: true }))) return;
                await del(`/api/scripts/library/${it.id}?kind=script`).catch(toastError);
                await refresh();
              }}
            />
          </li>
        ))}
      </ul>
      <ScriptEditor open={!!editing} onOpenChange={(o) => !o && setEditing(null)} initial={editing && editing !== 'new' ? editing.data : null} onSave={save} />
      <Sheet
        open={!!reviewing}
        onOpenChange={(o) => !o && setReviewing(null)}
        title={reviewing ? `Approve ${reviewing.data.name}?` : ''}
        description="Imported scripts stay off until you've looked at them."
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setReviewing(null)}>
              Keep disabled
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                await post(`/api/scripts/library/${reviewing!.id}/approve`, { kind: 'script' }).catch(toastError);
                setReviewing(null);
                await refresh();
              }}
            >
              Enable
            </Button>
          </div>
        }
      >
        {reviewing ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">Permissions: {(reviewing.data.permissions ?? []).join(', ') || 'none'}</p>
            <CodeView code={reviewing.data.code} maxHeight={480} />
          </div>
        ) : null}
      </Sheet>
    </Section>
  );
}

const PLACEMENTS: Array<{ v: RegexPlacement; label: string }> = [
  { v: RegexPlacement.userInput, label: 'What I write' },
  { v: RegexPlacement.aiOutput, label: 'What the AI writes' },
  { v: RegexPlacement.worldInfo, label: 'World info' },
];

function RegexRules() {
  const qc = useQueryClient();
  const lib = useLib<RegexScript>('regex');
  const [edit, setEdit] = useState<{ id?: string; data: RegexScript } | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['script-lib'] }), qc.invalidateQueries({ queryKey: ['scripts-active'] })]);
  const blank = (): RegexScript => importRegexScripts([{ scriptName: 'New rule', findRegex: '/example/g', replaceString: 'example', placement: [2] }])[0]!;
  const importFiles = async (files: File[]) => {
    for (const f of files) {
      try {
        const rules = importRegexScripts(JSON.parse(await f.text()));
        if (!rules.length) throw new Error('no regex rules in it');
        for (const data of rules) await post('/api/scripts/library', { kind: 'regex', data, imported: true });
        toast({ title: `Imported ${rules.length} rule${rules.length === 1 ? '' : 's'}`, lines: ['Imported rules stay off until you approve them.'] });
      } catch (e) {
        toastError(new Error(`${f.name}: ${(e as Error).message}`));
      }
    }
    await refresh();
  };
  const save = async () => {
    if (!edit) return;
    try {
      if (edit.id) await put(`/api/scripts/library/${edit.id}`, { kind: 'regex', data: edit.data });
      else await post('/api/scripts/library', { kind: 'regex', data: edit.data });
      setEdit(null);
      await refresh();
    } catch (e) {
      toastError(e);
    }
  };
  const d = edit?.data;
  return (
    <Section
      title="Regex rules"
      description="Find-and-replace on what you and the AI write, only on what's shown, or only on what's sent. SillyTavern rule files import as they are."
      action={
        <div className="flex gap-1">
          <FileButton accept=".json,application/json" multiple onFiles={importFiles} icon={Upload} size="sm" variant="ghost">
            Import
          </FileButton>
          <Button size="sm" icon={Plus} onClick={() => setEdit({ data: blank() })}>
            New rule
          </Button>
        </div>
      }
    >
      <ul className="flex flex-col gap-2" aria-label="Regex rules">
        {(lib.data ?? []).map((it) => (
          <li key={it.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{it.data.scriptName}</span>
              <span className="block truncate font-mono text-xs text-fg-2">{it.data.findRegex}</span>
            </span>
            {it.data.markdownOnly ? <Badge>Shown only</Badge> : it.data.promptOnly ? <Badge>Sent only</Badge> : null}
            {it.approved ? null : (
              <Button size="sm" icon={ShieldCheck} onClick={async () => (await post(`/api/scripts/library/${it.id}/approve`, { kind: 'regex' }).catch(toastError), await refresh())}>
                Approve
              </Button>
            )}
            <IconButton size="sm" icon={Pencil} label={`Edit ${it.data.scriptName}`} onClick={() => setEdit({ id: it.id, data: it.data })} />
            <IconButton size="sm" icon={Download} label={`Export ${it.data.scriptName}`} onClick={() => saveJson(`regex-${it.data.scriptName}.json`, it.data)} />
            <IconButton size="sm" icon={Trash2} label={`Delete ${it.data.scriptName}`} onClick={async () => (await del(`/api/scripts/library/${it.id}?kind=regex`).catch(toastError), await refresh())} />
          </li>
        ))}
      </ul>
      <Sheet
        open={!!edit}
        onOpenChange={(o) => !o && setEdit(null)}
        title={edit?.id ? 'Edit rule' : 'New rule'}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save}>
              Save
            </Button>
          </div>
        }
      >
        {d ? (
          <div className="flex flex-col gap-3">
            <Field label="Name" htmlFor="rx-name">
              <Input id="rx-name" value={d.scriptName} onChange={(e) => setEdit({ ...edit!, data: { ...d, scriptName: e.target.value } })} />
            </Field>
            <Field label="Find" htmlFor="rx-find" hint="/pattern/flags, as in SillyTavern.">
              <Input id="rx-find" className="font-mono" value={d.findRegex} onChange={(e) => setEdit({ ...edit!, data: { ...d, findRegex: e.target.value } })} />
            </Field>
            <Field label="Replace with" htmlFor="rx-rep" hint="$1, $<name> and {{match}} insert what was found; macros work.">
              <Textarea id="rx-rep" className="font-mono" rows={4} value={d.replaceString} onChange={(e) => setEdit({ ...edit!, data: { ...d, replaceString: e.target.value } })} />
            </Field>
            <fieldset className="flex flex-wrap gap-4">
              <legend className="mb-1 text-sm font-medium">Applies to</legend>
              {PLACEMENTS.map((p) => (
                <label key={p.v} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={d.placement.includes(p.v)} onChange={(v) => setEdit({ ...edit!, data: { ...d, placement: v ? [...d.placement, p.v] : d.placement.filter((x) => x !== p.v) } })} label={p.label} />
                  <span aria-hidden="true">{p.label}</span>
                </label>
              ))}
            </fieldset>
            <Field label="Changes" htmlFor="rx-target">
              <Select id="rx-target" value={d.markdownOnly ? 'display' : d.promptOnly ? 'prompt' : 'stored'} onChange={(e) => setEdit({ ...edit!, data: { ...d, markdownOnly: e.target.value === 'display', promptOnly: e.target.value === 'prompt' } })}>
                <option value="stored">The saved text</option>
                <option value="display">Only what's shown</option>
                <option value="prompt">Only what's sent to the model</option>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From depth" htmlFor="rx-min" hint="0 = the newest message">
                <Input id="rx-min" type="number" value={d.minDepth ?? ''} onChange={(e) => setEdit({ ...edit!, data: { ...d, minDepth: e.target.value === '' ? null : Number(e.target.value) } })} />
              </Field>
              <Field label="To depth" htmlFor="rx-max">
                <Input id="rx-max" type="number" value={d.maxDepth ?? ''} onChange={(e) => setEdit({ ...edit!, data: { ...d, maxDepth: e.target.value === '' ? null : Number(e.target.value) } })} />
              </Field>
            </div>
            <ToggleRow label="Off" checked={d.disabled} onChange={(v) => setEdit({ ...edit!, data: { ...d, disabled: v } })} />
          </div>
        ) : null}
      </Sheet>
    </Section>
  );
}

function QuickReplies() {
  const qc = useQueryClient();
  const lib = useLib<QuickReplySetInput>('qr');
  const [edit, setEdit] = useState<{ id?: string; data: QuickReplySetInput } | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['script-lib'] }), qc.invalidateQueries({ queryKey: ['scripts-active'] })]);
  const save = async () => {
    if (!edit) return;
    try {
      const data = { ...edit.data, items: (edit.data.items ?? []).filter((i) => i.label.trim() && i.message.trim()) };
      if (edit.id) await put(`/api/scripts/library/${edit.id}`, { kind: 'qr', data });
      else await post('/api/scripts/library', { kind: 'qr', data });
      setEdit(null);
      await refresh();
    } catch (e) {
      toastError(e);
    }
  };
  const items = edit?.data.items ?? [];
  const setItems = (next: typeof items) => setEdit({ ...edit!, data: { ...edit!.data, items: next } });
  return (
    <Section
      title="Quick replies"
      description="Buttons above the message box that send text or run a command (start it with /). Characters can bring their own sets."
      action={
        <Button size="sm" icon={Plus} onClick={() => setEdit({ data: { id: `q${Date.now().toString(36)}`, name: 'My replies', items: [{ id: 'a', label: 'Look around', message: 'I look around.', fillOnly: false }], enabled: true } })}>
          New set
        </Button>
      }
    >
      <ul className="flex flex-col gap-2" aria-label="Quick reply sets">
        {(lib.data ?? []).map((it) => (
          <li key={it.id} className="flex items-center gap-2 rounded-lg border border-line p-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{it.data.name}</span>
              <span className="block truncate text-xs text-fg-2">{(it.data.items ?? []).map((i) => i.label).join(' · ')}</span>
            </span>
            <Switch label={`Show ${it.data.name}`} checked={it.data.enabled !== false} onChange={async (v) => (await put(`/api/scripts/library/${it.id}`, { kind: 'qr', data: { ...it.data, enabled: v } }).catch(toastError), await refresh())} />
            <IconButton size="sm" icon={Pencil} label={`Edit ${it.data.name}`} onClick={() => setEdit({ id: it.id, data: it.data })} />
            <IconButton size="sm" icon={Trash2} label={`Delete ${it.data.name}`} onClick={async () => (await del(`/api/scripts/library/${it.id}?kind=qr`).catch(toastError), await refresh())} />
          </li>
        ))}
      </ul>
      <Sheet
        open={!!edit}
        onOpenChange={(o) => !o && setEdit(null)}
        title={edit?.id ? 'Edit quick replies' : 'New quick replies'}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save}>
              Save
            </Button>
          </div>
        }
      >
        {edit ? (
          <div className="flex flex-col gap-3">
            <Field label="Set name" htmlFor="qr-name">
              <Input id="qr-name" value={edit.data.name} onChange={(e) => setEdit({ ...edit, data: { ...edit.data, name: e.target.value } })} />
            </Field>
            {items.map((it, i) => (
              <div key={it.id} className="flex flex-col gap-2 rounded-md border border-line p-3">
                <div className="flex gap-2">
                  <Input aria-label={`Label ${i + 1}`} placeholder="Label" value={it.label} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  <IconButton icon={Trash2} label={`Remove reply ${i + 1}`} onClick={() => setItems(items.filter((_, j) => j !== i))} />
                </div>
                <Textarea aria-label={`Message ${i + 1}`} placeholder="Text to send, or /command" rows={2} value={it.message} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, message: e.target.value } : x)))} />
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={!!it.fillOnly} onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, fillOnly: v } : x)))} label={`Put reply ${i + 1} in the box instead of sending`} />
                  <span aria-hidden="true">Put it in the box instead of sending</span>
                </label>
              </div>
            ))}
            <div>
              <Button size="sm" icon={Plus} onClick={() => setItems([...items, { id: `r${Date.now().toString(36)}`, label: '', message: '', fillOnly: false }])}>
                Add a reply
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>
    </Section>
  );
}

function Trusted() {
  const q = useQuery({ queryKey: ['script-trust'], queryFn: () => get<Array<{ kind: string; value: string }>>('/api/scripts/trust') });
  const qc = useQueryClient();
  if (!q.data?.length) return null;
  return (
    <Section title="Trusted creators" description="Scripts from these creators are approved when you import their characters.">
      <ul className="flex flex-col gap-1">
        {q.data.map((t) => (
          <li key={`${t.kind}:${t.value}`} className="flex items-center gap-2 text-sm">
            <span className="flex-1">{t.value}</span>
            <IconButton
              size="sm"
              icon={Trash2}
              label={`Stop trusting ${t.value}`}
              onClick={async () => {
                await post('/api/scripts/trust', { kind: t.kind, value: t.value, on: false }).catch(toastError);
                await qc.invalidateQueries({ queryKey: ['script-trust'] });
              }}
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}
