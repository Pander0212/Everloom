/**
 * The shared asset library: sprites, backgrounds, CGs and icons kept once and used anywhere —
 * as a character's expression (or a whole expression set at once) or as this chat's background.
 */
import { EMOTIONS, type CharacterDTO, type ChatDTO } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileArchive, Image as ImageIcon, Search, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { del, get, patch, upload } from '@/lib/api';
import { cx } from '@/lib/format';
import { qk } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, EmptyState, Field, FileButton, Icon, IconButton, Input, Segmented, Select, Sheet } from '@/ui';

type AssetType = 'sprite' | 'background' | 'cg' | 'icon';
interface Asset {
  id: string;
  url: string;
  name: string;
  type: AssetType;
  tags: string[];
  set?: string;
  expression?: string;
}
interface Library {
  assets: Asset[];
  sets: Array<{ name: string; expressions: Record<string, string> }>;
  tags: string[];
}

const TYPES: Array<{ value: AssetType | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'sprite', label: 'Sprites' },
  { value: 'background', label: 'Backgrounds' },
  { value: 'cg', label: 'CGs' },
  { value: 'icon', label: 'Icons' },
];
const KEY = ['assets'];

export function AssetLibrary({ open, onOpenChange, cast, chat }: { open: boolean; onOpenChange: (o: boolean) => void; cast: CharacterDTO[]; chat: ChatDTO }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState<AssetType | 'all'>('all');
  const [newType, setNewType] = useState<AssetType>('sprite');
  const [picked, setPicked] = useState<Asset | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const lib = useQuery({ queryKey: [...KEY, q, type], queryFn: () => get<Library>('/api/assets', { q, ...(type !== 'all' ? { type } : {}) }), enabled: open });
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });

  const giveSet = async (c: CharacterDTO, expressions: Record<string, string>) => {
    try {
      await patch(`/api/characters/${c.id}`, { game: { ...(c.game ?? {}), expressions: { ...(c.game?.expressions ?? {}), ...expressions } } });
      await qc.invalidateQueries({ queryKey: qk.character(c.id) });
      toast({ title: `${c.name} has ${Object.keys(expressions).length} new expression${Object.keys(expressions).length === 1 ? '' : 's'}`, tone: 'success' });
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Asset library" description="Pictures you can use for any character or story." size="lg">
      <div className="flex flex-col gap-4">
        <div className="relative">
          <Icon icon={Search} size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search names and tags" aria-label="Search assets" className="pl-10" />
        </div>
        <div className="-mx-1 overflow-x-auto px-1">
          <Segmented label="Type" size="sm" value={type} onChange={setType} options={TYPES} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Type for new pictures" value={newType} onChange={(e) => setNewType(e.target.value as AssetType)} className="w-auto">
            {TYPES.filter((t) => t.value !== 'all').map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <FileButton
            accept="image/*"
            multiple
            icon={Upload}
            onFiles={async (files) => {
              try {
                for (const f of files) await upload('/api/assets', f, { type: newType, name: f.name.replace(/\.[^.]+$/, '') });
                await refresh();
              } catch (e) {
                toastError(e);
              }
            }}
          >
            Add pictures
          </FileButton>
          <FileButton
            accept=".zip,application/zip"
            variant="secondary"
            icon={FileArchive}
            onFiles={async ([f]) => {
              if (!f) return;
              try {
                const r = await upload<{ added: number; skipped: number; sets: string[] }>('/api/assets/zip', f, { name: f.name });
                toast({ title: `Added ${r.added} picture${r.added === 1 ? '' : 's'}${r.sets.length ? ` and ${r.sets.length} expression set${r.sets.length === 1 ? '' : 's'}` : ''}`, lines: r.skipped ? [`${r.skipped} file${r.skipped === 1 ? ' was' : 's were'} not a picture`] : undefined, tone: 'success' });
                await refresh();
              } catch (e) {
                toastError(e);
              }
            }}
          >
            Import a zip
          </FileButton>
        </div>
        <p className="-mt-2 text-xs text-fg-2">In a zip, folders become tags; folders named backgrounds, cgs or icons set the type, and pictures named after emotions (happy.png, sad.png…) become an expression set.</p>

        {lib.data?.sets.length ? (
          <section aria-label="Expression sets">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">Expression sets</h3>
            <ul className="flex flex-col gap-2">
              {lib.data.sets.map((set) => (
                <li key={set.name} className="flex flex-wrap items-center gap-2 rounded-md border border-line p-2.5">
                  <span className="flex -space-x-2">
                    {Object.values(set.expressions)
                      .slice(0, 4)
                      .map((id) => (
                        <img key={id} src={`/media/${id}`} alt="" className="size-9 rounded-md border border-surface bg-surface-2 object-cover" />
                      ))}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{set.name}</span>
                    <span className="block text-xs text-fg-2">{Object.keys(set.expressions).length} expressions</span>
                  </span>
                  {cast.map((c) => (
                    <Button key={c.id} size="sm" variant="secondary" onClick={() => void giveSet(c, set.expressions)}>
                      Give to {c.name}
                    </Button>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-label="Assets">
          {lib.data && !lib.data.assets.length ? (
            <EmptyState icon={ImageIcon} title={q || type !== 'all' ? 'Nothing matches' : 'No assets yet'} body={q || type !== 'all' ? 'Try other words or another type.' : 'Add pictures or import a zip. They stay on your server.'} />
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5" aria-label="Asset pictures">
              {(lib.data?.assets ?? []).map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => setPicked(a)} className={cx('pressable group flex w-full flex-col text-left', picked?.id === a.id && 'opacity-80')} aria-label={`${a.name}, ${a.type}`}>
                    <span className={cx('relative block w-full overflow-hidden rounded-md bg-surface-2', a.type === 'background' || a.type === 'cg' ? 'aspect-video' : 'aspect-[3/4]')}>
                      <img src={a.url} alt="" loading="lazy" className={cx('size-full', a.type === 'sprite' || a.type === 'icon' ? 'object-contain object-bottom' : 'object-cover')} />
                    </span>
                    <span className="mt-1 truncate text-xs">{a.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {picked ? <AssetSheet asset={picked} cast={cast} chat={chat} onClose={() => setPicked(null)} onChanged={refresh} /> : null}
    </Sheet>
  );
}

function AssetSheet({ asset, cast, chat, onClose, onChanged }: { asset: Asset; cast: CharacterDTO[]; chat: ChatDTO; onClose: () => void; onChanged: () => Promise<unknown> }) {
  const qc = useQueryClient();
  const [name, setName] = useState(asset.name);
  const [tags, setTags] = useState(asset.tags.join(', '));
  const [who, setWho] = useState(cast[0]?.id ?? '');
  const [emo, setEmo] = useState(asset.expression ?? 'neutral');
  const c = cast.find((x) => x.id === who);
  const save = async () => {
    try {
      await patch(`/api/assets/${asset.id}`, { name, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) });
      await onChanged();
      onClose();
    } catch (e) {
      toastError(e);
    }
  };
  const useAsExpression = async () => {
    if (!c) return;
    try {
      await patch(`/api/characters/${c.id}`, { game: { ...(c.game ?? {}), expressions: { ...(c.game?.expressions ?? {}), [emo]: asset.id } } });
      await qc.invalidateQueries({ queryKey: qk.character(c.id) });
      toast({ title: `${c.name} · ${emo} updated`, tone: 'success' });
    } catch (e) {
      toastError(e);
    }
  };
  const useAsBackground = async () => {
    try {
      const r = await patch(`/api/chats/${chat.id}`, { metadata: { background: asset.id } });
      qc.setQueryData(qk.chat(chat.id), (x: any) => ({ ...x, ...r }));
      toast({ title: 'Background set for this chat', tone: 'success' });
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={asset.name} size="md">
      <div className="flex flex-col gap-4">
        <div className="flex justify-center rounded-md bg-surface-2 p-2">
          <img src={asset.url} alt={asset.name} className="max-h-64 object-contain" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge>{asset.type}</Badge>
          {asset.set ? <Badge tone="accent">{`${asset.set}${asset.expression ? ` · ${asset.expression}` : ''}`}</Badge> : null}
        </div>
        <Field label="Name" htmlFor="as-name">
          <Input id="as-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
        <Field label="Tags" htmlFor="as-tags" hint="Separated by commas">
          <Input id="as-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        {asset.type === 'sprite' && cast.length ? (
          <section aria-label="Use as an expression" className="flex flex-col gap-2 rounded-md border border-line p-3">
            <h3 className="text-sm font-medium">Use as an expression</h3>
            <div className="grid grid-cols-2 gap-2">
              <Select aria-label="Character" value={who} onChange={(e) => setWho(e.target.value)}>
                {cast.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
              <Select aria-label="Expression" value={emo} onChange={(e) => setEmo(e.target.value)}>
                {EMOTIONS.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </Select>
            </div>
            <Button variant="secondary" onClick={() => void useAsExpression()}>
              Use for {c?.name ?? 'character'}
            </Button>
          </section>
        ) : null}
        {asset.type === 'background' || asset.type === 'cg' ? (
          <Button variant="secondary" icon={ImageIcon} onClick={() => void useAsBackground()}>
            Background for this chat
          </Button>
        ) : null}
        <div className="flex gap-2">
          <Button variant="primary" className="flex-1" onClick={() => void save()}>
            Save
          </Button>
          <IconButton
            icon={Trash2}
            label={`Delete ${asset.name}`}
            onClick={async () => {
              try {
                await del(`/api/assets/${asset.id}`);
                await onChanged();
                onClose();
              } catch (e) {
                toastError(e);
              }
            }}
          />
        </div>
        <p className="text-xs text-fg-3">Deleting removes it everywhere it's used.</p>
      </div>
    </Sheet>
  );
}
