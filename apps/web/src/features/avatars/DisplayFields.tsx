/** On a character: how it appears on the stage (3D of some kind, Live2D or pictures), and which avatar. */
import type { AvatarKind, CharacterGame } from '@everloom/engine';
import { Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useFeatureOn } from '@/lib/features';
import { cx } from '@/lib/format';
import { toast, toastError } from '@/lib/store';
import { Button, Field, Input, Select } from '@/ui';
import { createCodeAvatar, fillRecipe, useAvatars } from './api';
import { usePrefs3D } from './prefs';

type Choice = 'auto' | 'imported' | 'parts' | 'code' | 'live2d' | 'sprite';
const CHOICES: Array<{ value: Choice; label: string; line: string }> = [
  { value: 'auto', label: 'Automatic', line: 'Its saved 3D avatar, then Live2D, then its sprite or portrait.' },
  { value: 'imported', label: '3D model', line: 'A model imported from GLB, VRM, glTF, FBX, PMX or OBJ.' },
  { value: 'parts', label: 'Parts-made', line: 'Built in the parts maker from hair, clothes and bodies of a part pack.' },
  { value: 'code', label: 'Code-made', line: 'A simple figure built by Everloom from a few choices; no file, runs on any phone.' },
  { value: 'live2d', label: 'Live2D', line: 'Its Live2D model, if one is installed for it.' },
  { value: 'sprite', label: 'Pictures', line: 'Its portrait and expression pictures.' },
];

export function DisplayFields({ game, setGame, characterId }: { game: CharacterGame; setGame: (p: Partial<CharacterGame>) => void; characterId?: string }) {
  const on = useFeatureOn('avatars3d');
  const experimental = usePrefs3D(p => p.experimentalProcedural);
  const avatars = useAvatars(on);
  const navigate = useNavigate();
  const [making, setMaking] = useState(false);
  const [picked, setPicked] = useState<Choice | null>(null);
  if (!on) return null;
  const ready = (avatars.data ?? []).filter((a) => a.status === 'ready');
  const chosen = ready.find((a) => a.id === game.avatar3d);
  const display = game.display ?? 'auto';
  const kindOf = (k: AvatarKind | undefined): Choice => (k === 'parts' ? 'parts' : k === 'code' ? 'code' : 'imported');
  const current: Choice = display === 'live2d' ? 'live2d' : display === 'sprite' ? 'sprite' : display === '3d' ? (chosen ? kindOf(chosen.kind) : 'imported') : 'auto';
  const choice = picked ?? current;
  const kind: AvatarKind | null = choice === 'imported' ? 'imported' : choice === 'parts' ? 'parts' : choice === 'code' ? 'code' : null;
  const options = kind ? ready.filter((a) => (kind === 'imported' ? a.kind === 'imported' || a.kind === 'realistic' || a.kind === 'makehuman' || a.kind === 'character' : a.kind === kind)) : [];

  const pick = (c: Choice) => {
    setPicked(c);
    if (c === 'auto') setGame({ display: 'auto' });
    else if (c === 'live2d' || c === 'sprite') setGame({ display: c });
    else {
      // Keep the avatar if it's of this kind; otherwise the first one of the kind (code-made: none
      // means a figure from the description).
      const keep = chosen && kindOf(chosen.kind) === c ? chosen.id : c === 'code' ? undefined : ready.find((a) => kindOf(a.kind) === c)?.id;
      setGame({ display: '3d', avatar3d: keep });
    }
  };

  /** A code-made avatar from this character's description, linked in the draft. */
  const make = async () => {
    if (!characterId) return;
    setMaking(true);
    try {
      const { recipe, source } = await fillRecipe({ characterId });
      const a = await createCodeAvatar('', recipe);
      setGame({ avatar3d: a.id, display: '3d' });
      toast({ title: 'Code-made look ready', lines: [source === 'model' ? 'Filled in by the utility model.' : 'Worked out from the description.', 'Save the character to keep it.'], tone: 'success', action: { label: 'Edit the look', run: () => navigate(`/characters/avatars/${a.id}`) } });
    } catch (e) {
      toastError(e);
    } finally {
      setMaking(false);
    }
  };

  return (
    <div className="grid gap-3">
      <Field label="Recorded age"><Input aria-label="Recorded age" type="number" min={0} max={120} value={game.age ?? ''} onChange={e => setGame({ age: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
      <div role="radiogroup" aria-label="On the stage" className="grid gap-2 sm:grid-cols-2" data-testid="display-picker">
        {CHOICES.filter(c => c.value !== 'code' || experimental || chosen?.kind === 'code').map((c) => (
          <button key={c.value} type="button" role="radio" aria-checked={choice === c.value} onClick={() => pick(c.value)} className={cx('pressable rounded-lg border p-3 text-left', choice === c.value ? 'border-accent bg-accent/10' : 'border-line bg-surface hover:border-line-strong')}>
            <span className="block text-sm font-medium">{c.label}</span>
            <span className="mt-0.5 block text-xs text-fg-2">{c.line}</span>
          </button>
        ))}
      </div>
      {kind ? (
        <Field label="Avatar" htmlFor="avatar3d" hint={<Link to="/characters/avatars" className="underline">All avatars</Link>}>
          <Select id="avatar3d" value={game.avatar3d && options.some((a) => a.id === game.avatar3d) ? game.avatar3d : ''} onChange={(e) => setGame({ avatar3d: e.target.value || undefined, display: '3d' })}>
            <option value="">{kind === 'code' ? 'Made from the description (automatic)' : 'Choose…'}</option>
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {choice === 'code' && characterId ? (
        <div>
          <Button variant="secondary" icon={Wand2} loading={making} onClick={make} data-testid="make-code-avatar">
            Make a code-made look to edit
          </Button>
        </div>
      ) : null}
      {choice === 'parts' && !options.length ? (
        <Button variant="secondary" onClick={() => navigate('/characters/maker')}>
          Open the parts maker
        </Button>
      ) : null}
      {choice === 'imported' && !options.length ? (
        <Button variant="secondary" onClick={() => navigate('/characters/avatars')}>
          Import a model
        </Button>
      ) : null}
    </div>
  );
}
