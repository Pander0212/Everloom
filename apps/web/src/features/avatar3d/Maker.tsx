/**
 * The parts maker: build a character from a part pack (the CharacterStudio pack format). A live
 * preview on top, the catalog below in tabs per trait group (thumbnails, search, tags), colours
 * per part, randomize and undo. Saving keeps the pack's body and the chosen parts as garments of
 * the pack's body family, so equipped items can swap them on the stage later.
 */
import { AvatarConfigSchema, type AvatarRecipe, packPath, packSlots, type AvatarConfig, type Garment, type GarmentSlot, type MakerSelection, type PackPart } from '@everloom/engine';
import { ArrowLeft, Copy, Dices, Download, Search, Shirt, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Page } from '@/app/Shell';
import { saveAvatar, setAvatarThumbnail, useAvatar, type AvatarDetail } from '@/features/avatars/api';
import { packFile, packRef, usePacks, type LoadedPack } from '@/features/avatars/packs';
import { post } from '@/lib/api';
import { cx } from '@/lib/format';
import { queryClient } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Button, EmptyState, Icon, IconButton, Input, Select, Spinner, Tabs, useDesktop } from '@/ui';
import Preview3D, { type PreviewHandle } from './Preview3D';
import { exportCharacter } from './runtime/export';
import { garmentsFor } from './parts';
import { captureThumbnail } from './runtime/thumbnail';

function configFor(pack: LoadedPack, sel: MakerSelection, base?: AvatarConfig): AvatarConfig {
  const { body } = packSlots(pack.manifest);
  return AvatarConfigSchema.parse({
    ...(base ?? {}),
    look: base?.look ?? 'toon',
    maker: sel,
    family: `pack:${pack.id}`,
    garments: garmentsFor(pack, sel),
    tints: body && sel.colors[body] ? { Body: sel.colors[body] } : {},
  });
}

/**
 * The upgrade path: a code-made character's recipe as a selection of the built-in pack (whose parts
 * share the recipe's names), with its colours and the closer of the two bodies.
 */
function fromRecipe(pack: LoadedPack, base: MakerSelection, r: AvatarRecipe): MakerSelection {
  const has = (g: string, id: string) => pack.manifest.traits.find((t) => t.trait === g)?.collection.some((p) => p.id === id);
  const parts = { ...base.parts };
  const colors: Record<string, string> = { BODY: r.body.skin };
  const set = (g: string, id: string | null, color?: string) => {
    if (id === null || id === 'none') parts[g] = null;
    else if (has(g, id)) {
      parts[g] = id;
      if (color) colors[g] = color;
    }
  };
  set('BODY', r.body.chest > 0.3 ? 'soft' : 'straight');
  set('HAIR', r.hair.style, r.hair.color);
  set('TOP', r.top.kind, r.top.color);
  set('BOTTOM', r.top.kind === 'robe' ? null : r.bottom.kind, r.bottom.color);
  set('SHOES', r.shoes.kind, r.shoes.color);
  set('HAT', r.hat.kind, r.hat.color);
  set('EXTRA', r.extras[0]?.kind ?? null, r.extras[0]?.color);
  const body = pack.manifest.traits.find((t) => t.trait === 'BODY')!.collection.find((p) => p.id === parts.BODY)!;
  return { ...base, parts, colors, body: packRef(pack, packPath(pack.manifest, body.directory))! };
}

function startSelection(pack: LoadedPack): MakerSelection {
  const m = pack.manifest;
  const { body } = packSlots(m);
  const parts: Record<string, string | null> = {};
  for (const g of m.traits) parts[g.trait] = m.initialTraits?.[g.trait] ?? (g.trait === body || m.requiredTraits?.includes(g.trait) ? g.collection[0]!.id : null);
  const bodyPart = m.traits.find((g) => g.trait === body)!.collection.find((p) => p.id === parts[body!])!;
  return { pack: pack.id, body: packRef(pack, packPath(m, bodyPart.directory))!, parts, colors: {}, textures: {}, morphs: {} };
}

