import type { PresetDTO, PromptBlock, PromptPreset } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Download, MoreHorizontal, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { del, download, get, post, put, upload } from '@/lib/api';
import { cx } from '@/lib/format';
import { usePresets } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, confirm, Dialog, Field, FileButton, IconButton, Input, Menu, Select, Sheet, Switch, Textarea, ToggleRow } from '@/ui';
import { Section, useSettingsPatch } from '../common';

const MARKER_HINT: Record<string, string> = {
  worldInfoBefore: 'Activated world info (before)',
  worldInfoAfter: 'Activated world info (after)',
  personaDescription: 'Your persona description',
  charDescription: 'Character description',
  charPersonality: 'Character personality',
  scenario: 'Scenario',
  dialogueExamples: 'Example dialogue',
  chatHistory: 'The conversation',
  memory: 'Rolling summary and long-term memories',
  gameState: 'Live game state (time, place, vitals, NPCs…)',
  authorsNote: "Chat author's note",
};

export default function PromptsSection() {
  const presets = usePresets();
  const qc = useQueryClient();
  const { settings, update } = useSettingsPatch();
  const def = useQuery({ queryKey: ['preset-default'], queryFn: () => get<PromptPreset>('/api/presets/default'), staleTime: Infinity });
  const activeId = settings?.activePresetId ?? '';
  const active = presets.data?.find((p) => p.id === activeId) ?? null;
  const [draft, setDraft] = useState<PromptPreset | null>(null);
  const [editBlock, setEditBlock] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);

  useEffect(() => {
    const base = active?.preset ?? def.data;
    if (base) setDraft(structuredClone(base));
  }, [active, def.data]);
  if (!draft) return null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(active?.preset ?? def.data);

  const move = (i: number, d: number) => {
    const blocks = draft.blocks.slice();
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    setDraft({ ...draft, blocks });
  };
  const setBlock = (i: number, p: Partial<PromptBlock>) => setDraft({ ...draft, blocks: draft.blocks.map((b, k) => (k === i ? { ...b, ...p } : b)) });
  const save = async (asNew?: boolean) => {
    setSaving(true);
    try {
      let saved: PresetDTO;
      if (active && !asNew) saved = await put(`/api/presets/${active.id}`, { name: active.name, preset: draft });
      else {
        const name = asNew ? `${active?.name ?? 'Default'} copy` : 'My preset';
        saved = await post('/api/presets', { name, preset: draft });
        await update({ activePresetId: saved.id });
      }
      await qc.invalidateQueries({ queryKey: ['presets'] });
      toast({ title: 'Preset saved', tone: 'success' });
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };
  const importPreset = async (f: File) => {
    try {
      const saved = await upload<PresetDTO>('/api/presets/import', f, { name: f.name.replace(/\.json(\.evlt)?$/i, '') });
      await qc.invalidateQueries({ queryKey: ['presets'] });
      await update({ activePresetId: saved.id });
      toast({ title: `Imported ${saved.name}`, tone: 'success' });
    } catch (e) {
      toastError(e);
    }
  };
  const rename = () => active && setRenaming(active.name);
  const commitRename = async () => {
    const name = renaming?.trim();
    if (!active || !name) return;
    try {
      await put(`/api/presets/${active.id}`, { name, preset: draft });
      await qc.invalidateQueries({ queryKey: ['presets'] });
      setRenaming(null);
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async () => {
    if (!active || !(await confirm({ title: `Delete ${active.name}?`, confirmLabel: 'Delete', danger: true }))) return;
    await del(`/api/presets/${active.id}`);
    await update({ activePresetId: null });
    await qc.invalidateQueries({ queryKey: ['presets'] });
  };
  const addBlock = () => {
    setDraft({ ...draft, blocks: [...draft.blocks.slice(0, 1), { id: `custom_${Date.now().toString(36)}`, name: 'Custom prompt', kind: 'text', role: 'system', content: '', enabled: true }, ...draft.blocks.slice(1)] });
    setEditBlock(1);
  };
  const b = editBlock !== null ? draft.blocks[editBlock] : null;

  return (
    <>
      <Dialog
        open={renaming !== null}
        onOpenChange={(o) => !o && setRenaming(null)}
        title="Rename preset"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!renaming?.trim()} onClick={commitRename}>
              Rename
            </Button>
          </>
        }
      >
        <Field label="Name" htmlFor="preset-name">
          <Input id="preset-name" autoFocus value={renaming ?? ''} maxLength={120} onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && commitRename()} />
        </Field>
      </Dialog>
      <Section
        title="Preset"
        description="Presets decide what goes into the prompt, and in what order. SillyTavern chat-completion presets import directly."
        action={
          <Menu
            trigger={<IconButton icon={MoreHorizontal} label="Preset actions" />}
            items={[
              { label: 'Save as new preset', icon: Plus, onSelect: () => save(true) },
              ...(active
                ? [
                    { label: 'Rename', icon: Pencil, onSelect: rename },
                    { label: 'Export', icon: Download, onSelect: () => download(`/api/presets/${active.id}/export`, `${active.name}.json`) },
                    { label: 'Export for SillyTavern', icon: Download, onSelect: () => download(`/api/presets/${active.id}/export?format=sillytavern`, `${active.name}.json`) },
                    { label: 'Delete', icon: Trash2, danger: true, separatorBefore: true, onSelect: remove },
                  ]
                : []),
            ]}
          />
        }
      >
        <div className="flex gap-2">
          <Select aria-label="Active preset" value={activeId} onChange={(e) => update({ activePresetId: e.target.value || null })} className="flex-1">
            <option value="">Default</option>
            {(presets.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <FileButton accept=".json,.evlt" onFiles={(f) => importPreset(f[0])} icon={Upload} variant="secondary">
            Import
          </FileButton>
        </div>
      </Section>
      <Section
        title="Prompt blocks"
        description="Top to bottom is the order sent to the model. Use the Prompt inspector in a chat to see the result."
        action={
          <Button size="sm" variant="secondary" icon={Plus} onClick={addBlock}>
            Block
          </Button>
        }
      >
        <ol className="flex flex-col divide-y divide-line">
          {draft.blocks.map((blk, i) => (
            <li key={blk.id} className={cx('flex min-h-14 items-center gap-2 py-2', !blk.enabled && 'opacity-55')}>
              <Switch checked={blk.enabled} onChange={(v) => setBlock(i, { enabled: v })} label={`Enable ${blk.name}`} />
              <button className="min-w-0 flex-1 px-1 text-left" onClick={() => setEditBlock(i)}>
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{blk.name}</span>
                  {blk.injection?.mode === 'depth' ? <Badge>@{blk.injection.depth}</Badge> : null}
                  {blk.role !== 'system' ? <Badge>{blk.role}</Badge> : null}
                </span>
                <span className="block truncate text-xs text-fg-2">{blk.kind === 'marker' ? MARKER_HINT[blk.marker ?? ''] ?? 'Filled automatically' : blk.content || 'Empty'}</span>
              </button>
              <IconButton size="sm" icon={ArrowUp} label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
              <IconButton size="sm" icon={ArrowDown} label="Move down" disabled={i === draft.blocks.length - 1} onClick={() => move(i, 1)} />
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Options">
        <div className="flex flex-col divide-y divide-line">
          <ToggleRow label="Prefer the character's system prompt" description="Cards with their own system prompt replace the main prompt." checked={draft.preferCharacterPrompt} onChange={(v) => setDraft({ ...draft, preferCharacterPrompt: v })} />
          <ToggleRow label="Prefer the character's post-history instructions" checked={draft.preferCharacterInstructions} onChange={(v) => setDraft({ ...draft, preferCharacterInstructions: v })} />
          <ToggleRow label="Squash system messages" description="Merge consecutive system messages into one." checked={draft.squashSystem} onChange={(v) => setDraft({ ...draft, squashSystem: v })} />
        </div>
        <div className="mt-3 flex flex-col gap-4">
          <Field label="Speaker names in history" htmlFor="names">
            <Select id="names" value={draft.namesInHistory} onChange={(e) => setDraft({ ...draft, namesInHistory: e.target.value as PromptPreset['namesInHistory'] })}>
              <option value="group">Only in group chats</option>
              <option value="always">Always</option>
              <option value="none">Never</option>
            </Select>
          </Field>
          <Field label="Assistant prefill" htmlFor="prefill" hint="Starts the reply with this text (Claude and some other APIs).">
            <Textarea id="prefill" rows={2} value={draft.assistantPrefill} onChange={(e) => setDraft({ ...draft, assistantPrefill: e.target.value })} />
          </Field>
          <details>
            <summary className="cursor-pointer py-2 text-sm font-medium text-fg-2">Formats and nudges</summary>
            <div className="flex flex-col gap-4 pt-2">
              {(Object.keys(draft.formats) as Array<keyof PromptPreset['formats']>).map((k) => (
                <Field key={k} label={k.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())} htmlFor={`fmt-${k}`}>
                  <Textarea id={`fmt-${k}`} rows={2} value={draft.formats[k]} onChange={(e) => setDraft({ ...draft, formats: { ...draft.formats, [k]: e.target.value } })} />
                </Field>
              ))}
            </div>
          </details>
        </div>
      </Section>
      {dirty ? (
        <div className="sticky bottom-[calc(var(--tabbar-h)+var(--safe-bottom)+8px)] z-10 flex justify-end gap-2 rounded-md bg-surface p-2 shadow-3 md:bottom-4 dark:bg-surface-2">
          <Button variant="ghost" onClick={() => setDraft(structuredClone((active?.preset ?? def.data)!))}>
            Discard
          </Button>
          <Button variant="primary" loading={saving} onClick={() => save()}>
            {active ? 'Save preset' : 'Save as preset'}
          </Button>
        </div>
      ) : null}
      <Sheet
        open={editBlock !== null}
        onOpenChange={(o) => !o && setEditBlock(null)}
        title={b?.name ?? 'Block'}
        size="lg"
        footer={
          b && b.kind === 'text' && !['main', 'postHistory'].includes(b.id) ? (
            <Button
              variant="quiet"
              icon={Trash2}
              onClick={() => {
                setDraft({ ...draft, blocks: draft.blocks.filter((_, k) => k !== editBlock) });
                setEditBlock(null);
              }}
            >
              Remove block
            </Button>
          ) : undefined
        }
      >
        {b && editBlock !== null ? (
          <div className="flex flex-col gap-4">
            <Field label="Name" htmlFor="bname">
              <Input id="bname" value={b.name} onChange={(e) => setBlock(editBlock, { name: e.target.value })} />
            </Field>
            {b.kind === 'text' ? (
              <Field label="Content" htmlFor="bcontent" hint="Macros like {{char}}, {{user}}, {{time}}, {{location}} work here.">
                <Textarea id="bcontent" rows={8} maxRows={24} value={b.content} onChange={(e) => setBlock(editBlock, { content: e.target.value })} />
              </Field>
            ) : (
              <p className="rounded-md bg-surface-2 px-3 py-2.5 text-sm text-fg-2">{MARKER_HINT[b.marker ?? ''] ?? 'Filled automatically'} — the content comes from the chat.</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Role" htmlFor="brole">
                <Select id="brole" value={b.role} onChange={(e) => setBlock(editBlock, { role: e.target.value as PromptBlock['role'] })}>
                  <option value="system">System</option>
                  <option value="user">User</option>
                  <option value="assistant">Assistant</option>
                </Select>
              </Field>
              {b.marker !== 'chatHistory' ? (
                <Field label="Placement" htmlFor="bplace">
                  <Select
                    id="bplace"
                    value={b.injection?.mode === 'depth' ? 'depth' : 'relative'}
                    onChange={(e) => setBlock(editBlock, { injection: e.target.value === 'depth' ? { mode: 'depth', depth: b.injection?.depth ?? 4 } : undefined })}
                  >
                    <option value="relative">In order</option>
                    <option value="depth">Inside chat, at depth</option>
                  </Select>
                </Field>
              ) : null}
            </div>
            {b.injection?.mode === 'depth' ? (
              <Field label="Depth" htmlFor="bdepth" hint="0 = after the last message.">
                <Input id="bdepth" type="number" min={0} max={200} value={b.injection.depth} onChange={(e) => setBlock(editBlock, { injection: { mode: 'depth', depth: Number(e.target.value) } })} className="max-w-[120px]" />
              </Field>
            ) : null}
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
