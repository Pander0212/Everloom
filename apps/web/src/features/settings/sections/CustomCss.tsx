import type { CssSnippet } from '@everloom/engine';
import { ArrowDown, ArrowUp, MoreHorizontal, Plus, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { post } from '@/lib/api';
import { readSafeMode, setSafeMode } from '@/lib/customCss';
import { toastError } from '@/lib/store';
import { Badge, Button, confirm, EmptyState, Field, IconButton, Input, Menu, Sheet, Switch, Textarea, ToggleRow } from '@/ui';
import { Section, useSettingsPatch } from '../common';

const newId = () => Math.random().toString(36).slice(2, 10);

/** How many rules the browser accepted; 0 for non-empty CSS means nothing will apply. */
export function countRules(css: string): number | null {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    return sheet.cssRules.length;
  } catch {
    return null;
  }
}

export default function CustomCssSection() {
  const { settings, update } = useSettingsPatch();
  const [editing, setEditing] = useState<CssSnippet | null>(null);
  const [safe, setSafe] = useState(() => readSafeMode(''));
  if (!settings) return null;
  const snippets = settings.css?.snippets ?? [];
  const save = (next: CssSnippet[]) => update({ css: { snippets: next } });
  const move = (i: number, d: -1 | 1) => {
    const next = [...snippets];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    void save(next);
  };
  return (
    <Section
      title="Custom CSS"
      description={
        <>
          Restyle Everloom with your own snippets. Settings always keeps the default look, and adding <code className="rounded-sm bg-surface-2 px-1">?safe-mode</code> to any address turns custom CSS off.
        </>
      }
      action={
        <Button size="sm" icon={Plus} onClick={() => setEditing({ id: newId(), name: '', css: '', enabled: true })}>
          New snippet
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <ToggleRow
          label="Safe mode"
          description="Turn off all custom CSS on this device until you close the tab."
          checked={safe}
          onChange={(v) => {
            setSafeMode(v);
            setSafe(v);
          }}
        />
        {snippets.length ? (
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line" aria-label="Snippets">
            {snippets.map((s, i) => (
              <li key={s.id} className="flex items-center gap-2 px-3 py-2">
                <Switch label={`Enable ${s.name}`} checked={s.enabled} onChange={(v) => void save(snippets.map((x) => (x.id === s.id ? { ...x, enabled: v } : x)))} />
                <button className="pressable min-w-0 flex-1 truncate text-left text-sm font-medium" onClick={() => setEditing(s)}>
                  {s.name || 'Untitled'}
                  <span className="ml-2 text-xs font-normal text-fg-3">{s.css.split('\n').length} lines</span>
                </button>
                <IconButton size="sm" icon={ArrowUp} label={`Move ${s.name} up`} disabled={i === 0} onClick={() => move(i, -1)} />
                <IconButton size="sm" icon={ArrowDown} label={`Move ${s.name} down`} disabled={i === snippets.length - 1} onClick={() => move(i, 1)} />
                <Menu
                  trigger={<IconButton size="sm" icon={MoreHorizontal} label={`${s.name} actions`} />}
                  items={[
                    { label: 'Edit', onSelect: () => setEditing(s) },
                    { label: 'Duplicate', onSelect: () => void save([...snippets.slice(0, i + 1), { ...s, id: newId(), name: `${s.name} copy` }, ...snippets.slice(i + 1)]) },
                    {
                      label: 'Delete',
                      danger: true,
                      onSelect: async () => {
                        if (await confirm({ title: `Delete “${s.name}”?`, confirmLabel: 'Delete', danger: true })) void save(snippets.filter((x) => x.id !== s.id));
                      },
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No snippets yet" body="Write one yourself, or describe the look you want and let the assistant write it." />
        )}
      </div>
      <SnippetSheet
        snippet={editing}
        onClose={() => setEditing(null)}
        onSave={(s) => {
          const exists = snippets.some((x) => x.id === s.id);
          void save(exists ? snippets.map((x) => (x.id === s.id ? s : x)) : [...snippets, s]);
          setEditing(null);
        }}
      />
    </Section>
  );
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

function SnippetSheet({ snippet, onClose, onSave }: { snippet: CssSnippet | null; onClose: () => void; onSave: (s: CssSnippet) => void }) {
  const [name, setName] = useState('');
  const [css, setCss] = useState('');
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [undo, setUndo] = useState<string | null>(null);
  useEffect(() => {
    setName(snippet?.name ?? '');
    setCss(snippet?.css ?? '');
    setTurns([]);
    setUndo(null);
    setAsk('');
  }, [snippet]);
  const rules = css.trim() ? countRules(css) : null;
  const assist = async () => {
    if (ask.trim().length < 3) return;
    setBusy(true);
    try {
      const r = await post<{ name: string; css: string; notes: string }>('/api/css/assist', { request: ask, current: css, history: turns.slice(-10) });
      setUndo(css);
      setCss(r.css);
      if (!name.trim() && r.name) setName(r.name);
      setTurns((t) => [...t, { role: 'user', content: ask }, { role: 'assistant', content: r.notes || 'Updated the snippet.' }]);
      setAsk('');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={!!snippet}
      onOpenChange={(o) => !o && onClose()}
      title={snippet?.name ? 'Edit snippet' : 'New snippet'}
      size="lg"
      footer={
        <Button variant="primary" block disabled={!css.trim()} onClick={() => snippet && onSave({ ...snippet, name: name.trim() || 'Untitled', css })}>
          Save snippet
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" htmlFor="snippet-name">
          <Input id="snippet-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bigger story text" maxLength={80} />
        </Field>
        <div className="rounded-md bg-surface-2 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <Sparkles size={15} className="text-accent-text" /> CSS assistant
          </p>
          {turns.length ? (
            <ol className="mb-2 flex flex-col gap-1.5 text-sm" aria-label="Assistant conversation">
              {turns.map((t, i) => (
                <li key={i} className={t.role === 'user' ? 'text-fg' : 'text-fg-2'}>
                  <span className="font-medium">{t.role === 'user' ? 'You: ' : 'Assistant: '}</span>
                  {t.content}
                </li>
              ))}
            </ol>
          ) : null}
          <div className="flex items-end gap-2">
            <Textarea
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              rows={1}
              maxRows={5}
              aria-label="Describe the change"
              className="!bg-surface"
              placeholder={css.trim() ? 'Make the user bubbles green…' : 'Warmer colors, a serif story font…'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void assist();
                }
              }}
            />
            <Button loading={busy} disabled={ask.trim().length < 3} onClick={assist}>
              {css.trim() ? 'Revise' : 'Write'}
            </Button>
          </div>
          {undo !== null ? (
            <button className="pressable mt-2 text-xs font-medium text-accent-text" onClick={() => (setCss(undo), setUndo(null))}>
              Undo the assistant’s change
            </button>
          ) : null}
        </div>
        <Field
          label="CSS"
          hint="Use the design tokens (--accent, --surface…) and the ev-* class hooks. No @import or remote url(); they are removed on save."
          trailing={rules === null ? null : rules === 0 ? <Badge tone="warning">No valid rules</Badge> : <Badge>{rules} rules</Badge>}
        >
          <Textarea value={css} onChange={(e) => setCss(e.target.value)} rows={10} maxRows={30} spellCheck={false} aria-label="CSS" className="font-mono text-[13px]" placeholder=":root { --accent: #3b82f6; }" />
        </Field>
      </div>
    </Sheet>
  );
}