/** Colours a group can take: its pack's colour collection for the chosen part. */
function colourChoices(pack: LoadedPack, group: string, part: PackPart | undefined): Array<{ id: string; name: string; value: string }> {
  const coll = part?.colorCollection ? pack.manifest.colorCollections?.find((c) => c.trait === part.colorCollection) : null;
  return (coll?.collection ?? []).map((c) => ({ id: c.id, name: c.name ?? c.id, value: `#${(Array.isArray(c.value) ? c.value[0]! : c.value).replace('#', '')}` }));
}

export default function Maker({ avatar }: { avatar?: AvatarDetail }) {
  const navigate = useNavigate();
  const desktop = useDesktop();
  const packs = usePacks();
  const [params] = useSearchParams();
  const usable = (packs.data ?? []).filter((p) => p.enabled);
  // Upgrading a code-made character: its recipe seeds the built-in pack's parts.
  const from = useAvatar(params.get('from'));
  const [packId, setPackId] = useState<string | null>(avatar?.config.maker?.pack ?? params.get('pack') ?? (params.get('from') ? 'basics' : null));
  const pack = usable.find((p) => p.id === packId) ?? usable[0];
  const [sel, setSel] = useState<MakerSelection | null>(avatar?.config.maker ?? null);
  const [history, setHistory] = useState<MakerSelection[]>([]);
  const [group, setGroup] = useState<string>('');
  const [query, setQuery] = useState('');
  const [name, setName] = useState(avatar?.name ?? '');
  const [handle, setHandle] = useState<PreviewHandle | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (params.get('from') && !from.data) return;
    if (pack && (!sel || sel.pack !== pack.id)) {
      const recipe = from.data?.kind === 'code' ? from.data.config.recipe : undefined;
      setSel(recipe && pack.id === 'basics' ? fromRecipe(pack, startSelection(pack), recipe) : startSelection(pack));
      if (from.data && !name) setName(from.data.name);
      setHistory([]);
    }
    if (pack && !group) setGroup(pack.manifest.traits[0]!.trait);
  }, [pack?.id, from.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const config = useMemo(() => (pack && sel ? configFor(pack, sel, avatar?.config) : null), [pack, sel, avatar?.config]);

  if (packs.isLoading) return <Page title="Make a character"><div className="grid min-h-[40vh] place-items-center"><Spinner /></div></Page>;
  if (!pack || !sel || !config) return <Page title="Make a character"><EmptyState icon={Shirt} title="No part packs" body="Turn on the built-in pack or import one in Settings › 3D characters › Part packs." /></Page>;

  const m = pack.manifest;
  const { body } = packSlots(m);
  const change = (next: MakerSelection) => {
    setHistory((h) => [...h.slice(-30), sel]);
    setSel(next);
  };
  const pick = (g: string, id: string | null) => {
    const next = { ...sel, parts: { ...sel.parts, [g]: id } };
    if (g === body && id) next.body = packRef(pack, packPath(m, m.traits.find((x) => x.trait === g)!.collection.find((p) => p.id === id)!.directory))!;
    change(next);
  };
  const randomize = () => {
    const parts = { ...sel.parts };
    const colors = { ...sel.colors };
    for (const g of m.traits) {
      if (!(m.randomTraits ?? m.traits.map((x) => x.trait)).includes(g.trait)) continue;
      const required = g.trait === body || m.requiredTraits?.includes(g.trait);
      const opts: Array<string | null> = [...(required ? [] : [null]), ...g.collection.map((p) => p.id)];
      parts[g.trait] = opts[Math.floor(Math.random() * opts.length)] ?? null;
      const ch = colourChoices(pack, g.trait, g.collection.find((p) => p.id === parts[g.trait]));
      if (ch.length) colors[g.trait] = ch[Math.floor(Math.random() * ch.length)]!.value;
    }
    change({ ...sel, parts, colors });
  };

  const save = async (copy = false) => {
    setBusy(copy ? 'copy' : 'save');
    try {
      const nm = (copy ? `${name || avatar?.name || 'Character'} (copy)` : name) || 'Parts-made character';
      let id = avatar?.id;
      if (avatar && !copy) await saveAvatar(avatar.id, { name: nm, config });
      else id = (await post<{ id: string }>('/api/avatars/parts', { name: nm, config })).id;
      if (handle) await setAvatarThumbnail(id!, await captureThumbnail(handle.stage)).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: ['avatars'] });
      toast({ title: copy ? 'Copy saved' : 'Saved', tone: 'success' });
      if (!avatar || copy) navigate(`/characters/avatars/${id}`, { replace: !copy });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  const download = async (format: 'glb' | 'vrm') => {
    if (!handle) return;
    setBusy(format);
    try {
      const blob = await exportCharacter(handle, { format, name: name || 'character' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(name || 'character').replace(/[^\w-]+/g, '_')}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  const grp = m.traits.find((g) => g.trait === group) ?? m.traits[0]!;
  const chosen = grp.collection.find((p) => p.id === sel.parts[grp.trait]);
  const q = query.trim().toLowerCase();
  const items = grp.collection.filter((p) => !q || `${p.id} ${p.name ?? ''} ${(p.type ?? []).join(' ')}`.toLowerCase().includes(q));
  const colours = colourChoices(pack, grp.trait, chosen);
  const required = grp.trait === body || m.requiredTraits?.includes(grp.trait);

  const preview = (
    <Preview3D src={packFile(pack, packPath(m, m.traits.find((g) => g.trait === body)!.collection.find((p) => p.id === sel.parts[body!])!.directory))} config={config} framing="full" inspect className={desktop ? 'h-[72vh]' : 'h-[42dvh]'} onLoaded={setHandle}>
      <div className="absolute inset-x-2 bottom-2 flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap sm:justify-center">
        {[['wave', 'Wave'], ['laugh', 'Laugh'], ['dance', 'Dance']].map(([e, l]) => (
          <Button key={e} size="sm" variant="secondary" className="shrink-0 !bg-surface/90" onClick={() => void handle?.avatar.emote(e!)}>
            {l}
          </Button>
        ))}
        {[['joy', 'Happy'], ['sadness', 'Sad'], ['surprise', 'Surprised'], ['neutral', 'Calm']].map(([e, l]) => (
          <Button key={e} size="sm" variant="ghost" className="shrink-0 !bg-surface/80" onClick={() => handle && (handle.avatar.emotion = e as never)}>
            {l}
          </Button>
        ))}
      </div>
    </Preview3D>
  );

  return (
    <Page
      title={avatar ? avatar.name : 'Make a character'}
      back={<IconButton icon={ArrowLeft} label="All avatars" onClick={() => navigate('/characters/avatars')} />}
      actions={
        <>
          <IconButton icon={Undo2} label="Undo" disabled={!history.length} onClick={() => (setSel(history[history.length - 1]!), setHistory((h) => h.slice(0, -1)))} />
          <IconButton icon={Dices} label="Randomize" onClick={randomize} data-testid="maker-random" />
          <Button onClick={() => void save()} loading={busy === 'save'} data-testid="maker-save">
            Save
          </Button>
        </>
      }
    >
      <div className={desktop ? 'grid grid-cols-[minmax(0,1.1fr)_minmax(360px,1fr)] gap-6' : 'flex flex-col gap-3'}>
        <div className={desktop ? 'sticky top-[68px] self-start' : 'sticky top-[60px] z-10 -mx-4 bg-bg px-4 pb-1'}>{preview}</div>
        <div className="flex min-w-0 flex-col gap-3" data-testid="maker-catalog">
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="Character name" placeholder="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1" />
            {usable.length > 1 ? (
              <Select aria-label="Part pack" value={pack.id} onChange={(e) => setPackId(e.target.value)} className="w-auto">
                {usable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
          <Tabs tabs={m.traits.map((g) => ({ value: g.trait, label: g.name ?? g.trait }))} value={grp.trait} onChange={(v) => (setGroup(v), setQuery(''))} />
          {grp.collection.length > 8 ? (
            <label className="relative">
              <Icon icon={Search} size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
              <Input aria-label="Search parts" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
            </label>
          ) : null}
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="listbox" aria-label={grp.name ?? grp.trait}>
            {!required ? (
              <li>
                <button type="button" role="option" aria-selected={!sel.parts[grp.trait]} onClick={() => pick(grp.trait, null)} className={cx('pressable grid aspect-square w-full place-items-center rounded-lg border text-sm text-fg-2', !sel.parts[grp.trait] ? 'border-accent bg-accent/10' : 'border-line bg-surface')}>
                  None
                </button>
              </li>
            ) : null}
            {items.map((p) => {
              const thumb = p.thumbnail ? packFile(pack, packPath(m, p.thumbnail, m.thumbnailsDirectory ? 'thumbnail' : 'trait')) : null;
              const on = sel.parts[grp.trait] === p.id;
              return (
                <li key={p.id}>
                  <button type="button" role="option" aria-selected={on} onClick={() => pick(grp.trait, p.id)} className={cx('pressable flex w-full flex-col overflow-hidden rounded-lg border text-left', on ? 'border-accent ring-2 ring-accent/40' : 'border-line bg-surface hover:border-line-strong')}>
                    <span className="grid aspect-square place-items-center bg-surface-2">{thumb ? <img src={thumb} alt="" loading="lazy" className="h-full w-full object-contain" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} /> : <Icon icon={Shirt} size={28} className="text-fg-3" />}</span>
                    <span className="truncate px-2 py-1 text-xs">{p.name ?? p.id}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {sel.parts[grp.trait] ? (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Colour">
              <span className="mr-1 text-sm text-fg-2">Colour</span>
              {colours.map((c) => (
                <button key={c.id} type="button" title={c.name} aria-label={c.name} aria-pressed={sel.colors[grp.trait] === c.value} onClick={() => change({ ...sel, colors: { ...sel.colors, [grp.trait]: c.value } })} className="pressable h-8 w-8 rounded-full border-2" style={{ background: c.value, borderColor: sel.colors[grp.trait] === c.value ? 'var(--accent)' : 'var(--line)' }} />
              ))}
              <input type="color" aria-label="Any colour" value={sel.colors[grp.trait] ?? '#cccccc'} onChange={(e) => setSel({ ...sel, colors: { ...sel.colors, [grp.trait]: e.target.value } })} onBlur={() => setHistory((h) => [...h, sel])} className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent" />
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2 border-t border-line pt-3">
            {avatar ? (
              <Button variant="secondary" icon={Copy} loading={busy === 'copy'} onClick={() => void save(true)}>
                Duplicate
              </Button>
            ) : null}
            <Button variant="secondary" icon={Download} loading={busy === 'glb'} onClick={() => void download('glb')} disabled={!handle}>
              GLB
            </Button>
            <Button variant="secondary" icon={Download} loading={busy === 'vrm'} onClick={() => void download('vrm')} disabled={!handle}>
              VRM
            </Button>
          </div>
          <p className="text-xs text-fg-2">
            {pack.name} · {pack.license}
          </p>
        </div>
      </div>
    </Page>
  );
}

/** Route wrapper: /characters/maker (new) — editing goes through the avatar page. */
export function MakerRoute() {
  const { id } = useParams();
  const q = useAvatar(id);
  if (id && q.isLoading) return null;
  return <Maker avatar={q.data} />;
}

