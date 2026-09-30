import type { LucideIcon } from 'lucide-react';
import { BookHeart, Bookmark, Clock, Flame, Folder, Heart, Moon, Sparkles, Star, Swords, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { del, patch, post } from '@/lib/api';
import { cx } from '@/lib/format';
import { toastError } from '@/lib/store';
import { Button, confirm, Dialog, Field, Icon, Input } from '@/ui';
import type { CollectionDTO } from './LibraryPage';

const ICONS: Record<string, LucideIcon> = { folder: Folder, star: Star, heart: Heart, bookmark: Bookmark, clock: Clock, flame: Flame, moon: Moon, sparkles: Sparkles, swords: Swords, book: BookHeart };
export const collectionIcon = (name: string) => ICONS[name] ?? Folder;

/** Soft background + readable text, built on the theme's tokens where they exist. */
export const COLLECTION_COLORS: Record<string, { soft: string; fg: string; dot: string }> = {
  accent: { soft: 'var(--accent-soft)', fg: 'var(--accent-text)', dot: 'var(--accent)' },
  rose: { soft: 'var(--danger-soft)', fg: 'var(--danger)', dot: 'var(--danger)' },
  green: { soft: 'var(--success-soft)', fg: 'var(--success)', dot: 'var(--success)' },
  amber: { soft: 'var(--warning-soft)', fg: 'var(--warning)', dot: 'var(--warning)' },
  slate: { soft: 'var(--surface-3)', fg: 'var(--text-2)', dot: 'var(--text-3)' },
};

export function CollectionDialog({ target, onClose, onDone }: { target: CollectionDTO | 'new' | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('folder');
  const [color, setColor] = useState('accent');
  useEffect(() => {
    if (!target) return;
    setName(target === 'new' ? '' : target.name);
    setIcon(target === 'new' ? 'folder' : target.icon);
    setColor(target === 'new' ? 'accent' : target.color);
  }, [target]);
  const save = async () => {
    try {
      if (target === 'new') await post('/api/library/collections', { name, icon, color });
      else if (target) await patch(`/api/library/collections/${target.id}`, { name, icon, color });
      onDone();
      onClose();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => !o && onClose()}
      title={target === 'new' ? 'New collection' : 'Edit collection'}
      description="A named, ordered shelf. A character can be on several."
      footer={
        <>
          {target && target !== 'new' ? (
            <Button
              variant="ghost"
              icon={Trash2}
              className="mr-auto !text-danger"
              onClick={async () => {
                if (!(await confirm({ title: `Delete “${target.name}”?`, description: 'The characters stay in your library.', confirmLabel: 'Delete', danger: true }))) return;
                await del(`/api/library/collections/${target.id}`);
                onDone();
                onClose();
              }}
            >
              Delete
            </Button>
          ) : null}
          <Button variant="primary" disabled={!name.trim()} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" htmlFor="col-name">
          <Input id="col-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Play next" />
        </Field>
        <div>
          <p className="text-sm font-medium text-fg-2">Icon</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {Object.entries(ICONS).map(([k, I]) => (
              <button key={k} type="button" aria-label={k} aria-pressed={icon === k} onClick={() => setIcon(k)} className={cx('pressable flex size-10 items-center justify-center rounded-md', icon === k ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-fg-2')}>
                <Icon icon={I} size={18} />
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium text-fg-2">Color</p>
          <div className="mt-1.5 flex gap-2">
            {Object.entries(COLLECTION_COLORS).map(([k, c]) => (
              <button key={k} type="button" aria-label={k} aria-pressed={color === k} onClick={() => setColor(k)} className={cx('pressable size-9 rounded-full ring-offset-2 ring-offset-surface', color === k && 'ring-2 ring-fg')} style={{ background: c.dot }} />
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
